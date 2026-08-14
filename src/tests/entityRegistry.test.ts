import { describe, it, expect } from 'vitest';
import { toDescriptor, toDescriptors, ENTITY_KINDS, ENTITY_KIND_LABELS, EntityKind } from '../main/entityRegistry';

describe('toDescriptor — per-kind mapping', () => {
  it('search: name=pattern, scope from isGlobal, flags summary', () => {
    const d = toDescriptor('search', { id: 's1', pattern: 'auth fail', isRegex: true, matchCase: true, isGlobal: true, description: 'x' });
    expect(d).toMatchObject({ kind: 'search', id: 's1', name: 'auth fail', scope: 'global', description: 'x' });
    expect(d.summary).toContain('regex');
    expect(d.summary).toContain('case');
  });

  it('search: non-global → file scope; disabled noted', () => {
    const d = toDescriptor('search', { id: 's2', pattern: 'x', isGlobal: false, enabled: false });
    expect(d.scope).toBe('file');
    expect(d.summary).toContain('off');
  });

  it('session: name + config count', () => {
    const d = toDescriptor('session', { id: 'scs1', name: 'Auth triage', configs: [{}, {}, {}], isGlobal: true });
    expect(d).toMatchObject({ kind: 'session', name: 'Auth triage', scope: 'global', count: 3 });
    expect(d.summary).toBe('3 searches');
  });

  it('filter: levels + include/exclude summary', () => {
    const d = toDescriptor('filter', { id: 'f1', name: 'Errors only', levels: ['error', 'fatal'], includePatterns: ['x'], excludePatterns: [] });
    expect(d.name).toBe('Errors only');
    expect(d.summary).toContain('levels [error,fatal]');
    expect(d.summary).toContain('1 include');
  });

  it('highlightGroup / bookmarkSet: member counts', () => {
    expect(toDescriptor('highlightGroup', { id: 'g1', name: 'G', highlights: [{}, {}] })).toMatchObject({ count: 2, summary: '2 highlights' });
    expect(toDescriptor('bookmarkSet', { id: 'b1', name: 'B', bookmarks: [{}] })).toMatchObject({ count: 1, summary: '1 bookmarks' });
  });

  it('columnLayout / columnPattern', () => {
    expect(toDescriptor('columnLayout', { id: 'cl1', name: 'syslog', method: 'pattern', columns: [{}, {}, {}] })).toMatchObject({ count: 3 });
    expect(toDescriptor('columnPattern', { id: 'cp1', name: 'p', fields: ['date', 'level'] }).summary).toBe('date, level');
  });

  it('constant: id falls back to name; value is the summary', () => {
    const d = toDescriptor('constant', { name: 'MAX_RETRIES', value: '5', description: 'cap' });
    expect(d).toMatchObject({ id: 'MAX_RETRIES', name: 'MAX_RETRIES', summary: '5', description: 'cap' });
  });

  it('pattern: name=label, scope passthrough', () => {
    const d = toDescriptor('pattern', { id: 'p1', label: 'JWT', regex: 'eyJ[\\w-]+', scope: 'ticket' });
    expect(d).toMatchObject({ name: 'JWT', scope: 'ticket', summary: 'eyJ[\\w-]+' });
  });

  it('trendProperty: pattern + unit', () => {
    expect(toDescriptor('trendProperty', { id: 't1', name: 'temp', pattern: 'T=(\\d+)', unit: '°C' }).summary).toContain('°C');
  });

  it('contextDef: scope from isGlobal, pattern count', () => {
    expect(toDescriptor('contextDef', { id: 'c1', name: 'ctx', isGlobal: false, patterns: [{}, {}] })).toMatchObject({ scope: 'file', count: 2 });
  });

  it('baseline: filename + line count summary', () => {
    const d = toDescriptor('baseline', { id: 'bl1', name: 'nightly', sourceFile: '/logs/a/b.log', totalLines: 1200, description: 'ref' });
    expect(d.summary).toContain('b.log');
    expect(d.summary).toContain('1200 lines');
  });

  it('investigation: id=slug, step count, requirements flag', () => {
    const d = toDescriptor('investigation', { slug: 'auth-exp', name: 'Auth expiry', steps: [{}, {}], requirements: { fileTemplate: {} } });
    expect(d).toMatchObject({ id: 'auth-exp', name: 'Auth expiry', count: 2 });
    expect(d.summary).toContain('has requirements');
  });

  it('summary is clipped to a sane length', () => {
    const d = toDescriptor('search', { id: 'x', pattern: 'p', isRegex: false });
    expect((d.summary || '').length).toBeLessThanOrEqual(80);
  });
});

describe('toDescriptor — robustness', () => {
  it('never throws on empty/garbage input', () => {
    for (const k of ENTITY_KINDS) {
      expect(() => toDescriptor(k, undefined)).not.toThrow();
      expect(() => toDescriptor(k, {})).not.toThrow();
      const d = toDescriptor(k, {});
      expect(d.kind).toBe(k);
      expect(typeof d.id).toBe('string');
      expect(typeof d.name).toBe('string');
    }
  });

  it('toDescriptors maps a list and tolerates a corrupt row', () => {
    const rows = [{ id: 'a', name: 'A' }, null, { id: 'b', name: 'B' }];
    const ds = toDescriptors('columnLayout', rows as any);
    expect(ds).toHaveLength(3); // null still maps to a safe descriptor
    expect(ds.map(d => d.id)).toEqual(['a', '', 'b']);
  });

  it('every kind has a human label', () => {
    for (const k of ENTITY_KINDS) expect(ENTITY_KIND_LABELS[k as EntityKind]).toBeTruthy();
  });
});
