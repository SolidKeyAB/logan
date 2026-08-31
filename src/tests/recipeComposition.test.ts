import { describe, it, expect } from 'vitest';
import {
  evaluateGuard, describeGuard, normalizeGuard, isCompositeStep, compositeTarget, COMPOSITE_STEP_PATH,
} from '../shared/recipeComposition';
import { AnswerValue } from '../shared/recipeOutputs';

const boolT: AnswerValue = { kind: 'boolean', bool: true };
const boolF: AnswerValue = { kind: 'boolean', bool: false };
const cnt = (c: number): AnswerValue => ({ kind: 'count', count: c, bool: c > 0 });
const txt = (t: string): AnswerValue => ({ kind: 'text', bool: true, text: t });
const none: AnswerValue = { kind: 'none', bool: false };

describe('evaluateGuard', () => {
  it('no guard always runs', () => {
    expect(evaluateGuard(undefined, none)).toBe(true);
    expect(evaluateGuard(null, boolT)).toBe(true);
  });
  it('a missing / none answer never satisfies a guard (nothing to test → skip)', () => {
    expect(evaluateGuard({ op: 'true' }, null)).toBe(false);
    expect(evaluateGuard({ op: 'false' }, none)).toBe(false);
    expect(evaluateGuard({ op: 'gt', value: 0 }, undefined)).toBe(false);
  });
  it('true / false test the boolean', () => {
    expect(evaluateGuard({ op: 'true' }, boolT)).toBe(true);
    expect(evaluateGuard({ op: 'true' }, boolF)).toBe(false);
    expect(evaluateGuard({ op: 'false' }, boolF)).toBe(true);
    expect(evaluateGuard({ op: 'false' }, cnt(0))).toBe(true);   // count 0 → bool false
    expect(evaluateGuard({ op: 'true' }, cnt(3))).toBe(true);    // count 3 → bool true
  });
  it('gt / lt compare the count', () => {
    expect(evaluateGuard({ op: 'gt', value: 5 }, cnt(6))).toBe(true);
    expect(evaluateGuard({ op: 'gt', value: 5 }, cnt(5))).toBe(false);
    expect(evaluateGuard({ op: 'lt', value: 2 }, cnt(1))).toBe(true);
    expect(evaluateGuard({ op: 'gt', value: 0 }, txt('anything'))).toBe(false); // no count → false
  });
  it('eq matches count numerically or text exactly', () => {
    expect(evaluateGuard({ op: 'eq', value: 3 }, cnt(3))).toBe(true);
    expect(evaluateGuard({ op: 'eq', value: 4 }, cnt(3))).toBe(false);
    expect(evaluateGuard({ op: 'eq', value: 'OOM' }, txt('OOM'))).toBe(true);
    expect(evaluateGuard({ op: 'eq', value: 'OOM' }, txt('panic'))).toBe(false);
  });
  it('contains does a case-insensitive substring test on text', () => {
    expect(evaluateGuard({ op: 'contains', value: 'oom' }, txt('OOM killer invoked'))).toBe(true);
    expect(evaluateGuard({ op: 'contains', value: 'panic' }, txt('OOM'))).toBe(false);
    expect(evaluateGuard({ op: 'contains', value: 'x' }, cnt(3))).toBe(false); // no text → false
  });
});

describe('describeGuard', () => {
  it('renders a readable one-liner', () => {
    expect(describeGuard(undefined)).toBe('');
    expect(describeGuard({ op: 'true' })).toBe('if previous = true');
    expect(describeGuard({ op: 'gt', value: 0 })).toBe('if previous > 0');
    expect(describeGuard({ op: 'contains', value: 'OOM' })).toBe('if previous contains "OOM"');
  });
});

describe('normalizeGuard', () => {
  it('keeps a valid op and carries value only for value-ops', () => {
    expect(normalizeGuard({ op: 'true', value: 9 })).toEqual({ op: 'true' });
    expect(normalizeGuard({ op: 'gt', value: 5 })).toEqual({ op: 'gt', value: 5 });
  });
  it('drops junk', () => {
    expect(normalizeGuard(null)).toBeUndefined();
    expect(normalizeGuard({ op: 'nope' })).toBeUndefined();
    expect(normalizeGuard('x')).toBeUndefined();
  });
});

describe('composite step helpers', () => {
  it('identifies a composite step + its target sub-recipe', () => {
    const step = { path: COMPOSITE_STEP_PATH, body: { name: 'oom-confirm', params: {} } };
    expect(isCompositeStep(step)).toBe(true);
    expect(isCompositeStep({ path: '/api/search', body: {} })).toBe(false);
    expect(compositeTarget(step)).toBe('oom-confirm');
    expect(compositeTarget({ path: COMPOSITE_STEP_PATH, body: {} })).toBeUndefined();
  });
});
