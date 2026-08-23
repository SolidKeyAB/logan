import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanFileIndex, findLineStartAtOrAfter } from '../main/indexScan';
import { FileHandler } from '../main/fileHandler';

// P1 of auto-composite-large-files: prove the range-scoped index primitive is
// BYTE-IDENTICAL to the whole-file scan. The core property: scanning a line-aligned
// partition of a file and concatenating the pieces reproduces the whole-file index
// exactly (offsets, lengths, totalLines) — the invariant CompositeFileHandler relies on
// to present N segments of one file as a single continuous log.

let tmpDir: string;
const files: string[] = [];

function writeTmp(name: string, data: Buffer): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, data);
  files.push(p);
  return p;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-segidx-'));
});

afterAll(() => {
  for (const f of files) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
});

// Concatenate the range-scans of a line-aligned partition and assert byte parity with
// the whole-file scan. `boundaries` must be strictly increasing line-start offsets that
// begin with 0 and end with fileSize.
function assertPartitionParity(filePath: string, boundaries: number[]): void {
  const whole = scanFileIndex(filePath);

  const segOffsets: number[] = [];
  const segLengths: number[] = [];
  let segTotal = 0;
  let segMaxLen = 0;
  let segCR = false;

  for (let i = 0; i + 1 < boundaries.length; i++) {
    const seg = scanFileIndex(filePath, undefined, { startByte: boundaries[i], endByte: boundaries[i + 1] });
    for (let k = 0; k < seg.totalLines; k++) {
      segOffsets.push(seg.offsets[k]);
      segLengths.push(seg.lengths[k]);
    }
    segTotal += seg.totalLines;
    segMaxLen = Math.max(segMaxLen, seg.maxLineLength);
    segCR = segCR || seg.hasStandaloneCR;
  }

  expect(segTotal).toBe(whole.totalLines);
  expect(segOffsets).toEqual(Array.from(whole.offsets));
  expect(segLengths).toEqual(Array.from(whole.lengths));
  expect(segMaxLen).toBe(whole.maxLineLength);
  expect(segCR).toBe(whole.hasStandaloneCR);
}

// Build the coarsest-and-finest partitions from a whole-file scan: split at EVERY line
// boundary (exercises every terminator type as a cut point) plus a few coarse cuts.
function partitionsFor(filePath: string): number[][] {
  const whole = scanFileIndex(filePath);
  const fileSize = fs.statSync(filePath).size;
  const starts = Array.from(whole.offsets); // absolute start byte of each physical line

  // Every-line partition: [0, offsets[1], offsets[2], ..., fileSize].
  const everyLine = Array.from(new Set([...starts, fileSize])).sort((a, b) => a - b);

  // A coarse 3-way-ish partition at interior line indices.
  const n = starts.length;
  const coarseIdx = [Math.floor(n / 3), Math.floor((2 * n) / 3)].filter((i) => i > 0 && i < n);
  const coarse = Array.from(new Set([0, ...coarseIdx.map((i) => starts[i]), fileSize])).sort((a, b) => a - b);

  return [everyLine, coarse];
}

const CASES: Array<{ name: string; buf: Buffer }> = [
  { name: 'lf-trailing.log', buf: Buffer.from('alpha\nbravo\ncharlie\ndelta\necho\n') },
  { name: 'lf-no-trailing.log', buf: Buffer.from('alpha\nbravo\ncharlie\ndelta\necho') },
  { name: 'crlf.log', buf: Buffer.from('alpha\r\nbravo\r\ncharlie\r\ndelta\r\n') },
  { name: 'crlf-no-trailing.log', buf: Buffer.from('alpha\r\nbravo\r\ncharlie') },
  { name: 'cr-only.log', buf: Buffer.from('alpha\rbravo\rcharlie\rdelta\r') },
  { name: 'cr-only-no-trailing.log', buf: Buffer.from('alpha\rbravo\rcharlie') },
  { name: 'mixed.log', buf: Buffer.from('a\nb\r\nc\rd\ne') },
  { name: 'empty-lines.log', buf: Buffer.from('a\n\n\nb\n\n') },
  { name: 'split-header.log', buf: Buffer.from('#SPLIT:part=1,total=2,next=x\nalpha\nbravo\ncharlie\n') },
  { name: 'long-line.log', buf: Buffer.from(`short\n${'x'.repeat(20000)}\ntail\n`) },
];

