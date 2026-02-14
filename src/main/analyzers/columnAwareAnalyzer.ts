import * as fs from 'fs';
import {
  LogAnalyzer,
  AnalyzerOptions,
  AnalyzeProgress,
  AnalysisResult,
  CrashEntry,
  FailingComponent,
  FilterSuggestion,
  AnalysisInsights
} from './types';

const KNOWN_COLUMNS = {
  channel: ['channel', 'component', 'module', 'category', 'logger'],
  source: ['source', 'process', 'thread', 'origin', 'class'],
  level: ['level', 'severity', 'loglevel', 'priority'],
  message: ['message', 'msg', 'text', 'content', 'description'],
  timestamp: ['time', 'timestamp', 'date', 'datetime', 'loggertime', 'tracetime'],
};

interface ColumnInfo {
  index: number;
  name: string;
  type: 'channel' | 'source' | 'level' | 'message' | 'timestamp' | 'other';
}

const CRASH_REGEX = /\b(fatal|crash|exception|panic|oom|out.of.memory|segfault|abort|core.dump|stack.overflow|unhandled|killed|sigsegv)\b/i;
const MAX_CRASHES = 50;

export class ColumnAwareAnalyzer implements LogAnalyzer {
  name = 'column-aware';
  description = 'Analyzes logs for crashes, error counts, failing components & filter suggestions';

