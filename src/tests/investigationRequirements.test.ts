import { describe, it, expect } from 'vitest';
import {
  evaluateRequirements,
  fileMatchesColumnPattern,
  suggestRequirements,
  mergeRequirements,
  RequirementCheckContext,
  RequirementsManifest,
} from '../main/investigationRequirements';
import { compileColumnPattern } from '../main/columnPattern';

// A syslog-ish sample and a JSON-ish sample to gate between.
const SYSLOG = [
  '2026-08-04 12:00:01 ERROR auth token expired',
  '2026-08-04 12:00:02 INFO  auth retry scheduled',
  '2026-08-04 12:00:03 WARN  auth backoff 2s',
];
const JSONISH = [
  '{"ts":"2026-08-04T12:00:01Z","level":"error","msg":"boom"}',
  '{"ts":"2026-08-04T12:00:02Z","level":"info","msg":"ok"}',
];

function ctx(overrides: Partial<RequirementCheckContext> = {}): RequirementCheckContext {
  return {
    filePath: '/logs/device-42.log',
    adapterId: 'text',
    sampleLines: SYSLOG,
    ...overrides,
  };
}

describe('fileMatchesColumnPattern', () => {
  it('matches when enough sampled lines fit the compiled pattern', () => {
    const compiled = compileColumnPattern({ mode: 'grok', pattern: '%{date} %{time} %{level} %{msg}' });
    const r = fileMatchesColumnPattern(compiled, SYSLOG, 0.6);
    expect(r.matched).toBe(true);
    expect(r.matchedCount).toBe(3);
    expect(r.total).toBe(3);
  });

  it('does not match a differently-shaped file', () => {
    const compiled = compileColumnPattern({ mode: 'grok', pattern: '%{date} %{time} %{level} %{msg}' });
    const r = fileMatchesColumnPattern(compiled, JSONISH, 0.6);
    expect(r.matched).toBe(false);
    expect(r.ratio).toBeLessThan(0.6);
  });

  it('ignores blank lines when computing the ratio', () => {
    const compiled = compileColumnPattern({ mode: 'grok', pattern: '%{date} %{time} %{level} %{msg}' });
    const r = fileMatchesColumnPattern(compiled, [...SYSLOG, '', '   '], 0.6);
    expect(r.total).toBe(3);
    expect(r.matched).toBe(true);
  });

  it('reports no match on an all-blank sample', () => {
    const compiled = compileColumnPattern({ mode: 'grok', pattern: '%{a}' });
    const r = fileMatchesColumnPattern(compiled, ['', '  '], 0.6);
    expect(r.matched).toBe(false);
    expect(r.total).toBe(0);
  });
});

describe('evaluateRequirements — no manifest', () => {
  it('is never blocked and has no checks', () => {
    const r = evaluateRequirements(undefined, ctx());
    expect(r.blocked).toBe(false);
    expect(r.checks).toHaveLength(0);
  });
});

describe('evaluateRequirements — adapter gate', () => {
  it('satisfied when adapter matches', () => {
    const m: RequirementsManifest = { fileTemplate: { adapterId: 'text' } };
    const r = evaluateRequirements(m, ctx({ adapterId: 'text' }));
    expect(r.blocked).toBe(false);
    expect(r.checks[0].status).toBe('satisfied');
  });

  it('blocks when adapter differs', () => {
    const m: RequirementsManifest = { fileTemplate: { adapterId: 'vtrace' } };
    const r = evaluateRequirements(m, ctx({ adapterId: 'text' }));
    expect(r.blocked).toBe(true);
    expect(r.checks[0].status).toBe('unsatisfied');
  });

  it('treats a null adapter as text', () => {
    const m: RequirementsManifest = { fileTemplate: { adapterId: 'text' } };
    const r = evaluateRequirements(m, ctx({ adapterId: null }));
    expect(r.blocked).toBe(false);
  });
});

describe('evaluateRequirements — filename glob', () => {
  it('matches a * glob', () => {
    const m: RequirementsManifest = { fileTemplate: { filenameGlob: 'device-*.log' } };
    expect(evaluateRequirements(m, ctx()).blocked).toBe(false);
  });

  it('blocks a non-matching glob', () => {
    const m: RequirementsManifest = { fileTemplate: { filenameGlob: '*.esotrace' } };
    expect(evaluateRequirements(m, ctx()).blocked).toBe(true);
  });
});

describe('evaluateRequirements — signature regex', () => {
  it('satisfied when signature appears in the scanned window', () => {
    const m: RequirementsManifest = { fileTemplate: { signature: { regex: 'auth token expired' } } };
    expect(evaluateRequirements(m, ctx()).blocked).toBe(false);
  });

  it('blocks when signature is absent', () => {
    const m: RequirementsManifest = { fileTemplate: { signature: { regex: 'kernel panic' } } };
    expect(evaluateRequirements(m, ctx()).blocked).toBe(true);
  });

  it('honours scanLines (signature past the window is not found)', () => {
    const m: RequirementsManifest = { fileTemplate: { signature: { regex: 'backoff', scanLines: 1 } } };
    expect(evaluateRequirements(m, ctx()).blocked).toBe(true);
  });

  it('marks an invalid signature regex unverified, not blocked', () => {
    const m: RequirementsManifest = { fileTemplate: { signature: { regex: '([' } } };
    const r = evaluateRequirements(m, ctx());
    expect(r.blocked).toBe(false);
    expect(r.checks[0].status).toBe('unverified');
  });
});

