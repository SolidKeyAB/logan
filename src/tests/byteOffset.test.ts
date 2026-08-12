import { describe, it, expect } from 'vitest';
import { byteOffsetToLineIndex } from '../main/byteOffset';

describe('byteOffsetToLineIndex', () => {
  // Line-start byte offsets, e.g. a \r-delimited file our scanner indexed.
  const offsets = new Float64Array([0, 10, 25, 40, 100]);
  const count = 5;

  it('maps a byte exactly at a line start to that line', () => {
    expect(byteOffsetToLineIndex(offsets, count, 0)).toBe(0);
    expect(byteOffsetToLineIndex(offsets, count, 10)).toBe(1);
    expect(byteOffsetToLineIndex(offsets, count, 40)).toBe(3);
    expect(byteOffsetToLineIndex(offsets, count, 100)).toBe(4);
  });

  it('maps a byte in the middle of a line to that line', () => {
    expect(byteOffsetToLineIndex(offsets, count, 5)).toBe(0);
    expect(byteOffsetToLineIndex(offsets, count, 24)).toBe(1);
    expect(byteOffsetToLineIndex(offsets, count, 26)).toBe(2);
    expect(byteOffsetToLineIndex(offsets, count, 99)).toBe(3);
  });

  it('maps a byte past the last line start to the last line', () => {
    expect(byteOffsetToLineIndex(offsets, count, 101)).toBe(4);
    expect(byteOffsetToLineIndex(offsets, count, 999999)).toBe(4);
  });

  it('clamps before the first line and handles empty input', () => {
    expect(byteOffsetToLineIndex(offsets, count, -5)).toBe(0);
    expect(byteOffsetToLineIndex(new Float64Array([]), 0, 42)).toBe(0);
  });

  it('accepts a plain number[] as well', () => {
    expect(byteOffsetToLineIndex([0, 100, 200], 3, 150)).toBe(1);
    expect(byteOffsetToLineIndex([0, 100, 200], 3, 200)).toBe(2);
  });
});
