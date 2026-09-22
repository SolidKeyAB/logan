import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VtraceAdapter, pickAdapter, adapterRegistry } from '../main/sourceAdapter';
import { decodeVtrace, parseVtraceToFile, formatRecord, VtraceRecord } from '../main/vtraceParse';

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

// Type-4 trace message: 27-byte header + payload + 8-byte ns uptime tail (+ an optional
// 4-byte PrivFlag tail when flags bit 0x40 is set). TraceTime is rendered from the COARSE
// monotonic ms at [5:9]; byte [22] is the LOGICAL type — 1 (default) ⇒ UTF-8 text.
function msg(opts: { tsNs: number; level: number; channel: number; source: number; text: string; logicalType?: number; privTail?: number }): Buffer {
  const body = Buffer.from(opts.text, 'utf8');
  const h = Buffer.alloc(27);
  h[0] = 0x04;
  h.writeUInt32BE(Math.floor(opts.tsNs / 1e6) >>> 0, 5); // coarse mono ms → TraceTime
  h.writeUInt16BE(opts.level, 9);
  h[11] = opts.privTail === undefined ? 0x20 : 0x60; // 0x40 bit ⇒ a PrivFlag tail follows
  h.writeUInt32BE(opts.channel, 13);
  h.writeUInt32BE(opts.source, 17);
  h[22] = opts.logicalType ?? 0x01; // logical type: 1 = text ([21] and [23:25] stay 0)
  h.writeUInt16BE(body.length, 25);
  const tail = opts.privTail === undefined ? Buffer.alloc(0) : u32(opts.privTail);
  return frame(Buffer.concat([h, body, u64(opts.tsNs), tail]));
}

// Type-3 ESO_COMM entity registration: id → (name, parentId). Names form a dotted
// hierarchy (Channel/Source resolve by walking parents). parent 0 = a root segment.
function entity(id: number, name: string, parent = 0): Buffer {
  const nb = Buffer.from(name, 'utf8');
  // Layout the decoder reads: own-id u32 at (nameEnd+2), parent u32 at (recordEnd-4).
  return frame(Buffer.concat([
    Buffer.from([0x03, 0x00, 0x00, nb.length]), nb,
    Buffer.from([0x00, 0x03]), u32(id),   // own-id u32 begins at nameEnd+2
    u32(parent),                          // parent u32 sits in the last 4 bytes
  ]));
}

// Type-0 session identity / restart marker: a later one opens a new SessionID.
function sessionMarker(): Buffer {
  return frame(Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00, 0x0e]), Buffer.from('traceserverGEN', 'latin1'), Buffer.from([0x00, 0x00, 0x40, 0x00])]));
}

