import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VtraceAdapter, pickAdapter, adapterRegistry } from '../main/sourceAdapter';
import {
  decodeVtrace, parseVtraceToFile, findEpochAnchorMs, repairTs, newTsRepair, VtraceRecord,
  parseLoggerTimeSidecar, loggerTimeToAnchor, findSidecarAnchor, resolveWallClockAnchor,
} from '../main/vtraceParse';
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

// A capture "bundle": an isolated temp dir holding a .esotrace file and, optionally, a
// loggertime sidecar next to it — the layout findSidecarAnchor discovers.
function tmpBundle(buf: Buffer, sidecarJson?: string): { dir: string; esotrace: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-vtrace-bundle-'));
  const esotrace = path.join(dir, 'log_0000.esotrace');
  fs.writeFileSync(esotrace, buf);
  if (sidecarJson !== undefined) fs.writeFileSync(path.join(dir, 'loggertime_abc123.json'), sidecarJson);
  return { dir, esotrace };
}

function rmDir(dir: string): void { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }

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

  it('does NOT freeze when a spike slips UNDER the ceiling (the sticky-max latch)', () => {
    // The bug raising the ceiling could never fix: a garbage-high read that is still
    // BELOW TS_MAX (here ~58 days of ns — huge, but representable). A plain max()-clamp
    // would adopt it as `last` and floor every following record to it forever. The real,
    // much smaller timestamps that resume after it must still flow through unfrozen.
    const buf = buildFixture([
      record(296_000_000_000, 2, 'first'),          // 296 s
      record(296_005_000_000, 2, 'second'),         // +5 ms
      record(5_000_000_000_000_000, 2, 'spike'),    // ~58 days ns — garbage, but under the ~104-day ceiling
      record(296_010_000_000, 2, 'fourth'),         // real time resumes
      record(296_015_000_000, 2, 'fifth'),
    ]);
    const recs = decodeAll(buf);
    expect(recs.map(r => r.text)).toEqual(['first', 'second', 'spike', 'fourth', 'fifth']);
    // The spike is held at the last trusted value — it never becomes the floor.
    expect(recs[2].tsNs).toBe(296_005_000_000);
    // The tail keeps its own real, SMALL timestamps — the old max()-clamp would have
    // frozen both of these at the 5e15 spike.
    expect(recs[3].tsNs).toBe(296_010_000_000);
    expect(recs[4].tsNs).toBe(296_015_000_000);
    expect(recs.every(r => r.tsNs <= 296_015_000_000)).toBe(true); // nothing latched to the spike
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

// ── Sidecar wall-clock anchor (loggertime two-point map) ──────────────────────
describe('vtrace loggertime sidecar anchor', () => {
  // Two calibration points on the record ns timebase → epoch ms: slope exactly 1e-6,
  // boot epoch 1_700_000_000_000 (2023-11-14 22:13:20 UTC).
  const MAP = { x1: 296_000_000_000, y1: 1_700_000_296_000, x2: 596_000_000_000, y2: 1_700_000_596_000 };
  const MAP_JSON = JSON.stringify(MAP);
  // A fixture carrying an in-message anchor pinning the SAME boot epoch (for cross-check).
  const ANCHORED_LOCAL = buildFixture([
    record(296_000_000_000, 2, '[1:2:3] session start timestamp=1700000296000 monotonicTimestamp=296000000000'),
    record(296_005_000_000, 3, '[9:9:9] later event, no fields here'),
  ]);

  it('parseLoggerTimeSidecar reads a flat {x1,y1,x2,y2} map', () => {
    expect(parseLoggerTimeSidecar(MAP_JSON)).toEqual(MAP);
  });

  it('parseLoggerTimeSidecar tolerates string numbers and a one-level wrapper', () => {
    const wrapped = JSON.stringify({ loggertime: { x1: '296000000000', y1: '1700000296000', x2: '596000000000', y2: '1700000596000' } });
    expect(parseLoggerTimeSidecar(wrapped)).toEqual(MAP);
  });

  it('parseLoggerTimeSidecar returns null for malformed / degenerate maps', () => {
    expect(parseLoggerTimeSidecar('not json')).toBeNull();
    expect(parseLoggerTimeSidecar('{"x1":1,"y1":2}')).toBeNull();               // missing x2/y2
    expect(parseLoggerTimeSidecar('{"x1":5,"y1":2,"x2":5,"y2":9}')).toBeNull(); // x1==x2 → no slope
  });

  it('loggerTimeToAnchor recovers epoch0 + a ~1e-6 slope from two points', () => {
    const a = loggerTimeToAnchor(MAP)!;
    expect(a.epoch0Ms).toBe(1_700_000_000_000);
    expect(a.slopeMsPerNs).toBeCloseTo(1e-6, 12);
  });

  it('loggerTimeToAnchor rejects a wrong-unit x-axis (slope orders of magnitude off)', () => {
    // Same epochs but x in MICROSECONDS → slope ~1e-3 (1000× nominal) → rejected → fallback.
    expect(loggerTimeToAnchor({ x1: 296_000_000, y1: 1_700_000_296_000, x2: 596_000_000, y2: 1_700_000_596_000 })).toBeNull();
  });

  it('findSidecarAnchor discovers loggertime*.json in the SAME folder as the .esotrace', () => {
    const { dir, esotrace } = tmpBundle(SAMPLE, MAP_JSON);
    try {
      expect(findSidecarAnchor(esotrace)!.epoch0Ms).toBe(1_700_000_000_000);
    } finally { rmDir(dir); }
  });

  it('findSidecarAnchor returns null when no sidecar is present', () => {
    const { dir, esotrace } = tmpBundle(SAMPLE);
    try {
      expect(findSidecarAnchor(esotrace)).toBeNull();
    } finally { rmDir(dir); }
  });

  it('findSidecarAnchor falls back to a loggertime/ subfolder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-vtrace-sub-'));
    try {
      const esotrace = path.join(dir, 'log_0000.esotrace');
      fs.writeFileSync(esotrace, SAMPLE);
      fs.mkdirSync(path.join(dir, 'loggertime'));
      fs.writeFileSync(path.join(dir, 'loggertime', 'loggertime_x.json'), MAP_JSON);
      expect(findSidecarAnchor(esotrace)!.epoch0Ms).toBe(1_700_000_000_000);
    } finally { rmDir(dir); }
  });

  it('parseVtraceToFile stamps absolute dates from a sidecar (file has no in-message anchor)', async () => {
    const { dir, esotrace } = tmpBundle(SAMPLE, MAP_JSON);
    const outPath = path.join(dir, 'out.norm');
    try {
      await parseVtraceToFile(esotrace, outPath);
      const lines = fs.readFileSync(outPath, 'utf-8').split('\n');
      // SAMPLE record 0 is uptime 296.000000s → epoch0 + 296000ms.
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.000 WARNING /);
      expect(parseTimestampFast(lines[0])!.date.getTime()).toBe(1_700_000_296_000);
    } finally { rmDir(dir); }
  });

  it('resolveWallClockAnchor uses a sidecar that AGREES with the in-message anchor', () => {
    const { dir, esotrace } = tmpBundle(ANCHORED_LOCAL, MAP_JSON);
    try {
      expect(resolveWallClockAnchor(fs.readFileSync(esotrace), esotrace)!.epoch0Ms).toBe(1_700_000_000_000);
    } finally { rmDir(dir); }
  });

  it('resolveWallClockAnchor rejects a sidecar that DISAGREES with the in-message anchor', () => {
    // Sidecar pinned an hour off the in-message boot epoch → a different clock; the
    // provably-correct in-message anchor wins (not the offset sidecar value).
    const off = 3_600_000; // 1 h in ms
    const badMap = JSON.stringify({ x1: 296_000_000_000, y1: 1_700_000_296_000 + off, x2: 596_000_000_000, y2: 1_700_000_596_000 + off });
    const { dir, esotrace } = tmpBundle(ANCHORED_LOCAL, badMap);
    try {
      const a = resolveWallClockAnchor(fs.readFileSync(esotrace), esotrace)!;
      expect(a.epoch0Ms).toBe(1_700_000_000_000);
      expect(a.slopeMsPerNs).toBe(1e-6);
    } finally { rmDir(dir); }
  });

  it('an explicit opts.epochMsAnchor still overrides a present sidecar', () => {
    const { dir, esotrace } = tmpBundle(SAMPLE, MAP_JSON);
    try {
      const a = resolveWallClockAnchor(fs.readFileSync(esotrace), esotrace, { epochMsAnchor: 1_600_000_000_000 })!;
      expect(a.epoch0Ms).toBe(1_600_000_000_000);
    } finally { rmDir(dir); }
  });
});

