import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  TextAdapter,
  pickAdapter,
  openWithAdapter,
  adapterRegistry,
} from '../main/sourceAdapter';

function tmpFile(content: string): string {
  const p = path.join(os.tmpdir(), `logan-adapter-${process.pid}-${Math.random().toString(36).slice(2)}.log`);
  fs.writeFileSync(p, content);
  return p;
}

describe('TextAdapter', () => {
  it('detect() always matches (catch-all fallback)', () => {
    expect(new TextAdapter().detect()).toBe(true);
  });

  it('normalize() is a zero-copy passthrough: returns the original path', async () => {
    const p = tmpFile('line one\nline two\n');
    try {
      const adapter = new TextAdapter();
      const source = await adapter.normalize(p);
      expect(source.path).toBe(p); // no derived/copied file
      expect(source.lineMap).toBeUndefined(); // normalized line N === original line N
      expect(source.cleanup).toBeUndefined(); // nothing to release
      expect(source.capabilities).toEqual({
        isBinary: false,
        supportsAppend: true,
        needsSchema: false,
        supportsColumnFilter: true,
      });
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('pickAdapter', () => {
  it('returns the text fallback for an ordinary file', () => {
    const p = tmpFile('hello\n');
    try {
      expect(pickAdapter(p).id).toBe('text');
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('honours the forceId "Open as…" override', () => {
    const p = tmpFile('hello\n');
    try {
      expect(pickAdapter(p, 'text').id).toBe('text');
      // Unknown override falls through to detection (text fallback here)
      expect(pickAdapter(p, 'does-not-exist').id).toBe('text');
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('only the text fallback is registered in Phase 1', () => {
    expect(adapterRegistry.map(a => a.id)).toEqual(['text']);
  });
});

describe('openWithAdapter', () => {
  it('feeds the normalized path straight to the indexer for text', async () => {
    const p = tmpFile('a\nb\nc\n');
    try {
      const calls: string[] = [];
      const fakeIndexer = {
        async open(openPath: string) {
          calls.push(openPath);
          return { path: openPath, size: 6, totalLines: 3 };
        },
      };
      const { info, source } = await openWithAdapter(fakeIndexer, p);
      expect(calls).toEqual([p]); // indexer opened the ORIGINAL file (no copy)
      expect(info.totalLines).toBe(3);
      expect(source.capabilities.isBinary).toBe(false);
    } finally {
      fs.unlinkSync(p);
    }
  });
});
