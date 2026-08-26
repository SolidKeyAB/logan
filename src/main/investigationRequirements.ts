// Investigation "requirements manifest" — the preconditions a saved investigation
// carries so it only replays where it makes sense. The headline case: "this ticket's
// investigation only applies to a log that is in template X" (a saved column pattern,
// a specific format adapter, or a signature line). It also records the OTHER saved
// entities (searches / filters / highlights / bookmarks / column layouts / constants…)
// the investigation expects, so replay can surface what's missing.
//
// Kept free of Electron / FileHandler deps (mirrors columnPattern.ts) so the evaluator
// stays unit-testable: callers inject the live file context (sample lines, adapter id)
// and resolver callbacks. api-server.ts wires the real stores in.

import { compileColumnPattern, makeColumnExtractor, ColumnPatternSpec, CompiledColumnPattern } from './columnPattern';

// The kinds of saveable entity an investigation can reference. Mirrors the entities
// LOGAN already persists (see the per-entity stores under ~/.logan/*.json).
export type EntityKind =
  | 'search'          // SearchConfig
  | 'session'         // SearchConfigSession
  | 'filter'          // FilterPreset
  | 'highlight'       // Highlight / HighlightGroup
  | 'bookmark'        // Bookmark / BookmarkSet
  | 'columnLayout'    // ColumnLayoutSaved
  | 'columnPattern'   // ColumnPatternSaved
  | 'constant'        // ConstantEntry
  | 'trendProperty'   // PatternProperty
  | 'pattern';        // SavedPattern (pattern library)

// A by-reference pointer to another saved entity the investigation expects.
export interface EntityRef {
  kind: EntityKind;
  id?: string;          // stable id when known
  name?: string;        // human name / label — fallback match key
  autoApply?: boolean;  // "outfit": auto-apply this lens (filter/highlight/columns/session) to the view before replaying
  note?: string;
}

// How the current log file must "look" for this investigation to apply. Every provided
// sub-check is REQUIRED (AND-combined). All omitted → no file gate at all.
export interface FileTemplateReq {
  // A saved column layout/pattern (by id or name) whose compiled regex must match at
  // least `minMatchRatio` (0..1, default 0.6) of the sampled non-blank lines.
  columnPattern?: { id?: string; name?: string; minMatchRatio?: number };
  // The file's decode/format adapter id, e.g. 'vtrace' | 'jsonl' | 'mf4' | 'text'.
  adapterId?: string;
  // A raw regex that must appear within the first `scanLines` lines (default: all sampled).
  signature?: { regex: string; flags?: string; scanLines?: number };
  // Optional filename glob hint, e.g. '*.esotrace' or 'device-*.log'.
  filenameGlob?: string;
  // Human note describing the expected format (informational).
  note?: string;
}

export interface RequirementsManifest {
  fileTemplate?: FileTemplateReq;   // the HARD gate (mismatch blocks replay)
  entities?: EntityRef[];           // expected saved entities (informational / warn)
  notes?: string[];                 // free-text preconditions to confirm
}

// ── Evaluation context (injected by the caller) ──────────────────────────────
export interface RequirementCheckContext {
  filePath: string | null;
  adapterId: string | null;                     // e.g. pickAdapter(filePath).id
  sampleLines: string[];                        // first N raw line texts of the file
  // Resolve a saved column layout/pattern to something compilable, or return null.
  resolveColumnPattern?: (ref: { id?: string; name?: string }) =>
    CompiledColumnPattern | { spec: ColumnPatternSpec } | null;
  // Best-effort existence/applied check for a referenced entity, or null if unknown.
  resolveEntity?: (ref: EntityRef) => { present: boolean; applied?: boolean } | null;
}

export type RequirementStatus = 'satisfied' | 'unsatisfied' | 'unverified';

export interface RequirementCheck {
  kind: string;               // 'file-template:columnPattern' | 'entity:search' | …
  label: string;              // short human label
  status: RequirementStatus;
  detail: string;             // why (counts, ratios, what's missing)
}

export interface RequirementsReport {
  blocked: boolean;           // true if any HARD (file-template) check is 'unsatisfied'
  checks: RequirementCheck[];
  summary: string;
}

// Turn a shell-style glob into an anchored regex (only * and ? are special).
function globToRegex(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + body + '$', 'i');
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

/**
 * Does the file "match" a compiled column pattern? A line matches when the extractor
 * returns a non-null column tuple for it. Blank lines are ignored. Returns the ratio
 * of matching lines so callers can gate on it.
 */
export function fileMatchesColumnPattern(
  compiled: CompiledColumnPattern,
  sampleLines: string[],
  minMatchRatio = 0.6,
): { matched: boolean; ratio: number; matchedCount: number; total: number } {
  const extract = makeColumnExtractor(compiled);
  const lines = sampleLines.filter(l => l.trim().length > 0);
  if (lines.length === 0) return { matched: false, ratio: 0, matchedCount: 0, total: 0 };
  let ok = 0;
  for (const l of lines) if (extract(l) !== null) ok++;
  const ratio = ok / lines.length;
  return { matched: ratio >= minMatchRatio, ratio, matchedCount: ok, total: lines.length };
}

/**
 * Suggest a starter requirements manifest from the open file — the reliable, low-noise
 * signals only: the format adapter (when it's a real decoder, not plain text) and a
 * filename glob from the extension. Signature/column-pattern gates are left to the human
 * to pick, since they become HARD gates and a bad guess would wrongly block replays.
 */
