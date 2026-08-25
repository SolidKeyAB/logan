// Shared line-classification primitives.
//
// These were extracted verbatim from ColumnAwareAnalyzer so that BOTH the
// whole-file analyzer and the scoped (subset) analyzer classify lines
// identically — same crash regex, same level normalization, same column
// detection. The whole-file analyzer keeps its own byte-position density loop;
// everything else about "what is this line" lives here, once.

import * as fs from 'fs';
import { CrashEntry, FailingComponent, FilterSuggestion, AnalysisInsights } from './types';

export const CRASH_REGEX = /\b(fatal|crash|exception|panic|oom|out.of.memory|segfault|abort|core.dump|stack.overflow|unhandled|killed|sigsegv)\b/i;
export const MAX_CRASHES = 50;

// --- Android logcat parsing ---------------------------------------------------
//
// Logcat has NO header row, and it separates its PID/TID/level/tag fields with
// SINGLE spaces. So header-based column detection finds nothing, and splitLine()
// (which only breaks on tabs or 2+ spaces) glues the tag into the message field.
// The consequence: the tag — the real "component" — is never isolated, so a
// crash like "E AndroidRuntime: FATAL EXCEPTION" is still counted (its text
// matches CRASH_REGEX) but is attributed to NO component. Every component-scoped
// view — top failing components, "Errors from X" suggestions, the health box,
// the triage card's worst-components — therefore misses it. parseLogcatLine
// extracts (level, component=tag, message) positionally so logcat crashes get
// the same component attribution every columnar format already gets.
//
// Supported forms (each may carry a leading capture-host stamp like "[21:10:44.413] "):
//   threadtime:  MM-DD HH:MM:SS.mmm  PID  TID  L  Tag: message
//   brief/tag:   MM-DD HH:MM:SS.mmm  L/Tag( PID): message
const LOGCAT_LEVEL_LETTER: Record<string, string> = {
  V: 'verbose', D: 'debug', I: 'info', W: 'warning', E: 'error', F: 'fatal', A: 'fatal',
};
// Optional esotrace/capture host stamp prefixed to each line, e.g. "[21:10:44.413] ".
const LOGCAT_HOST_PREFIX = /^\s*(?:\[[0-9:.]+\]\s+)?/;
const LOGCAT_THREADTIME = /^\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+([VDIWEFA])\s+([^:\s][^:]*?):\s?(.*)$/;
const LOGCAT_BRIEF = /^\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}\.\d+\s+([VDIWEFA])\/([^(]+?)\(\s*\d+\):\s?(.*)$/;

export interface LogcatParsed { level: string; component: string; message: string; }

// Parse one Android logcat line into level/component(tag)/message, or null if it
// isn't a logcat line (e.g. a "--------- beginning of main" separator).
export function parseLogcatLine(line: string): LogcatParsed | null {
  const body = line.replace(LOGCAT_HOST_PREFIX, '');
  const m = body.match(LOGCAT_THREADTIME) || body.match(LOGCAT_BRIEF);
  if (!m) return null;
  return { level: LOGCAT_LEVEL_LETTER[m[1]], component: m[2].trim(), message: m[3].trim() };
}

// Sniff whether a set of sample lines is Android logcat: a majority parse as
// logcat lines. Blank/comment/separator lines are ignored so they don't dilute
// the ratio.
export function looksLikeLogcat(sampleLines: string[]): boolean {
  let considered = 0;
  let matched = 0;
  for (const l of sampleLines) {
    const t = l.trim();
    if (!t || t.startsWith('#') || /^-{3,}/.test(t.replace(LOGCAT_HOST_PREFIX, ''))) continue;
    considered++;
    if (parseLogcatLine(l)) matched++;
  }
  return considered >= 5 && matched >= considered * 0.5;
}

export const KNOWN_COLUMNS = {
  // timestamp MUST come before channel — 'LoggerTime' contains 'logger' (channel keyword)
  // but should be classified as timestamp. More-specific types go first.
  timestamp: ['time', 'timestamp', 'date', 'datetime', 'loggertime', 'tracetime'],
  level:     ['level', 'severity', 'loglevel', 'priority'],
  message:   ['message', 'msg', 'text', 'content', 'description'],
  source:    ['source', 'process', 'thread', 'origin', 'class'],
  // channel last — 'logger' is a substring of 'loggertime' so must be lowest priority
  channel:   ['channel', 'component', 'module', 'category', 'logger'],
};

export interface ColumnInfo {
  index: number;
  name: string;
  type: 'channel' | 'source' | 'level' | 'message' | 'timestamp' | 'other';
}

const TIMESTAMP_REGEX = /(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})|(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/;

export function splitLine(line: string): string[] {
  return line.split(/\t|\s{2,}/).filter(f => f.length > 0);
}

export function looksLikeHeader(line: string): boolean {
  const lower = line.toLowerCase();
  const headerWords = ['packetid', 'sessionid', 'timestamp', 'level', 'message',
                       'channel', 'source', 'component', 'logger', 'time'];
  return headerWords.filter(w => lower.includes(w)).length >= 2;
}

export function simplifySource(source: string): string {
  const dotIndex = source.indexOf('.');
  return dotIndex > 0 ? source.substring(0, dotIndex) : source;
}

export function normalizeLevel(rawLevel: string): string | null {
  if (/^(fatal|panic|emergency|alert|emerg)$/.test(rawLevel)) return 'fatal';
  if (/^(error|critical|severe|crit|exception)$/.test(rawLevel)) return 'error';
  if (/^(warn|warning|notice)$/.test(rawLevel)) return 'warning';
  if (/^(info|information|informational)$/.test(rawLevel)) return 'info';
  if (/^(debug|dbg|d)$/.test(rawLevel)) return 'debug';
  if (/^(verbose|verb|v|fine|finer)$/.test(rawLevel)) return 'verbose';
  if (/^(trace|finest|silly)$/.test(rawLevel)) return 'trace';
  return null;
}

export function detectLevelFromText(text: string): string | null {
  const upper = (text.length > 200 ? text.substring(0, 200) : text).toUpperCase();
  if (/\b(FATAL|PANIC|EMERGENCY|EMERG)\b/.test(upper)) return 'fatal';
  if (/\b(ERROR|CRITICAL|CRIT|EXCEPTION)\b/.test(upper)) return 'error';
  if (/\b(WARN|WARNING|NOTICE)\b/.test(upper)) return 'warning';
  if (/\b(INFO)\b/.test(upper)) return 'info';
  if (/\b(DEBUG|DBG)\b/.test(upper)) return 'debug';
  if (/\b(VERBOSE|VERB)\b/.test(upper)) return 'verbose';
  if (/\b(TRACE)\b/.test(upper)) return 'trace';
  return null;
}

// Detect column types from a single header line (tab / 2+-space delimited).
export function detectColumnsFromHeaderLine(headerLine: string): ColumnInfo[] {
  const columns: ColumnInfo[] = [];
  const headers = splitLine(headerLine);
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

export interface LogFormat {
  columns: ColumnInfo[];
  // True when the file is header-less Android logcat — the accumulator then
  // parses component/level/message positionally instead of by column index.
  logcat: boolean;
}

// Read the first bytes of a file and detect its structure: a header row (→ named
// columns) if present, else sniff for header-less Android logcat.
export async function detectLogFormat(filePath: string): Promise<LogFormat> {
  const CAP = 65536; // 64KB — enough to clear a few very long logcat lines when sniffing
  const buf = Buffer.alloc(CAP);
  const fd = fs.openSync(filePath, 'r');
  let lines: string[] = [];
  try {
    const bytesRead = fs.readSync(fd, buf, 0, CAP, 0);
    const text = buf.toString('utf-8', 0, bytesRead);
    lines = text.split(/\r?\n/);
  } finally {
    fs.closeSync(fd);
  }
  for (const line of lines.slice(0, 10)) {
    if (line.startsWith('#')) continue;
    if (looksLikeHeader(line)) {
      return { columns: detectColumnsFromHeaderLine(line), logcat: false };
    }
  }
  // No header row — could be Android logcat (no header, single-space fields).
  return { columns: [], logcat: looksLikeLogcat(lines.slice(0, 60)) };
}

// Read the first bytes of a file and detect its columns from the header row (if any).
export async function detectColumns(filePath: string): Promise<ColumnInfo[]> {
  return (await detectLogFormat(filePath)).columns;
}

// Accumulates level counts, crashes, per-component errors and the timestamp span
// as lines are fed to it. This is the single source of truth for "what does this
// line contribute to the analysis" — the whole-file analyzer feeds every physical
// line here (adding its own density bucketing), the scoped analyzer feeds a subset.
export class AnalysisAccumulator {
  readonly levelCounts: Record<string, number> = {
    fatal: 0, error: 0, warning: 0, info: 0, debug: 0, verbose: 0, trace: 0,
  };
  readonly crashes: CrashEntry[] = [];
  readonly componentErrors = new Map<string, { errors: number; warnings: number; firstErrorLine: number }>();
  firstTimestamp: string | null = null;
  lastTimestamp: string | null = null;

  private readonly channelCol?: ColumnInfo;
  private readonly sourceCol?: ColumnInfo;
  private readonly levelCol?: ColumnInfo;
  private readonly messageCol?: ColumnInfo;
  private readonly logcat: boolean;

  constructor(columns: ColumnInfo[] = [], logcat = false) {
    this.channelCol = columns.find(c => c.type === 'channel');
    this.sourceCol = columns.find(c => c.type === 'source');
    this.levelCol = columns.find(c => c.type === 'level');
    this.messageCol = columns.find(c => c.type === 'message');
    this.logcat = logcat;
  }

  // Classify one line and fold it into the running totals. Returns the detected
  // level (or null) so the caller can update out-of-band state (e.g. density).
  // `lineNumber` is the caller's real line number (used for crash navigation);
  // blank and '#'-comment lines contribute nothing. Header skipping is the
  // caller's responsibility (the whole-file scan skips a header row 1).
  feed(line: string, lineNumber: number): string | null {
    if (!line.trim() || line.startsWith('#')) return null;

    let componentName: string | undefined;
    let level: string | undefined;
    let message = '';

    // Android logcat: parse tag/level/message positionally (no header, single-space
    // fields) so the tag becomes the component. Falls through to generic columnar
    // parsing for lines that aren't logcat (e.g. "--------- beginning of main").
    const lc = this.logcat ? parseLogcatLine(line) : null;
    if (lc) {
      componentName = lc.component || undefined;
      level = lc.level || undefined;
      message = lc.message;
    } else {
      const fields = splitLine(line);

      // Component (channel first, then source)
      if (this.channelCol && fields[this.channelCol.index]) {
        const ch = fields[this.channelCol.index].trim();
        if (ch && ch !== '--' && ch !== '-') componentName = ch;
      }
      if (!componentName && this.sourceCol && fields[this.sourceCol.index]) {
        const src = fields[this.sourceCol.index].trim();
        if (src && src !== '--' && src !== '-') componentName = simplifySource(src);
      }

      // Level (column-based if a level column exists, else from text)
      if (this.levelCol && fields[this.levelCol.index]) {
        const rawLevel = fields[this.levelCol.index].trim().toLowerCase();
        level = normalizeLevel(rawLevel) || undefined;
      } else {
        level = detectLevelFromText(line) || undefined;
      }

      // Message text
      if (this.messageCol && fields[this.messageCol.index]) {
        message = fields[this.messageCol.index].trim();
      } else if (fields.length > 0) {
        message = fields[fields.length - 1].trim();
      }
    }

    if (level) this.levelCounts[level]++;

    // Crash keyword detection
    if (this.crashes.length < MAX_CRASHES) {
      const textToCheck = message || line;
      const crashMatch = textToCheck.match(CRASH_REGEX);
      if (crashMatch) {
        this.crashes.push({
          text: textToCheck.length > 200 ? textToCheck.substring(0, 200) + '...' : textToCheck,
          lineNumber,
          level,
          channel: componentName,
          keyword: crashMatch[1].toLowerCase(),
        });
      }
    }

    // Per-component error/warning tracking
    if (componentName && (level === 'error' || level === 'warning')) {
      const existing = this.componentErrors.get(componentName);
      if (existing) {
        if (level === 'error') {
          existing.errors++;
          if (existing.firstErrorLine === 0) existing.firstErrorLine = lineNumber;
        }
        if (level === 'warning') existing.warnings++;
      } else {
        this.componentErrors.set(componentName, {
          errors: level === 'error' ? 1 : 0,
          warnings: level === 'warning' ? 1 : 0,
          firstErrorLine: level === 'error' ? lineNumber : 0,
        });
      }
    }

    // Timestamp span — check first 100 chars only
    const tsSample = line.length > 100 ? line.substring(0, 100) : line;
    const tsMatch = tsSample.match(TIMESTAMP_REGEX);
    if (tsMatch) {
      if (!this.firstTimestamp) this.firstTimestamp = tsMatch[0];
      this.lastTimestamp = tsMatch[0];
    }

    return level ?? null;
  }

  buildInsights(totalLines: number): AnalysisInsights {
    // Top failing components — sorted by error count, top 5
    const topFailingComponents: FailingComponent[] = [...this.componentErrors.entries()]
      .filter(([, v]) => v.errors > 0)
      .sort((a, b) => b[1].errors - a[1].errors)
      .slice(0, 5)
      .map(([name, v]) => ({
        name,
        errorCount: v.errors,
        warningCount: v.warnings,
        sampleLine: v.firstErrorLine,
      }));

    const filterSuggestions: FilterSuggestion[] = [];
    const errorCount = this.levelCounts.error || 0;
    const warningCount = this.levelCounts.warning || 0;
    const debugCount = (this.levelCounts.debug || 0) + (this.levelCounts.trace || 0);

    if (errorCount > 0 && errorCount < totalLines * 0.5) {
      filterSuggestions.push({
        id: 'filter-errors-only',
        title: 'Show errors only',
        description: `Focus on ${errorCount.toLocaleString()} error lines`,
        type: 'level',
        filter: { levels: ['error'] },
      });
    }

    if ((errorCount + warningCount) > 0 && (errorCount + warningCount) < totalLines * 0.5) {
      filterSuggestions.push({
        id: 'filter-errors-warnings',
        title: 'Show errors & warnings',
        description: `Focus on ${(errorCount + warningCount).toLocaleString()} error/warning lines`,
        type: 'level',
        filter: { levels: ['error', 'warning'] },
      });
    }

    const topErrorComponents = topFailingComponents.filter(c => c.errorCount > 5).slice(0, 3);
    for (const comp of topErrorComponents) {
      filterSuggestions.push({
        id: `filter-component-${comp.name}`,
        title: `Errors from ${comp.name}`,
        description: `${comp.errorCount.toLocaleString()} errors from this component`,
        type: 'include',
        filter: { includePatterns: [comp.name], levels: ['error'] },
      });
    }

    if (totalLines > 0 && debugCount > totalLines * 0.3) {
      filterSuggestions.push({
        id: 'filter-no-debug',
        title: 'Hide debug/trace',
        description: `Remove ${debugCount.toLocaleString()} debug messages (${Math.round(debugCount / totalLines * 100)}% of file)`,
        type: 'level',
        filter: { levels: ['error', 'warning', 'info'] },
      });
    }

    return { crashes: this.crashes, topFailingComponents, filterSuggestions };
  }
}
