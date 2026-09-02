import * as fs from 'fs';
import * as path from 'path';

/**
 * ── vtrace: automotive IVI binary trace decoder ──────────────────────────────
 *
 * `vtrace` is a neutral codename for the binary trace format produced by the trace
 * server on some automotive IVI head units. On disk the files use the `.esotrace`
 * extension and open with a length-prefixed `traceserverIVI` identity record (both
 * are intrinsic markers of the input, matched only by the detector below). This
 * module recovers the human-readable trace messages with their raw record fields —
 * no vendor tooling required.
 *
 * Record layout (reverse-engineered; all multi-byte fields big-endian). Every
 * trace-message record ends with a fixed tail measured back from the start of its
 * UTF-8 message text `T`:
 *
 *   T-39 .. T-31 : uint64 timestamp      ns monotonic uptime (full 64-bit, big-endian)
 *   T-31 .. T-27 : uint32 payload_length == strlen + 35            ← invariant #2
 *   T-27         : uint8  type           0x04 = trace message      ← invariant #1
 *   T-26 .. T-18 : uint64 message id / sequence number
 *   T-18 .. T-16 : uint16 level          (raw numeric level, emitted as "L<n>")
 *   T-16         : uint8  marker         0x20                      ← invariant #3
 *   T-16 .. T-4  : packed pid/tid/uid (also present inline at the head of the text)
 *   T-4  .. T    : uint32 strlen
 *   T    .. T+L  : the message text, e.g. "[pid:tid:uid] message …"
 *
 * Robustness:
 *  - A record is accepted only when all four invariants hold AND the text is ≥90%
 *    printable, so false positives are effectively impossible and desync is
 *    self-correcting (we byte-scan forward to the next valid record).
 *
 * Honesty note — NO derived "ground truth":
 *  This decoder emits ONLY values it reads directly from the record bytes. It does
 *  NOT invent a wall-clock date and does NOT assign severity NAMES:
 *    • The timestamp column is the raw monotonic device-uptime in seconds
 *      ("<seconds>", e.g. "296.004473") — read straight from the uint64 ns field,
 *      with no repair, no clamping, no anchoring and no calendar guess.
 *    • The level column is the raw numeric level as "L<n>" — no CRITICAL/ERROR/…
 *      name is assigned, because that mapping was never verified.
 *  The real wall-clock time (LOGGER_TIME) and the full column set live in the
 *  .idx/.esotrace packet layout, which is not yet reverse-engineered here; once that
 *  layout is known those real fields can be read and exported directly, rather than
 *  reconstructed from a guessed anchor. (History: earlier revisions carried a
 *  loggertime-sidecar linear map, an in-message timestamp/monotonicTimestamp anchor,
 *  plausibility guards, a best-guess level-name table and a sequence timestamp-repair
 *  pass; all were unverified reconstructions of ground truth and have been removed.)
 */

const HDR = 39; // fixed tail length for the common record shape
const MAX_STRLEN = 1 << 16;

/** Magic identity string present in a valid file's header (a marker of the input). */
const IDENTITY = Buffer.from('traceserverIVI', 'latin1');

export interface VtraceRecord {
  /** Monotonic device-uptime timestamp, nanoseconds — read verbatim from the record. */
  tsNs: number;
  /** Raw numeric level (emitted as "L<n>"; no severity-name mapping is assumed). */
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
 * Decode every trace message in `buf`, invoking `emit` for each in file order.
 * Returns the number of records emitted. Every field is emitted verbatim — in
 * particular `tsNs` is the raw uint64 ns uptime read from the record, with no
 * repair, clamping or monotonicity fix-up.
 */
export function decodeVtrace(buf: Buffer, emit: (rec: VtraceRecord) => void): number {
  const n = buf.length;
  let count = 0;
  let t = HDR;
  while (t < n - 4) {
    const rec = recordAt(buf, t, n);
    if (rec === null) { t += 1; continue; } // resync to next valid record
    const [rawTs, level, sl] = rec;
    emit({ tsNs: rawTs, level, text: oneLine(buf.toString('utf8', t, t + sl)) });
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
 * Each record becomes one `"<uptime-seconds> L<level> <message>"` line:
 *  - `<uptime-seconds>` is the raw monotonic device-uptime (ns field ÷ 1e9, 6 dp) —
 *    NOT a wall-clock date. This decoder deliberately does no wall-clock anchoring:
 *    the real calendar time (LOGGER_TIME) lives in the .idx/.esotrace packet layout,
 *    which is not yet decoded here (see the honesty note at the top of this file).
 *  - `L<level>` is the raw numeric level; no severity NAME is assumed.
 */
export async function parseVtraceToFile(
  filePath: string,
  outPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const buf = fs.readFileSync(filePath);
  if (!buf.includes(IDENTITY)) {
    throw new Error(`Not a vtrace file: ${path.basename(filePath)}`);
  }

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
    let t = HDR;
    while (t < n - 4) {
      const rec = recordAt(buf, t, n);
      if (rec === null) { t += 1; continue; }
      const [rawTs, level, sl] = rec;
      const stamp = (rawTs / 1e9).toFixed(6);   // raw monotonic device-uptime, seconds
      writeLine(`${stamp} L${level} ${oneLine(buf.toString('utf8', t, t + sl))}`);
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
