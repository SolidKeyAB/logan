// Summarize — P0: semantic compression of a log via VERTICAL repeat-block folding.
//
// Pure, dependency-free, no I/O, no UI. This is the "agreed first step" from
// docs/discovery/log-summarize-templates.md §1b: reduce each line to a small
// structural FINGERPRINT (normalizeShape), stack the fingerprints into a vertical
// strip, then detect & fold the repeating motifs running DOWN the page.
//
// Three primitives, all deterministic (same input → same output):
//   - normalizeShape(line)                → per-line fingerprint (masks variable bits)
//   - detectRepeatBlocks(fps, opts)       → FIXED-period rhythmic repeats (heartbeats,
//                                           back-to-back spam, contiguous k-line cycles)
//   - foldByAnchor(fps, anchorFp, opts)   → VARIABLE-length blocks delimited by a
//                                           recurring anchor line (Android boots, etc.)
// plus suggestAnchors(fps) — cheap helper to surface candidate anchor fingerprints.
//
// The same normalizeShape() is reused by the later global templater (P0.5) and the
// worker/API/MCP wiring (P1). Nothing here reaches the file system or the renderer.

/**
 * A folded region of the fingerprint sequence.
 * `start`/`end` are 0-based, inclusive indices into the fingerprint array
 * (which is 1:1 with the log lines the caller passed in).
 */
export interface RepeatRegion {
  /** The repeating unit's fingerprints. For detectRepeatBlocks this is the
   *  `period`-length block; for foldByAnchor it is the first copy's fingerprints. */
  blockFingerprints: string[];
  /** 0-based index of the first line of the region (inclusive). */
  start: number;
  /** 0-based index of the last line of the region (inclusive). */
  end: number;
  /** How many copies of the block the region contains. */
  repeatCount: number;
  /** Fixed period (detectRepeatBlocks only). */
  period?: number;
  /** Anchor fingerprint that delimits the blocks (foldByAnchor only). */
  anchor?: string;
}

export interface DetectRepeatOptions {
  /** Largest period/block length to look for. Bounds the search window. Default 50. */
  maxPeriod?: number;
  /** Minimum block copies before a region is reported. Default 3. */
  minRepeats?: number;
  /** Max ABSOLUTE mismatched lines tolerated inside a region. Default 0 (strict). */
  tolerance?: number;
}

export interface FoldByAnchorOptions {
  /** Minimum consecutive similar blocks before folding. Default 2. */
  minRepeats?: number;
  /** Block-similarity threshold in [0,1] to treat two blocks as "the same". Default 0.8. */
  similarity?: number;
}

// ---------------------------------------------------------------------------
// normalizeShape — the per-line fingerprint (the "horizontal" reduction).
// ---------------------------------------------------------------------------
//
// Masks the VARIABLE parts of a line (timestamps, counters, ids, hex, quoted
// strings, …) to placeholders so lines that differ only by those bits collapse
// to the SAME fingerprint. Order matters: mask most-specific tokens first so a
// later, greedier rule can't shred a structured token (e.g. an IP before <NUM>).
//
// This is a lightweight tokenize-and-mask, not a full parser. Under-masking →
// too many distinct shapes; over-masking → distinct events merge. The defaults
// here are deliberately conservative; the granularity dial comes later.

