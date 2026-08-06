// Scoped analysis — run the analyzer over a subset of the log (a resolved scope)
// instead of the whole file. Reuses the shared AnalysisAccumulator so a scoped
// analysis and a whole-file analysis classify lines identically, and the shared
// forEachScopeLine iterator so it walks lines through the same index→getLines
// seam every other scoped verb uses.

import { AnalysisResult } from './types';
import { ResolvedScope } from '../../shared/types';
import { AnalysisAccumulator, ColumnInfo } from './lineClassify';
import { forEachScopeLine, ScopeTextReader } from '../scope';

// Re-exported for callers/tests that construct a reader for analyzeScope.
export type { ScopeTextReader as ScopeLineReader };

export function analyzeScope(
  reader: ScopeTextReader,
  resolved: ResolvedScope,
  columns: ColumnInfo[] = [],
  analyzerName = 'column-aware-scoped',
): AnalysisResult {
  const acc = new AnalysisAccumulator(columns);
  let count = 0;

  forEachScopeLine(reader, resolved, (text, lineNumber) => {
    // Real 1-based viewer line for crash navigation.
    acc.feed(text, lineNumber + 1);
    count++;
  });

  return {
    stats: { totalLines: count, analyzedLines: count },
    levelCounts: acc.levelCounts,
    timeRange: acc.firstTimestamp && acc.lastTimestamp
      ? { start: acc.firstTimestamp, end: acc.lastTimestamp }
      : undefined,
    analyzerName,
    analyzedAt: Date.now(),
    insights: acc.buildInsights(count),
  };
}
