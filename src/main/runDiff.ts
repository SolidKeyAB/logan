// ─── Run-vs-run template diff — the multi-log "differential" (P2) ────────────
// "What does the FAILING run contain that the GOOD run doesn't?" — beyond the
// fingerprint-granularity baseline_compare (level counts / crash sets / components)
// and complementary to the human split/diff (raw visual line diff, ≤100k lines).
//
// A raw line diff of two multi-million-line runs is noise: every timestamp, pid and
// counter differs. The meaningful diff is at the MESSAGE-TEMPLATE level — fold each
// run into its distinct shapes (TemplateFolder / normalizeShape masks <TS>/<NUM>/…),
// then set-diff the two shape populations:
//   • onlyInTarget    — shapes the target (failing) run has, absent in the reference
//   • onlyInReference — shapes the reference (good) run had, gone from the target
//   • changed         — shapes in BOTH whose frequency shifted past `changeFactor`
//
// This module is PURE (no fs / electron / worker) — it consumes two TemplateSummary
// values (produced off-thread by the shared fold) and returns the diff, so the
// set-diff semantics stay unit-tested headlessly. See
// docs/discovery/multi-log-correlation.md (P2).

import type { LogTemplate, TemplateSummary } from './logTemplates';
import type { SeverityLevel } from './severityIndex';

// One template's presence/frequency across the two runs.
export interface TemplateDelta {
  id: number;                       // FNV hash of the shape (stable across runs)
  shape: string;                    // the masked template
  referenceCount: number;           // occurrences in the reference (good) run
  targetCount: number;              // occurrences in the target (failing) run
  delta: number;                    // targetCount − referenceCount
  factor: number | null;            // targetCount / referenceCount; null when reference is 0 (brand-new)
  severity: SeverityLevel | null;   // worst severity seen for this shape (either side)
  referenceExamples: number[];      // viewerLines in the reference run (1-based)
  targetExamples: number[];         // viewerLines in the target run (1-based)
}

export interface RunDiffCaps {
  referenceCapped: boolean;         // reference fold hit the template-K cap (some shapes in «other»)
  targetCapped: boolean;
  shown: { onlyInTarget: number; onlyInReference: number; changed: number };
  total: { onlyInTarget: number; onlyInReference: number; changed: number };
  note: string;
}

export interface RunDiff {
  onlyInTarget: TemplateDelta[];    // THE headline — new shapes in the failing run
  onlyInReference: TemplateDelta[]; // shapes the good run had, now absent
  changed: TemplateDelta[];         // shared shapes with a frequency shift
  unchanged: number;                // count of shared shapes within tolerance
  summary: {
    referenceTotalLines: number;
    targetTotalLines: number;
    referenceTemplates: number;     // distinct kept shapes in reference
    targetTemplates: number;
    onlyInTarget: number;           // full counts (pre-topN)
    onlyInReference: number;
    changed: number;
    unchanged: number;
  };
  caps: RunDiffCaps;
}

export interface DiffOptions {
  // Noise floor: ignore a shape whose relevant count is below this. Default 1.
  minCount?: number;
  // A SHARED shape is "changed" when its frequency ratio is ≥ changeFactor or
  // ≤ 1/changeFactor (in either direction). Default 3 (3× more or less).
  changeFactor?: number;
  // Cap entries RETURNED per bucket (full counts still reported in summary/caps). Default 50.
  topN?: number;
}

const SEV_RANK: Record<string, number> = { fatal: 3, error: 2, warning: 1 };
function sevRank(s: SeverityLevel | null): number {
  return s ? (SEV_RANK[s] ?? 0) : 0;
}

// Worst of two template severities.
function worstSeverity(a: LogTemplate | undefined, b: LogTemplate | undefined): SeverityLevel | null {
  const ra = sevRank(a?.severity ?? null);
  const rb = sevRank(b?.severity ?? null);
  const best = Math.max(ra, rb);
  return best === 3 ? 'fatal' : best === 2 ? 'error' : best === 1 ? 'warning' : null;
}

// Interesting-first: highest severity, then largest magnitude of change/frequency.
function bySeverityThen(magnitude: (d: TemplateDelta) => number) {
  return (x: TemplateDelta, y: TemplateDelta): number =>
    sevRank(y.severity) - sevRank(x.severity) || magnitude(y) - magnitude(x) ||
    (x.shape < y.shape ? -1 : x.shape > y.shape ? 1 : 0);
}

