import { describe, it, expect } from 'vitest';
import { CompositeWorkerReader, LineReader } from '../main/trendWorkerReaders';
import { extractSeries, detectTransitions, discoverFields } from '../main/trendEngine';
import type { FileHandler } from '../main/fileHandler';

// In-memory LineReader over an array of lines (0-based lineNumber), standing in for a
// member's WorkerFileReader without touching the filesystem — the composite reader only
// needs getTotalLines/getLines/close.
function fakeReader(lines: string[]): LineReader {
  return {
    getTotalLines: () => lines.length,
    getLines: (start: number, count: number) =>
      lines.slice(start, start + count).map((text, i) => ({
        lineNumber: start + i,
        text,
        level: undefined as undefined,
      })),
    close: () => { /* nothing to close */ },
  };
}

const asHandler = (r: LineReader) => r as unknown as FileHandler;

const parseTs = (text: string) => {
  const m = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [str, y, mo, d, h, mi, s] = m;
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), str };
};

describe('CompositeWorkerReader', () => {
  const fileA = ['a0', 'a1', 'a2'];
  const fileB = ['b0', 'b1'];
  const fileC = ['c0', 'c1', 'c2', 'c3'];
  const all = [...fileA, ...fileB, ...fileC]; // the equivalent concatenated file

  it('presents the members as one continuous line space', () => {
    const comp = new CompositeWorkerReader([fakeReader(fileA), fakeReader(fileB), fakeReader(fileC)]);
    expect(comp.getTotalLines()).toBe(all.length); // 3 + 2 + 4
  });

  it('reads global windows that span member boundaries, rebasing line numbers', () => {
    const comp = new CompositeWorkerReader([fakeReader(fileA), fakeReader(fileB), fakeReader(fileC)]);
    // A window from line 2..6 crosses A→B→C.
    const got = comp.getLines(2, 5);
    expect(got.map((l) => l.lineNumber)).toEqual([2, 3, 4, 5, 6]);
    expect(got.map((l) => l.text)).toEqual(['a2', 'b0', 'b1', 'c0', 'c1']);
  });

  it('clamps a window that runs past the end', () => {
    const comp = new CompositeWorkerReader([fakeReader(fileA), fakeReader(fileB), fakeReader(fileC)]);
    // fileC spans global lines 5..8 (c0=5, c1=6, c2=7, c3=8); total = 9 lines.
    const got = comp.getLines(7, 10);
    expect(got.map((l) => l.text)).toEqual(['c2', 'c3']);
    expect(got.map((l) => l.lineNumber)).toEqual([7, 8]);
  });

  it('skips an empty member', () => {
    const comp = new CompositeWorkerReader([fakeReader(fileA), fakeReader([]), fakeReader(fileB)]);
    expect(comp.getTotalLines()).toBe(5);
    expect(comp.getLines(0, 5).map((l) => l.text)).toEqual(['a0', 'a1', 'a2', 'b0', 'b1']);
  });
});

// The whole point of the composite reader: the trend engine, run over it, must produce the
// SAME result as if the member files were one concatenated file — with GLOBAL line numbers.
describe('trend engine over a composite === over the concatenation', () => {
  // Two members; the field `v` continues across the boundary so a flip straddles files.
  const m1 = [
    '2024-01-01 00:00:01 v=1 lat=10',
    '2024-01-01 00:00:02 v=1 lat=12',
    '2024-01-01 00:00:03 v=2 lat=11',
  ];
  const m2 = [
    '2024-01-01 00:00:04 v=2 lat=20',
    '2024-01-01 00:00:05 v=3 lat=22',
    '2024-01-01 00:00:06 v=3 lat=19',
  ];
  const cat = [...m1, ...m2];

  const composite = () => new CompositeWorkerReader([fakeReader(m1), fakeReader(m2)]);

  it('extractSeries matches, with points in global line numbers', () => {
    const comp = extractSeries(asHandler(composite()), parseTs, 'lat', { bucketCount: 20 });
    const flat = extractSeries(asHandler(fakeReader(cat)), parseTs, 'lat', { bucketCount: 20 });
    expect(comp.totalPoints).toBe(flat.totalPoints);
    expect(comp.type).toBe(flat.type);
    expect(comp.points.map((p) => p.viewerLine)).toEqual(flat.points.map((p) => p.viewerLine));
    expect(comp.points.map((p) => p.num)).toEqual(flat.points.map((p) => p.num));
    // last point is on the last global line (viewer line 6)
    expect(comp.points[comp.points.length - 1].viewerLine).toBe(6);
  });

  it('detectTransitions catches the flip that straddles the member boundary', () => {
    const comp = detectTransitions(asHandler(composite()), parseTs, 'v');
    const flat = detectTransitions(asHandler(fakeReader(cat)), parseTs, 'v');
    expect(comp.transitions).toEqual(flat.transitions);
    // v goes 1→2 at global line 3 (viewer) and 2→3 at global line 5.
    expect(comp.transitions.map((t) => t.viewerLine)).toEqual([3, 5]);
    expect(comp.transitions.map((t) => `${t.fromValue}->${t.toValue}`)).toEqual(['1->2', '2->3']);
  });

  it('discoverFields matches the concatenation', () => {
    const comp = discoverFields(asHandler(composite()));
    const flat = discoverFields(asHandler(fakeReader(cat)));
    expect(comp).toEqual(flat);
  });
});
