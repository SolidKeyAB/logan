// Summarize — P0.5: the global templater (extends P0).
//
// Pure, dependency-light, no I/O, no UI. Where P0 (logSummarize.ts) folds
// CONTIGUOUS repeating vertical blocks, this does the WHOLE-FILE fold: it counts
// how many raw lines collapse to each distinct message SHAPE, file-wide, and
// returns the top-K shapes (templates) each with a count, time span, worst
// severity, and a few example lines to drill into. See
// docs/discovery/log-summarize-templates.md §2–§3.
//
// Reuses:
//   - normalizeShape()  (logSummarize.ts)  — the SAME per-line fingerprint as P0
//   - SEVERITY_RG_PATTERN / keywordRank / rankToLevel (severityIndex.ts)
//   - parseTimestampFast() (timestampParse.ts) — for <TS> first/last spans
//
// Memory is bounded to O(K), never O(file): one streaming pass over an iterable of
// lines, a Map<shape, template> capped at K, and a count-only «other» bucket for
// the rarer shapes evicted under pressure. No silent truncation — the summary
// reports coverage and the «other» size so a poorly-compressing log says so.

import { normalizeShape } from './logSummarize';
import { SEVERITY_RG_PATTERN, keywordRank, rankToLevel, type SeverityLevel } from './severityIndex';
import { parseTimestampFast } from './timestampParse';

export interface LogTemplate {
  /** Stable within a run: FNV-1a hash of the masked shape. */
  id: number;
  /** The masked template string (what the user reads). */
  shape: string;
  /** How many raw lines matched this shape. */
  count: number;
  /** viewerLine (1-based) of the first and last occurrence. */
  firstLine: number;
  lastLine: number;
  /** Timestamp string of first/last occurrence, if the file has timestamps. */
  firstTs?: string;
  lastTs?: string;
  /** Worst severity seen across the matched lines. */
  severity: SeverityLevel | null;
  /** A few viewerLines to drill into (first maxExamples-1 + most recent). */
  examples: number[];
}

export interface TemplateSummary {
  /** Kept templates, sorted by count desc (tie-break: firstLine asc, then shape). */
  templates: LogTemplate[];
  /** Count-only bucket of the rarer shapes evicted under the K cap. */
  other: { lines: number; shapes: number };
  /** Total lines scanned. */
  totalLines: number;
  /** Approx distinct shapes seen = kept + evicted (a lower bound; a re-appearing
   *  evicted shape may be recounted). */
  distinctShapes: number;
  /** Fraction of lines represented by the KEPT templates (1 − other/total). */
  coverage: number;
  /** True if the K cap was hit (⇒ «other» may be non-empty; UI must say so). */
  capped: boolean;
}

export interface FoldTemplatesOptions {
  /** K — max distinct templates kept. Default 5000. */
  maxTemplates?: number;
  /** Example viewerLines kept per template. Default 5. */
  maxExamples?: number;
  /** viewerLine (1-based) of the first line in `lines`. Default 1. */
  startLine?: number;
  /** Stamp each template's worst severity. Default true. */
  detectSeverity?: boolean;
  /** Stamp first/last timestamps. Default true. */
  detectTimestamp?: boolean;
}

// Internal working record (keeps severity as a rank until output).
interface Acc {
  id: number;
  shape: string;
  count: number;
  firstLine: number;
  lastLine: number;
  firstTs?: string;
  lastTs?: string;
  sevRank: number;
  examples: number[];
}

// FNV-1a 32-bit — a small, stable, dependency-free hash for the template id.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// Highest severity rank found anywhere in a line (0 = none). Built from the same
// keyword set the ripgrep severity index uses, so UI and summary agree.
const SEV_RE = new RegExp(SEVERITY_RG_PATTERN, 'gi');
function lineSeverityRank(line: string): number {
  SEV_RE.lastIndex = 0;
  let best = 0;
  let m: RegExpExecArray | null;
  while ((m = SEV_RE.exec(line)) !== null) {
    const r = keywordRank(m[1] ?? m[0]);
    if (r > best) best = r;
    if (best === 3) break; // can't beat fatal
  }
  return best;
}

/**
 * Fold an iterable of raw log lines into the top-K distinct message templates.
 * One streaming pass, O(K) memory. `lines` may be a generator so a worker can
 * stream a 50M-line file without materialising it.
 */
export function foldTemplates(
  lines: Iterable<string>,
  opts: FoldTemplatesOptions = {},
): TemplateSummary {
  const K = opts.maxTemplates ?? 5000;
  const maxExamples = Math.max(1, opts.maxExamples ?? 5);
  const startLine = opts.startLine ?? 1;
  const wantSev = opts.detectSeverity ?? true;
  const wantTs = opts.detectTimestamp ?? true;

  const map = new Map<string, Acc>();
  let evictedLines = 0;
  let evictedShapes = 0;
  let capped = false;
  let totalLines = 0;

  let viewerLine = startLine;
  for (const line of lines) {
    totalLines++;
    const shape = normalizeShape(line);
    const ts = wantTs ? parseTimestampFast(line)?.str : undefined;
    const sevRank = wantSev ? lineSeverityRank(line) : 0;

    let acc = map.get(shape);
    if (acc) {
      acc.count++;
      acc.lastLine = viewerLine;
      if (ts) {
        if (acc.firstTs === undefined) acc.firstTs = ts;
        acc.lastTs = ts;
      }
      if (sevRank > acc.sevRank) acc.sevRank = sevRank;
      // Reservoir: keep the first (maxExamples-1) + the most recent.
      if (acc.examples.length < maxExamples) acc.examples.push(viewerLine);
      else acc.examples[maxExamples - 1] = viewerLine;
    } else {
      if (map.size >= K) {
        // Evict the smallest-count template into the count-only «other» bucket.
        // (Linear min-scan: eviction is rare on real logs — few distinct shapes;
        //  only pathological all-unique input thrashes, which «other» then reports.)
        capped = true;
        let minKey: string | null = null;
        let minCount = Infinity;
        for (const [k, v] of map) {
          if (v.count < minCount) {
            minCount = v.count;
            minKey = k;
          }
        }
        if (minKey !== null) {
          const victim = map.get(minKey)!;
          evictedLines += victim.count;
          evictedShapes++;
          map.delete(minKey);
        }
      }
      acc = {
        id: fnv1a(shape),
        shape,
        count: 1,
        firstLine: viewerLine,
        lastLine: viewerLine,
        firstTs: ts,
        lastTs: ts,
        sevRank,
        examples: [viewerLine],
      };
      map.set(shape, acc);
    }

    viewerLine++;
  }

  const templates: LogTemplate[] = [...map.values()]
    .map((a) => ({
      id: a.id,
      shape: a.shape,
      count: a.count,
      firstLine: a.firstLine,
      lastLine: a.lastLine,
      firstTs: a.firstTs,
      lastTs: a.lastTs,
      severity: rankToLevel(a.sevRank),
      examples: a.examples,
    }))
    .sort(
      (x, y) =>
        y.count - x.count ||
        x.firstLine - y.firstLine ||
        (x.shape < y.shape ? -1 : x.shape > y.shape ? 1 : 0),
    );

  const coverage = totalLines === 0 ? 1 : (totalLines - evictedLines) / totalLines;

  return {
    templates,
    other: { lines: evictedLines, shapes: evictedShapes },
    totalLines,
    distinctShapes: templates.length + evictedShapes,
    coverage,
    capped,
  };
}