/**
 * Diff two folded runs. `reference` = the good/known run (A), `target` = the run
 * under investigation (B). The diff is reported from the target's perspective:
 * onlyInTarget are the shapes B introduced.
 */
export function diffRuns(reference: TemplateSummary, target: TemplateSummary, opts: DiffOptions = {}): RunDiff {
  const minCount = Math.max(1, opts.minCount ?? 1);
  const changeFactor = Math.max(1, opts.changeFactor ?? 3);
  const topN = Math.max(1, opts.topN ?? 50);

  const refByShape = new Map<string, LogTemplate>();
  for (const t of reference.templates) refByShape.set(t.shape, t);
  const tgtByShape = new Map<string, LogTemplate>();
  for (const t of target.templates) tgtByShape.set(t.shape, t);

  const onlyInTarget: TemplateDelta[] = [];
  const onlyInReference: TemplateDelta[] = [];
  const changed: TemplateDelta[] = [];
  let unchanged = 0;

  // Every shape in target: new, or shared (maybe changed).
  for (const t of target.templates) {
    const r = refByShape.get(t.shape);
    if (!r) {
      if (t.count < minCount) continue;
      onlyInTarget.push({
        id: t.id, shape: t.shape,
        referenceCount: 0, targetCount: t.count,
        delta: t.count, factor: null,
        severity: t.severity,
        referenceExamples: [], targetExamples: t.examples,
      });
    } else {
      const factor = r.count > 0 ? t.count / r.count : null;
      const shifted = factor === null || factor >= changeFactor || factor <= 1 / changeFactor;
      if (shifted && Math.max(t.count, r.count) >= minCount) {
        changed.push({
          id: t.id, shape: t.shape,
          referenceCount: r.count, targetCount: t.count,
          delta: t.count - r.count, factor,
          severity: worstSeverity(t, r),
          referenceExamples: r.examples, targetExamples: t.examples,
        });
      } else {
        unchanged++;
      }
    }
  }

  // Shapes only in reference (dropped from target).
  for (const r of reference.templates) {
    if (tgtByShape.has(r.shape)) continue;
    if (r.count < minCount) continue;
    onlyInReference.push({
      id: r.id, shape: r.shape,
      referenceCount: r.count, targetCount: 0,
      delta: -r.count, factor: 0,
      severity: r.severity,
      referenceExamples: r.examples, targetExamples: [],
    });
  }

  onlyInTarget.sort(bySeverityThen((d) => d.targetCount));
  onlyInReference.sort(bySeverityThen((d) => d.referenceCount));
  // "changed" ranks by the magnitude of the log-ratio (biggest swing first).
  changed.sort(bySeverityThen((d) => Math.abs(Math.log((d.targetCount + 1) / (d.referenceCount + 1)))));

  const totals = { onlyInTarget: onlyInTarget.length, onlyInReference: onlyInReference.length, changed: changed.length };
  const cappedT = onlyInTarget.slice(0, topN);
  const cappedR = onlyInReference.slice(0, topN);
  const cappedC = changed.slice(0, topN);

  return {
    onlyInTarget: cappedT,
    onlyInReference: cappedR,
    changed: cappedC,
    unchanged,
    summary: {
      referenceTotalLines: reference.totalLines,
      targetTotalLines: target.totalLines,
      referenceTemplates: reference.templates.length,
      targetTemplates: target.templates.length,
      onlyInTarget: totals.onlyInTarget,
      onlyInReference: totals.onlyInReference,
      changed: totals.changed,
      unchanged,
    },
    caps: {
      referenceCapped: reference.capped,
      targetCapped: target.capped,
      shown: { onlyInTarget: cappedT.length, onlyInReference: cappedR.length, changed: cappedC.length },
      total: totals,
      note: (reference.capped || target.capped)
        ? 'A fold hit the template cap — rare shapes fell into «other» and may be missing from the diff. Raise maxTemplates for full coverage.'
        : 'Template-level diff. Drill into any viewerLine with logan_get_lines; pin a notable delta with logan_report_finding.',
    },
  };
}
