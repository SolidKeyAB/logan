import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeScope, ScopeLineReader } from '../main/analyzers/scopedAnalysis';
import { ColumnAwareAnalyzer } from '../main/analyzers/columnAwareAnalyzer';
import { resolveScope, ScopeResolverContext } from '../main/scope';

// A fake reader backed by an in-memory array of line texts. Mirrors
// FileHandler.getLines(startLine, count) — 0-based, returns { text }.
function reader(lines: string[]): ScopeLineReader {
  return {
    getLines: (start: number, count: number) =>
      lines.slice(start, start + count).map(text => ({ text })),
  };
}

function ctx(total: number, filtered?: number[]): ScopeResolverContext {
  return { getTotalLines: () => total, getFilteredLines: () => filtered ?? null };
}

const SAMPLE = [
  '2024-01-01 10:00:00 INFO Server started',
  '2024-01-01 10:00:01 ERROR Connection failed',
  '2024-01-01 10:00:02 WARN Low disk space',
  '2024-01-01 10:00:03 FATAL panic in module',
  '2024-01-01 10:00:04 INFO Recovered',
  '2024-01-01 10:00:05 ERROR Timeout waiting',
];

describe('analyzeScope', () => {
  it('range over the whole file counts every level', () => {
    const r = analyzeScope(reader(SAMPLE), resolveScope(ctx(SAMPLE.length), { type: 'all' }));
    expect(r.levelCounts.info).toBe(2);
    expect(r.levelCounts.error).toBe(2);
    expect(r.levelCounts.warning).toBe(1);
    expect(r.levelCounts.fatal).toBe(1);
    expect(r.stats.totalLines).toBe(6);
  });

  it('range subset only counts lines in scope', () => {
    // lines 3..5 (0-based) = WARN, FATAL, INFO
    const r = analyzeScope(reader(SAMPLE), resolveScope(ctx(SAMPLE.length), { type: 'range', start: 2, end: 3 }));
    expect(r.stats.totalLines).toBe(2);
    expect(r.levelCounts.warning).toBe(1);
    expect(r.levelCounts.fatal).toBe(1);
    expect(r.levelCounts.info).toBe(0);
    expect(r.levelCounts.error).toBe(0);
  });

  it('discontiguous indices scope counts exactly those lines', () => {
    // pick the two ERROR lines (indices 1 and 5)
    const r = analyzeScope(reader(SAMPLE), resolveScope(ctx(SAMPLE.length), { type: 'indices', lines: [1, 5] }));
    expect(r.stats.totalLines).toBe(2);
    expect(r.levelCounts.error).toBe(2);
    expect(r.levelCounts.info).toBe(0);
  });

  it('resolves crash line numbers to real 1-based viewer lines', () => {
    const r = analyzeScope(reader(SAMPLE), resolveScope(ctx(SAMPLE.length), { type: 'all' }));
    expect(r.insights.crashes.length).toBe(1);
    // FATAL is index 3 → viewer line 4
    expect(r.insights.crashes[0].lineNumber).toBe(4);
    expect(r.insights.crashes[0].keyword).toBe('fatal');
  });

  it('reports a timestamp span within scope', () => {
    const r = analyzeScope(reader(SAMPLE), resolveScope(ctx(SAMPLE.length), { type: 'range', start: 1, end: 3 }));
    expect(r.timeRange?.start).toContain('10:00:01');
    expect(r.timeRange?.end).toContain('10:00:03');
  });

  it('empty scope yields zero counts', () => {
    const r = analyzeScope(reader(SAMPLE), resolveScope(ctx(SAMPLE.length, []), { type: 'filter' }));
    expect(r.stats.totalLines).toBe(0);
    expect(r.insights.crashes.length).toBe(0);
  });

  it('a filtered index-set matches a whole-file analysis of just those lines', () => {
    const errorsOnly = resolveScope(ctx(SAMPLE.length, [1, 5]), { type: 'filter' });
    const scoped = analyzeScope(reader(SAMPLE), errorsOnly);
    const direct = analyzeScope(reader([SAMPLE[1], SAMPLE[5]]), resolveScope(ctx(2), { type: 'all' }));
    expect(scoped.levelCounts).toEqual(direct.levelCounts);
  });
});

// Guards the ColumnAwareAnalyzer refactor: the whole-file analyzer (which now
// delegates classification to the shared AnalysisAccumulator) must still produce
// the same level counts / crashes as an equivalent scoped pass.
describe('ColumnAwareAnalyzer (whole-file, post-refactor)', () => {
  it('classifies levels and crashes over a real temp file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-analyzer-'));
    const file = path.join(dir, 'sample.log');
    fs.writeFileSync(file, SAMPLE.join('\n') + '\n', 'utf-8');
    try {
      const result = await new ColumnAwareAnalyzer().analyze(file, {});
      expect(result.stats.totalLines).toBe(6);
      expect(result.levelCounts.info).toBe(2);
      expect(result.levelCounts.error).toBe(2);
      expect(result.levelCounts.warning).toBe(1);
      expect(result.levelCounts.fatal).toBe(1);
      expect(result.insights.crashes.length).toBe(1);
      expect(result.insights.crashes[0].keyword).toBe('fatal');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('whole-file counts equal a scoped analysis of the same lines', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-analyzer-'));
    const file = path.join(dir, 'sample.log');
    fs.writeFileSync(file, SAMPLE.join('\n') + '\n', 'utf-8');
    try {
      const whole = await new ColumnAwareAnalyzer().analyze(file, {});
      const scoped = analyzeScope(reader(SAMPLE), resolveScope(ctx(SAMPLE.length), { type: 'all' }));
      expect(scoped.levelCounts).toEqual(whole.levelCounts);
      expect(scoped.insights.crashes.map(c => c.keyword)).toEqual(whole.insights.crashes.map(c => c.keyword));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
