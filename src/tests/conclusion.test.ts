import { describe, it, expect } from 'vitest';
import {
  synthesizeConclusion,
  formatDuration,
  type ConclusionAnalysis,
  type ConclusionCrash,
  type ConclusionComponent,
  type ConclusionGap,
  type ConclusionAnnotation,
} from '../main/conclusion';

interface AnalysisSpec {
  levelCounts?: Record<string, number>;
  crashes?: ConclusionCrash[];
  topFailingComponents?: ConclusionComponent[];
}

// A minimal synthetic analysis; each test overrides the fields it cares about.
function makeAnalysis(spec: AnalysisSpec = {}): ConclusionAnalysis {
  return {
    stats: { totalLines: 1000, analyzedLines: 1000 },
    levelCounts: spec.levelCounts ?? {},
    insights: {
      crashes: spec.crashes ?? [],
      topFailingComponents: spec.topFailingComponents ?? [],
    },
  };
}

const OPTS = { sourceFilePath: '/tmp/logs/app.log', totalLinesFallback: 1000 };

describe('formatDuration', () => {
  it('formats sub-minute, minute, and hour durations', () => {
    expect(formatDuration(5)).toBe('5s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h');
  });
});

describe('synthesizeConclusion', () => {
  it('derives fileName from the source path and carries totalLines through', () => {
    const r = synthesizeConclusion(makeAnalysis(), [], [], OPTS);
    expect(r.fileName).toBe('app.log');
    expect(r.sourceFilePath).toBe('/tmp/logs/app.log');
    expect(r.totalLines).toBe(1000);
  });

  it('reports a CLEAN verdict when nothing is wrong', () => {
    const r = synthesizeConclusion(makeAnalysis({ levelCounts: { info: 500, debug: 500 } }), [], [], OPTS);
    expect(r.verdict.kind).toBe('clean');
    expect(r.verdict.severity).toBe('info');
    expect(r.firstAnomaly).toBeNull();
    expect(r.rootCause).toBeNull();
    expect(r.timeline).toHaveLength(0);
  });

  it('flags a CRASH as the root cause and picks an earlier anomaly as the trigger', () => {
    const analysis = makeAnalysis({
      levelCounts: { error: 3, fatal: 1 },
      crashes: [{ text: 'segfault in worker', lineNumber: 800, keyword: 'segfault', channel: 'worker' }],
      topFailingComponents: [{ name: 'net', errorCount: 3, warningCount: 0, sampleLine: 200 }],
    });
    const r = synthesizeConclusion(analysis, [], [], OPTS);

    expect(r.verdict.kind).toBe('crash');
    expect(r.verdict.severity).toBe('error');
    // rootCause = first crash (0-based line 800 → shown as 801)
    expect(r.rootCause).not.toBeNull();
    expect(r.rootCause!.kind).toBe('crash');
    expect(r.rootCause!.lineNumber).toBe(800);
    expect(r.verdict.headline).toContain('801');
    // firstAnomaly = earliest error/warning event = the component error at line 200
    expect(r.firstAnomaly).not.toBeNull();
    expect(r.firstAnomaly!.lineNumber).toBe(200);
    // verdict mentions the earlier trigger (line 201, 1-based)
    expect(r.verdict.detail).toContain('201');
    // timeline is chronological (line-number ascending)
    const lines = r.timeline.map(e => e.lineNumber);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
  });

  it('reports an ERROR-STORM when a component has many errors but no crash', () => {
    const analysis = makeAnalysis({
      levelCounts: { error: 50 },
      topFailingComponents: [{ name: 'db', errorCount: 42, warningCount: 3, sampleLine: 120 }],
    });
    const r = synthesizeConclusion(analysis, [], [], OPTS);
    expect(r.verdict.kind).toBe('error-storm');
    expect(r.verdict.headline).toContain('db');
    expect(r.rootCause).not.toBeNull();
    expect(r.rootCause!.kind).toBe('error');
    expect(r.rootCause!.lineNumber).toBe(120);
  });

  it('reports a STALL when the biggest gap dominates and there is no crash/error-storm', () => {
    const gaps: ConclusionGap[] = [
      { lineNumber: 400, gapSeconds: 45, prevTimestamp: '00:01:00', currTimestamp: '00:01:45', linePreview: 'resumed' },
      { lineNumber: 100, gapSeconds: 12, prevTimestamp: '00:00:10', currTimestamp: '00:00:22', linePreview: 'blip' },
    ];
    const r = synthesizeConclusion(makeAnalysis({ levelCounts: {} }), gaps, [], OPTS);
    expect(r.verdict.kind).toBe('stall');
    expect(r.verdict.severity).toBe('warning');
    expect(r.rootCause).not.toBeNull();
    expect(r.rootCause!.kind).toBe('gap');
    expect(r.rootCause!.lineNumber).toBe(400);
    // 45s gap is >= 60? No → severity info on the event, but a 45s gap still >= 30 triggers stall verdict.
    expect(r.verdict.headline).toContain('45s');
  });

  it('reports a WARNINGS verdict when there are minor errors/warnings but no crash/storm/stall', () => {
    const r = synthesizeConclusion(makeAnalysis({ levelCounts: { error: 2, warning: 5 } }), [], [], OPTS);
    expect(r.verdict.kind).toBe('warnings');
    expect(r.verdict.severity).toBe('warning');
    expect(r.verdict.headline).toContain('2 errors');
    expect(r.verdict.headline).toContain('5 warnings');
  });

  it('includes pinned annotations as findings in the timeline', () => {
    const annotations: ConclusionAnnotation[] = [
      { lineNumber: 50, severity: 'error', text: 'suspicious retry' },
      { lineNumber: 999, severity: 'info', title: 'end of file' },
    ];
    const r = synthesizeConclusion(makeAnalysis({ levelCounts: {} }), [], annotations, OPTS);
    const findings = r.timeline.filter(e => e.kind === 'finding');
    expect(findings).toHaveLength(2);
    expect(findings[0].label).toContain('suspicious retry');
    // an error-severity annotation becomes the first anomaly / trigger
    expect(r.firstAnomaly).not.toBeNull();
    expect(r.firstAnomaly!.lineNumber).toBe(50);
  });

  it('caps the timeline at 40 events and top components at 5', () => {
    const crashes = Array.from({ length: 60 }, (_, i) => ({
      text: `crash ${i}`, lineNumber: i * 10, keyword: 'panic',
    }));
    const comps = Array.from({ length: 12 }, (_, i) => ({
      name: `c${i}`, errorCount: 1, warningCount: 0, sampleLine: 1000 + i,
    }));
    const analysis = makeAnalysis({ levelCounts: { error: 60 }, crashes, topFailingComponents: comps });
    const r = synthesizeConclusion(analysis, [], [], OPTS);
    expect(r.timeline.length).toBe(40);
    expect(r.topComponents.length).toBe(5);
  });

  it('handles a null analysis without throwing (uses fallback line count)', () => {
    const r = synthesizeConclusion(null, [], [], { sourceFilePath: null, totalLinesFallback: 7 });
    expect(r.fileName).toBe('log');
    expect(r.sourceFilePath).toBeNull();
    expect(r.totalLines).toBe(7);
    expect(r.verdict.kind).toBe('clean');
  });
});
