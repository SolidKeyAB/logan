// Column-structure detection — pure, testable helpers used by the `analyze-columns`
// IPC (src/main/index.ts). Split out of index.ts so the delimiter + header heuristics
// can be unit-tested directly (they used to be private functions in the main process).
//
// Two jobs:
//   1. detectDelimiter()  — pick how a line splits into columns. Beyond the single-char
//      delimiters (tab/comma/pipe/…) it also distinguishes SINGLE-space (\s+) from
//      MULTI-space / whitespace-ALIGNED (\s{2,}) columns. Fixed-width & esotrace-style
//      exports only yield a stable column count under \s{2,}, because a "date time" pair
//      and a free-text trailing field contain single spaces that must stay INSIDE a cell.
//   2. findHeaderRow()    — locate the column-title row among the first few rows (not just
//      row 0, which is often a banner), using a header's defining signal: its cells are all
//      LABELS while the data rows below carry typed values (numbers/timestamps) in the same
//      columns (type contrast), reinforced by recognizable header keywords.

// Sentinel delimiter meaning "split on runs of >=2 whitespace" (columns are space-ALIGNED,
// single spaces stay within a cell). A two-space string can't collide with a real single-char
// delimiter and reads naturally where the delimiter is inspected.
export const MULTISPACE_DELIM = '  ';

// Recognizable column-header words (normalized: lowercase, alnum only). A row carrying
// >=2 of these is almost certainly a header — this is what lets us auto-propose a named
// layout (incl. esotrace "PacketID SessionID Label LoggerTime … Channel Source Level").
export const HEADER_WORDS = new Set([
  'packetid', 'sessionid', 'session', 'timestamp', 'time', 'date', 'datetime', 'loggertime',
  'tracetime', 'uptime', 'level', 'severity', 'loglevel', 'priority', 'message', 'msg', 'text',
  'content', 'description', 'source', 'process', 'thread', 'origin', 'class', 'channel',
  'component', 'module', 'category', 'logger', 'id', 'name', 'label', 'tag', 'pid', 'tid',
  'function', 'func', 'file', 'line', 'event', 'status', 'code', 'type', 'seq', 'index', 'ts',
  'privflag', 'size',
]);

// A leading banner / comment / rule line that shouldn't skew delimiter detection or pose as
// the header. Covers esotrace "#----- BEGIN:" / "#----- END:", "# comment", "// comment",
// ";" ini-style, and pure separator rules ("======", "------").
export function isCommentOrBanner(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith('#') || t.startsWith('//') || t.startsWith(';')) return true;
  if (/^[-=*_~+.]{4,}$/.test(t)) return true;
  return false;
}

function isTimestampish(v: string): boolean {
  return /\d{1,2}[:.]\d{2}([:.]\d{2})?/.test(v) || /\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v);
}

// A "label" cell: non-empty, not a pure number, not a date/time. Header cells are labels;
// the data below them is (mostly) typed values — that contrast is the header signal.
export function isLabelish(v: string): boolean {
  const t = v.trim();
  if (t.length === 0) return false;
  if (!isNaN(Number(t))) return false; // pure number
  if (isTimestampish(t)) return false;  // date / time
  return true;
}

// Measure how consistent a whitespace splitter is across the sample: average column count
// and the fraction of lines within ±1 of it. A high-consistency, multi-column result means
// that splitter genuinely describes the format.
function wsConsistency(lines: string[], splitter: RegExp): { avg: number; cons: number } {
  const counts = lines
    .map(l => { const t = l.trim(); return t.length ? t.split(splitter).length : 0; })
    .filter(c => c > 0);
  if (counts.length === 0) return { avg: 0, cons: 0 };
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const cons = counts.filter(c => Math.abs(c - avg) <= 1).length / counts.length;
  return { avg, cons };
}

