import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VtraceAdapter, pickAdapter, adapterRegistry } from '../main/sourceAdapter';
import { decodeVtrace, parseVtraceToFile, VtraceRecord } from '../main/vtraceParse';

// ── Real vtrace fixture builder ──────────────────────────────────────────────
// An `.esotrace` stream is self-framing: a flat sequence of `[u32be len][payload]`
// records with `payload[0] == type`. We build the three record kinds the decoder
// cares about (see vtraceParse.ts for the full field map).

function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function u64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(n / 0x100000000), 0);
  b.writeUInt32BE(n >>> 0, 4);
  return b;
}
function frame(payload: Buffer): Buffer { return Buffer.concat([u32(payload.length), payload]); }

// Type-4 trace message: 27-byte header + UTF-8 message + 8-byte ns uptime tail.
function msg(opts: { tsNs: number; level: number; channel: number; source: number; text: string }): Buffer {
  const body = Buffer.from(opts.text, 'utf8');
  const h = Buffer.alloc(27);
  h[0] = 0x04;
  h.writeUInt32BE(Math.floor(opts.tsNs / 1e6) >>> 0, 5); // coarse mono ms (decoder ignores it)
  h.writeUInt16BE(opts.level, 9);
  h[11] = 0x20;
  h.writeUInt32BE(opts.channel, 13);
  h.writeUInt32BE(opts.source, 17);
  h.writeUInt32BE(0x00010000, 21);
  h.writeUInt16BE(body.length, 25);
  return frame(Buffer.concat([h, body, u64(opts.tsNs)]));
}

// Type-3 ESO_COMM entity registration: id → name (drives Channel/Source resolution).
function entity(id: number, name: string): Buffer {
  const nb = Buffer.from(name, 'utf8');
  return frame(Buffer.concat([
    Buffer.from([0x03, 0x00, 0x00, nb.length]), nb,
    Buffer.from([0x00, 0x03, 0x00, 0x00]), Buffer.from([(id >> 8) & 0xff, id & 0xff]),
    Buffer.from([0x00, 0x00, 0xff]),
  ]));
}

// Type-32 clock anchor: (epoch_ms, mono_ms) → boot epoch for LoggerTime.
function anchor(epochMs: number, monoMs: number): Buffer {
  return frame(Buffer.concat([Buffer.from([0x20]), u64(epochMs), u64(monoMs), u32(0)]));
}

// A capture: register two entities, plant a system-clock anchor, then three messages.
// boot epoch = epochMs − monoMs = 1_776_794_726_993 ms = 2026-04-21 18:05:26.993 UTC.
const BOOT_MS = 1_776_794_726_993;
const CH = 8339, SRC = 3876;
const SAMPLE = Buffer.concat([
  entity(CH, 'MediaChannel'),
  entity(SRC, 'MediaSource'),
  anchor(BOOT_MS + 89_865, 89_865),
  msg({ tsNs: 296_000_000_000, level: 2, channel: CH, source: SRC, text: '[4532:4532:1310123] [valhalla]: Using simple cache' }),
  msg({ tsNs: 296_004_000_000, level: 1, channel: CH, source: SRC, text: '[4532:5990:1310123] [nav-sdk]: location callback' }),
  msg({ tsNs: 296_005_000_000, level: 0, channel: CH, source: 4666, text: '[1971:2015:1000] Unrecognized alarm listener' }),
]);

function tmpVtrace(buf: Buffer): string {
  const p = path.join(os.tmpdir(), `logan-vtrace-fix-${process.pid}-${Math.random().toString(36).slice(2)}.esotrace`);
  fs.writeFileSync(p, buf);
  return p;
}

function decodeAll(buf: Buffer): VtraceRecord[] {
  const out: VtraceRecord[] = [];
  decodeVtrace(buf, (r) => out.push(r));
  return out;
}

// The three trace messages (skip the two entity + one anchor records at the front).
function messages(buf: Buffer): VtraceRecord[] {
  return decodeAll(buf).filter(r => !r.undecoded);
}

