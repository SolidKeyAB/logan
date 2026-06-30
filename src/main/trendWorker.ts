import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import { discoverFields, extractSeries, extractSignalSeries, detectTransitions, correlate } from './trendEngine';
import { parseTimestampFast } from './timestampParse';
import type { FileHandler } from './fileHandler';

/**
 * Worker-thread entry for the Trends/Signals scans. The trend engine is CPU-bound
 * and reads the whole file in batches; running it here keeps the Electron main/UI
 * event loop free so the panel never appears stuck.
 *
 * The parent hands over a byte-offset index (see FileHandler.getScanContext) so this
 * worker can open its OWN fd to the same file and read the exact same lines without
 * sharing the main process's handler. Messages back:
 *   { type: 'done', result }     — finished
 *   { type: 'error', message }   — fatal
 */
interface ScanContext {
  filePath: string;
  headerLineCount: number;
  maxLineRead: number;
  offsets: Float64Array;
  lengths: Float64Array;
}

// Minimal read-only stand-in for FileHandler — the trend engine only calls
// getTotalLines() and getLines(), and only reads .lineNumber/.text off each line.
class WorkerFileReader {
  private fd: number;
  constructor(private ctx: ScanContext) {
    this.fd = fs.openSync(ctx.filePath, 'r');
  }
  getTotalLines(): number {
    return this.ctx.offsets.length - this.ctx.headerLineCount;
  }
  getLines(startLine: number, count: number): Array<{ lineNumber: number; text: string; level: undefined }> {
    const { offsets, lengths, headerLineCount, maxLineRead } = this.ctx;
    const out: Array<{ lineNumber: number; text: string; level: undefined }> = [];
    const actualStart = startLine + headerLineCount;
    const actualEnd = Math.min(actualStart + count, offsets.length);
    for (let i = actualStart; i < actualEnd; i++) {
      const offset = offsets[i];
      const length = lengths[i];
      const readLength = Math.min(length, maxLineRead);
      const buffer = Buffer.alloc(readLength);
      fs.readSync(this.fd, buffer, 0, readLength, offset);
      let text = buffer.toString('utf-8');
      if (length > maxLineRead) text += ' … (truncated)';
      out.push({ lineNumber: i - headerLineCount, text, level: undefined });
    }
    return out;
  }
  close(): void {
    try { fs.closeSync(this.fd); } catch { /* already closed */ }
  }
}

const { kind, args, scan } = workerData as { kind: string; args: any; scan: ScanContext };

try {
  const reader = new WorkerFileReader(scan);
  // The engine only uses getTotalLines/getLines; cast through unknown to satisfy its type.
  const handler = reader as unknown as FileHandler;
  let result: any;
  switch (kind) {
    case 'discover':
      result = discoverFields(handler, args);
      break;
    case 'series':
      result = extractSeries(handler, parseTimestampFast, args.field, args);
      break;
    case 'signal':
      result = extractSignalSeries(handler, args.fields, args);
      break;
    case 'transitions':
      result = detectTransitions(handler, parseTimestampFast, args.field, args);
      break;
    case 'correlate':
      result = correlate(handler, args.field, args.event, args);
      break;
    default:
      throw new Error(`Unknown trend job kind: ${kind}`);
  }
  reader.close();
  parentPort?.postMessage({ type: 'done', result });
} catch (err) {
  parentPort?.postMessage({
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
  });
}
