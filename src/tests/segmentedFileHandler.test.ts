import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileHandler } from '../main/fileHandler';
import { SegmentedFileHandler } from '../main/segmentedFileHandler';
import type { LineData } from '../shared/types';

// P2 increment 1: prove SegmentedFileHandler reads a big file identically to a whole-file
// FileHandler while keeping only a bounded number of segment indexes resident (the LRU
// that actually banks the RAM win).

let tmpDir: string;
const files: string[] = [];

function writeTmp(name: string, data: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, data);
  files.push(p);
  return p;
}

// Deterministic content: 500 varied lines (some carry level keywords for detectLevel).
function makeContent(n: number): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 11 === 0 ? 'ERROR' : i % 7 === 0 ? 'WARN' : 'INFO';
    lines.push(`${kind} [${i}] event payload ${'x'.repeat(i % 40)} end`);
  }
  return lines.join('\n') + '\n';
}

function strip(l: LineData): { lineNumber: number; text: string; level: string | undefined } {
  return { lineNumber: l.lineNumber, text: l.text, level: l.level };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-segfh-'));
});
afterAll(() => {
  for (const f of files) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
});

describe('SegmentedFileHandler — read parity with whole-file FileHandler', () => {
  it('totals, boundaries and full read match the whole file (multi-segment, LRU cap 2)', async () => {
    const N = 500;
    const p = writeTmp('seg-read.log', makeContent(N));

    const whole = new FileHandler();
    await whole.open(p);
    const total = whole.getTotalLines();
    expect(total).toBe(N);
    const wholeLines = whole.getLines(0, total);

    // Force many small segments so eviction actually happens with a cap of 2.
    const fileSize = fs.statSync(p).size;
    const seg = await SegmentedFileHandler.open(p, {
      segmentBytes: Math.ceil(fileSize / 12),
      maxResidentSegments: 2,
    });

    expect(seg.getTotalLines()).toBe(N);
    expect(seg.getMaxLineLength()).toBe(whole.getMaxLineLength());
    expect(seg.boundaries().length).toBeGreaterThanOrEqual(4); // genuinely multi-segment

    // Sync full read — global line numbers, text and levels all match.
    expect(seg.getLines(0, total).map(strip)).toEqual(wholeLines.map(strip));
    // ...and residency never exceeded the cap during that full scan.
    expect(seg.residentSegmentCount()).toBeLessThanOrEqual(2);

    seg.close();
    whole.close();
  });

  it('async read in viewport-sized chunks matches, staying within the resident cap', async () => {
    const N = 500;
    const p = writeTmp('seg-async.log', makeContent(N));
    const whole = new FileHandler();
    await whole.open(p);
    const wholeLines = whole.getLines(0, N);

    const fileSize = fs.statSync(p).size;
    const seg = await SegmentedFileHandler.open(p, { segmentBytes: Math.ceil(fileSize / 15), maxResidentSegments: 3 });

    const chunk = 37;
    const collected: LineData[] = [];
    for (let start = 0; start < N; start += chunk) {
      const got = await seg.getLinesAsync(start, Math.min(chunk, N - start));
      collected.push(...got);
      expect(seg.residentSegmentCount()).toBeLessThanOrEqual(3);
    }
    expect(collected.map(strip)).toEqual(wholeLines.map(strip));
    seg.close();
    whole.close();
  });

  it('getLinesByNumbers returns scattered lines in request order', async () => {
    const N = 500;
    const p = writeTmp('seg-bynum.log', makeContent(N));
    const whole = new FileHandler();
    await whole.open(p);

    const fileSize = fs.statSync(p).size;
    const seg = await SegmentedFileHandler.open(p, { segmentBytes: Math.ceil(fileSize / 10), maxResidentSegments: 2 });

    const req = [499, 0, 250, 13, 480, 7, 300, 1];
    const wholeByNum = await whole.getLinesByNumbers(req);
    const segByNum = await seg.getLinesByNumbers(req);
    expect(segByNum.map(strip)).toEqual(wholeByNum.map(strip));
    expect(seg.residentSegmentCount()).toBeLessThanOrEqual(2);
    seg.close();
    whole.close();
  });

  it('re-reads a segment correctly AFTER it was evicted (rebuild on demand)', async () => {
    const N = 300;
    const p = writeTmp('seg-evict.log', makeContent(N));
    const whole = new FileHandler();
    await whole.open(p);
    const wholeLines = whole.getLines(0, N);

    const fileSize = fs.statSync(p).size;
    const seg = await SegmentedFileHandler.open(p, { segmentBytes: Math.ceil(fileSize / 8), maxResidentSegments: 1 });

    // Touch segment 0, then a far segment (evicts 0), then come back to 0 — must rebuild.
    const first = await seg.getLinesAsync(0, 5);
    await seg.getLinesAsync(N - 5, 5);       // evicts the earlier segment (cap 1)
    const firstAgain = await seg.getLinesAsync(0, 5);

    expect(first.map(strip)).toEqual(wholeLines.slice(0, 5).map(strip));
    expect(firstAgain.map(strip)).toEqual(wholeLines.slice(0, 5).map(strip));
    expect(seg.residentSegmentCount()).toBeLessThanOrEqual(1);
    seg.close();
    whole.close();
  });

  it('degenerates cleanly to a single segment when segmentBytes >= fileSize', async () => {
    const N = 120;
    const p = writeTmp('seg-single.log', makeContent(N));
    const whole = new FileHandler();
    await whole.open(p);
    const wholeLines = whole.getLines(0, N);

    const seg = await SegmentedFileHandler.open(p, { segmentBytes: 10 * 1024 * 1024, maxResidentSegments: 4 });
    expect(seg.boundaries().length).toBe(1);
    expect(seg.getLines(0, N).map(strip)).toEqual(wholeLines.map(strip));
    seg.close();
    whole.close();
  });

  it('fileOf maps a global line back to a local line within its segment', async () => {
    const N = 400;
    const p = writeTmp('seg-fileof.log', makeContent(N));
    const fileSize = fs.statSync(p).size;
    const seg = await SegmentedFileHandler.open(p, { segmentBytes: Math.ceil(fileSize / 9), maxResidentSegments: 2 });

    for (const g of [0, 1, 199, 200, 399]) {
      const loc = seg.fileOf(g);
      expect(loc).not.toBeNull();
      expect(loc!.filePath).toBe(p);
      // The line read at (segment start + localLine) equals the global line's text.
      const global = seg.getLines(g, 1)[0];
      expect(global.lineNumber).toBe(g);
    }
    expect(seg.fileOf(N)).toBeNull(); // out of range
    seg.close();
  });
});
