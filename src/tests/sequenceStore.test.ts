import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SequenceStoreImpl, normalizeClue } from '../main/sequenceStore';
import { toDescriptor } from '../main/entityRegistry';

// Clue Trail — Increment A (2026-08-20): a `sequence` is an ORDERED evidence trail
// (the evidence twin of an investigation template). This covers the store CRUD +
// clue normalization + the entity-registry descriptor.

let tmp: string;
let store: SequenceStoreImpl;
let counter = 0;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `logan-seq-test-${process.pid}-${counter++}.json`);
  store = new SequenceStoreImpl(tmp);
});
afterEach(() => { try { fs.unlinkSync(tmp); } catch { /* ignore */ } });

describe('normalizeClue', () => {
  it('accepts a valid ref and coerces numeric fields', () => {
    const c = normalizeClue({ ref: 'line', line: '42', note: 'first error' });
    expect(c).toEqual({ ref: 'line', line: 42, note: 'first error' });
  });
  it('keeps signalValue fields', () => {
    expect(normalizeClue({ ref: 'signalValue', field: 'rpm', value: 8000, at: 1710000000000 }))
      .toEqual({ ref: 'signalValue', field: 'rpm', value: 8000, at: 1710000000000 });
  });
  it('rejects an unknown ref', () => {
    expect(normalizeClue({ ref: 'bogus', line: 1 })).toBeNull();
    expect(normalizeClue(null)).toBeNull();
    expect(normalizeClue({ line: 1 })).toBeNull();
  });
});

describe('save / get / list', () => {
  it('saves a named sequence and reads it back by name and by id', () => {
    const seq = store.save({ name: 'Auth expiry trail', clues: [{ ref: 'line', line: 10 }] });
    expect(seq).not.toBeNull();
    expect(seq!.id).toBe('auth-expiry-trail');
    expect(seq!.clues).toHaveLength(1);
    expect(store.get('Auth expiry trail')!.id).toBe('auth-expiry-trail');
    expect(store.get('auth-expiry-trail')!.name).toBe('Auth expiry trail');
  });

  it('requires a name or id', () => {
    expect(store.save({ name: '' })).toBeNull();
    expect(store.save({})).toBeNull();
  });

  it('filters junk clues on save', () => {
    const seq = store.save({ name: 'T', clues: [{ ref: 'line', line: 1 }, { ref: 'nope' }, 'garbage'] });
    expect(seq!.clues).toHaveLength(1);
  });

  it('upserts by id (same slug) and updates fields', () => {
    store.save({ name: 'Trail', description: 'v1' });
    const again = store.save({ name: 'Trail', description: 'v2', scope: 'ticket' });
    expect(again!.description).toBe('v2');
    expect(again!.scope).toBe('ticket');
    expect(store.list()).toHaveLength(1);
  });

  it('re-saving WITHOUT clues keeps existing clues; [] clears them', () => {
    store.save({ name: 'Trail', clues: [{ ref: 'line', line: 1 }, { ref: 'line', line: 2 }] });
    // metadata-only update (no clues field) must NOT wipe the trail — guards the
    // logan_save_sequence "set the description after building with add_clue" flow.
    const meta = store.save({ name: 'Trail', description: 'done' });
    expect(meta!.clues).toHaveLength(2);
    // an explicit empty array still clears intentionally.
    expect(store.save({ name: 'Trail', clues: [] })!.clues).toHaveLength(0);
  });

  it('lists most-recently-updated first', () => {
    store.save({ name: 'A' });
    store.save({ name: 'B' });
    store.appendClue('A', { ref: 'line', line: 5 }); // touch A last
    expect(store.list()[0].name).toBe('A');
  });
});

describe('appendClue', () => {
  it('creates the sequence if missing, then appends in order', () => {
    expect(store.get('New')).toBeNull();
    store.appendClue('New', { ref: 'line', line: 1, note: 'a' });
    const seq = store.appendClue('New', { ref: 'range', line: 5, endLine: 9, note: 'b' });
    expect(seq!.clues.map(c => c.note)).toEqual(['a', 'b']);
    expect(seq!.clues[1]).toMatchObject({ ref: 'range', line: 5, endLine: 9 });
  });

  it('returns null for an invalid clue and does not create a sequence', () => {
    expect(store.appendClue('Ghost', { ref: 'bogus' })).toBeNull();
    expect(store.get('Ghost')).toBeNull();
  });
});

describe('delete + persistence', () => {
  it('deletes by name and by id', () => {
    store.save({ name: 'ByName' });
    store.save({ name: 'By Id' });
    expect(store.delete('ByName')).toBe(true);   // delete by name
    expect(store.delete('by-id')).toBe(true);    // delete by slug/id
    expect(store.get('by-id')).toBeNull();
    expect(store.list()).toHaveLength(0);
    expect(store.delete('missing')).toBe(false);
  });

  it('persists across instances (flush → reload)', () => {
    store.save({ name: 'Persisted', clues: [{ ref: 'line', line: 3 }] });
    store.flush();
    const reopened = new SequenceStoreImpl(tmp);
    const seq = reopened.get('Persisted');
    expect(seq!.clues).toHaveLength(1);
  });
});

describe('entity-registry descriptor', () => {
  it('maps a sequence to a uniform descriptor', () => {
    const seq = store.save({ name: 'Evidence', description: 'why', scope: 'file', clues: [{ ref: 'line', line: 1 }, { ref: 'line', line: 2 }] });
    const d = toDescriptor('sequence', seq);
    expect(d).toMatchObject({ kind: 'sequence', id: 'evidence', name: 'Evidence', description: 'why', scope: 'file', count: 2, summary: '2 clues' });
  });
});
