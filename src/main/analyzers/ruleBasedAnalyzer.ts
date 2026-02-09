import * as fs from 'fs';
import {
  LogAnalyzer,
  AnalyzerOptions,
  AnalyzeProgress,
  AnalysisResult,
  PatternGroup,
  DuplicateGroup
} from './types';

// Pre-compiled regex patterns for better performance
const LEVEL_PATTERNS = {
  error: /\b(ERROR|FATAL|CRITICAL|SEVERE|EXCEPTION)\b/i,
  warning: /\b(WARN|WARNING)\b/i,
  info: /\b(INFO|INFORMATION)\b/i,
  debug: /\b(DEBUG)\b/i,
  trace: /\b(TRACE|VERBOSE)\b/i
};

// Pre-compiled normalization patterns
const NORMALIZE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // ISO timestamps: 2024-01-15T14:30:45.123Z
  { pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?/g, replacement: '{ts}' },
  // Syslog timestamps: Jan 15 14:30:45
  { pattern: /[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/g, replacement: '{ts}' },
  // Time: 14:30:45.123 or 14:30:45
  { pattern: /\d{2}:\d{2}:\d{2}[.,]?\d*/g, replacement: '{t}' },
  // IPv4 with optional port
  { pattern: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/g, replacement: '{ip}' },
  // UUIDs
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, replacement: '{id}' },
  // Hex strings (8+ chars)
  { pattern: /\b[0-9a-f]{8,}\b/gi, replacement: '{x}' },
  // Numbers (4+ digits)
  { pattern: /\b\d{4,}\b/g, replacement: '{n}' },
  // Decimals
  { pattern: /\b\d+\.\d+\b/g, replacement: '{n}' },
];

