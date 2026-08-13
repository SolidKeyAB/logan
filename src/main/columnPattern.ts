// Pattern-based column extraction ("paint or grok → named columns").
//
// Three authoring modes compile down to ONE named-capture regex whose groups
// are the emitted columns:
//   • grok  — literal text with %{name} / %{name:subpattern} placeholders
//   • paint — a sample line with char-offset spans marked VARIABLE (each named);
//             the un-marked text between spans is treated as static glue
//   • regex — a raw regex the user typed (named groups → columns; else numbered)
//
// Kept free of Electron / FileHandler deps so the compile + extract logic stays
// unit-testable. The IPC layer in index.ts calls these to preview and persist.

export interface PaintSpan { start: number; end: number; name: string }

export interface ColumnPatternSpec {
  mode: 'grok' | 'regex' | 'paint';
  pattern?: string;            // grok text or raw regex
  sample?: string;             // paint: the sample line the spans index into
  spans?: PaintSpan[];         // paint: variable spans (char offsets into sample)
  flags?: string;              // extra regex flags (default '')
}

export interface CompiledColumnPattern {
  regex: string;
  flags: string;
  fields: string[];
  named: boolean;              // true → extract by group name, false → by index
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIALS, '\\$&');
}

// Turn a literal chunk into a forgiving regex: runs of whitespace match `\s+`
// (so re-indented / differently-spaced lines still line up) and everything else
// is escaped to match verbatim.
function staticToRegex(s: string): string {
  if (!s) return '';
  return s.replace(/\s+|[^\s]+/g, (chunk) => (/^\s+$/.test(chunk) ? '\\s+' : escapeRegex(chunk)));
}

// ── Paint format inference ────────────────────────────────────────────────────
// A painted span shouldn't become a literal or a blanket \S+? — it should match the
// token's FORMAT so the pattern generalises across lines. Classify the sample text
// (datetime / date / time / ipv4 / uuid / hex / int / float / word …) and emit a regex
// for that shape; fall back to \S+? (or .+? if it contains spaces). Leading/trailing
// bracket/quote BORDERS are kept literal, so only the value inside is generalised.
function classifyToken(s: string, isLast: boolean): string {
  if (!s) return isLast ? '.+' : '.+?';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(s))
    return '\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return '\\d{4}-\\d{2}-\\d{2}';
  if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return '\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return '\\d{1,3}(?:\\.\\d{1,3}){3}';                    // IPv4
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s))
    return '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';         // UUID
  if (/^0x[0-9a-fA-F]+$/.test(s)) return '0x[0-9a-fA-F]+';
  if (/^-?\d+$/.test(s)) return '-?\\d+';                                                         // integer
  if (/^-?\d+\.\d+$/.test(s)) return '-?\\d+\\.\\d+';                                             // float
  if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 6 && /[a-fA-F]/.test(s)) return '[0-9a-fA-F]+';     // hex-ish
  if (/^\w+$/.test(s)) return '\\w+';                                                             // alphanumeric word
  if (/\s/.test(s)) return isLast ? '.+' : '.+?';                                                // contains spaces
  return isLast ? '\\S+' : '\\S+?';                                                               // fallback
}

// Split a painted chunk into { pre, body, post }: leading/trailing bracket/quote borders
// kept LITERAL, the middle generalised to its format class via classifyToken().
const PAINT_BORDER = '[\\[\\](){}<>"\'`]';
// Longest common prefix (fromEnd=false) or suffix (fromEnd=true) across the strings —
// used to peel a column's CONSTANT WRAPPER (/…/, xx…xx, …blah…) detected from many samples.
function commonAffix(strings: string[], fromEnd: boolean): string {
  const vals = strings.filter(s => s.length > 0);
  if (vals.length < 2) return '';
  const ref = vals[0];
  let len = ref.length;
  for (let i = 1; i < vals.length && len > 0; i++) {
    const s = vals[i];
    let k = 0;
    const max = Math.min(len, s.length);
    while (k < max && (fromEnd ? ref[ref.length - 1 - k] === s[s.length - 1 - k] : ref[k] === s[k])) k++;
    len = k;
  }
  return fromEnd ? ref.slice(ref.length - len) : ref.slice(0, len);
}

