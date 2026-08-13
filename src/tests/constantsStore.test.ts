import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConstantsStoreImpl, ConstantsStore } from '../main/constantsStore';

let tmpDir: string;
let filePath: string;
let store: ConstantsStoreImpl;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logan-constants-test-'));
}

function readFile(): ConstantsStore {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('ConstantsStore', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    filePath = path.join(tmpDir, 'constants.json');
    store = new ConstantsStoreImpl(filePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('save()', () => {
    it('stores a named constant', () => {
      store.save('sessionId', 'abc-123');
      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('sessionId');
      expect(all[0].value).toBe('abc-123');
    });

    it('upserts (updates value) when the same name is saved again', () => {
      const t1 = Date.parse('2026-01-01T10:00:00.000Z');
      const t2 = Date.parse('2026-01-03T12:00:00.000Z');
      store.save('deviceId', 'first', t1);
      store.save('deviceId', 'second', t2);
      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].value).toBe('second');
      expect(all[0].createdAt).toBe(new Date(t1).toISOString());
      expect(all[0].updatedAt).toBe(new Date(t2).toISOString());
    });

    it('trims the name', () => {
      store.save('  key  ', 'val');
      const all = store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('key');
    });

    it('empty name is a no-op', () => {
      store.save('', 'val');
      store.save('   ', 'val');
      expect(store.getAll()).toHaveLength(0);
    });

    it('empty value is a no-op', () => {
      store.save('key', '');
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('description (optional human/AI note)', () => {
    it('stores a description when provided', () => {
      store.save('sessionId', 'abc-123', undefined, 'the auth session token seen at the crash');
      expect(store.getAll()[0].description).toBe('the auth session token seen at the crash');
    });

    it('leaves description undefined when not provided', () => {
      store.save('deviceId', 'dev-9');
      expect(store.getAll()[0].description).toBeUndefined();
    });

    it('can set/replace the description on upsert without dropping it', () => {
      store.save('k', 'v1');
      store.save('k', 'v2', undefined, 'why this matters');
      expect(store.getAll()[0].value).toBe('v2');
      expect(store.getAll()[0].description).toBe('why this matters');
    });

    it('round-trips the description through disk', () => {
      store.save('k', 'v', undefined, 'purpose note');
      store.flush();
      const reloaded = new ConstantsStoreImpl(filePath);
      expect(reloaded.getAll()[0].description).toBe('purpose note');
    });
  });

  describe('getAll()', () => {
    it('returns constants sorted by name ascending', () => {
      store.save('zeta', '1');
      store.save('alpha', '2');
      store.save('mid', '3');
      expect(store.getAll().map(e => e.name)).toEqual(['alpha', 'mid', 'zeta']);
    });

    it('returns an empty array when nothing recorded', () => {
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('delete()', () => {
    it('removes a named constant and returns true', () => {
      store.save('a', '1');
      store.save('b', '2');
      expect(store.delete('a')).toBe(true);
      expect(store.getAll().map(e => e.name)).toEqual(['b']);
    });

    it('returns false when the name is not present', () => {
      store.save('a', '1');
      expect(store.delete('missing')).toBe(false);
      expect(store.getAll()).toHaveLength(1);
    });
  });

  describe('clear()', () => {
    it('wipes all entries', () => {
      store.save('a', '1');
      store.save('b', '2');
      expect(store.getAll()).toHaveLength(2);
      store.clear();
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('flush() writes the store to disk and it reloads', () => {
      store.save('sessionId', 'abc-123');
      store.save('deviceId', 'dev-9');
      store.flush();
      const onDisk = readFile();
      expect(onDisk.version).toBe(1);
      expect(onDisk.entries['sessionId'].value).toBe('abc-123');
      expect(onDisk.entries['deviceId'].value).toBe('dev-9');

      // A fresh instance over the same path loads the persisted constants.
      const reloaded = new ConstantsStoreImpl(filePath);
      const all = reloaded.getAll();
      expect(all).toHaveLength(2);
      expect(all.find(e => e.name === 'sessionId')?.value).toBe('abc-123');
    });

    it('starts fresh on a corrupt file without throwing', () => {
      fs.writeFileSync(filePath, '{ not valid json');
      const s = new ConstantsStoreImpl(filePath);
      expect(() => s.save('key', 'val')).not.toThrow();
      expect(s.getAll()).toHaveLength(1);
    });
  });
});
