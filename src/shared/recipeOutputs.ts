// Recipe outputs — what a saved investigation (a "recipe") YIELDS.
//
// A recipe is a typed transform: inputs (its params + requirements) → steps → OUTPUTS.
// The inputs were already modelled (ParamDef roles + RequirementsManifest); this is the
// output half. v1 DERIVES the output kinds from the recorded step verbs (zero migration,
// same derive-at-read trick as ParamRole) so a recipe can advertise "what it produces"
// before you run it, and the run can present its result as an explicit Output. A future
// slice can let a recipe AUTHOR/declare its outputs explicitly.
//
// Pure (no DOM) so it's unit-tested headlessly; the renderer mirrors it as a script fn.

// api path → the human label of the output that step produces (null = not an output verb).
const OUTPUT_LABEL_BY_PATH: Record<string, string> = {
  '/api/search': 'matches',
  '/api/filter': 'filtered view',
  '/api/analyze': 'level breakdown',
  '/api/time-gaps': 'time gaps',
  '/api/investigate-crashes': 'crash findings',
  '/api/investigate-component': 'component health',
  '/api/investigate-timerange': 'timerange findings',
  '/api/triage': 'triage',
  '/api/build-conclusion': 'verdict',
  '/api/summarize': 'templates',
  '/api/evidence-pack': 'evidence pack',
  '/api/diff-runs': 'run diff',
  // A composite (recipe-of-recipes) step runs a saved SUB-recipe; its output is that
  // sub-recipe's own answer. Listing it here makes a composite step count as an
  // output-producing step (so it can be the answer / show in the yields signature).
  '/api/investigation-run': 'recipe answer',
};

export function outputLabelForPath(path: string | undefined): string | null {
  if (!path) return null;
  if (OUTPUT_LABEL_BY_PATH[path]) return OUTPUT_LABEL_BY_PATH[path];
  if (path.startsWith('/api/trend')) return 'trend';
  return null;
}

/** Distinct output kinds a recipe yields, in first-seen order (its output "signature"). */
export function deriveRecipeOutputs(steps: Array<{ path?: string }> | undefined): string[] {
  const out: string[] = [];
  for (const s of steps || []) {
    const label = outputLabelForPath(s?.path);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * Resolve which step is a recipe's ANSWER — the valuable output that answers its aim.
 * Strategy "C": an EXPLICIT answerStepIndex wins (heuristic:false) as long as it points at
 * an output-producing step; otherwise fall back to the HEURISTIC — the LAST output-producing
 * step (heuristic:true), the recipe's final result. Returns null when no step yields an
 * output at all. Callers MUST surface `heuristic:true` to the user (it's a best guess, not a
 * designated answer). Pure — unit-tested; the renderer mirrors it as a script fn.
 */
export function resolveAnswerStep(
  steps: Array<{ path?: string }> | undefined,
  answerStepIndex?: number,
): { index: number; heuristic: boolean } | null {
  const s = steps || [];
  if (typeof answerStepIndex === 'number' && answerStepIndex >= 0 && answerStepIndex < s.length
      && outputLabelForPath(s[answerStepIndex]?.path)) {
    return { index: answerStepIndex, heuristic: false };
  }
  for (let i = s.length - 1; i >= 0; i--) {
    if (outputLabelForPath(s[i]?.path)) return { index: i, heuristic: true };
  }
  return null;
}

/**
 * A recipe's answer, NORMALIZED to a comparable value — the thing a conditional recipe
 * branches on ("if recipe-a returns true → run recipe-b"). `bool` is the primary truthiness
 * a guard tests (did the step find / confirm something); `count` is the numeric magnitude
 * when meaningful (matches, gaps, mentions, crashes…); `text` is a categorical label when
 * the answer is textual (a verdict, a severity, "not found"). `kind` says which is primary.
 */
export interface AnswerValue {
  kind: 'count' | 'boolean' | 'text' | 'none';
  bool: boolean;
  count?: number;
  text?: string;
}

/**
 * Derive the typed answer VALUE from a step's raw replay result. Reads the same fields as
 * the run's per-step summary (kept consistent) but yields a machine-comparable value so a
 * composite recipe can test it. A failed/empty result → { kind:'none', bool:false }. For a
 * composite sub-recipe step (`/api/investigation-run`) it passes the sub-recipe's OWN typed
 * answer through, so guards compose across nesting. Pure — unit-tested; mirrored in renderer.
 */
export function deriveAnswerValue(path: string | undefined, result: any): AnswerValue {
  const NONE: AnswerValue = { kind: 'none', bool: false };
  if (!path || !result || result.success === false) return NONE;
  const num = (v: any): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);
  const count = (c: number): AnswerValue => ({ kind: 'count', count: c, bool: c > 0 });

  if (path === '/api/search') return count(num(result.matches?.length) ?? num(result.totalMatches) ?? 0);
  if (path === '/api/filter') return count(num(result.filteredLines) ?? num(result.lines?.length) ?? 0);
  if (path === '/api/time-gaps') return count(num(result.gaps?.length) ?? 0);
  if (path === '/api/investigate-crashes') return count(num(result.crashes?.length) ?? num(result.groups?.length) ?? 0);
  if (path === '/api/investigate-component') {
    if (result.found === false) return { kind: 'boolean', bool: false, text: 'not found' };
    return count(num(result.totalMentions) ?? 0);
  }
  if (path === '/api/diff-runs') return count(num(result.diff?.summary?.onlyInTarget) ?? 0);
  if (path.startsWith('/api/trend')) {
    return count(num(result.totalPoints) ?? num(result.transitions?.length) ?? num(result.fields?.length) ?? 0);
  }
  if (path === '/api/build-conclusion') {
    const v = result.report?.verdict?.headline ?? result.verdict?.headline ?? result.conclusion?.verdict ?? result.verdict;
    const t = v != null ? String(v) : undefined;
    return t ? { kind: 'text', bool: true, text: t } : { kind: 'boolean', bool: true };
  }
  if (path === '/api/evidence-pack') {
    const sev = result.pack?.severity;
    const t = sev != null ? String(sev) : undefined;
    return t ? { kind: 'text', bool: /error|fatal|critical|warn/i.test(t), text: t } : NONE;
  }
  if (path === '/api/analyze') {
    const s = result.analysis?.summary;
    return s ? { kind: 'text', bool: true, text: String(s) } : { kind: 'boolean', bool: true };
  }
  if (path === '/api/investigation-run') {
    // Composite: pass the sub-recipe's own typed answer through (already an AnswerValue).
    const sub = result.answer?.value;
    if (sub && typeof sub === 'object' && typeof (sub as any).kind === 'string') return sub as AnswerValue;
    return NONE;
  }
  return { kind: 'boolean', bool: true };
}
