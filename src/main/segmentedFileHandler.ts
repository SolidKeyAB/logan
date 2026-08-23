// SegmentedFileHandler — P2 of auto-composite-large-files. Presents ONE big file as a
// continuous read-only log made of N line-aligned segments, but keeps only a bounded
// number of segment INDEXES resident at once (LRU). This is what actually banks the RAM
// win: a 50M-line file no longer costs its whole 800 MB offset index — only the few hot
// segments near the viewport are indexed; cold ones are evicted and rebuilt on demand.
//
// It reuses the proven pieces: CompositeLineSpace for the global↔segment math, and
// FileHandler.openSegment (P1) to index a single [startByte,endByte) window over the ONE
// file's fd. A "coarse index" (per-segment {startByte, endByte, lineCount}) is always
// resident and tiny (N entries); the "fine index" (per-line offsets) is lazy + evictable.
//
// Scope (increment 1): read path only (getLines / getLinesAsync / getLinesByNumbers +
// totals / boundaries). Search + severity fan-out (which touch every segment) and the
// open-path wiring + Features toggle are the next increment — mirrors how the composite
// itself was staged.

import * as fs from 'fs';
import type { FileInfo, LineData } from '../shared/types';
import { CompositeLineSpace } from './compositeLineSpace';
import { FileHandler } from './fileHandler';
import { findLineStartAtOrAfter, scanFileIndex } from './indexScan';
import { computeSegmentPlan, readSystemMemory, SegmentPlan } from './segmentPlan';

interface SegmentDescriptor {
  startByte: number;
  endByte: number;
  lineCount: number;
  maxLineLength: number;
}

export interface SegmentedBoundary {
  filePath: string;
  startLine: number; // 0-based global line where this segment begins
  lineCount: number;
}

export interface SegmentedOpenOptions {
  segmentBytes?: number;        // explicit target span per segment (tests / overrides)
  maxResidentSegments?: number; // explicit cap on resident segment indexes
  plan?: SegmentPlan;           // a precomputed plan (from the open path)
  onProgress?: (percent: number) => void;
}

export class SegmentedFileHandler {
  private space: CompositeLineSpace;
  // Insertion order in this Map IS the LRU order: least-recently-used first, most-recent
  // last. touch() re-inserts to move an entry to the end.
  private residentSegments = new Map<number, FileHandler>();

  private constructor(
    private filePath: string,
    private segments: SegmentDescriptor[],
    private maxResident: number,
    private fileSize: number,
    readonly plan: SegmentPlan | null
  ) {
    this.space = new CompositeLineSpace(segments.map((s) => s.lineCount));
  }

  // Build the coarse plan (one pass over the file to learn each segment's line count),
  // WITHOUT keeping any fine per-line index resident. Yields between segments so a big
  // build doesn't monopolise the event loop.
  static async open(filePath: string, opts: SegmentedOpenOptions = {}): Promise<SegmentedFileHandler> {
    const fileSize = fs.statSync(filePath).size;

    const plan = opts.plan ?? (opts.segmentBytes ? null : computeSegmentPlan(fileSize, readSystemMemory()));
    const segmentBytes = Math.max(
      1,
      opts.segmentBytes ?? plan?.segmentBytes ?? fileSize
    );
    const maxResident = Math.max(1, opts.maxResidentSegments ?? plan?.maxResidentSegments ?? 4);

    // Approximate cut points by byte fraction, then snap each to a real line start so no
    // segment ever splits a line (P1 invariant). Dedup + sort — snapping can collapse two
    // nearby cuts (e.g. very long lines) into one boundary.
    const nCuts = Math.max(1, Math.ceil(fileSize / segmentBytes)) - 1;
    const rawBoundaries = new Set<number>([0, fileSize]);
    for (let k = 1; k <= nCuts; k++) {
      const approx = Math.floor((fileSize * k) / (nCuts + 1));
      rawBoundaries.add(findLineStartAtOrAfter(filePath, approx));
    }
    const boundaries = Array.from(rawBoundaries).sort((a, b) => a - b);

    const segments: SegmentDescriptor[] = [];
    for (let i = 0; i + 1 < boundaries.length; i++) {
      const startByte = boundaries[i];
      const endByte = boundaries[i + 1];
      if (endByte <= startByte) continue;
      // Scan the window to learn its line count + max line length, then DISCARD the fine
      // offsets — only the tiny descriptor is retained. Peak build RAM ≈ one segment index.
      const scan = scanFileIndex(filePath, undefined, { startByte, endByte });
      segments.push({ startByte, endByte, lineCount: scan.totalLines, maxLineLength: scan.maxLineLength });
      opts.onProgress?.(Math.round(((i + 1) / (boundaries.length - 1)) * 100));
      await Promise.resolve(); // cooperative yield
    }

    // A truly empty file yields no segments — represent it as a single empty segment so the
    // line space is well-formed (0 total lines).
    if (segments.length === 0) segments.push({ startByte: 0, endByte: 0, lineCount: 0, maxLineLength: 0 });

    return new SegmentedFileHandler(filePath, segments, maxResident, fileSize, plan);
  }

