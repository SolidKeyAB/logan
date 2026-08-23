import { describe, it, expect } from 'vitest';
import {
  normalizeShape,
  fingerprintLines,
  detectRepeatBlocks,
  foldByAnchor,
  blockSimilarity,
  suggestAnchors,
} from '../main/logSummarize';

// ---------------------------------------------------------------------------
// normalizeShape — the per-line fingerprint (masking)
// ---------------------------------------------------------------------------
describe('normalizeShape — masking of variable tokens', () => {
  it('masks an ISO timestamp + counter so two lines fold to one shape', () => {
    const a = '2026-08-23 10:14:07.882  wifi  retry attempt 3';
    const b = '2026-08-23 10:14:09.101  wifi  retry attempt 4';
    expect(normalizeShape(a)).toBe(normalizeShape(b));
    expect(normalizeShape(a)).toBe('<TS> wifi retry attempt <NUM>');
  });

  it('keeps the trailing unit on a masked number (<NUM>ms)', () => {
    expect(normalizeShape('connect failed after 3200ms')).toBe('connect failed after <NUM>ms');
  });

  it('masks quoted strings, hex and 0x', () => {
    expect(normalizeShape('ssid="Home-5G" err=0x1f handle=deadbeef01'))
      .toBe('ssid=<STR> err=<HEX> handle=<HEX>');
  });

  it('masks UUID, IPv4:port and MAC to distinct placeholders', () => {
    expect(normalizeShape('peer 550e8400-e29b-41d4-a716-446655440000 at 192.168.0.1:8080 mac 01:23:45:67:89:ab'))
      .toBe('peer <UUID> at <IP> mac <MAC>');
  });

  it('masks URLs and unix paths', () => {
    expect(normalizeShape('GET https://api.example.com/v2/x from /usr/local/bin/app'))
      .toBe('GET <URL> from <PATH>');
  });

  it('collapses whitespace / alignment padding so shapes match', () => {
    expect(normalizeShape('level=INFO     msg=ok')).toBe(normalizeShape('level=INFO msg=ok'));
  });

  it('does NOT mask a plain word that happens to be short-hex-ish or an identifier', () => {
    // "cafe" is <8 hex chars; "AbstractFactory" has no digit → neither masked
    expect(normalizeShape('cafe AbstractFactory ready')).toBe('cafe AbstractFactory ready');
  });

  it('keeps genuinely different messages as different shapes', () => {
    expect(normalizeShape('[Auth] login ok')).not.toBe(normalizeShape('[Net] connect ok'));
  });

  it('is deterministic', () => {
    const line = '2026-08-23 10:14:07.882 x=1 y=0xff z="q"';
    expect(normalizeShape(line)).toBe(normalizeShape(line));
  });
});

