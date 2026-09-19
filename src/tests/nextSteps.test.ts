import { describe, it, expect } from 'vitest';
import { suggestNextSteps, NextStepContext, MAX_NEXT_STEPS, NEXT_STEP_META } from '../shared/nextSteps';

const base: NextStepContext = {
  fatal: 0, error: 0, warning: 0, matches: 0, isFiltered: false, findings: 0, savedRecipes: 0,
};
const verbs = (ctx: Partial<NextStepContext>) => suggestNextSteps({ ...base, ...ctx }).map(s => s.verb);

describe('suggestNextSteps', () => {
  it('never returns more than the cap, never empty', () => {
    const out = suggestNextSteps(base);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(MAX_NEXT_STEPS);
  });

  it('a bare clean log falls back to trend + search', () => {
    expect(verbs({})).toEqual(['trend', 'search']);
  });

  it('a live unfiltered search leads with "filter to matches"', () => {
    const out = suggestNextSteps({ ...base, matches: 42 });
    expect(out[0].verb).toBe('filter');
    expect(out[0].reason).toContain('42');
  });

  it('does NOT suggest filtering once a filter is already active', () => {
    expect(verbs({ matches: 42, isFiltered: true })).not.toContain('filter');
  });

  it('errors/fatals surface time-gaps as the top move', () => {
    const out = suggestNextSteps({ ...base, error: 5, fatal: 1 });
    expect(out[0].verb).toBe('time-gaps');
  });

  it('pinned findings suggest saving a recipe (with the count)', () => {
    const out = suggestNextSteps({ ...base, error: 3, findings: 4 });
    const recipe = out.find(s => s.verb === 'recipe');
    expect(recipe).toBeTruthy();
    expect(recipe!.reason).toContain('4');
    expect(recipe!.reason).toMatch(/save/i);
  });

  it('warnings-only nudges trending (not time-gaps)', () => {
    const out = verbs({ warning: 9 });
    expect(out).toContain('trend');
    expect(out).not.toContain('time-gaps');
  });

  it('does not nudge time-gaps when there are zero errors/fatals', () => {
    expect(verbs({ warning: 3, savedRecipes: 2 })).not.toContain('time-gaps');
  });

  it('saved recipes offer a replay when nothing more urgent applies', () => {
    const out = suggestNextSteps({ ...base, savedRecipes: 3 });
    const recipe = out.find(s => s.verb === 'recipe');
    expect(recipe).toBeTruthy();
    expect(recipe!.reason).toMatch(/run one of your 3/i);
  });

  it('dedupes a verb that qualifies twice, keeping the higher-priority reason', () => {
    // findings (save, prio 70) beats savedRecipes (run, prio 50) — one recipe row, "save".
    const out = suggestNextSteps({ ...base, findings: 2, savedRecipes: 5 });
    const recipes = out.filter(s => s.verb === 'recipe');
    expect(recipes).toHaveLength(1);
    expect(recipes[0].reason).toMatch(/save/i);
  });

  it('ranks the busy case: filter > time-gaps > recipe within the cap', () => {
    const out = suggestNextSteps({
      ...base, error: 4, fatal: 1, matches: 10, isFiltered: false, findings: 2, savedRecipes: 3,
    });
    expect(out.map(s => s.verb)).toEqual(['filter', 'time-gaps', 'recipe']);
  });

  it('priorities are strictly descending in the returned list', () => {
    const out = suggestNextSteps({ ...base, error: 2, matches: 3, findings: 1 });
    for (let i = 1; i < out.length; i++) expect(out[i - 1].priority).toBeGreaterThan(out[i].priority);
  });

  it('every verb has display metadata', () => {
    for (const v of ['search', 'filter', 'trend', 'time-gaps', 'recipe'] as const) {
      expect(NEXT_STEP_META[v]).toBeTruthy();
      expect(NEXT_STEP_META[v].label.length).toBeGreaterThan(0);
    }
  });
});