export function normalizeShape(line: string): string {
  let s = line;

  // 1. Datetime timestamps (multi-field, unambiguous) → <TS>
  s = s.replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?/g, '<TS>'); // ISO 8601
  s = s.replace(/\b\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?/g, '<TS>');                       // Euro DD.MM.YYYY
  s = s.replace(/\b\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?/g, '<TS>');                                // logcat MM-DD HH:MM:SS
  s = s.replace(/\b[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/g, '<TS>');                                    // syslog Mon DD HH:MM:SS

  // 2. URLs → <URL> (before PATH so the scheme's // isn't eaten as a path)
  s = s.replace(/\b[a-z][a-z0-9+.\-]*:\/\/[^\s]+/gi, '<URL>');

  // 3. UUID → <UUID>
  s = s.replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '<UUID>');

  // 4. MAC → <MAC> (before IP/hex/bare-clock so its colons aren't misread)
  s = s.replace(/\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b/g, '<MAC>');

  // 5. IPv4 (optionally :port) → <IP> (before NUM so octets don't become <NUM>.<NUM>…)
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, '<IP>');

  // 6. Unix-ish absolute/relative multi-segment paths → <PATH>
  s = s.replace(/\/(?:[\w.\-]+\/)+[\w.\-]+/g, '<PATH>');

  // 7. Quoted strings → <STR>
  s = s.replace(/"[^"]*"/g, '<STR>').replace(/'[^']*'/g, '<STR>');

  // 8. Long token/base64/hash runs — require ≥1 digit so plain identifiers
  //    (ClassNames, method names) are NOT masked → <TOK>
  s = s.replace(/\b(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{24,}={0,2}\b/g, '<TOK>');

  // 9. Hex — 0x-prefixed, or a bare run ≥8 chars containing at least one hex
  //    LETTER (so plain decimals stay <NUM>, and short English words stay put) → <HEX>
  s = s.replace(/\b0x[0-9a-fA-F]+\b/g, '<HEX>');
  s = s.replace(/\b(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{8,}\b/g, '<HEX>');

  // 10. Bare clock HH:MM:SS(.mmm) → <TS> (after MAC/IP/HEX so it only eats real clocks)
  s = s.replace(/\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,9})?\b/g, '<TS>');

  // 11. Remaining integers/decimals → <NUM>. Leading word-boundary only (no trailing
  //     one) so a trailing unit is preserved and folds too: "3200ms" → "<NUM>ms".
  s = s.replace(/\b\d+(?:\.\d+)?/g, '<NUM>');

  // 12. Collapse whitespace so alignment/padding differences don't split shapes.
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/** Convenience: fingerprint a whole array of raw lines. */
export function fingerprintLines(lines: string[]): string[] {
  return lines.map(normalizeShape);
}

// ---------------------------------------------------------------------------
// detectRepeatBlocks — FIXED-period rhythmic repeats (the "vertical" detection).
// ---------------------------------------------------------------------------
//
// Scans the fingerprint sequence for maximal contiguous regions with a period p:
// a run where each line equals the corresponding line of the FIRST block
// (canonical position i + ((j-i) mod p)), allowing up to `tolerance` outliers.
// Prefers the SMALLEST verified period so a 2-line block isn't mis-read as period 4.
//
// Catches:
//   - period 1            → classic back-to-back spam (identical consecutive lines)
//   - period k, block k   → a k-line block repeating contiguously (request/boot cycle)
//   - period N            → a cycle recurring every N lines when the in-between lines
//                           are themselves identical cycle-to-cycle (the whole N-line
//                           motif folds; the interior stays part of the block)
//
// NOTE (P0 boundary): a single line recurring every N lines while the interleaved
// lines VARY cycle-to-cycle is not a clean periodic region and is intentionally NOT
// folded here — that heartbeat-with-varying-interleave case is left to the global
// templater (P0.5), which counts shapes file-wide regardless of interleave.
//
// Cost ≈ O(n · maxPeriod): each start tries up to maxPeriod periods with an O(1)
// quick reject, and total extension work is bounded because emitted regions are
// skipped. Pure and cancellation-free; the streaming worker (P1) wraps it.

export function detectRepeatBlocks(
  fingerprints: string[],
  opts: DetectRepeatOptions = {},
): RepeatRegion[] {
  const maxPeriod = opts.maxPeriod ?? 50;
  const minRepeats = opts.minRepeats ?? 3;
  const tolerance = opts.tolerance ?? 0;
  const n = fingerprints.length;
  const regions: RepeatRegion[] = [];

  let i = 0;
  while (i < n) {
    let chosen: { period: number; end: number; repeatCount: number } | null = null;

    for (let p = 1; p <= maxPeriod && i + p < n; p++) {
      // Quick reject: the first repeat must line up with the block's first line.
      if (fingerprints[i + p] !== fingerprints[i]) continue;

      // Extend the region, comparing each line to its CANONICAL block position so a
      // lone outlier costs exactly one tolerance unit (not two, as S[j]==S[j-p] would).
      let mism = 0;
      let lastGood = i + p - 1; // first full block is guaranteed to match
      let j = i + p;
      while (j < n) {
        const canonical = fingerprints[i + ((j - i) % p)];
        if (fingerprints[j] === canonical) {
          lastGood = j;
          j++;
        } else if (mism < tolerance) {
          mism++;
          j++;
        } else {
          break;
        }
      }

      const len = lastGood - i + 1;
      const repeatCount = Math.floor(len / p);
      if (repeatCount >= minRepeats) {
        chosen = { period: p, end: lastGood, repeatCount };
        break; // ascending p ⇒ this is the smallest qualifying period
      }
    }

    if (chosen) {
      regions.push({
        blockFingerprints: fingerprints.slice(i, i + chosen.period),
        period: chosen.period,
        start: i,
        end: chosen.end,
        repeatCount: chosen.repeatCount,
      });
      i = chosen.end + 1;
    } else {
      i++;
    }
  }

  return regions;
}

