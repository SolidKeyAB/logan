import { describe, it, expect } from 'vitest';
import { foldScope } from '../main/summarizeScan';
import { foldTemplates, TemplateFolder } from '../main/logTemplates';
import type { LineReader } from '../main/trendWorkerReaders';

// In-memory LineReader over an array of lines (0-based lineNumber), standing in for
// a WorkerFileReader without touching the filesystem — foldScope only needs
// getTotalLines/getLines. Mirrors the fake used in trendWorkerReaders.test.ts.
function fakeReader(lines: string[]): LineReader {
  return {
    getTotalLines: () => lines.length,
    getLines: (start: number, count: number) =>
      lines.slice(start, start + count).map((text, i) => ({
        lineNumber: start + i,
        text,
        level: undefined as undefined,
      })),
    close: () => { /* nothing to close */ },
  };
}

// Repeating shapes so the fold is meaningful: 4× "conn open id=<NUM>" and
// 2× "timeout after <NUM>ms".
const lines = [
  '2024-01-01 00:00:01 INFO conn open id=1',
  '2024-01-01 00:00:02 INFO conn open id=2',
  '2024-01-01 00:00:03 ERROR timeout after 500ms',
  '2024-01-01 00:00:04 INFO conn open id=3',
  '2024-01-01 00:00:05 ERROR timeout after 900ms',
  '2024-01-01 00:00:06 INFO conn open id=4',
];

// The whole point of the off-thread fold: foldScope over a reader must produce the
// SAME summary the main process would (foldTemplates over the raw lines), with the
// same 1-based viewerLines.
describe('foldScope (off-thread summarize) === main-thread fold', () => {
  it('whole-file range matches foldTemplates over the raw lines', () => {
    const viaReader = foldScope(fakeReader(lines), { kind: 'range', startLine: 0, endLine: lines.length - 1 }, {});
    const viaMain = foldTemplates(lines, {});
    expect(viaReader).toEqual(viaMain);
    // sanity: the two shapes folded with the right counts
    expect(viaReader.templates.map((t) => t.count).sort((a, b) => b - a)).toEqual([4, 2]);
  });

  it('a sub-range matches foldTemplates with the matching startLine (1-based viewerLines)', () => {
    // lines[2..4] → viewer lines 3..5
    const viaReader = foldScope(fakeReader(lines), { kind: 'range', startLine: 2, endLine: 4 }, {});
    const viaMain = foldTemplates(lines.slice(2, 5), { startLine: 3 });
    expect(viaReader).toEqual(viaMain);
  });

  it('an explicit index set folds the right lines at their real viewerLines', () => {
    // Non-contiguous scope: lines 0, 2, 4 → viewer lines 1, 3, 5.
    const viaReader = foldScope(fakeReader(lines), { kind: 'indices', lines: [0, 2, 4] }, {});
    const expected = new TemplateFolder({});
    expected.feed(lines[0], 1);
    expected.feed(lines[2], 3);
    expected.feed(lines[4], 5);
    expect(viaReader).toEqual(expected.finish());
    // the two ERROR lines (2 & 4) collapse to one template spanning viewer 3→5
    const err = viaReader.templates.find((t) => t.shape.includes('timeout'));
    expect(err?.count).toBe(2);
    expect(err?.firstLine).toBe(3);
    expect(err?.lastLine).toBe(5);
  });

  it('clamps a range that runs past the end', () => {
    const viaReader = foldScope(fakeReader(lines), { kind: 'range', startLine: 4, endLine: 999 }, {});
    const viaMain = foldTemplates(lines.slice(4), { startLine: 5 });
    expect(viaReader).toEqual(viaMain);
  });
});
