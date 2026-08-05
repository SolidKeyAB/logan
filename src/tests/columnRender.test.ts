import { describe, it, expect } from 'vitest';
import { computeColumnSegments } from '../shared/columnRender';
import { splitLineIntoColumns } from '../main/fileHandler';

// The two core invariants for CSS column-hiding:
//  (1) segments TILE [0,len): concatenating every segment's substring reproduces
//      the original line byte-for-byte (so the rendered text is unchanged), and
//  (2) the column COUNT matches splitLineIntoColumns (so a visibility config that
//      hides column N hides the same column the analyzer/modal counted).
function assertTilesAndCounts(text: string, delimiter: string) {
  const segs = computeColumnSegments(text, delimiter);
  // (1) contiguous tiling from 0 to len
  let pos = 0;
  let joined = '';
  for (const s of segs) {
    expect(s.start).toBe(pos);
    expect(s.end).toBeGreaterThanOrEqual(s.start);
    joined += text.slice(s.start, s.end);
    pos = s.end;
  }
  if (segs.length > 0) expect(pos).toBe(text.length);
  expect(joined).toBe(segs.length > 0 ? text : '');
  // (2) column count parity with splitLineIntoColumns
  expect(segs.length).toBe(splitLineIntoColumns(text, delimiter).length === 0 ? 0 : splitLineIntoColumns(text, delimiter).length);
  // col indices are 0..n-1 in order
  segs.forEach((s, i) => expect(s.col).toBe(i));
}

describe('computeColumnSegments — CSV (comma)', () => {
  it('tiles a simple CSV line and counts columns', () => {
    assertTilesAndCounts('a,b,c', ',');
    expect(computeColumnSegments('a,b,c', ',').map(s => 'a,b,c'.slice(s.start, s.end))).toEqual(['a,', 'b,', 'c']);
  });
  it('keeps a quoted field containing the delimiter as one column', () => {
    assertTilesAndCounts('1,"a,b",3', ',');
    expect(splitLineIntoColumns('1,"a,b",3', ',')).toEqual(['1', 'a,b', '3']); // 3 columns
    expect(computeColumnSegments('1,"a,b",3', ',').length).toBe(3);
  });
  it('handles empty fields and a trailing delimiter', () => {
    assertTilesAndCounts('a,,c,', ',');
  });
  it('handles empty text (one empty column)', () => {
    assertTilesAndCounts('', ',');
    expect(computeColumnSegments('', ',')).toEqual([{ col: 0, start: 0, end: 0 }]);
  });
});

describe('computeColumnSegments — tab', () => {
  it('tiles tab-delimited with empty fields', () => {
    assertTilesAndCounts('a\tb\t\td', '\t');
    expect(computeColumnSegments('a\tb', '\t').map(s => 'a\tb'.slice(s.start, s.end))).toEqual(['a\t', 'b']);
  });
});

describe('computeColumnSegments — space', () => {
  it('tiles space-delimited tokens, carrying trailing whitespace', () => {
    assertTilesAndCounts('alpha  beta   gamma', ' ');
  });
  it('carries leading whitespace into the first column so tiling starts at 0', () => {
    const text = '   alpha beta';
    const segs = computeColumnSegments(text, ' ');
    expect(segs[0].start).toBe(0);
    expect(text.slice(segs[0].start, segs[0].end)).toBe('   alpha ');
    assertTilesAndCounts(text, ' ');
  });
  it('all-whitespace → no columns (matches trim→empty)', () => {
    expect(computeColumnSegments('    ', ' ')).toEqual([]);
    expect(splitLineIntoColumns('    ', ' ')).toEqual([]);
  });
  it('trailing whitespace stays on the last column', () => {
    const text = 'a b   ';
    assertTilesAndCounts(text, ' ');
    const segs = computeColumnSegments(text, ' ');
    expect(text.slice(segs[segs.length - 1].start)).toBe('b   ');
  });
});
