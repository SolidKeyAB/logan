import { describe, it, expect } from 'vitest';
import {
  decodeSherlogLine,
  decodeSherlogStream,
  isSherlogLine,
  parseTokenDb,
  type SherlogTokenDb,
} from '../shared/sherlogDecode';

// A tiny token DB mirroring the real out/tokens.json shape ({ version, tokens }).
const DB: SherlogTokenDb = {
  version: 'poc',
  tokens: {
    a1b2c3d4: {
      description: 'user rejected',
      level: 'DEBUG',
      values: ['user_id', 'reason'],
      file: 'auth.py',
      function: 'login',
      kind: 'log',
    },
    c0ffee12: {
      description: 'enter cacheGet()',
      level: 'INFO',
      values: ['key'],
      file: 'image_cache.py',
      function: 'cacheGet',
      kind: 'entry',
    },
  },
};

describe('isSherlogLine', () => {
  it('recognises @LOG token lines (with or without a json payload or a prefix)', () => {
    expect(isSherlogLine('@LOG a1b2c3d4 {"user_id":42}')).toBe(true);
    expect(isSherlogLine('@LOG a1b2c3d4')).toBe(true);
    expect(isSherlogLine('2026-09-16T10:00:00 some prefix @LOG a1b2c3d4 {"x":1}')).toBe(true);
  });
  it('rejects non-token lines', () => {
    expect(isSherlogLine('a normal log line')).toBe(false);
    expect(isSherlogLine('@LOG')).toBe(false); // no id
    expect(isSherlogLine('@LOG a1b2c3d4 {"x":1} trailing')).toBe(false); // payload must end the line
  });
});

describe('decodeSherlogLine', () => {
  it('renders a known token as "[LEVEL] file:function — description | k=v k=v"', () => {
    const r = decodeSherlogLine('@LOG a1b2c3d4 {"user_id": 42, "reason": "expired"}', DB);
    expect(r).not.toBeNull();
    expect(r!.known).toBe(true);
    expect(r!.text).toBe('[DEBUG] auth.py:login — user rejected | user_id=42 reason=expired');
  });

  it('ignores any prefix and matches the @LOG token at end of line', () => {
    const r = decodeSherlogLine('2026-09-16T10:00:00.123 prefix @LOG c0ffee12 {"key": 7}', DB);
    expect(r!.text).toBe('[INFO] image_cache.py:cacheGet — enter cacheGet() | key=7');
  });

  it('renders a payload-less token with no trailing " | "', () => {
    const r = decodeSherlogLine('@LOG a1b2c3d4', DB);
    expect(r!.text).toBe('[DEBUG] auth.py:login — user rejected');
  });

  it('flags an unknown token as map drift instead of dropping it', () => {
    const r = decodeSherlogLine('@LOG deadbeef {"x": 1}', DB);
    expect(r!.known).toBe(false);
    expect(r!.text).toContain('unknown token deadbeef');
    expect(r!.text).toContain('map drift');
  });

  it('returns null for a non-sherlog line (viewer leaves it untouched)', () => {
    expect(decodeSherlogLine('just a regular log line', DB)).toBeNull();
  });

  it('keeps malformed json as _raw rather than throwing', () => {
    const r = decodeSherlogLine('@LOG a1b2c3d4 {not json}', DB);
    expect(r!.text).toContain('_raw=');
  });
});

describe('parseTokenDb', () => {
  it('accepts the { version, tokens } artifact shape', () => {
    const db = parseTokenDb(JSON.stringify(DB));
    expect(db.version).toBe('poc');
    expect(Object.keys(db.tokens)).toHaveLength(2);
  });
  it('accepts a bare id->entry map (older/hand-made DBs)', () => {
    const db = parseTokenDb(JSON.stringify(DB.tokens));
    expect(db.tokens.a1b2c3d4.function).toBe('login');
  });
});

describe('decodeSherlogStream', () => {
  it('yields only decoded lines by default, all lines with passthrough', () => {
    const lines = ['@LOG a1b2c3d4 {"user_id":1}', 'a normal line', '@LOG c0ffee12 {"key":2}'];
    expect([...decodeSherlogStream(lines, DB)]).toHaveLength(2);
    const withPass = [...decodeSherlogStream(lines, DB, { passthrough: true })];
    expect(withPass).toHaveLength(3);
    expect(withPass[1]).toBe('a normal line');
  });
});
