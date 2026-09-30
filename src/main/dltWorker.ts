import { parentPort, workerData } from 'worker_threads';
import { parseDltToFile } from './dltParse';

/**
 * Worker-thread entry for DLT decoding. Runs the byte-scan decode off the Electron
 * main/UI event loop. Messages back to the parent mirror the vtrace/mf4 workers:
 *   { type: 'progress', percent }  — periodic progress
 *   { type: 'done' }               — finished, output written to outPath
 *   { type: 'error', message }     — fatal
 */
const { filePath, outPath } = workerData as { filePath: string; outPath: string };

parseDltToFile(filePath, outPath, (percent) => {
  parentPort?.postMessage({ type: 'progress', percent });
})
  .then(() => parentPort?.postMessage({ type: 'done' }))
  .catch((err) => parentPort?.postMessage({
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
  }));
