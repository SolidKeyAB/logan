import * as fs from 'fs';

/**
 * File line-index scanner. Walks the raw bytes of a file once and records the
 * byte offset + length of every physical line, handling LF / CRLF / CR-only /
 * mixed line endings. This is the work that used to run inline on the Electron
 * main thread during open() and made big files (e.g. 24M-line logcat) hang the
 * UI while indexing.
 *
 * Two things changed vs the old inline scan:
 *  1. The result is stored in two Float64Arrays (offsets, lengths) instead of an
 *     array of {offset,length} objects. For 24M lines that removes ~24M object
 *     allocations — a large RAM and GC win.
 *  2. This function is pure and synchronous, so it can run inside a worker thread
 *     (see indexWorker.ts) off the main event loop. FileHandler.open() also calls
 *     it inline as a fallback when the worker isn't available (e.g. unit tests).
 */

export interface SplitMetadata {
  part: number;
  total: number;
  prev: string;
  next: string;
}

export interface IndexResult {
  offsets: Float64Array;      // byte offset of each physical line (length === totalLines)
  lengths: Float64Array;      // byte length of each physical line (excludes the line terminator)
  totalLines: number;         // number of physical lines, including any hidden header line
  maxLineLength: number;      // longest line length in bytes
  headerLineCount: number;    // hidden header lines to skip (1 when a #SPLIT: header is present)
  splitMetadata: SplitMetadata | null;
  hasStandaloneCR: boolean;   // true if a CR-only line ending was seen (ripgrep can't count these)
}

export function parseSplitHeader(line: string): SplitMetadata | null {
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

export function scanFileIndex(
  filePath: string,
  onProgress?: (percent: number) => void
): IndexResult {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Growable typed-array store. Estimate capacity from file size (~1 line per 80
  // bytes) to avoid most regrows on typical logs; double on overflow, slice at end.
  let cap = Math.max(1024, Math.min(Math.ceil(fileSize / 80) + 1, 64_000_000));
  let offsets = new Float64Array(cap);
  let lengths = new Float64Array(cap);
  let count = 0;
  let maxLineLength = 0;

  const pushLine = (offset: number, length: number): void => {
    if (count >= cap) {
      cap = cap * 2;
      const no = new Float64Array(cap); no.set(offsets); offsets = no;
      const nl = new Float64Array(cap); nl.set(lengths); lengths = nl;
    }
    offsets[count] = offset;
    lengths[count] = length;
    count++;
    if (length > maxLineLength) maxLineLength = length;
  };

  let headerLineCount = 0;
  let splitMetadata: SplitMetadata | null = null;
  let hasStandaloneCR = false;
  let lineNumber = 0;
  let firstLine = true;

  const fd = fs.openSync(filePath, 'r');

  // Detect a #SPLIT: header on the first line (reads up to 500 bytes at lineStart).
  const detectHeader = (lineStart: number, length: number): void => {
    const lineBuffer = Buffer.alloc(Math.min(length, 500));
    fs.readSync(fd, lineBuffer, 0, lineBuffer.length, lineStart);
    const lineText = lineBuffer.toString('utf-8');
    const splitInfo = parseSplitHeader(lineText);
    if (splitInfo) {
      splitMetadata = splitInfo;
      headerLineCount = 1;
    }
  };

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

        if (byte === 0x0A) { // LF (or the LF of a CRLF)
          const lineEnd = effectiveOffset + chunkPos;
          const lineLength = lineEnd - lineStart;

          // Exclude a CR immediately before the LF (CRLF)
          let actualLength = lineLength;
          if (lineLength > 0 && chunkPos > 0 && chunk[chunkPos - 1] === 0x0D) {
            actualLength = lineLength - 1;
          }

          pushLine(lineStart, actualLength);

          if (firstLine) {
            firstLine = false;
            detectHeader(lineStart, actualLength);
          }

          lineNumber++;
          lineStart = lineEnd + 1; // Move past LF

          if (lineNumber % 100000 === 0 && onProgress) {
            onProgress(Math.min(99, Math.round((lineStart / fileSize) * 100)));
          }
        } else if (byte === 0x0D) { // CR
          // CR-only (old Mac / serial) vs start of CRLF — look ahead
          if (chunkPos + 1 < chunk.length) {
            if (chunk[chunkPos + 1] !== 0x0A) {
              // CR-only line ending — ripgrep won't count this as a line break
              hasStandaloneCR = true;
              const lineEnd = effectiveOffset + chunkPos;
              const lineLength = lineEnd - lineStart;
              pushLine(lineStart, lineLength);

              if (firstLine) {
                firstLine = false;
                detectHeader(lineStart, lineLength);
              }

              lineNumber++;
              lineStart = lineEnd + 1; // Move past CR
            }
            // If next is LF, we'll handle it in the LF case
          }
          // If CR is at end of chunk, it stays in leftover for the next iteration
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

    // Handle last line if file doesn't end with a newline
    if (lineStart < fileSize) {
      let lastLineLength = fileSize - lineStart;

      // A file ending in a lone CR (old-Mac terminator) leaves that final CR here:
      // interior CRs were consumed in the loop, but the last one has no look-ahead
      // byte so it falls through. Treat it as a terminator, not content — strip it so
      // the last line doesn't carry a spurious \r (line count is unchanged).
      const tail = Buffer.alloc(1);
      fs.readSync(fd, tail, 0, 1, fileSize - 1);
      if (tail[0] === 0x0D) {
        hasStandaloneCR = true;
        lastLineLength -= 1;
      }

      pushLine(lineStart, lastLineLength);

      if (firstLine) {
        firstLine = false;
        detectHeader(lineStart, lastLineLength);
      }
      lineNumber++;
    }
  } finally {
    fs.closeSync(fd);
  }

  onProgress?.(100);

  return {
    // slice() trims the over-allocated capacity and gives each array its own
    // exact-size ArrayBuffer (transferable back from the worker).
    offsets: offsets.slice(0, count),
    lengths: lengths.slice(0, count),
    totalLines: count,
    maxLineLength,
    headerLineCount,
    splitMetadata,
    hasStandaloneCR,
  };
}
