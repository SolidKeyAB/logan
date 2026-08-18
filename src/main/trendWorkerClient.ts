import { Worker } from 'worker_threads';
import * as path from 'path';
import type { FileHandler } from './fileHandler';
import { CompositeFileHandler } from './compositeFileHandler';

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

export function runTrendJob(kind: TrendJobKind, handler: FileHandler | CompositeFileHandler, args: any): Promise<any> {
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
