// segmentPlan — the resource math behind auto-composite-large-files. Decides, from the
// live system's memory, whether a file is big enough to segment and how to size the
// segments + how many to keep resident. Kept PURE (computeSegmentPlan takes the memory
// snapshot as input) so the policy is unit-testable; readSystemMemory() is the one impure
// wrapper that samples os + v8.

import * as os from 'os';
import * as v8 from 'v8';

// Resident index cost: FileHandler holds offsets + lengths as two Float64Arrays = 16 bytes
// per physical line. This is the whole "resource-bearing size" — see the design doc.
export const INDEX_BYTES_PER_LINE = 16;
// scanFileIndex's own capacity heuristic assumes ~1 line per 80 bytes; reuse it so the
// index-size estimate here matches how the scanner actually allocates.
export const AVG_BYTES_PER_LINE = 80;
// A byte of file ⇒ this many bytes of resident line index (16/80 = 0.2).
export const INDEX_BYTES_PER_FILE_BYTE = INDEX_BYTES_PER_LINE / AVG_BYTES_PER_LINE;

export interface SystemMemory {
  freeBytes: number;      // physical RAM free right now (os.freemem)
  heapLimitBytes: number; // ceiling this process can grow its V8 heap to
  heapUsedBytes: number;  // heap already in use
}

export interface SegmentPlanOptions {
  /** Fraction of available memory we're willing to spend on RESIDENT line index. */
  fraction?: number;              // default 0.4
  /** Segments we aim to keep indexed at once (viewport + neighbours). */
  desiredResidentSegments?: number; // default 4
  /** Clamp for a single segment's file-byte span. */
  minSegmentBytes?: number;       // default 8 MiB
  maxSegmentBytes?: number;       // default 512 MiB
}

export interface SegmentPlan {
  shouldSegment: boolean;      // is the whole-file index too big for the budget?
  budgetBytes: number;         // resident index budget (bytes)
  estWholeIndexBytes: number;  // estimated cost of indexing the whole file at once
  segmentBytes: number;        // target file-byte span per segment
  totalSegments: number;       // ceil(fileSize / segmentBytes)
  maxResidentSegments: number; // how many segment indexes may be resident at once
  estResidentIndexBytes: number; // maxResidentSegments × one segment's est index size
}

const MIB = 1024 * 1024;

/**
 * Decide a segmentation plan for a file of `fileSize` bytes given a memory snapshot.
 * Pure — no I/O, no globals. The budget is a fraction of the TIGHTER of (free physical
 * RAM, V8 heap headroom): the index is a typed array counted against the process, and V8's
 * heap ceiling (~2–4 GB by default) can OOM the process long before physical RAM runs out.
 */
export function computeSegmentPlan(
  fileSize: number,
  mem: SystemMemory,
  opts: SegmentPlanOptions = {}
): SegmentPlan {
  const fraction = clampNum(opts.fraction ?? 0.4, 0.05, 0.9);
  const desiredResident = Math.max(2, Math.floor(opts.desiredResidentSegments ?? 4));
  const minSeg = Math.max(1, opts.minSegmentBytes ?? 8 * MIB);
  const maxSeg = Math.max(minSeg, opts.maxSegmentBytes ?? 512 * MIB);

  const heapHeadroom = Math.max(0, mem.heapLimitBytes - mem.heapUsedBytes);
  const available = Math.max(0, Math.min(mem.freeBytes, heapHeadroom));
  const budgetBytes = Math.floor(available * fraction);

  const estWholeIndexBytes = Math.ceil(fileSize * INDEX_BYTES_PER_FILE_BYTE);
  const shouldSegment = budgetBytes > 0 && estWholeIndexBytes > budgetBytes;

  if (!shouldSegment) {
    return {
      shouldSegment: false,
      budgetBytes,
      estWholeIndexBytes,
      segmentBytes: fileSize,
      totalSegments: 1,
      maxResidentSegments: 1,
      estResidentIndexBytes: estWholeIndexBytes,
    };
  }

  // Size a segment so `desiredResident` of them fit in the budget: budget holds
  // desiredResident × (segmentBytes × indexPerByte). Solve for segmentBytes, then clamp.
  const idealSegBytes = budgetBytes / (desiredResident * INDEX_BYTES_PER_FILE_BYTE);
  const segmentBytes = Math.max(minSeg, Math.min(maxSeg, Math.min(fileSize, Math.floor(idealSegBytes) || minSeg)));

  const totalSegments = Math.max(1, Math.ceil(fileSize / segmentBytes));
  const perSegIndexBytes = Math.ceil(segmentBytes * INDEX_BYTES_PER_FILE_BYTE);
  // Keep resident × per-segment index within budget, but never fewer than 2 (so a read that
  // straddles a boundary can hold both sides) and never more than the segment count.
  const fitResident = perSegIndexBytes > 0 ? Math.floor(budgetBytes / perSegIndexBytes) : desiredResident;
  const maxResidentSegments = Math.max(2, Math.min(totalSegments, fitResident || 2));

  return {
    shouldSegment: true,
    budgetBytes,
    estWholeIndexBytes,
    segmentBytes,
    totalSegments,
    maxResidentSegments,
    estResidentIndexBytes: maxResidentSegments * perSegIndexBytes,
  };
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// The one impure entry point: sample the live system. The binding constraint is the
// TIGHTER of free physical RAM and V8 heap headroom — the line index is a typed array
// counted against this process, and V8's heap ceiling can OOM us before RAM is exhausted.
export function readSystemMemory(): SystemMemory {
  const heap = v8.getHeapStatistics();
  return {
    freeBytes: os.freemem(),
    heapLimitBytes: heap.heap_size_limit,
    heapUsedBytes: heap.used_heap_size,
  };
}
