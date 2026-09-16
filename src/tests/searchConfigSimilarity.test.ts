import { describe, it, expect } from 'vitest';
import {
  configSignature,
  groupBySignature,
  computeOverlaps,
  describeOverlaps,
  type SimConfig,
  type ConfigOverlap,
  type OverlapRelation,
} from '../shared/searchConfigSimilarity';

const mk = (id: string, pattern: string, over: Partial<SimConfig> = {}): SimConfig => ({
  id,
  pattern,
  isRegex: false,
  matchCase: false,
  wholeWord: false,
  ...over,
});

// Pull the relation this config was assigned toward `otherId`.
const rel = (
  m: Map<string, ConfigOverlap[]>,
  id: string,
  otherId: string,
): OverlapRelation | undefined => (m.get(id) || []).find(o => o.otherId === otherId)?.relation;

describe('configSignature', () => {
  it('is equal for same pattern+flags and differs on any flag', () => {
    const base = mk('a', 'foo');
    expect(configSignature(base)).toBe(configSignature(mk('b', 'foo')));
    expect(configSignature(base)).not.toBe(configSignature(mk('b', 'foo', { isRegex: true })));
    expect(configSignature(base)).not.toBe(configSignature(mk('b', 'foo', { matchCase: true })));
    expect(configSignature(base)).not.toBe(configSignature(mk('b', 'foo', { wholeWord: true })));
    expect(configSignature(base)).not.toBe(configSignature(mk('b', 'bar')));
  });
});

describe('groupBySignature', () => {
  it('clusters exact duplicates, keeping first-seen order', () => {
    const groups = groupBySignature([mk('a', 'foo'), mk('b', 'bar'), mk('c', 'foo')]);
    expect(groups.get(configSignature(mk('x', 'foo')))).toEqual(['a', 'c']);
    expect(groups.get(configSignature(mk('x', 'bar')))).toEqual(['b']);
  });
});

describe('computeOverlaps', () => {
  it('detects the height ⊃ height= ⊃ ", height=5" substring chain', () => {
    const configs = [mk('h', 'height'), mk('he', 'height='), mk('h5', ', height=5')];
    const m = computeOverlaps(configs);

    // 'height' is the broadest — the other two are narrower (their matches ⊆ its).
    expect(rel(m, 'h', 'he')).toBe('narrower');
    expect(rel(m, 'h', 'h5')).toBe('narrower');
    // ', height=5' is the narrowest — the other two are broader.
    expect(rel(m, 'h5', 'h')).toBe('broader');
    expect(rel(m, 'h5', 'he')).toBe('broader');
    // 'height=' sits in the middle.
    expect(rel(m, 'he', 'h')).toBe('broader');
    expect(rel(m, 'he', 'h5')).toBe('narrower');
  });

  it('flags exact duplicates from both sides', () => {
    const m = computeOverlaps([mk('a', 'ERROR'), mk('b', 'ERROR')]);
    expect(rel(m, 'a', 'b')).toBe('duplicate');
    expect(rel(m, 'b', 'a')).toBe('duplicate');
  });

  it('reports no overlap for unrelated patterns', () => {
    const m = computeOverlaps([mk('a', 'height'), mk('b', 'width')]);
    expect(m.get('a')).toBeUndefined();
    expect(m.get('b')).toBeUndefined();
  });

  it('refuses to claim subsumption across regex patterns', () => {
    // "he" is literally inside "height" but one is a regex — no safe claim.
    const m = computeOverlaps([mk('a', 'he', { isRegex: true }), mk('b', 'height')]);
    expect(m.get('a')).toBeUndefined();
    expect(m.get('b')).toBeUndefined();
  });

  it('refuses to claim subsumption across whole-word matches', () => {
    const m = computeOverlaps([mk('a', 'height', { wholeWord: true }), mk('b', 'height=', { wholeWord: true })]);
    expect(m.get('a')).toBeUndefined();
  });

  it('refuses to claim subsumption when case-sensitivity differs', () => {
    const m = computeOverlaps([mk('a', 'height'), mk('b', 'height=', { matchCase: true })]);
    expect(m.get('a')).toBeUndefined();
  });

  it('is case-insensitive when both configs are case-insensitive', () => {
    const m = computeOverlaps([mk('a', 'Height'), mk('b', 'HEIGHT=')]);
    expect(rel(m, 'a', 'b')).toBe('narrower'); // HEIGHT= ⊆ Height (case-insensitive)
  });

  it('treats same-literal-different-flags as neither duplicate nor subset', () => {
    // Same text, but different case-sensitivity → match sets differ, no clean subset.
    const m = computeOverlaps([mk('a', 'foo'), mk('b', 'foo', { matchCase: true })]);
    expect(m.get('a')).toBeUndefined();
  });
});

describe('describeOverlaps', () => {
  it('summarises each relation kind', () => {
    const configs = [mk('h', 'height'), mk('he', 'height='), mk('dup', 'height')];
    const m = computeOverlaps(configs);
    const text = describeOverlaps(m.get('h') || []);
    expect(text).toContain('Exact duplicate of');
    expect(text).toContain('Narrower patterns');
  });
  it('is empty for no overlaps', () => {
    expect(describeOverlaps([])).toBe('');
  });
});
