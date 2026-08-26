import { describe, it, expect } from 'vitest';
import { carryForwardTimestamps, buildOriginTags, formatWallClock, sortMergeEntries, type MergeEntry } from '../main/mergeTimeline';

describe('carryForwardTimestamps', () => {
  it('keeps real timestamps and carries the previous one onto untimestamped lines', () => {
    // 2nd/3rd lines have no timestamp — they belong to the 1st entry (e.g. a
    // stack trace) and must inherit its time so they sort right after it.
    expect(carryForwardTimestamps([100, null, null, 200])).toEqual([100, 100, 100, 200]);
  });

  it('backfills leading untimestamped lines with the file\'s first timestamp', () => {
    // A banner/preamble before the first stamped line still gets placed at the
    // file\'s earliest moment rather than being dropped.
    expect(carryForwardTimestamps([null, null, 500, 600])).toEqual([500, 500, 500, 600]);
  });

  it('returns all-null when the file has no timestamps at all (caller skips it)', () => {
    expect(carryForwardTimestamps([null, null, null])).toEqual([null, null, null]);
  });

  it('handles an empty file', () => {
    expect(carryForwardTimestamps([])).toEqual([]);
  });

  it('preserves monotonic order for fully-stamped files', () => {
    expect(carryForwardTimestamps([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('buildOriginTags', () => {
  it('uses the basename when names are unique', () => {
    expect(buildOriginTags(['/a/device.log', '/b/modem.log'])).toEqual(['device.log', 'modem.log']);
  });

  it('disambiguates colliding basenames with the parent directory', () => {
    expect(buildOriginTags(['/logs/node1/app.log', '/logs/node2/app.log']))
      .toEqual(['node1/app.log', 'node2/app.log']);
  });

  it('handles windows-style separators', () => {
    expect(buildOriginTags(['C:\\logs\\a.log', 'C:\\logs\\b.log'])).toEqual(['a.log', 'b.log']);
  });
});

describe('formatWallClock', () => {
  it('formats to millisecond precision', () => {
    // Build from local components so the assertion is timezone-independent.
    const d = new Date(2026, 7, 4, 9, 8, 7, 6); // 2026-08-04 09:08:07.006 local
    expect(formatWallClock(d.getTime())).toBe('2026-08-04 09:08:07.006');
  });
});

describe('sortMergeEntries (wall-clock interleave)', () => {
  it('interleaves lines from different files into one time-ordered stream', () => {
    // File 0 @ 100,300 ; file 1 @ 150,200 → global order should be time-sorted.
    const entries: MergeEntry[] = [
      { f: 0, ln: 0, ms: 100 },
      { f: 0, ln: 1, ms: 300 },
      { f: 1, ln: 0, ms: 150 },
      { f: 1, ln: 1, ms: 200 },
    ];
    sortMergeEntries(entries);
    expect(entries.map(e => [e.f, e.ln, e.ms])).toEqual([
      [0, 0, 100], [1, 0, 150], [1, 1, 200], [0, 1, 300],
    ]);
  });

  it('is stable at equal timestamps: tie-break by file then line', () => {
    // Carried-forward continuation lines share a timestamp; each file must keep its
    // own internal order, and whole files break ties by index (file 0 before file 1).
    const entries: MergeEntry[] = [
      { f: 1, ln: 5, ms: 500 },
      { f: 0, ln: 9, ms: 500 },
      { f: 0, ln: 2, ms: 500 },
      { f: 1, ln: 1, ms: 500 },
    ];
    sortMergeEntries(entries);
    expect(entries.map(e => [e.f, e.ln])).toEqual([
      [0, 2], [0, 9], [1, 1], [1, 5],
    ]);
  });

  it('returns the same array reference (sorts in place)', () => {
    const entries: MergeEntry[] = [{ f: 0, ln: 0, ms: 2 }, { f: 0, ln: 1, ms: 1 }];
    expect(sortMergeEntries(entries)).toBe(entries);
    expect(entries[0].ms).toBe(1);
  });
});