// Type-5 dropped-data counter: num = u32 at [1:5]. The official emits one row for it.
function dropped(num: number): Buffer {
  return frame(Buffer.concat([Buffer.from([0x05]), u32(num)]));
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
  msg({ tsNs: 296_000_000_000, level: 2, channel: CH, source: SRC, text: '[4532:4532:1310123] [renderer]: cache ready' }),
  msg({ tsNs: 296_004_000_000, level: 1, channel: CH, source: SRC, text: '[4532:5990:1310123] [worker]: step complete' }),
  msg({ tsNs: 296_005_000_000, level: 0, channel: CH, source: 4666, text: '[1971:2015:1000] task scheduled' }),
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

// The three trace messages. The two entity + one anchor records at the front are
// on-disk framing types the decoder swallows (they never become rows), so decodeAll
// already returns only the type-4 rows; the filter guards against non-text rows.
function messages(buf: Buffer): VtraceRecord[] {
  return decodeAll(buf).filter(r => !r.undecoded);
}

// A capture exercising the logical-type gate: a text row, then two non-text type-4
// rows (logical 3 = ESO_COMM, 136 = RSTP) the official prints UNDECODED.
const UND_SAMPLE = Buffer.concat([
  entity(CH, 'MediaChannel'),
  anchor(BOOT_MS + 1000, 1000),
  msg({ tsNs: 300_000_000_000, level: 2, channel: CH, source: SRC, text: 'plain text row' }),
  msg({ tsNs: 300_001_000_000, level: 3, channel: CH, source: SRC, text: 'opaque binary', logicalType: 3 }),
  msg({ tsNs: 300_002_000_000, level: 4, channel: CH, source: SRC, text: 'opaque binary', logicalType: 136 }),
]);

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
    expect(recs[0].message).toBe('[4532:4532:1310123] [renderer]: cache ready');
    expect(recs[0].size).toBe(recs[0].message.length);
    expect(recs[1].level).toBe(1);
    expect(recs[2].message).toContain('task scheduled');
  });

  it('resolves channel/source ids to registered entity names, else the numeric id', () => {
    const recs = messages(SAMPLE);
    expect(recs[0].channel).toBe('MediaChannel'); // id 8339 was registered
    expect(recs[0].source).toBe('MediaSource');   // id 3876 was registered
    expect(recs[2].source).toBe('4666');          // id 4666 unregistered → numeric fallback
  });

  it('maps the numeric level to the official name set', () => {
    const recs = messages(SAMPLE);
    // Verified level table: 0=trace 1=debug 2=info 3=warn 4=ERROR.
    expect(recs[2].level).toBe(0);
    expect(formatRecord(recs[2])).toMatch(/\btrace\b/); // level 0 renders 'trace', not 'ERROR'
    expect(formatRecord(recs[0])).toMatch(/\binfo\b/);  // level 2 renders 'info'
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
    const text = '[1971:2018:1000] display changed: "画面テスト"';
    const recs = messages(msg({ tsNs: 1_000_000_000, level: 3, channel: CH, source: SRC, text }));
    expect(recs).toHaveLength(1);
    expect(recs[0].message).toBe(text);
    expect(recs[0].message).toContain('画面テスト');
    expect(recs[0].message).not.toContain('�'); // no replacement chars
  });

  it('splits an embedded-newline message into one row per line (shared PacketID/Size)', () => {
    // The official exporter emits one output row per line of a multi-line message; every
    // row shares the record's PacketID and Size, and a trailing \r is stripped.
    const recs = messages(msg({ tsNs: 1_000_000_000, level: 3, channel: CH, source: SRC, text: 'line one\nline two\r\nline three' }));
    expect(recs.map(r => r.message)).toEqual(['line one', 'line two', 'line three']);
    expect(recs.every(r => r.packetIndex === recs[0].packetIndex)).toBe(true);
    expect(recs.every(r => r.size === recs[0].size)).toBe(true);
    expect(recs.every(r => !r.message.includes('\n'))).toBe(true);
  });

  it('drops a single trailing empty line from a message that ends in a newline', () => {
    const recs = messages(msg({ tsNs: 1_000_000_000, level: 3, channel: CH, source: SRC, text: 'only line\n' }));
    expect(recs.map(r => r.message)).toEqual(['only line']);
  });

  it('emits one row per type-4 container and swallows on-disk framing records', () => {
    // The official exporter emits a row only for the trace-message container (type 4).
    // The entity (type-3) and anchor (type-32) records at the front produce no rows.
    const all = decodeAll(UND_SAMPLE);
    expect(all).toHaveLength(3);
    expect(all.every(r => r.type === 4)).toBe(true);
  });

  it('gates text vs UNDECODED on the logical type at byte [22], with a decoded header', () => {
    const all = decodeAll(UND_SAMPLE);
    const sz = Buffer.byteLength('opaque binary');
    // logical 1 → decoded text.
    expect(all[0].undecoded).toBe(false);
    expect(all[0].message).toBe('plain text row');
    // logical 3/136 → UNDECODED placeholder, but the header (channel/level/size) is
    // still fully decoded — exactly like the official exporter.
    expect(all[1].undecoded).toBe(true);
    expect(all[1].message).toBe(`UNDECODED: type=3[ESO_COMM] size=${sz}`);
    expect(all[1].channel).toBe('MediaChannel');
    expect(all[1].level).toBe(3);
    expect(all[2].undecoded).toBe(true);
    expect(all[2].message).toBe(`UNDECODED: type=136[RSTP] size=${sz}`);
  });

  it('numbers PacketID by absolute record index, not emitted-row count', () => {
    // SAMPLE = entity, entity, anchor, msg, msg, msg → the messages are records 3,4,5.
    expect(decodeAll(SAMPLE).map(r => r.packetIndex)).toEqual([3, 4, 5]);
  });

  it('decodes the PrivFlag bitmask from the 4-byte record tail', () => {
    const buf = Buffer.concat([
      msg({ tsNs: 1e9, level: 2, channel: CH, source: SRC, text: 'a', privTail: 0x04000001 }), // n + U  → "Un"
      msg({ tsNs: 1e9, level: 2, channel: CH, source: SRC, text: 'b', privTail: 0x80000000 }), // u      → "u"
      msg({ tsNs: 1e9, level: 2, channel: CH, source: SRC, text: 'c', privTail: 0x42000000 }), // l|g    → "lg"
      msg({ tsNs: 1e9, level: 2, channel: CH, source: SRC, text: 'd' }),                        // no tail → "--"
    ]);
    expect(decodeAll(buf).map(r => r.privFlag)).toEqual(['Un', 'u', 'lg', '--']);
  });

  it('emits a "Dropped Data" row for a type-5 counter record', () => {
    const buf = Buffer.concat([
      msg({ tsNs: 1e9, level: 2, channel: CH, source: SRC, text: 'before' }),
      dropped(113098),
      msg({ tsNs: 2e9, level: 2, channel: CH, source: SRC, text: 'after' }),
    ]);
    const drop = decodeAll(buf).find(r => r.type === 5)!;
    expect(drop.message).toBe('Dropped Data: num=113098');
    expect(formatRecord(drop)).toMatch(/--\s+Dropped Data: num=113098$/); // Size column is '--'
  });

  it('opens a new SessionID at each restart marker (first marker just labels session 0)', () => {
    const buf = Buffer.concat([
      sessionMarker(),                                                       // labels session 0
      msg({ tsNs: 1e9, level: 2, channel: CH, source: SRC, text: 's0' }),
      sessionMarker(),                                                       // restart → session 1
      msg({ tsNs: 2e9, level: 2, channel: CH, source: SRC, text: 's1' }),
    ]);
    expect(decodeAll(buf).map(r => r.sessionId)).toEqual([0, 1]);
  });

  it('resolves hierarchical names: source = last two segments, channel drops the shared prefix', () => {
    const buf = Buffer.concat([
      entity(1, 'traceserverGEN', 0),
      entity(2, 'serviceA', 1),
      entity(3, 'WorkerA', 2),
      entity(4, 'moduleB', 2),
      entity(5, 'Thread', 4),
      entity(6, 'StateInfo', 5),
      msg({ tsNs: 1e9, level: 2, channel: 6, source: 3, text: 'x' }),
    ]);
    const rec = messages(buf)[0];
    expect(rec.source).toBe('serviceA.WorkerA');           // last 2 of traceserverGEN.serviceA.WorkerA
    expect(rec.channel).toBe('moduleB.Thread.StateInfo');  // path minus shared prefix traceserverGEN.serviceA
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
      const row = lines.find(l => l.includes('[renderer]: cache ready'))!;
      expect(row).toContain('21.04.2026 18:10:22.993'); // 18:05:26.993 boot + 296.0 s
      expect(row).toContain('01.01.1970 00:04:56.000'); // TraceTime = 296.0 s uptime
      expect(row).toContain('MediaChannel');
      expect(row).toContain('MediaSource');
      expect(row).toMatch(/\binfo\b/);
      // PacketID is the absolute record index. The two entity + one anchor records occupy
      // indices 0,1,2, so the first trace message is record 3 → PacketID 0.3.
      expect(row.startsWith('0.3')).toBe(true);
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
