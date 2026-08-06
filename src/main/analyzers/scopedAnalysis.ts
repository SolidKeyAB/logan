// Scoped analysis — run the analyzer over a subset of the log (a resolved scope)
// instead of the whole file. Reuses the shared AnalysisAccumulator so a scoped
// analysis and a whole-file analysis classify lines identically. Lines are pulled
// through the same index→getLines(ln,1) seam the EXTRACT primitive uses.

import { AnalysisResult } from './types';
import { ResolvedScope } from '../../shared/types';
import { AnalysisAccumulator, ColumnInfo } from './lineClassify';

// Minimal reader — the real FileHandler.getLines(startLine, count) satisfies this.
// Line numbers are 0-based; each returned entry carries the line text.
export interface ScopeLineReader {
  getLines(startLine: number, count: number): Array<{ text: string }>;
}

const READ_BATCH = 5000;

export function analyzeScope(
  reader: ScopeLineReader,
  resolved: ResolvedScope,
  columns: ColumnInfo[] = [],
  analyzerName = 'column-aware-scoped',
): AnalysisResult {
  const acc = new AnalysisAccumulator(columns);
  let count = 0;

  if (resolved.kind === 'range') {
    for (let start = resolved.startLine; start <= resolved.endLine; start += READ_BATCH) {
      const want = Math.min(READ_BATCH, resolved.endLine - start + 1);
      const lines = reader.getLines(start, want);
      for (let i = 0; i < lines.length; i++) {
        // Real 1-based viewer line for crash navigation.
        acc.feed(lines[i].text, start + i + 1);
        count++;
      }
    }
  } else {
    // Explicit, possibly discontiguous line-set. Collapse consecutive runs into
    // batched reads so we don't do one syscall per line for dense sets.
    const lines = resolved.lines;
    let i = 0;
    while (i < lines.length) {
      let runEnd = i;
      while (runEnd + 1 < lines.length && lines[runEnd + 1] === lines[runEnd] + 1) runEnd++;
      const runStart = lines[i];
      const runLen = runEnd - i + 1;
      const batch = reader.getLines(runStart, runLen);
      for (let j = 0; j < batch.length; j++) {
        acc.feed(batch[j].text, runStart + j + 1);
        count++;
      }
      i = runEnd + 1;
    }
  }

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
