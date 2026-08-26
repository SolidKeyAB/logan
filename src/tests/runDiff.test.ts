import { describe, it, expect } from 'vitest';
import { diffRuns } from '../main/runDiff';
import { foldTemplates, type LogTemplate, type TemplateSummary } from '../main/logTemplates';
import type { SeverityLevel } from '../main/severityIndex';

// FNV of the shape is irrelevant to the diff (it keys by shape); use a cheap stand-in.
let idSeq = 1;
function tmpl(shape: string, count: number, severity: SeverityLevel | null = null, examples: number[] = [1]): LogTemplate {
  return { id: idSeq++, shape, count, firstLine: examples[0] ?? 1, lastLine: examples[examples.length - 1] ?? 1, severity, examples };
}

function summary(templates: LogTemplate[], extra: Partial<TemplateSummary> = {}): TemplateSummary {
  const totalLines = templates.reduce((a, t) => a + t.count, 0);
  return {
    templates,
    other: { lines: 0, shapes: 0 },
    totalLines,
    distinctShapes: templates.length,
    coverage: 1,
    capped: false,
    ...extra,
  };
}

describe('diffRuns', () => {
  it('surfaces templates only in the target (the headline)', () => {
    const ref = summary([tmpl('boot ok', 10), tmpl('heartbeat', 100)]);
    const tgt = summary([tmpl('boot ok', 10), tmpl('heartbeat', 100), tmpl('NPE at Foo', 5, 'error')]);
    const d = diffRuns(ref, tgt);
    expect(d.onlyInTarget.map(t => t.shape)).toEqual(['NPE at Foo']);
    expect(d.onlyInTarget[0].referenceCount).toBe(0);
    expect(d.onlyInTarget[0].targetCount).toBe(5);
    expect(d.onlyInTarget[0].factor).toBeNull();
    expect(d.onlyInReference).toEqual([]);
    expect(d.summary.onlyInTarget).toBe(1);
  });

  it('surfaces templates dropped from the target', () => {
    const ref = summary([tmpl('legacy handshake', 8), tmpl('heartbeat', 100)]);
    const tgt = summary([tmpl('heartbeat', 100)]);
    const d = diffRuns(ref, tgt);
    expect(d.onlyInReference.map(t => t.shape)).toEqual(['legacy handshake']);
    expect(d.onlyInReference[0].targetCount).toBe(0);
    expect(d.onlyInReference[0].factor).toBe(0);
  });

  it('flags a shared template whose frequency shifted past changeFactor', () => {
    const ref = summary([tmpl('retry connect', 2)]);
    const tgt = summary([tmpl('retry connect', 20)]);
    const d = diffRuns(ref, tgt, { changeFactor: 3 });
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].shape).toBe('retry connect');
    expect(d.changed[0].factor).toBe(10);
    expect(d.changed[0].delta).toBe(18);
    expect(d.unchanged).toBe(0);
  });

  it('treats a shared template within tolerance as unchanged', () => {
    const ref = summary([tmpl('heartbeat', 100)]);
    const tgt = summary([tmpl('heartbeat', 120)]); // 1.2× < 3×
    const d = diffRuns(ref, tgt, { changeFactor: 3 });
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(1);
  });

  it('detects a big DROP in a shared template (≤ 1/changeFactor)', () => {
    const ref = summary([tmpl('processing frame', 100)]);
    const tgt = summary([tmpl('processing frame', 10)]); // 0.1× ≤ 1/3
    const d = diffRuns(ref, tgt, { changeFactor: 3 });
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].delta).toBe(-90);
  });

  it('applies the minCount noise floor', () => {
    const ref = summary([tmpl('common', 50)]);
    const tgt = summary([tmpl('common', 50), tmpl('rare blip', 2, 'warning')]);
    expect(diffRuns(ref, tgt, { minCount: 5 }).onlyInTarget).toEqual([]);
    expect(diffRuns(ref, tgt, { minCount: 2 }).onlyInTarget.map(t => t.shape)).toEqual(['rare blip']);
  });

  it('sorts onlyInTarget by severity first, then count', () => {
    const ref = summary([tmpl('base', 1)]);
    const tgt = summary([
      tmpl('base', 1),
      tmpl('noisy info', 500, null),
      tmpl('one fatal', 1, 'fatal'),
      tmpl('some errors', 10, 'error'),
    ]);
    const d = diffRuns(ref, tgt);
    expect(d.onlyInTarget.map(t => t.shape)).toEqual(['one fatal', 'some errors', 'noisy info']);
  });

  it('caps each bucket at topN but reports full totals in summary/caps', () => {
    const refT = Array.from({ length: 10 }, (_, i) => tmpl(`ref-${i}`, 5));
    const tgtT = Array.from({ length: 10 }, (_, i) => tmpl(`tgt-${i}`, 5));
    const d = diffRuns(summary(refT), summary(tgtT), { topN: 3 });
    expect(d.onlyInTarget).toHaveLength(3);
    expect(d.onlyInReference).toHaveLength(3);
    expect(d.summary.onlyInTarget).toBe(10);
    expect(d.summary.onlyInReference).toBe(10);
    expect(d.caps.shown.onlyInTarget).toBe(3);
    expect(d.caps.total.onlyInTarget).toBe(10);
  });

  it('propagates the capped flag and warns in the note', () => {
    const d = diffRuns(summary([tmpl('a', 1)], { capped: true }), summary([tmpl('a', 1)]));
    expect(d.caps.referenceCapped).toBe(true);
    expect(d.caps.note).toContain('template cap');
  });

  it('carries example viewerLines for both sides of a changed template', () => {
    const ref = summary([tmpl('x', 2, null, [10, 11])]);
    const tgt = summary([tmpl('x', 20, null, [500, 900])]);
    const d = diffRuns(ref, tgt, { changeFactor: 3 });
    expect(d.changed[0].referenceExamples).toEqual([10, 11]);
    expect(d.changed[0].targetExamples).toEqual([500, 900]);
  });

  it('identical runs → all unchanged, empty buckets', () => {
    const a = () => summary([tmpl('x', 5), tmpl('y', 9)]);
    const d = diffRuns(a(), a());
    expect(d.onlyInTarget).toEqual([]);
    expect(d.onlyInReference).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(2);
  });
});

