import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Worker } from 'worker_threads';
import { FileInfo, LineData, SearchMatch, SearchOptions } from '../shared/types';
import { getRipgrepPath } from './ripgrepPath';
import { byteOffsetToLineIndex } from './byteOffset';
import { scanFileIndex, SplitMetadata, IndexResult } from './indexScan';
import {
  SeverityIndex, SeverityLevel, SeverityCounts, EMPTY_SEVERITY_INDEX, SEVERITY_RG_PATTERN,
  keywordRank, buildSeverityIndexFromMap, nextSeverityLine, severityCounts, severityTicks,
} from './severityIndex';

// Re-export so existing importers of SplitMetadata from this module keep working.
export type { SplitMetadata } from './indexScan';

// Default cap on matches collected by a single search. Callers (e.g. the
// search-config batch on a 24M-line file) can raise it via SearchOptions.maxMatches.
export const DEFAULT_MAX_MATCHES = 100000;

// Yield control to the event loop so Electron's UI stays responsive
const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

// Convert wildcard pattern to regex string: * = .*, ? = ., rest escaped
function wildcardToRegex(pattern: string): string {
  return pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
}

// Shared column filter utility — filters a line to only visible columns
export interface ColumnConfig {
  delimiter: string;
  columns: Array<{ index: number; visible: boolean }>;
}

