import { EventEmitter } from 'events';
import { ChildProcess, spawn, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogcatConfig, LogcatDeviceInfo, LogcatStatus } from '../shared/types';
import { wallClockPrefix } from './serialHandler';

export class LogcatHandler extends EventEmitter {
  private process: ChildProcess | null = null;
  private tempFilePath: string | null = null;
  private fd: number | null = null;
  private lineBuffer: string = '';
  private linesReceived: number = 0;
  private connectedSince: number | null = null;
  private config: LogcatConfig | null = null;

  async listDevices(): Promise<LogcatDeviceInfo[]> {
    return new Promise((resolve, reject) => {
      execFile('adb', ['devices', '-l'], { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`adb not found or failed: ${err.message}`));
          return;
        }
        resolve(parseAdbDevices(stdout));
      });
    });
  }

  async connect(config: LogcatConfig): Promise<string> {
    if (this.process) {
      throw new Error('Already connected. Disconnect first.');
    }

    // Create temp directory
    const tempDir = path.join(os.tmpdir(), 'logan-logcat');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Create temp file
    const safeDevice = (config.device || 'default').replace(/[^a-zA-Z0-9]/g, '_');
    const timestamp = Date.now();
    this.tempFilePath = path.join(tempDir, `logcat_${safeDevice}_${timestamp}.log`);
    fs.writeFileSync(this.tempFilePath, '');
    this.fd = fs.openSync(this.tempFilePath, 'a');

    this.config = config;
    this.lineBuffer = '';
    this.linesReceived = 0;
    this.connectedSince = Date.now();

    // Build adb logcat command args
    const args: string[] = [];
    if (config.device) {
      args.push('-s', config.device);
    }
    args.push('logcat');
    if (config.filter) {
      args.push(config.filter);
    }

    this.process = spawn('adb', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.handleData(chunk);
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf-8').trim();
      if (msg) {
        this.emit('error', msg);
      }
    });

    this.process.on('error', (err: Error) => {
      this.emit('error', err.message);
      this.cleanup();
      this.emit('disconnected');
    });

    this.process.on('close', (code) => {
      this.process = null;
      this.config = null;
      this.connectedSince = null;
      if (this.fd !== null) {
        // Flush partial line
        if (this.lineBuffer.length > 0) {
          fs.writeSync(this.fd, wallClockPrefix() + ' ' + this.lineBuffer + '\n');
          this.linesReceived++;
          this.lineBuffer = '';
          this.emit('lines-added', 1);
        }
        fs.closeSync(this.fd);
        this.fd = null;
      }
      this.emit('disconnected');
    });

    return this.tempFilePath;
  }

  private handleData(chunk: Buffer): void {
    if (!this.fd) return;

    const text = chunk.toString('utf-8');
    this.lineBuffer += text;

    // Split on any line ending: \r\n, \n, \r
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

    // Keep remainder in buffer (partial line)
    this.lineBuffer = this.lineBuffer.substring(lineStart);

    if (lines.length > 0) {
      // Write complete lines to temp file with wall clock timestamp
      const ts = wallClockPrefix();
      const data = lines.map(l => ts + ' ' + l + '\n').join('');
      fs.writeSync(this.fd, data);
      this.linesReceived += lines.length;
      this.emit('lines-added', lines.length);
    }
  }

  disconnect(): void {
    if (!this.process) return;

    try {
      this.process.kill('SIGTERM');
    } catch {
      // Process may already be dead
    }
    // The 'close' event handler will do the rest
  }

  getStatus(): LogcatStatus {
    return {
      connected: this.process !== null && !this.process.killed,
      deviceId: this.config?.device || null,
      filter: this.config?.filter || null,
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
    // Wait a tick for the close handler to flush
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch {}
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
  }

  private cleanup(): void {
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
    this.config = null;
    this.connectedSince = null;
  }
}

/** Parse `adb devices -l` output into LogcatDeviceInfo[] */
export function parseAdbDevices(output: string): LogcatDeviceInfo[] {
  const devices: LogcatDeviceInfo[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Skip header and empty lines
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('List of devices') || trimmed.startsWith('*')) {
      continue;
    }

    // Format: <serial> <state> [usb:<...>] [product:<...>] [model:<...>] [device:<...>] [transport_id:<...>]
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const id = parts[0];
    const state = parts[1];

    // Extract model from key:value pairs
    let model: string | undefined;
    for (const part of parts.slice(2)) {
      if (part.startsWith('model:')) {
        model = part.substring(6).replace(/_/g, ' ');
        break;
      }
    }

    devices.push({ id, state, model });
  }

  return devices;
}