describe('evaluateRequirements — column pattern gate', () => {
  const resolveColumnPattern = (ref: { id?: string; name?: string }) =>
    ref.name === 'syslog-cols'
      ? { spec: { mode: 'grok' as const, pattern: '%{date} %{time} %{level} %{msg}' } }
      : null;

  it('satisfied when the log matches the resolved column pattern', () => {
    const m: RequirementsManifest = { fileTemplate: { columnPattern: { name: 'syslog-cols' } } };
    const r = evaluateRequirements(m, ctx({ resolveColumnPattern }));
    expect(r.blocked).toBe(false);
    expect(r.checks[0].status).toBe('satisfied');
  });

  it('blocks when the log does not match the resolved column pattern', () => {
    const m: RequirementsManifest = { fileTemplate: { columnPattern: { name: 'syslog-cols' } } };
    const r = evaluateRequirements(m, ctx({ sampleLines: JSONISH, resolveColumnPattern }));
    expect(r.blocked).toBe(true);
    expect(r.checks[0].status).toBe('unsatisfied');
  });

  it('is unverified (not blocked) when the referenced pattern cannot be resolved', () => {
    const m: RequirementsManifest = { fileTemplate: { columnPattern: { name: 'missing' } } };
    const r = evaluateRequirements(m, ctx({ resolveColumnPattern }));
    expect(r.blocked).toBe(false);
    expect(r.checks[0].status).toBe('unverified');
  });
});

describe('evaluateRequirements — entities are informational (never block)', () => {
  it('records unverified entities without blocking', () => {
    const m: RequirementsManifest = { entities: [{ kind: 'search', name: 'auth-errors' }] };
    const r = evaluateRequirements(m, ctx());
    expect(r.blocked).toBe(false);
    expect(r.checks[0].kind).toBe('entity:search');
    expect(r.checks[0].status).toBe('unverified');
  });

  it('uses the resolver when present; a missing entity does not block', () => {
    const m: RequirementsManifest = { entities: [{ kind: 'columnLayout', name: 'gone' }] };
    const r = evaluateRequirements(m, ctx({ resolveEntity: () => ({ present: false }) }));
    expect(r.blocked).toBe(false);
    expect(r.checks[0].status).toBe('unsatisfied');
  });
});

describe('suggestRequirements', () => {
  it('suggests a non-text adapter + filename glob', () => {
    const r = suggestRequirements({ filePath: '/logs/dump.esotrace', adapterId: 'vtrace' });
    expect(r.fileTemplate?.adapterId).toBe('vtrace');
    expect(r.fileTemplate?.filenameGlob).toBe('*.esotrace');
  });

  it('does not gate on a plain-text adapter', () => {
    const r = suggestRequirements({ filePath: '/logs/app.log', adapterId: 'text' });
    expect(r.fileTemplate?.adapterId).toBeUndefined();
    expect(r.fileTemplate?.filenameGlob).toBe('*.log');
  });

  it('returns an empty manifest for a text file with no extension', () => {
    const r = suggestRequirements({ filePath: '/logs/messages', adapterId: 'text' });
    expect(r.fileTemplate).toBeUndefined();
  });
});

describe('mergeRequirements', () => {
  it('lets explicit fileTemplate fields win over suggestions', () => {
    const explicit: RequirementsManifest = { fileTemplate: { adapterId: 'mf4' } };
    const suggested: RequirementsManifest = { fileTemplate: { adapterId: 'text', filenameGlob: '*.log' } };
    const r = mergeRequirements(explicit, suggested);
    expect(r.fileTemplate?.adapterId).toBe('mf4');        // explicit wins
    expect(r.fileTemplate?.filenameGlob).toBe('*.log');   // suggestion fills the gap
  });

  it('preserves explicit entities while merging suggested fileTemplate', () => {
    const explicit: RequirementsManifest = { entities: [{ kind: 'search', name: 's' }] };
    const suggested: RequirementsManifest = { fileTemplate: { adapterId: 'vtrace' } };
    const r = mergeRequirements(explicit, suggested);
    expect(r.entities).toHaveLength(1);
    expect(r.fileTemplate?.adapterId).toBe('vtrace');
  });
});

describe('evaluateRequirements — combined gate', () => {
  it('blocks if ANY file-template sub-check fails', () => {
    const m: RequirementsManifest = {
      fileTemplate: { adapterId: 'text', signature: { regex: 'auth token expired' }, filenameGlob: '*.esotrace' },
    };
    const r = evaluateRequirements(m, ctx());
    // adapter ok + signature ok, but glob fails → blocked
    expect(r.blocked).toBe(true);
    expect(r.checks.filter(c => c.status === 'satisfied')).toHaveLength(2);
  });
});
