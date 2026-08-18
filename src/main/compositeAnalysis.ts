// Merge per-member AnalysisResults into one result for a "single session" composite.
//
// Analyze reads a raw file PATH (analyzer.analyze(path)), so it can't route through the
// composite handler like reads/search do. Instead we analyze each member file on its own
// and fold the results together here, rebasing every line reference (crashes, component
// sample lines) from the member's local line space into the composite's global line space
// by adding the member's startLine. Pure + dependency-free so it's unit-testable headlessly.

import type { AnalysisResult, CrashEntry, FailingComponent, FilterSuggestion } from './analyzers';

// The analyzer keeps only the top 5 failing components (see lineClassify.ts); match that
// so a merged composite result looks the same shape as a single-file one.
const TOP_FAILING_LIMIT = 5;

export function mergeAnalysisResults(
  parts: AnalysisResult[],
  startLines: number[],
  analyzerName: string,
  analyzedAt: number,
): AnalysisResult {
  const levelCounts: Record<string, number> = {};
  let totalLines = 0;
  let analyzedLines = 0;
  const crashes: CrashEntry[] = [];
  // Merge components by name: sum counts, keep the earliest (rebased) sample line.
  const components = new Map<string, FailingComponent>();
  // Dedup filter suggestions by id — the same heuristic fires per file but means one thing.
  const suggestions = new Map<string, FilterSuggestion>();
  let start: string | undefined;
  let end: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    const r = parts[i];
    const base = startLines[i] ?? 0;

    totalLines += r.stats.totalLines;
    analyzedLines += r.stats.analyzedLines;

    for (const [level, n] of Object.entries(r.levelCounts)) {
      levelCounts[level] = (levelCounts[level] || 0) + n;
    }

    for (const c of r.insights.crashes) {
      crashes.push({ ...c, lineNumber: c.lineNumber + base });
    }

    for (const comp of r.insights.topFailingComponents) {
      const rebasedSample = comp.sampleLine + base;
      const existing = components.get(comp.name);
      if (existing) {
        existing.errorCount += comp.errorCount;
        existing.warningCount += comp.warningCount;
        existing.sampleLine = Math.min(existing.sampleLine, rebasedSample);
      } else {
        components.set(comp.name, { ...comp, sampleLine: rebasedSample });
      }
    }

    for (const s of r.insights.filterSuggestions) {
      if (!suggestions.has(s.id)) suggestions.set(s.id, s);
    }

    // Members are concatenated in list order; take the first member's range start and the
    // last member's range end that are defined — the honest span of the stitched view.
    if (r.timeRange) {
      if (start === undefined) start = r.timeRange.start;
      end = r.timeRange.end;
    }
  }

  // Global ordering: crashes by line; components by error volume (then the top N kept).
  crashes.sort((a, b) => a.lineNumber - b.lineNumber);
  const topFailingComponents = Array.from(components.values())
    .sort((a, b) => b.errorCount - a.errorCount || b.warningCount - a.warningCount)
    .slice(0, TOP_FAILING_LIMIT);

  return {
    stats: { totalLines, analyzedLines },
    levelCounts,
    timeRange: start !== undefined && end !== undefined ? { start, end } : undefined,
    analyzerName,
    analyzedAt,
    insights: {
      crashes,
      topFailingComponents,
      filterSuggestions: Array.from(suggestions.values()),
    },
    // density (byte-positioned minimap heat) is intentionally omitted for a composite: each
    // member sizes its own buckets differently, so there's no faithful byte-space merge. The
    // severity-tick overlay (composite-aware, line-based) covers jump-to-problem on the map.
  };
}
