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

// --- JSON file storage ---

interface StoredBaseline {
  id: string;
  name: string;
  description: string;
  tags: string[];
  sourceFile: string;
  totalLines: number;
  createdAt: number;
  updatedAt: number;
  fingerprint: BaselineFingerprint;
}

interface StoreData {
  version: 1;
  baselines: StoredBaseline[];
}

// --- BaselineStore (JSON file) ---

export class BaselineStore {
  private filePath: string;
  private data: StoreData;

  constructor(filePathOverride?: string) {
    if (filePathOverride) {
      const dir = path.dirname(filePathOverride);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.filePath = filePathOverride;
    } else {
      const configDir = path.join(os.homedir(), '.logan');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      this.filePath = path.join(configDir, 'baselines.json');
    }
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.baselines)) {
          return parsed;
        }
      }
    } catch {
      // Corrupted file — start fresh
    }

    // Migrate from SQLite if it exists
    const migrated = this.migrateFromSqlite();
    if (migrated) return migrated;

    return { version: 1, baselines: [] };
  }

  private migrateFromSqlite(): StoreData | null {
    try {
      const dbPath = path.join(path.dirname(this.filePath), 'baselines.db');
      if (!fs.existsSync(dbPath)) return null;

      // Try to load better-sqlite3 for one-time migration
      let Database: any;
      try {
        Database = require('better-sqlite3');
      } catch {
        // better-sqlite3 not available — skip migration, old DB will remain
        return null;
      }

      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare(
        'SELECT id, name, description, tags, source_file, total_lines, created_at, updated_at, fingerprint FROM baselines ORDER BY created_at DESC'
      ).all() as Array<any>;

      const zlib = require('zlib');
      const baselines: StoredBaseline[] = [];
      for (const r of rows) {
        try {
          const fpJson = zlib.inflateSync(r.fingerprint).toString('utf-8');
          baselines.push({
            id: r.id,
            name: r.name,
            description: r.description || '',
            tags: JSON.parse(r.tags || '[]'),
            sourceFile: r.source_file || '',
            totalLines: r.total_lines || 0,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            fingerprint: JSON.parse(fpJson),
          });
        } catch {
          // Skip corrupted rows
        }
      }
      db.close();

      const data: StoreData = { version: 1, baselines };
      this.persist(data);

      // Rename old DB so migration doesn't re-run
      fs.renameSync(dbPath, dbPath + '.migrated');
      console.log(`Migrated ${baselines.length} baselines from SQLite to JSON`);

      return data;
    } catch {
      return null;
    }
  }

  private persist(data?: StoreData): void {
    const d = data || this.data;
    fs.writeFileSync(this.filePath, JSON.stringify(d, null, 2), 'utf-8');
  }

  save(name: string, description: string, tags: string[], fingerprint: BaselineFingerprint): string {
    const id = `bl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();
    this.data.baselines.unshift({
      id,
      name,
      description,
      tags,
      sourceFile: fingerprint.sourceFile,
      totalLines: fingerprint.totalLines,
      createdAt: now,
      updatedAt: now,
      fingerprint,
    });
    this.persist();
    return id;
  }

  list(): BaselineRecord[] {
    return this.data.baselines.map(b => ({
      id: b.id,
      name: b.name,
      description: b.description,
      tags: b.tags,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      sourceFile: b.sourceFile,
      totalLines: b.totalLines,
    }));
  }

  get(id: string): BaselineRecordFull | null {
    const b = this.data.baselines.find(b => b.id === id);
    if (!b) return null;
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      tags: b.tags,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      sourceFile: b.sourceFile,
      totalLines: b.totalLines,
      fingerprint: b.fingerprint,
    };
  }

  update(id: string, fields: { name?: string; description?: string; tags?: string[] }): boolean {
    const b = this.data.baselines.find(b => b.id === id);
    if (!b) return false;
    if (fields.name !== undefined) b.name = fields.name;
    if (fields.description !== undefined) b.description = fields.description;
    if (fields.tags !== undefined) b.tags = fields.tags;
    b.updatedAt = Date.now();
    this.persist();
    return true;
  }

  delete(id: string): boolean {
    const idx = this.data.baselines.findIndex(b => b.id === id);
    if (idx === -1) return false;
    this.data.baselines.splice(idx, 1);
    this.persist();
    return true;
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
}

function computeVariance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
}
