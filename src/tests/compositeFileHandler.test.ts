import { describe, it, expect } from 'vitest';
import { CompositeFileHandler, type CompositeMemberHandler } from '../main/compositeFileHandler';
import type { LineData, SearchMatch, SearchOptions } from '../shared/types';

// A minimal in-memory stand-in for FileHandler: enough of the read/search surface for
// CompositeFileHandler to delegate to, so we can test the boundary re-basing without
// touching disk. Each fake owns a plain array of line texts (0-based local lines).
function fakeHandler(lines: string[]): CompositeMemberHandler['handler'] {
  const mk = (i: number): LineData => ({ lineNumber: i, text: lines[i] });
  return {
    getTotalLines: () => lines.length,
    getMaxLineLength: () => lines.reduce((m, l) => Math.max(m, l.length), 0),
    getFileInfo: () => ({ path: 'fake', size: lines.join('\n').length, totalLines: lines.length }),
    getLines: (start: number, count: number) =>
      lines.slice(start, start + count).map((_, k) => mk(start + k)),
    getLinesAsync: async (start: number, count: number) =>
      lines.slice(start, start + count).map((_, k) => mk(start + k)),
    getLinesByNumbers: async (nums: number[]) => nums.filter((n) => n >= 0 && n < lines.length).map(mk),
    search: async (options: SearchOptions) => {
      // Honor the two options the composite must translate: filteredLineIndices (LOCAL to
      // this fake) and maxMatches (cap), so tests can prove the composite did it right.
      const allow = options.filteredLineIndices ? new Set(options.filteredLineIndices) : null;
      const cap = options.maxMatches ?? Infinity;
      const out: SearchMatch[] = [];
      for (let i = 0; i < lines.length && out.length < cap; i++) {
        if (allow && !allow.has(i)) continue;
        const text = lines[i];
        const col = text.toLowerCase().indexOf(options.pattern.toLowerCase());
        if (col >= 0) out.push({ lineNumber: i, column: col, length: options.pattern.length, lineText: text });
      }
      return out;
    },
    close: () => { /* noop */ },
  } as CompositeMemberHandler['handler'];
}

const opts = (pattern: string): SearchOptions => ({
  pattern, isRegex: false, isWildcard: false, matchCase: false, wholeWord: false,
});

describe('CompositeFileHandler', () => {
  const members: CompositeMemberHandler[] = [
    { filePath: '/a.log', handler: fakeHandler(['a0', 'a1 ERR', 'a2']) }, // global 0..2
    { filePath: '/b.log', handler: fakeHandler(['b0', 'b1']) },           // global 3..4
    { filePath: '/c.log', handler: fakeHandler(['c0 ERR', 'c1', 'c2', 'c3']) }, // global 5..8
  ];
  const comp = new CompositeFileHandler(members, 'session:test');

  it('reports summed totals and a synthetic file info', () => {
    expect(comp.getTotalLines()).toBe(9);
    expect(comp.getFileInfo().path).toBe('session:test');
    expect(comp.getFileInfo().totalLines).toBe(9);
  });

  it('exposes per-file boundaries', () => {
    expect(comp.boundaries()).toEqual([
      { filePath: '/a.log', startLine: 0, lineCount: 3 },
      { filePath: '/b.log', startLine: 3, lineCount: 2 },
      { filePath: '/c.log', startLine: 5, lineCount: 4 },
    ]);
  });

  it('reads a window spanning file boundaries with global line numbers', () => {
    const lines = comp.getLines(1, 5); // a1,a2,b0,b1,c0
    expect(lines.map((l) => l.lineNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(lines.map((l) => l.text)).toEqual(['a1 ERR', 'a2', 'b0', 'b1', 'c0 ERR']);
  });

  it('getLinesAsync matches getLines', async () => {
    expect(await comp.getLinesAsync(2, 3)).toEqual(comp.getLines(2, 3));
  });

  it('getLinesByNumbers preserves request order across files', async () => {
    const got = await comp.getLinesByNumbers([8, 0, 4]);
    expect(got.map((l) => l.lineNumber)).toEqual([8, 0, 4]);
    expect(got.map((l) => l.text)).toEqual(['c3', 'a0', 'b1']);
  });

  it('resolves a global line to its originating file', () => {
    expect(comp.fileOf(1)).toEqual({ filePath: '/a.log', localLine: 1 });
    expect(comp.fileOf(5)).toEqual({ filePath: '/c.log', localLine: 0 });
    expect(comp.fileOf(99)).toBeNull();
  });

  it('searches across all files and re-bases hits into the global space', async () => {
    const hits = await comp.search(opts('ERR'));
    expect(hits.map((h) => h.lineNumber)).toEqual([1, 5]); // a1 (global 1), c0 (global 5)
    expect(hits.map((h) => h.lineText)).toEqual(['a1 ERR', 'c0 ERR']);
  });

  it('stops searching when the signal is cancelled', async () => {
    const signal = { cancelled: true };
    expect(await comp.search(opts('ERR'), undefined, signal)).toEqual([]);
  });

  it('translates GLOBAL filteredLineIndices to each member local space when searching', async () => {
    // Only allow global line 5 (c0 in file /c.log). The 'ERR' hit at global 1 (a1) must NOT
    // appear — proving the indices were partitioned per-file, not forwarded raw.
    const hits = await comp.search({ ...opts('ERR'), filteredLineIndices: [5] });
    expect(hits.map((h) => h.lineNumber)).toEqual([5]);
    // Restricting to the other match's global line yields only that one.
    const hits2 = await comp.search({ ...opts('ERR'), filteredLineIndices: [1] });
    expect(hits2.map((h) => h.lineNumber)).toEqual([1]);
  });

  it('applies maxMatches as a GLOBAL cap, not once per member', async () => {
    // '0' matches a0 (g0), b0 (g3), c0 (g5). With cap 2 we must stop after b0 and never
    // search /c.log — a per-member cap would have returned all three.
    const hits = await comp.search({ ...opts('0'), maxMatches: 2 });
    expect(hits.map((h) => h.lineNumber)).toEqual([0, 3]);
  });

  it('getLinesByNumbers drops out-of-range lines (matches FileHandler), preserving order', async () => {
    const got = await comp.getLinesByNumbers([2, 99, 4]);
    expect(got.map((l) => l.lineNumber)).toEqual([2, 4]);
    expect(got.map((l) => l.text)).toEqual(['a2', 'b1']);
  });
});
