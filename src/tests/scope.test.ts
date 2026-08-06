import { describe, it, expect } from 'vitest';
import { resolveScope, scopeInfo, isWholeFile, intersectResolved, ScopeResolverContext } from '../main/scope';
import { ScopeDescriptor, ResolvedScope } from '../shared/types';

function makeCtx(overrides: Partial<ScopeResolverContext> & { total: number }): ScopeResolverContext {
  const { total, ...rest } = overrides;
  return {
    getTotalLines: () => total,
    getFilteredLines: () => null,
    ...rest,
  };
}

describe('resolveScope', () => {
  it('all → whole-file range', () => {
    const r = resolveScope(makeCtx({ total: 100 }), { type: 'all' });
    expect(r).toMatchObject({ kind: 'range', startLine: 0, endLine: 99, count: 100 });
  });

  it('undefined descriptor defaults to all', () => {
    expect(resolveScope(makeCtx({ total: 10 }))).toMatchObject({ kind: 'range', startLine: 0, endLine: 9, count: 10 });
  });

  it('all on empty file → count 0', () => {
    const r = resolveScope(makeCtx({ total: 0 }), { type: 'all' });
    expect(r.count).toBe(0);
    expect(r.kind).toBe('range');
  });

  it('range clamps to file bounds', () => {
    const r = resolveScope(makeCtx({ total: 50 }), { type: 'range', start: 10, end: 999 });
    expect(r).toMatchObject({ kind: 'range', startLine: 10, endLine: 49, count: 40 });
  });

  it('range normalizes inverted bounds', () => {
    const r = resolveScope(makeCtx({ total: 50 }), { type: 'range', start: 20, end: 5 });
    expect(r).toMatchObject({ kind: 'range', startLine: 5, endLine: 20, count: 16 });
  });

  it('indices are deduped, sorted and clamped to bounds', () => {
    const r = resolveScope(makeCtx({ total: 10 }), { type: 'indices', lines: [5, 1, 1, 99, -3, 3] });
    expect(r).toMatchObject({ kind: 'indices', lines: [1, 3, 5], count: 3 });
  });

  it('filter → indices from the active filter set', () => {
    const r = resolveScope(makeCtx({ total: 100, getFilteredLines: () => [2, 4, 6] }), { type: 'filter' });
    expect(r).toMatchObject({ kind: 'indices', lines: [2, 4, 6], count: 3 });
    expect(r.label).toContain('filter');
  });

  it('empty filter → indices with count 0 (never a silent whole-file fall-through)', () => {
    const r = resolveScope(makeCtx({ total: 100, getFilteredLines: () => [] }), { type: 'filter' });
    expect(r).toMatchObject({ kind: 'indices', lines: [], count: 0 });
    expect(r.warning).toBeUndefined();
  });

  it('filter with no active filter → whole file WITH a warning', () => {
    const r = resolveScope(makeCtx({ total: 100, getFilteredLines: () => null }), { type: 'filter' });
    expect(r.kind).toBe('range');
    expect(r.count).toBe(100);
    expect(r.warning).toMatch(/no active filter/);
  });

  it('search → indices when provided, warning otherwise', () => {
    expect(resolveScope(makeCtx({ total: 100, getSearchLines: () => [1, 9] }), { type: 'search' }))
      .toMatchObject({ kind: 'indices', lines: [1, 9] });
    expect(resolveScope(makeCtx({ total: 100 }), { type: 'search' }).warning).toMatch(/no search results/);
  });

  it('selection → indices when provided', () => {
    expect(resolveScope(makeCtx({ total: 100, getSelectionLines: () => [3, 4, 5] }), { type: 'selection' }))
      .toMatchObject({ kind: 'indices', lines: [3, 4, 5], count: 3 });
  });

  it('active → delegates to the current active descriptor', () => {
    const ctx = makeCtx({
      total: 100,
      getActiveScope: () => ({ type: 'range', start: 0, end: 9 } as ScopeDescriptor),
    });
    expect(resolveScope(ctx, { type: 'active' })).toMatchObject({ kind: 'range', startLine: 0, endLine: 9 });
  });

  it('active with no active scope → whole file with warning', () => {
    expect(resolveScope(makeCtx({ total: 100 }), { type: 'active' }).warning).toMatch(/no active scope/);
  });

  it('active pointing at active does not recurse forever', () => {
    const ctx = makeCtx({ total: 100, getActiveScope: () => ({ type: 'active' }) });
    const r = resolveScope(ctx, { type: 'active' });
    expect(r.count).toBe(100);
  });

  it('component → indices via injected resolver', () => {
    const ctx = makeCtx({ total: 100, resolveComponentLines: (n) => (n === 'Net' ? [7, 8, 9] : []) });
    expect(resolveScope(ctx, { type: 'component', name: 'Net' }))
      .toMatchObject({ kind: 'indices', lines: [7, 8, 9], count: 3 });
  });

  it('component with no resolver → whole file with warning', () => {
    expect(resolveScope(makeCtx({ total: 100 }), { type: 'component', name: 'Net' }).warning).toMatch(/component scope/);
  });

  it('time → range via injected resolver', () => {
    const ctx = makeCtx({ total: 100, resolveTimeWindow: () => ({ startLine: 10, endLine: 20 }) });
    expect(resolveScope(ctx, { type: 'time', from: 'a', to: 'b' }))
      .toMatchObject({ kind: 'range', startLine: 10, endLine: 20, count: 11 });
  });

  it('time with no matching lines → empty', () => {
    const ctx = makeCtx({ total: 100, resolveTimeWindow: () => null });
    expect(resolveScope(ctx, { type: 'time', from: 'a', to: 'b' }).count).toBe(0);
  });
});

