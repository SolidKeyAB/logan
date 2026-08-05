import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UsageStoreImpl, UsageStore } from '../main/usageStore';

let tmpDir: string;
let filePath: string;
let store: UsageStoreImpl;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logan-usage-test-'));
}

function readFile(): UsageStore {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('UsageStore', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    filePath = path.join(tmpDir, 'usage.json');
    store = new UsageStoreImpl(filePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('bump()', () => {
    it('increments count for a verb/operator', () => {
      store.bump('search', 'human');
      store.bump('search', 'human');
      store.bump('search', 'human');
      const entries = store.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].verb).toBe('search');
      expect(entries[0].operator).toBe('human');
      expect(entries[0].count).toBe(3);
    });

    it('splits counts by operator (human vs ai)', () => {
      store.bump('search', 'human');
      store.bump('search', 'human');
      store.bump('search', 'ai');
      const entries = store.getAll();
      expect(entries).toHaveLength(2);
      const human = entries.find(e => e.operator === 'human');
      const ai = entries.find(e => e.operator === 'ai');
      expect(human?.count).toBe(2);
      expect(ai?.count).toBe(1);
      // same verb, different operator → distinct entries
      expect(human?.verb).toBe('search');
      expect(ai?.verb).toBe('search');
    });

    it('sets firstUsed on first bump and advances lastUsed on later bumps', () => {
      const t1 = Date.parse('2026-01-01T10:00:00.000Z');
      const t2 = Date.parse('2026-01-03T12:00:00.000Z');
      store.bump('filter', 'human', t1);
      store.bump('filter', 'human', t2);
      const e = store.getAll()[0];
      expect(e.firstUsed).toBe(new Date(t1).toISOString());
      expect(e.lastUsed).toBe(new Date(t2).toISOString());
    });

    it('increments the correct daily bucket (YYYY-MM-DD)', () => {
      // Use midday UTC so local-date bucketing is stable across timezones.
      const day1 = Date.parse('2026-02-10T12:00:00.000Z');
      const day2 = Date.parse('2026-02-11T12:00:00.000Z');
      store.bump('analyze', 'ai', day1);
      store.bump('analyze', 'ai', day1);
      store.bump('analyze', 'ai', day2);
      const e = store.getAll()[0];
      const buckets = Object.values(e.daily);
      expect(buckets.reduce((a, b) => a + b, 0)).toBe(3);
      expect(Object.keys(e.daily)).toHaveLength(2);
      // Each day's total should be present as a bucket value.
      expect(buckets.sort()).toEqual([1, 2]);
    });

    it('caps daily buckets to ~90 most-recent days', () => {
      const base = Date.parse('2026-01-01T12:00:00.000Z');
      const dayMs = 24 * 60 * 60 * 1000;
      // 120 distinct days → should retain only the last 90.
      for (let i = 0; i < 120; i++) {
        store.bump('navigate', 'human', base + i * dayMs);
      }
      const e = store.getAll()[0];
      expect(e.count).toBe(120);
      expect(Object.keys(e.daily).length).toBe(90);
    });

    it('empty verb is a no-op', () => {
      store.bump('', 'human');
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('getAll()', () => {
    it('returns entries sorted by count descending', () => {
      store.bump('rare', 'human');
      for (let i = 0; i < 5; i++) store.bump('common', 'human');
      for (let i = 0; i < 3; i++) store.bump('medium', 'ai');
      const entries = store.getAll();
      expect(entries.map(e => e.verb)).toEqual(['common', 'medium', 'rare']);
      expect(entries.map(e => e.count)).toEqual([5, 3, 1]);
    });

    it('returns an empty array when nothing recorded', () => {
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('clear()', () => {
    it('wipes all entries', () => {
      store.bump('search', 'human');
      store.bump('filter', 'ai');
      expect(store.getAll()).toHaveLength(2);
      store.clear();
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('flush() writes the store to disk and it reloads', () => {
      store.bump('search', 'human');
      store.bump('search', 'ai');
      store.flush();
      const onDisk = readFile();
      expect(onDisk.version).toBe(1);
      expect(onDisk.entries['human::search'].count).toBe(1);
      expect(onDisk.entries['ai::search'].count).toBe(1);

      // A fresh instance over the same path loads the persisted counts.
      const reloaded = new UsageStoreImpl(filePath);
      const entries = reloaded.getAll();
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.count === 1)).toBe(true);
    });

    it('starts fresh on a corrupt file without throwing', () => {
      fs.writeFileSync(filePath, '{ not valid json');
      const s = new UsageStoreImpl(filePath);
      expect(() => s.bump('search', 'human')).not.toThrow();
      expect(s.getAll()).toHaveLength(1);
    });
  });
});