export function suggestRequirements(input: { filePath: string | null; adapterId: string | null }): RequirementsManifest {
  const fileTemplate: FileTemplateReq = {};
  if (input.adapterId && input.adapterId !== 'text') fileTemplate.adapterId = input.adapterId;
  if (input.filePath) {
    const base = basename(input.filePath);
    const dot = base.lastIndexOf('.');
    if (dot > 0 && dot < base.length - 1) fileTemplate.filenameGlob = '*' + base.slice(dot);
  }
  return Object.keys(fileTemplate).length ? { fileTemplate } : {};
}

/** Merge suggested defaults under an explicit manifest — explicit fields win field-by-field. */
export function mergeRequirements(explicit: RequirementsManifest | undefined, suggested: RequirementsManifest): RequirementsManifest {
  const out: RequirementsManifest = { ...(explicit || {}) };
  if (suggested.fileTemplate || explicit?.fileTemplate) {
    out.fileTemplate = { ...(suggested.fileTemplate || {}), ...(explicit?.fileTemplate || {}) };
  }
  return out;
}

/**
 * Evaluate a requirements manifest against the current file context. File-template
 * checks are HARD (a mismatch sets blocked=true). Entity checks are informational —
 * they surface what's missing but never block a replay.
 */
export function evaluateRequirements(
  manifest: RequirementsManifest | undefined | null,
  ctx: RequirementCheckContext,
): RequirementsReport {
  const checks: RequirementCheck[] = [];
  if (!manifest) return { blocked: false, checks, summary: 'No requirements declared.' };

  const ft = manifest.fileTemplate;
  if (ft) {
    // ── format adapter ──
    if (ft.adapterId) {
      const actual = ctx.adapterId || 'text';
      const ok = actual === ft.adapterId;
      checks.push({
        kind: 'file-template:adapter',
        label: `format = ${ft.adapterId}`,
        status: ok ? 'satisfied' : 'unsatisfied',
        detail: ok ? `file decoded by '${actual}'` : `file decoded by '${actual}', requires '${ft.adapterId}'`,
      });
    }

    // ── filename glob ──
    if (ft.filenameGlob) {
      const base = ctx.filePath ? basename(ctx.filePath) : '';
      const ok = !!base && globToRegex(ft.filenameGlob).test(base);
      checks.push({
        kind: 'file-template:filename',
        label: `filename ~ ${ft.filenameGlob}`,
        status: ok ? 'satisfied' : 'unsatisfied',
        detail: ok ? `'${base}' matches` : `'${base || '(no file)'}' does not match '${ft.filenameGlob}'`,
      });
    }

    // ── signature line ──
    if (ft.signature && ft.signature.regex) {
      let re: RegExp | null = null;
      try { re = new RegExp(ft.signature.regex, (ft.signature.flags || '').replace(/[gy]/g, '')); } catch { re = null; }
      if (!re) {
        checks.push({ kind: 'file-template:signature', label: 'signature regex', status: 'unverified', detail: `invalid signature regex /${ft.signature.regex}/` });
      } else {
        const scan = ft.signature.scanLines ? ctx.sampleLines.slice(0, ft.signature.scanLines) : ctx.sampleLines;
        const ok = scan.some(l => re!.test(l));
        checks.push({
          kind: 'file-template:signature',
          label: `signature /${ft.signature.regex}/`,
          status: ok ? 'satisfied' : 'unsatisfied',
          detail: ok ? `matched within first ${scan.length} lines` : `not found in first ${scan.length} lines`,
        });
      }
    }

    // ── column pattern ──
    if (ft.columnPattern) {
      const cp = ft.columnPattern;
      const refLabel = cp.name || cp.id || '(unnamed)';
      const resolved = ctx.resolveColumnPattern?.(cp) ?? null;
      if (!resolved) {
        checks.push({ kind: 'file-template:columnPattern', label: `column pattern ${refLabel}`, status: 'unverified', detail: `saved column pattern '${refLabel}' not found on this machine` });
      } else {
        let compiled: CompiledColumnPattern | null = null;
        try { compiled = 'spec' in resolved ? compileColumnPattern(resolved.spec) : resolved; } catch { compiled = null; }
        if (!compiled) {
          checks.push({ kind: 'file-template:columnPattern', label: `column pattern ${refLabel}`, status: 'unverified', detail: 'column pattern failed to compile' });
        } else {
          const need = cp.minMatchRatio ?? 0.6;
          const m = fileMatchesColumnPattern(compiled, ctx.sampleLines, need);
          checks.push({
            kind: 'file-template:columnPattern',
            label: `column pattern ${refLabel}`,
            status: m.matched ? 'satisfied' : 'unsatisfied',
            detail: `${m.matchedCount}/${m.total} sampled lines match (${Math.round(m.ratio * 100)}%, need ≥${Math.round(need * 100)}%)`,
          });
        }
      }
    }
  }

  // ── referenced entities (informational; never blocks) ──
  for (const ref of manifest.entities ?? []) {
    const label = `${ref.kind} ${ref.name || ref.id || ''}`.trim();
    const r = ctx.resolveEntity?.(ref) ?? null;
    if (!r) {
      checks.push({ kind: `entity:${ref.kind}`, label, status: 'unverified', detail: 'declared; not verified on this machine' });
    } else {
      checks.push({
        kind: `entity:${ref.kind}`,
        label,
        status: r.present ? 'satisfied' : 'unsatisfied',
        detail: r.present ? (r.applied ? 'present & applied' : 'present') : 'not found',
      });
    }
  }

  const blocked = checks.some(c => c.kind.startsWith('file-template') && c.status === 'unsatisfied');
  const nOk = checks.filter(c => c.status === 'satisfied').length;
  const summary = checks.length === 0
    ? 'No requirements declared.'
    : `${nOk}/${checks.length} checks satisfied${blocked ? ' — file-template mismatch, replay blocked' : ''}.`;
  return { blocked, checks, summary };
}