  getTotalLines(): number {
    return this.space.totalLines;
  }

  getMaxLineLength(): number {
    return this.segments.reduce((m, s) => Math.max(m, s.maxLineLength), 0);
  }

  getFileInfo(): FileInfo {
    return { path: this.filePath, size: this.fileSize, totalLines: this.space.totalLines };
  }

  // Global line at which each segment starts — drives origin markers / boundary lines.
  boundaries(): SegmentedBoundary[] {
    return this.segments.map((_, i) => ({
      filePath: this.filePath,
      startLine: this.space.members[i].startLine,
      lineCount: this.space.members[i].lineCount,
    }));
  }

  fileOf(globalLine: number): { filePath: string; localLine: number } | null {
    const pos = this.space.locate(globalLine);
    if (!pos) return null;
    return { filePath: this.filePath, localLine: pos.localLine };
  }

  // How many segment indexes are resident right now — the RAM knob (bounded by maxResident).
  residentSegmentCount(): number {
    return this.residentSegments.size;
  }

  getLines(startLine: number, count: number): LineData[] {
    const out: LineData[] = [];
    for (const r of this.space.split(startLine, count)) {
      const base = this.space.members[r.fileIndex].startLine;
      const h = this.ensureSync(r.fileIndex);
      for (const ln of h.getLines(r.localStart, r.count)) out.push({ ...ln, lineNumber: base + ln.lineNumber });
    }
    return out;
  }

  async getLinesAsync(startLine: number, count: number): Promise<LineData[]> {
    const out: LineData[] = [];
    for (const r of this.space.split(startLine, count)) {
      const base = this.space.members[r.fileIndex].startLine;
      const h = await this.ensureAsync(r.fileIndex);
      const lines = await h.getLinesAsync(r.localStart, r.count);
      for (const ln of lines) out.push({ ...ln, lineNumber: base + ln.lineNumber });
    }
    return out;
  }

  async getLinesByNumbers(lineNumbers: number[]): Promise<LineData[]> {
    // Group requested global lines by segment, fetch each segment's set once, reassemble in
    // the caller's original order (a Map keyed by global line holds the results).
    const perSeg = new Map<number, number[]>();
    const routing = lineNumbers.map((g) => {
      const pos = this.space.locate(g);
      if (!pos) return null;
      const arr = perSeg.get(pos.fileIndex) ?? [];
      arr.push(pos.localLine);
      perSeg.set(pos.fileIndex, arr);
      return pos;
    });

    const byGlobal = new Map<number, LineData>();
    for (const [segIndex, locals] of perSeg) {
      const base = this.space.members[segIndex].startLine;
      const h = await this.ensureAsync(segIndex);
      const lines = await h.getLinesByNumbers(locals);
      for (const ln of lines) byGlobal.set(base + ln.lineNumber, { ...ln, lineNumber: base + ln.lineNumber });
    }

    const out: LineData[] = [];
    routing.forEach((pos) => {
      if (!pos) return;
      const got = byGlobal.get(this.space.members[pos.fileIndex].startLine + pos.localLine);
      if (got) out.push(got);
    });
    return out;
  }

  close(): void {
    for (const h of this.residentSegments.values()) h.close();
    this.residentSegments.clear();
  }

  // === LRU segment residency ===

  // Move an already-resident segment to most-recently-used; return null if not resident.
  private touch(i: number): FileHandler | null {
    const h = this.residentSegments.get(i);
    if (!h) return null;
    this.residentSegments.delete(i);
    this.residentSegments.set(i, h);
    return h;
  }

  private ensureSync(i: number): FileHandler {
    const cached = this.touch(i);
    if (cached) return cached;
    const h = new FileHandler();
    const s = this.segments[i];
    h.openSegmentSync(this.filePath, s.startByte, s.endByte);
    this.residentSegments.set(i, h);
    this.evictIfNeeded();
    return h;
  }

  private async ensureAsync(i: number): Promise<FileHandler> {
    const cached = this.touch(i);
    if (cached) return cached;
    const h = new FileHandler();
    const s = this.segments[i];
    await h.openSegment(this.filePath, s.startByte, s.endByte);
    this.residentSegments.set(i, h);
    this.evictIfNeeded();
    return h;
  }

  // Drop the least-recently-used segment index(es) until we're within the cap, closing
  // each evicted FileHandler (releases its fd + offset arrays).
  private evictIfNeeded(): void {
    while (this.residentSegments.size > this.maxResident) {
      const oldest = this.residentSegments.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      const h = this.residentSegments.get(oldest);
      this.residentSegments.delete(oldest);
      h?.close();
    }
  }
}
