import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VtraceAdapter, pickAdapter, adapterRegistry } from '../main/sourceAdapter';
import { decodeVtrace, parseVtraceToFile, VtraceRecord } from '../main/vtraceParse';

// ── Minimal vtrace fixture builder ───────────────────────────────────────────
// Builds a buffer shaped like a real trace stream: a header carrying the
// "traceserverIVI" identity string, followed by contiguous fixed-tail message
// records. Each record's 39-byte tail precedes its UTF-8 text (see vtraceParse.ts
// for the field map).
const HDR = 39;

function record(tsNs: number, level: number, text: string): Buffer {
  const body = Buffer.from(text, 'utf8'); // messages are UTF-8 on the wire
  const sl = body.length;
  const tail = Buffer.alloc(HDR);
  // [0..8) uint64 BE timestamp (full ns uptime, high 32 bits then low 32 bits).
  tail.writeUInt32BE(Math.floor(tsNs / 0x100000000), 0);
  tail.writeUInt32BE(tsNs >>> 0, 4);
  tail.writeUInt32BE(sl + 35, 8);   // [8..12)  length invariant == strlen + 35
  tail[12] = 0x04;                  // [12]     type
  // [13..21) msgid — left zero
  tail.writeUInt16BE(level, 21);    // [21..23) level
  tail[23] = 0x20;                  // [23]     marker
  // [24..35) pid/tid/uid block — left zero
  tail.writeUInt32BE(sl, 35);       // [35..39) strlen
  return Buffer.concat([tail, body]);
}

function buildFixture(records: Buffer[]): Buffer {
  // A short identity preamble so detect()/the decode guard see "traceserverIVI".
  // The decoder byte-scans forward and resyncs onto the first valid record, so the
  // exact preamble bytes don't matter.
  const ident = Buffer.from('\x00\x00\x00\x17\x00\x01\x00\x00\x0etraceserverIVI', 'latin1');
  // Pad so the first real record's text never starts before offset HDR.
  const pad = Buffer.alloc(HDR);
  return Buffer.concat([ident, pad, ...records]);
}

function tmpVtrace(buf: Buffer): string {
  const p = path.join(os.tmpdir(), `logan-vtrace-fix-${process.pid}-${Math.random().toString(36).slice(2)}.esotrace`);
  fs.writeFileSync(p, buf);
  return p;
}

const SAMPLE = buildFixture([
  record(296_000_000_000, 2, '[4532:4532:1310123] [valhalla]: Using simple cache'),
  record(296_004_000_000, 1, '[4532:5990:1310123] [nav-sdk]: location callback'),
  record(296_005_000_000, 3, '[1971:2015:1000] Unrecognized alarm listener'),
]);

function decodeAll(buf: Buffer): VtraceRecord[] {
  const out: VtraceRecord[] = [];
  decodeVtrace(buf, (r) => out.push(r));
  return out;
}

describe('VtraceAdapter', () => {
  it('is registered ahead of the text fallback', () => {
    const ids = adapterRegistry.map(a => a.id);
    expect(ids).toContain('vtrace');
    expect(ids.indexOf('vtrace')).toBeLessThan(ids.indexOf('text'));
  });

  it('detect() matches a .esotrace file carrying the identity record', () => {
    const a = new VtraceAdapter();
    expect(a.detect('log_0000.esotrace', Buffer.from('xx traceserverIVI yy'))).toBe(true);
    expect(a.detect('log_0000.esotrace', Buffer.from('not a trace header'))).toBe(false); // no identity
    expect(a.detect('log.txt', Buffer.from('traceserverIVI'))).toBe(false);               // wrong extension
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
    const recs = decodeAll(SAMPLE);
    expect(recs).toHaveLength(3);
    expect(recs[0]).toMatchObject({ tsNs: 296_000_000_000, level: 2, text: '[4532:4532:1310123] [valhalla]: Using simple cache' });
    expect(recs[1].level).toBe(1);
    expect(recs[2].text).toContain('Unrecognized alarm listener');
  });

  it('emits the raw uint64 ns uptime verbatim — no repair, clamp or monotonicity fix', () => {
    // Earlier revisions ran a "timestamp repair" pass that carried/held/clamped reads to
    // keep the stream monotonic. That was an unverified reconstruction and is gone: every
    // record now shows exactly the ns value in its bytes, however large or out-of-order.
    const spike = 5_000_000_000_000_000; // ~58 days of ns — big, but exactly representable
    const buf = buildFixture([
      record(1_800_000_000_000, 2, 'thirty minutes'), // 30 min — past the old 2^40 "ceiling"
      record(spike, 2, 'spike'),                       // huge — emitted as-is, not held
      record(296_010_000_000, 2, 'back to small'),     // smaller — NOT clamped up to the spike
    ]);
    const recs = decodeAll(buf);
    expect(recs.map(r => r.tsNs)).toEqual([1_800_000_000_000, spike, 296_010_000_000]);
  });

  it('decodes UTF-8 multibyte message text (e.g. CJK) without mangling it', () => {
    // A real trace carries non-ASCII device names; latin1 would shred each 3-byte
    // UTF-8 char into high/C1-control bytes (the "[binary/corrupted data]" symptom).
    const msg = '[1971:2018:1000] Display device changed: "内蔵スクリーン"';
    const recs = decodeAll(buildFixture([record(1_000_000_000, 3, msg)]));
    expect(recs).toHaveLength(1);
    expect(recs[0].text).toBe(msg);
    expect(recs[0].text).toContain('内蔵スクリーン');
    expect(recs[0].text).not.toContain('�'); // no replacement chars
  });

  it('folds embedded newlines so one record maps to one line', () => {
    const recs = decodeAll(buildFixture([record(1_000_000_000, 3, 'line one\nline two\r\nline three')]));
    expect(recs[0].text).toBe('line one line two line three');
    expect(recs[0].text).not.toContain('\n');
  });

  it('normalize() writes "<uptime-seconds> L<level> <message>" lines, 1:1 with records', async () => {
    const p = tmpVtrace(SAMPLE);
    const outPath = path.join(os.tmpdir(), `logan-vtrace-out-${process.pid}-${Math.random().toString(36).slice(2)}.norm`);
    try {
      await parseVtraceToFile(p, outPath);
      const lines = fs.readFileSync(outPath, 'utf-8').split('\n');
      expect(lines).toHaveLength(3);
      // Raw monotonic uptime seconds + raw numeric level ("L<n>") — no wall-clock date
      // and no severity NAME (both were unverified guesses and were removed).
      expect(lines[0]).toBe('296.000000 L2 [4532:4532:1310123] [valhalla]: Using simple cache');
      expect(lines[1]).toContain(' L1 ');
      expect(lines[2]).toMatch(/^296\.005000 L3 /);
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
