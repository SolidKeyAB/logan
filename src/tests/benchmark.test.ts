import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileHandler } from '../main/fileHandler';
import { ColumnAwareAnalyzer } from '../main/analyzers/columnAwareAnalyzer';

// ── Benchmark Configuration ────────────────────────────────────────────────
// Adjust these to probe different limits
const FILE_SIZES = [
  { label: '10K lines',   lines: 10_000 },
  { label: '100K lines',  lines: 100_000 },
  { label: '500K lines',  lines: 500_000 },
  { label: '1M lines',    lines: 1_000_000 },
];

const BENCH_DIR = path.join(os.tmpdir(), 'logan-benchmark');

// ── Helpers ────────────────────────────────────────────────────────────────

const LEVELS = ['INFO', 'DEBUG', 'WARNING', 'ERROR', 'TRACE'];
const SERVICES = ['auth-service', 'api-gateway', 'user-db', 'cache-layer', 'worker-01'];
const MESSAGES = [
  'Request processed successfully in {ms}ms',
  'Connection established to {host}:{port}',
  'Cache miss for key session:{id}',
  'Database query executed: SELECT * FROM users WHERE id = {id}',
  'Heartbeat check passed',
  'Failed to connect to upstream server {host}',
  'Timeout waiting for response from {service}',
  'User {user} authenticated via OAuth2',
  'Rate limit exceeded for IP {ip}',
  'Memory usage at {pct}% — threshold warning',
  'Retrying request attempt {n}/3',
  'TLS handshake completed with cipher {cipher}',
  'Garbage collection pause: {ms}ms',
  'Configuration reloaded from /etc/app/config.yaml',
  'Session {id} expired after 30m idle',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateLogLine(lineNum: number): string {
  const date = new Date(2025, 0, 1, 0, 0, 0);
  date.setSeconds(date.getSeconds() + lineNum);
  const ts = date.toISOString().replace('T', ' ').replace('Z', '');
  const level = LEVELS[lineNum % LEVELS.length];
  const service = SERVICES[lineNum % SERVICES.length];
  const msg = MESSAGES[lineNum % MESSAGES.length]
    .replace('{ms}', String(randomInt(1, 500)))
    .replace('{host}', '10.0.0.' + randomInt(1, 254))
    .replace('{port}', String(randomInt(3000, 9000)))
    .replace('{id}', String(randomInt(1000, 9999)))
    .replace('{user}', 'user_' + randomInt(1, 200))
    .replace('{ip}', `192.168.${randomInt(0, 255)}.${randomInt(1, 254)}`)
    .replace('{n}', String(randomInt(1, 3)))
    .replace('{service}', SERVICES[randomInt(0, SERVICES.length - 1)])
    .replace('{pct}', String(randomInt(60, 98)))
    .replace('{cipher}', 'TLS_AES_256_GCM_SHA384');

  return `${ts} [${level}] [${service}] ${msg}`;
}

function generateTestFile(filePath: string, lineCount: number): void {
  const fd = fs.openSync(filePath, 'w');
  // Write in 10K-line chunks to avoid huge string allocations
  const chunkSize = 10_000;
  for (let i = 0; i < lineCount; i += chunkSize) {
    const lines: string[] = [];
    const end = Math.min(i + chunkSize, lineCount);
    for (let j = i; j < end; j++) {
      lines.push(generateLogLine(j));
    }
    fs.writeSync(fd, lines.join('\n') + '\n');
  }
  fs.closeSync(fd);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getMemoryMB(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

interface BenchResult {
  operation: string;
  fileSize: string;
  duration: string;
  throughput: string;
  memDelta: string;
}

const results: BenchResult[] = [];

// ── Setup & Teardown ───────────────────────────────────────────────────────

beforeAll(() => {
  fs.mkdirSync(BENCH_DIR, { recursive: true });
  console.log(`\n  Benchmark temp dir: ${BENCH_DIR}`);
  console.log(`  Generating test files...\n`);

  for (const size of FILE_SIZES) {
    const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
    if (!fs.existsSync(filePath)) {
      const start = performance.now();
      generateTestFile(filePath, size.lines);
      const elapsed = performance.now() - start;
      const stat = fs.statSync(filePath);
      console.log(`    Generated ${size.label} (${formatBytes(stat.size)}) in ${formatDuration(elapsed)}`);
    }
  }
  console.log('');
}, 120_000);

afterAll(() => {
  // Print summary table
  console.log('\n  ┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │                         LOGAN BENCHMARK RESULTS                              │');
  console.log('  ├────────────────────┬────────────┬────────────┬──────────────────┬─────────────┤');
  console.log('  │ Operation          │ File Size  │ Duration   │ Throughput       │ Mem Delta   │');
  console.log('  ├────────────────────┼────────────┼────────────┼──────────────────┼─────────────┤');
  for (const r of results) {
    console.log(
      `  │ ${r.operation.padEnd(18)} │ ${r.fileSize.padEnd(10)} │ ${r.duration.padEnd(10)} │ ${r.throughput.padEnd(16)} │ ${r.memDelta.padEnd(11)} │`
    );
  }
  console.log('  └────────────────────┴────────────┴────────────┴──────────────────┴─────────────┘\n');

  // Cleanup
  for (const f of fs.readdirSync(BENCH_DIR)) {
    fs.unlinkSync(path.join(BENCH_DIR, f));
  }
  fs.rmdirSync(BENCH_DIR);
});

// ── Benchmarks ─────────────────────────────────────────────────────────────

describe('Logan Benchmark', () => {
  // Increase timeout for large file operations
  const TIMEOUT = 300_000; // 5 minutes

  describe('File Indexing (open)', () => {
    for (const size of FILE_SIZES) {
      it(`should index ${size.label}`, async () => {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const handler = new FileHandler();
        const stat = fs.statSync(filePath);

        global.gc?.(); // Optional GC before measuring
        const memBefore = getMemoryMB();
        const start = performance.now();

        await handler.open(filePath);

        const elapsed = performance.now() - start;
        const memAfter = getMemoryMB();
        const totalLines = handler.getTotalLines();

        results.push({
          operation: 'Index (open)',
          fileSize: size.label,
          duration: formatDuration(elapsed),
          throughput: `${Math.round(totalLines / (elapsed / 1000))} lines/s`,
          memDelta: `+${(memAfter - memBefore).toFixed(1)} MB`,
        });

        expect(totalLines).toBe(size.lines);
        handler.close();
      }, TIMEOUT);
    }
  });

  describe('Line Reading (getLines)', () => {
    for (const size of FILE_SIZES) {
      it(`should read batches from ${size.label}`, async () => {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const handler = new FileHandler();
        await handler.open(filePath);

        const batchSize = 10_000;
        const totalLines = handler.getTotalLines();
        let linesRead = 0;

        const start = performance.now();

        // Read entire file in batches (simulates scroll-through)
        for (let i = 0; i < totalLines; i += batchSize) {
          const count = Math.min(batchSize, totalLines - i);
          const lines = handler.getLines(i, count);
          linesRead += lines.length;
        }

        const elapsed = performance.now() - start;

        results.push({
          operation: 'Read (batch)',
          fileSize: size.label,
          duration: formatDuration(elapsed),
          throughput: `${Math.round(linesRead / (elapsed / 1000))} lines/s`,
          memDelta: 'N/A',
        });

        expect(linesRead).toBe(size.lines);
        handler.close();
      }, TIMEOUT);
    }
  });

  describe('Random Access (getLines)', () => {
    for (const size of FILE_SIZES) {
      it(`should random-access lines from ${size.label}`, async () => {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const handler = new FileHandler();
        await handler.open(filePath);

        const totalLines = handler.getTotalLines();
        const accessCount = 1000;
        const batchSize = 50; // Simulate viewport-sized reads

        const start = performance.now();

        for (let i = 0; i < accessCount; i++) {
          const startLine = randomInt(0, totalLines - batchSize);
          handler.getLines(startLine, batchSize);
        }

        const elapsed = performance.now() - start;

        results.push({
          operation: 'Random access',
          fileSize: size.label,
          duration: formatDuration(elapsed),
          throughput: `${Math.round((accessCount * batchSize) / (elapsed / 1000))} lines/s`,
          memDelta: 'N/A',
        });

        expect(elapsed).toBeGreaterThan(0);
        handler.close();
      }, TIMEOUT);
    }
  });

  describe('Search (stream)', () => {
    for (const size of FILE_SIZES) {
      it(`should search literal pattern in ${size.label}`, async () => {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const handler = new FileHandler();
        await handler.open(filePath);

        const memBefore = getMemoryMB();
        const start = performance.now();

        const matches = await handler.search({
          pattern: 'Timeout waiting',
          isRegex: false,
          isWildcard: false,
          matchCase: false,
          wholeWord: false,
        });

        const elapsed = performance.now() - start;
        const memAfter = getMemoryMB();

        results.push({
          operation: 'Search (literal)',
          fileSize: size.label,
          duration: formatDuration(elapsed),
          throughput: `${matches.length} matches`,
          memDelta: `+${(memAfter - memBefore).toFixed(1)} MB`,
        });

        expect(matches.length).toBeGreaterThan(0);
        handler.close();
      }, TIMEOUT);
    }
  });

  describe('Search (regex)', () => {
    for (const size of FILE_SIZES) {
      it(`should search regex pattern in ${size.label}`, async () => {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const handler = new FileHandler();
        await handler.open(filePath);

        const start = performance.now();

        const matches = await handler.search({
          pattern: 'user_\\d{1,3}\\s+authenticated',
          isRegex: true,
          isWildcard: false,
          matchCase: false,
          wholeWord: false,
        });

        const elapsed = performance.now() - start;

        results.push({
          operation: 'Search (regex)',
          fileSize: size.label,
          duration: formatDuration(elapsed),
          throughput: `${matches.length} matches`,
          memDelta: 'N/A',
        });

        expect(matches.length).toBeGreaterThan(0);
        handler.close();
      }, TIMEOUT);
    }
  });

  describe('Filter by Level', () => {
    for (const size of FILE_SIZES) {
      it(`should filter ERROR+WARNING in ${size.label}`, async () => {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const handler = new FileHandler();
        await handler.open(filePath);

        const totalLines = handler.getTotalLines();
        const matchingLines = new Set<number>();
        const targetLevels = new Set(['error', 'warning']);

        const memBefore = getMemoryMB();
        const start = performance.now();

        const batchSize = 10_000;
        for (let s = 0; s < totalLines; s += batchSize) {
          const count = Math.min(batchSize, totalLines - s);
          const lines = handler.getLines(s, count);

          for (const line of lines) {
            const level = line.level || 'other';
            if (targetLevels.has(level)) {
              matchingLines.add(line.lineNumber);
            }
          }
        }

        const elapsed = performance.now() - start;
        const memAfter = getMemoryMB();

        results.push({
          operation: 'Filter (level)',
          fileSize: size.label,
          duration: formatDuration(elapsed),
          throughput: `${matchingLines.size} matches`,
          memDelta: `+${(memAfter - memBefore).toFixed(1)} MB`,
        });

        expect(matchingLines.size).toBeGreaterThan(0);
        handler.close();
      }, TIMEOUT);
    }
  });

  describe('Filter by Pattern', () => {
    for (const size of FILE_SIZES) {
      it(`should filter regex pattern in ${size.label}`, async () => {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const handler = new FileHandler();
        await handler.open(filePath);

        const totalLines = handler.getTotalLines();
        const matchingLines = new Set<number>();
        const includeRegex = new RegExp('Connection|Request|user_\\d+', 'i');

        const memBefore = getMemoryMB();
        const start = performance.now();

        const batchSize = 10_000;
        for (let s = 0; s < totalLines; s += batchSize) {
          const count = Math.min(batchSize, totalLines - s);
          const lines = handler.getLines(s, count);

          for (const line of lines) {
            if (includeRegex.test(line.text)) {
              matchingLines.add(line.lineNumber);
            }
          }
        }

        const elapsed = performance.now() - start;
        const memAfter = getMemoryMB();

        results.push({
          operation: 'Filter (regex)',
          fileSize: size.label,
          duration: formatDuration(elapsed),
          throughput: `${matchingLines.size} matches`,
          memDelta: `+${(memAfter - memBefore).toFixed(1)} MB`,
        });

        expect(matchingLines.size).toBeGreaterThan(0);
        handler.close();
      }, TIMEOUT);
    }
  });

  describe('Analysis (ColumnAware)', () => {
    // Only run analysis on smaller files — it's the heaviest operation
    const analysisSizes = FILE_SIZES.filter(s => s.lines <= 500_000);

    for (const size of analysisSizes) {
      it(`should analyze ${size.label}`, async () => {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const analyzer = new ColumnAwareAnalyzer();

        const memBefore = getMemoryMB();
        const start = performance.now();

        const result = await analyzer.analyze(filePath, {});

        const elapsed = performance.now() - start;
        const memAfter = getMemoryMB();

        results.push({
          operation: 'Analyze',
          fileSize: size.label,
          duration: formatDuration(elapsed),
          throughput: `${result.stats.analyzedLines} lines`,
          memDelta: `+${(memAfter - memBefore).toFixed(1)} MB`,
        });

        expect(result.stats.totalLines).toBe(size.lines);
      }, TIMEOUT);
    }
  });

  describe('Memory Profile', () => {
    it('should report memory usage at various file sizes', async () => {
      for (const size of FILE_SIZES) {
        const filePath = path.join(BENCH_DIR, `bench_${size.lines}.log`);
        const stat = fs.statSync(filePath);
        const handler = new FileHandler();

        global.gc?.();
        const memBefore = getMemoryMB();

        await handler.open(filePath);

        const memAfterIndex = getMemoryMB();

        // Load a batch of lines into memory (simulate cache)
        const lines = handler.getLines(0, Math.min(5000, handler.getTotalLines()));

        const memAfterCache = getMemoryMB();

        results.push({
          operation: 'Mem: index',
          fileSize: size.label,
          duration: formatBytes(stat.size),
          throughput: `${handler.getTotalLines()} lines`,
          memDelta: `+${(memAfterIndex - memBefore).toFixed(1)} MB`,
        });

        results.push({
          operation: 'Mem: +5K cache',
          fileSize: size.label,
          duration: formatBytes(stat.size),
          throughput: `${lines.length} cached`,
          memDelta: `+${(memAfterCache - memAfterIndex).toFixed(1)} MB`,
        });

        handler.close();
      }
    }, TIMEOUT);
  });
});
