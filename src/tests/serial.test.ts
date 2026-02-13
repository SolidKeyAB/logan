import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileHandler } from '../main/fileHandler';

// ─── FileHandler.indexNewLines() Tests ──────────────────────────────

describe('FileHandler.indexNewLines', () => {
  let tempDir: string;
  let tempFile: string;
  let handler: FileHandler;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-test-'));
    tempFile = path.join(tempDir, 'test.log');
    handler = new FileHandler();
  });

  afterEach(() => {
    handler.close();
    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
  });

  it('should return 0 for empty file with no new data', async () => {
    fs.writeFileSync(tempFile, '');
    await handler.open(tempFile);
    expect(handler.indexNewLines()).toBe(0);
  });

  it('should detect new lines appended to file', async () => {
    fs.writeFileSync(tempFile, 'line1\nline2\n');
    await handler.open(tempFile);
    expect(handler.getTotalLines()).toBe(2);

    // Append more lines
    fs.appendFileSync(tempFile, 'line3\nline4\nline5\n');
    const newLines = handler.indexNewLines();
    expect(newLines).toBe(3);
    expect(handler.getTotalLines()).toBe(5);
  });

  it('should handle single line append', async () => {
    fs.writeFileSync(tempFile, 'first\n');
    await handler.open(tempFile);
    expect(handler.getTotalLines()).toBe(1);

    fs.appendFileSync(tempFile, 'second\n');
    expect(handler.indexNewLines()).toBe(1);
    expect(handler.getTotalLines()).toBe(2);

    // Verify content via getLines
    const lines = handler.getLines(1, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('second');
  });

  it('should handle multiple incremental appends', async () => {
    fs.writeFileSync(tempFile, 'initial\n');
    await handler.open(tempFile);

    for (let i = 1; i <= 5; i++) {
      fs.appendFileSync(tempFile, `append-${i}\n`);
      const newLines = handler.indexNewLines();
      expect(newLines).toBe(1);
      expect(handler.getTotalLines()).toBe(1 + i);
    }

    // Verify all lines are readable
    const allLines = handler.getLines(0, 6);
    expect(allLines).toHaveLength(6);
    expect(allLines[0].text).toBe('initial');
    expect(allLines[5].text).toBe('append-5');
  });

  it('should handle unterminated last line then continuation', async () => {
    fs.writeFileSync(tempFile, 'line1\npartial');
    await handler.open(tempFile);
    // 'partial' is unterminated but still counted
    expect(handler.getTotalLines()).toBe(2);

    // Append the rest + a new line
    fs.appendFileSync(tempFile, '-complete\nline3\n');
    const newLines = handler.indexNewLines();
    // The previous 'partial' line gets extended to 'partial-complete', plus 'line3'
    // So net new lines = 2 (re-parsed partial + new line3), but since the old 'partial'
    // was already counted, the total should be 3
    expect(handler.getTotalLines()).toBe(3);

    const lines = handler.getLines(0, 3);
    expect(lines[1].text).toBe('partial-complete');
    expect(lines[2].text).toBe('line3');
  });

  it('should handle CRLF line endings', async () => {
    fs.writeFileSync(tempFile, 'line1\r\nline2\r\n');
    await handler.open(tempFile);
    expect(handler.getTotalLines()).toBe(2);

    fs.appendFileSync(tempFile, 'line3\r\nline4\r\n');
    expect(handler.indexNewLines()).toBe(2);
    expect(handler.getTotalLines()).toBe(4);
  });

  it('should handle mixed line endings', async () => {
    fs.writeFileSync(tempFile, 'unix\nwindows\r\n');
    await handler.open(tempFile);
    expect(handler.getTotalLines()).toBe(2);

    fs.appendFileSync(tempFile, 'more-unix\nanother-windows\r\n');
    expect(handler.indexNewLines()).toBe(2);
    expect(handler.getTotalLines()).toBe(4);
  });

  it('should handle large batch append', async () => {
    fs.writeFileSync(tempFile, 'start\n');
    await handler.open(tempFile);

    // Append 1000 lines at once
    const batch = Array.from({ length: 1000 }, (_, i) => `batch-${i}`).join('\n') + '\n';
    fs.appendFileSync(tempFile, batch);
    const newLines = handler.indexNewLines();
    expect(newLines).toBe(1000);
    expect(handler.getTotalLines()).toBe(1001);
  });

  it('should update fileInfo size correctly', async () => {
    fs.writeFileSync(tempFile, 'hello\n');
    const info = await handler.open(tempFile);
    const initialSize = info.size;

    fs.appendFileSync(tempFile, 'world\n');
    handler.indexNewLines();

    const updatedInfo = handler.getFileInfo();
    expect(updatedInfo).not.toBeNull();
    expect(updatedInfo!.size).toBeGreaterThan(initialSize);
    expect(updatedInfo!.totalLines).toBe(2);
  });

  it('should return 0 when no new data', async () => {
    fs.writeFileSync(tempFile, 'line1\nline2\n');
    await handler.open(tempFile);
    expect(handler.indexNewLines()).toBe(0);
    expect(handler.indexNewLines()).toBe(0);
  });

  it('should handle empty lines correctly', async () => {
    fs.writeFileSync(tempFile, 'a\n');
    await handler.open(tempFile);

    fs.appendFileSync(tempFile, '\n\nb\n');
    const newLines = handler.indexNewLines();
    expect(newLines).toBe(3); // empty, empty, 'b'
    expect(handler.getTotalLines()).toBe(4);
  });

  it('should track maxLineLength through incremental indexing', async () => {
    fs.writeFileSync(tempFile, 'short\n');
    await handler.open(tempFile);
    const initialMax = handler.getMaxLineLength();

    const longLine = 'x'.repeat(500);
    fs.appendFileSync(tempFile, longLine + '\n');
    handler.indexNewLines();
    expect(handler.getMaxLineLength()).toBe(500);
    expect(handler.getMaxLineLength()).toBeGreaterThan(initialMax);
  });
});

