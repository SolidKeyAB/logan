import { describe, it, expect } from 'vitest';
import { compileColumnPattern, makeColumnExtractor, ColumnPatternSpec } from '../main/columnPattern';

function extract(spec: ColumnPatternSpec, line: string): string[] | null {
  return makeColumnExtractor(compileColumnPattern(spec))(line);
}

describe('compileColumnPattern — grok mode', () => {
  it('turns %{name} placeholders into ordered named columns', () => {
    const spec: ColumnPatternSpec = { mode: 'grok', pattern: '%{date} %{level} %{msg}' };
    const c = compileColumnPattern(spec);
    expect(c.fields).toEqual(['date', 'level', 'msg']);
    expect(c.named).toBe(true);
    expect(extract(spec, '2026-08-04 ERROR disk full')).toEqual(['2026-08-04', 'ERROR', 'disk full']);
  });

  it('matches literal glue forgivingly (whitespace runs collapse to \\s+)', () => {
    const spec: ColumnPatternSpec = { mode: 'grok', pattern: '%{a} %{b}' };
    // Two+ spaces between fields must still match a single-space pattern.
    expect(extract(spec, 'x     y')).toEqual(['x', 'y']);
  });

  it('honors a custom sub-pattern %{name:regex}', () => {
    const spec: ColumnPatternSpec = { mode: 'grok', pattern: 'id=%{id:\\d+} %{rest}' };
    expect(extract(spec, 'id=42 hello')).toEqual(['42', 'hello']);
    expect(extract(spec, 'id=xx hello')).toBeNull();
  });

  it('sanitizes and de-duplicates field names into valid group names', () => {
    const c = compileColumnPattern({ mode: 'grok', pattern: '%{a b} %{a b}' });
    expect(c.fields).toEqual(['a_b', 'a_b_2']);
  });
});

describe('compileColumnPattern — paint mode', () => {
  it('marks spans as variable columns and static text as glue', () => {
    // "GET /api 200" — paint "GET", "/api", "200".
    const sample = 'GET /api 200';
    const spans = [
      { start: 0, end: 3, name: 'method' },
      { start: 4, end: 8, name: 'path' },
      { start: 9, end: 12, name: 'status' },
    ];
    const spec: ColumnPatternSpec = { mode: 'paint', sample, spans };
    const c = compileColumnPattern(spec);
    expect(c.fields).toEqual(['method', 'path', 'status']);
    expect(extract(spec, 'POST /users 404')).toEqual(['POST', '/users', '404']);
  });

  it('generalises a painted date to a date-format regex (not a literal / blanket \\S+?)', () => {
    const sample = '2024-01-02 boot ok';
    const spans = [{ start: 0, end: 10, name: 'date' }];
    const c = compileColumnPattern({ mode: 'paint', sample, spans });
    expect(c.regex).toContain('\\d{4}-\\d{2}-\\d{2}');
    expect(c.regex).not.toContain('\\S+'); // the whole point: not a blanket token
    expect(extract({ mode: 'paint', sample, spans }, '2025-12-31 boot ok')).toEqual(['2025-12-31']);
  });

  it('types integers and keeps bracket borders literal (capturing the value inside)', () => {
    const sample = '[ERROR] code 42';
    const spans = [
      { start: 0, end: 7, name: 'level' },  // "[ERROR]"
      { start: 13, end: 15, name: 'code' }, // "42"
    ];
    const spec: ColumnPatternSpec = { mode: 'paint', sample, spans };
    const c = compileColumnPattern(spec);
    expect(c.regex).toContain('\\w+');    // ERROR → word class
    expect(c.regex).toContain('-?\\d+');  // 42 → integer class
    expect(extract(spec, '[WARN] code 7')).toEqual(['WARN', '7']); // borders literal; value excludes []
  });

  it('keeps ( ), <> and other enclosing delimiters literal, generalising the value inside', () => {
    const sample = 'req (200) from <alice>';
    const spans = [
      { start: 4, end: 9, name: 'status' },  // "(200)"
      { start: 15, end: 22, name: 'user' },  // "<alice>"
    ];
    const spec: ColumnPatternSpec = { mode: 'paint', sample, spans };
    const c = compileColumnPattern(spec);
    expect(c.regex).toContain('\\(');  // paren kept literal
    expect(c.regex).toContain('<');    // angle kept literal
    expect(extract(spec, 'req (404) from <bob>')).toEqual(['404', 'bob']); // values generalise
  });

  it('requires at least one span', () => {
    expect(() => compileColumnPattern({ mode: 'paint', sample: 'abc', spans: [] })).toThrow();
  });
});

describe('compileColumnPattern — raw regex mode', () => {
  it('uses named groups as columns', () => {
    const spec: ColumnPatternSpec = { mode: 'regex', pattern: '(?<k>\\w+)=(?<v>\\d+)' };
    const c = compileColumnPattern(spec);
    expect(c.fields).toEqual(['k', 'v']);
    expect(c.named).toBe(true);
    expect(extract(spec, 'temp=37')).toEqual(['temp', '37']);
  });

  it('falls back to numbered columns when there are only positional groups', () => {
    const spec: ColumnPatternSpec = { mode: 'regex', pattern: '(\\w+):(\\d+)' };
    const c = compileColumnPattern(spec);
    expect(c.fields).toEqual(['col1', 'col2']);
    expect(c.named).toBe(false);
    expect(extract(spec, 'port:8080')).toEqual(['port', '8080']);
  });

  it('returns null on no match, and throws on an invalid regex', () => {
    expect(extract({ mode: 'regex', pattern: 'zzz(?<n>\\d+)' }, 'no digits here')).toBeNull();
    expect(() => compileColumnPattern({ mode: 'regex', pattern: '(' })).toThrow();
  });
});