describe('scanFileIndex range mode — byte parity with whole-file scan', () => {
  for (const c of CASES) {
    it(`partition parity: ${c.name}`, () => {
      const p = writeTmp(c.name, c.buf);
      for (const partition of partitionsFor(p)) {
        assertPartitionParity(p, partition);
      }
    });
  }

  it('multi-chunk file (> 1MB) with mixed endings', () => {
    // ~2.4MB so the 1MB chunk loop, cross-chunk leftover, and range clamping all run.
    const parts: Buffer[] = [];
    for (let i = 0; i < 40000; i++) {
      const len = 10 + ((i * 37) % 90);
      const text = `line${i}-` + 'y'.repeat(len);
      const term = i % 500 === 0 ? '\r' : i % 7 === 0 ? '\r\n' : '\n'; // occasional CR-only / CRLF
      parts.push(Buffer.from(text + term));
    }
    const p = writeTmp('big-mixed.log', Buffer.concat(parts));
    const whole = scanFileIndex(p);
    const fileSize = fs.statSync(p).size;
    const starts = Array.from(whole.offsets);

    // Cut at a spread of interior line indices (several land far from and near chunk edges).
    const fracs = [0.07, 0.2, 0.33, 0.5, 0.66, 0.8, 0.93];
    const cuts = fracs.map((f) => starts[Math.floor(starts.length * f)]).filter((b) => b > 0 && b < fileSize);
    const boundaries = Array.from(new Set([0, ...cuts, fileSize])).sort((a, b) => a - b);
    assertPartitionParity(p, boundaries);
  });
});

describe('findLineStartAtOrAfter — snaps a rough byte to the next line start', () => {
  it('snaps arbitrary offsets to real line starts (mixed endings)', () => {
    const p = writeTmp('snap-mixed.log', Buffer.from('aa\nbbbb\r\ncc\rdddddd\neeee\n'));
    const whole = scanFileIndex(p);
    const fileSize = fs.statSync(p).size;
    const validStarts = new Set<number>([...Array.from(whole.offsets), fileSize]);

    expect(findLineStartAtOrAfter(p, 0)).toBe(0);
    expect(findLineStartAtOrAfter(p, -5)).toBe(0);
    expect(findLineStartAtOrAfter(p, fileSize)).toBe(fileSize);
    expect(findLineStartAtOrAfter(p, fileSize + 10)).toBe(fileSize);

    for (let b = 1; b <= fileSize; b++) {
      const snapped = findLineStartAtOrAfter(p, b);
      expect(snapped).toBeGreaterThanOrEqual(b); // never moves backwards
      expect(validStarts.has(snapped)).toBe(true); // always a real line start (or EOF)
    }
  });

  it('snapped cuts produce a valid parity partition on a multi-chunk file', () => {
    const parts: Buffer[] = [];
    for (let i = 0; i < 30000; i++) {
      parts.push(Buffer.from(`row ${i} ` + 'z'.repeat(20 + ((i * 13) % 60)) + (i % 6 === 0 ? '\r\n' : '\n')));
    }
    const p = writeTmp('snap-big.log', Buffer.concat(parts));
    const fileSize = fs.statSync(p).size;

    // Pick approximate cut points by raw byte fraction, then snap each to a line start —
    // exactly how the auto-composite path will carve segments without a full index.
    const approx = [1, 2, 3, 4, 5, 6, 7].map((k) => Math.floor((fileSize * k) / 8));
    const snapped = approx.map((b) => findLineStartAtOrAfter(p, b));
    const boundaries = Array.from(new Set([0, ...snapped, fileSize])).sort((a, b) => a - b);
    assertPartitionParity(p, boundaries);
  });
});

describe('FileHandler.openSegment — reads a segment as a standalone read-only slice', () => {
  it('segment lines match the whole-file lines for the same range', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `entry ${i} payload-${'q'.repeat(i % 30)}`);
    const p = writeTmp('openseg.log', Buffer.from(lines.join('\n') + '\n'));

    const whole = new FileHandler();
    await whole.open(p);
    const total = whole.getTotalLines();
    expect(total).toBe(200);
    const wholeLines = whole.getLines(0, total);
    const starts = Array.from(scanFileIndex(p).offsets);

    // Interior segment [k1, k2) and a final segment [k3, EOF).
    const ranges: Array<[number, number]> = [[0, 50], [50, 130], [130, 200]];
    for (const [k1, k2] of ranges) {
      const startByte = starts[k1];
      const endByte = k2 < starts.length ? starts[k2] : fs.statSync(p).size;
      const seg = new FileHandler();
      const info = await seg.openSegment(p, startByte, endByte);
      expect(seg.getTotalLines()).toBe(k2 - k1);
      expect(info.totalLines).toBe(k2 - k1);
      const segLines = seg.getLines(0, k2 - k1);
      expect(segLines.map((l) => l.text)).toEqual(wholeLines.slice(k1, k2).map((l) => l.text));
      // Segment line numbers are LOCAL (0-based within the segment).
      expect(segLines.map((l) => l.lineNumber)).toEqual(segLines.map((_, j) => j));
      seg.close();
    }
    whole.close();
  });

  it('handles a file with no trailing newline in the final segment', async () => {
    const p = writeTmp('openseg-notrail.log', Buffer.from('one\ntwo\nthree\nfour\nfive'));
    const starts = Array.from(scanFileIndex(p).offsets);
    const seg = new FileHandler();
    await seg.openSegment(p, starts[3], fs.statSync(p).size); // ['four', 'five']
    expect(seg.getTotalLines()).toBe(2);
    expect(seg.getLines(0, 2).map((l) => l.text)).toEqual(['four', 'five']);
    seg.close();
  });
});
