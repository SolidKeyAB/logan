import Database from 'better-sqlite3';
import * as zlib from 'zlib';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { AnalysisResult } from './analyzers/types';
import { FileHandler } from './fileHandler';

// --- Types ---

export interface BaselineFingerprint {
  sourceFile: string;
  fileSize: number;
  totalLines: number;
  analyzerName: string;
  timeRange: { start: string; end: string } | null;
  timestampDensity: number[]; // lines-per-minute histogram (up to 1440 buckets)
  levelCounts: Record<string, number>;
  levelPercentages: Record<string, number>;
  crashes: Array<{ text: string; keyword: string; level?: string; channel?: string }>;
  failingComponents: Array<{ name: string; errorCount: number; warningCount: number }>;
  channelCounts: Record<string, number>;
  sampleLines: Record<string, string[]>; // level -> sample lines (up to 10)
  componentSamples: Record<string, string[]>; // component -> sample error lines (up to 5)
}

export interface BaselineRecord {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sourceFile: string;
  totalLines: number;
}

export interface BaselineRecordFull extends BaselineRecord {
  fingerprint: BaselineFingerprint;
}

export interface ComparisonFinding {
  severity: 'critical' | 'warning' | 'info';
  category: 'level-shift' | 'new-crash' | 'new-component' | 'missing-component' | 'error-rate' | 'time-pattern' | 'general';
  title: string;
  detail: string;
  baselineValue?: string;
  currentValue?: string;
}

export interface ComparisonReport {
  baselineId: string;
  baselineName: string;
  comparedAt: number;
  findings: ComparisonFinding[];
  summary: { critical: number; warning: number; info: number };
}

// --- Timestamp parsing (reused from index.ts patterns) ---

