import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { isPathInside, validateArchiveEntry, safeJoin, resolveArchiveEntryPath } from '../shared/safePath';

const ROOT = path.resolve('/tmp/logan-extract-root');

describe('isPathInside', () => {
  it('treats the root itself as inside', () => {
    expect(isPathInside(ROOT, ROOT)).toBe(true);
  });
  it('accepts a nested path', () => {
    expect(isPathInside(ROOT, path.join(ROOT, 'a', 'b.log'))).toBe(true);
  });
  it('rejects a parent path', () => {
    expect(isPathInside(ROOT, path.resolve(ROOT, '..'))).toBe(false);
  });
  it('rejects a sibling that merely shares a name prefix', () => {
    // '/tmp/logan-extract-root-evil' must NOT count as inside '/tmp/logan-extract-root'.
    expect(isPathInside(ROOT, ROOT + '-evil')).toBe(false);
  });
});

describe('validateArchiveEntry', () => {
  it('accepts a normal relative entry', () => {
    expect(validateArchiveEntry('dir/file.log').ok).toBe(true);
  });
  it('rejects a .. traversal (posix)', () => {
    expect(validateArchiveEntry('../../etc/passwd').ok).toBe(false);
  });
  it('rejects a .. traversal written with backslashes (windows-style)', () => {
    expect(validateArchiveEntry('..\\..\\Windows\\System32\\x').ok).toBe(false);
  });
  it('rejects absolute paths', () => {
    expect(validateArchiveEntry('/etc/passwd').ok).toBe(false);
  });
  it('rejects drive-letter paths', () => {
    expect(validateArchiveEntry('C:\\evil.exe').ok).toBe(false);
  });
  it('rejects NUL bytes and empty names', () => {
    expect(validateArchiveEntry('a\0b').ok).toBe(false);
    expect(validateArchiveEntry('').ok).toBe(false);
  });
});

describe('safeJoin', () => {
  it('joins a safe relative entry inside root', () => {
    expect(safeJoin(ROOT, 'a/b.log')).toBe(path.join(ROOT, 'a', 'b.log'));
  });
  it('throws when the entry escapes via ..', () => {
    expect(() => safeJoin(ROOT, '../escape.log')).toThrow(/escapes extraction root/);
  });
  it('throws when the entry is absolute (ignores root)', () => {
    expect(() => safeJoin(ROOT, '/etc/passwd')).toThrow(/escapes extraction root/);
  });
  it('throws on a mid-path escape that nets outside root', () => {
    expect(() => safeJoin(ROOT, 'a/../../b.log')).toThrow(/escapes extraction root/);
  });
  it('allows a mid-path .. that stays inside root', () => {
    expect(safeJoin(ROOT, 'a/../b.log')).toBe(path.join(ROOT, 'b.log'));
  });
});

describe('resolveArchiveEntryPath', () => {
  it('validates then joins', () => {
    expect(resolveArchiveEntryPath(ROOT, 'logs/app.log')).toBe(path.join(ROOT, 'logs', 'app.log'));
  });
  it('rejects unsafe names with a descriptive reason', () => {
    expect(() => resolveArchiveEntryPath(ROOT, '../../x')).toThrow(/Unsafe archive entry/);
    expect(() => resolveArchiveEntryPath(ROOT, 'C:\\x')).toThrow(/drive-letter/);
  });
});
