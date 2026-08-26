import { describe, it, expect } from 'vitest';
import { buildTemplate, resolveSteps, paramKind, deriveRole, applyParamPatches, variableParams, valueLooksIncidentSpecific, JournalEntry } from '../main/investigationStore';

// Build 0 (2026-08-20): the investigation entity carries a declared param schema
// (kind = time/range/component/field/pattern/event/other) so a human tweak-form
// can retarget a saved hunt — window nouns first — onto a NEW incident.
// P0a (2026-08-25): each param also carries a variable|constant ROLE — variables
// are prompted + tweakable on replay, constants are pinned (the recipe's shape).

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

describe('buildTemplate aim', () => {
  it('carries the aim (what the recipe is for) when provided', () => {
    const tpl = buildTemplate('T', journal, undefined, undefined, undefined, 'find the root-cause component');
    expect(tpl.aim).toBe('find the root-cause component');
  });
  it('leaves aim undefined when not provided (back-compat)', () => {
    expect(buildTemplate('T', journal).aim).toBeUndefined();
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

  it('assigns default roles: the window is variable, structural nouns are constant', () => {
    expect(byKey('startTime')!.role).toBe('variable');
    expect(byKey('endTime')!.role).toBe('variable');
    expect(byKey('startLine')!.role).toBe('variable');
    expect(byKey('component')!.role).toBe('constant');
    expect(byKey('field')!.role).toBe('constant');
  });
});

describe('deriveRole defaults (variable vs constant)', () => {
  it('window nouns default to variable (change per incident)', () => {
    expect(deriveRole('startTime', '2026-01-01T00:00:00Z')).toBe('variable');
    expect(deriveRole('endTime', '2026-01-01T01:00:00Z')).toBe('variable');
    expect(deriveRole('startLine', 10)).toBe('variable');
    expect(deriveRole('endLine', 200)).toBe('variable');
  });
  it('structural nouns default to constant (define the hunt)', () => {
    expect(deriveRole('component', 'auth')).toBe('constant');
    expect(deriveRole('field', 'isTokenExpired')).toBe('constant');
    expect(deriveRole('event', 'boot')).toBe('constant');
  });
  it('a pattern is variable only when it embeds an incident-specific literal', () => {
    expect(deriveRole('pattern', 'token expired')).toBe('constant');
    expect(deriveRole('pattern', 'auth failure for user')).toBe('constant');
    expect(deriveRole('pattern', 'req-4f3a9b8c7d6e')).toBe('variable');       // long hex run
    expect(deriveRole('pattern', 'session 1048576 dropped')).toBe('variable'); // long digit run
  });
  it('config keys default to constant', () => {
    expect(deriveRole('thresholdSeconds', 30)).toBe('constant');
    expect(deriveRole('expect', 'nonzero')).toBe('constant');
    expect(deriveRole('analyzerName', 'crashes')).toBe('constant');
  });
});

describe('valueLooksIncidentSpecific heuristic', () => {
  it('flags ids / hashes / serials / timestamps', () => {
    expect(valueLooksIncidentSpecific('550e8400-e29b-41d4-a716-446655440000')).toBe(true); // UUID
    expect(valueLooksIncidentSpecific('deadbeefcafe')).toBe(true);                          // hex
    expect(valueLooksIncidentSpecific('serial 900123456')).toBe(true);                      // long digits
    expect(valueLooksIncidentSpecific('2026-01-01 12:00')).toBe(true);                       // timestamp
    expect(valueLooksIncidentSpecific(42)).toBe(true);                                       // raw number
  });
  it('does not flag ordinary structural tokens', () => {
    expect(valueLooksIncidentSpecific('auth')).toBe(false);
    expect(valueLooksIncidentSpecific('token expired')).toBe(false);
    expect(valueLooksIncidentSpecific('')).toBe(false);
    expect(valueLooksIncidentSpecific(null)).toBe(false);
  });
});

describe('resolveSteps respects param roles (variables tweakable, constants pinned)', () => {
  const tpl = buildTemplate('T', journal);

  it('retargets a VARIABLE window noun, keeps the unspecified bound', () => {
    const steps = resolveSteps(tpl, { startTime: '2026-02-02T00:00:00Z' });
    expect(steps[0].body.startTime).toBe('2026-02-02T00:00:00Z'); // time = variable
    expect(steps[0].body.endTime).toBe('2026-01-01T01:00:00Z');   // untouched
  });

  it('PINS a constant noun: an override for a constant param is ignored', () => {
    const steps = resolveSteps(tpl, { component: 'network' }); // component defaults to constant
    expect(steps[1].body.component).toBe('auth');              // pinned, not overridden
  });

  it('applies the override once the param is made variable', () => {
    const t2 = buildTemplate('T', journal);
    applyParamPatches(t2, [{ stepIndex: 1, key: 'component', role: 'variable' }]);
    const steps = resolveSteps(t2, { component: 'network' });
    expect(steps[1].body.component).toBe('network');
  });

  it('no overrides → captured values verbatim', () => {
    const steps = resolveSteps(tpl, {});
    expect(steps[1].body.component).toBe('auth');
    expect(steps[2].body.startLine).toBe(10);
  });

  it('a VARIABLE override for a key updates every step that uses it', () => {
    const multi: JournalEntry[] = [
      { path: '/api/investigate-component', body: { component: 'auth' }, ts: 1, label: 'a' },
      { path: '/api/trend-series', body: { component: 'auth', field: 'x' }, ts: 2, label: 'b' },
    ];
    const t2 = buildTemplate('M', multi);
    applyParamPatches(t2, [
      { stepIndex: 0, key: 'component', role: 'variable' },
      { stepIndex: 1, key: 'component', role: 'variable' },
    ]);
    const steps = resolveSteps(t2, { component: 'db' });
    expect(steps[0].body.component).toBe('db');
    expect(steps[1].body.component).toBe('db');
  });
});

describe('variableParams', () => {
  it('returns only variable-role params (constants excluded)', () => {
    const t = buildTemplate('T', journal);
    const keys = variableParams(t).map(p => p.key);
    expect(keys).toContain('startTime');
    expect(keys).toContain('startLine');
    expect(keys).not.toContain('component'); // constant by default
    expect(keys).not.toContain('field');     // constant by default
  });
});

describe('applyParamPatches — promote / retype / demote', () => {
  it('promotes an arbitrary body value that auto-promotion never exposes', () => {
    const j: JournalEntry[] = [{ path: '/api/search', body: { query: 'boom', maxResults: 50 }, ts: 1, label: 's' }];
    const t = buildTemplate('P', j);
    expect(t.params.find(p => p.key === 'query')).toBeUndefined(); // 'query' not in PARAM_KEYS
    const { applied, errors } = applyParamPatches(t, [{ stepIndex: 0, key: 'query', role: 'variable', description: 'the search term' }]);
    expect(applied).toBe(1);
    expect(errors).toEqual([]);
    expect(t.params.find(p => p.key === 'query')).toMatchObject({ key: 'query', stepIndex: 0, role: 'variable', default: 'boom', description: 'the search term' });
    // and now it is resolvable as a variable
    const steps = resolveSteps(t, { query: 'kaboom' });
    expect(steps[0].body.query).toBe('kaboom');
  });

  it('refuses to promote a value absent from the step body', () => {
    const j: JournalEntry[] = [{ path: '/api/search', body: { query: 'boom' }, ts: 1, label: 's' }];
    const t = buildTemplate('P', j);
    const { applied, errors } = applyParamPatches(t, [{ stepIndex: 0, key: 'nope' }]);
    expect(applied).toBe(0);
    expect(errors.length).toBe(1);
  });

  it('retypes an existing param, then demotes it (value stays pinned in the body)', () => {
    const t = buildTemplate('T', journal);
    applyParamPatches(t, [{ stepIndex: 1, key: 'component', role: 'variable' }]);
    expect(t.params.find(p => p.key === 'component')!.role).toBe('variable');
    const { applied } = applyParamPatches(t, [{ stepIndex: 1, key: 'component', remove: true }]);
    expect(applied).toBe(1);
    expect(t.params.find(p => p.key === 'component')).toBeUndefined();
    expect(t.steps[1].body.component).toBe('auth'); // demotion keeps the recorded value
  });

  it('reports an error when removing a param that is not there', () => {
    const t = buildTemplate('T', journal);
    const { applied, errors } = applyParamPatches(t, [{ stepIndex: 0, key: 'startLine', remove: true }]);
    expect(applied).toBe(0);
    expect(errors.length).toBe(1);
  });

  // "Save" in the template hub — persist a tweaked value as the new default, keeping role.
  it('sets a new default value (+ mirrors into the step body), preserving the role', () => {
    const t = buildTemplate('T', journal);
    const before = t.params.find(p => p.key === 'startTime')!;
    expect(before.role).toBe('variable');
    const { applied, errors } = applyParamPatches(t, [{ stepIndex: 0, key: 'startTime', default: '2026-05-05T00:00:00Z' }]);
    expect(applied).toBe(1);
    expect(errors).toEqual([]);
    const after = t.params.find(p => p.key === 'startTime')!;
    expect(after.default).toBe('2026-05-05T00:00:00Z'); // new default
    expect(after.role).toBe('variable');                 // role preserved (not re-derived like a fork)
    expect(t.steps[0].body.startTime).toBe('2026-05-05T00:00:00Z'); // mirrored into the body
    // A subsequent replay with NO overrides now uses the saved default.
    expect(resolveSteps(t, {})[0].body.startTime).toBe('2026-05-05T00:00:00Z');
  });

  it('a default patch can be combined with a role change', () => {
    const t = buildTemplate('T', journal);
    applyParamPatches(t, [{ stepIndex: 1, key: 'component', role: 'variable', default: 'network' }]);
    const p = t.params.find(p => p.key === 'component')!;
    expect(p.role).toBe('variable');
    expect(p.default).toBe('network');
    expect(t.steps[1].body.component).toBe('network');
  });
});
