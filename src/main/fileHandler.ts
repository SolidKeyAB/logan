import * as fs from 'fs';
import * as readline from 'readline';
import { FileInfo, LineData, SearchMatch, SearchOptions } from '../shared/types';

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
  private headerLineCount: number = 0; // Lines to skip (hidden header)

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

    // Index all line offsets
    this.lineOffsets = [];
    let offset = 0;
    let lineNumber = 0;
    let firstLine = true;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const length = Buffer.byteLength(line, 'utf-8');

      // Check first line for split header
      if (firstLine) {
        firstLine = false;
        const splitInfo = this.parseSplitHeader(line);
        if (splitInfo) {
          this.splitMetadata = splitInfo;
          this.headerLineCount = 1;
          // Still store the offset but we'll skip it when returning lines
        }
      }

      this.lineOffsets.push({ offset, length });
      offset += length + 1; // +1 for newline
      lineNumber++;

      if (lineNumber % 100000 === 0 && onProgress) {
        onProgress(Math.min(99, Math.round((offset / fileSize) * 100)));
      }
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

    onProgress?.(100);
    return this.fileInfo;
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

  getLines(startLine: number, count: number): LineData[] {
    if (!this.fd || !this.filePath) return [];

    const lines: LineData[] = [];
    // Offset by header lines to skip hidden metadata
    const actualStart = startLine + this.headerLineCount;
    const actualEnd = Math.min(actualStart + count, this.lineOffsets.length);

    for (let i = actualStart; i < actualEnd; i++) {
      const { offset, length } = this.lineOffsets[i];
      const buffer = Buffer.alloc(length);
      fs.readSync(this.fd, buffer, 0, length, offset);
      const text = buffer.toString('utf-8');
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
    const upperText = text.toUpperCase();

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

    const matches: SearchMatch[] = [];
    let regex: RegExp;

    try {
      const flags = options.matchCase ? 'g' : 'gi';
      if (options.isRegex) {
        regex = new RegExp(options.pattern, flags);
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

    const totalLines = this.lineOffsets.length;
    const BATCH_SIZE = 10000;

    for (let start = 0; start < totalLines; start += BATCH_SIZE) {
      if (signal?.cancelled) break;

      const lines = this.getLines(start, BATCH_SIZE);

      for (const line of lines) {
        let match;
        regex.lastIndex = 0;

        while ((match = regex.exec(line.text)) !== null) {
          matches.push({
            lineNumber: line.lineNumber,
            column: match.index,
            length: match[0].length,
            lineText: line.text,
          });

          // Limit to 50000 matches
          if (matches.length >= 50000) {
            return matches;
          }
        }
      }

      if (onProgress) {
        const progress = Math.round(((start + BATCH_SIZE) / totalLines) * 100);
        onProgress(Math.min(progress, 100), matches.length);
      }
    }

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
  }
}
