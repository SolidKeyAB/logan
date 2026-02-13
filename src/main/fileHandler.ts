import * as fs from 'fs';
import { spawn } from 'child_process';
import { FileInfo, LineData, SearchMatch, SearchOptions } from '../shared/types';

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
    const proc = spawn('rg', ['--version']);
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

interface LineOffset {
  offset: number;
  length: number;
}

export interface SplitMetadata {
  part: number;
  total: number;
  prev: string;
  next: string;
}

export class FileHandler {
  private filePath: string | null = null;
  private lineOffsets: LineOffset[] = [];
  private fileInfo: FileInfo | null = null;
  private fd: number | null = null;
  private splitMetadata: SplitMetadata | null = null;
  private _maxLineLength: number = 0;
  private headerLineCount: number = 0; // Lines to skip (hidden header)
  private indexedSize: number = 0; // Bytes indexed so far (for incremental indexing)

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

    // Index all line offsets - handle any line ending format (LF, CRLF, CR, mixed)
    this.lineOffsets = [];
    let lineNumber = 0;
    let firstLine = true;

    // Read file in chunks to find line boundaries and compute exact offsets
    const fd = fs.openSync(filePath, 'r');
    const chunkSize = 1024 * 1024; // 1MB chunks
    const buffer = Buffer.alloc(chunkSize);
    let fileOffset = 0;
    let lineStart = 0;
    let leftover = Buffer.alloc(0);

    try {
      while (fileOffset < fileSize) {
        const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, fileOffset);
        if (bytesRead === 0) break;

        // Combine leftover from previous chunk with current chunk
        const chunk = Buffer.concat([leftover, buffer.slice(0, bytesRead)]);
        let chunkPos = 0;
        const effectiveOffset = fileOffset - leftover.length;

        while (chunkPos < chunk.length) {
          const byte = chunk[chunkPos];

          if (byte === 0x0A) { // LF
            // End of line (LF or end of CRLF)
            const lineEnd = effectiveOffset + chunkPos;
            const lineLength = lineEnd - lineStart;

            // Check for CRLF - exclude CR from line content
            let actualLength = lineLength;
            if (lineLength > 0 && chunkPos > 0 && chunk[chunkPos - 1] === 0x0D) {
              actualLength = lineLength - 1;
            } else if (lineLength > 0 && this.lineOffsets.length > 0) {
              // CR might be at end of previous chunk - check the stored length
              // This is handled by reading the actual bytes when needed
            }

            this.lineOffsets.push({ offset: lineStart, length: actualLength });
            if (actualLength > this._maxLineLength) this._maxLineLength = actualLength;

            // Check first line for split header
            if (firstLine) {
              firstLine = false;
              const lineBuffer = Buffer.alloc(Math.min(actualLength, 500));
              fs.readSync(fd, lineBuffer, 0, lineBuffer.length, lineStart);
              const lineText = lineBuffer.toString('utf-8');
              const splitInfo = this.parseSplitHeader(lineText);
              if (splitInfo) {
                this.splitMetadata = splitInfo;
                this.headerLineCount = 1;
              }
            }

            lineNumber++;
            lineStart = lineEnd + 1; // Move past LF

            if (lineNumber % 100000 === 0 && onProgress) {
              onProgress(Math.min(99, Math.round((lineStart / fileSize) * 100)));
            }
          } else if (byte === 0x0D) { // CR
            // Could be CR-only (old Mac) or start of CRLF
            // Look ahead to see if next byte is LF
            if (chunkPos + 1 < chunk.length) {
              if (chunk[chunkPos + 1] !== 0x0A) {
                // CR-only line ending (old Mac format)
                const lineEnd = effectiveOffset + chunkPos;
                const lineLength = lineEnd - lineStart;
                this.lineOffsets.push({ offset: lineStart, length: lineLength });
                if (lineLength > this._maxLineLength) this._maxLineLength = lineLength;

                if (firstLine) {
                  firstLine = false;
                  const lineBuffer = Buffer.alloc(Math.min(lineLength, 500));
                  fs.readSync(fd, lineBuffer, 0, lineBuffer.length, lineStart);
                  const lineText = lineBuffer.toString('utf-8');
                  const splitInfo = this.parseSplitHeader(lineText);
                  if (splitInfo) {
                    this.splitMetadata = splitInfo;
                    this.headerLineCount = 1;
                  }
                }

                lineNumber++;
                lineStart = lineEnd + 1; // Move past CR
              }
              // If next is LF, we'll handle it in the LF case
            }
            // If CR is at end of chunk, we'll handle it in the next iteration
          }
          chunkPos++;
        }

        // Keep any partial line for next chunk
        if (lineStart < effectiveOffset + chunk.length) {
          leftover = chunk.slice(lineStart - effectiveOffset);
        } else {
          leftover = Buffer.alloc(0);
        }

        fileOffset += bytesRead;
      }

