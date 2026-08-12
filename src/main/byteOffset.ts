// Map a 0-based file byte offset to the index of the logical line that CONTAINS it, via
// binary search over the per-line start offsets. LOGAN's line index (fileHandler.offsets)
// is built by our own \r-aware scanner, so it counts standalone-CR line breaks that
// ripgrep does not. Ripgrep's byte offsets are always correct even on such files, so we
// run ripgrep for speed and remap each match's byte offset back to the right line here.
//
// Returns the largest i in [0, count) with offsets[i] <= byteOffset (0 if none / empty).
export function byteOffsetToLineIndex(
  offsets: Float64Array | number[],
  count: number,
  byteOffset: number,
): number {
  if (count <= 0) return 0;
  let lo = 0;
  let hi = count - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] <= byteOffset) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}
