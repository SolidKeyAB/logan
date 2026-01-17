import * as fs from 'fs';
import * as readline from 'readline';
import { FileInfo, LineData, SearchMatch, SearchOptions } from '../shared/types';

interface LineOffset {
  offset: number;
  length: number;
}

export class FileHandler {
  private filePath: string | null = null;
  private lineOffsets: LineOffset[] = [];
  private fileInfo: FileInfo | null = null;
  private fd: number | null = null;

  async open(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<FileInfo> {
    this.close();
    this.filePath = filePath;

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    // Index all line offsets
    this.lineOffsets = [];
    let offset = 0;
    let lineNumber = 0;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const length = Buffer.byteLength(line, 'utf-8');
      this.lineOffsets.push({ offset, length });
      offset += length + 1; // +1 for newline
      lineNumber++;

      if (lineNumber % 100000 === 0 && onProgress) {
        onProgress(Math.min(99, Math.round((offset / fileSize) * 100)));
      }
    }

    this.fileInfo = {
      path: filePath,
      size: fileSize,
      totalLines: lineNumber,
    };

    // Open file descriptor for random access
    this.fd = fs.openSync(filePath, 'r');

    onProgress?.(100);
    return this.fileInfo;
  }

  getLines(startLine: number, count: number): LineData[] {
    if (!this.fd || !this.filePath) return [];

    const lines: LineData[] = [];
    const endLine = Math.min(startLine + count, this.lineOffsets.length);

    for (let i = startLine; i < endLine; i++) {
      const { offset, length } = this.lineOffsets[i];
      const buffer = Buffer.alloc(length);
      fs.readSync(this.fd, buffer, 0, length, offset);
      const text = buffer.toString('utf-8');
      lines.push({
        lineNumber: i,
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
    return this.lineOffsets.length;
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    this.filePath = null;
    this.lineOffsets = [];
    this.fileInfo = null;
  }
}
