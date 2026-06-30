import { parentPort, workerData } from 'worker_threads';
import { parseMdf4ToFile } from './mf4Parse';

/**
 * Worker-thread entry for MF4 parsing. Runs the CPU-heavy parse off the Electron
 * main/UI event loop. Messages back to the parent:
 *   { type: 'progress', percent }  — periodic progress
 *   { type: 'done' }               — finished, output written to outPath
 *   { type: 'error', message }     — fatal (e.g. not an MDF file, OOM)
 */
const { filePath, outPath } = workerData as { filePath: string; outPath: string };

parseMdf4ToFile(filePath, outPath, (percent) => {
  parentPort?.postMessage({ type: 'progress', percent });
})
  .then(() => parentPort?.postMessage({ type: 'done' }))
  .catch((err) => parentPort?.postMessage({
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
  }));
