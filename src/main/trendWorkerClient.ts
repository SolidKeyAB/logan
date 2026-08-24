import { Worker } from 'worker_threads';
import * as path from 'path';
import type { FileHandler } from './fileHandler';
import { CompositeFileHandler } from './compositeFileHandler';
import { SegmentedFileHandler } from './segmentedFileHandler';

/**
 * Main-process client for the trend worker. Gets the (cached) byte-offset index of the
 * currently-open file, spawns src/main/trendWorker.js to run the scan off-thread, and
 * resolves with the engine's result — so the UI never blocks on a big file.
 *
 * The offsets/lengths are backed by SharedArrayBuffers, so handing them to the worker is
 * zero-copy and zero-transfer (shared by reference). Nothing big is serialized per call.
 *
 * For a "single session" composite the handler is a CompositeFileHandler: we hand over one
 * scan context PER MEMBER and let the worker present the unified global line space, so the
 * engine runs once (in ONE worker) over the whole session — no per-member fan-out/merge.
 */
export type TrendJobKind = 'discover' | 'axes' | 'series' | 'signal' | 'transitions' | 'correlate';

export function runTrendJob(kind: TrendJobKind, handler: FileHandler | CompositeFileHandler | SegmentedFileHandler, args: any): Promise<any> {
  // Trends run off-thread from a resident scan context (offsets/lengths SharedArrayBuffer).
  // An auto-segmented file deliberately holds no whole-file index (only a few hot segments,
  // LRU-bounded), so there's nothing to hand the worker without materializing the full index
  // — which would defeat the RAM budget. Disable trends in segmented mode (like filter/split).
  if (handler instanceof SegmentedFileHandler) {
    return Promise.reject(new Error('Trends are not available for auto-segmented large files.'));
  }
  let workerData: { kind: TrendJobKind; args: any; scan?: unknown; scans?: unknown[] };
  if (handler instanceof CompositeFileHandler) {
    const scans = handler.getMemberScanContexts();
    if (scans.length === 0 || scans.some((s) => !s)) {
      return Promise.reject(new Error('Single session has no readable member index'));
    }
    workerData = { kind, args, scans };
  } else {
    const scan = handler.getScanContext();
    if (!scan) return Promise.reject(new Error('No file open'));
    workerData = { kind, args, scan };
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'trendWorker.js'), {
      workerData,
    });
    let settled = false;
    const finish = (err?: Error, result?: any): void => {
      if (settled) return;
      settled = true;
      worker.terminate();
      if (err) reject(err); else resolve(result);
    };
    worker.on('message', (msg: { type: string; result?: any; message?: string }) => {
      if (msg?.type === 'done') finish(undefined, msg.result);
      else if (msg?.type === 'error') finish(new Error(msg.message || 'trend worker error'));
    });
    worker.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
    worker.on('exit', (code) => { if (code !== 0) finish(new Error(`trend worker exited with code ${code}`)); });
  });
}

// ─── Summarize (semantic template fold) off-thread ───────────────────────────
// Runs the TemplateFolder in the SAME worker (kind:'summarize') so a whole-file
// fold never blocks the Electron UI. `scope` is the already-resolved scope from
// the main process (a contiguous range or an explicit 0-based index set); the
// worker reads only those lines. Segmented big files hold no whole-file index to
// hand over, so the caller keeps its main-thread path for them.
type SummarizeScopeArg =
  | { kind: 'range'; startLine: number; endLine: number }
  | { kind: 'indices'; lines: number[] };

let activeSummarizeWorker: Worker | null = null;
let summarizeCancelled = false;

/** Terminate an in-flight summarize worker (the ⏹/Cancel button). No-op if idle. */
export function cancelSummarizeJob(): void {
  if (activeSummarizeWorker) {
    summarizeCancelled = true;
    try { activeSummarizeWorker.terminate(); } catch { /* already gone */ }
  }
}

/** True when the current handler can be summarized off-thread (not auto-segmented). */
export function canSummarizeOffThread(handler: FileHandler | CompositeFileHandler | SegmentedFileHandler): boolean {
  return !(handler instanceof SegmentedFileHandler);
}

export function runSummarizeJob(
  handler: FileHandler | CompositeFileHandler | SegmentedFileHandler,
  opts: { maxTemplates?: number; maxExamples?: number; detectSeverity?: boolean; detectTimestamp?: boolean },
  scope: SummarizeScopeArg,
): Promise<any> {
  if (handler instanceof SegmentedFileHandler) {
    return Promise.reject(new Error('Summarize is not available off-thread for auto-segmented large files.'));
  }
  let workerData: { kind: 'summarize'; args: { opts: typeof opts; scope: SummarizeScopeArg }; scan?: unknown; scans?: unknown[] };
  if (handler instanceof CompositeFileHandler) {
    const scans = handler.getMemberScanContexts();
    if (scans.length === 0 || scans.some((s) => !s)) {
      return Promise.reject(new Error('Single session has no readable member index'));
    }
    workerData = { kind: 'summarize', args: { opts, scope }, scans };
  } else {
    const scan = handler.getScanContext();
    if (!scan) return Promise.reject(new Error('No file open'));
    workerData = { kind: 'summarize', args: { opts, scope }, scan };
  }
  summarizeCancelled = false;
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'trendWorker.js'), { workerData });
    activeSummarizeWorker = worker;
    let settled = false;
    const finish = (err?: Error, result?: any): void => {
      if (settled) return;
      settled = true;
      if (activeSummarizeWorker === worker) activeSummarizeWorker = null;
      worker.terminate();
      if (err) reject(err); else resolve(result);
    };
    worker.on('message', (msg: { type: string; result?: any; message?: string }) => {
      if (msg?.type === 'done') finish(undefined, msg.result);
      else if (msg?.type === 'error') finish(new Error(msg.message || 'summarize worker error'));
    });
    worker.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
    worker.on('exit', (code) => {
      if (code !== 0) finish(new Error(summarizeCancelled ? 'Cancelled' : `summarize worker exited with code ${code}`));
    });
  });
}