const ISO_TIMESTAMP_REGEX = /(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;
const EURO_TIMESTAMP_REGEX = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/;
const SYSLOG_TIMESTAMP_REGEX = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/;
const MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseTimestamp(text: string): Date | null {
  const sample = text.length > 60 ? text.substring(0, 60) : text;

  const isoMatch = sample.match(ISO_TIMESTAMP_REGEX);
  if (isoMatch) {
    const [, year, month, day, hour, min, sec] = isoMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
  }

  const euroMatch = sample.match(EURO_TIMESTAMP_REGEX);
  if (euroMatch) {
    const [, day, month, year, hour, min, sec] = euroMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
  }

  const syslogMatch = sample.match(SYSLOG_TIMESTAMP_REGEX);
  if (syslogMatch) {
    const [, monthStr, day, hour, min, sec] = syslogMatch;
    const month = MONTH_MAP[monthStr];
    if (month !== undefined) {
      return new Date(new Date().getFullYear(), month, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
    }
  }

  return null;
}

// --- Fingerprint Builder ---

export function buildFingerprint(
  filePath: string,
  analysisResult: AnalysisResult,
  fileHandler: FileHandler
): BaselineFingerprint {
  const totalLines = fileHandler.getTotalLines();
  const fileInfo = fileHandler.getFileInfo();

  // Level percentages
  const totalCounted = Object.values(analysisResult.levelCounts).reduce((a, b) => a + b, 0);
  const levelPercentages: Record<string, number> = {};
  for (const [level, count] of Object.entries(analysisResult.levelCounts)) {
    levelPercentages[level] = totalCounted > 0 ? Math.round((count / totalCounted) * 10000) / 100 : 0;
  }

  // Crashes (up to 50)
  const crashes = analysisResult.insights.crashes.slice(0, 50).map(c => ({
    text: c.text.length > 200 ? c.text.substring(0, 200) : c.text,
    keyword: c.keyword,
    level: c.level,
    channel: c.channel,
  }));

  // Failing components (up to 20)
  const failingComponents = analysisResult.insights.topFailingComponents.slice(0, 20).map(c => ({
    name: c.name,
    errorCount: c.errorCount,
    warningCount: c.warningCount,
  }));

  // Sample lines per level and timestamp density — single scan pass
  const sampleLines: Record<string, string[]> = {};
  const componentSamples: Record<string, string[]> = {};
  const channelCounts: Record<string, number> = {};
  const timestampDensity: number[] = [];

  // Determine per-level sampling: evenly spaced indices
  const levelTargets: Record<string, { count: number; interval: number; next: number; samples: string[] }> = {};
  for (const [level, count] of Object.entries(analysisResult.levelCounts)) {
    if (count > 0) {
      const maxSamples = 10;
      const interval = Math.max(1, Math.floor(totalLines / maxSamples));
      levelTargets[level] = { count: 0, interval, next: 0, samples: [] };
    }
  }

  // Component name set for matching
  const componentNames = new Set(failingComponents.map(c => c.name));
  for (const name of componentNames) {
    componentSamples[name] = [];
  }

  // Single pass through the file
  let startTime: Date | null = null;
  let endTime: Date | null = null;
  const minuteBuckets = new Map<number, number>(); // minute offset -> count

  const batchSize = 10000;
  for (let start = 0; start < totalLines; start += batchSize) {
    const count = Math.min(batchSize, totalLines - start);
    const lines = fileHandler.getLines(start, count);
    for (const line of lines) {
      // Timestamp density
      const ts = parseTimestamp(line.text);
      if (ts) {
        if (!startTime) startTime = ts;
        endTime = ts;
        if (startTime) {
          const minuteOffset = Math.floor((ts.getTime() - startTime.getTime()) / 60000);
          if (minuteOffset >= 0 && minuteOffset < 1440) {
            minuteBuckets.set(minuteOffset, (minuteBuckets.get(minuteOffset) || 0) + 1);
          }
        }
      }

      // Channel/component counting — extract from bracket patterns like [ComponentName]
      const channelMatch = line.text.match(/\[([A-Za-z][A-Za-z0-9._-]{1,30})\]/);
      if (channelMatch) {
        const ch = channelMatch[1];
        channelCounts[ch] = (channelCounts[ch] || 0) + 1;
      }

      // Sample lines per level
      const level = line.level || 'other';
      const target = levelTargets[level];
      if (target && target.samples.length < 10 && line.lineNumber >= target.next) {
        target.samples.push(line.text.length > 200 ? line.text.substring(0, 200) : line.text);
        target.next = line.lineNumber + target.interval;
      }

      // Component error samples
      if ((level === 'error' || level === 'warning') && componentNames.size > 0) {
        for (const name of componentNames) {
          if (componentSamples[name].length < 5 && line.text.includes(name)) {
            componentSamples[name].push(line.text.length > 200 ? line.text.substring(0, 200) : line.text);
          }
        }
      }
    }
  }

  // Finalize sample lines
  for (const [level, target] of Object.entries(levelTargets)) {
    sampleLines[level] = target.samples;
  }

  // Build density histogram array
  if (minuteBuckets.size > 0) {
    const maxMinute = Math.min(1440, Math.max(...minuteBuckets.keys()) + 1);
    for (let i = 0; i < maxMinute; i++) {
      timestampDensity.push(minuteBuckets.get(i) || 0);
    }
  }

  return {
    sourceFile: path.basename(filePath),
    fileSize: fileInfo?.size || 0,
    totalLines,
    analyzerName: analysisResult.analyzerName,
    timeRange: analysisResult.timeRange || null,
    timestampDensity,
    levelCounts: analysisResult.levelCounts,
    levelPercentages,
    crashes,
    failingComponents,
    channelCounts,
    sampleLines,
    componentSamples,
  };
}

// --- BaselineStore ---

export class BaselineStore {
  private db: Database.Database;

  constructor(dbPathOverride?: string) {
    let dbPath: string;
    if (dbPathOverride) {
      const dir = path.dirname(dbPathOverride);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      dbPath = dbPathOverride;
    } else {
      const configDir = path.join(os.homedir(), '.logan');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      dbPath = path.join(configDir, 'baselines.db');
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS baselines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        source_file TEXT,
        total_lines INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        fingerprint BLOB NOT NULL
      )
    `);
  }

  save(name: string, description: string, tags: string[], fingerprint: BaselineFingerprint): string {
    const id = `bl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();
    const compressed = zlib.deflateSync(JSON.stringify(fingerprint));
    this.db.prepare(
      `INSERT INTO baselines (id, name, description, tags, source_file, total_lines, created_at, updated_at, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, description, JSON.stringify(tags), fingerprint.sourceFile, fingerprint.totalLines, now, now, compressed);
    return id;
  }

  list(): BaselineRecord[] {
    const rows = this.db.prepare(
      `SELECT id, name, description, tags, source_file, total_lines, created_at, updated_at FROM baselines ORDER BY created_at DESC`
    ).all() as Array<{ id: string; name: string; description: string; tags: string; source_file: string; total_lines: number; created_at: number; updated_at: number }>;
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      tags: JSON.parse(r.tags || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      sourceFile: r.source_file,
      totalLines: r.total_lines,
    }));
  }

  get(id: string): BaselineRecordFull | null {
    const row = this.db.prepare(
      `SELECT id, name, description, tags, source_file, total_lines, created_at, updated_at, fingerprint FROM baselines WHERE id = ?`
    ).get(id) as { id: string; name: string; description: string; tags: string; source_file: string; total_lines: number; created_at: number; updated_at: number; fingerprint: Buffer } | undefined;
    if (!row) return null;
    const fpJson = zlib.inflateSync(row.fingerprint).toString('utf-8');
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sourceFile: row.source_file,
      totalLines: row.total_lines,
      fingerprint: JSON.parse(fpJson),
    };
  }

  update(id: string, fields: { name?: string; description?: string; tags?: string[] }): boolean {
    const sets: string[] = [];
    const params: any[] = [];
    if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
    if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description); }
    if (fields.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(fields.tags)); }
    if (sets.length === 0) return false;
    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    const result = this.db.prepare(`UPDATE baselines SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM baselines WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  compare(currentFingerprint: BaselineFingerprint, baselineId: string): ComparisonReport | null {
    const baseline = this.get(baselineId);
    if (!baseline) return null;
    const blFp = baseline.fingerprint;
    const findings: ComparisonFinding[] = [];

    // 1. Level shift detection
    const allLevels = new Set([...Object.keys(currentFingerprint.levelPercentages), ...Object.keys(blFp.levelPercentages)]);
    for (const level of allLevels) {
      const blPct = blFp.levelPercentages[level] || 0;
      const curPct = currentFingerprint.levelPercentages[level] || 0;
      const diff = Math.abs(curPct - blPct);
      if (diff > 15) {
        findings.push({
          severity: 'critical',
          category: 'level-shift',
          title: `${level} rate: ${blPct.toFixed(1)}% → ${curPct.toFixed(1)}%`,
          detail: `${level} level changed by ${diff.toFixed(1)} percentage points`,
          baselineValue: `${blPct.toFixed(1)}%`,
          currentValue: `${curPct.toFixed(1)}%`,
        });
      } else if (diff > 5) {
        findings.push({
          severity: 'warning',
          category: 'level-shift',
          title: `${level} rate: ${blPct.toFixed(1)}% → ${curPct.toFixed(1)}%`,
          detail: `${level} level changed by ${diff.toFixed(1)} percentage points`,
          baselineValue: `${blPct.toFixed(1)}%`,
          currentValue: `${curPct.toFixed(1)}%`,
        });
      }
    }

    // 2. New crashes
    const blCrashKeywords = new Set(blFp.crashes.map(c => c.keyword.toLowerCase()));
    for (const crash of currentFingerprint.crashes) {
      if (!blCrashKeywords.has(crash.keyword.toLowerCase())) {
        findings.push({
          severity: 'critical',
          category: 'new-crash',
          title: `New crash: "${crash.keyword}"`,
          detail: crash.text.length > 100 ? crash.text.substring(0, 100) + '...' : crash.text,
          currentValue: crash.keyword,
        });
      }
    }

    // 3. New failing components
    const blComponentNames = new Set(blFp.failingComponents.map(c => c.name));
    for (const comp of currentFingerprint.failingComponents) {
      if (!blComponentNames.has(comp.name)) {
        findings.push({
          severity: 'warning',
          category: 'new-component',
          title: `New failing component: ${comp.name}`,
          detail: `${comp.errorCount} errors, ${comp.warningCount} warnings (not in baseline)`,
          currentValue: `${comp.errorCount} errors`,
        });
      }
    }

    // 4. Missing components
    const curChannels = new Set(Object.keys(currentFingerprint.channelCounts));
    for (const ch of Object.keys(blFp.channelCounts)) {
      if (!curChannels.has(ch) && blFp.channelCounts[ch] > 10) {
        findings.push({
          severity: 'info',
          category: 'missing-component',
          title: `Missing component: ${ch}`,
          detail: `Had ${blFp.channelCounts[ch]} lines in baseline, absent in current log`,
          baselineValue: `${blFp.channelCounts[ch]} lines`,
          currentValue: '0 lines',
        });
      }
    }

    // 5. Error rate spike per component
    const blComponentMap = new Map(blFp.failingComponents.map(c => [c.name, c]));
    for (const comp of currentFingerprint.failingComponents) {
      const blComp = blComponentMap.get(comp.name);
      if (blComp && blComp.errorCount > 0) {
        const ratio = comp.errorCount / blComp.errorCount;
        if (ratio > 5) {
          findings.push({
            severity: 'critical',
            category: 'error-rate',
            title: `${comp.name} errors ${ratio.toFixed(0)}x baseline`,
            detail: `${blComp.errorCount} → ${comp.errorCount} errors`,
            baselineValue: `${blComp.errorCount}`,
            currentValue: `${comp.errorCount}`,
          });
        } else if (ratio > 2) {
          findings.push({
            severity: 'warning',
            category: 'error-rate',
            title: `${comp.name} errors ${ratio.toFixed(1)}x baseline`,
            detail: `${blComp.errorCount} → ${comp.errorCount} errors`,
            baselineValue: `${blComp.errorCount}`,
            currentValue: `${comp.errorCount}`,
          });
        }
      }
    }

    // 6. Time pattern change
    if (blFp.timestampDensity.length > 0 && currentFingerprint.timestampDensity.length > 0) {
      const blVariance = computeVariance(blFp.timestampDensity);
      const curVariance = computeVariance(currentFingerprint.timestampDensity);
      if (blVariance > 0 && curVariance / blVariance > 3) {
        findings.push({
          severity: 'info',
          category: 'time-pattern',
          title: 'Activity pattern changed',
          detail: `Timestamp density variance is ${(curVariance / blVariance).toFixed(1)}x baseline — activity is more bursty or irregular`,
        });
      }
    }

    // Sort: critical first, then warning, then info
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      baselineId,
      baselineName: baseline.name,
      comparedAt: Date.now(),
      findings,
      summary: {
        critical: findings.filter(f => f.severity === 'critical').length,
        warning: findings.filter(f => f.severity === 'warning').length,
        info: findings.filter(f => f.severity === 'info').length,
      },
    };
  }

  close(): void {
    this.db.close();
  }
}

function computeVariance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
}
