import { describe, it, expect } from 'vitest';
import { deriveRecipeOutputs, outputLabelForPath, resolveAnswerStep, deriveAnswerValue } from '../shared/recipeOutputs';

describe('outputLabelForPath', () => {
  it('maps known output verbs to labels', () => {
    expect(outputLabelForPath('/api/search')).toBe('matches');
    expect(outputLabelForPath('/api/investigate-crashes')).toBe('crash findings');
    expect(outputLabelForPath('/api/time-gaps')).toBe('time gaps');
    expect(outputLabelForPath('/api/build-conclusion')).toBe('verdict');
  });
  it('maps any trend verb to "trend"', () => {
    expect(outputLabelForPath('/api/trend-series')).toBe('trend');
    expect(outputLabelForPath('/api/trend-correlate')).toBe('trend');
  });
  it('returns null for non-output verbs', () => {
    expect(outputLabelForPath('/api/navigate')).toBeNull();
    expect(outputLabelForPath(undefined)).toBeNull();
  });
});

describe('deriveRecipeOutputs', () => {
  it('lists distinct output kinds in first-seen order', () => {
    const steps = [
      { path: '/api/search' },
      { path: '/api/filter' },
      { path: '/api/trend-series' },
      { path: '/api/trend-transitions' }, // same kind → not repeated
      { path: '/api/investigate-crashes' },
      { path: '/api/navigate' },          // dropped
    ];
    expect(deriveRecipeOutputs(steps)).toEqual(['matches', 'filtered view', 'trend', 'crash findings']);
  });
  it('is empty for a recipe of pure navigation/no-output steps', () => {
    expect(deriveRecipeOutputs([{ path: '/api/navigate' }])).toEqual([]);
    expect(deriveRecipeOutputs(undefined)).toEqual([]);
  });
});

describe('resolveAnswerStep', () => {
  const steps = [
    { path: '/api/search' },      // 0 output
    { path: '/api/navigate' },    // 1 no output
    { path: '/api/analyze' },     // 2 output
    { path: '/api/navigate' },    // 3 no output
  ];
  it('honors an explicit answer step (not heuristic)', () => {
    expect(resolveAnswerStep(steps, 0)).toEqual({ index: 0, heuristic: false });
    expect(resolveAnswerStep(steps, 2)).toEqual({ index: 2, heuristic: false });
  });
  it('falls back to the LAST output-producing step as a heuristic', () => {
    expect(resolveAnswerStep(steps, undefined)).toEqual({ index: 2, heuristic: true });
  });
  it('ignores an explicit index that is out of range or a non-output step → heuristic', () => {
    expect(resolveAnswerStep(steps, 99)).toEqual({ index: 2, heuristic: true }); // out of range
    expect(resolveAnswerStep(steps, 1)).toEqual({ index: 2, heuristic: true });  // marked a no-output step
  });
  it('returns null when no step produces an output', () => {
    expect(resolveAnswerStep([{ path: '/api/navigate' }], undefined)).toBeNull();
    expect(resolveAnswerStep([], 0)).toBeNull();
    expect(resolveAnswerStep(undefined, undefined)).toBeNull();
  });
});

describe('deriveAnswerValue', () => {
  it('search → count + truthiness', () => {
    expect(deriveAnswerValue('/api/search', { success: true, matches: [1, 2, 3] })).toEqual({ kind: 'count', count: 3, bool: true });
    expect(deriveAnswerValue('/api/search', { success: true, totalMatches: 0 })).toEqual({ kind: 'count', count: 0, bool: false });
  });
  it('filter / time-gaps / crashes / trends → counts', () => {
    expect(deriveAnswerValue('/api/filter', { success: true, filteredLines: 12 })).toEqual({ kind: 'count', count: 12, bool: true });
    expect(deriveAnswerValue('/api/time-gaps', { success: true, gaps: [] })).toEqual({ kind: 'count', count: 0, bool: false });
    expect(deriveAnswerValue('/api/investigate-crashes', { success: true, crashes: [{}, {}] })).toEqual({ kind: 'count', count: 2, bool: true });
    expect(deriveAnswerValue('/api/trend-series', { success: true, totalPoints: 5 })).toEqual({ kind: 'count', count: 5, bool: true });
  });
  it('investigate-component → not-found is a false boolean; else mentions count', () => {
    expect(deriveAnswerValue('/api/investigate-component', { success: true, found: false })).toEqual({ kind: 'boolean', bool: false, text: 'not found' });
    expect(deriveAnswerValue('/api/investigate-component', { success: true, totalMentions: 7 })).toEqual({ kind: 'count', count: 7, bool: true });
  });
  it('build-conclusion → text verdict (truthy)', () => {
    expect(deriveAnswerValue('/api/build-conclusion', { success: true, report: { verdict: { headline: 'OOM kill' } } }))
      .toEqual({ kind: 'text', bool: true, text: 'OOM kill' });
  });
  it('evidence-pack → severity text, truthy only when it signals a problem', () => {
    expect(deriveAnswerValue('/api/evidence-pack', { success: true, pack: { severity: 'error' } })).toEqual({ kind: 'text', bool: true, text: 'error' });
    expect(deriveAnswerValue('/api/evidence-pack', { success: true, pack: { severity: 'info' } })).toEqual({ kind: 'text', bool: false, text: 'info' });
  });
  it('composite step → passes the sub-recipe’s own typed answer through', () => {
    const subAnswer = { kind: 'count', count: 4, bool: true };
    expect(deriveAnswerValue('/api/investigation-run', { success: true, answer: { value: subAnswer } })).toEqual(subAnswer);
    // sub-recipe blocked / no typed answer → none
    expect(deriveAnswerValue('/api/investigation-run', { success: true, blocked: true })).toEqual({ kind: 'none', bool: false });
  });
  it('failed / empty / unknown → none or a benign boolean', () => {
    expect(deriveAnswerValue('/api/search', { success: false })).toEqual({ kind: 'none', bool: false });
    expect(deriveAnswerValue(undefined, { success: true })).toEqual({ kind: 'none', bool: false });
    expect(deriveAnswerValue('/api/navigate', { success: true })).toEqual({ kind: 'boolean', bool: true });
  });
});
