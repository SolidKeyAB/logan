import { describe, it, expect } from 'vitest';
import { GapDetector } from '../main/timeGaps';

const LINES: Array<[number, string]> = [
  [0, '2024-01-01 10:00:00 start'],
  [1, '2024-01-01 10:00:05 next'],     // +5s
  [2, '2024-01-01 10:01:00 later'],    // +55s
  [3, 'no timestamp on this line'],    // ignored
  [4, '2024-01-01 10:01:02 end'],      // +2s from line 2
];

function run(threshold: number, maxGaps = 500) {
  const d = new GapDetector(threshold, maxGaps);
  for (const [ln, text] of LINES) d.feed(ln, text);
  return d;
}

describe('GapDetector', () => {
  it('flags gaps at or above the threshold', () => {
    const d = run(30);
    expect(d.gaps.length).toBe(1);
    expect(d.gaps[0]).toMatchObject({ lineNumber: 2, prevLineNumber: 1, gapSeconds: 55 });
  });

  it('a lower threshold catches more gaps and skips untimestamped lines', () => {
    const d = run(3);
    // 5s (line1) and 55s (line2) qualify; 2s (line4) does not
    expect(d.gaps.map(g => g.lineNumber)).toEqual([1, 2]);
  });

  it('sorted() returns largest gaps first', () => {
    expect(run(3).sorted().map(g => Math.round(g.gapSeconds))).toEqual([55, 5]);
  });

  it('respects maxGaps and reports full', () => {
    const d = run(3, 1);
    expect(d.gaps.length).toBe(1);
    expect(d.full).toBe(true);
  });

  it('no gaps when nothing exceeds the threshold', () => {
    expect(run(120).gaps.length).toBe(0);
  });

  it('truncates a long line preview to 80 chars + ellipsis', () => {
    const d = new GapDetector(1);
    d.feed(0, '2024-01-01 10:00:00 a');
    d.feed(1, '2024-01-01 10:05:00 ' + 'x'.repeat(200));
    expect(d.gaps[0].linePreview.endsWith('...')).toBe(true);
    expect(d.gaps[0].linePreview.length).toBe(83);
  });
});
