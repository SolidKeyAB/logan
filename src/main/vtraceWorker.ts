import { parentPort, workerData } from 'worker_threads';
import { parseVtraceToFile } from './vtraceParse';

/**
 * Worker-thread entry for vtrace decoding. Runs the byte-scan decode off the
 * Electron main/UI event loop. Messages back to the parent mirror the MF4 worker:
 *   { type: 'progress', percent }  — periodic progress
 *   { type: 'done' }               — finished, output written to outPath
 *   { type: 'error', message }     — fatal (e.g. not a vtrace file)
 */
const { filePath, outPath } = workerData as { filePath: string; outPath: string };

parseVtraceToFile(filePath, outPath, (percent) => {
  parentPort?.postMessage({ type: 'progress', percent });
})
  .then(() => parentPort?.postMessage({ type: 'done' }))
  .catch((err) => parentPort?.postMessage({
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
  }));
