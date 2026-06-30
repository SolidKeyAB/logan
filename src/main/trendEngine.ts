// Trend Engine — the shared foundation for LOGAN's trend/correlation analysis.
//
// Everything the "Trends" notebook cells need sits on this one module:
//   - field extraction  : pull key=value / key: value / JSON fields out of any log line
//   - auto-typing       : classify each field as numeric / boolean / string / array / timestamp
//   - time bucketing    : aggregate a field's values into adaptive time buckets (value-over-time)
//   - transitions       : detect when a field's value CHANGES line-to-line (the "flip" timeline)
//   - correlation       : cross-tab a field's distribution by whether an "event" is present
//
// The engine reads through a FileHandler (so it respects the currently-open file's line
// index) and takes a timestamp parser callback so it can reuse the main process's parser
// without a circular import.

import { FileHandler } from './fileHandler';

export type FieldType = 'numeric' | 'boolean' | 'string' | 'array' | 'timestamp';

// A parsed timestamp, matching parseTimestampFast()'s shape in index.ts.
export type TsParser = (text: string) => { date: Date; str: string } | null;

export interface FieldSpec {
  name: string;
  type: FieldType;
  occurrences: number;    // sampled lines that contained this field
  distinct: number;       // distinct raw values seen in the sample
  examples: string[];     // up to 3 example raw values
}

export interface TrendPoint {
  lineNumber: number;     // 0-based (internal)
  viewerLine: number;     // 1-based (as shown in the viewer)
  epochMs: number | null; // null when the line has no parseable timestamp
  raw: string;            // raw value as it appeared
  num: number | null;     // parsed numeric value (numeric fields only)
}

export interface TimeBucket {
  startMs: number;
  endMs: number;
  count: number;
  // numeric aggregates (numeric fields only)
  sum?: number;
  min?: number;
  max?: number;
  avg?: number;
  // categorical breakdown (string/boolean fields): value -> count, top entries only
  values?: Record<string, number>;
}

export interface Transition {
  lineNumber: number;
  viewerLine: number;
  epochMs: number | null;
  fromValue: string;
  toValue: string;
}

// ── Field extraction ────────────────────────────────────────────────────────

// key=value  (value may be "quoted", 'quoted', [array], {obj}, or a bare token)
const KV_EQ = /([A-Za-z_][\w.\-]*)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|\[[^\]]*\]|\{[^}]*\}|[^\s,;]+)/g;
// key: value  (key must START with a letter, so a bare time like 12:34:56 never matches)
const KV_COLON = /([A-Za-z_][\w.\-]*)\s*:\s*("(?:[^"\\]|\\.)*"|'[^']*'|\[[^\]]*\]|[^\s,;]+)/g;

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    const a = v[0], b = v[v.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return v.slice(1, -1);
  }
  return v;
}

// Extract every field=value pair from a single line into a flat map.
// JSON object lines are flattened one level; otherwise key=value and key: value are scanned.
export function extractFields(line: string): Map<string, string> {
  const out = new Map<string, string>();
  const trimmed = line.trim();

  // JSON object line → flatten top-level scalar fields
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          if (v === null || v === undefined) continue;
          out.set(k, Array.isArray(v) ? JSON.stringify(v) : String(typeof v === 'object' ? JSON.stringify(v) : v));
        }
        if (out.size > 0) return out;
      }
    } catch { /* fall through to regex scan */ }
  }

  let m: RegExpExecArray | null;
  KV_EQ.lastIndex = 0;
  while ((m = KV_EQ.exec(line)) !== null) {
    if (!out.has(m[1])) out.set(m[1], stripQuotes(m[2]));
  }
  KV_COLON.lastIndex = 0;
  while ((m = KV_COLON.exec(line)) !== null) {
    // don't let key:value clobber a key=value already captured
    if (!out.has(m[1])) out.set(m[1], stripQuotes(m[2]));
  }
  return out;
}

// Build a per-line value extractor. Two modes:
//   - keyed   (simple users): pull `fieldName` out of the key=value/JSON map
//   - pattern (advanced users): a regex with a capture group; the value is the
//     first capture group (or the whole match if the regex has no groups).
//     This reaches UNLABELED positional values like `... in 230ms` via /in (\d+)ms/.
export type ValueExtractor = (text: string) => string | undefined;

export function makeExtractor(opts: { field?: string; pattern?: string; patternFlags?: string }): ValueExtractor {
  if (opts.pattern) {
    const re = new RegExp(opts.pattern, opts.patternFlags ?? '');
    return (text: string) => {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (!m) return undefined;
      return m[1] !== undefined ? m[1] : m[0];
    };
  }
  const field = opts.field;
  if (!field) throw new Error('makeExtractor requires either field or pattern');
  return (text: string) => extractFields(text).get(field);
}

