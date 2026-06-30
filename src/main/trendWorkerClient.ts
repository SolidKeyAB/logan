import { Worker } from 'worker_threads';
import * as path from 'path';
import type { FileHandler } from './fileHandler';

/**
 * Main-process client for the trend worker. Builds a byte-offset snapshot of the
 * currently-open file, spawns src/main/trendWorker.js to run the scan off-thread,
 * and resolves with the engine's result — so the UI never blocks on a big file.
 *
 * The offsets/lengths ArrayBuffers are TRANSFERRED (zero-copy) to the worker; the
 * snapshot is built fresh per call, so detaching it on the main side is harmless.
 */
export type TrendJobKind = 'discover' | 'series' | 'signal' | 'transitions' | 'correlate';

export function runTrendJob(kind: TrendJobKind, handler: FileHandler, args: any): Promise<any> {
  const scan = handler.getScanContext();
  if (!scan) return Promise.reject(new Error('No file open'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'trendWorker.js'), {
      workerData: { kind, args, scan },
      transferList: [scan.offsets.buffer as ArrayBuffer, scan.lengths.buffer as ArrayBuffer],
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
