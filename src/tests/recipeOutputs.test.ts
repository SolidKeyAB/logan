import { describe, it, expect } from 'vitest';
import { deriveRecipeOutputs, outputLabelForPath } from '../shared/recipeOutputs';

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