  async analyze(
    filePath: string,
    options: AnalyzerOptions,
    onProgress?: (progress: AnalyzeProgress) => void,
    signal?: { cancelled: boolean }
  ): Promise<AnalysisResult> {
    try {
      onProgress?.({ phase: 'reading', percent: 0, message: 'Detecting column structure...' });

      let columns: ColumnInfo[] = [];
      try {
        columns = await this.detectColumns(filePath);
      } catch (e) {
        console.error('Error detecting columns:', e);
      }

      onProgress?.({ phase: 'parsing', percent: 5, message: 'Analyzing log messages...' });

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      let bytesRead = 0;
      let lineNumber = 0;
      let lastProgressUpdate = Date.now();

      // Data collection
      const levelCounts: Record<string, number> = {
        error: 0, warning: 0, info: 0, debug: 0, trace: 0
      };

      // Crash tracking
      const crashes: CrashEntry[] = [];

      // Per-component error tracking
      const componentErrors = new Map<string, { errors: number; warnings: number; firstErrorLine: number }>();

      // Column indices
      const channelCol = columns.find(c => c.type === 'channel');
      const sourceCol = columns.find(c => c.type === 'source');
      const levelCol = columns.find(c => c.type === 'level');
      const messageCol = columns.find(c => c.type === 'message');

      let firstTimestamp: string | null = null;
      let lastTimestamp: string | null = null;

      const MAX_LINE_LENGTH = 500;
      const CHUNK_SIZE = 1024 * 1024; // 1MB
      const readBuffer = Buffer.alloc(CHUNK_SIZE);
      const fd = fs.openSync(filePath, 'r');
      let lineBuffer = '';
      let lineBufferFull = false;

      const processLine = (line: string): void => {
        lineNumber++;
        bytesRead += line.length + 1;

        if (lineNumber === 1 && this.looksLikeHeader(line)) return;
        if (!line.trim() || line.startsWith('#')) return;

        const fields = this.splitLine(line);

        // Extract channel/source for component name
        let componentName: string | undefined;
        if (channelCol && fields[channelCol.index]) {
          const ch = fields[channelCol.index].trim();
          if (ch && ch !== '--' && ch !== '-') {
            componentName = ch;
          }
        }
        if (!componentName && sourceCol && fields[sourceCol.index]) {
          const src = fields[sourceCol.index].trim();
          if (src && src !== '--' && src !== '-') {
            componentName = this.simplifySource(src);
          }
        }

        // Extract level
        let level: string | undefined;
        if (levelCol && fields[levelCol.index]) {
          const rawLevel = fields[levelCol.index].trim().toLowerCase();
          level = this.normalizeLevel(rawLevel) || undefined;
        } else {
          level = this.detectLevelFromText(line) || undefined;
        }
        if (level) levelCounts[level]++;

        // Extract message text
        let message = '';
        if (messageCol && fields[messageCol.index]) {
          message = fields[messageCol.index].trim();
        } else if (fields.length > 0) {
          message = fields[fields.length - 1].trim();
        }

        // Crash keyword detection
        if (crashes.length < MAX_CRASHES) {
          const textToCheck = message || line;
          const crashMatch = textToCheck.match(CRASH_REGEX);
          if (crashMatch) {
            crashes.push({
              text: textToCheck.length > 200 ? textToCheck.substring(0, 200) + '...' : textToCheck,
              lineNumber,
              level,
              channel: componentName,
              keyword: crashMatch[1].toLowerCase()
            });
          }
        }

        // Per-component error/warning tracking
        if (componentName && (level === 'error' || level === 'warning')) {
          const existing = componentErrors.get(componentName);
          if (existing) {
            if (level === 'error') {
              existing.errors++;
              if (existing.firstErrorLine === 0) existing.firstErrorLine = lineNumber;
            }
            if (level === 'warning') existing.warnings++;
          } else {
            componentErrors.set(componentName, {
              errors: level === 'error' ? 1 : 0,
              warnings: level === 'warning' ? 1 : 0,
              firstErrorLine: level === 'error' ? lineNumber : 0
            });
          }
        }

        // Timestamp - check first 100 chars only
        const tsSample = line.length > 100 ? line.substring(0, 100) : line;
        const tsMatch = tsSample.match(/(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})|(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
        if (tsMatch) {
          if (!firstTimestamp) firstTimestamp = tsMatch[0];
          lastTimestamp = tsMatch[0];
        }

        // Progress
        const now = Date.now();
        if (now - lastProgressUpdate > 200) {
          lastProgressUpdate = now;
          const percent = Math.round(5 + (bytesRead / fileSize) * 75);
          onProgress?.({ phase: 'parsing', percent, message: `Line ${lineNumber.toLocaleString()}...` });
        }
      };

      try {
        let filePos = 0;
        while (filePos < fileSize) {
          if (signal?.cancelled) break;

          const bytesReadChunk = fs.readSync(fd, readBuffer, 0, CHUNK_SIZE, filePos);
          if (bytesReadChunk === 0) break;
          filePos += bytesReadChunk;

          const chunk = readBuffer.toString('utf-8', 0, bytesReadChunk);

          for (let i = 0; i < chunk.length; i++) {
            const ch = chunk[i];
            if (ch === '\n' || ch === '\r') {
              processLine(lineBuffer);
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
        }

        if (lineBuffer.length > 0) {
          processLine(lineBuffer);
        }
      } finally {
        fs.closeSync(fd);
      }

      if (signal?.cancelled) {
        return this.emptyResult();
      }

      onProgress?.({ phase: 'analyzing', percent: 85, message: 'Generating insights...' });

      // Build insights
      const insights = this.buildInsights(crashes, componentErrors, levelCounts, lineNumber);

      onProgress?.({ phase: 'done', percent: 100, message: 'Analysis complete' });

      return {
        stats: {
          totalLines: lineNumber,
          analyzedLines: lineNumber,
        },
        levelCounts,
        timeRange: firstTimestamp && lastTimestamp
          ? { start: firstTimestamp, end: lastTimestamp }
          : undefined,
        analyzerName: this.name,
        analyzedAt: Date.now(),
        insights
      };

    } catch (error) {
      console.error('ColumnAwareAnalyzer error:', error);
      return this.emptyResult();
    }
  }

  private buildInsights(
    crashes: CrashEntry[],
    componentErrors: Map<string, { errors: number; warnings: number; firstErrorLine: number }>,
    levelCounts: Record<string, number>,
    totalLines: number
  ): AnalysisInsights {

    // Top failing components - sorted by error count, top 5
    const topFailingComponents: FailingComponent[] = [...componentErrors.entries()]
      .filter(([, v]) => v.errors > 0)
      .sort((a, b) => b[1].errors - a[1].errors)
      .slice(0, 5)
      .map(([name, v]) => ({
        name,
        errorCount: v.errors,
        warningCount: v.warnings,
        sampleLine: v.firstErrorLine
      }));

    // Filter suggestions
    const filterSuggestions: FilterSuggestion[] = [];
    const errorCount = levelCounts.error || 0;
    const warningCount = levelCounts.warning || 0;
    const debugCount = (levelCounts.debug || 0) + (levelCounts.trace || 0);

    // "Show errors only" — if errors > 0 and < 50%
    if (errorCount > 0 && errorCount < totalLines * 0.5) {
      filterSuggestions.push({
        id: 'filter-errors-only',
        title: 'Show errors only',
        description: `Focus on ${errorCount.toLocaleString()} error lines`,
        type: 'level',
        filter: { levels: ['error'] }
      });
    }

    // "Show errors & warnings" — if (err+warn) > 0 and < 50%
    if ((errorCount + warningCount) > 0 && (errorCount + warningCount) < totalLines * 0.5) {
      filterSuggestions.push({
        id: 'filter-errors-warnings',
        title: 'Show errors & warnings',
        description: `Focus on ${(errorCount + warningCount).toLocaleString()} error/warning lines`,
        type: 'level',
        filter: { levels: ['error', 'warning'] }
      });
    }

    // "Errors from [Component]" — top 3 components with >5 errors
    const topErrorComponents = topFailingComponents.filter(c => c.errorCount > 5).slice(0, 3);
    for (const comp of topErrorComponents) {
      filterSuggestions.push({
        id: `filter-component-${comp.name}`,
        title: `Errors from ${comp.name}`,
        description: `${comp.errorCount.toLocaleString()} errors from this component`,
        type: 'include',
        filter: {
          includePatterns: [comp.name],
          levels: ['error']
        }
      });
    }

    // "Hide debug/trace" — if debug+trace > 30%
    if (totalLines > 0 && debugCount > totalLines * 0.3) {
      filterSuggestions.push({
        id: 'filter-no-debug',
        title: 'Hide debug/trace',
        description: `Remove ${debugCount.toLocaleString()} debug messages (${Math.round(debugCount / totalLines * 100)}% of file)`,
        type: 'level',
        filter: { levels: ['error', 'warning', 'info'] }
      });
    }

    return {
      crashes,
      topFailingComponents,
      filterSuggestions
    };
  }

  private normalizeLevel(rawLevel: string): string | null {
    if (/^(error|fatal|critical|severe)$/.test(rawLevel)) return 'error';
    if (/^(warn|warning)$/.test(rawLevel)) return 'warning';
    if (/^(info|information)$/.test(rawLevel)) return 'info';
    if (/^debug$/.test(rawLevel)) return 'debug';
    if (/^(trace|verbose)$/.test(rawLevel)) return 'trace';
    return null;
  }

  private detectLevelFromText(text: string): string | null {
    const upper = (text.length > 200 ? text.substring(0, 200) : text).toUpperCase();
    if (/\b(ERROR|FATAL|CRITICAL|EXCEPTION|PANIC)\b/.test(upper)) return 'error';
    if (/\b(WARN|WARNING)\b/.test(upper)) return 'warning';
    if (/\b(INFO)\b/.test(upper)) return 'info';
    if (/\b(DEBUG)\b/.test(upper)) return 'debug';
    if (/\b(TRACE|VERBOSE)\b/.test(upper)) return 'trace';
    return null;
  }

  private async detectColumns(filePath: string): Promise<ColumnInfo[]> {
    const columns: ColumnInfo[] = [];

    const buf = Buffer.alloc(8192);
    const fd = fs.openSync(filePath, 'r');
    let headerLine: string | null = null;
    try {
      const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
      const text = buf.toString('utf-8', 0, bytesRead);
      const lines = text.split(/\r?\n/).slice(0, 10);
      for (const line of lines) {
        if (line.startsWith('#')) continue;
        if (this.looksLikeHeader(line)) {
          headerLine = line;
          break;
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    if (!headerLine) return columns;

    const headers = this.splitLine(headerLine);
    for (let i = 0; i < headers.length; i++) {
      const name = headers[i].trim().toLowerCase();
      let type: ColumnInfo['type'] = 'other';

      for (const [colType, keywords] of Object.entries(KNOWN_COLUMNS)) {
        if (keywords.some(k => name.includes(k))) {
          type = colType as ColumnInfo['type'];
          break;
        }
      }
      columns.push({ index: i, name: headers[i].trim(), type });
    }

    return columns;
  }

  private splitLine(line: string): string[] {
    return line.split(/\t|\s{2,}/).filter(f => f.length > 0);
  }

  private looksLikeHeader(line: string): boolean {
    const lower = line.toLowerCase();
    const headerWords = ['packetid', 'sessionid', 'timestamp', 'level', 'message',
                         'channel', 'source', 'component', 'logger', 'time'];
    return headerWords.filter(w => lower.includes(w)).length >= 2;
  }

  private simplifySource(source: string): string {
    const dotIndex = source.indexOf('.');
    return dotIndex > 0 ? source.substring(0, dotIndex) : source;
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
