// CompositeFileHandler — the runtime behind the "Single session" feature: presents N
// already-opened files as ONE continuous, read-only log without materialising a big
// file on disk. Each member keeps its OWN FileHandler (own index + fd), so RAM stays ~
// the cost of opening the files individually and paging happens across the smaller files
// instead of one monster index. All the boundary math lives in the pure, unit-tested
// CompositeLineSpace; this class just delegates reads/searches to the right child and
// re-bases line numbers into the global space.
//
// P1 scope: read path (getLines / getLinesAsync / getLinesByNumbers / totals) + search
// fan-out. It intentionally exposes the same method shapes the viewer/search paths use so
// it can later stand in for a FileHandler behind an opt-in "single session" tab. Not yet
// wired into the live currentFilePath path (that wiring + GUI verification is the next
// step). Severity index / column filter are deferred to a later phase.

import type { FileHandler } from './fileHandler';
import type { FileInfo, LineData, SearchMatch, SearchOptions } from '../shared/types';
import { CompositeLineSpace } from './compositeLineSpace';

export interface CompositeMemberHandler {
  filePath: string;
  handler: Pick<
    FileHandler,
    'getTotalLines' | 'getLines' | 'getLinesAsync' | 'getLinesByNumbers' | 'search' | 'getMaxLineLength' | 'getFileInfo' | 'close'
  >;
}

export interface CompositeBoundary {
  filePath: string;
  startLine: number; // 0-based global line where this file begins
  lineCount: number;
}

export class CompositeFileHandler {
  private space: CompositeLineSpace;

  // Mirrors FileHandler's post-search readout fields so the SEARCH IPC handler can
  // read them uniformly across the FileHandler | CompositeFileHandler union.
  lastSearchEngine?: string;
  lastSearchReason?: string;

  constructor(private members: CompositeMemberHandler[], private label: string) {
    this.space = new CompositeLineSpace(members.map((m) => m.handler.getTotalLines()));
  }

  getTotalLines(): number {
    return this.space.totalLines;
  }

  getMaxLineLength(): number {
    return this.members.reduce((mx, m) => Math.max(mx, m.handler.getMaxLineLength()), 0);
  }

  getFileInfo(): FileInfo {
    const size = this.members.reduce((s, m) => s + (m.handler.getFileInfo()?.size ?? 0), 0);
    return { path: this.label, size, totalLines: this.space.totalLines };
  }

  // Where each member starts in the global line space — drives origin markers /
  // boundary lines in the viewer and click-to-file resolution.
  boundaries(): CompositeBoundary[] {
    return this.members.map((m, i) => ({
      filePath: m.filePath,
      startLine: this.space.members[i].startLine,
      lineCount: this.space.members[i].lineCount,
    }));
  }

  // Resolve a global line to its originating file (for "which file is this line from?").
  fileOf(globalLine: number): { filePath: string; localLine: number } | null {
    const pos = this.space.locate(globalLine);
    if (!pos) return null;
    return { filePath: this.members[pos.fileIndex].filePath, localLine: pos.localLine };
  }

  getLines(startLine: number, count: number): LineData[] {
    const out: LineData[] = [];
    for (const r of this.space.split(startLine, count)) {
      const base = this.space.members[r.fileIndex].startLine;
      for (const ln of this.members[r.fileIndex].handler.getLines(r.localStart, r.count)) {
        out.push({ ...ln, lineNumber: base + ln.lineNumber });
      }
    }
    return out;
  }

  async getLinesAsync(startLine: number, count: number): Promise<LineData[]> {
    const out: LineData[] = [];
    for (const r of this.space.split(startLine, count)) {
      const base = this.space.members[r.fileIndex].startLine;
      const lines = await this.members[r.fileIndex].handler.getLinesAsync(r.localStart, r.count);
      for (const ln of lines) out.push({ ...ln, lineNumber: base + ln.lineNumber });
    }
    return out;
  }

  async getLinesByNumbers(lineNumbers: number[]): Promise<LineData[]> {
    // Group requested global lines by file, fetch each file's set once, then reassemble
    // in the caller's original order (a Map keyed by global line holds the results).
    const perFile = new Map<number, number[]>(); // fileIndex → local line numbers
    const routing: Array<{ fileIndex: number; localLine: number } | null> = lineNumbers.map((g) => {
      const pos = this.space.locate(g);
      if (!pos) return null;
      const arr = perFile.get(pos.fileIndex) ?? [];
      arr.push(pos.localLine);
      perFile.set(pos.fileIndex, arr);
      return pos;
    });

    const byGlobal = new Map<number, LineData>();
    for (const [fileIndex, locals] of perFile) {
      const base = this.space.members[fileIndex].startLine;
      const lines = await this.members[fileIndex].handler.getLinesByNumbers(locals);
      for (const ln of lines) byGlobal.set(base + ln.lineNumber, { ...ln, lineNumber: base + ln.lineNumber });
    }

    const out: LineData[] = [];
    routing.forEach((pos, i) => {
      if (!pos) return;
      const got = byGlobal.get(this.space.members[pos.fileIndex].startLine + pos.localLine);
      if (got) out.push(got);
      else out.push({ lineNumber: lineNumbers[i], text: '' });
    });
    return out;
  }

  // Search every member and merge hits into the global line space, in file order.
  // Members are searched sequentially so progress is monotonic and a cancel between
  // files takes effect promptly. Each member search runs silent (no per-file UI churn).
  async search(
    options: SearchOptions,
    onProgress?: (percent: number, matchCount: number, deltaMatches?: SearchMatch[]) => void,
    signal?: { cancelled: boolean }
  ): Promise<SearchMatch[]> {
    const all: SearchMatch[] = [];
    for (let i = 0; i < this.members.length; i++) {
      if (signal?.cancelled) break;
      const base = this.space.members[i].startLine;
      const sub = await this.members[i].handler.search({ ...options, silent: true }, undefined, signal);
      const rebased = sub.map((m) => ({ ...m, lineNumber: base + m.lineNumber, displayIndex: undefined }));
      all.push(...rebased);
      onProgress?.(Math.round(((i + 1) / this.members.length) * 100), all.length, rebased);
    }
    this.lastSearchEngine = 'composite';
    this.lastSearchReason = `${this.members.length} files`;
    return all;
  }

  close(): void {
    for (const m of this.members) m.handler.close();
  }
}
