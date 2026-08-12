import { describe, it, expect } from 'vitest';
import {
  keywordRank, rankToLevel, buildSeverityIndexFromMap, nextInSorted,
  nextSeverityLine, severityCounts, severityTicks,
} from '../main/severityIndex';

describe('severityIndex — keywordRank / precedence', () => {
  it('ranks fatal > error > warning, case-insensitive', () => {
    expect(keywordRank('FATAL')).toBe(3);
    expect(keywordRank('panic')).toBe(3);
    expect(keywordRank('Error')).toBe(2);
    expect(keywordRank('EXCEPTION')).toBe(2);
    expect(keywordRank('warn')).toBe(1);
    expect(keywordRank('NOTICE')).toBe(1);
    expect(keywordRank('info')).toBe(0);
    expect(keywordRank('nonsense')).toBe(0);
  });
  it('maps rank back to level', () => {
    expect(rankToLevel(3)).toBe('fatal');
    expect(rankToLevel(2)).toBe('error');
    expect(rankToLevel(1)).toBe('warning');
    expect(rankToLevel(0)).toBe(null);
  });
});

describe('severityIndex — buildSeverityIndexFromMap', () => {
  it('buckets lines by rank and keeps each level sorted', () => {
    const idx = buildSeverityIndexFromMap(new Map([
      [50, 2], [3, 3], [10, 1], [40, 2], [7, 3], [10, 1],
    ]));
    expect(Array.from(idx.fatal)).toEqual([3, 7]);
    expect(Array.from(idx.error)).toEqual([40, 50]);
    expect(Array.from(idx.warning)).toEqual([10]);
    expect(severityCounts(idx)).toEqual({ fatal: 2, error: 2, warning: 1 });
  });
});

describe('severityIndex — nextInSorted (binary search)', () => {
  const arr = Uint32Array.from([2, 5, 9, 20]);
  it('finds the next value strictly greater', () => {
    expect(nextInSorted(arr, 0, 1)).toBe(2);
    expect(nextInSorted(arr, 2, 1)).toBe(5);   // strictly greater — skips equal
    expect(nextInSorted(arr, 8, 1)).toBe(9);
    expect(nextInSorted(arr, 20, 1)).toBe(null);
  });
  it('finds the previous value strictly less', () => {
    expect(nextInSorted(arr, 21, -1)).toBe(20);
    expect(nextInSorted(arr, 9, -1)).toBe(5);  // strictly less — skips equal
    expect(nextInSorted(arr, 2, -1)).toBe(null);
    expect(nextInSorted(Uint32Array.from([]), 5, -1)).toBe(null);
  });
});

describe('severityIndex — nextSeverityLine across levels', () => {
  const idx = buildSeverityIndexFromMap(new Map([
    [3, 3],   // fatal
    [10, 2],  // error
    [15, 1],  // warning
    [30, 2],  // error
  ]));
  it('returns the nearest line across selected levels', () => {
    expect(nextSeverityLine(idx, 0, 1, ['fatal', 'error', 'warning'])).toBe(3);
    expect(nextSeverityLine(idx, 3, 1, ['fatal', 'error', 'warning'])).toBe(10);
    expect(nextSeverityLine(idx, 12, 1, ['fatal', 'error', 'warning'])).toBe(15);
    expect(nextSeverityLine(idx, 30, 1, ['fatal', 'error', 'warning'])).toBe(null);
  });
  it('honours the level filter', () => {
    expect(nextSeverityLine(idx, 0, 1, ['error'])).toBe(10);
    expect(nextSeverityLine(idx, 0, 1, ['fatal'])).toBe(3);
    expect(nextSeverityLine(idx, 100, -1, ['warning'])).toBe(15);
    expect(nextSeverityLine(idx, 100, -1, ['error'])).toBe(30);
  });
});

describe('severityIndex — severityTicks downsampling', () => {
  it('paints the highest rank per bucket', () => {
    const idx = buildSeverityIndexFromMap(new Map([
      [0, 1],   // warning near top
      [1, 3],   // fatal same bucket → fatal wins
      [99, 2],  // error near bottom
    ]));
    const ticks = severityTicks(idx, 10, 100); // 10 buckets over 100 lines
    expect(ticks.length).toBe(10);
    expect(ticks[0]).toBe(3); // fatal outranks the warning in bucket 0
    expect(ticks[9]).toBe(2); // error in the last bucket
    expect(ticks[5]).toBe(0); // empty bucket
  });
  it('is safe for degenerate inputs', () => {
    const idx = buildSeverityIndexFromMap(new Map());
    expect(severityTicks(idx, 0, 100).length).toBe(0);
    expect(Array.from(severityTicks(idx, 4, 0))).toEqual([0, 0, 0, 0]);
  });
});
