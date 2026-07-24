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

// Map a boolean literal to 0/1 so boolean fields can be charted as a step line.
function boolNum(raw: string): number | null {
  if (/^true$/i.test(raw)) return 1;
  if (/^false$/i.test(raw)) return 0;
  return null;
}

// Numeric value for series/bucket math — numeric as-is, boolean as 0/1.
function seriesNum(raw: string): number | null {
  const n = toNum(raw);
  return n !== null ? n : boolNum(raw);
}

// ── X-axis selection ─────────────────────────────────────────────────────────
// What a series (and an overlay) plots against. 'time' is wall-clock (epoch ms);
// 'relative' is the leading seconds prefix logs like the decoded .esotrace stream
// carry; 'field' uses another field's value; 'line' is the always-available
// record-order fallback.
export type AxisSpec =
  | { kind: 'line' }
  | { kind: 'time' }
  | { kind: 'relative' }
  | { kind: 'field'; field: string; asTime?: boolean };

// How to label the axis downstream — mirrors AxisSpec.kind but collapses 'field'
// into whether it reads as a clock ('time') or a plain number.
export type XKind = 'time' | 'line' | 'relative' | 'number';

// Leading relative-seconds prefix, e.g. the decoded ".esotrace" line
// "296.041591 WARNING …". Anchored at line start so it never grabs a mid-line number.
const REL_SECONDS_RE = /^\s*(\d+(?:\.\d+)?)(?=\s)/;

// Build a function that returns the numeric X coordinate for a line under `spec`
// (or null when this line has no value on that axis).
export function makeAxisExtractor(
  spec: AxisSpec,
  parseTs: TsParser,
): (text: string, viewerLine: number) => number | null {
  switch (spec.kind) {
    case 'line':
      return (_t, vl) => vl;
    case 'time':
      return (t) => { const p = parseTs(t); return p ? p.date.getTime() : null; };
    case 'relative':
      return (t) => { const m = REL_SECONDS_RE.exec(t); return m ? parseFloat(m[1]) : null; };
    case 'field': {
      const ex = makeExtractor({ field: spec.field });
      return (t) => {
        const raw = ex(t);
        if (raw === undefined) return null;
        if (spec.asTime) {
          const p = parseTs(raw);
          if (p) return p.date.getTime();
        }
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };
    }
  }
}

