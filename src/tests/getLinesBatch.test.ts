import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileHandler } from '../main/fileHandler';

// B1 — the viewport read is now ONE positioned read sliced in memory (with a
// per-line fallback for pathological long lines) instead of a syscall per line.
// These tests lock in that the batched slicing returns byte-for-byte the same
// text/line-numbers as before, and that getLinesByNumbers coalesces runs.

let dir: string;
let filePath: string;
let handler: FileHandler;

// 500 short lines + one very long line (> MAX_LINE_READ = 10000) to exercise the
// truncation marker inside the batched slice path.
const LONG_LINE = 'X'.repeat(20000);
const LINES: string[] = [];
for (let i = 0; i < 500; i++) {
  LINES.push(i === 250 ? `line ${i} ${LONG_LINE}` : `line ${i} value=${i * 7}`);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-getlines-'));
  filePath = path.join(dir, 'sample.log');
  fs.writeFileSync(filePath, LINES.join('\n') + '\n', 'utf-8');
  handler = new FileHandler();
  await handler.open(filePath);
});

afterAll(() => {
  handler.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('getLines — batched contiguous read', () => {
  it('returns exact text and 0-based line numbers for a viewport', () => {
    const lines = handler.getLines(0, 5);
    expect(lines.map(l => l.lineNumber)).toEqual([0, 1, 2, 3, 4]);
    expect(lines[0].text).toBe('line 0 value=0');
    expect(lines[4].text).toBe('line 4 value=28');
  });

  it('reads a mid-file window correctly', () => {
    const lines = handler.getLines(100, 3);
    expect(lines.map(l => l.lineNumber)).toEqual([100, 101, 102]);
    expect(lines[1].text).toBe('line 101 value=707');
  });

  it('truncates a line longer than MAX_LINE_READ with a marker', () => {
    const [line] = handler.getLines(250, 1);
    expect(line.lineNumber).toBe(250);
    expect(line.text.endsWith('… (truncated)')).toBe(true);
    expect(line.text.length).toBeLessThan(LONG_LINE.length); // capped
  });

  it('clamps a range that runs past EOF', () => {
    const lines = handler.getLines(498, 50);
    expect(lines.map(l => l.lineNumber)).toEqual([498, 499]);
    expect(lines[1].text).toBe('line 499 value=3493');
  });

  it('async getLinesAsync matches sync getLines', async () => {
    const sync = handler.getLines(10, 20);
    const asyncLines = await handler.getLinesAsync(10, 20);
    expect(asyncLines.map(l => l.text)).toEqual(sync.map(l => l.text));
    expect(asyncLines.map(l => l.lineNumber)).toEqual(sync.map(l => l.lineNumber));
  });
});

describe('getLinesByNumbers — scattered filtered viewport', () => {
  it('returns the requested lines in the ORIGINAL order', async () => {
    const req = [400, 5, 5, 101, 6, 499];
    const lines = await handler.getLinesByNumbers(req);
    expect(lines.map(l => l.lineNumber)).toEqual([400, 5, 5, 101, 6, 499]);
    expect(lines.map(l => l.text)).toEqual([
      'line 400 value=2800',
      'line 5 value=35',
      'line 5 value=35',
      'line 101 value=707',
      'line 6 value=42',
      'line 499 value=3493',
    ]);
  });

  it('coalesces a consecutive run and drops out-of-range numbers', async () => {
    const lines = await handler.getLinesByNumbers([2, 3, 4, 99999]);
    expect(lines.map(l => l.lineNumber)).toEqual([2, 3, 4]);
    expect(lines.map(l => l.text)).toEqual([
      'line 2 value=14', 'line 3 value=21', 'line 4 value=28',
    ]);
  });

  it('is empty for an empty request', async () => {
    expect(await handler.getLinesByNumbers([])).toEqual([]);
  });
});