describe('scopeInfo', () => {
  it('range → 1-based display bounds', () => {
    const info = scopeInfo(resolveScope(makeCtx({ total: 100 }), { type: 'range', start: 0, end: 9 }));
    expect(info).toMatchObject({ kind: 'range', count: 10, startLine: 1, endLine: 10 });
  });

  it('indices → no range bounds, carries count', () => {
    const info = scopeInfo(resolveScope(makeCtx({ total: 100, getFilteredLines: () => [2, 4] }), { type: 'filter' }));
    expect(info).toMatchObject({ kind: 'indices', count: 2 });
    expect(info.startLine).toBeUndefined();
  });

  it('propagates warnings', () => {
    const info = scopeInfo(resolveScope(makeCtx({ total: 100 }), { type: 'filter' }));
    expect(info.warning).toMatch(/no active filter/);
  });
});

describe('intersectResolved (the true pipe)', () => {
  const range = (s: number, e: number): ResolvedScope => ({ kind: 'range', startLine: s, endLine: e, count: e - s + 1, label: `r${s}-${e}` });
  const idx = (lines: number[]): ResolvedScope => ({ kind: 'indices', lines, count: lines.length, label: 'idx' });

  it('empty list → whole file', () => {
    expect(intersectResolved([], 100)).toMatchObject({ kind: 'range', count: 100 });
  });

  it('single part → identity', () => {
    expect(intersectResolved([idx([1, 2, 3])], 100)).toMatchObject({ kind: 'indices', lines: [1, 2, 3] });
  });

  it('pure ranges intersect to a range without materializing', () => {
    expect(intersectResolved([range(0, 99), range(50, 200)], 100))
      .toMatchObject({ kind: 'range', startLine: 50, endLine: 99, count: 50 });
  });

  it('index-set ∩ range keeps only in-range lines', () => {
    expect(intersectResolved([idx([1, 5, 10, 50, 90]), range(5, 50)], 100))
      .toMatchObject({ kind: 'indices', lines: [5, 10, 50], count: 3 });
  });

  it('index-set ∩ index-set keeps the common lines', () => {
    expect(intersectResolved([idx([1, 2, 3, 4]), idx([3, 4, 5, 6])], 100))
      .toMatchObject({ kind: 'indices', lines: [3, 4], count: 2 });
  });

  it('disjoint sets → empty', () => {
    expect(intersectResolved([idx([1, 2]), idx([3, 4])], 100).count).toBe(0);
  });

  it('any empty part → empty', () => {
    expect(intersectResolved([idx([1, 2]), idx([])], 100).count).toBe(0);
  });
});

describe('resolveScope compose', () => {
  it('filter ∩ range via a compose descriptor', () => {
    const ctx = makeCtx({ total: 100, getFilteredLines: () => [1, 5, 10, 50, 90] });
    const r = resolveScope(ctx, { type: 'compose', scopes: [{ type: 'filter' }, { type: 'range', start: 5, end: 50 }] });
    expect(r).toMatchObject({ kind: 'indices', lines: [5, 10, 50], count: 3 });
  });

  it('honors an explicit compose label', () => {
    const ctx = makeCtx({ total: 100, getFilteredLines: () => [1, 2, 3] });
    const r = resolveScope(ctx, { type: 'compose', scopes: [{ type: 'filter' }, { type: 'all' }], label: 'my scope' });
    expect(r.label).toBe('my scope');
  });

  it('compose with an empty filter → empty', () => {
    const ctx = makeCtx({ total: 100, getFilteredLines: () => [] });
    expect(resolveScope(ctx, { type: 'compose', scopes: [{ type: 'filter' }, { type: 'range', start: 0, end: 9 }] }).count).toBe(0);
  });
});

describe('isWholeFile', () => {
  it('true only for a clean full-file range', () => {
    expect(isWholeFile(resolveScope(makeCtx({ total: 100 }), { type: 'all' }), 100)).toBe(true);
    expect(isWholeFile(resolveScope(makeCtx({ total: 100 }), { type: 'range', start: 0, end: 50 }), 100)).toBe(false);
    expect(isWholeFile(resolveScope(makeCtx({ total: 100, getFilteredLines: () => [1, 2] }), { type: 'filter' }), 100)).toBe(false);
    // a warned whole-file fallback is NOT treated as a clean whole-file scope
    expect(isWholeFile(resolveScope(makeCtx({ total: 100 }), { type: 'filter' }), 100)).toBe(false);
  });
});