// Turn a painted chunk into { pre, body, post }: an outer DATA-DRIVEN wrapper (constant
// prefix/suffix shared across `samples` — the column's values on other lines) is kept
// literal, then the single-sample bracket/quote borders, then the value's format class.
// Arbitrary wrappers (/…/, xx…xx) need `samples`; brackets are guessable from one line.
function inferPaintField(chunk: string, isLast: boolean, samples?: string[]): { pre: string; body: string; post: string } {
  let core = chunk, pre = '', post = '';
  if (samples && samples.length >= 2) {
    const withChunk = [chunk, ...samples];
    let cp = commonAffix(withChunk, false);
    if (cp.length >= core.length) cp = '';
    if (cp) { pre = escapeRegex(cp); core = core.slice(cp.length); }
    let cs = commonAffix(withChunk, true);
    if (cs.length >= core.length) cs = '';
    if (cs) { post = escapeRegex(cs); core = core.slice(0, core.length - cs.length); }
  }
  const lead = core.match(new RegExp(`^(?:${PAINT_BORDER})+`));
  if (lead && lead[0].length < core.length) { pre += escapeRegex(lead[0]); core = core.slice(lead[0].length); }
  const trail = core.match(new RegExp(`(?:${PAINT_BORDER})+$`));
  if (trail && trail[0].length < core.length) { post = escapeRegex(trail[0]) + post; core = core.slice(0, core.length - trail[0].length); }
  return { pre, body: classifyToken(core, isLast), post };
}

// Coerce an arbitrary field label into a valid, unique JS regex group name.
function sanitizeName(raw: string, used: Set<string>): string {
  let name = (raw || '').trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!name || /^[0-9]/.test(name)) name = '_' + name;
  if (name === '_') name = 'col';
  let unique = name;
  let n = 2;
  while (used.has(unique)) unique = `${name}_${n++}`;
  used.add(unique);
  return unique;
}

// Number of capturing groups in a regex, without needing a matching input:
// appending `|` makes an always-matching empty alternation whose result array
// length (minus the whole match) is the group count.
function countCaptureGroups(source: string, flags: string): number {
  try {
    const m = new RegExp(source + '|', flags.replace(/[gy]/g, '')).exec('');
    return m ? m.length - 1 : 0;
  } catch {
    return 0;
  }
}

const NAMED_GROUP_RE = /\(\?<([A-Za-z_$][\w$]*)>/g;

function compileGrok(pattern: string, flags: string): CompiledColumnPattern {
  const FIELD_RE = /%\{([^}]+)\}/g;
  const used = new Set<string>();
  interface Part { kind: 'static' | 'field'; body: string }
  const parts: Part[] = [];
  const fields: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_RE.exec(pattern)) !== null) {
    if (m.index > last) parts.push({ kind: 'static', body: staticToRegex(pattern.slice(last, m.index)) });
    const spec = m[1];
    const ci = spec.indexOf(':');
    const rawName = ci >= 0 ? spec.slice(0, ci) : spec;
    const sub = ci >= 0 ? spec.slice(ci + 1) : '';
    const name = sanitizeName(rawName, used);
    fields.push(name);
    parts.push({ kind: 'field', body: `(?<${name}>${sub || '.+?'})` });
    last = m.index + m[0].length;
  }
  if (last < pattern.length) parts.push({ kind: 'static', body: staticToRegex(pattern.slice(last)) });

  // Make the final field greedy when nothing follows it, so it soaks up the
  // rest of the line instead of matching as little as possible.
  const lastFieldIdx = parts.map(p => p.kind).lastIndexOf('field');
  const followedByStatic = parts.slice(lastFieldIdx + 1).some(p => p.kind === 'static' && p.body.length > 0);
  if (lastFieldIdx >= 0 && !followedByStatic) {
    parts[lastFieldIdx].body = parts[lastFieldIdx].body.replace('.+?)', '.+)');
  }

  return { regex: parts.map(p => p.body).join(''), flags, fields, named: true };
}

