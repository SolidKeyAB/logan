import * as fs from 'fs';
import {
  LogAnalyzer,
  AnalyzerOptions,
  AnalyzeProgress,
  AnalysisResult,
} from './types';
import {
  AnalysisAccumulator,
  ColumnInfo,
  detectColumns,
  looksLikeHeader,
} from './lineClassify';

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

export class ColumnAwareAnalyzer implements LogAnalyzer {
  name = 'column-aware';
  description = 'Analyzes logs for crashes, error counts, failing components & filter suggestions';

  async analyze(
    filePath: string,
    _options: AnalyzerOptions,
    onProgress?: (progress: AnalyzeProgress) => void,
    signal?: { cancelled: boolean }
  ): Promise<AnalysisResult> {
    try {
      onProgress?.({ phase: 'reading', percent: 0, message: 'Detecting column structure...' });

      let columns: ColumnInfo[] = [];
      try {
        columns = await detectColumns(filePath);
      } catch (e) {
        console.error('Error detecting columns:', e);
      }

      onProgress?.({ phase: 'parsing', percent: 5, message: 'Analyzing log messages...' });

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      let lineNumber = 0;
      let lastProgressUpdate = Date.now();

      // Classification (level counts, crashes, component errors, timestamp span)
      // is delegated to the shared accumulator so the scoped analyzer stays in lockstep.
      const acc = new AnalysisAccumulator(columns);

      // Density buckets — adaptive count based on file size (500–10,000)
      // Used by the minimap to draw a heat map by log level. These stay here because
      // they are keyed by true byte position, which only the whole-file scan knows.
      const DENSITY_BUCKETS = Math.min(Math.max(Math.ceil(fileSize / 500), 500), 10000);
      const densityFatal = new Uint32Array(DENSITY_BUCKETS);
      const densityError = new Uint32Array(DENSITY_BUCKETS);
      const densityWarning = new Uint32Array(DENSITY_BUCKETS);
      const densityInfo = new Uint32Array(DENSITY_BUCKETS);
      const densityDebug = new Uint32Array(DENSITY_BUCKETS);
      const densityVerbose = new Uint32Array(DENSITY_BUCKETS);

      const MAX_LINE_LENGTH = 500;
      const CHUNK_SIZE = 1024 * 1024; // 1MB
      const readBuffer = Buffer.alloc(CHUNK_SIZE);
      const fd = fs.openSync(filePath, 'r');
      let lineBuffer = '';
      let lineBufferFull = false;

      // atByte = true byte offset of this line in the file (interpolated from
      // actual chunk bytes by the read loop). Used for the density heatmap and
      // progress. NOT derived from line.length, which is a UTF-16 char count and
      // undercounts for long lines (capped at MAX_LINE_LENGTH), CRLF and
      // multi-byte UTF-8 — that drift left the minimap's tail black on big files.
      const processLine = (line: string, atByte: number): void => {
        lineNumber++;

        if (lineNumber === 1 && looksLikeHeader(line)) return;

        const level = acc.feed(line, lineNumber);
        if (level) {
          // Update density bucket based on true byte position
          const bucket = Math.min(DENSITY_BUCKETS - 1, Math.floor((atByte / fileSize) * DENSITY_BUCKETS));
          if (level === 'fatal') densityFatal[bucket]++;
          else if (level === 'error') densityError[bucket]++;
          else if (level === 'warning') densityWarning[bucket]++;
          else if (level === 'info') densityInfo[bucket]++;
          else if (level === 'debug') densityDebug[bucket]++;
          else if (level === 'verbose') densityVerbose[bucket]++;
        }

        // Progress
        const now = Date.now();
        if (now - lastProgressUpdate > 200) {
          lastProgressUpdate = now;
          const percent = Math.round(5 + (atByte / fileSize) * 75);
          onProgress?.({ phase: 'parsing', percent, message: `Line ${lineNumber.toLocaleString()}...` });
        }
      };

      try {
        let filePos = 0;
        while (filePos < fileSize) {
          if (signal?.cancelled) break;

          const chunkStartByte = filePos;
          const bytesReadChunk = fs.readSync(fd, readBuffer, 0, CHUNK_SIZE, filePos);
          if (bytesReadChunk === 0) break;
          filePos += bytesReadChunk;

          const chunk = readBuffer.toString('utf-8', 0, bytesReadChunk);
          const chunkChars = chunk.length || 1;

          for (let i = 0; i < chunk.length; i++) {
            const ch = chunk[i];
            if (ch === '\n' || ch === '\r') {
              // Interpolate the line's true byte offset from chars-consumed × the
              // chunk's real byte count (char≠byte for multi-byte/CRLF/long lines).
              const atByte = chunkStartByte + Math.round(((i + 1) / chunkChars) * bytesReadChunk);
              processLine(lineBuffer, atByte);
              lineBuffer = '';
              lineBufferFull = false;
              if (ch === '\r' && i + 1 < chunk.length && chunk[i + 1] === '\n') {
                i++;
              }
            } else if (!lineBufferFull) {
              lineBuffer += ch;
              if (lineBuffer.length >= MAX_LINE_LENGTH) {
                lineBufferFull = true;
              }
            }
          }

          // Yield to event loop every chunk so Electron UI stays responsive
          if (filePos < fileSize) {
            await yieldToEventLoop();
          }
        }

        if (lineBuffer.length > 0) {
          processLine(lineBuffer, fileSize);
        }
      } finally {
        fs.closeSync(fd);
      }

      if (signal?.cancelled) {
        return this.emptyResult();
      }

      onProgress?.({ phase: 'analyzing', percent: 85, message: 'Generating insights...' });

      const insights = acc.buildInsights(lineNumber);

      onProgress?.({ phase: 'done', percent: 100, message: 'Analysis complete' });

      return {
        stats: {
          totalLines: lineNumber,
          analyzedLines: lineNumber,
        },
        levelCounts: acc.levelCounts,
        timeRange: acc.firstTimestamp && acc.lastTimestamp
          ? { start: acc.firstTimestamp, end: acc.lastTimestamp }
          : undefined,
        analyzerName: this.name,
        analyzedAt: Date.now(),
        insights,
        density: {
          buckets: DENSITY_BUCKETS,
          fatal: Array.from(densityFatal),
          error: Array.from(densityError),
          warning: Array.from(densityWarning),
          info: Array.from(densityInfo),
          debug: Array.from(densityDebug),
          verbose: Array.from(densityVerbose),
        }
      };

    } catch (error) {
      console.error('ColumnAwareAnalyzer error:', error);
      return this.emptyResult();
    }
  }

  private emptyResult(): AnalysisResult {
    return {
      stats: { totalLines: 0, analyzedLines: 0 },
      levelCounts: { error: 0, warning: 0, info: 0, debug: 0, trace: 0 },
      analyzerName: this.name,
      analyzedAt: Date.now(),
      insights: {
        crashes: [],
        topFailingComponents: [],
        filterSuggestions: []
      }
    };
  }
}
