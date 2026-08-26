import { describe, it, expect } from 'vitest';
import {
  emptyManifest,
  mergeFacts,
  factsToPlain,
  factCount,
  diffEnv,
  envDiffIsEmpty,
  envDiffToStrings,
  type ContextManifest,
} from '../main/contextManifest';

describe('mergeFacts', () => {
  it('adds facts into an empty/null manifest', () => {
    const m = mergeFacts(null, { build: '4.2.1', firmware: 'rev-88' }, { now: 100 });
    expect(factsToPlain(m)).toEqual({ build: '4.2.1', firmware: 'rev-88' });
    expect(m.updatedAt).toBe(100);
  });

  it('merges into existing facts (keeps prior keys)', () => {
    const first = mergeFacts(null, { build: '4.1' }, { now: 1 });
    const second = mergeFacts(first, { firmware: 'rev-88' }, { now: 2 });
    expect(factsToPlain(second)).toEqual({ build: '4.1', firmware: 'rev-88' });
    expect(second.updatedAt).toBe(2);
  });

  it('overwrites an existing key on merge', () => {
    const first = mergeFacts(null, { build: '4.1' }, { now: 1 });
    const second = mergeFacts(first, { build: '4.2' }, { now: 2 });
    expect(factsToPlain(second)).toEqual({ build: '4.2' });
  });

  it('replace=true discards prior facts', () => {
    const first = mergeFacts(null, { build: '4.1', firmware: 'rev-88' }, { now: 1 });
    const second = mergeFacts(first, { device: 'X100' }, { now: 2, replace: true });
    expect(factsToPlain(second)).toEqual({ device: 'X100' });
  });

  it('a blank value deletes a key', () => {
    const first = mergeFacts(null, { build: '4.1', firmware: 'rev-88' }, { now: 1 });
    const second = mergeFacts(first, { firmware: '   ' }, { now: 2 });
    expect(factsToPlain(second)).toEqual({ build: '4.1' });
  });

  it('trims keys and values, and ignores empty keys', () => {
    const m = mergeFacts(null, { '  build  ': '  4.2.1  ', '': 'ignored' }, { now: 1 });
    expect(factsToPlain(m)).toEqual({ build: '4.2.1' });
  });

  it('records per-key provenance, then a source fallback', () => {
    const m = mergeFacts(
      null,
      { build: '4.2', firmware: 'rev-88' },
      { now: 1, provenance: { build: 'header line 3' }, source: 'boot banner' },
    );
    expect(m.facts.build.source).toBe('header line 3');
    expect(m.facts.firmware.source).toBe('boot banner');
  });

  it('does not mutate the input manifest', () => {
    const first = mergeFacts(null, { build: '4.1' }, { now: 1 });
    const snapshot = JSON.stringify(first);
    mergeFacts(first, { build: '4.2', firmware: 'rev-88' }, { now: 2 });
    expect(JSON.stringify(first)).toBe(snapshot);
  });

  it('stamps agentName when provided', () => {
    const m = mergeFacts(null, { build: '4.2' }, { now: 1, agentName: 'Claude Code' });
    expect(m.agentName).toBe('Claude Code');
  });
});

describe('factCount / factsToPlain', () => {
  it('counts facts, 0 for null/empty', () => {
    expect(factCount(null)).toBe(0);
    expect(factCount(emptyManifest())).toBe(0);
    expect(factCount(mergeFacts(null, { a: '1', b: '2' }, { now: 1 }))).toBe(2);
  });
  it('factsToPlain flattens {value} → value, ignores malformed', () => {
    const m: ContextManifest = { facts: { a: { value: 'x' }, b: { value: 'y', source: 's' } }, updatedAt: 1 };
    expect(factsToPlain(m)).toEqual({ a: 'x', b: 'y' });
    expect(factsToPlain(null)).toEqual({});
  });
});

describe('diffEnv', () => {
  it('detects changed values', () => {
    const d = diffEnv({ build: '4.1', firmware: 'rev-88' }, { build: '4.2', firmware: 'rev-88' });
    expect(d.changed).toEqual([{ key: 'build', from: '4.1', to: '4.2' }]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(envDiffIsEmpty(d)).toBe(false);
  });

  it('detects added and removed keys', () => {
    const d = diffEnv({ build: '4.1' }, { build: '4.1', device: 'X100' });
    expect(d.added).toEqual([{ key: 'device', value: 'X100' }]);
    const d2 = diffEnv({ build: '4.1', flag: 'on' }, { build: '4.1' });
    expect(d2.removed).toEqual([{ key: 'flag', value: 'on' }]);
  });

  it('identical maps produce an empty diff', () => {
    const d = diffEnv({ build: '4.1' }, { build: '4.1' });
    expect(envDiffIsEmpty(d)).toBe(true);
  });

  it('handles undefined sides', () => {
    expect(envDiffIsEmpty(diffEnv(undefined, undefined))).toBe(true);
    expect(diffEnv(undefined, { build: '4.2' }).added).toEqual([{ key: 'build', value: '4.2' }]);
  });

  it('envDiffToStrings renders human one-liners', () => {
    const d = diffEnv({ build: '4.1', flag: 'on' }, { build: '4.2', device: 'X100' });
    const s = envDiffToStrings(d);
    expect(s).toContain('build 4.1 → 4.2');
    expect(s).toContain('+device=X100');
    expect(s).toContain('-flag (was on)');
  });
});
