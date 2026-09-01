import * as fs from 'fs';
import * as path from 'path';

/**
 * ── vtrace: automotive IVI binary trace decoder ──────────────────────────────
 *
 * `vtrace` is a neutral codename for the binary trace format produced by the trace
 * server on some automotive IVI head units. On disk the files use the `.esotrace`
 * extension and open with a length-prefixed `traceserverIVI` identity record (both
 * are intrinsic markers of the input, matched only by the detector below). This
 * module recovers the human-readable trace messages with their nanosecond
 * timestamp and severity level — no vendor tooling required.
 *
 * Record layout (reverse-engineered; all multi-byte fields big-endian). Every
 * trace-message record ends with a fixed tail measured back from the start of its
 * UTF-8 message text `T`:
 *
 *   T-39 .. T-31 : uint64 timestamp      ns monotonic uptime (full 64-bit, big-endian)
 *   T-31 .. T-27 : uint32 payload_length == strlen + 35            ← invariant #2
 *   T-27         : uint8  type           0x04 = trace message      ← invariant #1
 *   T-26 .. T-18 : uint64 message id / sequence number
 *   T-18 .. T-16 : uint16 level          0=CRITICAL … 4=DEBUG (best-guess mapping)
 *   T-16         : uint8  marker         0x20                      ← invariant #3
 *   T-16 .. T-4  : packed pid/tid/uid (also present inline at the head of the text)
 *   T-4  .. T    : uint32 strlen
 *   T    .. T+L  : the message text, e.g. "[pid:tid:uid] message …"
 *
 * Robustness:
 *  - A record is accepted only when all four invariants hold AND the text is ≥90%
 *    printable, so false positives are effectively impossible and desync is
 *    self-correcting (we byte-scan forward to the next valid record).
 *  - The timestamp is a full uint64 ns uptime, so a genuine value can be arbitrarily
 *    large (it passes 2^40 — the old "40-bit" assumption — after only ~18.3 minutes).
 *    Which reads to trust is decided by the SEQUENCE, not by any absolute magnitude cap:
 *    a read that matches the recent cadence flows through; a lone outlier (a spike, or a
 *    backward read) is held at the last trusted value; and a SUSTAINED shift is confirmed
 *    over a few reads before it's adopted. So no single bad read can become a permanent
 *    floor — the failure mode a plain max()-clamp had (see repairTs).
 *
 * Output: one normalized line per record, with any embedded CR/LF folded to spaces
 * so FileHandler keeps a 1:1 record-to-line map and its level detection keys on the
 * LEVEL token. The timestamp prefix is an absolute `"YYYY-MM-DD HH:MM:SS.mmm"` date
 * when a wall-clock anchor is resolved (from an in-message timestamp/monotonicTimestamp
 * pair — see findEpochAnchorMs and docs/VTRACE.md §4), else the relative monotonic
 * device-uptime `"<seconds>"` it has always emitted.
 */

const HDR = 39; // fixed tail length for the common record shape
const MAX_STRLEN = 1 << 16;
// Representability guard (NOT a magnitude cap). The timestamp is a full uint64 ns
// CLOCK_MONOTONIC uptime. A read above JS's exact-integer limit (2^53 - 1 ≈ 104 days
// of ns) isn't even represented exactly, so it can only be a desync/garbage read.
// This is the ONLY absolute bound we keep on the value itself — everything else about
// which reads to trust is decided by the sequence, not by a threshold on magnitude.
// (Historical note: a 2^40 ≈ 18.3-min "ceiling" once lived here and wrongly rejected
// every genuine uptime past 18 min as overflow — see repairTs for why any absolute cap
// is the wrong tool.)
const TS_MAX = Number.MAX_SAFE_INTEGER; // 2^53 - 1 ns ≈ 104 days: largest exactly-representable uptime

// ── Sequence-based timestamp repair knobs ────────────────────────────────────
// MAX_STEP: the largest forward gap between two ADJACENT records we treat as normal
// cadence. It is a bound on the delta between neighbours, not on the absolute value —
// so raising it never re-introduces the 18-min freeze. Adjacent trace records in a
// continuous capture sit far under an hour apart; a corrupt "spike" read lands days
// away (a value that slips just under TS_MAX is ~58 days of ns). One hour therefore
// sits safely between real cadence and corruption. The exact figure is deliberately
// non-critical: RESYNC_RUN below is what actually guarantees we never latch, so this
// only decides how eagerly a genuine large gap is accepted immediately vs. confirmed.
const MAX_STEP = 3_600_000_000_000; // 1 hour in ns
// RESYNC_RUN: how many CONSECUTIVE, mutually-consistent reads it takes to adopt a new
// baseline that contradicts the current floor. This is the escape hatch that makes the
// floor self-healing instead of a permanent ratchet: a lone spike (or a genuine low
// read) is held, but a sustained shift — a real gap, or recovery from a floor that a
// bad read poisoned — is confirmed and adopted. 3 = a single outlier can never move it.
const RESYNC_RUN = 3;