const NUMERIC_RE = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const BOOL_RE = /^(true|false)$/i;

export function classifyValue(raw: string): FieldType {
  if (BOOL_RE.test(raw)) return 'boolean';
  if (NUMERIC_RE.test(raw)) return 'numeric';
  if (raw.startsWith('[') && raw.endsWith(']')) return 'array';
  return 'string';
}

function toNum(raw: string): number | null {
  if (!NUMERIC_RE.test(raw)) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

// ── Line scanning helper ─────────────────────────────────────────────────────

const BATCH = 4000;            // lines read per getLines() call
const DEFAULT_MAX_SCAN = 2_000_000;

interface ScanRange {
  startLine?: number;          // 0-based inclusive; default 0
  endLine?: number;            // 0-based inclusive; default last line
  maxScan?: number;            // safety cap on lines scanned
}

// Walk lines in [startLine, endLine], calling fn for each. Returns whether the
// scan was truncated by maxScan.
function scanLines(
  handler: FileHandler,
  range: ScanRange,
  fn: (lineNumber: number, text: string) => void,
): { scanned: number; truncated: boolean } {
  const total = handler.getTotalLines();
  const start = Math.max(0, range.startLine ?? 0);
  const end = Math.min(total - 1, range.endLine ?? total - 1);
  const maxScan = range.maxScan ?? DEFAULT_MAX_SCAN;
  let scanned = 0;
  let truncated = false;

  for (let i = start; i <= end; i += BATCH) {
    const count = Math.min(BATCH, end - i + 1);
    const lines = handler.getLines(i, count);
    for (const ln of lines) {
      if (scanned >= maxScan) { truncated = true; break; }
      fn(ln.lineNumber, ln.text);
      scanned++;
    }
    if (truncated) break;
  }
  return { scanned, truncated };
}

// ── 1. Field discovery ───────────────────────────────────────────────────────

// Sample lines spread evenly across the range and report which fields exist,
// their inferred type, and how common they are. This drives the cell UI's field
// picker and lets the agent see what's worth trending.
export function discoverFields(
  handler: FileHandler,
  opts: ScanRange & { sampleSize?: number } = {},
): FieldSpec[] {
  const total = handler.getTotalLines();
  if (total === 0) return [];
  const start = Math.max(0, opts.startLine ?? 0);
  const end = Math.min(total - 1, opts.endLine ?? total - 1);
  const span = end - start + 1;
  const sampleSize = Math.min(opts.sampleSize ?? 3000, span);
  const step = Math.max(1, Math.floor(span / sampleSize));

  // field -> { typeCounts, occurrences, distinct values (capped), examples }
  const acc = new Map<string, {
    types: Record<FieldType, number>;
    occ: number;
    distinct: Set<string>;
    examples: string[];
  }>();

  for (let s = 0; s < sampleSize; s++) {
    const lineIdx = start + s * step;
    const [ln] = handler.getLines(lineIdx, 1);
    if (!ln) continue;
    const fields = extractFields(ln.text);
    for (const [name, raw] of fields) {
      let entry = acc.get(name);
      if (!entry) {
        entry = { types: { numeric: 0, boolean: 0, string: 0, array: 0, timestamp: 0 }, occ: 0, distinct: new Set(), examples: [] };
        acc.set(name, entry);
      }
      entry.occ++;
      entry.types[classifyValue(raw)]++;
      if (entry.distinct.size < 1000) entry.distinct.add(raw);
      if (entry.examples.length < 3 && !entry.examples.includes(raw)) entry.examples.push(raw);
    }
  }

  const specs: FieldSpec[] = [];
  for (const [name, e] of acc) {
    // majority type wins
    let type: FieldType = 'string';
    let best = -1;
    for (const t of Object.keys(e.types) as FieldType[]) {
      if (e.types[t] > best) { best = e.types[t]; type = t; }
    }
    specs.push({ name, type, occurrences: e.occ, distinct: e.distinct.size, examples: e.examples });
  }
  // most-common fields first
  specs.sort((a, b) => b.occurrences - a.occurrences);
  return specs;
}

// ── 2. Value-over-time series + adaptive time buckets ────────────────────────

export interface SeriesResult {
  field: string;
  type: FieldType;
  totalPoints: number;
  withTimestamp: number;
  truncated: boolean;
  timeRange: { startMs: number; endMs: number } | null;
  buckets: TimeBucket[];
  // a capped, evenly-sampled set of raw points for click-to-line + scatter
  points: TrendPoint[];
}

export function extractSeries(
  handler: FileHandler,
  parseTs: TsParser,
  fieldName: string,
  opts: ScanRange & { bucketCount?: number; maxPoints?: number; pattern?: string; patternFlags?: string } = {},
): SeriesResult {
  const bucketCount = Math.min(Math.max(opts.bucketCount ?? 200, 10), 2000);
  const maxPoints = opts.maxPoints ?? 5000;
  const extract = makeExtractor({ field: fieldName, pattern: opts.pattern, patternFlags: opts.patternFlags });

  const collected: TrendPoint[] = [];
  const typeRef: { v: FieldType | null } = { v: null };
  let withTimestamp = 0;
  let minMs = Infinity, maxMs = -Infinity;

  const { truncated } = scanLines(handler, opts, (lineNumber, text) => {
    const raw = extract(text);
    if (raw === undefined) return;
    if (typeRef.v === null) typeRef.v = classifyValue(raw);
    const ts = parseTs(text);
    const epochMs = ts ? ts.date.getTime() : null;
    if (epochMs !== null) {
      withTimestamp++;
      if (epochMs < minMs) minMs = epochMs;
      if (epochMs > maxMs) maxMs = epochMs;
    }
    collected.push({ lineNumber, viewerLine: lineNumber + 1, epochMs, raw, num: toNum(raw) });
  });

  const effType: FieldType = typeRef.v ?? 'string';
  const timeRange = (minMs !== Infinity && maxMs !== minMs)
    ? { startMs: minMs, endMs: maxMs }
    : (minMs !== Infinity ? { startMs: minMs, endMs: minMs + 1 } : null);

  // Build adaptive time buckets over points that have a timestamp.
  const buckets: TimeBucket[] = [];
  if (timeRange) {
    const span = Math.max(1, timeRange.endMs - timeRange.startMs);
    const width = span / bucketCount;
    for (let i = 0; i < bucketCount; i++) {
      buckets.push({ startMs: timeRange.startMs + i * width, endMs: timeRange.startMs + (i + 1) * width, count: 0 });
    }
    for (const p of collected) {
      if (p.epochMs === null) continue;
      let idx = Math.floor((p.epochMs - timeRange.startMs) / width);
      if (idx < 0) idx = 0; if (idx >= bucketCount) idx = bucketCount - 1;
      const b = buckets[idx];
      b.count++;
      if (effType === 'numeric' && p.num !== null) {
        b.sum = (b.sum ?? 0) + p.num;
        b.min = b.min === undefined ? p.num : Math.min(b.min, p.num);
        b.max = b.max === undefined ? p.num : Math.max(b.max, p.num);
      } else {
        if (!b.values) b.values = {};
        b.values[p.raw] = (b.values[p.raw] ?? 0) + 1;
      }
    }
    for (const b of buckets) {
      if (b.sum !== undefined && b.count > 0) b.avg = b.sum / b.count;
      // keep only the top 8 categorical values per bucket to bound payload size
      if (b.values) b.values = topN(b.values, 8);
    }
  }

  // Cap raw points by even sampling so the payload stays small.
  let points = collected;
  if (collected.length > maxPoints) {
    const step = collected.length / maxPoints;
    points = [];
    for (let i = 0; i < maxPoints; i++) points.push(collected[Math.floor(i * step)]);
  }

  return {
    field: fieldName,
    type: effType,
    totalPoints: collected.length,
    withTimestamp,
    truncated,
    timeRange,
    buckets,
    points,
  };
}

function topN(rec: Record<string, number>, n: number): Record<string, number> {
  const sorted = Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n);
  return Object.fromEntries(sorted);
}

