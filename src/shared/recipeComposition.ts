// Recipe COMPOSITION — build a "complicated" recipe out of simpler saved recipes, wiring
// each sub-recipe to the next with an optional CONDITIONAL guard on the previous sub-recipe's
// typed answer ("if recipe-a returns true → run recipe-b with these inputs"). A composite is
// itself a normal InvestigationTemplate whose steps recurse into the run engine, so it lists /
// runs / forks / pins like any other recipe. Pure (no DOM/Node) so it's unit-tested and
// mirrored in the renderer as script-scope fns.

import { AnswerValue } from './recipeOutputs';

// A conditional guard on a composite step: run the step only if the PRECEDING step's typed
// answer satisfies this test. v1 tests the immediately-preceding step's answer value.
//  - true/false : the answer's boolean truthiness (did it find / confirm something)
//  - gt/lt/eq   : the answer's numeric count (eq also matches on text when count is absent)
//  - contains   : case-insensitive substring of the answer's text label
export interface StepGuard {
  op: 'true' | 'false' | 'gt' | 'lt' | 'eq' | 'contains';
  value?: number | string; // operand for gt/lt/eq/contains (ignored for true/false)
}

// The api path a composite step uses — running a saved sub-recipe. A step with this path
// carries { name, params } in its body and is replayed by recursing into the run handler.
export const COMPOSITE_STEP_PATH = '/api/investigation-run';

export function isCompositeStep(step: { path?: string; [k: string]: any } | undefined | null): boolean {
  return !!step && step.path === COMPOSITE_STEP_PATH;
}

export function compositeTarget(step: { body?: any; [k: string]: any } | undefined | null): string | undefined {
  const nm = step?.body?.name;
  return typeof nm === 'string' && nm ? nm : undefined;
}

// Coerce arbitrary input into a valid StepGuard (or undefined). Keeps only a known op and
// carries `value` only for the ops that use it — so a persisted guard is always well-formed.
export function normalizeGuard(g: any): StepGuard | undefined {
  if (!g || typeof g !== 'object') return undefined;
  const op = g.op;
  if (op !== 'true' && op !== 'false' && op !== 'gt' && op !== 'lt' && op !== 'eq' && op !== 'contains') return undefined;
  const out: StepGuard = { op };
  if (op !== 'true' && op !== 'false') out.value = g.value;
  return out;
}

// Evaluate a guard against the previous step's answer value. No guard → always run. A
// missing / kind:'none' answer (nothing to test) NEVER satisfies a guard — the guarded step
// is skipped (a conditional can't fire off a result that doesn't exist).
export function evaluateGuard(guard: StepGuard | undefined | null, prev: AnswerValue | null | undefined): boolean {
  if (!guard) return true;
  if (!prev || prev.kind === 'none') return false;
  switch (guard.op) {
    case 'true':  return prev.bool === true;
    case 'false': return prev.bool === false;
    case 'gt':    return typeof prev.count === 'number' && prev.count > Number(guard.value);
    case 'lt':    return typeof prev.count === 'number' && prev.count < Number(guard.value);
    case 'eq':
      if (typeof prev.count === 'number' && guard.value !== '' && guard.value != null && !isNaN(Number(guard.value))) {
        return prev.count === Number(guard.value);
      }
      return prev.text != null && String(prev.text) === String(guard.value);
    case 'contains':
      return prev.text != null && String(prev.text).toLowerCase().includes(String(guard.value ?? '').toLowerCase());
    default:
      return false;
  }
}

// Human-readable one-liner for a guard (step labels + UI). "" when there's no guard.
export function describeGuard(guard: StepGuard | undefined | null): string {
  if (!guard) return '';
  switch (guard.op) {
    case 'true':     return 'if previous = true';
    case 'false':    return 'if previous = false';
    case 'gt':       return `if previous > ${guard.value}`;
    case 'lt':       return `if previous < ${guard.value}`;
    case 'eq':       return `if previous = ${guard.value}`;
    case 'contains': return `if previous contains "${guard.value}"`;
    default:         return '';
  }
}
