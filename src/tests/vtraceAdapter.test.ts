import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VtraceAdapter, pickAdapter, adapterRegistry } from '../main/sourceAdapter';
import { decodeVtrace, parseVtraceToFile, findEpochAnchorMs, VtraceRecord } from '../main/vtraceParse';
import { parseTimestampFast } from '../main/timestampParse';

// ── Minimal vtrace fixture builder ───────────────────────────────────────────
// Builds a buffer shaped like a real trace stream: a header carrying the
// "traceserverIVI" identity string, followed by contiguous fixed-tail message
// records. Each record's 39-byte tail precedes its UTF-8 text (see vtraceParse.ts
// for the field map). `tsHiByte` injects a high byte into the timestamp to emulate
// the variable-header records whose timestamp must be carried forward.
const HDR = 39;

function record(tsNs: number, level: number, text: string, tsHiByte = 0): Buffer {
  const body = Buffer.from(text, 'utf8'); // messages are UTF-8 on the wire
  const sl = body.length;
  const tail = Buffer.alloc(HDR);
  // [0..8) uint64 BE timestamp (40-bit value; tsHiByte pokes bit 40+ to fake a
  // variable-header record that overflows the 40-bit read).
  tail.writeUInt32BE(Math.floor(tsNs / 0x100000000) | (tsHiByte << 16), 0);
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

  it('keeps the timestamp stream monotonic by carrying forward variable-header reads', () => {
    const buf = buildFixture([
      record(296_000_000_000, 2, 'first'),
      record(999_000_000_000, 2, 'variable-header record', /* tsHiByte */ 0xff), // bad read
      record(296_010_000_000, 2, 'third'),
    ]);
    const recs = decodeAll(buf);
    expect(recs.map(r => r.text)).toEqual(['first', 'variable-header record', 'third']);
    // The middle record's overflowed timestamp is replaced by the prior good one.
    expect(recs[1].tsNs).toBe(296_000_000_000);
    expect(recs[0].tsNs).toBeLessThanOrEqual(recs[1].tsNs);
    expect(recs[1].tsNs).toBeLessThanOrEqual(recs[2].tsNs);
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

  it('normalize() writes "<seconds> <LEVEL> <message>" lines, 1:1 with records', async () => {
    const p = tmpVtrace(SAMPLE);
    const outPath = path.join(os.tmpdir(), `logan-vtrace-out-${process.pid}-${Math.random().toString(36).slice(2)}.norm`);
    try {
      await parseVtraceToFile(p, outPath);
      const lines = fs.readFileSync(outPath, 'utf-8').split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('296.000000 WARNING [4532:4532:1310123] [valhalla]: Using simple cache');
      expect(lines[1]).toContain(' ERROR ');
      expect(lines[2]).toMatch(/^296\.005000 INFO /);
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

// ── Absolute wall-clock anchor (in-message timestamp + monotonicTimestamp) ─────
describe('vtrace absolute wall-clock anchor', () => {
  // uptime 296.000000s; the message pins that uptime to epoch-ms 1_700_000_296_000,
  // so uptime-0 → 1_700_000_000_000 (2023-11-14 22:13:20 UTC).
  const ANCHORED = buildFixture([
    record(296_000_000_000, 2, '[1:2:3] session start timestamp=1700000296000 monotonicTimestamp=296000000000'),
    record(296_005_000_000, 3, '[9:9:9] later event, no fields here'),
  ]);

  it('findEpochAnchorMs derives uptime-0 → epoch-ms from an in-message pair', () => {
    expect(findEpochAnchorMs(ANCHORED)).toBe(1_700_000_000_000);
  });

  it('findEpochAnchorMs returns null when no message carries the pair', () => {
    expect(findEpochAnchorMs(SAMPLE)).toBeNull();
  });

  it('findEpochAnchorMs rejects an implausible pair (unit mismatch) → null', () => {
    // epoch-SECONDS mistakenly in the field would land in 1970; must not anchor.
    const bad = buildFixture([
      record(1_000_000_000, 2, 'boot timestamp=1700000296 monotonicTimestamp=1000000000'),
    ]);
    expect(findEpochAnchorMs(bad)).toBeNull();
  });

  it('parseVtraceToFile emits absolute "YYYY-MM-DD HH:MM:SS.mmm" lines when anchored', async () => {
    const p = tmpVtrace(ANCHORED);
    const outPath = path.join(os.tmpdir(), `logan-vtrace-abs-${process.pid}-${Math.random().toString(36).slice(2)}.norm`);
    try {
      await parseVtraceToFile(p, outPath);
      const lines = fs.readFileSync(outPath, 'utf-8').split('\n');
      expect(lines).toHaveLength(2);
      // Absolute date prefix (not the relative "296.xxxxxx" form). Millisecond part
      // is timezone-independent: uptime .000000s → .000, +5ms → .005.
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.000 WARNING /);
      expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.005 INFO /);
      // Round-trips through LOGAN's own parser; the 5ms uptime gap is preserved and
      // TZ-independent (both lines share the runner's zone).
      const t0 = parseTimestampFast(lines[0]);
      const t1 = parseTimestampFast(lines[1]);
      expect(t0).not.toBeNull();
      expect(t1).not.toBeNull();
      expect(t1!.date.getTime() - t0!.date.getTime()).toBe(5);
    } finally {
      fs.unlinkSync(p);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  });

  it('parseVtraceToFile honours a supplied epochMsAnchor (sidecar hook)', async () => {
    const p = tmpVtrace(SAMPLE); // SAMPLE has no in-message anchor
    const outPath = path.join(os.tmpdir(), `logan-vtrace-abs2-${process.pid}-${Math.random().toString(36).slice(2)}.norm`);
    try {
      await parseVtraceToFile(p, outPath, undefined, { epochMsAnchor: 1_700_000_000_000 });
      const lines = fs.readFileSync(outPath, 'utf-8').split('\n');
      // SAMPLE record 0 is uptime 296.000000s → +296000ms from the supplied anchor.
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.000 WARNING /);
      expect(parseTimestampFast(lines[0])!.date.getTime()).toBe(1_700_000_296_000);
    } finally {
      fs.unlinkSync(p);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  });
});