// Timestamp extraction patterns (pre-compiled)
const TIMESTAMP_PATTERNS = [
  /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/,
  /([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
  /\[(\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2})/,
];

// Memory limits
const MAX_MAP_SIZE = 50000; // Max unique entries to track
const MAX_LINE_LENGTH = 500; // Truncate lines longer than this
const MAX_STORED_LINE_NUMBERS = 20; // Max line numbers to store per pattern
const SAMPLE_THRESHOLD = 1000000; // Sample if file > 1M lines (estimated)
const SAMPLE_RATE = 10; // Analyze every Nth line when sampling

// Simple hash function (fast, not cryptographic)
function simpleHash(str: string): number {
  let hash = 0;
  const len = Math.min(str.length, MAX_LINE_LENGTH);
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash | 0; // Convert to 32bit integer
  }
  return hash;
}

// Detect log level from line text
function detectLevel(text: string): string | undefined {
  // Check first 200 chars only for performance
  const sample = text.length > 200 ? text.substring(0, 200) : text;
  if (LEVEL_PATTERNS.error.test(sample)) return 'error';
  if (LEVEL_PATTERNS.warning.test(sample)) return 'warning';
  if (LEVEL_PATTERNS.info.test(sample)) return 'info';
  if (LEVEL_PATTERNS.debug.test(sample)) return 'debug';
  if (LEVEL_PATTERNS.trace.test(sample)) return 'trace';
  return undefined;
}

// Normalize line by replacing variable parts with placeholders
function normalizeLine(text: string): string {
  // Truncate long lines
  let result = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) : text;

  // Apply pre-compiled patterns
  for (const { pattern, replacement } of NORMALIZE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

// Categorize pattern based on template and level
function categorizePattern(
  template: string,
  level: string | undefined
): PatternGroup['category'] {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  if (level === 'info') return 'info';
  if (level === 'debug' || level === 'trace') return 'debug';

  // Quick heuristics
  if (/fail|error|exception|crash|fatal/i.test(template)) return 'error';
  if (/warn|alert/i.test(template)) return 'warning';
  if (/success|started|completed|ready/i.test(template)) return 'info';

  return 'unknown';
}

function extractTimestamp(text: string): string | null {
  // Check first 100 chars only
  const sample = text.length > 100 ? text.substring(0, 100) : text;
  for (const pattern of TIMESTAMP_PATTERNS) {
    const match = sample.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export class RuleBasedAnalyzer implements LogAnalyzer {
  name = 'rule-based';
  description = 'Fast regex-based pattern detection';

  async analyze(
    filePath: string,
    options: AnalyzerOptions,
    onProgress?: (progress: AnalyzeProgress) => void,
    signal?: { cancelled: boolean }
  ): Promise<AnalysisResult> {
    const maxPatterns = options.maxPatterns || 500;
    const maxDuplicates = options.maxDuplicates || 200;

    // Data structures with size limits
    const levelCounts: Record<string, number> = {
      error: 0, warning: 0, info: 0, debug: 0, trace: 0
    };

    // Use numeric hash as key for memory efficiency
    const duplicateMap = new Map<number, { text: string; count: number; firstLine: number; lastLine: number }>();
    const patternMap = new Map<string, {
      count: number;
      lines: number[];
      level: string | undefined;
    }>();

    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let lineNumber = 0;
    let analyzedLines = 0;

    // Get file size for progress and sampling decision
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const estimatedLines = Math.ceil(fileSize / 100); // Rough estimate: 100 bytes per line
    const shouldSample = estimatedLines > SAMPLE_THRESHOLD;

    let bytesRead = 0;
    let lastProgressUpdate = Date.now();

    onProgress?.({
      phase: 'reading',
      percent: 0,
      message: shouldSample ? 'Sampling large file...' : 'Reading file...'
    });

    // Use chunked reading instead of readline to prevent OOM on files with
    // extremely long lines (e.g. 3GB minified JSON). readline buffers entire
    // lines in memory, which crashes V8. This approach caps line content.
    const CHUNK_SIZE = 1024 * 1024; // 1MB
    const readBuffer = Buffer.alloc(CHUNK_SIZE);
    const fd = fs.openSync(filePath, 'r');
    let lineBuffer = '';
    let lineBufferFull = false; // true when line exceeds MAX_LINE_LENGTH

    function processLine(line: string): void {
      lineNumber++;
      bytesRead += line.length + 1;

      // Sampling for large files
      if (shouldSample && lineNumber % SAMPLE_RATE !== 0) {
        return;
      }

      analyzedLines++;

      // Skip empty lines
      const trimmed = line.trim();
      if (!trimmed) return;

      // 1. Detect and count log level
      const level = detectLevel(line);
      if (level) {
        levelCounts[level]++;
      }

      // 2. Extract timestamp for time range (only check first and recent lines)
      if (!firstTimestamp || lineNumber % 1000 === 0) {
        const timestamp = extractTimestamp(line);
        if (timestamp) {
          if (!firstTimestamp) firstTimestamp = timestamp;
          lastTimestamp = timestamp;
        }
      }

      // 3. Track duplicates (with size limit)
      const hash = simpleHash(line);
      const existing = duplicateMap.get(hash);
      if (existing) {
        existing.count++;
        existing.lastLine = lineNumber;
      } else if (duplicateMap.size < MAX_MAP_SIZE) {
        const truncated = line.length > 200 ? line.substring(0, 200) + '...' : line;
        duplicateMap.set(hash, {
          text: truncated,
          count: 1,
          firstLine: lineNumber,
          lastLine: lineNumber
        });
      }

      // 4. Normalize and track patterns (with size limit)
      const normalized = normalizeLine(line);
      const patternEntry = patternMap.get(normalized);
      if (patternEntry) {
        patternEntry.count++;
        if (patternEntry.lines.length < MAX_STORED_LINE_NUMBERS) {
          patternEntry.lines.push(lineNumber);
        }
      } else if (patternMap.size < MAX_MAP_SIZE) {
        patternMap.set(normalized, {
          count: 1,
          lines: [lineNumber],
          level
        });
      }

      // Throttle progress updates (every 200ms)
      const now = Date.now();
      if (now - lastProgressUpdate > 200) {
        lastProgressUpdate = now;
        const percent = Math.round((bytesRead / fileSize) * 80);
        onProgress?.({
          phase: 'reading',
          percent,
          message: `${shouldSample ? 'Sampling' : 'Reading'} line ${lineNumber.toLocaleString()}...`
        });
      }
    }

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
            // End of line — process accumulated buffer
            if (lineBuffer.length > 0 || !lineBufferFull) {
              processLine(lineBuffer);
            } else {
              // Line was too long, just count it
              lineNumber++;
              bytesRead += lineBuffer.length + 1;
            }
            lineBuffer = '';
            lineBufferFull = false;
            // Skip \n after \r (CRLF)
            if (ch === '\r' && i + 1 < chunk.length && chunk[i + 1] === '\n') {
              i++;
            }
          } else if (!lineBufferFull) {
            lineBuffer += ch;
            if (lineBuffer.length >= MAX_LINE_LENGTH) {
              lineBufferFull = true;
              // Keep the truncated content for analysis
            }
          }
          // If lineBufferFull, skip remaining chars until newline
        }
      }

      // Process last line if no trailing newline
      if (lineBuffer.length > 0) {
        processLine(lineBuffer);
      }
    } finally {
      fs.closeSync(fd);
    }

    if (signal?.cancelled) {
      return this.emptyResult();
    }

    onProgress?.({ phase: 'grouping', percent: 85, message: 'Grouping patterns...' });

    // Build duplicate groups (only lines that appear more than once)
    const duplicateGroups: DuplicateGroup[] = [];
    for (const [hash, entry] of duplicateMap) {
      if (entry.count > 1) {
        duplicateGroups.push({
          hash: hash.toString(16),
          text: entry.text,
          count: entry.count,
          lineNumbers: [entry.firstLine, entry.lastLine]
        });
      }
    }
    duplicateMap.clear(); // Free memory

    // Sort and limit duplicates
    duplicateGroups.sort((a, b) => b.count - a.count);
    const limitedDuplicates = duplicateGroups.slice(0, maxDuplicates);

    onProgress?.({ phase: 'grouping', percent: 92, message: 'Finalizing...' });

    // Build pattern groups
    const patterns: PatternGroup[] = [];
    for (const [template, entry] of patternMap) {
      if (entry.count > 1 || entry.level) {
        patterns.push({
          pattern: template,
          template: template,
          count: entry.count,
          sampleLines: entry.lines.slice(0, 5),
          category: categorizePattern(template, entry.level)
        });
      }
    }
    patternMap.clear(); // Free memory

    // Sort and limit patterns
    patterns.sort((a, b) => b.count - a.count);
    const limitedPatterns = patterns.slice(0, maxPatterns);

    // Count duplicate lines
    let duplicateLineCount = 0;
    for (const group of limitedDuplicates) {
      duplicateLineCount += group.count - 1;
    }

    onProgress?.({ phase: 'done', percent: 100, message: 'Analysis complete' });

    return {
      stats: {
        totalLines: lineNumber,
        analyzedLines: shouldSample ? analyzedLines : lineNumber,
        uniquePatterns: limitedPatterns.length,
        duplicateLines: duplicateLineCount
      },
      patterns: limitedPatterns,
      levelCounts,
      duplicateGroups: limitedDuplicates,
      timeRange: firstTimestamp && lastTimestamp
        ? { start: firstTimestamp, end: lastTimestamp }
        : undefined,
      analyzerName: this.name,
      analyzedAt: Date.now()
    };
  }

  private emptyResult(): AnalysisResult {
    return {
      stats: { totalLines: 0, analyzedLines: 0, uniquePatterns: 0, duplicateLines: 0 },
      patterns: [],
      levelCounts: { error: 0, warning: 0, info: 0, debug: 0, trace: 0 },
      duplicateGroups: [],
      analyzerName: this.name,
      analyzedAt: Date.now()
    };
  }
}
