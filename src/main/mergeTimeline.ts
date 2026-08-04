// Pure helpers for merging multiple log files onto one wall-clock timeline and
// writing the result to a new file with an origin column.
//
// Deliberately free of Electron / FileHandler dependencies so the ordering,
// carry-forward and labelling logic stays unit-testable in isolation. The IPC
// handler in index.ts reads each file's lines, parses their timestamps, then
// hands the raw per-line data to these functions.

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/**
 * Normalized local wall-clock string used as the leading merge-key column of
 * every emitted line: `YYYY-MM-DD HH:MM:SS.mmm`. Because it leads the line, a
 * re-opened merged file is still timestamp-parseable by LOGAN itself.
 */
export function formatWallClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Assign an effective wall-clock ms to every line of a SINGLE file:
 *  - a line WITH a parsed timestamp keeps it;
 *  - a line WITHOUT one inherits the most recent previous timestamp
 *    (carry-forward) so continuation lines — stack traces, wrapped messages —
 *    stay glued right after their anchor when everything is re-sorted by time;
 *  - leading untimestamped lines (before the file's first timestamp) inherit the
 *    file's FIRST timestamp so they cluster at that file's earliest moment
 *    rather than being lost.
 *
 * Returns an all-null array iff the file has NO timestamps at all — the caller
 * uses that to skip the file (it can't be placed on a shared timeline).
 */
export function carryForwardTimestamps(msPerLine: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(msPerLine.length).fill(null);
  let firstMs: number | null = null;
  for (const m of msPerLine) { if (m !== null) { firstMs = m; break; } }
  if (firstMs === null) return out; // no timestamps anywhere in this file
  let last: number | null = null;
  for (let i = 0; i < msPerLine.length; i++) {
    const m = msPerLine[i];
    if (m !== null) { last = m; out[i] = m; }
    else out[i] = last !== null ? last : firstMs;
  }
  return out;
}

/**
 * Human-readable origin tag per file: the basename by default. When two files
 * share a basename (same name in different folders) the colliding ones are
 * disambiguated with their parent directory so each origin column stays unique.
 */
export function buildOriginTags(paths: string[]): string[] {
  const base = paths.map(p => (p.split(/[\\/]/).pop() || p));
  const counts = new Map<string, number>();
  for (const b of base) counts.set(b, (counts.get(b) || 0) + 1);
  return base.map((b, i) => {
    if ((counts.get(b) || 0) <= 1) return b;
    const parts = paths[i].split(/[\\/]/).filter(Boolean);
    const parent = parts.length >= 2 ? parts[parts.length - 2] : String(i + 1);
    return `${parent}/${b}`;
  });
}
