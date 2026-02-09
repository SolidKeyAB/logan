import * as fs from 'fs';
import {
  LogAnalyzer,
  AnalyzerOptions,
  AnalyzeProgress,
  AnalysisResult,
  PatternGroup,
  DuplicateGroup,
  ColumnStats,
  NoiseCandidate,
  ErrorGroup,
  Anomaly,
  FilterSuggestion,
  AnalysisInsights
} from './types';

/**
 * Column-Aware Log Analyzer
 *
 * Provides actionable insights:
 * 1. Noise Detection - high-frequency messages to filter out
 * 2. Error Grouping - similar errors grouped together
 * 3. Anomalies - rare messages that might be important
 * 4. Filter Suggestions - actionable filter recommendations
 */

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

interface MessageInfo {
  pattern: string;
  sample: string;
  count: number;
  level?: string;
  channel?: string;
  firstLine: number;
  lastLine: number;
}

export class ColumnAwareAnalyzer implements LogAnalyzer {
  name = 'column-aware';
  description = 'Smart analyzer with noise detection, error grouping & anomalies';

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
      const channelCounts = new Map<string, number>();
      const sourceCounts = new Map<string, number>();
      const levelCounts: Record<string, number> = {
        error: 0, warning: 0, info: 0, debug: 0, trace: 0
      };

      // Message tracking for insights
      const messageMap = new Map<string, MessageInfo>();
      const errorMessages: MessageInfo[] = [];
      const rareMessages: Array<{ text: string; line: number; level?: string; channel?: string }> = [];

      // Column indices
      const channelCol = columns.find(c => c.type === 'channel');
      const sourceCol = columns.find(c => c.type === 'source');
      const levelCol = columns.find(c => c.type === 'level');
      const messageCol = columns.find(c => c.type === 'message');

      let firstTimestamp: string | null = null;
      let lastTimestamp: string | null = null;

      // Use chunked reading instead of readline to prevent OOM on files with
      // extremely long lines. readline buffers entire lines in memory.
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

