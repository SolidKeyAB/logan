import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SerialPortConfig, SerialPortInfo, SerialStatus } from '../shared/types';

/** Wall clock timestamp prefix: [HH:MM:SS.mmm]  */
export function wallClockPrefix(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}.${ms}]`;
}

// Dynamic import for serialport (native addon)
let SerialPortModule: any = null;

async function getSerialPort(): Promise<any> {
  if (!SerialPortModule) {
    SerialPortModule = await import('serialport');
  }
  return SerialPortModule;
}

export class SerialHandler extends EventEmitter {
  private port: any = null;
  private tempFilePath: string | null = null;
  private fd: number | null = null;
  private lineBuffer: string = '';
  private linesReceived: number = 0;
  private connectedSince: number | null = null;
  private config: SerialPortConfig | null = null;

  async listPorts(): Promise<SerialPortInfo[]> {
    const sp = await getSerialPort();
    const ports = await sp.SerialPort.list();
    return ports.map((p: any) => ({
      path: p.path,
      manufacturer: p.manufacturer || undefined,
      vendorId: p.vendorId || undefined,
      productId: p.productId || undefined,
    }));
  }

  async connect(config: SerialPortConfig): Promise<string> {
    if (this.port) {
      throw new Error('Already connected. Disconnect first.');
    }

    // Create temp directory
    const tempDir = path.join(os.tmpdir(), 'logan-serial');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Create temp file
    const safePath = config.path.replace(/[^a-zA-Z0-9]/g, '_');
    const timestamp = Date.now();
    this.tempFilePath = path.join(tempDir, `serial_${safePath}_${timestamp}.log`);
    // Create file and open fd for appending
    fs.writeFileSync(this.tempFilePath, '');
    this.fd = fs.openSync(this.tempFilePath, 'a');

    this.config = config;
    this.lineBuffer = '';
    this.linesReceived = 0;
    this.connectedSince = Date.now();

    const sp = await getSerialPort();
    this.port = new sp.SerialPort({
      path: config.path,
      baudRate: config.baudRate,
      autoOpen: false,
    });

    return new Promise((resolve, reject) => {
      this.port.open((err: Error | null) => {
        if (err) {
          this.cleanup();
          reject(err);
          return;
        }

        this.port.on('data', (chunk: Buffer) => {
          this.handleData(chunk);
        });

        this.port.on('error', (err: Error) => {
          this.emit('error', err.message);
        });

        this.port.on('close', () => {
          this.emit('disconnected');
          this.port = null;
          this.config = null;
          this.connectedSince = null;
        });

        resolve(this.tempFilePath!);
      });
    });
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
        // Skip \n in \r\n
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
    if (!this.port) return;

    // Flush any remaining partial line
    if (this.lineBuffer.length > 0 && this.fd) {
      fs.writeSync(this.fd, wallClockPrefix() + ' ' + this.lineBuffer + '\n');
      this.linesReceived++;
      this.lineBuffer = '';
      this.emit('lines-added', 1);
    }

    try {
      this.port.close();
    } catch {
      // Port may already be closed
    }
    this.port = null;
    this.config = null;
    this.connectedSince = null;

    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  getStatus(): SerialStatus {
    return {
      connected: this.port !== null && this.port.isOpen,
      portPath: this.config?.path || null,
      baudRate: this.config?.baudRate || 0,
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