// ── 2b. Multi-signal aligned series (Signals overlay viz) ────────────────────

export interface SignalSeries {
  field: string;
  type: FieldType;
  values: (number | null)[];   // avg per emitted bucket (null = no sample in bucket)
  min: (number | null)[];      // per-bucket min (spike-preserving band)
  max: (number | null)[];      // per-bucket max
  viewerLines: number[];       // representative 1-based line per bucket (click→line)
  globalMin: number;           // for normalize / autoscale
  globalMax: number;
  present: number;             // total records that had this field
}

export interface SignalSeriesResult {
  x: { field: string; values: number[]; isIndex: boolean }; // shared axis (t, or record index fallback)
  series: SignalSeries[];
  totalRecords: number;        // lines that carried an x value
  buckets: number;             // emitted bucket count (≤ maxPoints)
  truncated: boolean;
}

/**
 * Read the file ONCE and return several fields ALIGNED on a shared x axis
 * (default the `t` master), downsampled to ~maxPoints buckets so a multi-million
 * record MF4 stays smooth. Records are file-ordered and `t` is monotonic, so we
 * bucket by record index (cheap, no second pass) and keep min/max/avg per bucket
 * to preserve spikes. If a line has no `t`, the record index is used as x.
 */
export function extractSignalSeries(
  handler: FileHandler,
  fields: string[],
  opts: ScanRange & { xField?: string; maxPoints?: number } = {},
): SignalSeriesResult {
  const xField = opts.xField ?? 't';
  const maxPoints = Math.min(Math.max(opts.maxPoints ?? 4000, 100), 20000);
  const total = handler.getTotalLines();
  const start = Math.max(0, opts.startLine ?? 0);
  const end = Math.min(total - 1, opts.endLine ?? total - 1);
  const span = Math.max(1, end - start + 1);
  const bucketSize = Math.max(1, Math.ceil(span / maxPoints));
  const nBuckets = Math.ceil(span / bucketSize);

  // Per-bucket accumulators for the x axis.
  const xSum = new Float64Array(nBuckets);
  const xCnt = new Int32Array(nBuckets);
  const repLine = new Int32Array(nBuckets); // representative 1-based line per bucket
  let sawRealX = false;

  // Per-signal accumulators.
  const accs = fields.map(() => ({
    sum: new Float64Array(nBuckets),
    cnt: new Int32Array(nBuckets),
    min: new Float64Array(nBuckets).fill(Infinity),
    max: new Float64Array(nBuckets).fill(-Infinity),
    type: null as FieldType | null,
    present: 0,
  }));

  let totalRecords = 0;
  const { truncated } = scanLines(
    handler,
    { startLine: start, endLine: end, maxScan: opts.maxScan ?? 50_000_000 },
    (lineNumber, text) => {
      const map = extractFields(text);
      if (map.size === 0) return;
      const relIdx = lineNumber - start;
      let bucket = Math.floor(relIdx / bucketSize);
      if (bucket < 0) bucket = 0; else if (bucket >= nBuckets) bucket = nBuckets - 1;

      // x value: the master field if numeric, else the record index.
      const xRaw = map.get(xField);
      const xNum = xRaw !== undefined ? toNum(xRaw) : null;
      const x = xNum !== null ? (sawRealX = true, xNum) : relIdx;
      xSum[bucket] += x;
      xCnt[bucket]++;
      if (repLine[bucket] === 0) repLine[bucket] = lineNumber + 1;
      totalRecords++;

      for (let f = 0; f < fields.length; f++) {
        const raw = map.get(fields[f]);
        if (raw === undefined) continue;
        const n = toNum(raw);
        if (n === null) continue;
        const a = accs[f];
        if (a.type === null) a.type = classifyValue(raw);
        a.sum[bucket] += n;
        a.cnt[bucket]++;
        if (n < a.min[bucket]) a.min[bucket] = n;
        if (n > a.max[bucket]) a.max[bucket] = n;
        a.present++;
      }
    },
  );

  // Compact to buckets that actually have an x sample, preserving order.
  const xValues: number[] = [];
  const keep: number[] = [];
  for (let b = 0; b < nBuckets; b++) {
    if (xCnt[b] > 0) { keep.push(b); xValues.push(xSum[b] / xCnt[b]); }
  }

  const series: SignalSeries[] = fields.map((field, f) => {
    const a = accs[f];
    const values: (number | null)[] = [];
    const minA: (number | null)[] = [];
    const maxA: (number | null)[] = [];
    const viewerLines: number[] = [];
    let gMin = Infinity, gMax = -Infinity;
    for (const b of keep) {
      viewerLines.push(repLine[b] || 1);
      if (a.cnt[b] > 0) {
        const avg = a.sum[b] / a.cnt[b];
        values.push(avg);
        minA.push(a.min[b]);
        maxA.push(a.max[b]);
        if (a.min[b] < gMin) gMin = a.min[b];
        if (a.max[b] > gMax) gMax = a.max[b];
      } else {
        values.push(null); minA.push(null); maxA.push(null);
      }
    }
    return {
      field,
      type: a.type ?? 'numeric',
      values, min: minA, max: maxA, viewerLines,
      globalMin: gMin === Infinity ? 0 : gMin,
      globalMax: gMax === -Infinity ? 0 : gMax,
      present: a.present,
    };
  });

  return {
    x: { field: sawRealX ? xField : 'index', values: xValues, isIndex: !sawRealX },
    series,
    totalRecords,
    buckets: xValues.length,
    truncated,
  };
}

