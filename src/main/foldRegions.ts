// Fold-region detection for the in-place viewer folding feature.
//
// Reads every line of the open file off-thread (via a LineReader, same harness as
// the summarize/trend workers), fingerprints each line with normalizeShape, and
// runs the repeat-block detector to find contiguous VERTICAL repeats — a k-line
// block repeating back-to-back (k=1 is identical-line spam). Each region can then
// be collapsed in the viewer to its first block + a "×N" header, hiding the rest.
//
// Pure + reader-driven so it's unit-testable without spawning a worker (mirrors
// summarizeScan / trendWorkerReaders). detectRepeatBlocks/foldByAnchor already
// live in logSummarize.ts; this just drives them over the file and shapes the
// result the renderer/agent consume (0-based, inclusive line spans).

import { normalizeShape, detectRepeatBlocks } from './logSummarize';
import type { LineReader } from './trendWorkerReaders';

export interface FoldRegion {
  /** 0-based first file line of the region (inclusive). */
  start: number;
  /** 0-based last file line of the region (inclusive). */
  end: number;
  /** Length of the repeating unit (the fixed period). The first `blockLen` lines
   *  stay visible as the representative when collapsed; the rest are hidden. */
  blockLen: number;
  /** How many copies of the block the region contains. */
  repeatCount: number;
  /** Total lines in the region (end - start + 1). */
  totalLines: number;
  /** Lines hidden if this region is collapsed (totalLines - blockLen). */
  hiddenLines: number;
  /** First line's text (trimmed) — the header label / agent preview. */
  sample: string;
}

export interface FoldRegionsResult {
  regions: FoldRegion[];
  /** Total lines scanned. */
  totalLines: number;
  /** Lines that would be hidden if every region were collapsed. */
  foldableLines: number;
}

export interface DetectFoldOptions {
  maxPeriod?: number;   // largest block length to look for (default 50, from the engine)
  minRepeats?: number;  // minimum block copies before a region is reported (default 3)
  tolerance?: number;   // absolute mismatched lines tolerated inside a region (default 0)
  minHidden?: number;   // only report a region that hides at least this many lines (default 3)
}

export function detectFoldRegions(reader: LineReader, opts: DetectFoldOptions = {}): FoldRegionsResult {
  const total = reader.getTotalLines();
  // Pass 1: per-line fingerprints (cheap masked strings), read in batches.
  const fps: string[] = new Array(total);
  const BATCH = 5000;
  for (let s = 0; s < total; s += BATCH) {
    const count = Math.min(BATCH, total - s);
    for (const line of reader.getLines(s, count)) fps[line.lineNumber] = normalizeShape(line.text);
  }

  const raw = detectRepeatBlocks(fps, {
    maxPeriod: opts.maxPeriod,
    minRepeats: opts.minRepeats,
    tolerance: opts.tolerance,
  });

  const minHidden = opts.minHidden ?? 3;
  const regions: FoldRegion[] = [];
  for (const r of raw) {
    const blockLen = r.period ?? r.blockFingerprints.length;
    const totalLines = r.end - r.start + 1;
    const hiddenLines = totalLines - blockLen;
    if (hiddenLines < minHidden) continue; // skip trivial folds (noise)
    const got = reader.getLines(r.start, 1);
    regions.push({
      start: r.start,
      end: r.end,
      blockLen,
      repeatCount: r.repeatCount,
      totalLines,
      hiddenLines,
      sample: got.length ? got[0].text.trim().slice(0, 200) : '',
    });
  }

  const foldableLines = regions.reduce((n, r) => n + r.hiddenLines, 0);
  return { regions, totalLines: total, foldableLines };
}
