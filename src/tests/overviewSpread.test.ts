import { describe, it, expect } from 'vitest';
import { computeSubTimestampSpread } from '../shared/overviewSpread';

describe('computeSubTimestampSpread', () => {
  it('returns an empty map for no input', () => {
    expect(computeSubTimestampSpread([]).size).toBe(0);
  });

  it('leaves a lone line at its exact epoch (no spread)', () => {
    const m = computeSubTimestampSpread([{ ln: 5, ep: 1000 }]);
    expect(m.get(5)).toBe(1000);
  });

  it('keeps distinct-epoch lines exactly on their epoch when each is alone', () => {
    const m = computeSubTimestampSpread([
      { ln: 1, ep: 1000 },
      { ln: 2, ep: 2000 },
      { ln: 3, ep: 3000 },
    ]);
    expect(m.get(1)).toBe(1000);
    expect(m.get(2)).toBe(2000);
    expect(m.get(3)).toBe(3000);
  });

  it('spreads co-timestamped lines by line order, earliest line at the epoch', () => {
    // Three matches all at epoch 1000, next distinct epoch 2000 → gap 1000.
    const m = computeSubTimestampSpread([
      { ln: 30, ep: 1000 },
      { ln: 10, ep: 1000 },
      { ln: 20, ep: 1000 },
      { ln: 99, ep: 2000 },
    ]);
    // Ordered by LINE: 10 (frac 0) < 20 (frac .5) < 30 (frac 1).
    expect(m.get(10)).toBe(1000); // earliest line stays on the true epoch
    expect(m.get(20)).toBeCloseTo(1000 + 0.5 * 1000 * 0.85); // 1425
    expect(m.get(30)).toBeCloseTo(1000 + 1.0 * 1000 * 0.85); // 1850
    expect(m.get(10)!).toBeLessThan(m.get(20)!);
    expect(m.get(20)!).toBeLessThan(m.get(30)!);
  });

  it('never lets a spread point reach or cross the next distinct epoch', () => {
    const m = computeSubTimestampSpread([
      { ln: 1, ep: 1000 },
      { ln: 2, ep: 1000 },
      { ln: 3, ep: 1000 },
      { ln: 4, ep: 1000 },
      { ln: 5, ep: 1001 }, // gap of only 1ms
    ]);
    for (const ln of [1, 2, 3, 4]) {
      expect(m.get(ln)!).toBeGreaterThanOrEqual(1000);
      expect(m.get(ln)!).toBeLessThan(1001); // strictly below the next epoch
    }
    expect(m.get(5)).toBe(1001);
  });

  it('does not spread the final epoch group (keeps keys within [min,max])', () => {
    const m = computeSubTimestampSpread([
      { ln: 1, ep: 1000 },
      { ln: 2, ep: 2000 },
      { ln: 3, ep: 2000 }, // last group, no next epoch → gap 0
    ]);
    expect(m.get(2)).toBe(2000);
    expect(m.get(3)).toBe(2000);
    // Every effective key stays inside the raw epoch domain.
    const max = Math.max(...[...m.values()]);
    const min = Math.min(...[...m.values()]);
    expect(max).toBeLessThanOrEqual(2000);
    expect(min).toBeGreaterThanOrEqual(1000);
  });

  it('is deterministic and independent of input order (cross-lane alignment)', () => {
    const a = computeSubTimestampSpread([
      { ln: 3, ep: 1000 },
      { ln: 1, ep: 1000 },
      { ln: 2, ep: 1000 },
      { ln: 9, ep: 5000 },
    ]);
    const b = computeSubTimestampSpread([
      { ln: 9, ep: 5000 },
      { ln: 2, ep: 1000 },
      { ln: 3, ep: 1000 },
      { ln: 1, ep: 1000 },
    ]);
    for (const ln of [1, 2, 3, 9]) expect(a.get(ln)).toBe(b.get(ln));
  });

  it('gives the same line the same key regardless of neighbouring lines (identical events align)', () => {
    // Lane A sees lines 10 and 40 at epoch 1000; lane B sees 10, 25, 40 at 1000.
    // Line 10 is the earliest in both → must map identically (offset 0).
    const laneA = computeSubTimestampSpread([
      { ln: 10, ep: 1000 },
      { ln: 40, ep: 1000 },
      { ln: 50, ep: 2000 },
    ]);
    const laneB = computeSubTimestampSpread([
      { ln: 10, ep: 1000 },
      { ln: 25, ep: 1000 },
      { ln: 40, ep: 1000 },
      { ln: 50, ep: 2000 },
    ]);
    // The earliest line at a shared epoch is offset 0 in any grouping.
    expect(laneA.get(10)).toBe(1000);
    expect(laneB.get(10)).toBe(1000);
    // NOTE: callers pass the GLOBAL match set (union of all lanes), so both
    // lanes read from one shared map — this test documents the offset-0 anchor.
  });
});
