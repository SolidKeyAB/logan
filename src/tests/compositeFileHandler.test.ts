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
    searchMulti: async (
      configs: Array<{ id: string; pattern: string; isRegex: boolean; matchCase: boolean; wholeWord: boolean }>,
      _onProgress?: unknown,
      signal?: { cancelled: boolean },
      _onMatches?: unknown,
      maxMatchesPerConfig: number = Infinity,
    ) => {
      const out: Record<string, SearchMatch[]> = {};
      for (const c of configs) {
        const res: SearchMatch[] = [];
        for (let i = 0; i < lines.length && res.length < maxMatchesPerConfig; i++) {
          if (signal?.cancelled) break;
          const col = lines[i].toLowerCase().indexOf(c.pattern.toLowerCase());
          if (col >= 0) res.push({ lineNumber: i, column: col, length: c.pattern.length, lineText: lines[i] });
        }
        out[c.id] = res;
      }
      return out;
    },
    buildSeverityIndex: async () => {
      const fatal: number[] = [], error: number[] = [], warning: number[] = [];
      lines.forEach((l, i) => {
        if (/FATAL|PANIC/i.test(l)) fatal.push(i);
        else if (/ERR/i.test(l)) error.push(i);
        else if (/WARN/i.test(l)) warning.push(i);
      });
      return {
        fatal: Uint32Array.from(fatal),
        error: Uint32Array.from(error),
        warning: Uint32Array.from(warning),
      };
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

  const cfg = (id: string, pattern: string) => ({ id, pattern, isRegex: false, matchCase: false, wholeWord: false });

  it('searchMulti fans out across members, rebasing each config into the global line space', async () => {
    const res = await comp.searchMulti([cfg('err', 'ERR'), cfg('zero', '0')]);
    expect(res.err.map((m) => m.lineNumber)).toEqual([1, 5]);       // a1 (g1), c0 (g5)
    expect(res.zero.map((m) => m.lineNumber)).toEqual([0, 3, 5]);   // a0 (g0), b0 (g3), c0 (g5)
  });

  it('searchMulti applies maxMatchesPerConfig as a GLOBAL cap across members', async () => {
    // '0' matches a0(g0), b0(g3), c0(g5). With cap 2 we stop after b0 and never search /c.log.
    const res = await comp.searchMulti([cfg('zero', '0')], undefined, undefined, undefined, 2);
    expect(res.zero.map((m) => m.lineNumber)).toEqual([0, 3]);
  });

  it('searchMulti streams rebased deltas via onMatches with global line numbers', async () => {
    const seen: number[] = [];
    await comp.searchMulti([cfg('err', 'ERR')], undefined, undefined, (delta) => {
      for (const m of delta.err || []) seen.push(m.lineNumber);
    });
    expect(seen).toEqual([1, 5]);
  });

  it('searchMulti stops when the signal is cancelled', async () => {
    const res = await comp.searchMulti([cfg('err', 'ERR')], undefined, { cancelled: true });
    expect(res.err).toEqual([]);
  });

  it('builds a combined severity index rebased into the global line space', async () => {
    const info = await comp.getSeverityInfo(0);
    // a1 (g1) + c0 (g5) match ERR → 2 errors; totals span the whole session.
    expect(info.counts).toEqual({ fatal: 0, error: 2, warning: 0 });
    expect(info.totalLines).toBe(9);
    expect(info.capped).toBe(false);
  });

  it('navigates to next/previous problem line across members in global space', async () => {
    expect(await comp.getNextSeverityLine(-1, 1, ['error'])).toBe(1); // first error, a1 (g1)
    expect(await comp.getNextSeverityLine(1, 1, ['error'])).toBe(5);  // next, c0 (g5)
    expect(await comp.getNextSeverityLine(9, 1, ['error'])).toBeNull();
    expect(await comp.getNextSeverityLine(9, -1, ['error'])).toBe(5); // previous from end
    expect(await comp.getNextSeverityLine(5, -1, ['error'])).toBe(1);
  });
});
