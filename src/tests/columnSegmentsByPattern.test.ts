import { describe, it, expect } from 'vitest';
import { computeColumnSegmentsByPattern, ColumnSegment } from '../shared/columnRender';

// The pattern MUST be compiled with the 'd' flag (hasIndices) for capture-group ranges.
const re = (src: string, flags = '') => new RegExp(src, flags.includes('d') ? flags : flags + 'd');

// The critical invariant: segments TILE [0, len) in order AND concatenating their slices
// reproduces the original line byte-for-byte (nothing added/lost/duplicated on screen).
function tiles(text: string, segs: ColumnSegment[]): boolean {
  let pos = 0;
  let rebuilt = '';
  for (const s of segs) {
    if (s.start !== pos) return false;
    if (s.end < s.start) return false;
    rebuilt += text.slice(s.start, s.end);
    pos = s.end;
  }
  return pos === text.length && rebuilt === text;
}

describe('computeColumnSegmentsByPattern', () => {
  it('segments a 2-group regex and tiles byte-identically', () => {
    const text = '2024-01-02 ERROR something failed';
    const segs = computeColumnSegmentsByPattern(text, re('^(\\S+)\\s+(\\w+)'), 2);
    expect(tiles(text, segs)).toBe(true);
    expect(segs.map(s => s.col)).toEqual([0, 1]);
    expect(text.slice(segs[0].start, segs[0].end)).toContain('2024-01-02');
    expect(text.slice(segs[1].start, segs[1].end)).toContain('ERROR');
  });

  it('assigns trailing glue to the preceding column (hiding a col hides its glue)', () => {
    const text = 'a==b==c';
    const segs = computeColumnSegmentsByPattern(text, re('(a)==(b)==(c)'), 3);
    expect(tiles(text, segs)).toBe(true);
    expect(segs.map(s => s.col)).toEqual([0, 1, 2]);
    expect(text.slice(segs[0].start, segs[0].end)).toBe('a==');
    expect(text.slice(segs[1].start, segs[1].end)).toBe('b==');
    expect(text.slice(segs[2].start, segs[2].end)).toBe('c');
  });

  it('the first column carries leading glue so tiling starts at 0', () => {
    const text = '   x y';
    const segs = computeColumnSegmentsByPattern(text, re('(x)\\s+(y)'), 2);
    expect(tiles(text, segs)).toBe(true);
    expect(segs[0].start).toBe(0);
    expect(text.slice(segs[0].start, segs[0].end)).toBe('   x ');
    expect(text.slice(segs[1].start, segs[1].end)).toBe('y');
  });

  it('non-matching line → single col -1 whole line (never hidden)', () => {
    const text = 'no structure here';
    const segs = computeColumnSegmentsByPattern(text, re('^(\\d+),(\\d+)$'), 2);
    expect(segs).toEqual([{ col: -1, start: 0, end: text.length }]);
  });

  it('empty text → one empty segment', () => {
    expect(computeColumnSegmentsByPattern('', re('(a)'), 1)).toEqual([{ col: 0, start: 0, end: 0 }]);
  });

  it('skips unmatched optional groups but still tiles', () => {
    const text = 'a c';
    const segs = computeColumnSegmentsByPattern(text, re('(a)(b)?\\s+(c)'), 3);
    expect(tiles(text, segs)).toBe(true);
    expect(segs.map(s => s.col)).toEqual([0, 2]);
  });

  it('a regex WITHOUT the d flag falls back to the whole line at col -1', () => {
    const text = 'a b c';
    // no 'd' flag → no indices → un-columned, never hidden
    const segs = computeColumnSegmentsByPattern(text, new RegExp('(a)\\s+(b)'), 2);
    expect(segs).toEqual([{ col: -1, start: 0, end: text.length }]);
  });
});
