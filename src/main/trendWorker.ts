import { parentPort, workerData } from 'worker_threads';
import { discoverFields, discoverAxes, extractSeries, extractSignalSeries, detectTransitions, correlate } from './trendEngine';
import { parseTimestampFast } from './timestampParse';
import { WorkerFileReader, CompositeWorkerReader, ScanContext } from './trendWorkerReaders';
import { foldScope } from './summarizeScan';
import { detectFoldRegions } from './foldRegions';
import { computeColumnPreview } from './columnPreview';
import type { FileHandler } from './fileHandler';

/**
 * Worker-thread entry for the Trends/Signals scans. The trend engine is CPU-bound
 * and reads the whole file in batches; running it here keeps the Electron main/UI
 * event loop free so the panel never appears stuck.
 *
 * The parent hands over a byte-offset index (see FileHandler.getScanContext) so this
 * worker can open its OWN fd to the same file and read the exact same lines without
 * sharing the main process's handler. For a "single session" composite the parent
 * hands over ONE scan context per member (`scans`); the CompositeWorkerReader then
 * presents the SAME continuous global line space the CompositeFileHandler does (via
 * the shared, unit-tested CompositeLineSpace) so the engine runs once over the whole
 * session and every line number it returns is already global. Messages back:
 *   { type: 'done', result }     — finished
 *   { type: 'error', message }   — fatal
 */
const { kind, args, scan, scans } = workerData as {
  kind: string; args: any; scan?: ScanContext; scans?: ScanContext[];
};

try {
  // A composite (single session) hands over `scans` (one per member); a plain file hands
  // over a single `scan`. Both expose getTotalLines/getLines, all the engine needs.
  const reader = scans && scans.length
    ? new CompositeWorkerReader(scans.map((s) => new WorkerFileReader(s)))
    : new WorkerFileReader(scan!);
  // The engine only uses getTotalLines/getLines; cast through unknown to satisfy its type.
  const handler = reader as unknown as FileHandler;
  let result: any;
  switch (kind) {
    case 'discover':
      result = discoverFields(handler, args);
      break;
    case 'axes':
      result = discoverAxes(handler, parseTimestampFast, args);
      break;
    case 'series':
      result = extractSeries(handler, parseTimestampFast, args.field, args);
      break;
    case 'signal':
      result = extractSignalSeries(handler, args.fields, args, parseTimestampFast);
      break;
    case 'transitions':
      result = detectTransitions(handler, parseTimestampFast, args.field, args);
      break;
    case 'correlate':
      result = correlate(handler, args.field, args.event, args);
      break;
    case 'summarize':
      // Semantic template fold — same engine the main process uses, run here so a
      // whole-file scan never blocks the Electron UI event loop.
      result = foldScope(reader, args.scope, {
        maxTemplates: args.opts?.maxTemplates,
        maxExamples: args.opts?.maxExamples,
        detectSeverity: args.opts?.detectSeverity,
        detectTimestamp: args.opts?.detectTimestamp,
      });
      break;
    case 'foldRegions':
      // Detect contiguous repeating blocks so the viewer can collapse them.
      // Whole-file fingerprint scan → off-thread so the UI never blocks.
      result = detectFoldRegions(reader, args.opts || {});
      break;
    case 'columnPreview': {
      // Column-pattern "validate + refine over the file" — the heavy path behind
      // "✓ Test over file" / Save. Reading the file head + running a possibly-
      // backtracking regex over it here keeps the UI thread free (a runaway regex
      // hangs only THIS worker, which the client watchdog then terminates).
      const spec = args.spec;
      const N = Math.max(1, Math.min(500, args.opts?.sampleLines ?? 200));
      const lines: string[] = [];
      if (spec?.sample && String(spec.sample).trim()) lines.push(spec.sample);
      const total = reader.getTotalLines();
      const scanTo = Math.min(total, N * 4);
      const BATCH = 2000;
      for (let s = 0; s < scanTo; s += BATCH) {
        for (const l of reader.getLines(s, Math.min(BATCH, scanTo - s))) {
          if (l.text.trim()) lines.push(l.text);
        }
      }
      result = computeColumnPreview(lines, spec, { maxRows: N, doScan: true });
      break;
    }
    default:
      throw new Error(`Unknown trend job kind: ${kind}`);
  }
  reader.close();
  parentPort?.postMessage({ type: 'done', result });
} catch (err) {
  parentPort?.postMessage({
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
  });
}
