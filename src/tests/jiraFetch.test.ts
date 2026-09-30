import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  tokenizeArgs,
  substituteVars,
  buildArgs,
  isValidTicket,
  snapshotDir,
  diffSnapshot,
} from '../main/jiraFetch';

describe('jiraFetch — tokenizeArgs', () => {
  it('splits on whitespace', () => {
    expect(tokenizeArgs('a b c')).toEqual(['a', 'b', 'c']);
  });
  it('collapses runs of whitespace and trims', () => {
    expect(tokenizeArgs('  a   b\t c ')).toEqual(['a', 'b', 'c']);
  });
  it('keeps quoted segments (paths with spaces) as one token', () => {
    expect(tokenizeArgs('script.py "/a b/c.py" --out')).toEqual(['script.py', '/a b/c.py', '--out']);
  });
  it('handles a quote glued to text', () => {
    expect(tokenizeArgs('--out="/a b/c"')).toEqual(['--out=/a b/c']);
  });
  it('returns empty array for empty template', () => {
    expect(tokenizeArgs('')).toEqual([]);
  });
});

describe('jiraFetch — substituteVars / buildArgs', () => {
  it('substitutes {ticket} and {downloadDir}', () => {
    expect(substituteVars('{ticket}', { ticket: 'SUS-1', downloadDir: '/d' })).toBe('SUS-1');
    expect(substituteVars('--out={downloadDir}', { ticket: 'SUS-1', downloadDir: '/d' })).toBe('--out=/d');
  });
  it('substitutes AFTER tokenizing so a value stays one arg even if it contained spaces', () => {
    // downloadDir with a space must remain a single argv entry
    const args = buildArgs('dl.py {ticket} --out {downloadDir}', { ticket: 'SUS-1', downloadDir: '/a b/logs' });
    expect(args).toEqual(['dl.py', 'SUS-1', '--out', '/a b/logs']);
  });
  it('leaves unknown placeholders intact', () => {
    expect(substituteVars('{other}', { ticket: 'X', downloadDir: '/d' })).toBe('{other}');
  });
});

describe('jiraFetch — isValidTicket', () => {
  it('accepts typical Jira keys', () => {
    expect(isValidTicket('SUS-1234')).toBe(true);
    expect(isValidTicket('PROJ_12')).toBe(true);
    expect(isValidTicket('abc.def-9')).toBe(true);
  });
  it('rejects injection / traversal / whitespace', () => {
    expect(isValidTicket('')).toBe(false);
    expect(isValidTicket('a b')).toBe(false);
    expect(isValidTicket('../etc/passwd')).toBe(false);
    expect(isValidTicket('SUS-1; rm -rf /')).toBe(false);
    expect(isValidTicket('$(whoami)')).toBe(false);
    expect(isValidTicket('a/b')).toBe(false);
  });
});

describe('jiraFetch — snapshot/diff', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-test-'));
  });
  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* */ }
  });

  it('detects a newly created file', () => {
    const before = snapshotDir(root);
    const f = path.join(root, 'SUS-1234.log');
    fs.writeFileSync(f, 'hello');
    const after = snapshotDir(root);
    const changed = diffSnapshot(before, after, 0);
    expect(changed).toContain(f);
  });

  it('ignores files that did not change', () => {
    const f = path.join(root, 'old.log');
    fs.writeFileSync(f, 'x');
    const before = snapshotDir(root);
    const after = snapshotDir(root);
    expect(diffSnapshot(before, after, 0)).toEqual([]);
  });

  it('detects files in subfolders (recursive)', () => {
    const before = snapshotDir(root);
    const sub = path.join(root, 'SUS-1234');
    fs.mkdirSync(sub);
    const f = path.join(sub, 'device.log');
    fs.writeFileSync(f, 'y');
    const after = snapshotDir(root);
    expect(diffSnapshot(before, after, 0)).toContain(f);
  });

  it('returns newest-first ordering', () => {
    const before = snapshotDir(root);
    const a = path.join(root, 'a.log');
    const b = path.join(root, 'b.log');
    fs.writeFileSync(a, '1');
    // force b to be strictly newer
    fs.writeFileSync(b, '2');
    const future = Date.now() + 10_000;
    fs.utimesSync(b, future / 1000, future / 1000);
    const after = snapshotDir(root);
    const changed = diffSnapshot(before, after, 0);
    expect(changed[0]).toBe(b);
  });

  it('empty root path yields an empty snapshot', () => {
    expect(snapshotDir('').size).toBe(0);
  });
});
