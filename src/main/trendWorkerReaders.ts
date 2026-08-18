// Read-only line readers used by the Trends/Signals worker.
//
// Two shapes, one interface (LineReader = getTotalLines + getLines + close):
//   - WorkerFileReader     : opens its OWN fd to one file and reads lines via the byte-offset
//                            index the main process handed over (FileHandler.getScanContext).
//   - CompositeWorkerReader : wraps N member readers behind ONE continuous global line space
//                            (the same pure, unit-tested CompositeLineSpace the CompositeFile-
//                            Handler uses), so the engine reads a "single session" as one file
//                            and every line number it returns is already global — no merge.
//
// Split out of trendWorker.ts (the worker ENTRY, which runs on import) so both readers are
// importable and unit-testable headlessly without spawning a worker.

import * as fs from 'fs';
import { CompositeLineSpace } from './compositeLineSpace';

export interface ScanContext {
  filePath: string;
  headerLineCount: number;
  maxLineRead: number;
  offsets: Float64Array;
  lengths: Float64Array;
}

// The engine only reads .lineNumber/.text off each line and only calls getTotalLines/getLines.
export interface WorkerLine {
  lineNumber: number;
  text: string;
  level: undefined;
}

export interface LineReader {
  getTotalLines(): number;
  getLines(startLine: number, count: number): WorkerLine[];
  close(): void;
}

// Minimal read-only stand-in for FileHandler, backed by a byte-offset index over one file.
export class WorkerFileReader implements LineReader {
  private fd: number;
  constructor(private ctx: ScanContext) {
    this.fd = fs.openSync(ctx.filePath, 'r');
  }
  getTotalLines(): number {
    return this.ctx.offsets.length - this.ctx.headerLineCount;
  }
  getLines(startLine: number, count: number): WorkerLine[] {
    const { offsets, lengths, headerLineCount, maxLineRead } = this.ctx;
    const out: WorkerLine[] = [];
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

// Presents N member readers as ONE continuous, read-only log. Mirrors
// CompositeFileHandler.getLines: split the requested global window into per-file sub-ranges,
// delegate each to its member, and rebase the local line number into the global space.
export class CompositeWorkerReader implements LineReader {
  private space: CompositeLineSpace;
  constructor(private readers: LineReader[]) {
    this.space = new CompositeLineSpace(readers.map((r) => r.getTotalLines()));
  }
  getTotalLines(): number {
    return this.space.totalLines;
  }
  getLines(startLine: number, count: number): WorkerLine[] {
    const out: WorkerLine[] = [];
    for (const r of this.space.split(startLine, count)) {
      const base = this.space.members[r.fileIndex].startLine;
      for (const ln of this.readers[r.fileIndex].getLines(r.localStart, r.count)) {
        out.push({ ...ln, lineNumber: base + ln.lineNumber });
      }
    }
    return out;
  }
  close(): void {
    for (const r of this.readers) r.close();
  }
}