// ── 3. Transition ("flip") detection ─────────────────────────────────────────

export interface TransitionResult {
  field: string;
  type: FieldType;
  transitions: Transition[];
  totalTransitions: number;
  truncated: boolean;
}

// Detect every point where the field's value changes from one occurrence to the
// next. Works for ANY type via string equality (arrays compared by their raw
// form, so element add/remove shows as a flip too).
export function detectTransitions(
  handler: FileHandler,
  parseTs: TsParser,
  fieldName: string,
  opts: ScanRange & { maxTransitions?: number; pattern?: string; patternFlags?: string } = {},
): TransitionResult {
  const maxTransitions = opts.maxTransitions ?? 2000;
  const extract = makeExtractor({ field: fieldName, pattern: opts.pattern, patternFlags: opts.patternFlags });
  const transitions: Transition[] = [];
  let type: FieldType | null = null;
  let last: string | null = null;
  let total = 0;
  let capped = false;

  const { truncated } = scanLines(handler, opts, (lineNumber, text) => {
    const raw = extract(text);
    if (raw === undefined) return;
    if (type === null) type = classifyValue(raw);
    if (last !== null && raw !== last) {
      total++;
      if (transitions.length < maxTransitions) {
        const ts = parseTs(text);
        transitions.push({
          lineNumber,
          viewerLine: lineNumber + 1,
          epochMs: ts ? ts.date.getTime() : null,
          fromValue: last,
          toValue: raw,
        });
      } else {
        capped = true;
      }
    }
    last = raw;
  });

  return { field: fieldName, type: type ?? 'string', transitions, totalTransitions: total, truncated: truncated || capped };
}

