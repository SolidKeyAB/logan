// Pure line-space math for the "Single session" virtual file-concat feature.
//
// Given the line counts of N ordered files, this presents ONE continuous 0-based line
// space and maps a global line to its (fileIndex, localLine), and splits a [start,count)
// global window into per-file sub-ranges. There is NO file IO here — this is the pure,
// unit-tested core that CompositeFileHandler wraps around real FileHandlers, so the
// tricky boundary math is verifiable headlessly. Binary search over cumulative ends
// keeps a global→file lookup O(log N). Empty files (0 lines) are handled and skipped.

export interface CompositeMember {
  /** 0-based global index of this file's first line. */
  startLine: number;
  /** Number of lines this file contributes to the composite. */
  lineCount: number;
}

export interface LocalPos {
  fileIndex: number;
  localLine: number; // 0-based within that file
}

export interface SubRange {
  fileIndex: number;
  localStart: number; // 0-based within the file
  count: number;
}

export class CompositeLineSpace {
  readonly members: CompositeMember[];
  readonly totalLines: number;

  constructor(lineCounts: number[]) {
    let acc = 0;
    this.members = lineCounts.map((n) => {
      const lineCount = Math.max(0, Math.floor(n) || 0);
      const m = { startLine: acc, lineCount };
      acc += lineCount;
      return m;
    });
    this.totalLines = acc;
  }

  /**
   * Global line → { fileIndex, localLine }, or null if out of range. Finds the first
   * member whose end (startLine + lineCount) is strictly past globalLine; empty members
   * have end === start so they are never selected.
   */
  locate(globalLine: number): LocalPos | null {
    if (!Number.isInteger(globalLine) || globalLine < 0 || globalLine >= this.totalLines) return null;
    let lo = 0;
    let hi = this.members.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const m = this.members[mid];
      if (m.startLine + m.lineCount > globalLine) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    if (ans < 0) return null;
    return { fileIndex: ans, localLine: globalLine - this.members[ans].startLine };
  }

  /** (fileIndex, localLine) → global line, or null if the inputs are out of range. */
  toGlobal(fileIndex: number, localLine: number): number | null {
    const m = this.members[fileIndex];
    if (!m || localLine < 0 || localLine >= m.lineCount) return null;
    return m.startLine + localLine;
  }

  /**
   * Split a [start, count) window of the global space into contiguous per-file
   * sub-ranges, in order. Clamps to the available range; returns [] if start is out
   * of range or count <= 0.
   */
  split(start: number, count: number): SubRange[] {
    const out: SubRange[] = [];
    let remaining = Math.min(count, this.totalLines - start);
    let g = start;
    while (remaining > 0) {
      const pos = this.locate(g);
      if (!pos) break;
      const m = this.members[pos.fileIndex];
      const availInFile = m.lineCount - pos.localLine;
      const take = Math.min(remaining, availInFile);
      out.push({ fileIndex: pos.fileIndex, localStart: pos.localLine, count: take });
      remaining -= take;
      g += take;
    }
    return out;
  }

  /** Global line at which each file starts — the boundaries for origin markers. */
  boundaries(): number[] {
    return this.members.map((m) => m.startLine);
  }
}
