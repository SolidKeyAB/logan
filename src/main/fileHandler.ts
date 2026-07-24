import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Worker } from 'worker_threads';
import { FileInfo, LineData, SearchMatch, SearchOptions } from '../shared/types';
import { getRipgrepPath } from './ripgrepPath';
import { scanFileIndex, SplitMetadata, IndexResult } from './indexScan';

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

export function filterLineToVisibleColumns(
  line: string,
  columnConfig: ColumnConfig | undefined
): string {
  if (!columnConfig) return line;
  if (!columnConfig.columns.some(c => !c.visible)) return line;

  const { delimiter, columns } = columnConfig;
  const parts = delimiter === ' ' ? line.split(/\s+/) : line.split(delimiter);
  const visibleParts = parts.filter((_, idx) =>
    idx < columns.length ? columns[idx].visible : true
  );
  return visibleParts.join(delimiter === ' ' ? ' ' : delimiter);
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

  getLines(startLine: number, count: number): LineData[] {
    if (!this.fd || !this.filePath) return [];

    const lines: LineData[] = [];
    // Offset by header lines to skip hidden metadata
    const actualStart = startLine + this.headerLineCount;
    const actualEnd = Math.min(actualStart + count, this.lineCount);

    for (let i = actualStart; i < actualEnd; i++) {
      const offset = this.offsets[i];
      const length = this.lengths[i];
      // Cap read size to prevent OOM on lines with millions of characters
      const readLength = Math.min(length, FileHandler.MAX_LINE_READ);
      const buffer = Buffer.alloc(readLength);
      fs.readSync(this.fd, buffer, 0, readLength, offset);
      let text = buffer.toString('utf-8');
      if (length > FileHandler.MAX_LINE_READ) {
        text += ' \u2026 (truncated)';
      }
      lines.push({
        // Return visible line number (without header offset)
        lineNumber: i - this.headerLineCount,
        text,
        level: this.detectLevel(text),
      });
    }

    return lines;
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

  async search(
    options: SearchOptions,
    onProgress?: (percent: number, matchCount: number) => void,
    signal?: { cancelled: boolean }
  ): Promise<SearchMatch[]> {
    if (!this.filePath) return [];

    // If column filtering is active, use stream search for accurate results
    const hasColumnFilter = options.columnConfig &&
      options.columnConfig.columns.some(c => !c.visible);

    if (hasColumnFilter) {
      // Stream search handles column filtering properly
      return this.searchWithStream(options, onProgress, signal);
    }

    // Ripgrep doesn't recognize standalone \r as a line break, so line numbers
    // would be wrong for files that use CR-only line endings (old Mac, serial logs,
    // progress output). Fall back to stream search which matches our indexer.
    if (this._hasStandaloneCR) {
      return this.searchWithStream(options, onProgress, signal);
    }

    // Try ripgrep first for much faster search
    const hasRipgrep = await checkRipgrep();
    if (hasRipgrep) {
      return this.searchWithRipgrep(options, onProgress, signal);
    }

    // Fall back to stream-based search
    return this.searchWithStream(options, onProgress, signal);
  }

  // NOTE: searchWithRipgrep does NOT support column filtering.
  // It searches raw file text. When columns are hidden, the caller (search())
  // must route to searchWithStream() instead, which applies column filtering.
  private async searchWithRipgrep(
    options: SearchOptions,
    onProgress?: (percent: number, matchCount: number) => void,
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
          // Estimate progress based on matches (ripgrep doesn't report %)
          onProgress(Math.min(90, matches.length / 100), matches.length);
        }
      });

      proc.on('error', () => {
        // Ripgrep failed, resolve with what we have
        resolve(matches);
      });

      proc.on('close', () => {
        onProgress?.(100, matches.length);
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
              results[a.id].push({
                lineNumber: adjustedLineNum,
                column: m.index,
                length: m[0].length,
                lineText,
              });
              counts[a.id]++;
            }
          }
        }

        const now = Date.now();
        if (onProgress && now - lastProgressUpdate > 100) {
          lastProgressUpdate = now;
          onProgress({ ...counts }, Math.min(90, unionCount / 100));
        }
      });

      proc.on('error', () => {
        onProgress?.({ ...counts }, 100);
        resolve(results);
      });

      proc.on('close', () => {
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
    onProgress?: (percent: number, matchCount: number) => void,
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
  }
}
