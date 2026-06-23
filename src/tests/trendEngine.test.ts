import { describe, it, expect } from 'vitest';
import {
  extractFields,
  classifyValue,
  discoverFields,
  extractSeries,
  detectTransitions,
  correlate,
} from '../main/trendEngine';

// Minimal stand-in for FileHandler: getLines(start, count) + getTotalLines().
// Lines are 0-based; each line's timestamp is encoded in the text.
function fakeHandler(lines: string[]) {
  return {
    getTotalLines: () => lines.length,
    getLines: (start: number, count: number) =>
      lines.slice(start, start + count).map((text, i) => ({
        lineNumber: start + i,
        text,
        level: undefined,
      })),
  } as any;
}

// matches parseTimestampFast()'s shape; pulls an ISO timestamp out of the line
const parseTs = (text: string) => {
  const m = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [str, y, mo, d, h, mi, s] = m;
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), str };
};

describe('extractFields', () => {
  it('pulls key=value pairs of mixed types', () => {
    const f = extractFields('connecting v=2.1 ok=true name="alpha beta" tags=[a,b]');
    expect(f.get('v')).toBe('2.1');
    expect(f.get('ok')).toBe('true');
    expect(f.get('name')).toBe('alpha beta'); // quotes stripped
    expect(f.get('tags')).toBe('[a,b]');
  });

  it('pulls key: value pairs but not bare clock times', () => {
    const f = extractFields('2024-01-01 12:34:56 latency: 230 mode: idle');
    expect(f.get('latency')).toBe('230');
    expect(f.get('mode')).toBe('idle');
    // a bare "12:34:56" must NOT become a field named "12"
    expect(f.has('12')).toBe(false);
  });

  it('flattens a JSON object line', () => {
    const f = extractFields('{"level":"error","code":500,"ok":false}');
    expect(f.get('level')).toBe('error');
    expect(f.get('code')).toBe('500');
    expect(f.get('ok')).toBe('false');
  });
});

describe('classifyValue', () => {
  it('classifies primitive shapes', () => {
    expect(classifyValue('2.1')).toBe('numeric');
    expect(classifyValue('-5')).toBe('numeric');
    expect(classifyValue('true')).toBe('boolean');
    expect(classifyValue('[a,b]')).toBe('array');
    expect(classifyValue('idle')).toBe('string');
  });
});

describe('discoverFields', () => {
  it('reports fields with inferred type and frequency', () => {
    const h = fakeHandler([
      'v=1 mode=idle',
      'v=2 mode=active',
      'v=3 mode=active',
    ]);
    const fields = discoverFields(h, { sampleSize: 100 });
    const v = fields.find((f) => f.name === 'v');
    const mode = fields.find((f) => f.name === 'mode');
    expect(v?.type).toBe('numeric');
    expect(v?.occurrences).toBe(3);
    expect(mode?.type).toBe('string');
    expect(mode?.distinct).toBe(2); // idle, active
  });
});

describe('extractSeries', () => {
  it('buckets a numeric field over time with aggregates', () => {
    const h = fakeHandler([
      '2024-01-01 00:00:00 v=10',
      '2024-01-01 00:00:30 v=20',
      '2024-01-01 01:00:00 v=100',
    ]);
    const s = extractSeries(h, parseTs, 'v', { bucketCount: 10 });
    expect(s.type).toBe('numeric');
    expect(s.totalPoints).toBe(3);
    expect(s.withTimestamp).toBe(3);
    const filled = s.buckets.filter((b) => b.count > 0);
    // two early points land in the first bucket, the late one in the last
    expect(filled.length).toBe(2);
    const last = s.buckets[s.buckets.length - 1];
    expect(last.max).toBe(100);
  });

  it('handles a categorical field with per-bucket value counts', () => {
    // identical timestamps → all land in the first bucket
    const h = fakeHandler([
      '2024-01-01 00:00:00 mode=idle',
      '2024-01-01 00:00:00 mode=idle',
      '2024-01-01 00:00:00 mode=active',
    ]);
    const s = extractSeries(h, parseTs, 'mode', { bucketCount: 10 });
    expect(s.type).toBe('string');
    expect(s.buckets[0].values).toEqual({ idle: 2, active: 1 });
  });
});

describe('detectTransitions', () => {
  it('flags every value change, not every occurrence', () => {
    const h = fakeHandler([
      '2024-01-01 00:00:00 mode=idle',
      '2024-01-01 00:00:01 mode=idle',
      '2024-01-01 00:00:02 mode=active',
      '2024-01-01 00:00:03 mode=error',
      '2024-01-01 00:00:04 mode=error',
    ]);
    const r = detectTransitions(h, parseTs, 'mode');
    expect(r.totalTransitions).toBe(2); // idle→active, active→error
    expect(r.transitions[0]).toMatchObject({ fromValue: 'idle', toValue: 'active', viewerLine: 3 });
    expect(r.transitions[1]).toMatchObject({ fromValue: 'active', toValue: 'error', viewerLine: 4 });
  });
});

describe('regex pattern mode (advanced users)', () => {
  it('extracts an unlabeled positional value via a capture group', () => {
    const h = fakeHandler([
      '2024-01-01 00:00:00 connected to host in 230ms',
      '2024-01-01 00:00:01 connected to host in 410ms',
    ]);
    const s = extractSeries(h, parseTs, 'latency', { pattern: 'in (\\d+)ms', bucketCount: 10 });
    expect(s.type).toBe('numeric');
    expect(s.totalPoints).toBe(2);
    expect(s.points.map((p) => p.num)).toEqual([230, 410]);
  });

  it('flags transitions on a regex-extracted value', () => {
    const h = fakeHandler([
      'state=[RUNNING]',
      'state=[RUNNING]',
      'state=[STOPPED]',
    ]);
    const r = detectTransitions(h, parseTs, 'state', { pattern: 'state=\\[(\\w+)\\]' });
    expect(r.totalTransitions).toBe(1);
    expect(r.transitions[0]).toMatchObject({ fromValue: 'RUNNING', toValue: 'STOPPED' });
  });
});

describe('correlate', () => {
  it('cross-tabs a numeric field by event presence', () => {
    const h = fakeHandler([
      'thrown eventX v=2.1',
      'thrown eventX v=2.0',
      'quiet v=3.5',
      'quiet v=6.0',
    ]);
    const r = correlate(h, 'v', 'eventX');
    expect(r.fieldType).toBe('numeric');
    expect(r.matchedLines).toBe(2);
    expect(r.unmatchedLines).toBe(2);
    expect(r.numericStats?.matched?.max).toBeCloseTo(2.1);
    expect(r.numericStats?.unmatched?.min).toBeCloseTo(3.5);
  });
});