// ---------------------------------------------------------------------------
// detectRepeatBlocks — fixed-period vertical repeats
// ---------------------------------------------------------------------------
describe('detectRepeatBlocks — fixed-period folding', () => {
  it('folds back-to-back spam as period 1', () => {
    const fps = ['A', 'A', 'A', 'A', 'A'];
    const r = detectRepeatBlocks(fps, { minRepeats: 3 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ period: 1, start: 0, end: 4, repeatCount: 5 });
    expect(r[0].blockFingerprints).toEqual(['A']);
  });

  it('folds a repeating multi-line cycle and prefers the smallest period', () => {
    // [H,X,Y] repeated 3× — must be reported as period 3, block length 3 (not 1/6/9)
    const fps = ['H', 'X', 'Y', 'H', 'X', 'Y', 'H', 'X', 'Y'];
    const r = detectRepeatBlocks(fps, { minRepeats: 3 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ period: 3, start: 0, end: 8, repeatCount: 3 });
    expect(r[0].blockFingerprints).toEqual(['H', 'X', 'Y']);
  });

  it('prefers period 1 over period 2 when both hold (AAAA)', () => {
    const r = detectRepeatBlocks(['A', 'A', 'A', 'A'], { minRepeats: 3 });
    expect(r[0].period).toBe(1);
  });

  it('does not fold when copies are below minRepeats', () => {
    // only 2 copies, threshold 3 → nothing
    expect(detectRepeatBlocks(['A', 'A'], { minRepeats: 3 })).toEqual([]);
  });

  it('tolerates a bounded number of outliers inside a region', () => {
    // one stray B in a run of A; tolerance 1 keeps the band intact
    const fps = ['A', 'A', 'A', 'B', 'A', 'A'];
    const strict = detectRepeatBlocks(fps, { minRepeats: 5, tolerance: 0 });
    expect(strict).toEqual([]); // strict: the B breaks the run below 5 copies
    const lax = detectRepeatBlocks(fps, { minRepeats: 5, tolerance: 1 });
    expect(lax).toHaveLength(1);
    expect(lax[0]).toMatchObject({ period: 1, start: 0, end: 5 });
  });

  it('trims trailing non-matching lines out of the region', () => {
    const fps = ['A', 'A', 'A', 'A', 'B', 'C'];
    const r = detectRepeatBlocks(fps, { minRepeats: 3, tolerance: 1 });
    expect(r).toHaveLength(1);
    expect(r[0].end).toBe(3); // B,C excluded
  });

  it('finds multiple disjoint regions without overlap', () => {
    const fps = ['A', 'A', 'A', 'q', 'B', 'B', 'B'];
    const r = detectRepeatBlocks(fps, { minRepeats: 3 });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ start: 0, end: 2 });
    expect(r[1]).toMatchObject({ start: 4, end: 6 });
  });

  it('does NOT fold a single line recurring every N when the interleave varies (P0 boundary)', () => {
    // H every 3rd line but the between-lines all differ → not a clean periodic region
    const fps = ['H', 'a', 'b', 'H', 'c', 'd', 'H', 'e', 'f'];
    expect(detectRepeatBlocks(fps, { minRepeats: 3 })).toEqual([]);
  });

  it('folds a heartbeat cycle when the interleave is identical cycle-to-cycle', () => {
    // H,X,Y repeats — the whole 3-line motif folds as period 3
    const raw = [
      '2026-08-23 10:00:01 hb ping 1',
      '2026-08-23 10:00:01 [Auth] tick',
      '2026-08-23 10:00:01 [Net] tick',
      '2026-08-23 10:00:02 hb ping 2',
      '2026-08-23 10:00:02 [Auth] tick',
      '2026-08-23 10:00:02 [Net] tick',
      '2026-08-23 10:00:03 hb ping 3',
      '2026-08-23 10:00:03 [Auth] tick',
      '2026-08-23 10:00:03 [Net] tick',
    ];
    const r = detectRepeatBlocks(fingerprintLines(raw), { minRepeats: 3 });
    expect(r).toHaveLength(1);
    expect(r[0].period).toBe(3);
    expect(r[0].repeatCount).toBe(3);
  });

  it('returns [] for empty / too-short input', () => {
    expect(detectRepeatBlocks([])).toEqual([]);
    expect(detectRepeatBlocks(['only-one'])).toEqual([]);
  });

  it('is deterministic', () => {
    const fps = ['A', 'A', 'A', 'A', 'B', 'B', 'B'];
    expect(detectRepeatBlocks(fps)).toEqual(detectRepeatBlocks(fps));
  });
});