function xKindOf(spec: AxisSpec): XKind {
  if (spec.kind === 'field') return spec.asTime ? 'time' : 'number';
  return spec.kind;
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

// ── X-axis discovery ─────────────────────────────────────────────────────────
// A single log line can carry several time-ish values that mean different things
// (the line's own clock, an embedded epoch, a device monotonic clock, plus plain
// durations that only *look* temporal). This enumerates every plausible X axis,
// ranks them by how clock-like they behave across the file, and always offers the
// line-number fallback — feeding the X-axis selector menu.

export interface AxisCandidate {
  id: string;            // stable id (also encodes the spec): 'line'|'time'|'relative'|'field:<name>'
  label: string;         // menu label
  spec: AxisSpec;        // reconstruct the axis for extractSeries({ xAxis })
  detail: string;        // 'record order'|'wall-clock'|'relative seconds'|'monotonic'|'numeric'
  coverage: number;      // fraction of sampled lines carrying a value (0..1)
  score: number;         // clock-likeness ranking (0..1); highest is the default
}

// Names that suggest a real clock vs. a duration/rate/counter that merely looks temporal.
const TEMPORAL_NAME_RE = /(^|[_.])(time|timestamp|ts|clock|epoch|date|uptime|monotonic|elapsedrealtime)($|[_.\d])/i;
const DURATION_NAME_RE = /(rate|hz|freq|fps|offset|deadline|duration|interval|latency|delay|timeout|period|count|nanos?|millis?|micros?)/i;

function axisStats(xs: (number | null)[]): { coverage: number; mono: number; spread: boolean } {
  let present = 0, pairs = 0, incr = 0, mn = Infinity, mx = -Infinity;
  let prev: number | null = null;
  for (const x of xs) {
    if (x === null) continue;
    present++;
    if (x < mn) mn = x; if (x > mx) mx = x;
    if (prev !== null) { pairs++; if (x >= prev) incr++; }
    prev = x;
  }
  return {
    coverage: xs.length ? present / xs.length : 0,
    mono: pairs ? incr / pairs : (present > 0 ? 1 : 0),   // fraction non-decreasing
    spread: mx > mn,
  };
}

export function discoverAxes(
  handler: FileHandler,
  parseTs: TsParser,
  opts: ScanRange & { sampleSize?: number } = {},
): AxisCandidate[] {
  const lineAxis: AxisCandidate = {
    id: 'line', label: 'Line number', spec: { kind: 'line' },
    detail: 'record order', coverage: 1, score: 0.15,   // modest, so real clocks win by default
  };
  const total = handler.getTotalLines();
  if (total === 0) return [lineAxis];

  // Sample lines (in order) so monotonicity is measured over real record order.
  const start = Math.max(0, opts.startLine ?? 0);
  const end = Math.min(total - 1, opts.endLine ?? total - 1);
  const span = end - start + 1;
  const sampleSize = Math.min(opts.sampleSize ?? 600, span);
  const step = Math.max(1, Math.floor(span / sampleSize));
  const texts: string[] = [];
  for (let s = 0; s < sampleSize; s++) {
    const [ln] = handler.getLines(start + s * step, 1);
    if (ln) texts.push(ln.text);
  }

  const out: AxisCandidate[] = [];

  // Wall-clock and leading relative-seconds are "real time" axes.
  const timeXs = texts.map(t => { const p = parseTs(t); return p ? p.date.getTime() : null; });
  const timeSt = axisStats(timeXs);
  if (timeSt.coverage >= 0.5 && timeSt.spread) {
    out.push({ id: 'time', label: 'Time (wall-clock)', spec: { kind: 'time' }, detail: 'wall-clock',
      coverage: timeSt.coverage, score: 0.9 + 0.1 * timeSt.mono });
  }
  const relXs = texts.map(t => { const m = REL_SECONDS_RE.exec(t); return m ? parseFloat(m[1]) : null; });
  const relSt = axisStats(relXs);
  if (relSt.coverage >= 0.5 && relSt.spread) {
    out.push({ id: 'relative', label: 'Time (relative s)', spec: { kind: 'relative' }, detail: 'relative seconds',
      coverage: relSt.coverage, score: 0.85 + 0.1 * relSt.mono });
  }

  // Field candidates: numeric/timestamp-typed or temporally-named fields.
  for (const f of discoverFields(handler, { startLine: start, endLine: end, sampleSize: Math.min(1500, span) })) {
    const temporalName = TEMPORAL_NAME_RE.test(f.name);
    if (f.type !== 'numeric' && f.type !== 'timestamp' && !temporalName) continue;
    const ex = makeExtractor({ field: f.name });
    const xs = texts.map(t => { const raw = ex(t); if (raw === undefined) return null; const n = Number(raw); return Number.isFinite(n) ? n : null; });
    const st = axisStats(xs);
    if (st.coverage < 0.5 || !st.spread) continue;
    // Duration/rate guard: a duration-named field that isn't strongly monotonic is
    // NOT a clock (e.g. presentationDeadlineNanos) — drop it as an axis.
    const durationish = DURATION_NAME_RE.test(f.name) && !temporalName;
    if (durationish && st.mono < 0.9) continue;
    let score = st.coverage * (st.mono ** 2);
    // Only clearly-temporal fields may outrank the line fallback and become default;
    // generic numeric fields stay selectable but below line (0.15).
    if (!temporalName) score = Math.min(score, 0.12);
    const detail = st.mono > 0.95 ? 'monotonic' : 'numeric';
    out.push({ id: `field:${f.name}`, label: f.name, spec: { kind: 'field', field: f.name }, detail,
      coverage: st.coverage, score });
  }

  out.push(lineAxis);
  out.sort((a, b) => b.score - a.score);
  return out;
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
  // What the bucket startMs/endMs coordinates mean, so the renderer labels the X
  // axis correctly and never has to fall back to a table:
  //   'time'     → epoch-ms (wall-clock)      'relative' → leading seconds prefix
  //   'line'     → 1-based viewer line number 'number'   → another field's value
  xKind: XKind;
  // a capped, evenly-sampled set of raw points for click-to-line + scatter
  points: TrendPoint[];
}

export function extractSeries(
  handler: FileHandler,
  parseTs: TsParser,
  fieldName: string,
  opts: ScanRange & { bucketCount?: number; maxPoints?: number; pattern?: string; patternFlags?: string; xAxis?: AxisSpec } = {},
): SeriesResult {
  const bucketCount = Math.min(Math.max(opts.bucketCount ?? 200, 10), 2000);
  const maxPoints = opts.maxPoints ?? 5000;
  const extract = makeExtractor({ field: fieldName, pattern: opts.pattern, patternFlags: opts.patternFlags });
  // Explicit axis (from the X-axis selector) or auto: prefer wall-clock, else line.
  const explicit = opts.xAxis;
  const axisEx = explicit ? makeAxisExtractor(explicit, parseTs) : null;

  const collected: TrendPoint[] = [];
  const xs: (number | null)[] = [];   // per-point X coordinate under the chosen axis
  const typeRef: { v: FieldType | null } = { v: null };
  let withTimestamp = 0;

  const { truncated } = scanLines(handler, opts, (lineNumber, text) => {
    const raw = extract(text);
    if (raw === undefined) return;
    if (typeRef.v === null) typeRef.v = classifyValue(raw);
    const ts = parseTs(text);
    const epochMs = ts ? ts.date.getTime() : null;
    if (epochMs !== null) withTimestamp++;
    const vl = lineNumber + 1;
    collected.push({ lineNumber, viewerLine: vl, epochMs, raw, num: seriesNum(raw) });
    xs.push(axisEx ? axisEx(text, vl) : epochMs); // auto captures wall-clock for now
  });

  const effType: FieldType = typeRef.v ?? 'string';

  // Resolve the axis + per-point X. Auto uses wall-clock when any line had one,
  // else the viewer line number so a series ALWAYS charts (mirrors
  // extractSignalSeries' record-index fallback). An explicit axis with no usable
  // values also falls back to line, never to a table.
  let xKind: XKind;
  let xvals: (number | null)[];
  if (explicit) {
    xKind = xKindOf(explicit);
    xvals = xs;
  } else if (withTimestamp > 0) {
    xKind = 'time';
    xvals = xs; // = epochMs captured above
  } else {
    xKind = 'line';
    xvals = collected.map(p => p.viewerLine);
  }
  let haveX = xvals.some(x => x !== null);
  if (!haveX && collected.length > 0) {           // explicit axis produced nothing
    xKind = 'line';
    xvals = collected.map(p => p.viewerLine);
    haveX = true;
  }

  let xStart = Infinity, xEnd = -Infinity;
  for (const x of xvals) { if (x === null) continue; if (x < xStart) xStart = x; if (x > xEnd) xEnd = x; }
  if (!haveX) { xStart = 0; xEnd = 1; }
  if (xEnd <= xStart) xEnd = xStart + 1;

  // timeRange stays meaningful only for wall-clock, so the renderer keeps drawing
  // real date labels; other axes label from xKind.
  const timeRange = (xKind === 'time' && haveX) ? { startMs: xStart, endMs: xEnd } : null;

  // Build adaptive buckets over the chosen X axis.
  const buckets: TimeBucket[] = [];
  if (collected.length > 0) {
    const span = Math.max(1, xEnd - xStart);
    const width = span / bucketCount;
    for (let i = 0; i < bucketCount; i++) {
      buckets.push({ startMs: xStart + i * width, endMs: xStart + (i + 1) * width, count: 0 });
    }
    for (let pi = 0; pi < collected.length; pi++) {
      const p = collected[pi];
      const x = xvals[pi];
      if (x === null) continue;
      let idx = Math.floor((x - xStart) / width);
      if (idx < 0) idx = 0; if (idx >= bucketCount) idx = bucketCount - 1;
      const b = buckets[idx];
      b.count++;
      if ((effType === 'numeric' || effType === 'boolean') && p.num !== null) {
        // boolean → 0/1, so the bucket avg is the fraction "true" in that window.
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
    xKind,
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
  x: { field: string; values: number[]; isIndex: boolean; timeMs?: (number | null)[] }; // shared axis (t/index) + optional wall-clock per point
  series: SignalSeries[];
  totalRecords: number;        // lines that carried an x value (read/sampled)
  buckets: number;             // emitted bucket count (≤ maxPoints)
  truncated: boolean;
  sampled: boolean;            // true if the file was sampled (not fully scanned)
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
  opts: ScanRange & { xField?: string; maxPoints?: number; sampleBudget?: number } = {},
  parseTs?: (text: string) => { date: Date; str: string } | null,
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
  const repTimeMs = new Float64Array(nBuckets).fill(NaN); // wall-clock of each bucket's first line, if parseable
  let sawRealX = false;
  let sawTime = false;

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
  const consume = (lineNumber: number, text: string): void => {
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
    if (repLine[bucket] === 0) {
      repLine[bucket] = lineNumber + 1;
      // Capture the bucket's wall-clock time from its first line so the chart can
      // label the x axis with real date/time (the raw `t`/index is not a clock).
      if (parseTs) {
        const ts = parseTs(text);
        if (ts) { repTimeMs[bucket] = ts.date.getTime(); sawTime = true; }
      }
    }
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
  };

  // Reading EVERY record of a multi-million-row file blocks the main process
  // (millions of regex parses) → the UI goes "not responding". Since we only emit
  // ~maxPoints buckets, sample a bounded number of lines in short contiguous runs
  // spread across the range instead. Small files are still read in full (exact).
  const sampleBudget = Math.max(opts.sampleBudget ?? 60_000, nBuckets * 4);
  let truncated = false;
  let sampled = false;
  if (span <= sampleBudget) {
    ({ truncated } = scanLines(handler, { startLine: start, endLine: end }, consume));
  } else {
    sampled = true;
    const RUN = 8;                                   // contiguous lines per anchor
    const anchors = Math.max(1, Math.ceil(sampleBudget / RUN));
    const stride = span / anchors;
    for (let a = 0; a < anchors; a++) {
      const idx = start + Math.min(span - 1, Math.floor(a * stride));
      const run = handler.getLines(idx, Math.min(RUN, end - idx + 1));
      for (const ln of run) consume(ln.lineNumber, ln.text);
    }
  }

  // Compact to buckets that actually have an x sample, preserving order.
  const xValues: number[] = [];
  const timeMs: (number | null)[] = [];
  const keep: number[] = [];
  for (let b = 0; b < nBuckets; b++) {
    if (xCnt[b] > 0) {
      keep.push(b);
      xValues.push(xSum[b] / xCnt[b]);
      timeMs.push(Number.isNaN(repTimeMs[b]) ? null : repTimeMs[b]);
    }
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
    x: {
      field: sawRealX ? xField : 'index',
      values: xValues,
      isIndex: !sawRealX,
      timeMs: sawTime ? timeMs : undefined,
    },
    series,
    totalRecords,
    buckets: xValues.length,
    truncated,
    sampled,
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
