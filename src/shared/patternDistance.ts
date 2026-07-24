// Pure "pattern distance" maths, shared by the Search Configs distance tool and the
// right-click Pattern Distance explorer in the renderer. Kept free of any DOM / IPC so it
// can be unit-tested directly (see src/tests/patternDistance.test.ts).
//
// A "gap" is a distance in line numbers between a hit of pattern A ("from") and a hit of
// pattern B ("to"). Inputs are arrays of 0-based line numbers; `to` MUST be sorted
// ascending (callers sort once before calling).

export interface DistPair {
  a: number;   // a line where pattern A matched
  b: number;   // the chosen line where pattern B matched
  gap: number; // |a - b|
}

export type DistanceDirection = 'nearest' | 'after' | 'before';

// For each value in `from`, the smallest |from - to| against the sorted `to` array
// (binary search for the insertion point, then check the two straddling neighbours).
export function nearestLineGaps(from: number[], to: number[]): DistPair[] {
  const pairs: DistPair[] = [];
  if (to.length === 0) return pairs;
  for (const a of from) {
    let lo = 0, hi = to.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (to[mid] < a) lo = mid + 1; else hi = mid; }
    let best = to[Math.min(lo, to.length - 1)];
    let bestGap = Math.abs(a - best);
    if (lo - 1 >= 0) {
      const g = Math.abs(a - to[lo - 1]);
      if (g < bestGap) { bestGap = g; best = to[lo - 1]; }
    }
    pairs.push({ a, b: best, gap: bestGap });
  }
  return pairs;
}

// Directional gaps. 'nearest' = either side (delegates above); 'after' = the smallest
// b >= a (the next B downstream of A); 'before' = the largest b <= a (the previous B
// upstream of A). Anchor hits with no qualifying B on the requested side are dropped
// (correct: "there is no next B after this A").
export function directionalLineGaps(from: number[], to: number[], dir: DistanceDirection): DistPair[] {
  if (dir === 'nearest') return nearestLineGaps(from, to);
  const pairs: DistPair[] = [];
  if (to.length === 0) return pairs;
  for (const a of from) {
    let lo = 0, hi = to.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (to[mid] < a) lo = mid + 1; else hi = mid; }
    // to[lo] is the first value >= a; to[lo-1] is the last value < a.
    if (dir === 'after') {
      if (lo < to.length) pairs.push({ a, b: to[lo], gap: to[lo] - a });
    } else {
      let idx = -1;
      if (lo < to.length && to[lo] === a) idx = lo;
      else if (lo - 1 >= 0) idx = lo - 1;
      if (idx >= 0) pairs.push({ a, b: to[idx], gap: a - to[idx] });
    }
  }
  return pairs;
}

export interface GapStats {
  n: number;
  min: number;
  max: number;
  mean: number;    // rounded
  median: number;  // rounded
}

// Summary stats over a list of gaps. Sorts a copy, so the caller's array is untouched.
export function summarizeGaps(gaps: number[]): GapStats {
  const sorted = gaps.slice().sort((x, y) => x - y);
  const n = sorted.length;
  if (n === 0) return { n: 0, min: 0, max: 0, mean: 0, median: 0 };
  const min = sorted[0];
  const max = sorted[n - 1];
  const mean = Math.round(sorted.reduce((s, g) => s + g, 0) / n);
  const median = n % 2 ? sorted[(n - 1) / 2] : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
  return { n, min, max, mean, median };
}

// Percentage (0-100, rounded) of gaps that are <= t lines.
export function pctWithin(gaps: number[], t: number): number {
  if (gaps.length === 0) return 0;
  return Math.round(100 * gaps.filter(g => g <= t).length / gaps.length);
}
