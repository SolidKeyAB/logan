import { describe, it, expect } from 'vitest';
import { splitLineIntoColumns, filterLineToVisibleColumns, ColumnConfig } from '../main/fileHandler';

// Helper: build a ColumnConfig that hides the given (0-based) column indices.
function hide(delimiter: string, columnCount: number, hidden: number[]): ColumnConfig {
  return {
    delimiter,
    columns: Array.from({ length: columnCount }, (_, index) => ({
      index,
      visible: !hidden.includes(index),
    })),
  };
}

describe('splitLineIntoColumns', () => {
  it('collapses whitespace and ignores leading/trailing padding for space delimiter', () => {
    // An indented line must yield the SAME columns as a non-indented one —
    // otherwise column indices drift line-to-line and the filter hides the wrong field.
    expect(splitLineIntoColumns('a b c', ' ')).toEqual(['a', 'b', 'c']);
    expect(splitLineIntoColumns('   a   b   c   ', ' ')).toEqual(['a', 'b', 'c']);
    expect(splitLineIntoColumns('', ' ')).toEqual([]);
    expect(splitLineIntoColumns('   ', ' ')).toEqual([]);
  });

  it('keeps empty fields significant for tab delimiter', () => {
    expect(splitLineIntoColumns('a\t\tc', '\t')).toEqual(['a', '', 'c']);
  });

  it('treats a quoted field containing the delimiter as a single column', () => {
    expect(splitLineIntoColumns('1,"a,b",3', ',')).toEqual(['1', 'a,b', '3']);
    expect(splitLineIntoColumns('x;"has ""quote""";y', ';')).toEqual(['x', 'has "quote"', 'y']);
  });
});

describe('filterLineToVisibleColumns', () => {
  it('returns the line unchanged when config is missing or all visible', () => {
    expect(filterLineToVisibleColumns('a,b,c', undefined)).toBe('a,b,c');
    expect(filterLineToVisibleColumns('a,b,c', hide(',', 3, []))).toBe('a,b,c');
  });

  it('hides the right column even when an earlier field is quoted (the core bug)', () => {
    // Before the fix, the naive split saw 4 parts (1 | "a | b" | 3) and hid the
    // wrong data. The analyzer sees 3 columns, so the filter must too.
    const line = '1,"a,b",3';
    expect(filterLineToVisibleColumns(line, hide(',', 3, [1]))).toBe('1,3');
    // Keeping the quoted middle field re-quotes it so the line stays valid.
    expect(filterLineToVisibleColumns(line, hide(',', 3, [0]))).toBe('"a,b",3');
  });

  it('hides a consistent field across indented and non-indented space-delimited lines', () => {
    const cfg = hide(' ', 3, [0]); // hide column 0
    expect(filterLineToVisibleColumns('INFO comp msg', cfg)).toBe('comp msg');
    expect(filterLineToVisibleColumns('    INFO comp msg', cfg)).toBe('comp msg');
  });

  it('stays consistent with the analyzer split for the same delimiter', () => {
    // The invariant: filtering with all-visible reproduces a rejoin of the same
    // split the analyzer used, for every delimiter kind.
    const csv = '1,"a,b",3';
    const parts = splitLineIntoColumns(csv, ',');
    expect(parts.length).toBe(3);
    // Hiding nothing but forcing the filter path (one hidden then restored) keeps count aligned.
    expect(filterLineToVisibleColumns(csv, hide(',', parts.length, [2]))).toBe('1,"a,b"');
  });
});
