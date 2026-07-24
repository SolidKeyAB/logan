import { describe, it, expect } from 'vitest';
import {
  nearestLineGaps,
  directionalLineGaps,
  summarizeGaps,
  pctWithin,
} from '../shared/patternDistance';

describe('nearestLineGaps', () => {
  it('returns nothing when there is no B to compare against', () => {
    expect(nearestLineGaps([1, 2, 3], [])).toEqual([]);
  });

  it('finds the nearest B on either side of each A', () => {
    // B at 10 and 20. A=8 → nearest 10 (gap 2); A=16 → nearest 20 (gap 4); A=13 → 10 (gap 3, tie-break lower)
    const pairs = nearestLineGaps([8, 16, 13], [10, 20]);
    expect(pairs).toEqual([
      { a: 8, b: 10, gap: 2 },
      { a: 16, b: 20, gap: 4 },
      { a: 13, b: 10, gap: 3 },
    ]);
  });

  it('reports gap 0 when A and B land on the same line', () => {
    expect(nearestLineGaps([5], [5])).toEqual([{ a: 5, b: 5, gap: 0 }]);
  });

  it('handles A beyond the last B (clamps to the last)', () => {
    expect(nearestLineGaps([100], [1, 2, 3])).toEqual([{ a: 100, b: 3, gap: 97 }]);
  });

  it('handles A before the first B', () => {
    expect(nearestLineGaps([0], [5, 9])).toEqual([{ a: 0, b: 5, gap: 5 }]);
  });

  it('prefers the strictly nearer neighbour when straddled', () => {
    // A=7 between B=5 (gap 2) and B=8 (gap 1) → picks 8
    expect(nearestLineGaps([7], [5, 8])).toEqual([{ a: 7, b: 8, gap: 1 }]);
  });
});

describe('directionalLineGaps', () => {
  it("'after' keeps only the next B at or beyond each A", () => {
    // A=8 → next B 10 (gap 2); A=25 → no B >= 25 → dropped
    const pairs = directionalLineGaps([8, 25], [10, 20], 'after');
    expect(pairs).toEqual([{ a: 8, b: 10, gap: 2 }]);
  });

  it("'after' treats an exact hit as gap 0", () => {
    expect(directionalLineGaps([10], [10, 20], 'after')).toEqual([{ a: 10, b: 10, gap: 0 }]);
  });

  it("'before' keeps only the previous B at or before each A", () => {
    // A=15 → prev B 10 (gap 5); A=3 → no B <= 3 → dropped
    const pairs = directionalLineGaps([15, 3], [10, 20], 'before');
    expect(pairs).toEqual([{ a: 15, b: 10, gap: 5 }]);
  });

  it("'before' treats an exact hit as gap 0", () => {
    expect(directionalLineGaps([20], [10, 20], 'before')).toEqual([{ a: 20, b: 20, gap: 0 }]);
  });

  it("'nearest' matches nearestLineGaps", () => {
    const from = [8, 16, 13];
    const to = [10, 20];
    expect(directionalLineGaps(from, to, 'nearest')).toEqual(nearestLineGaps(from, to));
  });

  it('returns nothing when B is empty regardless of direction', () => {
    expect(directionalLineGaps([1, 2], [], 'after')).toEqual([]);
    expect(directionalLineGaps([1, 2], [], 'before')).toEqual([]);
  });
});

describe('summarizeGaps', () => {
  it('handles an empty list', () => {
    expect(summarizeGaps([])).toEqual({ n: 0, min: 0, max: 0, mean: 0, median: 0 });
  });

  it('computes stats for an odd-length list', () => {
    expect(summarizeGaps([5, 1, 3])).toEqual({ n: 3, min: 1, max: 5, mean: 3, median: 3 });
  });

  it('computes a rounded median for an even-length list', () => {
    // sorted [1,2,3,10] → median (2+3)/2 = 2.5 → rounds to 3; mean 16/4 = 4
    expect(summarizeGaps([10, 1, 3, 2])).toEqual({ n: 4, min: 1, max: 10, mean: 4, median: 3 });
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    summarizeGaps(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('pctWithin', () => {
  it('is 0 for an empty list', () => {
    expect(pctWithin([], 5)).toBe(0);
  });

  it('counts gaps <= threshold inclusively', () => {
    // [0,2,5,20] within 5 → 3 of 4 → 75%
    expect(pctWithin([0, 2, 5, 20], 5)).toBe(75);
  });

  it('is 100 when all gaps are within the threshold', () => {
    expect(pctWithin([1, 2, 3], 100)).toBe(100);
  });
});
