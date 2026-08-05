import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PatternLogStoreImpl, PatternLogStore, PatternLogEntry } from '../main/patternLog';

let tmpDir: string;
let filePath: string;
let store: PatternLogStoreImpl;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logan-patternlog-test-'));
}

function readFile(): PatternLogStore {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function sampleEntry(overrides: Partial<Omit<PatternLogEntry, 'id' | 'ts'>> & { at?: number } = {}): Omit<PatternLogEntry, 'id' | 'ts'> & { at?: number } {
  return {
    operator: 'human',
    mode: 'plain',
    source: 'ERROR',
    scope: 'search',
    scanned: 1000,
    matched: 12,
    hid: 0,
    sampleHits: [3, 47, 900],
    ms: 5,
    capped: false,
    valid: true,
    ...overrides,
  };
}

describe('PatternLogStore', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    filePath = path.join(tmpDir, 'pattern-log.json');
    store = new PatternLogStoreImpl(filePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('log()', () => {
    it('assigns an id + ISO ts and stores the given fields', () => {
      const at = Date.parse('2026-01-01T10:00:00.000Z');
      store.log(sampleEntry({ at }));
      const entries = store.getAll();
      expect(entries).toHaveLength(1);
      const e = entries[0];
      expect(e.id).toBeTruthy();
      expect(e.ts).toBe(new Date(at).toISOString());
      expect(e.operator).toBe('human');
      expect(e.mode).toBe('plain');
      expect(e.source).toBe('ERROR');
      expect(e.scope).toBe('search');
      expect(e.matched).toBe(12);
      expect(e.sampleHits).toEqual([3, 47, 900]);
      // the transient `at` helper must not leak into the stored entry
      expect((e as any).at).toBeUndefined();
    });

    it('prepends so entries are most-recent-first', () => {
      store.log(sampleEntry({ source: 'first', at: 1 }));
      store.log(sampleEntry({ source: 'second', at: 2 }));
      store.log(sampleEntry({ source: 'third', at: 3 }));
      const entries = store.getAll();
      expect(entries.map(e => e.source)).toEqual(['third', 'second', 'first']);
    });

    it('assigns unique ids even within the same millisecond', () => {
      const at = 12345;
      for (let i = 0; i < 50; i++) store.log(sampleEntry({ at }));
      const ids = store.getAll().map(e => e.id);
      expect(new Set(ids).size).toBe(50);
    });

    it('records an invalid/error entry', () => {
      store.log(sampleEntry({ valid: false, error: 'Unterminated group', matched: 0 }));
      const e = store.getAll()[0];
      expect(e.valid).toBe(false);
      expect(e.error).toBe('Unterminated group');
    });

    it('never throws on a malformed entry', () => {
      expect(() => store.log(sampleEntry())).not.toThrow();
    });
  });

  describe('cap', () => {
    it('caps the log to ~500 most-recent entries', () => {
      for (let i = 0; i < 550; i++) store.log(sampleEntry({ source: `p${i}`, at: i }));
      const entries = store.getAll();
      expect(entries).toHaveLength(500);
      // Newest kept, oldest dropped.
      expect(entries[0].source).toBe('p549');
      expect(entries[entries.length - 1].source).toBe('p50');
    });
  });

  describe('getAll()', () => {
    it('returns an empty array when nothing recorded', () => {
      expect(store.getAll()).toEqual([]);
    });

    it('returns a copy (mutating the result does not corrupt the store)', () => {
      store.log(sampleEntry());
      const a = store.getAll();
      a.pop();
      expect(store.getAll()).toHaveLength(1);
    });
  });

  describe('clear()', () => {
    it('wipes all entries', () => {
      store.log(sampleEntry());
      store.log(sampleEntry({ operator: 'ai' }));
      expect(store.getAll()).toHaveLength(2);
      store.clear();
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('flush() writes the log to disk and it reloads', () => {
      store.log(sampleEntry({ source: 'human-search' }));
      store.log(sampleEntry({ operator: 'ai', source: 'ai-filter' }));
      store.flush();
      const onDisk = readFile();
      expect(onDisk.version).toBe(1);
      expect(onDisk.entries).toHaveLength(2);
      expect(onDisk.entries[0].source).toBe('ai-filter'); // most-recent-first on disk too

      // A fresh instance over the same path loads the persisted entries.
      const reloaded = new PatternLogStoreImpl(filePath);
      const entries = reloaded.getAll();
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.source)).toEqual(['ai-filter', 'human-search']);
    });

    it('round-trips every field faithfully', () => {
      const at = Date.parse('2026-03-15T08:30:00.000Z');
      store.log(sampleEntry({
        at, operator: 'ai', mode: 'regex', source: '(?<k>\\w+)', scope: 'filter',
        scanned: 42, matched: 7, hid: 35, sampleHits: [1, 2, 3], ms: 99, capped: true,
        valid: true,
      }));
      store.flush();
      const reloaded = new PatternLogStoreImpl(filePath);
      const e = reloaded.getAll()[0];
      expect(e).toMatchObject({
        operator: 'ai', mode: 'regex', source: '(?<k>\\w+)', scope: 'filter',
        scanned: 42, matched: 7, hid: 35, sampleHits: [1, 2, 3], ms: 99, capped: true,
        valid: true, ts: new Date(at).toISOString(),
      });
    });

    it('starts fresh on a corrupt file without throwing', () => {
      fs.writeFileSync(filePath, '{ not valid json');
      const s = new PatternLogStoreImpl(filePath);
      expect(() => s.log(sampleEntry())).not.toThrow();
      expect(s.getAll()).toHaveLength(1);
    });
  });
});