      // Handle last line if file doesn't end with newline
      if (lineStart < fileSize) {
        const lastLineLength = fileSize - lineStart;
        this.lineOffsets.push({ offset: lineStart, length: lastLineLength });
        if (lastLineLength > this._maxLineLength) this._maxLineLength = lastLineLength;

        if (firstLine) {
          const lineBuffer = Buffer.alloc(Math.min(lastLineLength, 500));
          fs.readSync(fd, lineBuffer, 0, lineBuffer.length, lineStart);
          const lineText = lineBuffer.toString('utf-8');
          const splitInfo = this.parseSplitHeader(lineText);
          if (splitInfo) {
            this.splitMetadata = splitInfo;
            this.headerLineCount = 1;
          }
        }
        lineNumber++;
      }
    } finally {
      fs.closeSync(fd);
    }

    // Adjust total lines to exclude hidden header
    const visibleLines = lineNumber - this.headerLineCount;

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
    if (this.lineOffsets.length > 0) {
      const lastLine = this.lineOffsets[this.lineOffsets.length - 1];
      const lastLineEnd = lastLine.offset + lastLine.length;
      // If last line ended right at indexedSize, the file had no trailing newline.
      // New data continues that line until a newline is found.
      if (lastLineEnd >= this.indexedSize) {
        lineStart = lastLine.offset;
        // Remove last line — it will be re-parsed with new data appended
        this.lineOffsets.pop();
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
          this.lineOffsets.push({ offset: lineStart, length: lineLength });
          if (lineLength > this._maxLineLength) this._maxLineLength = lineLength;
          newLineCount++;
          lineStart = absPos + 1;
        } else if (byte === 0x0D) { // CR
          // Look ahead for CRLF
          if (i + 1 < bytesRead) {
            if (buffer[i + 1] !== 0x0A) {
              // CR-only line ending
              const lineLength = absPos - lineStart;
              this.lineOffsets.push({ offset: lineStart, length: lineLength });
              if (lineLength > this._maxLineLength) this._maxLineLength = lineLength;
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
      this.lineOffsets.push({ offset: lineStart, length: lineLength });
      if (lineLength > this._maxLineLength) this._maxLineLength = lineLength;
      newLineCount++;
    }

    this.indexedSize = newSize;

    // Update fileInfo
    if (this.fileInfo) {
      this.fileInfo.size = newSize;
      this.fileInfo.totalLines = this.lineOffsets.length - this.headerLineCount;
    }

    return newLineCount;
  }

  private parseSplitHeader(line: string): SplitMetadata | null {
    if (!line.startsWith('#SPLIT:')) return null;

    const data = line.substring(7); // Remove '#SPLIT:'
    const params: Record<string, string> = {};

    for (const pair of data.split(',')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        params[key] = value;
      }
    }

    if (params.part && params.total) {
      return {
        part: parseInt(params.part, 10),
        total: parseInt(params.total, 10),
        prev: params.prev || '',
        next: params.next || '',
      };
    }

    return null;
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
    const actualEnd = Math.min(actualStart + count, this.lineOffsets.length);

    for (let i = actualStart; i < actualEnd; i++) {
      const { offset, length } = this.lineOffsets[i];
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

    // Check for common log level patterns
    if (/\b(ERROR|FATAL|CRITICAL|SEVERE)\b/.test(upperText)) {
      return 'error';
    }
    if (/\b(WARN|WARNING)\b/.test(upperText)) {
      return 'warning';
    }
    if (/\b(INFO|INFORMATION)\b/.test(upperText)) {
      return 'info';
    }
    if (/\b(DEBUG)\b/.test(upperText)) {
      return 'debug';
    }
    if (/\b(TRACE|VERBOSE)\b/.test(upperText)) {
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
    const MAX_MATCHES = 50000;

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
      '--with-filename',
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
      const proc = spawn('rg', args);
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

          // Parse ripgrep output: filename:line:column:text
          const colonIndex1 = line.indexOf(':');
          if (colonIndex1 === -1) continue;

          const colonIndex2 = line.indexOf(':', colonIndex1 + 1);
          if (colonIndex2 === -1) continue;

          const colonIndex3 = line.indexOf(':', colonIndex2 + 1);
          if (colonIndex3 === -1) continue;

          const lineNum = parseInt(line.substring(colonIndex1 + 1, colonIndex2), 10);
          const column = parseInt(line.substring(colonIndex2 + 1, colonIndex3), 10);
          const lineText = line.substring(colonIndex3 + 1);

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

        if (matches.length >= 50000) {
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
          if (ch === '\n' || ch === '\r') {
            bytesRead += lineBuffer.length + 1;
            processSearchLine(lineBuffer);
            lineBuffer = '';
            lineBufferFull = false;
            if (ch === '\r' && i + 1 < chunk.length && chunk[i + 1] === '\n') {
              i++;
            }
          } else if (!lineBufferFull) {
            lineBuffer += ch;
            if (lineBuffer.length >= MAX_SEARCH_LINE) {
              lineBufferFull = true;
            }
          }
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

  getTotalLines(): number {
    return this.lineOffsets.length - this.headerLineCount;
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    this.filePath = null;
    this.lineOffsets = [];
    this.fileInfo = null;
    this.splitMetadata = null;
    this.headerLineCount = 0;
    this.indexedSize = 0;
  }
}