// ---------------------------------------------------------------------------
// foldByAnchor — variable-length anchor-delimited blocks (Android boots)
// ---------------------------------------------------------------------------
describe('foldByAnchor — variable-length anchor folding', () => {
  // Two Android-ish "boots": same anchor line, DIFFERENT lengths (200 vs +1 line).
  const boot = (extra: string[] = []) => [
    '--------- beginning of main',
    '08-23 20:16:01.001  1000  1000 I ActivityManager: Start proc app',
    '08-23 20:16:01.050  1000  1000 I System: boot step one',
    '08-23 20:16:01.090  1000  1000 I System: boot step two',
    ...extra,
  ];

  it('folds two similar boots of different lengths into one region', () => {
    const raw = [
      ...boot(),
      ...boot(['08-23 20:17:02.500  1000  1000 W System: extra warning']), // longer boot
    ];
    const fps = fingerprintLines(raw);
    const anchorFp = normalizeShape('--------- beginning of main');
    const r = foldByAnchor(fps, anchorFp, { minRepeats: 2, similarity: 0.7 });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ anchor: anchorFp, repeatCount: 2, start: 0 });
    expect(r[0].end).toBe(raw.length - 1);
  });

  it('does not fold a single occurrence of the anchor', () => {
    const fps = fingerprintLines(boot());
    const anchorFp = normalizeShape('--------- beginning of main');
    expect(foldByAnchor(fps, anchorFp, { minRepeats: 2 })).toEqual([]);
  });

  it('does not fold blocks that are dissimilar even under the same anchor', () => {
    const raw = [
      'ANCHOR',
      'apple', 'banana', 'cherry',
      'ANCHOR',
      'x... totally', 'yyy different', 'zzz content', 'more', 'noise',
    ];
    const fps = fingerprintLines(raw);
    const anchorFp = normalizeShape('ANCHOR');
    expect(foldByAnchor(fps, anchorFp, { minRepeats: 2, similarity: 0.8 })).toEqual([]);
  });

  it('leaves the pre-anchor preamble outside the folded region', () => {
    const raw = ['preamble line', 'ANCHOR', 'a', 'b', 'ANCHOR', 'a', 'b'];
    const fps = fingerprintLines(raw);
    const anchorFp = normalizeShape('ANCHOR');
    const r = foldByAnchor(fps, anchorFp, { minRepeats: 2, similarity: 0.8 });
    expect(r).toHaveLength(1);
    expect(r[0].start).toBe(1); // starts at the first ANCHOR, not the preamble
  });

  it('is deterministic', () => {
    const raw = ['A', 'x', 'A', 'x', 'A', 'x'];
    const r1 = foldByAnchor(raw, 'A', { minRepeats: 2 });
    const r2 = foldByAnchor(raw, 'A', { minRepeats: 2 });
    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// blockSimilarity + suggestAnchors
// ---------------------------------------------------------------------------
describe('blockSimilarity', () => {
  it('is 1 for identical blocks and 0 for disjoint', () => {
    expect(blockSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(blockSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
  });
  it('tolerates one extra line (variable length)', () => {
    // 3 of 4 shared → 0.75
    expect(blockSimilarity(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toBeCloseTo(0.75);
  });
  it('handles empty blocks', () => {
    expect(blockSimilarity([], [])).toBe(1);
    expect(blockSimilarity([], ['a'])).toBe(0);
  });
});

describe('suggestAnchors', () => {
  it('returns recurring fingerprints, most frequent first', () => {
    const fps = ['A', 'x', 'A', 'y', 'A', 'B', 'B', 'z'];
    const s = suggestAnchors(fps, { minRepeats: 2 });
    expect(s[0]).toEqual({ fingerprint: 'A', count: 3 });
    expect(s.map((c) => c.fingerprint)).toContain('B');
  });
  it('filters out fingerprints below minRepeats', () => {
    const fps = ['A', 'A', 'A', 'unique'];
    const s = suggestAnchors(fps, { minRepeats: 3 });
    expect(s).toEqual([{ fingerprint: 'A', count: 3 }]);
  });
  it('is deterministic with a stable tie-break', () => {
    const fps = ['m', 'm', 'n', 'n'];
    expect(suggestAnchors(fps, { minRepeats: 2 })).toEqual([
      { fingerprint: 'm', count: 2 },
      { fingerprint: 'n', count: 2 },
    ]);
  });
});
