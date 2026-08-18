import { describe, it, expect } from 'vitest';
import { mergeAnalysisResults } from '../main/compositeAnalysis';
import type { AnalysisResult } from '../main/analyzers';

// Build a minimal AnalysisResult for a member. Line numbers are LOCAL (0-based within the
// member); mergeAnalysisResults must rebase them by the member's global startLine.
function part(over: Partial<AnalysisResult> & {
  crashes?: AnalysisResult['insights']['crashes'];
  components?: AnalysisResult['insights']['topFailingComponents'];
  suggestions?: AnalysisResult['insights']['filterSuggestions'];
}): AnalysisResult {
  const { crashes = [], components = [], suggestions = [], ...rest } = over;
  return {
    stats: { totalLines: 0, analyzedLines: 0 },
    levelCounts: {},
    analyzerName: 'x',
    analyzedAt: 0,
    insights: { crashes, topFailingComponents: components, filterSuggestions: suggestions },
    ...rest,
  };
}

describe('mergeAnalysisResults', () => {
  const a = part({
    stats: { totalLines: 3, analyzedLines: 3 },
    levelCounts: { error: 2, warning: 1 },
    timeRange: { start: '10:00', end: '10:05' },
    crashes: [{ text: 'boom', lineNumber: 1, keyword: 'panic' }],
    components: [
      { name: 'net', errorCount: 5, warningCount: 1, sampleLine: 2 },
      { name: 'db', errorCount: 1, warningCount: 0, sampleLine: 0 },
    ],
    suggestions: [{ id: 's1', title: 'Hide noise', description: '', type: 'exclude', filter: {} }],
  });
  const b = part({
    stats: { totalLines: 2, analyzedLines: 2 },
    levelCounts: { error: 3, info: 10 },
    timeRange: { start: '10:06', end: '10:09' },
    crashes: [{ text: 'oops', lineNumber: 0, keyword: 'fatal' }],
    components: [{ name: 'net', errorCount: 4, warningCount: 2, sampleLine: 1 }], // same name as a's
    suggestions: [{ id: 's1', title: 'Hide noise', description: '', type: 'exclude', filter: {} }], // dup id
  });
  // members: a is global 0..2 (start 0), b is global 3..4 (start 3)
  const merged = mergeAnalysisResults([a, b], [0, 3], 'session', 999);

  it('sums stats and level counts across members', () => {
    expect(merged.stats).toEqual({ totalLines: 5, analyzedLines: 5 });
    expect(merged.levelCounts).toEqual({ error: 5, warning: 1, info: 10 });
  });

  it('rebases crash line numbers into the global space and sorts them', () => {
    expect(merged.insights.crashes.map((c) => c.lineNumber)).toEqual([1, 3]); // a@1, b@0+3
    expect(merged.insights.crashes.map((c) => c.text)).toEqual(['boom', 'oops']);
  });

  it('merges components by name (summed counts, earliest rebased sample line)', () => {
    const net = merged.insights.topFailingComponents.find((c) => c.name === 'net')!;
    expect(net.errorCount).toBe(9);       // 5 + 4
    expect(net.warningCount).toBe(3);     // 1 + 2
    expect(net.sampleLine).toBe(2);       // min(2, 1+3) = 2
    // sorted by error volume: net (9) before db (1)
    expect(merged.insights.topFailingComponents.map((c) => c.name)).toEqual(['net', 'db']);
  });

  it('spans first member start to last member end, dedupes suggestions by id', () => {
    expect(merged.timeRange).toEqual({ start: '10:00', end: '10:09' });
    expect(merged.insights.filterSuggestions.map((s) => s.id)).toEqual(['s1']);
    expect(merged.analyzerName).toBe('session');
    expect(merged.analyzedAt).toBe(999);
    expect(merged.density).toBeUndefined();
  });

  it('caps merged components at the top 5 by error volume', () => {
    const many = part({
      components: Array.from({ length: 8 }, (_, i) => ({
        name: `c${i}`, errorCount: i, warningCount: 0, sampleLine: 0,
      })),
    });
    const m = mergeAnalysisResults([many], [0], 'session', 0);
    expect(m.insights.topFailingComponents).toHaveLength(5);
    expect(m.insights.topFailingComponents[0].name).toBe('c7'); // highest error count first
  });
});
