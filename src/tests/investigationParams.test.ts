import { describe, it, expect } from 'vitest';
import { buildTemplate, resolveSteps, paramKind, JournalEntry } from '../main/investigationStore';

// Build 0 (2026-08-20): the investigation entity carries a declared param schema
// (kind = time/range/component/field/pattern/event/other) so a human tweak-form
// can retarget a saved hunt — window nouns first — onto a NEW incident.

const journal: JournalEntry[] = [
  { path: '/api/investigate-timerange', body: { startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T01:00:00Z' }, ts: 1, label: 'timerange' },
  { path: '/api/investigate-component', body: { component: 'auth' }, ts: 2, label: 'component auth' },
  { path: '/api/trend-series', body: { field: 'isTokenExpired', startLine: 10, endLine: 200 }, ts: 3, label: 'trend' },
];

describe('paramKind classifier', () => {
  it('classifies window nouns as time/range', () => {
    expect(paramKind('startTime')).toBe('time');
    expect(paramKind('endTime')).toBe('time');
    expect(paramKind('startLine')).toBe('range');
    expect(paramKind('endLine')).toBe('range');
  });
  it('classifies the other promoted nouns', () => {
    expect(paramKind('component')).toBe('component');
    expect(paramKind('field')).toBe('field');
    expect(paramKind('pattern')).toBe('pattern');
    expect(paramKind('event')).toBe('event');
    expect(paramKind('expect')).toBe('other');
    expect(paramKind('somethingElse')).toBe('other');
  });
});

describe('buildTemplate param promotion', () => {
  const tpl = buildTemplate('T', journal);
  const byKey = (k: string) => tpl.params.find(p => p.key === k);

  it('promotes the time window as first-class params with kind + captured default', () => {
    expect(byKey('startTime')).toMatchObject({ kind: 'time', default: '2026-01-01T00:00:00Z' });
    expect(byKey('endTime')).toMatchObject({ kind: 'time' });
  });

  it('promotes range, component and field with correct kinds', () => {
    expect(byKey('startLine')).toMatchObject({ kind: 'range', default: 10 });
    expect(byKey('endLine')).toMatchObject({ kind: 'range', default: 200 });
    expect(byKey('component')).toMatchObject({ kind: 'component', default: 'auth' });
    expect(byKey('field')).toMatchObject({ kind: 'field', default: 'isTokenExpired' });
  });

  it('keeps numeric defaults numeric', () => {
    expect(typeof byKey('startLine')!.default).toBe('number');
  });
});

describe('resolveSteps applies overrides by key', () => {
  const tpl = buildTemplate('T', journal);

  it('retargets the window + component, keeps unspecified nouns at their captured value', () => {
    const steps = resolveSteps(tpl, { startTime: '2026-02-02T00:00:00Z', component: 'network' });
    expect(steps[0].body.startTime).toBe('2026-02-02T00:00:00Z');
    expect(steps[0].body.endTime).toBe('2026-01-01T01:00:00Z'); // untouched
    expect(steps[1].body.component).toBe('network');
    expect(steps[2].body.field).toBe('isTokenExpired'); // untouched
  });

  it('no overrides → captured values verbatim', () => {
    const steps = resolveSteps(tpl, {});
    expect(steps[1].body.component).toBe('auth');
    expect(steps[2].body.startLine).toBe(10);
  });

  it('an override for a key updates every step that uses it', () => {
    const multi: JournalEntry[] = [
      { path: '/api/investigate-component', body: { component: 'auth' }, ts: 1, label: 'a' },
      { path: '/api/trend-series', body: { component: 'auth', field: 'x' }, ts: 2, label: 'b' },
    ];
    const t2 = buildTemplate('M', multi);
    const steps = resolveSteps(t2, { component: 'db' });
    expect(steps[0].body.component).toBe('db');
    expect(steps[1].body.component).toBe('db');
  });
});
