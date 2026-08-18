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

// Mirrors DEFAULT_MAX_MATCHES in fileHandler.ts. Kept as a local literal (not imported)
// so this module stays dependency-free of FileHandler's runtime — it only type-imports it,
// which is what lets the boundary math be unit-tested headlessly. Must stay in sync.
const DEFAULT_MAX_MATCHES = 100000;

export interface CompositeMemberHandler {
  filePath: string;
  handler: Pick<
    FileHandler,
    'getTotalLines' | 'getLines' | 'getLinesAsync' | 'getLinesByNumbers' | 'search' | 'searchMulti' | 'getMaxLineLength' | 'getFileInfo' | 'close'
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

    // Drop unresolvable lines (out-of-range global, or a line the member didn't return),
    // preserving request order — this matches FileHandler.getLinesByNumbers, which builds a
    // positional array and filter()s out the misses. Callers key results by .lineNumber.
    const out: LineData[] = [];
    routing.forEach((pos) => {
      if (!pos) return;
      const got = byGlobal.get(this.space.members[pos.fileIndex].startLine + pos.localLine);
      if (got) out.push(got);
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
    // Match cap is GLOBAL across the session, like a single file: hand each member only the
    // remaining budget and stop once it's reached — otherwise N files yield up to N×cap.
    const cap = options.maxMatches ?? DEFAULT_MAX_MATCHES;
    for (let i = 0; i < this.members.length; i++) {
      if (signal?.cancelled) break;
      if (all.length >= cap) break;
      const base = this.space.members[i].startLine;
      const lineCount = this.space.members[i].lineCount;
      const memberOpts: SearchOptions = { ...options, silent: true, maxMatches: cap - all.length };
      // filteredLineIndices arrive in GLOBAL space; translate to this member's LOCAL lines
      // (forwarding them raw would make each member read the wrong lines). A member with no
      // in-range indices contributes nothing, so skip its would-be-empty search.
      if (options.filteredLineIndices) {
        const local: number[] = [];
        for (const g of options.filteredLineIndices) {
          if (g >= base && g < base + lineCount) local.push(g - base);
        }
        if (local.length === 0) {
          onProgress?.(Math.round(((i + 1) / this.members.length) * 100), all.length, []);
          continue;
        }
        memberOpts.filteredLineIndices = local;
      }
      const sub = await this.members[i].handler.search(memberOpts, undefined, signal);
      const rebased = sub.map((m) => ({ ...m, lineNumber: base + m.lineNumber, displayIndex: undefined }));
      all.push(...rebased);
      onProgress?.(Math.round(((i + 1) / this.members.length) * 100), all.length, rebased);
    }
    this.lastSearchEngine = 'composite';
    this.lastSearchReason = `${this.members.length} files`;
    return all;
  }

  // Multi-pattern batch search (Search Configs panel) fanned out over every member and
  // merged into the global line space. Mirrors FileHandler.searchMulti's shape so the
  // SEARCH_CONFIG_BATCH handler can call it uniformly across the FileHandler | Composite
  // union. Each config's match cap is GLOBAL across the whole session (like a single
  // file) — we track a per-config remaining budget so N members can't each yield up to
  // `cap` and blow the budget N×. Streamed deltas (onMatches) and the returned matches
  // both carry GLOBAL line numbers, so the caller's overview/filter logic is unchanged.
  async searchMulti(
    configs: Array<{ id: string; pattern: string; isRegex: boolean; matchCase: boolean; wholeWord: boolean }>,
    onProgress?: (counts: Record<string, number>, overallPercent: number) => void,
    signal?: { cancelled: boolean },
    onMatches?: (deltaByConfig: Record<string, SearchMatch[]>) => void,
    maxMatchesPerConfig: number = DEFAULT_MAX_MATCHES
  ): Promise<Record<string, SearchMatch[]>> {
    const results: Record<string, SearchMatch[]> = {};
    for (const c of configs) results[c.id] = [];
    if (configs.length === 0) return results;

    const remaining: Record<string, number> = {};
    for (const c of configs) remaining[c.id] = maxMatchesPerConfig;

    for (let i = 0; i < this.members.length; i++) {
      if (signal?.cancelled) break;
      // Stop early once every config has hit its global cap — nothing left to find.
      if (configs.every((c) => remaining[c.id] <= 0)) break;
      const base = this.space.members[i].startLine;
      // Only search configs that still have budget; a full one is silently skipped.
      const memberConfigs = configs.filter((c) => remaining[c.id] > 0);
      if (memberConfigs.length === 0) continue;
      const sub = await this.members[i].handler.searchMulti(
        memberConfigs,
        undefined, // fold per-member progress into our own aggregate below
        signal,
        undefined, // emit our own onMatches AFTER rebasing to global line numbers
        maxMatchesPerConfig
      );
      const delta: Record<string, SearchMatch[]> = {};
      for (const c of memberConfigs) {
        const memberMatches = sub[c.id] || [];
        // Respect this config's remaining GLOBAL budget, then rebase local→global lines.
        const take = memberMatches.slice(0, remaining[c.id]);
        if (take.length === 0) continue;
        const rebased = take.map((m) => ({ ...m, lineNumber: base + m.lineNumber, displayIndex: undefined }));
        results[c.id].push(...rebased);
        remaining[c.id] -= rebased.length;
        delta[c.id] = rebased;
      }
      if (onMatches && Object.keys(delta).length > 0) onMatches(delta);
      const counts: Record<string, number> = {};
      for (const c of configs) counts[c.id] = results[c.id].length;
      onProgress?.(counts, Math.round(((i + 1) / this.members.length) * 100));
    }
    this.lastSearchEngine = 'composite';
    this.lastSearchReason = `${this.members.length} files`;
    return results;
  }

  close(): void {
    for (const m of this.members) m.handler.close();
  }
}
