import { describe, it, expect } from 'vitest';
import { compilePattern, CompileInput } from '../main/compilePattern';

describe('compilePattern — plain mode', () => {
  it('escapes literal text so metacharacters match verbatim', () => {
    const r = compilePattern({ mode: 'plain', text: 'a.b(c)' });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('plain');
    expect(r.regex!.test('a.b(c)')).toBe(true);
    expect(r.regex!.test('axbXcX')).toBe(false); // '.' and '(' are literal, not wildcards
  });

  it('empty plain text fails', () => {
    const r = compilePattern({ mode: 'plain', text: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('matchCase:false adds the "i" flag (case-insensitive)', () => {
    const r = compilePattern({ mode: 'plain', text: 'ERROR', matchCase: false });
    expect(r.ok).toBe(true);
    expect(r.flags).toContain('i');
    expect(r.regex!.test('error')).toBe(true);
  });

  it('matchCase default is case-sensitive (no "i" flag)', () => {
    const r = compilePattern({ mode: 'plain', text: 'ERROR' });
    expect(r.flags).not.toContain('i');
    expect(r.regex!.test('error')).toBe(false);
  });

  it('wholeWord wraps the source in word boundaries', () => {
    const r = compilePattern({ mode: 'plain', text: 'cat', wholeWord: true });
    expect(r.source).toBe('\\bcat\\b');
    expect(r.regex!.test('the cat sat')).toBe(true);
    expect(r.regex!.test('category')).toBe(false);
  });

  it('composes wholeWord + matchCase:false together', () => {
    const r = compilePattern({ mode: 'plain', text: 'Cat', wholeWord: true, matchCase: false });
    expect(r.source).toBe('\\bCat\\b');
    expect(r.flags).toContain('i');
    expect(r.regex!.test('a CAT here')).toBe(true);
    expect(r.regex!.test('category')).toBe(false);
  });

  it('records invert as metadata without altering the regex', () => {
    const r = compilePattern({ mode: 'plain', text: 'foo', invert: true });
    expect(r.ok).toBe(true);
    expect(r.invert).toBe(true);
    expect(r.regex!.test('foo')).toBe(true); // regex still matches literally
  });
});

describe('compilePattern — grok mode', () => {
  it('delegates to the columnPattern engine and produces a matching regex', () => {
    const r = compilePattern({ mode: 'grok', text: '%{date} %{level} %{msg}' });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('grok');
    expect(r.regex!.test('2026-08-04 ERROR disk full')).toBe(true);
  });

  it('surfaces the engine error on empty grok pattern', () => {
    const r = compilePattern({ mode: 'grok', text: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty pattern/i);
  });
});

describe('compilePattern — paint mode', () => {
  it('compiles painted spans into a matching regex', () => {
    const input: CompileInput = {
      mode: 'paint',
      sample: 'GET /api 200',
      spans: [
        { start: 0, end: 3, name: 'method' },
        { start: 4, end: 8, name: 'path' },
        { start: 9, end: 12, name: 'status' },
      ],
    };
    const r = compilePattern(input);
    expect(r.ok).toBe(true);
    expect(r.regex!.test('POST /users 404')).toBe(true);
  });

  it('surfaces the engine error when no spans are provided', () => {
    const r = compilePattern({ mode: 'paint', sample: 'abc', spans: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe('compilePattern — regex mode', () => {
  it('uses the raw text and validates it', () => {
    const r = compilePattern({ mode: 'regex', text: '(?<k>\\w+)=(?<v>\\d+)' });
    expect(r.ok).toBe(true);
    expect(r.source).toBe('(?<k>\\w+)=(?<v>\\d+)');
    expect(r.regex!.test('temp=37')).toBe(true);
  });

  it('invalid regex → ok:false with an error and never throws', () => {
    let r: ReturnType<typeof compilePattern>;
    expect(() => { r = compilePattern({ mode: 'regex', text: '(' }); }).not.toThrow();
    expect(r!.ok).toBe(false);
    expect(r!.error).toBeTruthy();
    expect(r!.regex).toBeUndefined();
  });

  it('empty regex fails', () => {
    const r = compilePattern({ mode: 'regex', text: '' });
    expect(r.ok).toBe(false);
  });

  it('matchCase:false adds the "i" flag in regex mode too', () => {
    const r = compilePattern({ mode: 'regex', text: 'abc', matchCase: false });
    expect(r.flags).toContain('i');
    expect(r.regex!.test('ABC')).toBe(true);
  });
});

describe('compilePattern — safety warnings (non-fatal)', () => {
  it('warns on a nested-quantifier catastrophic-backtracking shape', () => {
    const r = compilePattern({ mode: 'regex', text: '(a+)+b' });
    expect(r.ok).toBe(true); // still compiles — warning is advisory only
    expect(r.warnings.some(w => /backtracking/i.test(w))).toBe(true);
  });

  it('warns on (.*)* style too', () => {
    const r = compilePattern({ mode: 'regex', text: '(.*)*z' });
    expect(r.warnings.some(w => /backtracking/i.test(w))).toBe(true);
  });

  it('warns on a very long pattern (> 1000 chars)', () => {
    const long = 'a'.repeat(1001);
    const r = compilePattern({ mode: 'regex', text: long });
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => /long/i.test(w))).toBe(true);
  });

  it('warns on an unbounded leading .*', () => {
    const r = compilePattern({ mode: 'regex', text: '.*foo' });
    expect(r.warnings.some(w => /unbounded/i.test(w) || /start of every line/i.test(w))).toBe(true);
  });

  it('a safe simple pattern produces no warnings', () => {
    const r = compilePattern({ mode: 'plain', text: 'hello world' });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

describe('compilePattern — contract', () => {
  it('never throws on an unknown mode', () => {
    // Force an out-of-range mode past the type system.
    const r = compilePattern({ mode: 'nope' as any, text: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown pattern mode/i);
  });
});