        // Extract channel
        let channel: string | undefined;
        if (channelCol && fields[channelCol.index]) {
          channel = fields[channelCol.index].trim();
          if (channel && channel !== '--' && channel !== '-') {
            channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1);
          } else {
            channel = undefined;
          }
        }

        // Extract source (simplified)
        if (sourceCol && fields[sourceCol.index]) {
          const source = fields[sourceCol.index].trim();
          if (source && source !== '--' && source !== '-') {
            const simpleSource = this.simplifySource(source);
            sourceCounts.set(simpleSource, (sourceCounts.get(simpleSource) || 0) + 1);
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

        // Extract and analyze message
        let message = '';
        if (messageCol && fields[messageCol.index]) {
          message = fields[messageCol.index].trim();
        } else if (fields.length > 0) {
          message = fields[fields.length - 1].trim();
        }

        if (message) {
          const pattern = this.extractPattern(message);
          const existing = messageMap.get(pattern);

          if (existing) {
            existing.count++;
            existing.lastLine = lineNumber;
            if (!existing.level && level) existing.level = level;
            if (!existing.channel && channel) existing.channel = channel;
          } else if (messageMap.size < 50000) {
            const info: MessageInfo = {
              pattern,
              sample: message.length > 200 ? message.substring(0, 200) + '...' : message,
              count: 1,
              level,
              channel,
              firstLine: lineNumber,
              lastLine: lineNumber
            };
            messageMap.set(pattern, info);

            if (rareMessages.length < 1000) {
              rareMessages.push({
                text: message.length > 150 ? message.substring(0, 150) + '...' : message,
                line: lineNumber,
                level,
                channel
              });
            }
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
      const insights = this.buildInsights(messageMap, lineNumber, channelCounts);

      // Build column stats
      const columnStats = this.buildColumnStats(channelCounts, sourceCounts);

      // Build patterns (keep top message patterns for backward compatibility)
      const patterns: PatternGroup[] = [...messageMap.values()]
        .filter(m => m.count > 1)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
        .map(m => ({
          pattern: m.pattern,
          template: m.pattern,
          count: m.count,
          sampleLines: [m.firstLine],
          sampleText: m.sample,
          category: this.categorize(m.level, m.pattern)
        }));

      // Duplicates
      const duplicateGroups: DuplicateGroup[] = [...messageMap.values()]
        .filter(m => m.count > 5)
        .sort((a, b) => b.count - a.count)
        .slice(0, 30)
        .map(m => ({
          hash: this.hash(m.pattern).toString(16),
          text: m.sample,
          count: m.count,
          lineNumbers: [m.firstLine]
        }));

      onProgress?.({ phase: 'done', percent: 100, message: 'Analysis complete' });

      return {
        stats: {
          totalLines: lineNumber,
          analyzedLines: lineNumber,
          uniquePatterns: messageMap.size,
          duplicateLines: duplicateGroups.reduce((sum, g) => sum + g.count - 1, 0)
        },
        patterns,
        levelCounts,
        duplicateGroups,
        timeRange: firstTimestamp && lastTimestamp
          ? { start: firstTimestamp, end: lastTimestamp }
          : undefined,
        analyzerName: this.name,
        analyzedAt: Date.now(),
        columnStats,
        insights
      };

    } catch (error) {
      console.error('ColumnAwareAnalyzer error:', error);
      return this.emptyResult();
    }
  }

  private buildInsights(
    messageMap: Map<string, MessageInfo>,
    totalLines: number,
    channelCounts: Map<string, number>
  ): AnalysisInsights {
    const messages = [...messageMap.values()];

    // 1. NOISE DETECTION - messages that appear very frequently
    const noiseThreshold = Math.max(100, totalLines * 0.01); // 1% of file or 100, whichever is higher
    const noiseCandidates: NoiseCandidate[] = messages
      .filter(m => m.count >= noiseThreshold)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(m => ({
        pattern: m.pattern,
        sampleText: m.sample,
        count: m.count,
        percentage: Math.round((m.count / totalLines) * 100),
        channel: m.channel,
        suggestedFilter: this.createFilterPattern(m.sample)
      }));

    // 2. ERROR GROUPING - group error and warning messages
    const errorGroups: ErrorGroup[] = messages
      .filter(m => m.level === 'error' || m.level === 'warning')
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
      .map(m => ({
        pattern: m.pattern,
        sampleText: m.sample,
        count: m.count,
        level: m.level as 'error' | 'warning',
        channel: m.channel,
        firstLine: m.firstLine,
        lastLine: m.lastLine
      }));

    // 3. ANOMALIES - messages that appear only once or twice and look important
    const anomalies: Anomaly[] = messages
      .filter(m => m.count <= 2 && this.looksImportant(m))
      .slice(0, 10)
      .map(m => ({
        text: m.sample,
        lineNumber: m.firstLine,
        level: m.level,
        channel: m.channel,
        reason: this.getAnomalyReason(m)
      }));

    // 4. FILTER SUGGESTIONS
    const filterSuggestions: FilterSuggestion[] = [];

    // Suggest filtering high-noise messages
    if (noiseCandidates.length > 0) {
      const topNoise = noiseCandidates[0];
      filterSuggestions.push({
        id: 'filter-noise',
        title: 'Hide repetitive messages',
        description: `"${topNoise.pattern.substring(0, 40)}..." appears ${topNoise.count.toLocaleString()} times (${topNoise.percentage}%)`,
        type: 'exclude',
        filter: {
          excludePatterns: [topNoise.suggestedFilter]
        }
      });
    }

    // Suggest focusing on errors
    const errorCount = messages.filter(m => m.level === 'error').reduce((sum, m) => sum + m.count, 0);
    if (errorCount > 0 && errorCount < totalLines * 0.5) {
      filterSuggestions.push({
        id: 'filter-errors-only',
        title: 'Show errors only',
        description: `Focus on ${errorCount.toLocaleString()} error messages`,
        type: 'level',
        filter: {
          levels: ['error']
        }
      });
    }

    // Suggest filtering by top error channel
    const errorChannels = new Map<string, number>();
    messages.filter(m => m.level === 'error' && m.channel).forEach(m => {
      errorChannels.set(m.channel!, (errorChannels.get(m.channel!) || 0) + m.count);
    });
    const topErrorChannel = [...errorChannels.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topErrorChannel && topErrorChannel[1] > 10) {
      filterSuggestions.push({
        id: 'filter-error-channel',
        title: `Errors from ${topErrorChannel[0]}`,
        description: `${topErrorChannel[1].toLocaleString()} errors from this channel`,
        type: 'include',
        filter: {
          includePatterns: [topErrorChannel[0]],
          levels: ['error']
        }
      });
    }

    // Suggest hiding debug/trace if they dominate
    const debugCount = messages.filter(m => m.level === 'debug' || m.level === 'trace')
      .reduce((sum, m) => sum + m.count, 0);
    if (debugCount > totalLines * 0.5) {
      filterSuggestions.push({
        id: 'filter-no-debug',
        title: 'Hide debug/trace',
        description: `Remove ${debugCount.toLocaleString()} debug messages (${Math.round(debugCount/totalLines*100)}% of file)`,
        type: 'level',
        filter: {
          levels: ['error', 'warning', 'info']
        }
      });
    }

    return {
      noiseCandidates,
      errorGroups,
      anomalies,
      filterSuggestions
    };
  }

  private buildColumnStats(
    channelCounts: Map<string, number>,
    sourceCounts: Map<string, number>
  ): ColumnStats[] {
    const stats: ColumnStats[] = [];

    if (channelCounts.size > 0) {
      const total = [...channelCounts.values()].reduce((a, b) => a + b, 0);
      if (total > 0) {
        stats.push({
          name: 'Channel',
          type: 'channel',
          uniqueCount: channelCounts.size,
          topValues: [...channelCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([value, count]) => ({
              value: value || '(empty)',
              count,
              percentage: Math.round((count / total) * 100)
            }))
        });
      }
    }

    if (sourceCounts.size > 0) {
      const total = [...sourceCounts.values()].reduce((a, b) => a + b, 0);
      if (total > 0) {
        stats.push({
          name: 'Source',
          type: 'source',
          uniqueCount: sourceCounts.size,
          topValues: [...sourceCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([value, count]) => ({
              value: value || '(empty)',
              count,
              percentage: Math.round((count / total) * 100)
            }))
        });
      }
    }

    return stats;
  }

  private extractPattern(message: string): string {
    return message
      .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*\b/g, '<TIME>')
      .replace(/\b\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}[.\d]*\b/g, '<TIME>')
      .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '<IP>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
      .replace(/\b0x[0-9a-f]+\b/gi, '<HEX>')
      .replace(/\b\d{5,}\b/g, '<NUM>')
      .replace(/\[\d+:\d+:\d+\]/g, '[<IDS>]')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  }

  private createFilterPattern(sample: string): string {
    // Extract key words for filtering
    const words = sample.split(/\s+/).filter(w =>
      w.length > 3 &&
      !/^\d+$/.test(w) &&
      !/^[<\[{]/.test(w)
    );
    return words.slice(0, 3).join(' ') || sample.substring(0, 30);
  }

  private looksImportant(m: MessageInfo): boolean {
    const text = m.sample.toLowerCase();
    return (
      m.level === 'error' ||
      /\b(fatal|critical|crash|exception|panic|fail|abort|corrupt|invalid|unauthorized|denied|timeout|refused)\b/.test(text)
    );
  }

  private getAnomalyReason(m: MessageInfo): string {
    const text = m.sample.toLowerCase();
    if (/fatal|crash|panic/.test(text)) return 'Critical error keyword';
    if (/exception/.test(text)) return 'Exception occurred';
    if (/unauthorized|denied|refused/.test(text)) return 'Access issue';
    if (/timeout/.test(text)) return 'Timeout detected';
    if (/corrupt|invalid/.test(text)) return 'Data integrity issue';
    if (m.level === 'error') return 'Rare error message';
    return 'Appears only once';
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

  private categorize(level: string | undefined, pattern: string): PatternGroup['category'] {
    if (level === 'error') return 'error';
    if (level === 'warning') return 'warning';
    if (level === 'info') return 'info';
    if (level === 'debug' || level === 'trace') return 'debug';

    const lower = pattern.toLowerCase();
    if (/error|fail|exception|crash/.test(lower)) return 'error';
    if (/warn|alert/.test(lower)) return 'warning';
    return 'unknown';
  }

  private async detectColumns(filePath: string): Promise<ColumnInfo[]> {
    const columns: ColumnInfo[] = [];

    // Read first few KB to detect column structure (no readline to avoid OOM on long lines)
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

  private hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash | 0;
    }
    return Math.abs(hash);
  }

  private emptyResult(): AnalysisResult {
    return {
      stats: { totalLines: 0, analyzedLines: 0, uniquePatterns: 0, duplicateLines: 0 },
      patterns: [],
      levelCounts: { error: 0, warning: 0, info: 0, debug: 0, trace: 0 },
      duplicateGroups: [],
      analyzerName: this.name,
      analyzedAt: Date.now(),
      insights: {
        noiseCandidates: [],
        errorGroups: [],
        anomalies: [],
        filterSuggestions: []
      }
    };
  }
}
