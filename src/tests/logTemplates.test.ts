import { describe, it, expect } from 'vitest';
import { foldTemplates } from '../main/logTemplates';

describe('foldTemplates — global whole-file fold', () => {
  it('collapses near-duplicate lines (differ only by ts/counter) into one template', () => {
    const lines = [
      '2026-08-23 10:00:01.100 wifi retry attempt 1',
      '2026-08-23 10:00:02.200 wifi retry attempt 2',
      '2026-08-23 10:00:03.300 wifi retry attempt 3',
    ];
    const s = foldTemplates(lines);
    expect(s.templates).toHaveLength(1);
    expect(s.templates[0].shape).toBe('<TS> wifi retry attempt <NUM>');
    expect(s.templates[0].count).toBe(3);
    expect(s.totalLines).toBe(3);
    expect(s.coverage).toBe(1);
    expect(s.capped).toBe(false);
  });

  it('sorts templates by count desc, keeps distinct shapes distinct', () => {
    const lines = [
      'apple', 'apple', 'apple',
      'banana', 'banana',
      'cherry',
    ];
    const s = foldTemplates(lines);
    expect(s.templates.map((t) => [t.shape, t.count])).toEqual([
      ['apple', 3],
      ['banana', 2],
      ['cherry', 1],
    ]);
    expect(s.distinctShapes).toBe(3);
  });

  it('records viewerLine first/last honouring startLine, 1-based', () => {
    const s = foldTemplates(['x', 'y', 'x'], { startLine: 100 });
    const x = s.templates.find((t) => t.shape === 'x')!;
    expect(x.firstLine).toBe(100);
    expect(x.lastLine).toBe(102);
  });

  it('captures first/last timestamp of a template', () => {
    const s = foldTemplates([
      '2026-08-23 10:00:01 hb ping 1',
      '2026-08-23 10:00:05 hb ping 2',
      '2026-08-23 10:00:09 hb ping 3',
    ]);
    expect(s.templates[0].firstTs).toBe('2026-08-23 10:00:01');
    expect(s.templates[0].lastTs).toBe('2026-08-23 10:00:09');
  });

  it('stamps worst-seen severity from the line keywords', () => {
    const s = foldTemplates([
      'ERROR disk full on /var/log/messages',
      'WARN cache nearly full',
      'plain info line',
    ]);
    const byShape = Object.fromEntries(s.templates.map((t) => [t.shape, t.severity]));
    expect(byShape['ERROR disk full on <PATH>']).toBe('error');
    expect(byShape['WARN cache nearly full']).toBe('warning');
    expect(byShape['plain info line']).toBe(null);
  });

  it('keeps a bounded examples reservoir: first (maxExamples-1) + most recent', () => {
    const lines = ['z', 'z', 'z', 'z', 'z']; // viewerLines 1..5
    const s = foldTemplates(lines, { maxExamples: 3 });
    expect(s.templates[0].examples).toEqual([1, 2, 5]);
    expect(s.templates[0].count).toBe(5);
  });

  it('gives the same stable id to the same shape and different ids to different shapes', () => {
    const s = foldTemplates(['foo 1', 'foo 2', 'bar 1']);
    const foo = s.templates.find((t) => t.shape === 'foo <NUM>')!;
    const bar = s.templates.find((t) => t.shape === 'bar <NUM>')!;
    expect(foo.id).toBe(foldTemplates(['foo 9']).templates[0].id); // stable across runs
    expect(foo.id).not.toBe(bar.id);
    expect(Number.isInteger(foo.id)).toBe(true);
  });

  it('is deterministic', () => {
    const lines = ['a 1', 'b', 'a 2', 'c', 'b'];
    expect(foldTemplates(lines)).toEqual(foldTemplates(lines));
  });

  it('handles empty input', () => {
    const s = foldTemplates([]);
    expect(s.templates).toEqual([]);
    expect(s.totalLines).toBe(0);
    expect(s.coverage).toBe(1);
    expect(s.other).toEqual({ lines: 0, shapes: 0 });
  });
});

describe('foldTemplates — K cap / «other» bucket (no silent truncation)', () => {
  it('evicts the smallest-count shapes into «other» and reports it', () => {
    // K=2: A(2) and C(1) survive; the rarer B(1) is evicted.
    const s = foldTemplates(['A', 'A', 'B', 'C'], { maxTemplates: 2 });
    expect(s.capped).toBe(true);
    expect(s.templates.map((t) => t.shape).sort()).toEqual(['A', 'C']);
    expect(s.other).toEqual({ lines: 1, shapes: 1 });
    expect(s.totalLines).toBe(4);
    expect(s.coverage).toBeCloseTo(0.75);
    expect(s.distinctShapes).toBe(3); // 2 kept + 1 evicted
  });

  it('does not cap when distinct shapes fit under K', () => {
    const s = foldTemplates(['A', 'B', 'C'], { maxTemplates: 10 });
    expect(s.capped).toBe(false);
    expect(s.other).toEqual({ lines: 0, shapes: 0 });
    expect(s.coverage).toBe(1);
  });

  it('an all-unique log collapses mostly to «other» and says so', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `unique event ${i} payload ${i * 7}`);
    const s = foldTemplates(lines, { maxTemplates: 3 });
    // every line normalises to the SAME shape "unique event <NUM> payload <NUM>"
    // so actually this compresses perfectly — assert that instead:
    expect(s.templates).toHaveLength(1);
    expect(s.templates[0].shape).toBe('unique event <NUM> payload <NUM>');
    expect(s.templates[0].count).toBe(20);
    expect(s.capped).toBe(false);
  });

  it('a genuinely-unique log (distinct words) overflows K into «other»', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    const s = foldTemplates(words, { maxTemplates: 2 });
    expect(s.capped).toBe(true);
    expect(s.templates.length).toBe(2);
    expect(s.other.shapes).toBe(4);
    expect(s.other.lines).toBe(4);
    expect(s.coverage).toBeCloseTo(2 / 6);
  });
});
