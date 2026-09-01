import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VtraceAdapter, pickAdapter, adapterRegistry } from '../main/sourceAdapter';
import { decodeVtrace, parseVtraceToFile, findEpochAnchorMs, repairTs, VtraceRecord } from '../main/vtraceParse';
import { parseTimestampFast } from '../main/timestampParse';

// ── Minimal vtrace fixture builder ───────────────────────────────────────────
// Builds a buffer shaped like a real trace stream: a header carrying the
// "traceserverIVI" identity string, followed by contiguous fixed-tail message
// records. Each record's 39-byte tail precedes its UTF-8 text (see vtraceParse.ts
// for the field map). `tsHiByte` pokes a high byte into the timestamp to emulate a
// corrupt / out-of-range read whose timestamp must be carried forward.
const HDR = 39;

function record(tsNs: number, level: number, text: string, tsHiByte = 0): Buffer {
  const body = Buffer.from(text, 'utf8'); // messages are UTF-8 on the wire
  const sl = body.length;
  const tail = Buffer.alloc(HDR);
  // [0..8) uint64 BE timestamp. `tsHiByte` pokes a high byte to fake a garbage read
  // beyond the representable ceiling (a genuine large uptime uses tsHiByte = 0).
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

  it('keeps the timestamp stream monotonic by carrying forward a corrupt (out-of-range) read', () => {
    const buf = buildFixture([
      record(296_000_000_000, 2, 'first'),
      record(999_000_000_000, 2, 'corrupt read', /* tsHiByte */ 0xff), // garbage, beyond ceiling
      record(296_010_000_000, 2, 'third'),
    ]);
    const recs = decodeAll(buf);
    expect(recs.map(r => r.text)).toEqual(['first', 'corrupt read', 'third']);
    // The middle record's out-of-range timestamp is replaced by the prior good one.
    expect(recs[1].tsNs).toBe(296_000_000_000);
    expect(recs[0].tsNs).toBeLessThanOrEqual(recs[1].tsNs);
    expect(recs[1].tsNs).toBeLessThanOrEqual(recs[2].tsNs);
  });

  it('does NOT freeze on genuine timestamps past ~18 min (the 40-bit-ceiling latch-up)', () => {
    // The real bug: real reads (tsHiByte = 0) whose ns uptime naturally exceeds 2^40
    // (~18.3 min). The old ceiling misread each as "overflow" and carried the last good
    // value forward, so the whole tail of any >18-min capture showed one frozen timestamp.
    const buf = buildFixture([
      record(1_200_000_000_000, 2, 'twenty minutes in'),    // 20 min
      record(1_500_000_000_000, 2, 'twenty-five minutes'),  // 25 min
      record(1_800_000_000_000, 2, 'thirty minutes'),       // 30 min
    ]);
    const recs = decodeAll(buf);
    expect(recs.map(r => r.tsNs)).toEqual([
      1_200_000_000_000, 1_500_000_000_000, 1_800_000_000_000,
    ]);
    expect(new Set(recs.map(r => r.tsNs)).size).toBe(3); // strictly advancing, not frozen
  });

  it('does NOT latch the timestamp when the FIRST record is a corrupt (out-of-range) read', () => {
    // Regression: a leading corrupt read has nothing good to carry. It must resolve to
    // uptime 0 — NOT the ceiling — or every following record gets clamped to that ceiling
    // and the whole file shows one unchanging timestamp (the latch-up).
    const buf = buildFixture([
      record(999_000_000_000, 2, 'bad first', /* tsHiByte */ 0xff), // garbage, nothing to carry
      record(296_000_000_000, 2, 'second'),
      record(296_010_000_000, 2, 'third'),
    ]);
    const recs = decodeAll(buf);
    expect(recs.map(r => r.text)).toEqual(['bad first', 'second', 'third']);
    expect(recs[0].tsNs).toBe(0);                 // uptime origin, not TS_MAX
    expect(recs[1].tsNs).toBe(296_000_000_000);   // real values flow through — not clamped
    expect(recs[2].tsNs).toBe(296_010_000_000);
    expect(new Set(recs.map(r => r.tsNs)).size).toBeGreaterThan(1); // not stuck on one value
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

// ── repairTs: monotonic timestamp repair (unit) ──────────────────────────────
const TS_MAX = Number.MAX_SAFE_INTEGER; // 2^53 - 1 ns ≈ 104 days, mirrors vtraceParse
const TWO_POW_40 = 0x100_00000000;      // 2^40 ns ≈ 18.3 min — the OLD (wrong) ceiling
describe('repairTs', () => {
  it('passes a normal in-range value straight through', () => {
    expect(repairTs(296_000_000_000, -1)).toBe(296_000_000_000);
    expect(repairTs(296_010_000_000, 296_000_000_000)).toBe(296_010_000_000);
  });

  it('accepts genuine timestamps past the old 2^40 (18.3 min) ceiling — no freeze', () => {
    // 2^40 ns is only ~18.3 min. A real capture running longer than that must keep
    // advancing, not latch on the last sub-18-min value (the timestamp-freeze bug).
    expect(repairTs(TWO_POW_40, 296_000_000_000)).toBe(TWO_POW_40);
    const twentyMin = 1_200_000_000_000; // 1200 s, comfortably past 2^40
    expect(repairTs(twentyMin, TWO_POW_40)).toBe(twentyMin);
    expect(repairTs(twentyMin + 5_000_000_000, twentyMin)).toBe(twentyMin + 5_000_000_000);
  });

  it('carries the last good value forward only for a truly corrupt (beyond-representable) read', () => {
    expect(repairTs(TS_MAX + 1, 296_000_000_000)).toBe(296_000_000_000);
  });

  it('enforces monotonicity — an out-of-order lower read repeats the last value', () => {
    expect(repairTs(100, 296_000_000_000)).toBe(296_000_000_000);
  });

  it('a leading corrupt read resolves to 0, never the ceiling (no latch)', () => {
    // First record, nothing good to carry (lastTs = -1).
    expect(repairTs(TS_MAX + 5, -1)).toBe(0);
    // …and the next real value is then free to flow, not clamped to a huge seed.
    expect(repairTs(296_000_000_000, 0)).toBe(296_000_000_000);
  });
});