// Detect the column delimiter for a set of sample lines (comment/banner lines should be
// stripped by the caller first). Returns the delimiter string + a human name.
export function detectDelimiter(lines: string[]): { delimiter: string; name: string } {
  const candidates = [
    { char: '\t', name: 'Tab' },
    { char: ',', name: 'Comma' },
    { char: '|', name: 'Pipe' },
    { char: ';', name: 'Semicolon' },
    { char: ':', name: 'Colon' },
    { char: '=', name: 'Equals' },
  ];

  const scores = new Map<string, number>();
  for (const { char } of candidates) {
    const escapedChar = char === '|' ? '\\|' : char;
    const counts = lines.map(line => (line.match(new RegExp(escapedChar, 'g')) || []).length);
    const nonZeroCounts = counts.filter(c => c > 0);
    if (nonZeroCounts.length === 0) continue;

    const avgCount = nonZeroCounts.reduce((a, b) => a + b, 0) / nonZeroCounts.length;
    const consistency = nonZeroCounts.filter(c => Math.abs(c - avgCount) <= 1).length / nonZeroCounts.length;
    let score = avgCount * consistency * (nonZeroCounts.length / lines.length);

    // Colon heuristic: penalize if it looks like clock timestamps (e.g. 10:30:45).
    if (char === ':' && avgCount <= 3) {
      const timestampPattern = /\d{1,2}:\d{2}/;
      const timestampLines = lines.filter(l => timestampPattern.test(l)).length;
      if (timestampLines / lines.length > 0.8) score *= 0.3;
    }
    scores.set(char, score);
  }

  let bestDelimiter = { char: ' ', name: 'Space' };
  let bestScore = 0;
  for (const { char, name } of candidates) {
    const score = scores.get(char) || 0;
    if (score > bestScore && score > 1) { bestScore = score; bestDelimiter = { char, name }; }
  }

  // Score multi-space / whitespace-ALIGNED (\s{2,}) columns on the SAME scale as the single-char
  // delimiters — (columns-1) stands in for delimiter-count — so an aligned format wins even when
  // its data cells are full of an incidental character (e.g. colons inside timestamps and
  // "[16388:1:0]" ids would otherwise make ':' look like the delimiter). Only considered when it
  // yields >=2 columns and is highly consistent; single-spaced prose collapses to 1 column here
  // and never qualifies, leaving ordinary single-space logs on the Space path below.
  const multi = wsConsistency(lines, /\s{2,}/);
  const presentMulti = lines.filter(l => l.trim().split(/\s{2,}/).length >= 2).length / lines.length;
  const multiScore = multi.avg >= 2 && multi.cons >= 0.7 ? (multi.avg - 1) * multi.cons * presentMulti : 0;
  if (multiScore > bestScore && multiScore > 1) {
    return { delimiter: MULTISPACE_DELIM, name: 'Whitespace-aligned' };
  }

  return { delimiter: bestDelimiter.char, name: bestDelimiter.name };
}

export interface HeaderResult { headerIndex: number; names: string[]; confident: boolean }

// Find the header (column-title) row among the first few already-split rows. A header row is
// one whose cells are ALL labels, are (mostly) unique, and whose shape matches the data below;
// it's `confident` when it carries recognizable header keywords and/or shows strong type
// contrast against the first data row. Returns headerIndex = -1 when no header is present.
export function findHeaderRow(splitLines: string[][]): HeaderResult {
  const scan = Math.min(splitLines.length, 6);
  let best = { headerIndex: -1, names: [] as string[], confident: false, score: -1 };

  for (let h = 0; h < scan; h++) {
    const row = (splitLines[h] || []).map(s => s.trim());
    if (row.length < 2) continue;
    if (!row.every(v => v.length > 0)) continue; // every header cell present
    if (!row.every(isLabelish)) continue;        // every header cell is a label (no numbers/timestamps)
    const uniqueEnough = new Set(row.map(v => v.toLowerCase())).size >= Math.ceil(row.length * 0.8);
    if (!uniqueEnough) continue;

    // First plausible data row below this candidate — must share its column shape.
    const below = splitLines.slice(h + 1).find(r => r.length >= 2);
    if (below && Math.abs(below.length - row.length) > 1) continue;

    // Type contrast: fraction of shared columns where the data cell below is NOT a label
    // (a number/timestamp) while the header cell is — the essence of "these are titles".
    let contrast = 0;
    if (below) {
      const m = Math.min(row.length, below.length);
      let c = 0;
      for (let i = 0; i < m; i++) if (!isLabelish(below[i])) c++;
      contrast = m > 0 ? c / m : 0;
    }

    const keywordHits = row.filter(v => HEADER_WORDS.has(v.toLowerCase().replace(/[^a-z0-9]/g, ''))).length;
    const confident = keywordHits >= 2 || (keywordHits >= 1 && contrast >= 0.3) || contrast >= 0.5;

    // Prefer keyword-rich, high-contrast, and EARLIER rows.
    const score = keywordHits * 2 + contrast * 3 + (below ? 1 : 0) - h * 0.5;
    if (score > best.score && (confident || contrast >= 0.3)) {
      best = { headerIndex: h, names: row, confident, score };
    }
  }

  if (best.headerIndex >= 0) {
    return { headerIndex: best.headerIndex, names: best.names, confident: best.confident };
  }

  // Loose positional fallback (preserves the old behaviour): row 0 all non-empty, non-numeric,
  // unique → treat as a header for sample-skipping, but never `confident`.
  const r0 = (splitLines[0] || []).map(s => s.trim());
  const loose = r0.length >= 2 && r0.every(v => v.length > 0) && r0.every(v => isNaN(Number(v)))
    && new Set(r0.map(v => v.toLowerCase())).size === r0.length;
  return { headerIndex: loose ? 0 : -1, names: loose ? r0 : [], confident: false };
}
