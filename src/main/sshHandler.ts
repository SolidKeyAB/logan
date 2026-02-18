import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Client, SFTPWrapper } from 'ssh2';
import type { FileEntry } from 'ssh2';
import { SshProfile, SshStatus } from '../shared/types';
import { wallClockPrefix } from './serialHandler';

export interface SshHostEntry {
  host: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

export interface RemoteDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

export class SshHandler extends EventEmitter {
  private client: Client | null = null;
  private stream: any = null;
  private sftp: SFTPWrapper | null = null;
  private tempFilePath: string | null = null;
  private fd: number | null = null;
  private lineBuffer: string = '';
  private linesReceived: number = 0;
  private connectedSince: number | null = null;
  private currentHost: string | null = null;
  private currentUsername: string | null = null;
  private currentRemotePath: string | null = null;

  parseSSHConfig(): SshHostEntry[] {
    const configPath = path.join(os.homedir(), '.ssh', 'config');
    if (!fs.existsSync(configPath)) return [];

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const entries: SshHostEntry[] = [];
      let current: SshHostEntry | null = null;

      for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const match = line.match(/^(\S+)\s+(.+)$/);
        if (!match) continue;

        const [, key, value] = match;
        const keyLower = key.toLowerCase();

        if (keyLower === 'host') {
          // Skip wildcard patterns
          if (value.includes('*') || value.includes('?')) {
            current = null;
            continue;
          }
          current = { host: value.trim() };
          entries.push(current);
        } else if (current) {
          switch (keyLower) {
            case 'hostname':
              current.hostName = value.trim();
              break;
            case 'user':
              current.user = value.trim();
              break;
            case 'port':
              current.port = parseInt(value.trim(), 10) || 22;
              break;
            case 'identityfile':
              current.identityFile = value.trim().replace(/^~/, os.homedir());
              break;
          }
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  async connect(config: {
    host: string;
    port: number;
    username: string;
    identityFile?: string;
    remotePath: string;
    passphrase?: string;
  }): Promise<string> {
    if (this.client) {
      throw new Error('Already connected. Disconnect first.');
    }

    // Create temp directory
    const tempDir = path.join(os.tmpdir(), 'logan-ssh');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Create temp file
    const safeHost = config.host.replace(/[^a-zA-Z0-9]/g, '_');
    const timestamp = Date.now();
    this.tempFilePath = path.join(tempDir, `ssh_${safeHost}_${timestamp}.log`);
    fs.writeFileSync(this.tempFilePath, '');
    this.fd = fs.openSync(this.tempFilePath, 'a');

    this.lineBuffer = '';
    this.linesReceived = 0;
    this.connectedSince = Date.now();
    this.currentHost = config.host;
    this.currentUsername = config.username;
    this.currentRemotePath = config.remotePath;

    // Resolve auth
    const connectConfig: any = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 10000,
    };

    // Try agent first if available
    if (process.env.SSH_AUTH_SOCK) {
      connectConfig.agent = process.env.SSH_AUTH_SOCK;
    }

    // Try identity file
    const keyPaths: string[] = [];
    if (config.identityFile && fs.existsSync(config.identityFile)) {
      keyPaths.push(config.identityFile);
    }
    // Default key locations
    const defaultKeys = [
      path.join(os.homedir(), '.ssh', 'id_ed25519'),
      path.join(os.homedir(), '.ssh', 'id_rsa'),
    ];
    for (const k of defaultKeys) {
      if (fs.existsSync(k) && !keyPaths.includes(k)) {
        keyPaths.push(k);
      }
    }

    if (keyPaths.length > 0) {
      try {
        connectConfig.privateKey = fs.readFileSync(keyPaths[0]);
        if (config.passphrase) {
          connectConfig.passphrase = config.passphrase;
        }
      } catch {
        // If reading key fails, we'll still try agent auth
      }
    }

    this.client = new Client();

    return new Promise((resolve, reject) => {
      const client = this.client!;

      client.on('ready', () => {
        // Start tail -f on the remote path
        client.exec(`tail -f ${this.shellEscape(config.remotePath)}`, (err, stream) => {
          if (err) {
            this.cleanup();
            reject(err);
            return;
          }

          this.stream = stream;

          stream.on('data', (chunk: Buffer) => {
            this.handleData(chunk);
          });

          stream.stderr.on('data', (chunk: Buffer) => {
            const msg = chunk.toString('utf-8').trim();
            if (msg) this.emit('error', msg);
          });

          stream.on('close', () => {
            this.emit('disconnected');
            this.stream = null;
          });

          // Also open SFTP for browsing
          client.sftp((err, sftp) => {
            if (!err) {
              this.sftp = sftp;
            }
          });

          resolve(this.tempFilePath!);
        });
      });

      client.on('error', (err) => {
        const msg = err.message || String(err);
        // Check if it's a passphrase error
        if (msg.includes('passphrase') || msg.includes('encrypted')) {
          this.cleanup();
          reject(new Error('PASSPHRASE_NEEDED'));
          return;
        }
        this.emit('error', msg);
        this.cleanup();
        reject(err);
      });

      client.on('close', () => {
        if (this.connectedSince) {
          this.emit('disconnected');
        }
      });

      client.connect(connectConfig);
    });
  }

  private shellEscape(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  private handleData(chunk: Buffer): void {
    if (!this.fd) return;

    const text = chunk.toString('utf-8');
    this.lineBuffer += text;

    const lines: string[] = [];
    let i = 0;
    let lineStart = 0;

    while (i < this.lineBuffer.length) {
      const ch = this.lineBuffer[i];
      if (ch === '\n') {
        lines.push(this.lineBuffer.substring(lineStart, i));
        lineStart = i + 1;
      } else if (ch === '\r') {
        lines.push(this.lineBuffer.substring(lineStart, i));
        if (i + 1 < this.lineBuffer.length && this.lineBuffer[i + 1] === '\n') {
          i++;
        }
        lineStart = i + 1;
      }
      i++;
    }

    this.lineBuffer = this.lineBuffer.substring(lineStart);

    if (lines.length > 0) {
      const ts = wallClockPrefix();
      const data = lines.map(l => ts + ' ' + l + '\n').join('');
      fs.writeSync(this.fd, data);
      this.linesReceived += lines.length;
      this.emit('lines-added', lines.length);
    }
  }

  disconnect(): void {
    // Flush any remaining partial line
    if (this.lineBuffer.length > 0 && this.fd) {
      fs.writeSync(this.fd, wallClockPrefix() + ' ' + this.lineBuffer + '\n');
      this.linesReceived++;
      this.lineBuffer = '';
      this.emit('lines-added', 1);
    }

    if (this.stream) {
      try { this.stream.close(); } catch { /* */ }
      this.stream = null;
    }

    if (this.sftp) {
      try { this.sftp.end(); } catch { /* */ }
      this.sftp = null;
    }

    if (this.client) {
      try { this.client.end(); } catch { /* */ }
      this.client = null;
    }

    this.currentHost = null;
    this.currentUsername = null;
    this.currentRemotePath = null;
    this.connectedSince = null;

    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  async listRemoteDir(remotePath: string): Promise<RemoteDirEntry[]> {
    // If we don't have an active SFTP session, create a temporary one
    if (!this.sftp && !this.client) {
      throw new Error('Not connected. Connect to SSH first.');
    }

    const sftp = this.sftp || await this.openSftp();
    if (!sftp) throw new Error('Failed to open SFTP session.');

    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(err);
          return;
        }

        const entries: RemoteDirEntry[] = list
          .filter((item: FileEntry) => !item.filename.startsWith('.'))
          .map((item: FileEntry) => ({
            name: item.filename,
            path: remotePath === '/' ? `/${item.filename}` : `${remotePath}/${item.filename}`,
            isDirectory: (item.attrs as any).isDirectory?.() ?? ((item.attrs.mode! & 0o40000) !== 0),
            size: item.attrs.size,
          }))
          .sort((a, b) => {
            // Directories first, then alphabetical
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        resolve(entries);
      });
    });
  }