/** Magic identity string present in a valid file's header (a marker of the input). */
const IDENTITY = Buffer.from('traceserverIVI', 'latin1');

// ── Absolute wall-clock anchor (in-message) ──────────────────────────────────
// The record timestamp is device CLOCK_MONOTONIC uptime, not a calendar date. But
// some messages carry BOTH an absolute `timestamp=<epoch-ms>` and the matching
// `monotonicTimestamp=<ns>` (the same monotonic clock as the record uptime). One
// such pair pins uptime-0 to epoch: epoch0_ms = timestamp_ms − monotonic_ns/1e6.
// Adding a record's uptime back then gives its absolute time. See docs/VTRACE.md §4.
// `timestamp=` is matched case-sensitively and must not be preceded by a letter, so
// it never captures the tail of `monotonicTimestamp=`.
const EPOCH_MS_RE = /(?:^|[^A-Za-z])timestamp=(\d{10,})/;
const MONO_NS_RE = /monotonicTimestamp=(\d+)/;
// Plausible epoch-ms window (2001-09 … 2096) — rejects unit mismatches (e.g. an
// epoch-seconds field) so a bad pair falls back to relative seconds, never a
// wildly-wrong date.
const EPOCH_MS_MIN = 1_000_000_000_000;
const EPOCH_MS_MAX = 4_000_000_000_000;

/** Format an absolute epoch-ms as "YYYY-MM-DD HH:MM:SS.mmm" in LOCAL time — the
 * same calendar convention parseTimestampFast reads back, so the emitted line
 * round-trips to the same instant regardless of the viewer's timezone. */
