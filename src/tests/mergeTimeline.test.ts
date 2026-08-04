import { describe, it, expect } from 'vitest';
import { carryForwardTimestamps, buildOriginTags, formatWallClock } from '../main/mergeTimeline';

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
