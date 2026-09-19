// Next-step suggestions — LOGAN's answer to "with so many panels/buttons, what do
// I actually DO next?". Given the cheap signals already known while the user is
// looking at a log (severity counts, an active search/filter, pinned findings, how
// many saved recipes exist), rank the handful of moves worth making right now.
//
// Deliberately built on the EXISTING recipe step vocabulary (search / filter / trend /
// time-gaps / run-a-recipe) rather than a new action taxonomy — a suggestion is just a
// recipe verb the user could run next, so the same primitive powers recipes, the agent,
// and this coach. Reactive by construction: it's recomputed every time the pill's
// pulldown opens, so it changes as the user searches, filters, and pins findings.
//
// Pure (no DOM) so it's unit-tested headlessly; the renderer mirrors it as a script fn
// and maps each verb to the existing UI action that performs it.

// A next-step verb — a member of the recipe step vocabulary (see recipeOutputs.ts),
// narrowed to the moves that have a one-click UI entry point.
export type NextStepVerb = 'search' | 'filter' | 'trend' | 'time-gaps' | 'recipe';

// The cheap, always-available signals the ranking reads. Everything here is known
// without any heavy scan (severity index + live renderer state).
export interface NextStepContext {
  fatal: number;         // fatal count from the cheap severity index
  error: number;         // error count
  warning: number;       // warning count
  matches: number;       // active search-result count (0 = no live search)
  isFiltered: boolean;   // a filter is currently narrowing the view
  findings: number;      // pinned AI findings / annotations
  savedRecipes: number;  // saved recipes available to replay on this log
}

export interface NextStep {
  verb: NextStepVerb;
  reason: string;        // the why-NOW, phrased for this context
  priority: number;      // higher = shown first
}

// Cap the coach so it stays a nudge, not a menu.
export const MAX_NEXT_STEPS = 3;

// Static display copy per verb (pure — the renderer wires the action).
export const NEXT_STEP_META: Record<NextStepVerb, { icon: string; label: string }> = {
  search: { icon: '🔎', label: 'Search the log' },
  filter: { icon: '▽', label: 'Filter the view' },
  trend: { icon: '📈', label: 'Trend a field over time' },
  'time-gaps': { icon: '⏱', label: 'Find time gaps' },
  recipe: { icon: '▶', label: 'Saved recipes' },
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Rank the next moves for the current context. Collects context-specific candidates
 * plus two always-available fallbacks (trend / search) at low priority, dedupes by
 * verb (keeping the highest-priority reason for a verb that qualifies twice), and
 * returns the top MAX_NEXT_STEPS by priority. Pure + deterministic — unit-tested;
 * the renderer mirrors it. Never returns an empty list (the fallbacks always apply).
 */
export function suggestNextSteps(ctx: NextStepContext): NextStep[] {
  const problems = ctx.fatal + ctx.error;
  const candidates: NextStep[] = [];

  // Reactive: a search is live but the view isn't narrowed yet → focus on the hits.
  if (ctx.matches > 0 && !ctx.isFiltered) {
    candidates.push({
      verb: 'filter',
      priority: 90,
      reason: `Filter to your ${ctx.matches.toLocaleString()} search ${plural(ctx.matches, 'match', 'matches')} and hide the rest.`,
    });
  }

  // Errors/fatals present → the classic "did it stall?" follow-up pins the moment.
  if (problems > 0) {
    candidates.push({
      verb: 'time-gaps',
      priority: 80,
      reason: 'Check for stalls — a time gap around the failures often pins the moment it broke.',
    });
  }

  // Findings pinned → capture the trail as a replayable recipe (this is where "Save
  // current" lives), so the next incident is one click.
  if (ctx.findings > 0) {
    candidates.push({
      verb: 'recipe',
      priority: 70,
      reason: `You've pinned ${ctx.findings.toLocaleString()} ${plural(ctx.findings, 'finding', 'findings')} — save these steps as a recipe to replay next time.`,
    });
  }

  // Only warnings → trend them to tell "noisy but stable" from "creeping worse".
  if (problems === 0 && ctx.warning > 0) {
    candidates.push({
      verb: 'trend',
      priority: 60,
      reason: 'Only warnings here — trend a field over time to see if they’re growing or steady.',
    });
  }

  // Saved recipes exist → offer to replay one on this log.
  if (ctx.savedRecipes > 0) {
    candidates.push({
      verb: 'recipe',
      priority: 50,
      reason: `Run one of your ${ctx.savedRecipes.toLocaleString()} saved ${plural(ctx.savedRecipes, 'recipe', 'recipes')} on this log.`,
    });
  }

  // Always-available fallbacks — low priority so any real context wins, but they
  // guarantee the coach never comes up empty.
  candidates.push({ verb: 'trend', priority: 20, reason: 'Trend a field (voltage, state, counts…) over time to spot the turn.' });
  candidates.push({ verb: 'search', priority: 10, reason: 'Search the log for a message, id, or component.' });

  // Dedupe by verb, keeping the highest-priority reason for each.
  const byVerb = new Map<NextStepVerb, NextStep>();
  for (const s of candidates) {
    const cur = byVerb.get(s.verb);
    if (!cur || s.priority > cur.priority) byVerb.set(s.verb, s);
  }

  return Array.from(byVerb.values())
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_NEXT_STEPS);
}