function formatAbsoluteMs(ms: number): string {
  const d = new Date(ms);
  const p2 = (x: number): string => String(x).padStart(2, '0');
  const p3 = (x: number): string => String(x).padStart(3, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
}

export const VTRACE_LEVELS: Record<number, string> = {
  0: 'CRITICAL', 1: 'ERROR', 2: 'WARNING', 3: 'INFO', 4: 'DEBUG', 5: 'VERBOSE',
};

export interface VtraceRecord {
  /** Monotonic device-uptime timestamp, nanoseconds. */
  tsNs: number;
  /** Raw numeric level (map via VTRACE_LEVELS). */
  level: number;
  /** Decoded message text, single line (embedded CR/LF folded to spaces). */
  text: string;
}

/**
 * If a valid trace-message record has its text starting at byte offset `t`,
 * return its [tsNs(raw), level, strlen]; otherwise null. `n` is buffer length.
 */
function recordAt(buf: Buffer, t: number, n: number): [number, number, number] | null {
  if (t - HDR < 0 || t + 4 > n) return null;
  const sl = buf.readUInt32BE(t - 4);
  if (sl < 1 || sl > MAX_STRLEN || t + sl > n) return null;
  if (buf[t - 27] !== 0x04) return null;                  // invariant #1: type
  if (buf.readUInt32BE(t - 31) !== sl + 35) return null;  // invariant #2: length
  if (buf[t - 16] !== 0x20) return null;                  // invariant #3: marker
  const level = buf.readUInt16BE(t - 18);
  if (level > 7) return null;
  // Printable-ratio check (invariant #4) — ASCII printables + TAB/CR/LF + high
  // bytes (>=128, i.e. UTF-8 multibyte text; messages carry non-ASCII content such
  // as CJK device names). Only control bytes count against the ratio, so this just
  // rejects control-heavy binary that slipped past the structural invariants.
  let printable = 0;
  for (let i = t; i < t + sl; i++) {
    const b = buf[i];
    if (b >= 32 || b === 9 || b === 10 || b === 13) printable++;
  }
  if (printable / sl < 0.9) return null;
  // Full uint64 ns timestamp at T-39 (big-endian). The high bytes are 0 only for short
  // uptimes; past ~18.3 min they carry real bits, so read the whole 8 bytes, not 5.
  const hi = buf.readUInt32BE(t - HDR);          // bytes T-39..T-35
  const lo = buf.readUInt32BE(t - HDR + 4);      // bytes T-35..T-31
  const rawTs = hi * 0x100000000 + lo;
  return [rawTs, level, sl];
}

/** Fold embedded newlines so one record == one output line. */
function oneLine(s: string): string {
  return s.indexOf('\n') === -1 && s.indexOf('\r') === -1
    ? s
    : s.replace(/\r\n|\r|\n/g, ' ');
}

/**
 * Rolling state for sequence-based timestamp repair. One instance per decode pass;
 * created with `newTsRepair()` and advanced one record at a time by `repairTs`.
 *
 *  - `last`     the last trusted, emitted ns value (the current floor); -1 before any
 *               record has been accepted.
 *  - `candBase` / `candRun`  a candidate new baseline that contradicts `last` (a spike,
 *               or a run of low reads), and how many CONSECUTIVE reads have agreed with
 *               it. Once `candRun` reaches RESYNC_RUN the candidate is adopted as the new
 *               floor. This is what lets the floor recover from a bad read instead of
 *               ratcheting on it forever.
 */
export interface TsRepairState {
  last: number;
  candBase: number;
  candRun: number;
}

/** Fresh repair state for a decode pass. */
export function newTsRepair(): TsRepairState {
  return { last: -1, candBase: -1, candRun: 0 };
}

/**
 * Advance the repair state by one raw timestamp read and return the ns value to emit.
 *
 * Sequence-based validation, replacing the old "absolute-magnitude cap + monotonic
 * max()-clamp". The clamp's fatal flaw was that it trusted every read as an upper
 * bound, so ONE over-high read that slipped under the cap became `last` and then
 * `max()` floored every following record to it — a permanent freeze. Here nothing is
 * trusted from a single read alone:
 *
 *   • A read that matches recent cadence (a forward step within MAX_STEP) is accepted
 *     as the new floor.
 *   • A lone outlier — a spike far above the floor, or a backward read below it — is
 *     NOT adopted; we emit the last trusted value and wait. A single bad read therefore
 *     costs exactly one carried line and can never poison the floor.
 *   • A SUSTAINED shift — RESYNC_RUN consecutive reads clustering in a new region —
 *     is confirmed and adopted, whether that region is higher (a genuine long gap) or
 *     lower (recovery from a floor a previous bad read had pushed too high). This is the
 *     self-healing property that a max()-clamp fundamentally cannot have.
 *
 * The only absolute bound is the representability guard (finite, non-negative, ≤ TS_MAX):
 * a read outside it isn't a real ns uptime at all, so it can never be a candidate.
 */
export function repairTs(state: TsRepairState, rawTs: number): number {
  const valid = Number.isFinite(rawTs) && rawTs >= 0 && rawTs <= TS_MAX && Number.isInteger(rawTs);

  // First record. Seed the floor from a valid read; a corrupt leading read has nothing
  // to carry, so emit uptime origin 0 and stay UNSEEDED (last = -1) — the next valid read
  // then seeds cleanly. It must NOT seed at TS_MAX (that was the old latch: a max seed
  // clamped the whole file to the ceiling).
  if (state.last < 0) {
    if (valid) { state.last = rawTs; return rawTs; }
    return 0;
  }

  // A structurally-impossible read (beyond representable) is pure garbage, never a real
  // region — carry the floor forward and cancel any pending resync.
  if (!valid) {
    state.candBase = -1;
    state.candRun = 0;
    return state.last;
  }

  // On-cadence forward step → accept directly and clear any pending candidate.
  const delta = rawTs - state.last;
  if (delta >= 0 && delta <= MAX_STEP) {
    state.last = rawTs;
    state.candBase = -1;
    state.candRun = 0;
    return state.last;
  }

  // Outlier (backward, or a jump larger than one step). Extend the candidate run if this
  // read is consistent with the pending candidate region; otherwise start a fresh run.
  if (state.candRun > 0 && Math.abs(rawTs - state.candBase) <= MAX_STEP) {
    state.candRun++;
  } else {
    state.candRun = 1;
  }
  state.candBase = rawTs;

  if (state.candRun >= RESYNC_RUN) {
    // Confirmed sustained shift — adopt the new baseline (self-heal / accept a real gap).
    state.last = rawTs;
    state.candBase = -1;
    state.candRun = 0;
    return state.last;
  }
  // Unconfirmed outlier — hold the timeline at the last trusted value.
  return state.last;
}

/**
 * Scan records for the first message carrying BOTH an absolute `timestamp=<epoch-ms>`
 * and a `monotonicTimestamp=<ns>`, and return the epoch-ms that corresponds to
 * device-uptime 0 (fractional): `epoch0_ms = timestamp_ms − monotonic_ns/1e6`.
 * Adding any record's uptime-ms back yields its absolute wall-clock time.
 *
 * Returns null when no plausible anchor exists in the file — the caller then keeps
 * the relative device-uptime seconds it emits today. Early-exits at the first good
 * pair (typically a boot/session banner near the file head), so it's usually cheap;
 * only pays a full extra scan when the file has no anchor at all.
 */
export function findEpochAnchorMs(buf: Buffer): number | null {
  const n = buf.length;
  let t = HDR;
  while (t < n - 4) {
    const rec = recordAt(buf, t, n);
    if (rec === null) { t += 1; continue; }
    const sl = rec[2];
    const text = buf.toString('utf8', t, t + sl);
    // Cheap pre-filter: only the rare anchor message mentions the monotonic field.
    if (text.indexOf('monotonicTimestamp=') !== -1) {
      const mono = MONO_NS_RE.exec(text);
      const epoch = EPOCH_MS_RE.exec(text);
      if (mono && epoch) {
        const epochMs = Number(epoch[1]);
        const monoNs = Number(mono[1]);
        if (Number.isFinite(epochMs) && Number.isFinite(monoNs)) {
          const anchor = epochMs - monoNs / 1e6;
          if (anchor >= EPOCH_MS_MIN && anchor <= EPOCH_MS_MAX) return anchor;
        }
      }
    }
    t += sl + HDR;
  }
  return null;
}

/**
 * Decode every trace message in `buf`, invoking `emit` for each in file order.
 * Returns the number of records emitted. Timestamps are repaired to be monotonic.
 */
export function decodeVtrace(buf: Buffer, emit: (rec: VtraceRecord) => void): number {
  const n = buf.length;
  const tsRepair = newTsRepair();
  let count = 0;
  let t = HDR;
  while (t < n - 4) {
    const rec = recordAt(buf, t, n);
    if (rec === null) { t += 1; continue; } // resync to next valid record
    const [rawTs, level, sl] = rec;
    const ts = repairTs(tsRepair, rawTs);
    emit({ tsNs: ts, level, text: oneLine(buf.toString('utf8', t, t + sl)) });
    count++;
    t += sl + HDR;
  }
  return count;
}

/** Detection helper: does this look like a vtrace file? */
export function isVtrace(filePath: string, head: Buffer): boolean {
  // `.esotrace` extension + the identity string are markers of the input format.
  return /\.esotrace$/i.test(filePath) && head.includes(IDENTITY);
}

/**
 * Stream-decode a vtrace file to a newline-delimited normalized text file the
 * FileHandler indexer can consume unchanged. Mirrors mf4Parse's buffered writer
 * (flush ~every 1 MB) and progress contract.
 *
 * When an absolute wall-clock anchor can be resolved (from `opts.epochMsAnchor`, or
 * auto-detected in-message via findEpochAnchorMs), each line is prefixed with a real
 * "YYYY-MM-DD HH:MM:SS.mmm" date so LOGAN's timestamp parser, time-gaps and the
 * timeline all work on wall-clock time. Otherwise it falls back to the relative
 * device-uptime seconds it has always emitted. (`opts.epochMsAnchor` is the hook a
 * future sidecar-based anchor would use.)
 */
export async function parseVtraceToFile(
  filePath: string,
  outPath: string,
  onProgress?: (percent: number) => void,
  opts?: { epochMsAnchor?: number | null },
): Promise<void> {
  const buf = fs.readFileSync(filePath);
  if (!buf.includes(IDENTITY)) {
    throw new Error(`Not a vtrace file: ${path.basename(filePath)}`);
  }

  // Resolve the wall-clock anchor once up front (uptime-0 → epoch ms). A supplied
  // anchor wins; otherwise auto-detect from an in-message timestamp/monotonic pair.
  const epochMsAnchor = opts?.epochMsAnchor ?? findEpochAnchorMs(buf);

  const fd = fs.openSync(outPath, 'w');
  let started = false;
  let pending = '';
  const flush = (): void => { if (pending) { fs.writeSync(fd, pending); pending = ''; } };
  const writeLine = (line: string): void => {
    pending += started ? '\n' + line : line;
    started = true;
    if (pending.length >= 1 << 20) flush();
  };

  try {
    const n = buf.length;
    let lastPct = -1;
    const tsRepair = newTsRepair();
    let t = HDR;
    while (t < n - 4) {
      const rec = recordAt(buf, t, n);
      if (rec === null) { t += 1; continue; }
      const [rawTs, level, sl] = rec;
      const ts = repairTs(tsRepair, rawTs);
      const stamp = epochMsAnchor !== null
        ? formatAbsoluteMs(epochMsAnchor + ts / 1e6)   // absolute wall-clock
        : (ts / 1e9).toFixed(6);                        // relative uptime seconds
      const lvl = VTRACE_LEVELS[level] ?? `L${level}`;
      writeLine(`${stamp} ${lvl} ${oneLine(buf.toString('utf8', t, t + sl))}`);
      t += sl + HDR;
      if (onProgress) {
        const pct = Math.min(99, Math.floor((t / n) * 100));
        if (pct !== lastPct) { onProgress(pct); lastPct = pct; }
      }
    }
    flush();
  } finally {
    fs.closeSync(fd);
  }
  onProgress?.(100);
}