describe('VtraceAdapter', () => {
  it('is registered ahead of the text fallback', () => {
    const ids = adapterRegistry.map(a => a.id);
    expect(ids).toContain('vtrace');
    expect(ids.indexOf('vtrace')).toBeLessThan(ids.indexOf('text'));
  });

  it('detect() matches a .esotrace file by identity string OR self-framing', () => {
    const a = new VtraceAdapter();
    expect(a.detect('log_0000.esotrace', Buffer.from('xx traceserverIVI yy'))).toBe(true); // identity
    expect(a.detect('log_0000.esotrace', SAMPLE.subarray(0, 64))).toBe(true);              // valid framing
    expect(a.detect('log_0000.esotrace', Buffer.from('not a trace header'))).toBe(false);  // neither
    expect(a.detect('log.txt', SAMPLE.subarray(0, 64))).toBe(false);                        // wrong extension
  });

  it('pickAdapter() routes a real fixture to the vtrace adapter', () => {
    const p = tmpVtrace(SAMPLE);
    try {
      expect(pickAdapter(p).id).toBe('vtrace');
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('decodes message text, level and nanosecond timestamp', () => {
    const recs = messages(SAMPLE);
    expect(recs).toHaveLength(3);
    expect(recs[0]).toMatchObject({ uptimeNs: 296_000_000_000, level: 2 });
    expect(recs[0].message).toBe('[4532:4532:1310123] [valhalla]: Using simple cache');
    expect(recs[0].size).toBe(recs[0].message.length);
    expect(recs[1].level).toBe(1);
    expect(recs[2].message).toContain('Unrecognized alarm listener');
  });

  it('resolves channel/source ids to registered entity names, else the numeric id', () => {
    const recs = messages(SAMPLE);
    expect(recs[0].channel).toBe('MediaChannel'); // id 8339 was registered
    expect(recs[0].source).toBe('MediaSource');   // id 3876 was registered
    expect(recs[2].source).toBe('4666');          // id 4666 unregistered → numeric fallback
  });

  it('maps the numeric level to the official name set', () => {
    const recs = messages(SAMPLE);
    // 0=ERROR 1=warn 2=info 3=debug 4=trace
    expect(recs[2].level).toBe(0);
  });

  it('reconstructs the wall-clock LoggerTime from the type-32 anchor', () => {
    const recs = messages(SAMPLE);
    // boot 1_776_794_726_993 ms + 296.0 s uptime = 1_776_795_022_993 ms.
    expect(recs[0].loggerMs).toBe(BOOT_MS + 296_000);
  });

  it('emits the raw uint64 ns uptime verbatim — no repair, clamp or monotonicity fix', () => {
    const spike = 5_000_000_000_000_000; // ~58 days of ns — big, but exactly representable
    const buf = Buffer.concat([
      msg({ tsNs: 1_800_000_000_000, level: 2, channel: CH, source: SRC, text: 'thirty minutes' }),
      msg({ tsNs: spike, level: 2, channel: CH, source: SRC, text: 'spike' }),
      msg({ tsNs: 296_010_000_000, level: 2, channel: CH, source: SRC, text: 'back to small' }),
    ]);
    expect(messages(buf).map(r => r.uptimeNs)).toEqual([1_800_000_000_000, spike, 296_010_000_000]);
  });

  it('decodes UTF-8 multibyte message text (e.g. CJK) without mangling it', () => {
    const text = '[1971:2018:1000] Display device changed: "内蔵スクリーン"';
    const recs = messages(msg({ tsNs: 1_000_000_000, level: 3, channel: CH, source: SRC, text }));
    expect(recs).toHaveLength(1);
    expect(recs[0].message).toBe(text);
    expect(recs[0].message).toContain('内蔵スクリーン');
    expect(recs[0].message).not.toContain('�'); // no replacement chars
  });

  it('folds embedded newlines so one record maps to one line', () => {
    const recs = messages(msg({ tsNs: 1_000_000_000, level: 3, channel: CH, source: SRC, text: 'line one\nline two\r\nline three' }));
    expect(recs[0].message).toBe('line one line two line three');
    expect(recs[0].message).not.toContain('\n');
  });

  it('prints non-message record types as UNDECODED, like the official exporter', () => {
    const recs = decodeAll(SAMPLE).filter(r => r.undecoded);
    expect(recs.length).toBeGreaterThanOrEqual(3); // 2 entities + 1 anchor
    expect(recs.some(r => r.message.startsWith('UNDECODED: type=3[ESO_COMM]'))).toBe(true);
    expect(recs.some(r => r.message.startsWith('UNDECODED: type=32['))).toBe(true);
  });

  it('normalize() writes the official 11-column export (banner + header + rows)', async () => {
    const p = tmpVtrace(SAMPLE);
    const outPath = path.join(os.tmpdir(), `logan-vtrace-out-${process.pid}-${Math.random().toString(36).slice(2)}.norm`);
    try {
      await parseVtraceToFile(p, outPath);
      const lines = fs.readFileSync(outPath, 'utf-8').split('\n');
      expect(lines[0]).toMatch(/^#----- BEGIN: .*\.esotrace: session #0$/);
      expect(lines[1]).toMatch(/^PacketID\s+SessionID\s+Label\s+LoggerTime\s+TraceTime\s+Channel\s+Source\s+Level\s+PrivFlag\s+Size\s+Message/);
      expect(lines[lines.length - 1]).toMatch(/^#----- END: .*\.esotrace: session #0$/);
      // The first trace message row: real LoggerTime, TraceTime from the 1970 epoch,
      // resolved channel/source names, official level name, size, message.
      const row = lines.find(l => l.includes('[valhalla]: Using simple cache'))!;
      expect(row).toContain('21.04.2026 18:10:22.993'); // 18:05:26.993 boot + 296.0 s
      expect(row).toContain('01.01.1970 00:04:56.000'); // TraceTime = 296.0 s uptime
      expect(row).toContain('MediaChannel');
      expect(row).toContain('MediaSource');
      expect(row).toMatch(/\binfo\b/);
      expect(row.startsWith('0.3')).toBe(true); // PacketID = session.seq (3 records precede it)
    } finally {
      fs.unlinkSync(p);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  });

  it('rejects a non-vtrace buffer from the decode entry point', async () => {
    const p = path.join(os.tmpdir(), `logan-vtrace-bad-${process.pid}.esotrace`);
    fs.writeFileSync(p, Buffer.from('just some text, no identity record'));
    const outPath = p + '.norm';
    try {
      await expect(parseVtraceToFile(p, outPath)).rejects.toThrow(/Not a vtrace/);
    } finally {
      fs.unlinkSync(p);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  });

  it('exposes binary, no-append capabilities', () => {
    const caps = new VtraceAdapter().capabilities;
    expect(caps.isBinary).toBe(true);
    expect(caps.supportsAppend).toBe(false);
    expect(caps.needsSchema).toBe(false);
  });
});