// ── 4. Correlation / cross-tab ────────────────────────────────────────────────

export interface CorrelateResult {
  field: string;
  fieldType: FieldType;
  event: string;
  matchedLines: number;
  unmatchedLines: number;
  truncated: boolean;
  // numeric fields: stats of the field grouped by event present/absent
  numericStats?: {
    matched: NumStats | null;
    unmatched: NumStats | null;
  };
  // categorical fields: value distribution grouped by event present/absent
  categorical?: {
    matched: Record<string, number>;
    unmatched: Record<string, number>;
  };
}

interface NumStats { n: number; min: number; max: number; mean: number; }

// Cross-tab a field against an "event": for lines where `event` (a substring,
// case-insensitive) is present vs absent, summarize the field's values. Answers
// "when X fires, what is v? when it doesn't, what is v?" on a single-line basis.
export function correlate(
  handler: FileHandler,
  fieldName: string,
  event: string,
  opts: ScanRange & { pattern?: string; patternFlags?: string } = {},
): CorrelateResult {
  const needle = event.toLowerCase();
  const extract = makeExtractor({ field: fieldName, pattern: opts.pattern, patternFlags: opts.patternFlags });
  const typeRef: { v: FieldType | null } = { v: null };
  let matchedLines = 0, unmatchedLines = 0;

  const mNums: number[] = [], uNums: number[] = [];
  const mCat: Record<string, number> = {}, uCat: Record<string, number> = {};

  const { truncated } = scanLines(handler, opts, (_lineNumber, text) => {
    const raw = extract(text);
    if (raw === undefined) return;
    if (typeRef.v === null) typeRef.v = classifyValue(raw);
    const matched = text.toLowerCase().includes(needle);
    if (matched) matchedLines++; else unmatchedLines++;

    const n = toNum(raw);
    if (typeRef.v === 'numeric' && n !== null) {
      (matched ? mNums : uNums).push(n);
    } else {
      const bucket = matched ? mCat : uCat;
      bucket[raw] = (bucket[raw] ?? 0) + 1;
    }
  });

  const effType: FieldType = typeRef.v ?? 'string';
  const result: CorrelateResult = {
    field: fieldName,
    fieldType: effType,
    event,
    matchedLines,
    unmatchedLines,
    truncated,
  };
  if (effType === 'numeric') {
    result.numericStats = { matched: numStats(mNums), unmatched: numStats(uNums) };
  } else {
    result.categorical = { matched: topN(mCat, 15), unmatched: topN(uCat, 15) };
  }
  return result;
}

function numStats(xs: number[]): NumStats | null {
  if (xs.length === 0) return null;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const x of xs) { if (x < min) min = x; if (x > max) max = x; sum += x; }
  return { n: xs.length, min, max, mean: sum / xs.length };
}