// ── repairTs: sequence-based timestamp repair (unit) ─────────────────────────
const TS_MAX = Number.MAX_SAFE_INTEGER; // 2^53 - 1 ns ≈ 104 days, mirrors vtraceParse
const TWO_POW_40 = 0x100_00000000;      // 2^40 ns ≈ 18.3 min — the OLD (wrong) ceiling
const MAX_STEP = 3_600_000_000_000;     // 1 hour ns — mirrors vtraceParse's cadence bound

// Feed a whole raw-timestamp SEQUENCE through one repair state and collect the emitted
// values. Repair is now sequence-based, so the unit under test is a sequence, not a pair.
function runRepair(raw: number[]): number[] {
  const s = newTsRepair();
  return raw.map(r => repairTs(s, r));
}

describe('repairTs (sequence-based)', () => {
  it('passes normal in-cadence values straight through', () => {
    expect(runRepair([296_000_000_000, 296_010_000_000]))
      .toEqual([296_000_000_000, 296_010_000_000]);
  });

  it('accepts genuine timestamps past the old 2^40 (18.3 min) ceiling — no freeze', () => {
    // 2^40 ns is only ~18.3 min; each step here is well under the 1-hour cadence bound,
    // so a long capture keeps advancing instead of latching on the last sub-18-min value.
    expect(runRepair([296_000_000_000, TWO_POW_40, 1_200_000_000_000, 1_205_000_000_000]))
      .toEqual([296_000_000_000, TWO_POW_40, 1_200_000_000_000, 1_205_000_000_000]);
  });

  it('carries the last good value forward for a beyond-representable (garbage) read', () => {
    expect(runRepair([296_000_000_000, TS_MAX + 1, 296_010_000_000]))
      .toEqual([296_000_000_000, 296_000_000_000, 296_010_000_000]);
  });

  it('holds a LONE backward read at the last value (single-outlier monotonicity)', () => {
    expect(runRepair([296_000_000_000, 100, 296_010_000_000]))
      .toEqual([296_000_000_000, 296_000_000_000, 296_010_000_000]);
  });

  it('a leading corrupt read resolves to 0, never the ceiling (no latch)', () => {
    // First read is garbage → 0, and stays unseeded so the next real value flows freely.
    expect(runRepair([TS_MAX + 5, 296_000_000_000, 296_010_000_000]))
      .toEqual([0, 296_000_000_000, 296_010_000_000]);
  });

  it('does NOT let a lone spike under the ceiling become a permanent floor (the reported bug)', () => {
    // A garbage-high read that is still BELOW TS_MAX (~58 days ns). A max()-clamp would
    // adopt it and floor the rest of the file to it; here it is held for one line and the
    // smaller real values that resume flow straight through.
    const spike = 5_000_000_000_000_000;
    expect(runRepair([296_000_000_000, 296_005_000_000, spike, 296_010_000_000, 296_015_000_000]))
      .toEqual([296_000_000_000, 296_005_000_000, 296_005_000_000, 296_010_000_000, 296_015_000_000]);
  });

  it('self-heals: recovers even if a SUSTAINED bad-high run poisons the floor', () => {
    // The adversarial case for any monotonic scheme: three consecutive high reads confirm
    // a (wrong) new baseline, then the real, much lower stream returns. The floor must drop
    // back to reality after RESYNC_RUN low reads instead of freezing at the spike forever.
    const spike = 5_000_000_000_000_000;
    const out = runRepair([
      300_000_000_000, spike, spike + 1_000_000_000, spike + 2_000_000_000, // floor gets poisoned…
      301_000_000_000, 302_000_000_000, 303_000_000_000,                    // …then real time returns
    ]);
    expect(out).toContain(spike + 2_000_000_000);       // the bad region WAS briefly adopted (took 3 to confirm)
    expect(out[out.length - 1]).toBe(303_000_000_000);  // …but it healed back to reality — not frozen
    expect(out[out.length - 1]).toBeLessThan(spike);
  });

  it('adopts a genuine sustained large gap after confirmation (no freeze on real jumps)', () => {
    // A real gap bigger than one cadence step (~2.8 h > MAX_STEP) — e.g. the device resumed
    // after a long idle. Held only until RESYNC_RUN reads confirm the new region, then
    // adopted; it must reach the new region, not stay stuck at the pre-gap value.
    const far = 10_000_000_000_000; // ~2.8 h
    const out = runRepair([
      1_000_000_000, 2_000_000_000, // ~1–2 s
      far, far + 1_000_000_000, far + 2_000_000_000, far + 3_000_000_000,
    ]);
    expect(out[out.length - 1]).toBe(far + 3_000_000_000);
    expect(out[out.length - 1]).toBeGreaterThan(MAX_STEP);
  });
});
