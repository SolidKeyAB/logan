import { parseTimestampFast } from './timestampParse';

export interface TimeGap {
  lineNumber: number;      // 0-based line where the gap lands (the later line)
  prevLineNumber: number;  // 0-based previous timestamped line
  gapSeconds: number;
  prevTimestamp: string;
  currTimestamp: string;
  linePreview: string;
}

// Streaming gap detector. Lines are fed in order (whole-file or scoped); it holds
// only the previous timestamp, so it works over an arbitrary line-set without
// materializing the file. Extracted from the inline detectTimeGaps loop so the
// same logic serves the whole-file and scoped paths and is unit-testable.
export class GapDetector {
  readonly gaps: TimeGap[] = [];
  private prevTimestamp: Date | null = null;
  private prevTimestampStr: string | null = null;
  private prevLineNumber = 0;

  constructor(private readonly thresholdSeconds: number, private readonly maxGaps = 500) {}

  get full(): boolean {
    return this.gaps.length >= this.maxGaps;
  }

  feed(lineNumber: number, text: string): void {
    if (this.full) return;
    const parsed = parseTimestampFast(text);
    if (parsed && this.prevTimestamp) {
      const diffSeconds = (parsed.date.getTime() - this.prevTimestamp.getTime()) / 1000;
      if (Math.abs(diffSeconds) >= this.thresholdSeconds) {
        this.gaps.push({
          lineNumber,
          prevLineNumber: this.prevLineNumber,
          gapSeconds: Math.abs(diffSeconds),
          prevTimestamp: this.prevTimestampStr || '',
          currTimestamp: parsed.str,
          linePreview: text.length > 80 ? text.substring(0, 80) + '...' : text,
        });
      }
    }
    if (parsed) {
      this.prevTimestamp = parsed.date;
      this.prevTimestampStr = parsed.str;
      this.prevLineNumber = lineNumber;
    }
  }

  // Gaps sorted largest-first (the order the endpoint returns).
  sorted(): TimeGap[] {
    return [...this.gaps].sort((a, b) => b.gapSeconds - a.gapSeconds);
  }
}