// End-to-end: fold two REAL line sets (differing only by timestamps/counters) into
// templates and diff them — proves normalizeShape produces run-comparable shapes so the
// diff keys line up across runs, and that a genuinely new error surfaces in onlyInTarget.
describe('diffRuns over foldTemplates (integration)', () => {
  const goodRun = [
    '2026-08-26 10:00:01 INFO  boot sequence started',
    '2026-08-26 10:00:02 INFO  heartbeat seq=1',
    '2026-08-26 10:00:03 INFO  heartbeat seq=2',
    '2026-08-26 10:00:04 INFO  heartbeat seq=3',
    '2026-08-26 10:00:05 INFO  shutdown clean',
  ];
  // Same shapes but different timestamps/counters, PLUS a new error and extra heartbeats.
  const failingRun = [
    '2026-08-26 11:30:01 INFO  boot sequence started',
    '2026-08-26 11:30:02 INFO  heartbeat seq=17',
    '2026-08-26 11:30:03 INFO  heartbeat seq=18',
    '2026-08-26 11:30:04 INFO  heartbeat seq=19',
    '2026-08-26 11:30:05 INFO  heartbeat seq=20',
    '2026-08-26 11:30:06 INFO  heartbeat seq=21',
    '2026-08-26 11:30:07 ERROR NullPointerException in FrameDecoder',
  ];

  it('collapses timestamp/counter noise and surfaces the new error', () => {
    const ref = foldTemplates(goodRun);
    const tgt = foldTemplates(failingRun);
    const d = diffRuns(ref, tgt, { changeFactor: 1.5 });

    // The NPE line is new to the failing run.
    const newShapes = d.onlyInTarget.map(t => t.shape);
    expect(newShapes.some(s => s.includes('NullPointerException'))).toBe(true);
    expect(d.onlyInTarget.find(t => t.shape.includes('NullPointerException'))!.severity).toBe('error');

    // 'shutdown clean' vanished from the failing run.
    expect(d.onlyInReference.some(t => t.shape.includes('shutdown clean'))).toBe(true);

    // heartbeat is the SAME shape in both (seq counter masked) but fired more → changed, not new.
    const hb = [...d.changed, ...d.onlyInTarget].find(t => t.shape.includes('heartbeat'));
    expect(hb).toBeDefined();
    expect(d.onlyInTarget.some(t => t.shape.includes('heartbeat'))).toBe(false); // not "new"
  });
});