// ---------------------------------------------------------------------------
// foldByAnchor — VARIABLE-length blocks delimited by a recurring anchor line.
// ---------------------------------------------------------------------------
//
// Real structured repeats aren't rigidly periodic: Android boots each start with
// `--------- beginning of main`, then a boot sequence whose length varies boot to
// boot. A fixed-period check breaks; a recurring ANCHOR line whose fingerprint is
// stable (its timestamp/pid are masked away) does not.
//
// Segments the sequence at each anchor occurrence into inter-anchor blocks, then
// folds RUNS of consecutive blocks that are similar (blockSimilarity ≥ threshold).
// Any content before the first anchor is a preamble and is never folded.

export function foldByAnchor(
  fingerprints: string[],
  anchorFp: string,
  opts: FoldByAnchorOptions = {},
): RepeatRegion[] {
  const minRepeats = opts.minRepeats ?? 2;
  const similarity = opts.similarity ?? 0.8;
  const n = fingerprints.length;

  // Anchor occurrences.
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) if (fingerprints[i] === anchorFp) anchors.push(i);
  if (anchors.length < minRepeats) return [];

  // Blocks: [anchor_k, anchor_{k+1}-1]; the last runs to end of input.
  const blocks = anchors.map((a, k) => {
    const end = k + 1 < anchors.length ? anchors[k + 1] - 1 : n - 1;
    return { start: a, end, fps: fingerprints.slice(a, end + 1) };
  });

  const regions: RepeatRegion[] = [];
  let g = 0;
  while (g < blocks.length) {
    // Extend the run while each following block is similar to the run's FIRST block
    // (comparing to the representative avoids slow drift merging unlike blocks).
    let h = g + 1;
    while (h < blocks.length && blockSimilarity(blocks[g].fps, blocks[h].fps) >= similarity) h++;

    const runLen = h - g;
    if (runLen >= minRepeats) {
      regions.push({
        blockFingerprints: blocks[g].fps,
        anchor: anchorFp,
        start: blocks[g].start,
        end: blocks[h - 1].end,
        repeatCount: runLen,
      });
    }
    g = h;
  }

  return regions;
}

/**
 * Multiset-overlap similarity of two fingerprint sequences in [0,1]:
 * |A ∩ B| (as multisets) / max(|A|,|B|). Order-insensitive and tolerant of a few
 * extra/missing lines — good for variable-length boot blocks. (An LCS-based
 * measure is the P1 upgrade if order sensitivity is needed.)
 */
export function blockSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let inter = 0;
  for (const y of b) {
    const c = counts.get(y) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(y, c - 1);
    }
  }
  return inter / Math.max(a.length, b.length);
}

// ---------------------------------------------------------------------------
// suggestAnchors — candidate anchor fingerprints for foldByAnchor.
// ---------------------------------------------------------------------------
//
// Surfaces fingerprints that recur ≥ minRepeats times, most-frequent first
// (deterministic tie-break by fingerprint). The UI/agent picks one to fold by;
// a true delimiter also has other content between its occurrences, but counting
// is the cheap first cut. Manual right-click anchor selection remains primary.

export function suggestAnchors(
  fingerprints: string[],
  opts: { minRepeats?: number; maxCandidates?: number } = {},
): { fingerprint: string; count: number }[] {
  const minRepeats = opts.minRepeats ?? 3;
  const maxCandidates = opts.maxCandidates ?? 10;

  const counts = new Map<string, number>();
  for (const f of fingerprints) counts.set(f, (counts.get(f) ?? 0) + 1);

  return [...counts.entries()]
    .filter(([, c]) => c >= minRepeats)
    .map(([fingerprint, count]) => ({ fingerprint, count }))
    .sort((a, b) => b.count - a.count || (a.fingerprint < b.fingerprint ? -1 : 1))
    .slice(0, maxCandidates);
}