// ─── SerialHandler line buffering (simulated) ───────────────────────

describe('Serial line buffering simulation', () => {
  let tempDir: string;
  let tempFile: string;
  let fd: number;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-serial-test-'));
    tempFile = path.join(tempDir, 'serial.log');
    fs.writeFileSync(tempFile, '');
    fd = fs.openSync(tempFile, 'a');
  });

  afterEach(() => {
    try { fs.closeSync(fd); } catch {}
    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
  });

  // Simulate the line buffering logic from SerialHandler.handleData
  function simulateHandleData(chunk: string, lineBuffer: { value: string }): string[] {
    lineBuffer.value += chunk;
    const lines: string[] = [];
    let i = 0;
    let lineStart = 0;

    while (i < lineBuffer.value.length) {
      const ch = lineBuffer.value[i];
      if (ch === '\n') {
        lines.push(lineBuffer.value.substring(lineStart, i));
        lineStart = i + 1;
      } else if (ch === '\r') {
        lines.push(lineBuffer.value.substring(lineStart, i));
        if (i + 1 < lineBuffer.value.length && lineBuffer.value[i + 1] === '\n') {
          i++;
        }
        lineStart = i + 1;
      }
      i++;
    }
    lineBuffer.value = lineBuffer.value.substring(lineStart);
    return lines;
  }

  it('should split complete lines on LF', () => {
    const buf = { value: '' };
    const lines = simulateHandleData('line1\nline2\nline3\n', buf);
    expect(lines).toEqual(['line1', 'line2', 'line3']);
    expect(buf.value).toBe('');
  });

  it('should split complete lines on CRLF', () => {
    const buf = { value: '' };
    const lines = simulateHandleData('line1\r\nline2\r\n', buf);
    expect(lines).toEqual(['line1', 'line2']);
    expect(buf.value).toBe('');
  });

  it('should buffer partial lines', () => {
    const buf = { value: '' };
    const lines1 = simulateHandleData('partial', buf);
    expect(lines1).toEqual([]);
    expect(buf.value).toBe('partial');

    const lines2 = simulateHandleData('-complete\nnext', buf);
    expect(lines2).toEqual(['partial-complete']);
    expect(buf.value).toBe('next');
  });

  it('should handle chunks split mid-CRLF', () => {
    const buf = { value: '' };
    // First chunk ends with \r
    const lines1 = simulateHandleData('hello\r', buf);
    // \r alone produces a line (CR-only handling)
    expect(lines1).toEqual(['hello']);

    // Second chunk starts with \n (orphaned from the \r)
    const lines2 = simulateHandleData('\nworld\n', buf);
    // The orphaned \n produces an empty line, then 'world'
    expect(lines2).toEqual(['', 'world']);
    expect(buf.value).toBe('');
  });

  it('should handle empty lines', () => {
    const buf = { value: '' };
    const lines = simulateHandleData('\n\n\n', buf);
    expect(lines).toEqual(['', '', '']);
  });

  it('should handle rapid small chunks', () => {
    const buf = { value: '' };
    const allLines: string[] = [];

    // Simulate byte-by-byte arrival
    const data = 'hello\nworld\n';
    for (const ch of data) {
      allLines.push(...simulateHandleData(ch, buf));
    }
    expect(allLines).toEqual(['hello', 'world']);
    expect(buf.value).toBe('');
  });

  it('should write buffered lines to file correctly', () => {
    const buf = { value: '' };

    // Simulate serial data arrival and file writing
    const chunks = ['[INFO] Sys', 'tem start\n[ERR', 'OR] Fail\n[DEBUG] Ok\n'];
    let totalWritten = 0;

    for (const chunk of chunks) {
      const lines = simulateHandleData(chunk, buf);
      if (lines.length > 0) {
        const data = lines.map(l => l + '\n').join('');
        fs.writeSync(fd, data);
        totalWritten += lines.length;
      }
    }

    fs.closeSync(fd);
    fd = -1; // prevent double-close

    const content = fs.readFileSync(tempFile, 'utf-8');
    const fileLines = content.split('\n').filter(l => l.length > 0);
    expect(fileLines).toEqual([
      '[INFO] System start',
      '[ERROR] Fail',
      '[DEBUG] Ok',
    ]);
    expect(totalWritten).toBe(3);
  });

  it('should integrate with FileHandler.indexNewLines', async () => {
    const buf = { value: '' };
    const handler = new FileHandler();

    try {
      // Open the empty file
      await handler.open(tempFile);
      expect(handler.getTotalLines()).toBe(0);

      // Simulate serial data arriving in chunks
      const chunks = [
        '2024-01-01 ERROR something failed\n',
        '2024-01-01 INFO recovery started\n2024-01-01 WARNING low mem',
        'ory\n2024-01-01 DEBUG details\n',
      ];

      for (const chunk of chunks) {
        const lines = simulateHandleData(chunk, buf);
        if (lines.length > 0) {
          const data = lines.map(l => l + '\n').join('');
          fs.writeSync(fd, data);
          handler.indexNewLines();
        }
      }

      expect(handler.getTotalLines()).toBe(4);

      // Verify all lines are readable and correct
      const allLines = handler.getLines(0, 4);
      expect(allLines[0].text).toContain('ERROR something failed');
      expect(allLines[1].text).toContain('INFO recovery started');
      expect(allLines[2].text).toContain('WARNING low memory');
      expect(allLines[3].text).toContain('DEBUG details');

      // Verify level detection works on streamed data
      expect(allLines[0].level).toBe('error');
      expect(allLines[1].level).toBe('info');
      expect(allLines[2].level).toBe('warning');
      expect(allLines[3].level).toBe('debug');
    } finally {
      handler.close();
    }
  });
});
