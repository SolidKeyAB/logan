import { describe, it, expect } from 'vitest';
import { detectFoldRegions } from '../main/foldRegions';
import type { LineReader } from '../main/trendWorkerReaders';

// In-memory LineReader (same fake used across the worker tests).
function fakeReader(lines: string[]): LineReader {
  return {
    getTotalLines: () => lines.length,
    getLines: (start: number, count: number) =>
      lines.slice(start, start + count).map((text, i) => ({
        lineNumber: start + i,
        text,
        level: undefined as undefined,
      })),
    close: () => { /* nothing */ },
  };
}

// A unique preamble, a 4× identical-line spam block (period 1), a unique separator,
// then a 2-line request block repeating 3× (period 2 — ids masked by normalizeShape).
const lines = [
  'preamble line',
  'HEARTBEAT ping',
  'HEARTBEAT ping',
  'HEARTBEAT ping',
  'HEARTBEAT ping',
  'unique middle',
  'REQ start id=1',
  'REQ done id=1',
  'REQ start id=2',
  'REQ done id=2',
  'REQ start id=3',
  'REQ done id=3',
  'tail',
];

describe('detectFoldRegions', () => {
  it('finds the period-1 spam and the period-2 request cycle', () => {
    const { regions, totalLines, foldableLines } = detectFoldRegions(fakeReader(lines), {});
    expect(totalLines).toBe(13);
    expect(regions.length).toBe(2);

    const spam = regions[0];
    expect(spam).toMatchObject({ start: 1, end: 4, blockLen: 1, repeatCount: 4, totalLines: 4, hiddenLines: 3 });
    expect(spam.sample).toBe('HEARTBEAT ping');

    const cycle = regions[1];
    expect(cycle).toMatchObject({ start: 6, end: 11, blockLen: 2, repeatCount: 3, totalLines: 6, hiddenLines: 4 });
    expect(cycle.sample).toBe('REQ start id=1');

    // foldableLines = lines hidden if BOTH collapse = 3 + 4
    expect(foldableLines).toBe(7);
  });

  it('minHidden filters out the shallow region', () => {
    // spam hides only 3 lines; raise the floor to 4 → only the request cycle survives.
    const { regions } = detectFoldRegions(fakeReader(lines), { minHidden: 4 });
    expect(regions.map((r) => r.start)).toEqual([6]);
  });

  it('returns nothing when there is no repetition', () => {
    const { regions, foldableLines } = detectFoldRegions(fakeReader(['a', 'b', 'c', 'd', 'e']), {});
    expect(regions).toEqual([]);
    expect(foldableLines).toBe(0);
  });
});
