import { describe, it, expect } from 'vitest';
import { CompositeFileHandler, type CompositeMemberHandler } from '../main/compositeFileHandler';
import { buildFingerprint } from '../main/baselineStore';
import type { AnalysisResult } from '../main/analyzers/types';
import type { LineData, FileInfo } from '../shared/types';

// A baseline used to only accept a real FileHandler, so it could not be captured from a
// virtual "single session" (composite) or segmented big file — the read handler for those
// is served by getReadHandler(), not getFileHandler(). buildFingerprint now accepts the
// full read-handler union; this locks in that a composite session fingerprints correctly.

// Minimal member handler backed by an in-memory array of lines — just enough of the
// FileHandler read surface for CompositeFileHandler + buildFingerprint (getTotalLines /
// getFileInfo / getLines). The rest of the Pick surface is stubbed (never called here).
function member(lines: string[], size = 100): CompositeMemberHandler {
  const data: LineData[] = lines.map((text, i) => ({ lineNumber: i, text }));
  const handler = {
    getTotalLines: () => lines.length,
    getLines: (start: number, count: number) => data.slice(start, start + count),
    getFileInfo: (): FileInfo => ({ path: 'mem', size, totalLines: lines.length }),
    getMaxLineLength: () => lines.reduce((m, l) => Math.max(m, l.length), 0),
    getLinesAsync: async (start: number, count: number) => data.slice(start, start + count),
    getLinesByNumbers: async (nums: number[]) => nums.map((n) => data[n]).filter(Boolean),
    search: async () => [],
    searchMulti: async () => [],
    buildSeverityIndex: () => {},
    getScanContext: () => null,
    close: () => {},
  } as unknown as CompositeMemberHandler['handler'];
  return { filePath: `mem-${lines.length}`, handler };
}

function analysis(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    stats: { totalLines: 0, analyzedLines: 0 },
    levelCounts: {},
    analyzerName: 'session',
    analyzedAt: 0,
    insights: { crashes: [], topFailingComponents: [], filterSuggestions: [] },
    ...over,
  };
}

describe('buildFingerprint over a virtual (composite) session', () => {
  const composite = new CompositeFileHandler(
    [
      member(['2020-01-01 10:00:00 ERROR boom', 'info a', 'info b']),
      member(['2020-01-01 10:01:00 WARN hmm', 'info c']),
    ],
    'Single session (2 files)',
  );

  it('fingerprints a composite session (totals span all members, no throw)', () => {
    const fp = buildFingerprint(
      '__composite__',
      analysis({ stats: { totalLines: 5, analyzedLines: 5 }, levelCounts: { error: 1, warning: 1, info: 3 } }),
      composite,
    );
    expect(fp.totalLines).toBe(5); // 3 + 2 across both members via the global line space
    expect(fp.sourceFile).toBe('__composite__');
    expect(fp.levelCounts).toEqual({ error: 1, warning: 1, info: 3 });
    // Proves getLines() was walked over the whole session (the pass that builds density).
    expect(Array.isArray(fp.timestampDensity)).toBe(true);
  });
});
