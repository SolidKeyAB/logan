import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanFileIndex } from '../main/indexScan';
import { FileHandler } from '../main/fileHandler';

function tmpFile(content: string | Buffer): string {
  const p = path.join(os.tmpdir(), `logan-index-${process.pid}-${Math.random().toString(36).slice(2)}.log`);
  fs.writeFileSync(p, content);
  return p;
}

// Reconstruct each line's text from a scan result, so we can assert the byte
// offsets/lengths actually point at the right content (not just the count).
function linesFromScan(filePath: string): string[] {
  const r = scanFileIndex(filePath);
  const fd = fs.openSync(filePath, 'r');
  try {
    const out: string[] = [];
    for (let i = 0; i < r.totalLines; i++) {
      const len = r.lengths[i];
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, r.offsets[i]);
      out.push(buf.toString('utf-8'));
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

describe('scanFileIndex — line endings', () => {
  it('indexes LF-terminated lines', () => {
    const p = tmpFile('alpha\nbeta\ngamma\n');
    try {
      expect(linesFromScan(p)).toEqual(['alpha', 'beta', 'gamma']);
      expect(scanFileIndex(p).hasStandaloneCR).toBe(false);
    } finally { fs.unlinkSync(p); }
  });

  it('strips CR from CRLF lines (length excludes the terminator)', () => {
    const p = tmpFile('alpha\r\nbeta\r\ngamma\r\n');
    try {
      const r = scanFileIndex(p);
      expect(r.totalLines).toBe(3);
      expect(linesFromScan(p)).toEqual(['alpha', 'beta', 'gamma']);
      expect(r.hasStandaloneCR).toBe(false);
    } finally { fs.unlinkSync(p); }
  });

  it('handles CR-only (old Mac) line endings and flags hasStandaloneCR', () => {
    const p = tmpFile('alpha\rbeta\rgamma\r');
    try {
      const r = scanFileIndex(p);
      expect(r.totalLines).toBe(3);
      expect(linesFromScan(p)).toEqual(['alpha', 'beta', 'gamma']);
      expect(r.hasStandaloneCR).toBe(true);
    } finally { fs.unlinkSync(p); }
  });

  it('handles mixed LF / CRLF / CR endings', () => {
    const p = tmpFile('a\nb\r\nc\rd\n');
    try {
      expect(linesFromScan(p)).toEqual(['a', 'b', 'c', 'd']);
      expect(scanFileIndex(p).hasStandaloneCR).toBe(true);
    } finally { fs.unlinkSync(p); }
  });

  it('indexes a final line with no trailing newline', () => {
    const p = tmpFile('alpha\nbeta\nno-newline-tail');
    try {
      const r = scanFileIndex(p);
      expect(r.totalLines).toBe(3);
      expect(linesFromScan(p)).toEqual(['alpha', 'beta', 'no-newline-tail']);
    } finally { fs.unlinkSync(p); }
  });

  it('computes maxLineLength in bytes', () => {
    const p = tmpFile('a\nbbbbb\ncc\n');
    try {
      expect(scanFileIndex(p).maxLineLength).toBe(5);
    } finally { fs.unlinkSync(p); }
  });

  it('detects a #SPLIT: header and marks one header line', () => {
    const p = tmpFile('#SPLIT:part=2,total=5,prev=a.log,next=c.log\nreal line\n');
    try {
      const r = scanFileIndex(p);
      expect(r.headerLineCount).toBe(1);
      expect(r.splitMetadata).toEqual({ part: 2, total: 5, prev: 'a.log', next: 'c.log' });
      expect(r.totalLines).toBe(2); // header line is still a physical line
    } finally { fs.unlinkSync(p); }
  });

  it('handles line boundaries that straddle the 1MB chunk boundary', () => {
    // Build content where newlines land near a 1MB boundary to exercise the leftover path.
    const big = 'x'.repeat(1024 * 1024 - 3);
    const p = tmpFile(`${big}\r\nafter-boundary\nlast\n`);
    try {
      const lines = linesFromScan(p);
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe(big);
      expect(lines[1]).toBe('after-boundary');
      expect(lines[2]).toBe('last');
    } finally { fs.unlinkSync(p); }
  });
});

describe('FileHandler — open/getLines round-trip (inline index fallback)', () => {
  it('open() + getLines() return correct text and count', async () => {
    const p = tmpFile('one\ntwo\nthree\nfour\n');
    const fh = new FileHandler();
    try {
      const info = await fh.open(p);
      expect(info.totalLines).toBe(4);
      expect(fh.getTotalLines()).toBe(4);
      expect(fh.getLines(0, 4).map(l => l.text)).toEqual(['one', 'two', 'three', 'four']);
      expect(fh.getLines(1, 2).map(l => l.text)).toEqual(['two', 'three']);
    } finally {
      fh.close();
      fs.unlinkSync(p);
    }
  });

  it('hides the #SPLIT: header from visible lines', async () => {
    const p = tmpFile('#SPLIT:part=1,total=2,prev=,next=b.log\nfirst\nsecond\n');
    const fh = new FileHandler();
    try {
      const info = await fh.open(p);
      expect(info.totalLines).toBe(2);
      expect(fh.getLines(0, 2).map(l => l.text)).toEqual(['first', 'second']);
      expect(fh.getSplitMetadata()?.part).toBe(1);
    } finally {
      fh.close();
      fs.unlinkSync(p);
    }
  });

  it('indexNewLines() picks up appended content (live-tail)', async () => {
    const p = tmpFile('first\nsecond\n');
    const fh = new FileHandler();
    try {
      await fh.open(p);
      expect(fh.getTotalLines()).toBe(2);
      fs.appendFileSync(p, 'third\nfourth\n');
      const added = fh.indexNewLines();
      expect(added).toBe(2);
      expect(fh.getTotalLines()).toBe(4);
      expect(fh.getLines(0, 4).map(l => l.text)).toEqual(['first', 'second', 'third', 'fourth']);
    } finally {
      fh.close();
      fs.unlinkSync(p);
    }
  });

  it('indexNewLines() re-parses an unterminated tail line', async () => {
    const p = tmpFile('first\nsecond'); // no trailing newline
    const fh = new FileHandler();
    try {
      await fh.open(p);
      expect(fh.getLines(1, 1)[0].text).toBe('second');
      fs.appendFileSync(p, '-more\nthird\n');
      fh.indexNewLines();
      expect(fh.getTotalLines()).toBe(3);
      expect(fh.getLines(0, 3).map(l => l.text)).toEqual(['first', 'second-more', 'third']);
    } finally {
      fh.close();
      fs.unlinkSync(p);
    }
  });
});

// getLinesAsync() is the non-blocking read path used by the render IPC handlers;
// it must return byte-for-byte the same result as the synchronous getLines().
describe('FileHandler — getLinesAsync parity with getLines', () => {
  it('returns identical text, line numbers and levels as getLines()', async () => {
    const p = tmpFile('one\n[ERROR] boom\nthree\nfour\nfive\n');
    const fh = new FileHandler();
    try {
      await fh.open(p);
      for (const [start, count] of [[0, 5], [1, 2], [3, 10], [4, 1]] as const) {
        expect(await fh.getLinesAsync(start, count)).toEqual(fh.getLines(start, count));
      }
      // the ERROR line's level survives the async path
      expect((await fh.getLinesAsync(1, 1))[0].level).toBe('error');
    } finally {
      fh.close();
      fs.unlinkSync(p);
    }
  });

  it('applies the same MAX_LINE_READ truncation as getLines()', async () => {
    const huge = 'z'.repeat(20000); // > MAX_LINE_READ (10000)
    const p = tmpFile(`short\n${huge}\ntail\n`);
    const fh = new FileHandler();
    try {
      await fh.open(p);
      const [asyncLine] = await fh.getLinesAsync(1, 1);
      const [syncLine] = fh.getLines(1, 1);
      expect(asyncLine.text).toEqual(syncLine.text);
      expect(asyncLine.text.endsWith('(truncated)')).toBe(true);
    } finally {
      fh.close();
      fs.unlinkSync(p);
    }
  });

  it('hides the #SPLIT: header the same way', async () => {
    const p = tmpFile('#SPLIT:part=1,total=2,prev=,next=b.log\nalpha\nbeta\n');
    const fh = new FileHandler();
    try {
      await fh.open(p);
      expect((await fh.getLinesAsync(0, 2)).map(l => l.text)).toEqual(['alpha', 'beta']);
    } finally {
      fh.close();
      fs.unlinkSync(p);
    }
  });
});
