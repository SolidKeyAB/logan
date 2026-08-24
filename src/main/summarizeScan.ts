// Pure scope-fold used by the summarize worker (src/main/trendWorker.ts,
// kind:'summarize'). Split out of the worker ENTRY (which runs on import) so the
// fold is importable and unit-testable headlessly without spawning a worker —
// the same reason the readers live in trendWorkerReaders.ts.
//
// Folds the lines of a resolved scope into their distinct message TEMPLATES over
// any LineReader (a worker file reader, a composite reader, or an in-memory fake).
// 0-based lineNumber → 1-based viewerLine. Batched for a contiguous range,
// per-line for an explicit index set — the off-thread twin of the main process's
// forEachScopeLine.

import { TemplateFolder, TemplateSummary } from './logTemplates';
import type { LineReader } from './trendWorkerReaders';

export type SummarizeScope =
  | { kind: 'range'; startLine: number; endLine: number }
  | { kind: 'indices'; lines: number[] };

export interface FoldOpts {
  maxTemplates?: number;
  maxExamples?: number;
  detectSeverity?: boolean;
  detectTimestamp?: boolean;
}

export function feedScope(reader: LineReader, scope: SummarizeScope | undefined, folder: TemplateFolder): void {
  if (scope && scope.kind === 'indices') {
    const lines = scope.lines || [];
    for (let k = 0; k < lines.length; k++) {
      const got = reader.getLines(lines[k], 1);
      if (got.length) folder.feed(got[0].text, got[0].lineNumber + 1);
    }
    return;
  }
  const total = reader.getTotalLines();
  const start = scope && typeof scope.startLine === 'number' ? Math.max(0, scope.startLine) : 0;
  const end = scope && typeof scope.endLine === 'number' ? Math.min(total - 1, scope.endLine) : total - 1;
  const BATCH = 5000;
  for (let s = start; s <= end; s += BATCH) {
    const count = Math.min(BATCH, end - s + 1);
    for (const line of reader.getLines(s, count)) folder.feed(line.text, line.lineNumber + 1);
  }
}

export function foldScope(reader: LineReader, scope: SummarizeScope | undefined, opts: FoldOpts): TemplateSummary {
  const folder = new TemplateFolder(opts);
  feedScope(reader, scope, folder);
  return folder.finish();
}
