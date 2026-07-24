import { parentPort, workerData } from 'worker_threads';
import { scanFileIndex } from './indexScan';

/**
 * Worker-thread entry for the file line-index scan (see indexScan.ts). Building the
 * byte-offset index for a big file (24M-line logcat) is CPU-bound; running it here
 * keeps the Electron main/UI event loop free so opening the file never hangs.
 *
 * Messages back to the parent:
 *   { type: 'progress', percent }                      — indexing progress (0-100)
 *   { type: 'done', offsets, lengths, ...metadata }    — finished (arrays transferred)
 *   { type: 'error', message }                         — fatal
 */
const { filePath } = workerData as { filePath: string };

try {
  let lastPct = -1;
  const result = scanFileIndex(filePath, (percent) => {
    if (percent !== lastPct) {
      lastPct = percent;
      parentPort?.postMessage({ type: 'progress', percent });
    }
  });

  // Transfer the array buffers (zero-copy) rather than cloning multi-million-entry arrays.
  parentPort?.postMessage(
    {
      type: 'done',
      offsets: result.offsets,
      lengths: result.lengths,
      totalLines: result.totalLines,
      maxLineLength: result.maxLineLength,
      headerLineCount: result.headerLineCount,
      splitMetadata: result.splitMetadata,
      hasStandaloneCR: result.hasStandaloneCR,
    },
    // scanFileIndex returns slice()d arrays, so .buffer is a plain (transferable) ArrayBuffer.
    [result.offsets.buffer as ArrayBuffer, result.lengths.buffer as ArrayBuffer]
  );
} catch (err) {
  parentPort?.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
}
