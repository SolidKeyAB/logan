import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  TextAdapter,
  JsonlAdapter,
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

  it('text fallback is always consulted last', () => {
    const ids = adapterRegistry.map(a => a.id);
    expect(ids[ids.length - 1]).toBe('text');
    expect(ids).toContain('jsonl');
  });

  it('detects .jsonl / .ndjson by extension', () => {
    const jl = path.join(os.tmpdir(), `logan-x-${process.pid}.jsonl`);
    const nd = path.join(os.tmpdir(), `logan-x-${process.pid}.ndjson`);
    fs.writeFileSync(jl, '{"a":1}\n');
    fs.writeFileSync(nd, '{"a":1}\n');
    try {
      expect(pickAdapter(jl).id).toBe('jsonl');
      expect(pickAdapter(nd).id).toBe('jsonl');
    } finally {
      fs.unlinkSync(jl); fs.unlinkSync(nd);
    }
  });

  it('detects JSONL by content (first line is a complete JSON object)', () => {
    const p = tmpFile('{"level":"info","msg":"hi"}\n{"level":"warn","msg":"bye"}\n');
    try {
      expect(pickAdapter(p).id).toBe('jsonl');
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('does NOT misdetect a pretty-printed .json object as JSONL', () => {
    const p = tmpFile('{\n  "level": "info",\n  "msg": "hi"\n}\n');
    try {
      expect(pickAdapter(p).id).toBe('text');
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('JsonlAdapter.normalize', () => {
  it('reformats records into readable log lines, 1:1 with input lines', async () => {
    const p = tmpFile(
      '{"timestamp":"2026-06-03T10:00:00Z","level":"info","msg":"started","port":8080}\n' +
      '{"level":"error","message":"boom","code":42}\n' +
      'not json at all\n'
    );
    const adapter = new JsonlAdapter();
    let last = 0;
    const source = await adapter.normalize(p, (pct) => { last = pct; });
    try {
      expect(source.path).not.toBe(p); // derived file
      expect(source.cleanup).toBeTypeOf('function');
      expect(last).toBe(100);
      const out = fs.readFileSync(source.path, 'utf-8');
      const lines = out.split('\n');
      expect(lines).toHaveLength(3); // same line count as input
      expect(lines[0]).toBe('2026-06-03T10:00:00Z INFO started port=8080');
      expect(lines[1]).toBe('ERROR boom code=42');
      expect(lines[2]).toBe('not json at all'); // passthrough for non-JSON
    } finally {
      source.cleanup?.();
      expect(fs.existsSync(source.path)).toBe(false); // cleanup removes the temp file
      fs.unlinkSync(p);
    }
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