// fieldSamples (optional) = the values each column takes across sample lines, in span order —
// passed by the "refine from data" step so inferPaintField can peel constant wrappers.
function compilePaint(sample: string, spans: PaintSpan[], flags: string, fieldSamples?: string[][]): CompiledColumnPattern {
  const clean = (spans || [])
    .filter(s => s && s.end > s.start && s.start >= 0 && s.end <= sample.length)
    .sort((a, b) => a.start - b.start);
  const used = new Set<string>();
  const fields: string[] = [];
  let out = '';
  let cursor = 0;
  let fieldIdx = 0;
  for (let i = 0; i < clean.length; i++) {
    const sp = clean[i];
    if (sp.start < cursor) continue; // skip overlaps
    out += staticToRegex(sample.slice(cursor, sp.start));
    const name = sanitizeName(sp.name, used);
    fields.push(name);
    const chunk = sample.slice(sp.start, sp.end);
    const isLast = i === clean.length - 1 && sp.end >= sample.length;
    // Format-aware: infer the token's shape (date/int/word…), keep bracket/quote borders literal,
    // and — when we have sample values for this column — peel its constant data-driven wrapper.
    const { pre, body, post } = inferPaintField(chunk, isLast, fieldSamples ? fieldSamples[fieldIdx] : undefined);
    out += pre + `(?<${name}>${body})` + post;
    cursor = sp.end;
    fieldIdx++;
  }
  out += staticToRegex(sample.slice(cursor));
  return { regex: out, flags, fields, named: true };
}

/** Re-compile a paint spec using per-field sample values (the values each column takes across
 * lines, in span order) so constant wrappers are peeled off — the "refine from data" step. */
export function refinePaintPattern(spec: ColumnPatternSpec, fieldSamples: string[][]): CompiledColumnPattern {
  if (spec.mode !== 'paint' || !spec.sample || !spec.spans || spec.spans.length === 0) {
    return compileColumnPattern(spec);
  }
  return compilePaint(spec.sample, spec.spans, spec.flags || '', fieldSamples);
}

function compileRawRegex(pattern: string, flags: string): CompiledColumnPattern {
  new RegExp(pattern, flags); // throws on invalid — caller surfaces the message
  const names: string[] = [];
  let m: RegExpExecArray | null;
  NAMED_GROUP_RE.lastIndex = 0;
  while ((m = NAMED_GROUP_RE.exec(pattern)) !== null) names.push(m[1]);
  if (names.length) return { regex: pattern, flags, fields: names, named: true };
  const groups = countCaptureGroups(pattern, flags);
  if (groups > 0) {
    return { regex: pattern, flags, fields: Array.from({ length: groups }, (_, i) => `col${i + 1}`), named: false };
  }
  return { regex: pattern, flags, fields: ['match'], named: false };
}

/** Compile any spec to a single named/numbered-capture regex + ordered fields. */
export function compileColumnPattern(spec: ColumnPatternSpec): CompiledColumnPattern {
  const flags = spec.flags || '';
  if (spec.mode === 'grok') {
    if (!spec.pattern) throw new Error('Empty pattern');
    return compileGrok(spec.pattern, flags);
  }
  if (spec.mode === 'paint') {
    if (!spec.sample) throw new Error('No sample line to paint');
    if (!spec.spans || spec.spans.length === 0) throw new Error('Mark at least one field span');
    return compilePaint(spec.sample, spec.spans, flags);
  }
  if (!spec.pattern) throw new Error('Empty regex');
  return compileRawRegex(spec.pattern, flags);
}

/**
 * Build a reusable extractor. Returns the values aligned to `fields`, or null
 * when the line doesn't match. Missing optional groups come back as ''.
 */
export function makeColumnExtractor(compiled: CompiledColumnPattern): (line: string) => string[] | null {
  const re = new RegExp(compiled.regex, compiled.flags.replace(/[gy]/g, ''));
  return (line: string): string[] | null => {
    const m = re.exec(line);
    if (!m) return null;
    if (compiled.named) {
      const g = m.groups || {};
      return compiled.fields.map(f => (g[f] != null ? g[f] : ''));
    }
    if (compiled.fields.length === 1 && compiled.fields[0] === 'match') return [m[0]];
    return compiled.fields.map((_, i) => (m[i + 1] != null ? m[i + 1] : ''));
  };
}
