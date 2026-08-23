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
  onProgress?: (percent: number) => void,
  range?: { startByte: number; endByte: number }
): IndexResult {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Optional range mode: index ONLY the byte window [rangeStart, rangeEnd) instead of the
  // whole file. Recorded offsets stay ABSOLUTE (file coordinates), so concatenating the
  // scans of a line-aligned partition reproduces the whole-file scan byte-for-byte — the
  // property that lets a big file be carved into segments without a monster index.
  // PRECONDITION: rangeStart/rangeEnd must be physical line boundaries (a line's first
  // byte, or 0 / fileSize — see findLineStartAtOrAfter); a mid-line cut would mis-count
  // the lines straddling the boundary.
  const rangeStart = range ? Math.max(0, Math.min(range.startByte, fileSize)) : 0;
  const rangeEnd = range ? Math.max(rangeStart, Math.min(range.endByte, fileSize)) : fileSize;
  const spanBytes = rangeEnd - rangeStart;

  // Growable typed-array store. Estimate capacity from the scanned span (~1 line per 80
  // bytes) to avoid most regrows on typical logs; double on overflow, slice at end.
  let cap = Math.max(1024, Math.min(Math.ceil(spanBytes / 80) + 1, 64_000_000));
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
    // A #SPLIT header only ever lives at absolute offset 0 — a mid-file segment
    // (rangeStart > 0) has none, so skip the probe for any non-zero line start.
    if (lineStart !== 0) return;
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
  let fileOffset = rangeStart;
  let lineStart = rangeStart;
  let leftover = Buffer.alloc(0);

  try {
    while (fileOffset < rangeEnd) {
      // Never read past rangeEnd — bytes beyond it belong to the next segment and must
      // not be parsed into this window's lines.
      const toRead = Math.min(chunkSize, rangeEnd - fileOffset);
      const bytesRead = fs.readSync(fd, buffer, 0, toRead, fileOffset);
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
            onProgress(Math.min(99, Math.round(((lineStart - rangeStart) / Math.max(1, spanBytes)) * 100)));
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

    // Handle the final line of the window when it isn't LF-terminated. In whole-file
    // mode this is the classic "no trailing newline" case; in range mode it ALSO fires
    // when the segment's last line ended in a CR-only terminator at rangeEnd-1 — its
    // look-ahead byte lives in the next segment, so the loop leaves that line for us here.
    if (lineStart < rangeEnd) {
      let lastLineLength = rangeEnd - lineStart;

      // A window ending in a lone CR (old-Mac terminator, or a CR-only segment boundary)
      // leaves that final CR here: interior CRs were consumed in the loop, but the last
      // one has no look-ahead byte so it falls through. Treat it as a terminator, not
      // content — strip it so the last line doesn't carry a spurious \r (count unchanged).
      const tail = Buffer.alloc(1);
      fs.readSync(fd, tail, 0, 1, rangeEnd - 1);
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

/**
 * Snap a rough byte offset to the start of the next physical line at or after it — i.e.
 * the first byte following the next line terminator (LF, CRLF, or a CR not part of a
 * CRLF). Returns 0 for approxByte <= 0 (byte 0 is always a line start) and the file size
 * when no terminator remains (the last line has no successor line to start).
 *
 * This lets a caller carve a big file into LINE-ALIGNED segments WITHOUT a full index
 * pass: pick approximate cut points (e.g. fileSize * k/N) and snap each one here, then
 * feed the resulting boundaries to scanFileIndex(range) / FileHandler.openSegment. Reads
 * a small window at a time; pure, opens and closes its own fd.
 */
export function findLineStartAtOrAfter(filePath: string, approxByte: number): number {
  const fileSize = fs.statSync(filePath).size;
  if (approxByte <= 0) return 0;
  if (approxByte >= fileSize) return fileSize;

  const fd = fs.openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;
    const buffer = Buffer.alloc(chunkSize);
    let pos = approxByte;
    while (pos < fileSize) {
      const toRead = Math.min(chunkSize, fileSize - pos);
      const bytesRead = fs.readSync(fd, buffer, 0, toRead, pos);
      if (bytesRead === 0) break;
      for (let i = 0; i < bytesRead; i++) {
        const byte = buffer[i];
        if (byte === 0x0A) {
          return pos + i + 1; // just past the LF (also covers the LF of a CRLF)
        }
        if (byte === 0x0D) {
          // CR: the boundary is just past it, UNLESS it's the CR of a CRLF, in which case
          // the boundary is just past the LF. Peek the next byte (may sit in the next
          // chunk or at EOF).
          const nextAbs = pos + i + 1;
          let nextByte = -1;
          if (i + 1 < bytesRead) nextByte = buffer[i + 1];
          else if (nextAbs < fileSize) {
            const one = Buffer.alloc(1);
            fs.readSync(fd, one, 0, 1, nextAbs);
            nextByte = one[0];
          }
          if (nextByte === 0x0A) return nextAbs + 1; // past the CRLF
          return nextAbs; // CR-only terminator
        }
      }
      pos += bytesRead;
    }
    return fileSize;
  } finally {
    fs.closeSync(fd);
  }
}
