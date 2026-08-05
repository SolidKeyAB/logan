// Sub-timestamp spread for the "⏱ By time" Search Configs overview.
//
// Log timestamps are usually coarse (second resolution), so many matches share
// one epoch and collapse onto a single x-column — distant events then look
// simultaneous. This spreads matches that share an identical timestamp along a
// tiny sub-timestamp offset, ORDERED BY LINE NUMBER, so co-timestamped events
// separate in true log order.
//
// Two invariants make it safe to use as an x-position key:
//  1. Deterministic + global: a given line always maps to the same offset,
//     independent of which config references it — so identical events (same
//     line) stay aligned across every lane.
//  2. In-domain: the offset for a group sharing epoch E is bounded by the gap
//     to the NEXT distinct epoch (× SPREAD < 1), so a spread point never crosses
//     into the next timestamp. The earliest line in a group keeps offset 0 (its
//     true epoch), and the final epoch group (no next epoch) is not spread — so
//     every returned key stays within [minEpoch, maxEpoch] and the axis domain,
//     tick labels and duration are unchanged.
//
// The returned key is for POSITIONING only; the raw epoch must still be used for
// any timestamp shown to the user (the offset is a fake sub-second proxy, not a
// real measured time).
//
// This module is the TESTED spec (see src/tests/overviewSpread.test.ts). The
// renderer cannot import it (renderer.ts is a script, not a module — an import
// would break its inline-interface declaration-merging), so it keeps a byte-for-
// byte MIRROR named computeSubTimestampSpread. Keep the two in sync.

// Fraction of the gap-to-next-epoch a group may occupy. < 1 leaves a margin so
// the last point in a dense group never reaches the following timestamp.
const SPREAD = 0.85;

/**
 * @param timed every timestamped match line as {ln, ep} (epoch ms). Order and
 *              duplicate line numbers do not matter; NaN/undefined epochs must
 *              be filtered out by the caller.
 * @returns Map lineNumber → effective x-key (epoch + sub-timestamp offset).
 */
export function computeSubTimestampSpread(
  timed: Array<{ ln: number; ep: number }>,
): Map<number, number> {
  const keyByLine = new Map<number, number>();
  if (timed.length === 0) return keyByLine;

  // Sort by epoch, then line number: equal-epoch runs become contiguous and are
  // internally ordered by line, which is the order we spread them in.
  const sorted = timed.slice().sort((a, b) => a.ep - b.ep || a.ln - b.ln);

  let i = 0;
  while (i < sorted.length) {
    const ep = sorted[i].ep;
    let j = i;
    while (j < sorted.length && sorted[j].ep === ep) j++;
    const n = j - i;
    // Gap to the next distinct epoch (0 for the final group → no spread).
    const gap = j < sorted.length ? sorted[j].ep - ep : 0;
    for (let k = i; k < j; k++) {
      // 0..1 by line order within the group; single-member groups stay at 0.
      const frac = n > 1 ? (k - i) / (n - 1) : 0;
      keyByLine.set(sorted[k].ln, ep + frac * gap * SPREAD);
    }
    i = j;
  }
  return keyByLine;
}