// Canonical column splitter — the SINGLE source of truth used by both the
// column analyzer (analyze-columns) and every filter/search path. All three
// must split identically or the modal's column indices won't line up with what
// the filter actually hides. Semantics:
//   - space: collapse runs of whitespace, ignore leading/trailing padding so an
//            indented line has the same column indices as a non-indented one
//   - tab:   plain split (empty fields are significant)
//   - other: quote-aware (CSV-style) so a quoted field containing the delimiter
//            counts as one column, matching the analyzer's view
export function splitLineIntoColumns(line: string, delimiter: string): string[] {
  if (delimiter === ' ') {
    const trimmed = line.trim();
    return trimmed.length ? trimmed.split(/\s+/) : [];
  }
  if (delimiter === '\t') {
    return line.split('\t');
  }

  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // escaped quote inside a quoted field
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function filterLineToVisibleColumns(
  line: string,
  columnConfig: ColumnConfig | undefined
): string {
  if (!columnConfig) return line;
  if (!columnConfig.columns.some(c => !c.visible)) return line;

  const { delimiter, columns } = columnConfig;
  const parts = splitLineIntoColumns(line, delimiter);
  const visibleParts = parts.filter((_, idx) =>
    idx < columns.length ? columns[idx].visible : true
  );

  if (delimiter === ' ' || delimiter === '\t') {
    return visibleParts.join(delimiter);
  }
  // CSV-style: re-quote any surviving field that itself contains the delimiter
  // or a quote, so the rejoined line stays structurally valid.
  return visibleParts
    .map(p => (p.includes(delimiter) || p.includes('"')) ? `"${p.replace(/"/g, '""')}"` : p)
    .join(delimiter);
}

// Check if ripgrep is available
let ripgrepAvailable: boolean | null = null;
async function checkRipgrep(): Promise<boolean> {
  if (ripgrepAvailable !== null) return ripgrepAvailable;

  return new Promise((resolve) => {
    const proc = spawn(getRipgrepPath(), ['--version']);
    proc.on('error', () => {
      ripgrepAvailable = false;
      resolve(false);
    });
    proc.on('close', (code) => {
      ripgrepAvailable = code === 0;
      resolve(ripgrepAvailable);
    });
  });
}

export class FileHandler {
  private filePath: string | null = null;
  // Line index stored as two parallel typed arrays (offset + length per physical line)
  // instead of an array of objects — for a 24M-line file that removes ~24M object
  // allocations. `lineCount` is the number of valid entries; the arrays may have spare
  // capacity for incremental (live-tail) appends. Use lineOffsetAt()/lineLengthAt().
  private offsets: Float64Array = new Float64Array(0);
  private lengths: Float64Array = new Float64Array(0);
  private lineCount: number = 0;
  private fileInfo: FileInfo | null = null;
  private fd: number | null = null;
  private splitMetadata: SplitMetadata | null = null;
  private _maxLineLength: number = 0;
  private headerLineCount: number = 0; // Lines to skip (hidden header)
  private indexedSize: number = 0; // Bytes indexed so far (for incremental indexing)
  private indexedMtimeMs: number = 0; // mtime of the file when last indexed (for staleness checks)
  private _hasStandaloneCR: boolean = false; // Standalone \r found (not CRLF) — ripgrep can't handle these

  // Background severity index (fatal/error/warning line numbers) — see severityIndex.ts.
  // Built lazily on first request via one ripgrep pass; cached for the file's lifetime.
  private severityIndexCache: SeverityIndex | null = null;
  private severityIndexBuilding: Promise<SeverityIndex> | null = null;
  private static readonly SEVERITY_MAX_LINES = 5_000_000; // safety cap on indexed problem lines

  // Append one line to the index, growing the typed arrays (capacity doubling) when full.
  // Used by incremental live-tail indexing; the bulk initial index comes from scanFileIndex.
  private appendLine(offset: number, length: number): void {
    if (this.lineCount >= this.offsets.length) {
      const cap = Math.max(this.offsets.length * 2, 1024);
      const no = new Float64Array(cap); no.set(this.offsets.subarray(0, this.lineCount)); this.offsets = no;
      const nl = new Float64Array(cap); nl.set(this.lengths.subarray(0, this.lineCount)); this.lengths = nl;
    }
    this.offsets[this.lineCount] = offset;
    this.lengths[this.lineCount] = length;
    this.lineCount++;
    if (length > this._maxLineLength) this._maxLineLength = length;
  }

  async open(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<FileInfo> {
    this.close();
    this.filePath = filePath;
    this.splitMetadata = null;
    this.headerLineCount = 0;

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    this.indexedMtimeMs = stat.mtimeMs;

    // Build the line-offset index. Prefer a worker thread so the byte scan never
    // blocks the Electron UI on a big file; fall back to an inline scan when the
    // compiled worker isn't present (unit tests) or the worker fails.
    const result = await this.buildIndex(filePath, onProgress);

    this.offsets = result.offsets;
    this.lengths = result.lengths;
    this.lineCount = result.totalLines;
    this._maxLineLength = result.maxLineLength;
    this.headerLineCount = result.headerLineCount;
    this.splitMetadata = result.splitMetadata;
    this._hasStandaloneCR = result.hasStandaloneCR;

    // Adjust total lines to exclude hidden header
    const visibleLines = this.lineCount - this.headerLineCount;

    this.fileInfo = {
      path: filePath,
      size: fileSize,
      totalLines: visibleLines,
    };

    // Open file descriptor for random access
    this.fd = fs.openSync(filePath, 'r');
    this.indexedSize = fileSize;

    onProgress?.(100);
    return this.fileInfo;
  }

  /**
   * Open the file but index ONLY the byte window [startByte, endByte) — a line-aligned
   * SEGMENT of a larger file (the primitive behind auto-composite-large-files). The
   * recorded offsets are ABSOLUTE file coordinates, so reads go straight through the
   * whole-file fd; totalLines / returned lineNumbers are LOCAL to the segment (0-based),
   * which is exactly what CompositeFileHandler re-bases into the global line space.
   *
   * PRECONDITION: startByte and endByte MUST be physical line boundaries (a line's first
   * byte, or 0 / fileSize) — derive them with findLineStartAtOrAfter(). A mid-line cut
   * would mis-count the boundary lines. Segments are read-only slices: do NOT live-tail
   * one (indexNewLines is deliberately neutered below).
   *
   * Runs the scan inline (segments are budget-sized, so no worker needed).
   */
  async openSegment(
    filePath: string,
    startByte: number,
    endByte: number,
    onProgress?: (percent: number) => void
  ): Promise<FileInfo> {
    this.close();
    this.filePath = filePath;
    this.splitMetadata = null;
    this.headerLineCount = 0;

    const stat = fs.statSync(filePath);
    this.indexedMtimeMs = stat.mtimeMs;

    const result = scanFileIndex(filePath, onProgress, { startByte, endByte });

    this.offsets = result.offsets;
    this.lengths = result.lengths;
    this.lineCount = result.totalLines;
    this._maxLineLength = result.maxLineLength;
    // Only a segment that starts at byte 0 can carry the file's hidden #SPLIT header; a
    // mid-file segment (startByte > 0) never does, so it hides nothing.
    this.headerLineCount = startByte === 0 ? result.headerLineCount : 0;
    this.splitMetadata = startByte === 0 ? result.splitMetadata : null;
    this._hasStandaloneCR = result.hasStandaloneCR;

    this.fileInfo = {
      path: filePath,
      // This segment's own byte span — CompositeFileHandler.getFileInfo() sums member
      // sizes, so N segment spans add back up to the whole file size.
      size: Math.max(0, endByte - startByte),
      totalLines: this.lineCount - this.headerLineCount,
    };

    this.fd = fs.openSync(filePath, 'r');
    // A segment is a read-only slice, not a live-tail target. Marking it fully indexed to
    // the real file size makes any accidental indexNewLines() call a no-op (newSize <=
    // indexedSize) rather than appending the bytes that belong to the NEXT segment.
    this.indexedSize = stat.size;

    onProgress?.(100);
    return this.fileInfo;
  }

  // Run the index scan in a worker thread so the byte scan stays off the Electron
  // main thread. Falls back to an inline (synchronous) scan when the compiled worker
  // isn't present (e.g. unit tests) or the worker fails to spawn / errors — so opening
  // a file never depends on the worker being available.
  private buildIndex(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<IndexResult> {
    const workerPath = path.join(__dirname, 'indexWorker.js');
    if (!fs.existsSync(workerPath)) {
      return Promise.resolve(scanFileIndex(filePath, onProgress));
    }
    return new Promise<IndexResult>((resolve) => {
      let settled = false;
      const emptyIndex: IndexResult = {
        offsets: new Float64Array(0), lengths: new Float64Array(0), totalLines: 0,
        maxLineLength: 0, headerLineCount: 0, splitMetadata: null, hasStandaloneCR: false,
      };
      const fallback = (): void => {
        if (settled) return;
        settled = true;
        try { resolve(scanFileIndex(filePath, onProgress)); }
        catch { resolve(emptyIndex); }
      };

      let worker: Worker;
      try {
        worker = new Worker(workerPath, { workerData: { filePath } });
      } catch {
        fallback();
        return;
      }

      worker.on('message', (msg: any) => {
        if (settled) return;
        if (msg?.type === 'progress') {
          onProgress?.(msg.percent);
        } else if (msg?.type === 'done') {
          settled = true;
          worker.terminate();
          resolve({
            offsets: msg.offsets,
            lengths: msg.lengths,
            totalLines: msg.totalLines,
            maxLineLength: msg.maxLineLength,
            headerLineCount: msg.headerLineCount,
            splitMetadata: msg.splitMetadata,
            hasStandaloneCR: msg.hasStandaloneCR,
          });
        } else if (msg?.type === 'error') {
          worker.terminate();
          fallback();
        }
      });
      worker.on('error', () => { worker.terminate(); fallback(); });
      worker.on('exit', (code) => { if (code !== 0) fallback(); });
    });
  }

  /**
   * Incrementally index new bytes appended to an already-open file.
   * Returns the number of new lines found.
   */
  indexNewLines(): number {
    if (!this.filePath || !this.fd) return 0;

    const stat = fs.fstatSync(this.fd);
    const newSize = stat.size;
    if (newSize <= this.indexedSize) return 0;

    const chunkSize = 1024 * 1024; // 1MB chunks
    const buffer = Buffer.alloc(Math.min(chunkSize, newSize - this.indexedSize));
    let fileOffset = this.indexedSize;
    let lineStart = this.indexedSize;

    // If we have existing lines, the last one might have been unterminated.
    // Check if the last indexed line extends to indexedSize (no trailing newline).
    if (this.lineCount > 0) {
      const lastOffset = this.offsets[this.lineCount - 1];
      const lastLength = this.lengths[this.lineCount - 1];
      const lastLineEnd = lastOffset + lastLength;
      // If last line ended right at indexedSize, the file had no trailing newline.
      // New data continues that line until a newline is found.
      if (lastLineEnd >= this.indexedSize) {
        lineStart = lastOffset;
        // Remove last line — it will be re-parsed with new data appended
        this.lineCount--;
      }
    }

    let newLineCount = 0;

    while (fileOffset < newSize) {
      const toRead = Math.min(buffer.length, newSize - fileOffset);
      const bytesRead = fs.readSync(this.fd, buffer, 0, toRead, fileOffset);
      if (bytesRead === 0) break;

      for (let i = 0; i < bytesRead; i++) {
        const byte = buffer[i];
        const absPos = fileOffset + i;

        if (byte === 0x0A) { // LF
          let lineLength = absPos - lineStart;
          // Check for CRLF
          if (lineLength > 0 && i > 0 && buffer[i - 1] === 0x0D) {
            lineLength--;
          } else if (lineLength > 0 && i === 0 && this.indexedSize > 0) {
            // CR might be at end of previous chunk — check via lineOffsets
            // This edge case is minor; we accept the CR in the line
          }
          this.appendLine(lineStart, lineLength);
          newLineCount++;
          lineStart = absPos + 1;
        } else if (byte === 0x0D) { // CR
          // Look ahead for CRLF
          if (i + 1 < bytesRead) {
            if (buffer[i + 1] !== 0x0A) {
              // CR-only line ending
              const lineLength = absPos - lineStart;
              this.appendLine(lineStart, lineLength);
              newLineCount++;
              lineStart = absPos + 1;
            }
            // If next is LF, handled in LF case
          }
          // CR at end of buffer — will be handled in next iteration
        }
      }

      fileOffset += bytesRead;
    }

    // Handle last unterminated line
    if (lineStart < newSize) {
      const lineLength = newSize - lineStart;
      this.appendLine(lineStart, lineLength);
      newLineCount++;
    }

    this.indexedSize = newSize;

    // Update fileInfo
    if (this.fileInfo) {
      this.fileInfo.size = newSize;
      this.fileInfo.totalLines = this.lineCount - this.headerLineCount;
    }

    // New lines may carry new errors — drop the stale severity index so it
    // rebuilds on next request (live-tail correctness).
    if (newLineCount > 0) this.invalidateSeverityIndex();

    return newLineCount;
  }

  getSplitMetadata(): SplitMetadata | null {
    return this.splitMetadata;
  }

  getMaxLineLength(): number {
    return this._maxLineLength;
  }

  // Max characters to read per line — prevents OOM on files with extremely long lines
  private static readonly MAX_LINE_READ = 10000;

  // A whole viewport's worth of physically-contiguous lines is fetched in ONE
  // positioned read, then sliced in memory (instead of one syscall per line). Bail
  // to the per-line path when the byte span exceeds this ceiling so a run of
  // pathological megabyte-long lines can never force an enormous allocation.
  private static readonly MAX_BATCH_READ = 16 * 1024 * 1024; // 16 MB

  // Slice one physical line [i] out of a buffer that starts at file offset
  // `bufStartOffset`. Same MAX_LINE_READ cap / truncation marker / level as the
  // per-line path \u2014 this is the shared core of every read below.
  private lineFromBuffer(buffer: Buffer, bufStartOffset: number, i: number): LineData {
    const length = this.lengths[i];
    const readLength = Math.min(length, FileHandler.MAX_LINE_READ);
    const rel = this.offsets[i] - bufStartOffset;
    let text = (rel >= 0 && rel + readLength <= buffer.length)
      ? buffer.toString('utf-8', rel, rel + readLength)
      : '';
    if (length > FileHandler.MAX_LINE_READ) {
      text += ' \u2026 (truncated)';
    }
    return {
      lineNumber: i - this.headerLineCount, // visible line number (without header offset)
      text,
      level: this.detectLevel(text),
    };
  }

  // Byte span covering physical lines [start, end). end is exclusive.
  private spanOf(start: number, end: number): { startOffset: number; span: number } {
    const startOffset = this.offsets[start];
    const last = end - 1;
    const endOffset = this.offsets[last] + this.lengths[last];
    return { startOffset, span: endOffset - startOffset };
  }

  getLines(startLine: number, count: number): LineData[] {
    if (!this.fd || !this.filePath) return [];

    // Offset by header lines to skip hidden metadata
    const actualStart = startLine + this.headerLineCount;
    const actualEnd = Math.min(actualStart + count, this.lineCount);
    if (actualEnd <= actualStart) return [];

    // Fast path: slurp the whole contiguous range in ONE read, then slice.
    const { startOffset, span } = this.spanOf(actualStart, actualEnd);
    if (span > 0 && span <= FileHandler.MAX_BATCH_READ) {
      const buffer = Buffer.alloc(span);
      fs.readSync(this.fd, buffer, 0, span, startOffset);
      const lines: LineData[] = [];
      for (let i = actualStart; i < actualEnd; i++) lines.push(this.lineFromBuffer(buffer, startOffset, i));
      return lines;
    }

    // Fallback: per-line reads (huge-line files \u2014 never over-allocate).
    const lines: LineData[] = [];
    for (let i = actualStart; i < actualEnd; i++) {
      const readLength = Math.min(this.lengths[i], FileHandler.MAX_LINE_READ);
      const buffer = Buffer.alloc(readLength);
      fs.readSync(this.fd, buffer, 0, readLength, this.offsets[i]);
      lines.push(this.lineFromBuffer(buffer, this.offsets[i], i));
    }
    return lines;
  }

  // Async sibling of getLines(), used by the render-path IPC handlers. Reads each
  // line with an asynchronous positioned read so the Electron main thread YIELDS
  // between reads instead of blocking on fs.readSync. That matters while a search
  // is running: ripgrep's output is parsed on the main thread, so a burst of
  // synchronous getLines() calls (e.g. rendering a freshly-opened file) would
  // starve it — the pipe fills, rg blocks, and progress freezes. Yielding here
  // lets the search + its progress ticks keep flowing. Line-for-line identical to
  // getLines() otherwise (same MAX_LINE_READ cap, same truncation, same levels).
  async getLinesAsync(startLine: number, count: number): Promise<LineData[]> {
    if (!this.fd || !this.filePath) return [];
    const fd = this.fd;

    const actualStart = startLine + this.headerLineCount;
    const actualEnd = Math.min(actualStart + count, this.lineCount);
    if (actualEnd <= actualStart) return [];

    const { startOffset, span } = this.spanOf(actualStart, actualEnd);
    if (span > 0 && span <= FileHandler.MAX_BATCH_READ) {
      const buffer = Buffer.alloc(span);
      await new Promise<void>((resolve, reject) => {
        fs.read(fd, buffer, 0, span, startOffset, (err) => (err ? reject(err) : resolve()));
      });
      const lines: LineData[] = [];
      for (let i = actualStart; i < actualEnd; i++) lines.push(this.lineFromBuffer(buffer, startOffset, i));
      return lines;
    }

    // Fallback: per-line async reads for pathological huge-line ranges.
    const lines: LineData[] = [];
    for (let i = actualStart; i < actualEnd; i++) {
      const readLength = Math.min(this.lengths[i], FileHandler.MAX_LINE_READ);
      const buffer = Buffer.alloc(readLength);
      const offset = this.offsets[i];
      await new Promise<void>((resolve, reject) => {
        fs.read(fd, buffer, 0, readLength, offset, (err) => (err ? reject(err) : resolve()));
      });
      lines.push(this.lineFromBuffer(buffer, offset, i));
    }
    return lines;
  }

  // Fetch an arbitrary set of visible line numbers (e.g. a filtered viewport whose
  // lines aren't contiguous) with as few syscalls as possible: sort, group
  // physically-consecutive runs, and slurp each run in ONE read. Output preserves
  // the caller's original order. Replaces per-line getLinesAsync(n,1) loops.
  async getLinesByNumbers(lineNumbers: number[]): Promise<LineData[]> {
    if (!this.fd || !this.filePath || lineNumbers.length === 0) return [];
    const fd = this.fd;
    const items = lineNumbers
      .map((ln, pos) => ({ pos, phys: ln + this.headerLineCount }))
      .filter(it => it.phys >= 0 && it.phys < this.lineCount);
    const sorted = items.slice().sort((a, b) => a.phys - b.phys);
    const out: (LineData | undefined)[] = new Array(lineNumbers.length);

    let r = 0;
    while (r < sorted.length) {
      const runStart = r;
      while (r + 1 < sorted.length && sorted[r + 1].phys === sorted[r].phys + 1) r++;
      const firstPhys = sorted[runStart].phys;
      const lastPhys = sorted[r].phys;
      const { startOffset, span } = this.spanOf(firstPhys, lastPhys + 1);
      if (span > 0 && span <= FileHandler.MAX_BATCH_READ) {
        const buffer = Buffer.alloc(span);
        await new Promise<void>((resolve, reject) => {
          fs.read(fd, buffer, 0, span, startOffset, (err) => (err ? reject(err) : resolve()));
        });
        for (let k = runStart; k <= r; k++) out[sorted[k].pos] = this.lineFromBuffer(buffer, startOffset, sorted[k].phys);
      } else {
        // Pathological run of huge lines — read each individually.
        for (let k = runStart; k <= r; k++) {
          const phys = sorted[k].phys;
          const readLength = Math.min(this.lengths[phys], FileHandler.MAX_LINE_READ);
          const buffer = Buffer.alloc(readLength);
          await new Promise<void>((resolve, reject) => {
            fs.read(fd, buffer, 0, readLength, this.offsets[phys], (err) => (err ? reject(err) : resolve()));
          });
          out[sorted[k].pos] = this.lineFromBuffer(buffer, this.offsets[phys], phys);
        }
      }
      r++;
    }
    return out.filter((l): l is LineData => l != null);
  }

  private detectLevel(text: string): LineData['level'] {
    // Only check the first 200 chars — log levels appear near the start of a line.
    // This prevents OOM on files with extremely long lines (e.g. minified JSON).
    const sample = text.length > 200 ? text.substring(0, 200) : text;
    const upperText = sample.toUpperCase();

    // Check for common log level patterns (ordered by severity — most specific first)
    if (/\b(FATAL|PANIC|EMERGENCY|EMERG)\b/.test(upperText)) {
      return 'fatal';
    }
    if (/\b(ERROR|CRITICAL|CRIT|SEVERE|EXCEPTION)\b/.test(upperText)) {
      return 'error';
    }
    if (/\b(WARN|WARNING|NOTICE)\b/.test(upperText)) {
      return 'warning';
    }
    if (/\b(INFO|INFORMATION)\b/.test(upperText)) {
      return 'info';
    }
    if (/\b(DEBUG|DBG)\b/.test(upperText)) {
      return 'debug';
    }
    if (/\b(VERBOSE|VERB)\b/.test(upperText)) {
      return 'verbose';
    }
    if (/\b(TRACE)\b/.test(upperText)) {
      return 'trace';
    }

    return undefined;
  }

  // ── Severity index (background jump-to-problem) ────────────────────────────
  // Build (once, cached) the fatal/error/warning line index via a single ripgrep
  // pass. Concurrent callers share the in-flight promise.
  async buildSeverityIndex(signal?: { cancelled: boolean }): Promise<SeverityIndex> {
    if (this.severityIndexCache) return this.severityIndexCache;
    if (this.severityIndexBuilding) return this.severityIndexBuilding;
    this.severityIndexBuilding = this.runSeverityScan(signal)
      .then((idx) => { this.severityIndexCache = idx; this.severityIndexBuilding = null; return idx; })
      .catch(() => { this.severityIndexBuilding = null; return EMPTY_SEVERITY_INDEX; });
    return this.severityIndexBuilding;
  }

  private invalidateSeverityIndex(): void {
    this.severityIndexCache = null;
    this.severityIndexBuilding = null;
  }

  private runSeverityScan(signal?: { cancelled: boolean }): Promise<SeverityIndex> {
    const filePath = this.filePath;
    if (!filePath) return Promise.resolve(EMPTY_SEVERITY_INDEX);
    // CR-only files: ripgrep's line numbers don't match our indexer (same caveat as
    // search) — skip rather than return wrong jump targets.
    if (this._hasStandaloneCR) return Promise.resolve(EMPTY_SEVERITY_INDEX);

    return new Promise((resolve) => {
      const args = [
        '--line-number', '--no-heading', '--no-filename', '--only-matching', '--ignore-case',
        '--', SEVERITY_RG_PATTERN, filePath,
      ];
      let proc: ReturnType<typeof spawn>;
      try { proc = spawn(getRipgrepPath(), args); }
      catch { resolve(EMPTY_SEVERITY_INDEX); return; }

      const rankByLine = new Map<number, number>();
      let buffer = '';
      let capped = false;

      const parseLine = (line: string) => {
        if (!line || capped) return;
        const ci = line.indexOf(':');
        if (ci === -1) return;
        const rgLine = parseInt(line.substring(0, ci), 10);
        if (!Number.isFinite(rgLine)) return;
        const rank = keywordRank(line.substring(ci + 1));
        if (rank === 0) return;
        const visible = rgLine - 1 - this.headerLineCount; // rg is 1-based; strip hidden header
        if (visible < 0) return;
        const prev = rankByLine.get(visible) || 0;
        if (rank > prev) rankByLine.set(visible, rank);
        if (rankByLine.size >= FileHandler.SEVERITY_MAX_LINES) { capped = true; try { proc.kill(); } catch { /* ignore */ } }
      };

      proc.stdout?.on('data', (data: Buffer) => {
        if (signal?.cancelled) { try { proc.kill(); } catch { /* ignore */ } return; }
        buffer += data.toString();
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';
        for (const p of parts) parseLine(p);
      });
      proc.on('error', () => resolve(EMPTY_SEVERITY_INDEX));
      proc.on('close', () => {
        if (buffer) parseLine(buffer);
        resolve(buildSeverityIndexFromMap(rankByLine));
      });
    });
  }

  // Ensure the index is built, then return counts + a downsampled minimap tick
  // strip (highest rank 0..3 per bucket). `buckets` is the caller's tick resolution.
  async getSeverityInfo(buckets: number): Promise<{ counts: SeverityCounts; ticks: number[]; totalLines: number; capped: boolean }> {
    const idx = await this.buildSeverityIndex();
    const total = this.lineCount - this.headerLineCount;
    const counts = severityCounts(idx);
    const ticks = Array.from(severityTicks(idx, Math.max(0, Math.floor(buckets)), total));
    const capped = counts.fatal + counts.error + counts.warning >= FileHandler.SEVERITY_MAX_LINES;
    return { counts, ticks, totalLines: total, capped };
  }

  // Next (dir=1) / previous (dir=-1) problem line beyond `fromLine`, across the
  // requested levels. Returns null when there is none.
  async getNextSeverityLine(fromLine: number, dir: 1 | -1, levels: SeverityLevel[]): Promise<number | null> {
    const idx = await this.buildSeverityIndex();
    return nextSeverityLine(idx, fromLine, dir, levels);
  }

  // Which engine the last search() call used — surfaced in the IPC result so the UI
  // can show it (ripgrep = fast native scan; stream = the slow JS fallback).
  lastSearchEngine: 'ripgrep' | 'stream' | null = null;
  lastSearchReason: string | null = null;

  async search(
    options: SearchOptions,
    onProgress?: (percent: number, matchCount: number, deltaMatches?: SearchMatch[]) => void,
    signal?: { cancelled: boolean }
  ): Promise<SearchMatch[]> {
    if (!this.filePath) return [];

    // Pick the engine, remembering WHY, then time the run and log it — so "search is
    // slow" is diagnosable at a glance (esp. the CR-fallback, which silently drops the
    // fast ripgrep path for a whole-file JS scan on files with \r line endings).
    const hasColumnFilter = options.columnConfig &&
      options.columnConfig.columns.some(c => !c.visible);
    const rgAvailable = !hasColumnFilter && await checkRipgrep();

    // \r-line-ending files: ripgrep still SCANS correctly and its byte offsets are exact —
    // only its LINE NUMBERS are wrong (it treats \r as within-line). So instead of the slow
    // JS stream fallback, run ripgrep with --byte-offset and remap each hit to the right
    // logical line via our own \r-aware offset index. Full ripgrep speed, correct lines.
    let engine: 'ripgrep' | 'stream';
    let reason: string;
    let useByteOffset = false;
    if (hasColumnFilter) { engine = 'stream'; reason = 'column filter active (ripgrep can\'t hide columns)'; }
    else if (!rgAvailable) { engine = 'stream'; reason = 'ripgrep binary unavailable'; }
    else if (this._hasStandaloneCR) { engine = 'ripgrep'; reason = 'ok (\\r-aware byte-offset remap)'; useByteOffset = true; }
    else { engine = 'ripgrep'; reason = 'ok'; }
    this.lastSearchEngine = engine;
    this.lastSearchReason = reason;

    const t0 = Date.now();
    const result = engine === 'stream'
      ? await this.searchWithStream(options, onProgress, signal)
      : useByteOffset
        ? await this.searchWithRipgrepByteOffset(options, onProgress, signal)
        : await this.searchWithRipgrep(options, onProgress, signal);
    const ms = Date.now() - t0;

    const cap = options.maxMatches ?? DEFAULT_MAX_MATCHES;
    // eslint-disable-next-line no-console
    console.log(
      `[LOGAN search] engine=${engine} ms=${ms} matches=${result.length}${result.length >= cap ? `(capped@${cap})` : ''}` +
      ` scanned=${this.lineCount} pattern=${JSON.stringify(options.pattern)}` +
      (engine === 'stream' ? `  ← SLOW PATH: ${reason}` : ''),
    );
    return result;
  }

  // \r-aware ripgrep search. Ripgrep scans at native speed and, with --byte-offset
  // --only-matching, reports the exact BYTE offset of every match — which is correct even
  // on files it can't line-count (standalone \r). We remap each byte offset to the right
  // logical line via our own \r-aware index (byteOffsetToLineIndex over this.offsets), so
  // line numbers, column and the previewed line text are all correct. Only used when
  // _hasStandaloneCR — the whole reason search() used to fall back to the slow JS scan.
  private async searchWithRipgrepByteOffset(
    options: SearchOptions,
    onProgress?: (percent: number, matchCount: number, deltaMatches?: SearchMatch[]) => void,
    signal?: { cancelled: boolean }
  ): Promise<SearchMatch[]> {
    if (!this.filePath || this.fd === null) return [];

    const matches: SearchMatch[] = [];
    const MAX_MATCHES = options.maxMatches ?? DEFAULT_MAX_MATCHES;
    // Full logical-line preview costs one positioned read per match; bound it so a
    // match-dense pattern can't stall the main thread. Matches past the cap still return
    // (correct line + the matched text) — only their panel preview is the match, not the line.
    const LINE_TEXT_CAP = 5000;

    const useRegexMode = options.isRegex || options.isWildcard;
    let rgPattern = options.pattern;
    if (options.isWildcard) rgPattern = wildcardToRegex(options.pattern);

    const args: string[] = ['--only-matching', '--byte-offset', '--no-heading', '--no-filename'];
    if (!options.matchCase) args.push('--ignore-case');
    if (options.wholeWord) args.push('--word-regexp');
    if (!useRegexMode) args.push('--fixed-strings');
    // Deliberately NO --max-count: on a \r-only file the whole thing can be one \n-line,
    // so rg's per-LINE cap wouldn't bound the match COUNT. We cap ourselves and kill rg.
    args.push('--', rgPattern, this.filePath);

    const fd = this.fd;
    const lineBuf = Buffer.allocUnsafe(FileHandler.MAX_LINE_READ);
    let fileSize = 0;
    try { fileSize = fs.statSync(this.filePath).size; } catch { /* progress falls back to count */ }

    return new Promise((resolve) => {
      const proc = spawn(getRipgrepPath(), args);
      let buffer = '';
      let lastProgressUpdate = Date.now();
      let lastByteOffset = 0;
      let lastEmittedIndex = 0;
      const STREAM_MATCH_CAP = 2000;
      const STREAM_TEXT_MAX = 1000;
      const takeStreamDelta = (): SearchMatch[] | undefined => {
        if (lastEmittedIndex >= STREAM_MATCH_CAP) return undefined;
        const upto = Math.min(matches.length, STREAM_MATCH_CAP);
        if (upto <= lastEmittedIndex) return undefined;
        const slice = matches.slice(lastEmittedIndex, upto);
        lastEmittedIndex = upto;
        return slice.map(m => m.lineText.length > STREAM_TEXT_MAX
          ? { ...m, lineText: m.lineText.slice(0, STREAM_TEXT_MAX) } : m);
      };

      // Parse one rg -o -b output line ("<byteOffset>:<matchText>"). Returns false when the
      // caller should stop (match cap reached).
      const handleOutputLine = (out: string): boolean => {
        const ci = out.indexOf(':');
        if (ci === -1) return true;
        const byteOffset = parseInt(out.slice(0, ci), 10);
        if (!Number.isFinite(byteOffset)) return true;
        const matchText = out.slice(ci + 1);
        const lineIdx = byteOffsetToLineIndex(this.offsets, this.lineCount, byteOffset);
        const visibleLine = lineIdx - this.headerLineCount;
        if (visibleLine < 0) return true;
        lastByteOffset = byteOffset;

        const lineStart = this.offsets[lineIdx];
        let lineText = matchText;
        let column = Math.max(0, byteOffset - lineStart); // byte column fallback
        if (matches.length < LINE_TEXT_CAP) {
          try {
            const readLen = Math.min(this.lengths[lineIdx], FileHandler.MAX_LINE_READ);
            const n = fs.readSync(fd, lineBuf, 0, readLen, lineStart);
            lineText = lineBuf.toString('utf8', 0, n);
            const byteInLine = Math.max(0, Math.min(n, byteOffset - lineStart));
            column = lineBuf.toString('utf8', 0, byteInLine).length; // exact char column
            if (this.lengths[lineIdx] > FileHandler.MAX_LINE_READ) lineText += ' … (truncated)';
          } catch { /* keep matchText + byte column */ }
        }
        matches.push({ lineNumber: visibleLine, column, length: matchText.length, lineText });
        return matches.length < MAX_MATCHES;
      };

      proc.stdout.on('data', (data: Buffer) => {
        if (signal?.cancelled) { try { proc.kill(); } catch { /* ignore */ } return; }
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const out of lines) {
          if (!out) continue;
          if (!handleOutputLine(out)) { try { proc.kill(); } catch { /* ignore */ } break; }
        }
        const now = Date.now();
        if (onProgress && now - lastProgressUpdate > 100) {
          lastProgressUpdate = now;
          const pct = fileSize > 0 ? Math.min(99, (lastByteOffset / fileSize) * 100) : Math.min(90, matches.length / 100);
          onProgress(pct, matches.length, takeStreamDelta());
        }
      });
      proc.on('error', () => resolve(matches));
      proc.on('close', () => {
        if (buffer) handleOutputLine(buffer);
        onProgress?.(100, matches.length, takeStreamDelta());
        resolve(matches);
      });

      if (signal) {
        const checkCancel = setInterval(() => {
          if (signal.cancelled) { try { proc.kill(); } catch { /* ignore */ } clearInterval(checkCancel); }
        }, 100);
        proc.on('close', () => clearInterval(checkCancel));
      }
    });
  }

  // NOTE: searchWithRipgrep does NOT support column filtering.
  // It searches raw file text. When columns are hidden, the caller (search())
  // must route to searchWithStream() instead, which applies column filtering.
  private async searchWithRipgrep(
    options: SearchOptions,
    onProgress?: (percent: number, matchCount: number, deltaMatches?: SearchMatch[]) => void,
    signal?: { cancelled: boolean }
  ): Promise<SearchMatch[]> {
    if (!this.filePath) return [];

    // Defensive: refuse to run if column filtering is active
    if (options.columnConfig && options.columnConfig.columns.some(c => !c.visible)) {
      return this.searchWithStream(options, onProgress, signal);
    }

    const matches: SearchMatch[] = [];
    const MAX_MATCHES = options.maxMatches ?? DEFAULT_MAX_MATCHES;

    // Determine the effective regex pattern and whether ripgrep should use regex mode
    const useRegexMode = options.isRegex || options.isWildcard;
    let rgPattern = options.pattern;
    if (options.isWildcard) {
      rgPattern = wildcardToRegex(options.pattern);
    }

    // Pre-compile regex for determining actual match length (ripgrep doesn't report it)
    let searchRegex: RegExp | null = null;
    if (useRegexMode) {
      try {
        const flags = options.matchCase ? '' : 'i';
        searchRegex = new RegExp(rgPattern, flags);
      } catch {
        // Invalid regex - ripgrep will also fail, return empty
        return [];
      }
    }

    // Build ripgrep arguments
    const args: string[] = [
      '--line-number',
      '--column',
      '--no-heading',
      '--no-filename',
    ];

    if (!options.matchCase) {
      args.push('--ignore-case');
    }

    if (options.wholeWord) {
      args.push('--word-regexp');
    }

    if (!useRegexMode) {
      args.push('--fixed-strings');
    }

    // Limit matches
    args.push('--max-count', String(MAX_MATCHES));

    // Add pattern and file
    args.push('--', rgPattern, this.filePath);

    return new Promise((resolve) => {
      const proc = spawn(getRipgrepPath(), args);
      let buffer = '';
      let lastProgressUpdate = Date.now();
      // Index of the first match not yet handed to onProgress. Lets us stream only
      // the NEW matches since the last tick so the UI can populate results live
      // instead of waiting for the whole search to finish.
      let lastEmittedIndex = 0;
      // Real scan progress from the last match's byte offset (rg scans sequentially and
      // we own the per-line offset index) — replaces the fake matches/100 estimate.
      // Stays 0 for zero-match scans (the renderer's elapsed heartbeat covers that case).
      let lastMatchAbsLine = 0;
      let fileSize = 0;
      try { fileSize = fs.statSync(this.filePath!).size; } catch { /* fall back to estimate */ }
      // Stream full match objects only for the first STREAM_MATCH_CAP matches (a user
      // can only interact with a few screenfuls anyway); past that emit counts only.
      // Truncate streamed line text — the UI truncates at 300 chars and the authoritative
      // untruncated set still arrives at the end. Prevents a match-dense pattern from
      // flooding IPC with tens of MB per tick (which made streaming slower than the old
      // return-at-end path).
      const STREAM_MATCH_CAP = 2000;
      const STREAM_TEXT_MAX = 1000;
      const takeStreamDelta = (): SearchMatch[] | undefined => {
        if (lastEmittedIndex >= STREAM_MATCH_CAP) return undefined;
        const upto = Math.min(matches.length, STREAM_MATCH_CAP);
        if (upto <= lastEmittedIndex) return undefined;
        const slice = matches.slice(lastEmittedIndex, upto);
        lastEmittedIndex = upto;
        return slice.map(m => m.lineText.length > STREAM_TEXT_MAX
          ? { ...m, lineText: m.lineText.slice(0, STREAM_TEXT_MAX) }
          : m);
      };

      proc.stdout.on('data', (data: Buffer) => {
        if (signal?.cancelled) {
          proc.kill();
          return;
        }

        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line) continue;

          // Parse ripgrep output (--no-filename): linenum:column:text
          const colonIndex1 = line.indexOf(':');
          if (colonIndex1 === -1) continue;

          const colonIndex2 = line.indexOf(':', colonIndex1 + 1);
          if (colonIndex2 === -1) continue;

          const lineNum = parseInt(line.substring(0, colonIndex1), 10);
          const column = parseInt(line.substring(colonIndex1 + 1, colonIndex2), 10);
          const lineText = line.substring(colonIndex2 + 1);

          // Adjust for header offset
          const adjustedLineNum = lineNum - 1 - this.headerLineCount;
          if (adjustedLineNum < 0) continue;

          // For regex patterns, determine actual match length from the line text
          let matchLength = options.pattern.length;
          if (searchRegex) {
            const textFromMatch = lineText.substring(column - 1);
            const reMatch = searchRegex.exec(textFromMatch);
            if (reMatch && reMatch.index === 0) {
              matchLength = reMatch[0].length;
            }
          }

          lastMatchAbsLine = lineNum - 1; // absolute 0-based line (incl. header) for offset lookup
          matches.push({
            lineNumber: adjustedLineNum,
            column: column - 1, // ripgrep uses 1-based columns
            length: matchLength,
            lineText,
          });

          if (matches.length >= MAX_MATCHES) {
            proc.kill();
            break;
          }
        }

        // Throttle progress updates
        const now = Date.now();
        if (onProgress && now - lastProgressUpdate > 100) {
          lastProgressUpdate = now;
          // Real % from the last match's byte offset; fall back to the old estimate if
          // we somehow lack file size / offsets.
          const pct = fileSize > 0 && lastMatchAbsLine < this.offsets.length
            ? Math.min(99, (this.offsets[lastMatchAbsLine] / fileSize) * 100)
            : Math.min(90, matches.length / 100);
          onProgress(pct, matches.length, takeStreamDelta());
        }
      });

      proc.on('error', () => {
        // Ripgrep failed, resolve with what we have
        resolve(matches);
      });

      proc.on('close', () => {
        // Flush any matches found since the last throttled tick (capped/truncated).
        onProgress?.(100, matches.length, takeStreamDelta());
        resolve(matches);
      });

      // Handle cancellation
      if (signal) {
        const checkCancel = setInterval(() => {
          if (signal.cancelled) {
            proc.kill();
            clearInterval(checkCancel);
          }
        }, 100);

        proc.on('close', () => clearInterval(checkCancel));
      }
    });
  }

  // Search MANY configs in ONE ripgrep pass instead of N concurrent full-file scans.
  //
  // Running one rg process per config (via Promise.all) looks parallel but isn't free:
  // a single rg already saturates disk + all cores, so N of them just contend and the
  // file gets read N times. Here we union every config's pattern into a single rg
  // invocation (multiple `-e` branches = OR), read the file ONCE, then attribute each
  // matching line back to the individual configs in JS. On a huge file this is roughly
  // an N× win over the per-config batch.
  //
  // Per-config options are folded into each branch so a single rg run stays correct:
  //   - literal (isRegex=false) -> regex-escaped
  //   - wholeWord               -> wrapped in \b(?:…)\b
  //   - !matchCase              -> wrapped in (?i:…)  (rg itself runs case-sensitive)
  // Invalid patterns are skipped (left with empty results) so one bad config can't make
  // the whole union pattern fail. CR-only files / missing ripgrep fall back to the
  // per-config stream path, which handles those correctly.
  async searchMulti(
    configs: Array<{ id: string; pattern: string; isRegex: boolean; matchCase: boolean; wholeWord: boolean }>,
    onProgress?: (counts: Record<string, number>, overallPercent: number) => void,
    signal?: { cancelled: boolean },
    onMatches?: (deltaByConfig: Record<string, SearchMatch[]>) => void,
    maxMatchesPerConfig: number = DEFAULT_MAX_MATCHES
  ): Promise<Record<string, SearchMatch[]>> {
    const results: Record<string, SearchMatch[]> = {};
    for (const c of configs) results[c.id] = [];
    if (!this.filePath || configs.length === 0) return results;

    // Normalize each config into (a) a JS regex used to attribute + measure the match
    // per line, and (b) an rg branch string. Keep them in lock-step so the union pass
    // and the attribution agree exactly.
    const active: Array<{ id: string; attrRe: RegExp; branch: string }> = [];
    for (const cfg of configs) {
      if (!cfg.pattern) continue;
      let src = cfg.pattern;
      if (!cfg.isRegex) {
        src = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      if (cfg.wholeWord) {
        src = `\\b(?:${src})\\b`;
      }
      let attrRe: RegExp;
      try {
        attrRe = new RegExp(src, cfg.matchCase ? '' : 'i');
      } catch {
        continue; // invalid regex -> leave this config's results empty
      }
      const branch = cfg.matchCase ? src : `(?i:${src})`;
      active.push({ id: cfg.id, attrRe, branch });
    }
    if (active.length === 0) return results;

    // CR-only files and machines without bundled ripgrep can't use the union pass —
    // fall back to the original per-config search (parallel), which is still correct.
    const hasRipgrep = await checkRipgrep();
    if (this._hasStandaloneCR || !hasRipgrep) {
      await Promise.all(configs.map(async (cfg) => {
        results[cfg.id] = await this.search(
          {
            pattern: cfg.pattern,
            isRegex: cfg.isRegex,
            isWildcard: false,
            matchCase: cfg.matchCase,
            wholeWord: cfg.wholeWord,
            maxMatches: maxMatchesPerConfig,
          },
          undefined,
          signal
        );
        const counts: Record<string, number> = {};
        for (const c of configs) counts[c.id] = results[c.id]?.length ?? 0;
        onProgress?.(counts, 100);
      }));
      return results;
    }

    // Single rg pass over the union of every branch. One file read for all configs.
    const unionCap = Math.min(maxMatchesPerConfig * active.length, 500000);
    const args: string[] = [
      '--line-number',
      '--column',
      '--no-heading',
      '--no-filename',
      '--max-count',
      String(unionCap),
    ];
    for (const a of active) {
      args.push('-e', a.branch);
    }
    args.push('--', this.filePath);

    return new Promise((resolve) => {
      const proc = spawn(getRipgrepPath(), args);
      let buffer = '';
      let unionCount = 0;
      let lastProgressUpdate = Date.now();
      const counts: Record<string, number> = {};
      for (const a of active) counts[a.id] = 0;

      // Per-config buffer of matches found since the last stream flush. Flushed via
      // onMatches every ~150ms so the renderer can paint progressively; drained fully
      // on close so nothing found in the final window is lost.
      const pending: Record<string, SearchMatch[]> = {};
      for (const a of active) pending[a.id] = [];
      let lastMatchFlush = Date.now();
      const flushMatches = () => {
        if (!onMatches) return;
        const delta: Record<string, SearchMatch[]> = {};
        let has = false;
        for (const a of active) {
          if (pending[a.id].length > 0) {
            delta[a.id] = pending[a.id];
            pending[a.id] = [];
            has = true;
          }
        }
        if (has) onMatches(delta);
      };

      proc.stdout.on('data', (data: Buffer) => {
        if (signal?.cancelled) {
          proc.kill();
          return;
        }

        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) continue;

          // rg (--no-filename --column): linenum:column:text — we re-derive the column
          // per config, so only linenum and the text are needed here.
          const colonIndex1 = line.indexOf(':');
          if (colonIndex1 === -1) continue;
          const colonIndex2 = line.indexOf(':', colonIndex1 + 1);
          if (colonIndex2 === -1) continue;

          const lineNum = parseInt(line.substring(0, colonIndex1), 10);
          const lineText = line.substring(colonIndex2 + 1);
          const adjustedLineNum = lineNum - 1 - this.headerLineCount;
          if (adjustedLineNum < 0) continue;

          unionCount++;

          // Attribute this line to every config whose own pattern matches it, and record
          // that config's first-match column/length (not the union's leftmost match).
          for (const a of active) {
            if (results[a.id].length >= maxMatchesPerConfig) continue;
            const m = a.attrRe.exec(lineText);
            if (m) {
              const match: SearchMatch = {
                lineNumber: adjustedLineNum,
                column: m.index,
                length: m[0].length,
                lineText,
              };
              results[a.id].push(match);
              pending[a.id].push(match);
              counts[a.id]++;
            }
          }
        }

        const now = Date.now();
        if (onProgress && now - lastProgressUpdate > 100) {
          lastProgressUpdate = now;
          onProgress({ ...counts }, Math.min(90, unionCount / 100));
        }
        if (onMatches && now - lastMatchFlush > 150) {
          lastMatchFlush = now;
          flushMatches();
        }
      });

      proc.on('error', () => {
        flushMatches();
        onProgress?.({ ...counts }, 100);
        resolve(results);
      });

      proc.on('close', () => {
        flushMatches();
        onProgress?.({ ...counts }, 100);
        resolve(results);
      });

      if (signal) {
        const checkCancel = setInterval(() => {
          if (signal.cancelled) {
            proc.kill();
            clearInterval(checkCancel);
          }
        }, 100);
        proc.on('close', () => clearInterval(checkCancel));
      }
    });
  }

  // Helper to filter line to visible columns (delegates to shared utility)
  private filterLineToVisibleColumns(
    line: string,
    columnConfig: SearchOptions['columnConfig']
  ): string {
    return filterLineToVisibleColumns(line, columnConfig);
  }

  private async searchWithStream(
    options: SearchOptions,
    onProgress?: (percent: number, matchCount: number, deltaMatches?: SearchMatch[]) => void,
    signal?: { cancelled: boolean }
  ): Promise<SearchMatch[]> {
    if (!this.filePath) return [];

    const matches: SearchMatch[] = [];
    const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
    let regex: RegExp;

    try {
      const flags = options.matchCase ? 'g' : 'gi';
      if (options.isRegex) {
        regex = new RegExp(options.pattern, flags);
      } else if (options.isWildcard) {
        let converted = wildcardToRegex(options.pattern);
        if (options.wholeWord) {
          converted = `\\b${converted}\\b`;
        }
        regex = new RegExp(converted, flags);
      } else {
        let escaped = options.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (options.wholeWord) {
          escaped = `\\b${escaped}\\b`;
        }
        regex = new RegExp(escaped, flags);
      }
    } catch {
      return [];
    }

    const stat = fs.statSync(this.filePath);
    const fileSize = stat.size;
    let bytesRead = 0;
    let lineNumber = 0;
    let lastProgressUpdate = Date.now();

    // Use chunked reading instead of readline to prevent OOM on files with
    // extremely long lines. Cap at 10K chars for search (need more context than analyzers).
    const MAX_SEARCH_LINE = 10000;
    const CHUNK_SIZE = 1024 * 1024; // 1MB
    const readBuffer = Buffer.alloc(CHUNK_SIZE);
    const searchFd = fs.openSync(this.filePath, 'r');
    let lineBuffer = '';
    let lineBufferFull = false;
    let done = false;
    let lastCharWasCR = false; // Track \r across chunk boundaries for CRLF detection

    const processSearchLine = (line: string): void => {
      // Skip header lines
      if (lineNumber < this.headerLineCount) {
        lineNumber++;
        return;
      }

      const visibleLineNum = lineNumber - this.headerLineCount;

      // Filter to visible columns if column config is provided
      const searchText = this.filterLineToVisibleColumns(line, options.columnConfig);

      let match;
      regex.lastIndex = 0;

      while ((match = regex.exec(searchText)) !== null) {
        matches.push({
          lineNumber: visibleLineNum,
          column: match.index,
          length: match[0].length,
          lineText: searchText,
        });

        if (matches.length >= maxMatches) {
          done = true;
          return;
        }
      }

      lineNumber++;

      // Throttle progress updates
      const now = Date.now();
      if (onProgress && now - lastProgressUpdate > 100) {
        lastProgressUpdate = now;
        const progress = Math.round((bytesRead / fileSize) * 100);
        onProgress(Math.min(progress, 99), matches.length);
      }
    };

    try {
      let filePos = 0;
      while (filePos < fileSize && !done) {
        if (signal?.cancelled) break;

        const bytesReadChunk = fs.readSync(searchFd, readBuffer, 0, CHUNK_SIZE, filePos);
        if (bytesReadChunk === 0) break;
        filePos += bytesReadChunk;

        const chunk = readBuffer.toString('utf-8', 0, bytesReadChunk);

        for (let i = 0; i < chunk.length && !done; i++) {
          const ch = chunk[i];
          if (ch === '\n' && lastCharWasCR) {
            // Second half of CRLF that spanned a chunk boundary — skip it
            lastCharWasCR = false;
            continue;
          }
          lastCharWasCR = false;
          if (ch === '\n' || ch === '\r') {
            bytesRead += lineBuffer.length + 1;
            processSearchLine(lineBuffer);
            lineBuffer = '';
            lineBufferFull = false;
            if (ch === '\r') {
              if (i + 1 < chunk.length && chunk[i + 1] === '\n') {
                i++; // Skip LF of CRLF within same chunk
              } else if (i + 1 === chunk.length) {
                lastCharWasCR = true; // CR at chunk boundary — check next chunk
              }
            }
          } else if (!lineBufferFull) {
            lineBuffer += ch;
            if (lineBuffer.length >= MAX_SEARCH_LINE) {
              lineBufferFull = true;
            }
          }
        }

        // Yield to event loop every chunk so UI stays responsive
        if (filePos < fileSize && !done) {
          await yieldToEventLoop();
        }
      }

      if (lineBuffer.length > 0 && !done) {
        bytesRead += lineBuffer.length + 1;
        processSearchLine(lineBuffer);
      }
    } finally {
      fs.closeSync(searchFd);
    }

    onProgress?.(100, matches.length);
    return matches;
  }

  getFileInfo(): FileInfo | null {
    return this.fileInfo;
  }

  /**
   * Has the file on disk changed since it was indexed? Compares current size and
   * mtime against what was captured at index time. Used to invalidate the cached
   * handler when a file (e.g. a markdown doc) is edited and re-opened, so we don't
   * serve stale content. Returns true if the file is gone or unreadable too.
   */
  isStale(): boolean {
    if (!this.filePath) return false;
    try {
      const stat = fs.statSync(this.filePath);
      return stat.size !== this.indexedSize || stat.mtimeMs !== this.indexedMtimeMs;
    } catch {
      return true;
    }
  }

  getTotalLines(): number {
    return this.lineCount - this.headerLineCount;
  }

  // Byte-offset index for a worker thread to read the same file independently (its
  // own fd) without sharing this handler. The index is built ONCE into SharedArrayBuffers
  // and cached, so repeated trend/signal scans (discover, then each signal toggle) don't
  // re-copy a multi-million-entry array on the main process every call. Because the buffers
  // are SHARED (not transferred/cloned), passing them to the worker is O(1) — the per-call
  // main-thread cost that made the panel slow to open and clicks feel laggy is gone.
  private scanIndexCache: { len: number; offsets: Float64Array; lengths: Float64Array } | null = null;

  getScanContext(): { filePath: string; headerLineCount: number; maxLineRead: number; offsets: Float64Array; lengths: Float64Array } | null {
    if (!this.filePath) return null;
    const n = this.lineCount;
    // Rebuild only when the line count changes (e.g. live-tail append); otherwise reuse.
    // The worker needs SharedArrayBuffer-backed views (zero-copy hand-off), so copy the
    // exact-length prefix of our (possibly over-allocated) index arrays into shared memory.
    if (!this.scanIndexCache || this.scanIndexCache.len !== n) {
      const offsets = new Float64Array(new SharedArrayBuffer(n * Float64Array.BYTES_PER_ELEMENT));
      const lengths = new Float64Array(new SharedArrayBuffer(n * Float64Array.BYTES_PER_ELEMENT));
      offsets.set(this.offsets.subarray(0, n));
      lengths.set(this.lengths.subarray(0, n));
      this.scanIndexCache = { len: n, offsets, lengths };
    }
    const c = this.scanIndexCache;
    return { filePath: this.filePath, headerLineCount: this.headerLineCount, maxLineRead: FileHandler.MAX_LINE_READ, offsets: c.offsets, lengths: c.lengths };
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    this.filePath = null;
    this.offsets = new Float64Array(0);
    this.lengths = new Float64Array(0);
    this.lineCount = 0;
    this.scanIndexCache = null;
    this.fileInfo = null;
    this.splitMetadata = null;
    this.headerLineCount = 0;
    this.indexedSize = 0;
    this.indexedMtimeMs = 0;
    this._hasStandaloneCR = false;
    this.invalidateSeverityIndex();
  }
}