  async downloadRemoteFile(remotePath: string): Promise<string> {
    if (!this.sftp && !this.client) {
      throw new Error('Not connected. Connect to SSH first.');
    }

    const sftp = this.sftp || await this.openSftp();
    if (!sftp) throw new Error('Failed to open SFTP session.');

    const tempDir = path.join(os.tmpdir(), 'logan-ssh');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const fileName = path.basename(remotePath);
    const localPath = path.join(tempDir, `dl_${Date.now()}_${fileName}`);

    return new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(localPath);
      });
    });
  }

  private openSftp(): Promise<SFTPWrapper | null> {
    if (!this.client) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.client!.sftp((err, sftp) => {
        if (err) {
          resolve(null);
          return;
        }
        this.sftp = sftp;
        resolve(sftp);
      });
    });
  }

  /**
   * Open an interactive shell channel on this handler's existing SSH client.
   * Used by tabbed terminal to reuse a live connection's SSH session.
   * The tail stream continues unaffected (ssh2 supports multiple channels).
   */
  openShell(cols: number, rows: number): Promise<any> {
    if (!this.client) {
      return Promise.reject(new Error('SSH client not connected'));
    }
    return new Promise((resolve, reject) => {
      this.client!.shell(
        { term: 'xterm-256color', cols, rows },
        (err: Error | undefined, stream: any) => {
          if (err) return reject(err);
          resolve(stream);
        }
      );
    });
  }

  /** Check if the SSH client is connected */
  isClientConnected(): boolean {
    return this.client !== null;
  }

  getStatus(): SshStatus {
    return {
      connected: this.client !== null && this.stream !== null,
      host: this.currentHost,
      username: this.currentUsername,
      remotePath: this.currentRemotePath,
      linesReceived: this.linesReceived,
      connectedSince: this.connectedSince,
      tempFilePath: this.tempFilePath,
    };
  }

  getTempFilePath(): string | null {
    return this.tempFilePath;
  }

  cleanupTempFile(): void {
    this.disconnect();
    if (this.tempFilePath && fs.existsSync(this.tempFilePath)) {
      try {
        fs.unlinkSync(this.tempFilePath);
      } catch {
        // Best effort
      }
    }
    this.tempFilePath = null;
  }

  private cleanup(): void {
    if (this.stream) {
      try { this.stream.close(); } catch { /* */ }
      this.stream = null;
    }
    if (this.sftp) {
      try { this.sftp.end(); } catch { /* */ }
      this.sftp = null;
    }
    if (this.client) {
      try { this.client.end(); } catch { /* */ }
      this.client = null;
    }
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    if (this.tempFilePath && fs.existsSync(this.tempFilePath)) {
      try {
        fs.unlinkSync(this.tempFilePath);
      } catch {
        // Best effort
      }
    }
    this.tempFilePath = null;
    this.currentHost = null;
    this.currentUsername = null;
    this.currentRemotePath = null;
    this.connectedSince = null;
  }
}
