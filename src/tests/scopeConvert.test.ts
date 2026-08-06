import { describe, it, expect } from 'vitest';
import { toApiScope } from '../shared/scopeConvert';

describe('toApiScope (1-based viewer → 0-based API)', () => {
  it('undefined/null passes through as undefined', () => {
    expect(toApiScope(undefined)).toBeUndefined();
    expect(toApiScope(null)).toBeUndefined();
  });

  it('range: converts 1-based bounds to 0-based', () => {
    expect(toApiScope({ type: 'range', start: 100, end: 200 }))
      .toEqual({ type: 'range', start: 99, end: 199 });
  });

  it('range: clamps at 0 (never negative)', () => {
    expect(toApiScope({ type: 'range', start: 1, end: 1 }))
      .toEqual({ type: 'range', start: 0, end: 0 });
  });

  it('indices: maps each line -1 and keeps the label', () => {
    expect(toApiScope({ type: 'indices', lines: [8047, 9252], label: 'crash sites' }))
      .toEqual({ type: 'indices', lines: [8046, 9251], label: 'crash sites' });
  });

  it('indices: omits label when absent', () => {
    expect(toApiScope({ type: 'indices', lines: [1] })).toEqual({ type: 'indices', lines: [0] });
  });

  it('filter / all / active / search / selection pass through untouched', () => {
    for (const type of ['all', 'active', 'filter', 'search', 'selection'] as const) {
      expect(toApiScope({ type })).toEqual({ type });
    }
  });

  it('time and component pass through untouched (no line numbers to convert)', () => {
    expect(toApiScope({ type: 'time', from: 'a', to: 'b' })).toEqual({ type: 'time', from: 'a', to: 'b' });
    expect(toApiScope({ type: 'component', name: 'Net' })).toEqual({ type: 'component', name: 'Net' });
  });

  it('compose: recurses, converting range/indices inside and passing filter through', () => {
    expect(toApiScope({
      type: 'compose',
      label: 'errors 100-200',
      scopes: [{ type: 'filter' }, { type: 'range', start: 100, end: 200 }, { type: 'indices', lines: [5] }],
    })).toEqual({
      type: 'compose',
      label: 'errors 100-200',
      scopes: [{ type: 'filter' }, { type: 'range', start: 99, end: 199 }, { type: 'indices', lines: [4] }],
    });
  });
});
