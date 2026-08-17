import { describe, it, expect } from 'vitest';
import { CompositeLineSpace } from '../main/compositeLineSpace';

describe('CompositeLineSpace', () => {
  // Three files of 3, 2 and 4 lines → global lines 0..8.
  const space = new CompositeLineSpace([3, 2, 4]);

  it('sums total lines and records member starts', () => {
    expect(space.totalLines).toBe(9);
    expect(space.boundaries()).toEqual([0, 3, 5]);
  });

  it('locates a global line inside each file', () => {
    expect(space.locate(0)).toEqual({ fileIndex: 0, localLine: 0 });
    expect(space.locate(2)).toEqual({ fileIndex: 0, localLine: 2 });
    expect(space.locate(3)).toEqual({ fileIndex: 1, localLine: 0 });
    expect(space.locate(4)).toEqual({ fileIndex: 1, localLine: 1 });
    expect(space.locate(5)).toEqual({ fileIndex: 2, localLine: 0 });
    expect(space.locate(8)).toEqual({ fileIndex: 2, localLine: 3 });
  });

  it('returns null for out-of-range or non-integer lines', () => {
    expect(space.locate(-1)).toBeNull();
    expect(space.locate(9)).toBeNull();
    expect(space.locate(1.5)).toBeNull();
  });

  it('maps (file, local) back to a global line', () => {
    expect(space.toGlobal(0, 0)).toBe(0);
    expect(space.toGlobal(1, 1)).toBe(4);
    expect(space.toGlobal(2, 3)).toBe(8);
    expect(space.toGlobal(1, 2)).toBeNull(); // file 1 only has 2 lines (0..1)
    expect(space.toGlobal(5, 0)).toBeNull(); // no such file
  });

  it('splits a window that stays inside one file', () => {
    expect(space.split(0, 2)).toEqual([{ fileIndex: 0, localStart: 0, count: 2 }]);
    expect(space.split(6, 2)).toEqual([{ fileIndex: 2, localStart: 1, count: 2 }]);
  });

  it('splits a window spanning file boundaries', () => {
    expect(space.split(1, 5)).toEqual([
      { fileIndex: 0, localStart: 1, count: 2 }, // lines 1,2
      { fileIndex: 1, localStart: 0, count: 2 }, // lines 3,4
      { fileIndex: 2, localStart: 0, count: 1 }, // line 5
    ]);
  });

  it('clamps a window that runs past the end', () => {
    expect(space.split(7, 100)).toEqual([{ fileIndex: 2, localStart: 2, count: 2 }]);
    expect(space.split(9, 5)).toEqual([]);
    expect(space.split(0, 0)).toEqual([]);
  });

  it('round-trips every global line through locate → toGlobal', () => {
    for (let g = 0; g < space.totalLines; g++) {
      const pos = space.locate(g)!;
      expect(space.toGlobal(pos.fileIndex, pos.localLine)).toBe(g);
    }
  });

  it('skips empty files (0-line members) on both sides', () => {
    // Empty files at the start, middle and end must be transparent.
    const s = new CompositeLineSpace([0, 2, 0, 3, 0]);
    expect(s.totalLines).toBe(5);
    expect(s.boundaries()).toEqual([0, 0, 2, 2, 5]);
    expect(s.locate(0)).toEqual({ fileIndex: 1, localLine: 0 });
    expect(s.locate(1)).toEqual({ fileIndex: 1, localLine: 1 });
    expect(s.locate(2)).toEqual({ fileIndex: 3, localLine: 0 });
    expect(s.locate(4)).toEqual({ fileIndex: 3, localLine: 2 });
    expect(s.split(1, 3)).toEqual([
      { fileIndex: 1, localStart: 1, count: 1 },
      { fileIndex: 3, localStart: 0, count: 2 },
    ]);
  });

  it('handles a single empty composite', () => {
    const s = new CompositeLineSpace([]);
    expect(s.totalLines).toBe(0);
    expect(s.locate(0)).toBeNull();
    expect(s.split(0, 3)).toEqual([]);
  });
});
