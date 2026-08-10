// Severity index — a compact, sorted list of the log's fatal/error/warning line
// numbers, built ONCE (in the background) from a single ripgrep pass so the viewer
// can jump to the next/previous problem in O(log n) at 50M lines instead of
// scrolling. This module holds only the PURE logic (bucketing, binary-search
// navigation, minimap downsampling) so it is trivially unit-testable; the ripgrep
// scan that feeds it lives in FileHandler.

export type SeverityLevel = 'fatal' | 'error' | 'warning';

export interface SeverityIndex {
  fatal: Uint32Array;
  error: Uint32Array;
  warning: Uint32Array;
}

export const EMPTY_SEVERITY_INDEX: SeverityIndex = {
  fatal: new Uint32Array(0),
  error: new Uint32Array(0),
  warning: new Uint32Array(0),
};

// ripgrep alternation covering the fatal/error/warning keywords detectLevel() uses.
// Run case-insensitively with --only-matching so each hit yields just the keyword,
// which we rank below (a line matching several keeps the highest severity).
export const SEVERITY_RG_PATTERN =
  '\\b(FATAL|PANIC|EMERGENCY|EMERG|ERROR|CRITICAL|CRIT|SEVERE|EXCEPTION|WARN|WARNING|NOTICE)\\b';

// 3 = fatal, 2 = error, 1 = warning, 0 = not a severity keyword. Mirrors the
// precedence in FileHandler.detectLevel().
export function keywordRank(keyword: string): number {
  switch (keyword.toUpperCase()) {
    case 'FATAL': case 'PANIC': case 'EMERGENCY': case 'EMERG':
      return 3;
    case 'ERROR': case 'CRITICAL': case 'CRIT': case 'SEVERE': case 'EXCEPTION':
      return 2;
    case 'WARN': case 'WARNING': case 'NOTICE':
      return 1;
    default:
      return 0;
  }
}

export function rankToLevel(rank: number): SeverityLevel | null {
  return rank === 3 ? 'fatal' : rank === 2 ? 'error' : rank === 1 ? 'warning' : null;
}

// Turn a map of {visibleLine -> best rank} into three sorted typed arrays.
export function buildSeverityIndexFromMap(rankByLine: Map<number, number>): SeverityIndex {
  const fatal: number[] = [];
  const error: number[] = [];
  const warning: number[] = [];
  for (const [line, rank] of rankByLine) {
    if (rank === 3) fatal.push(line);
    else if (rank === 2) error.push(line);
    else if (rank === 1) warning.push(line);
  }
  fatal.sort((a, b) => a - b);
  error.sort((a, b) => a - b);
  warning.sort((a, b) => a - b);
  return {
    fatal: Uint32Array.from(fatal),
    error: Uint32Array.from(error),
    warning: Uint32Array.from(warning),
  };
}

// Smallest value strictly greater than `fromLine` (dir=1) or largest strictly less
// (dir=-1) in a sorted array, or null. Binary search — O(log n).
export function nextInSorted(arr: Uint32Array, fromLine: number, dir: 1 | -1): number | null {
  if (arr.length === 0) return null;
  if (dir === 1) {
    let lo = 0, hi = arr.length; // first index with arr[i] > fromLine
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] > fromLine) hi = mid; else lo = mid + 1; }
    return lo < arr.length ? arr[lo] : null;
  }
  let lo = 0, hi = arr.length; // first index with arr[i] >= fromLine
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] >= fromLine) hi = mid; else lo = mid + 1; }
  return lo > 0 ? arr[lo - 1] : null;
}

// Next/previous problem line across the selected severity levels combined.
export function nextSeverityLine(
  index: SeverityIndex,
  fromLine: number,
  dir: 1 | -1,
  levels: SeverityLevel[],
): number | null {
  let best: number | null = null;
  for (const lvl of levels) {
    const cand = nextInSorted(index[lvl], fromLine, dir);
    if (cand == null) continue;
    if (best == null) best = cand;
    else best = dir === 1 ? Math.min(best, cand) : Math.max(best, cand);
  }
  return best;
}

export interface SeverityCounts { fatal: number; error: number; warning: number; }

export function severityCounts(index: SeverityIndex): SeverityCounts {
  return { fatal: index.fatal.length, error: index.error.length, warning: index.warning.length };
}

// Downsample the index into `buckets` vertical slots (for a minimap/scrollbar
// overlay): each slot holds the HIGHEST severity rank (0..3) present in it, so a
// single fatal outranks the warnings around it. Compact (1 byte/slot).
export function severityTicks(index: SeverityIndex, buckets: number, totalLines: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, buckets));
  if (buckets <= 0 || totalLines <= 0) return out;
  const paint = (arr: Uint32Array, rank: number) => {
    for (let i = 0; i < arr.length; i++) {
      const b = Math.min(buckets - 1, Math.floor((arr[i] / totalLines) * buckets));
      if (rank > out[b]) out[b] = rank;
    }
  };
  paint(index.warning, 1);
  paint(index.error, 2);
  paint(index.fatal, 3);
  return out;
}
