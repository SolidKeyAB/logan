import * as fs from 'fs';
import * as path from 'path';

/**
 * ── vtrace: automotive IVI binary trace decoder ──────────────────────────────
 *
 * `vtrace` is a neutral codename for the binary trace format produced by the trace
 * server on some automotive IVI head units. On disk the files use the `.esotrace`
 * extension. This module decodes them into the SAME columnar layout the vendor's
 * official exporter emits, so LOGAN's decode matches the official `.log` export.
 *
 * ── On-disk framing (reverse-engineered, validated against real captures) ─────
 * An `.esotrace` file is a flat, self-framing stream of records — NO file header:
 *
 *     record := uint32be payloadLength | payload[payloadLength]
 *     payload[0] := uint8 record type
 *
 * Walking the inline length prefixes reproduces the sidecar `.idx` byte-for-byte
 * (the `.idx` is only a redundant seek-index: `[u32be off][u32be len][u8 type][u8 flag]`
 * entries from byte 0), so we do NOT need the `.idx` to decode — the stream frames
 * itself. Record types seen: 3 (ESO_COMM entity registration), 4 (trace message),
 * 17, 20, 21, 32 (clock/eventing). The official exporter decodes type 4 and prints
 * every other type as an `UNDECODED: type=N[…] size=M` line — we mirror that exactly.
 *
 * ── Type-4 (trace message) payload layout, all multi-byte fields big-endian ────
 *     [0]      uint8   type = 0x04
 *     [1:5]    uint32  reserved (0)
 *     [5:9]    uint32  monotonic uptime, milliseconds (coarse; the ns tail is exact)
 *     [9:11]   uint16  level                (0..4 → see LEVEL_NAMES)
 *     [11]     uint8   flags (0x40 bit ⇒ a 4-byte extra tail before the ns stamp)
 *     [12]     uint8   reserved (0)
 *     [13:17]  uint32  channel entity id    (resolved to a name via type-3 records)
 *     [17:21]  uint32  source  entity id    (resolved to a name via type-3 records)
 *     [21:25]  uint32  reserved (0x00010000)
 *     [25:27]  uint16  size = message byte length
 *     [27:27+size]     UTF-8 message text
 *     [len-8:len]      uint64  monotonic uptime, NANOSECONDS (exact, authoritative)
 *
 * ── Type-3 (ESO_COMM) entity registration — builds the channel/source name map ─
 *     [0]=0x03 | [1:3]=0 | [3]=nameLen | [4:4+nameLen]=name | … [id u16 at +4+nameLen+4]
 *
 * ── Wall-clock (LoggerTime) ────────────────────────────────────────────────────
 * Type-32 records carry (epoch_ms, mono_ms) clock-sync anchors of the SYSTEM clock:
 *     [0]=0x20 | [1:9]=uint64 epoch_ms (UTC) | [9:17]=uint64 mono_ms
 * boot_epoch_ms = median(epoch_ms − mono_ms) over all anchors (drift < 1 ms in
 * practice). Then for any record  LoggerTime = boot_epoch_ms + uptime_ms, and
 * TraceTime = the raw uptime rendered from the 1970 epoch (as the official does).
 * Validated: message uptime → LoggerTime reproduced an embedded app-clock oracle to
 * ~3 ms. (A second, device/GNSS clock lives in type-20; the official LoggerTime uses
 * the system clock, so we do too.)
 *
 * ── Confidence notes (no byte-exact calibration pair was available) ─────────────
 * Byte-solid: framing, message text, size, ns/ms uptime, TraceTime, UNDECODED lines,
 * session markers, LoggerTime (anchor-validated). Best-effort (would be locked by one
 * `.esotrace`+official-export pair): the level-number→name table, channel/source NAME
 * resolution, PrivFlag, the PacketID sequence origin, and multi-session splitting.
 */

/** Magic identity string present in a valid file (a marker of the input). */
const IDENTITY = Buffer.from('traceserverIVI', 'latin1');

const TYPE_MESSAGE = 0x04;
const MAX_RECORD = 0x02000000; // 32 MB sanity cap on a single record

/** level number → official name (0=most severe). Best-effort; see confidence note. */
const LEVEL_NAMES = ['ERROR', 'warn', 'info', 'debug', 'trace'];

/** record type → short name for UNDECODED lines (only ESO_COMM is vendor-confirmed). */
const TYPE_NAMES: Record<number, string> = { 3: 'ESO_COMM' };

/**
 * Official export column widths (Message takes the remainder). The vendor pads the
 * SessionID header label wider (11) than its data cells (4); every other column shares
 * one width, so the header and data rows use the same table bar that one entry.
 */
const COL_NAMES = ['PacketID', 'SessionID', 'Label', 'LoggerTime', 'TraceTime', 'Channel', 'Source', 'Level', 'PrivFlag', 'Size'];
const HEADER_WIDTHS = [10, 11, 7, 25, 25, 34, 50, 10, 12, 6];
const DATA_WIDTHS = [10, 4, 7, 25, 25, 34, 50, 10, 12, 6];

/** One decoded record, carrying every official column. */
export interface VtraceRecord {
  /** running packet sequence within the session (PacketID = `${sessionId}.${seq}`). */
  seq: number;
  sessionId: number;
  /** on-disk record type byte. */
  type: number;
  /** monotonic device uptime, nanoseconds (authoritative; from the record tail). */
  uptimeNs: number;
  /** absolute wall-clock ms (UTC), or null when the file carries no clock anchor. */
  loggerMs: number | null;
  /** numeric level (null for UNDECODED records). */
  level: number | null;
  /** resolved channel name, or the numeric id, or '--'. */
  channel: string;
  /** resolved source name, or the numeric id, or '--'. */
  source: string;
  /** privacy flag (best-effort; '--' when unknown). */
  privFlag: string;
  /** message byte length (Size column). */
  size: number;
  /** decoded message text (UNDECODED records get the `UNDECODED: …` placeholder). */
  message: string;
  /** true when the record type isn't a trace message (printed as UNDECODED). */
  undecoded: boolean;
}

function readU64BE(buf: Buffer, o: number): number {
  return buf.readUInt32BE(o) * 0x100000000 + buf.readUInt32BE(o + 4);
}

/** Fold embedded newlines so one record == one output line. */
function oneLine(s: string): string {
  return s.indexOf('\n') === -1 && s.indexOf('\r') === -1
    ? s
    : s.replace(/\r\n|\r|\n/g, ' ');
}

/**
 * Walk the self-framing record stream, invoking `cb(type, payloadStart, payloadLen)`
 * for each record in file order. Stops cleanly at EOF or on the first malformed
 * length prefix (a truncated/garbage tail is simply not walked further).
 */
function walkRecords(
  buf: Buffer,
  cb: (type: number, pStart: number, pLen: number) => void,
): void {
  const n = buf.length;
  let off = 0;
  while (off + 4 <= n) {
    const len = buf.readUInt32BE(off);
    if (len <= 0 || len > MAX_RECORD || off + 4 + len > n) break;
    const pStart = off + 4;
    cb(buf[pStart], pStart, len);
    off = pStart + len;
  }
}

/**
 * A few messages (kernel/binder lines like `[1:1:0] …`) stamp their ns field with an
 * absolute device CLOCK_REALTIME epoch instead of a monotonic uptime — a second clock
 * domain ~17.5 h off the system clock. Any ns value above this bound is such an epoch,
 * not an uptime (no real capture uptime approaches 3 years); we map it back onto the
 * monotonic timeline via the type-20 device-clock anchor so it lands in the right place.
 */
const EPOCH_NS_THRESHOLD = 1e17;

/** Upper bound on a plausible monotonic uptime (~115 days) — beyond this we distrust the stamp. */
const MAX_UPTIME_NS = 1e16;

/** First-pass context: entity id→name map, system-clock boot epoch, device-clock boot. */
interface DecodeContext {
  names: Map<number, string>;
  bootMs: number | null;       // system-clock (type-32) boot epoch, ms — for LoggerTime
  deviceBootMs: number | null; // device-realtime (type-20) boot epoch, ms — for realtime records
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  return xs[xs.length >> 1];
}

/** Scan once to build the channel/source name map and both clock anchors. */
function scanContext(buf: Buffer): DecodeContext {
  const names = new Map<number, string>();
  const sysDeltas: number[] = [];
  const devDeltas: number[] = [];
  walkRecords(buf, (type, p, len) => {
    const end = p + len;
    if (type === 3) {
      const nameLen = buf[p + 3];
      const nameEnd = p + 4 + nameLen;
      const idOff = nameEnd + 4; // tail: 00 03 00 00 <id u16>
      if (nameLen > 0 && idOff + 2 <= end) {
        names.set(buf.readUInt16BE(idOff), buf.toString('utf8', p + 4, nameEnd));
      }
    } else if (type === 32 && p + 17 <= end) {
      // system clock: [1:9] epoch_ms, [9:17] mono_ms
      const epochMs = readU64BE(buf, p + 1);
      const monoMs = readU64BE(buf, p + 9);
      if (epochMs > 1e12) sysDeltas.push(epochMs - monoMs);
    } else if (type === 20 && p + 21 <= end) {
      // device realtime clock: [1:5] index, [5:13] epoch_ms, [13:21] mono_ms (index≥1)
      const epochMs = readU64BE(buf, p + 5);
      const monoMs = readU64BE(buf, p + 13);
      if (epochMs > 1e12) devDeltas.push(epochMs - monoMs);
    }
  });
  return { names, bootMs: median(sysDeltas), deviceBootMs: median(devDeltas) };
}

/**
 * Decode every record in `buf` into a VtraceRecord, invoking `emit` in file order.
 * Returns the number of records emitted. Requires two logical passes (context, then
 * emit) so names and the clock anchor are known before the first line is produced.
 */
export function decodeVtrace(buf: Buffer, emit: (rec: VtraceRecord) => void): number {
  const ctx = scanContext(buf);
  const sessionId = 0; // single-session for now (see confidence note)
  let seq = 0;
  let lastUptimeNs = 0;

  walkRecords(buf, (type, p, len) => {
    const end = p + len;
    let uptimeNs = lastUptimeNs;
    let level: number | null = null;
    let channel = '--';
    let source = '--';
    const privFlag = '--';
    let size = len;
    let message: string;
    let undecoded = true;

    if (type === TYPE_MESSAGE && len >= 35) {
      undecoded = false;
      // size lives in the header; message = payload[27 : 27+size]; the ns stamp is the
      // 8 bytes immediately AFTER the message. When flag bit 0x40 is set there are 4
      // extra trailing bytes after the stamp, so anchor the read to msgStart+size — not
      // to the record end — otherwise those records read a garbage (huge) timestamp.
      size = buf.readUInt16BE(p + 25);
      const msgStart = p + 27;
      const tsOff = msgStart + size;
      message = oneLine(buf.toString('utf8', msgStart, Math.min(tsOff, end)));
      if (tsOff + 8 <= end) {
        const tsNs = readU64BE(buf, tsOff);
        let u: number;
        if (tsNs > EPOCH_NS_THRESHOLD) {
          // Absolute device-realtime epoch → convert to the monotonic timeline via the
          // device anchor (fall back to carry-forward if the file has no device anchor).
          u = ctx.deviceBootMs == null ? lastUptimeNs : (tsNs / 1e6 - ctx.deviceBootMs) * 1e6;
        } else {
          u = tsNs; // monotonic uptime, verbatim
        }
        // Sanity guard: a plausible uptime is [0, ~115 days]. Anything else (a negative
        // conversion, a corrupt/foreign stamp) carries forward the last good value so the
        // timeline stays continuous instead of rendering an absurd calendar year.
        uptimeNs = u >= 0 && u <= MAX_UPTIME_NS ? u : lastUptimeNs;
      } else {
        uptimeNs = lastUptimeNs; // truncated/edge record — keep the timeline continuous
      }
      level = buf.readUInt16BE(p + 9);
      channel = ctx.names.get(buf.readUInt32BE(p + 13)) ?? String(buf.readUInt32BE(p + 13));
      source = ctx.names.get(buf.readUInt32BE(p + 17)) ?? String(buf.readUInt32BE(p + 17));
      lastUptimeNs = uptimeNs; // only trace messages carry an authoritative ns stamp
    } else {
      // Every non-message type is printed UNDECODED, exactly like the official tool.
      // Their embedded clock fields are type-specific and unvalidated, so we don't
      // trust them for the timeline — the line inherits the last known message uptime.
      const name = TYPE_NAMES[type] ?? '';
      message = `UNDECODED: type=${type}[${name}] size=${len}`;
    }

    const loggerMs = ctx.bootMs == null ? null : ctx.bootMs + uptimeNs / 1e6;
    emit({ seq, sessionId, type, uptimeNs, loggerMs, level, channel, source, privFlag, size, message, undecoded });
    seq++;
  });

  return seq;
}

// ── official-export formatting ────────────────────────────────────────────────

const p2 = (n: number): string => String(n).padStart(2, '0');
const p3 = (n: number): string => String(n).padStart(3, '0');

/** Render an absolute UTC ms value as `DD.MM.YYYY HH:MM:SS.mmm` (TraceTime uses the 1970 epoch). */
function fmtDate(ms: number): string {
  const d = new Date(Math.round(ms));
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p3(d.getUTCMilliseconds())}`;
}

/** Left-justify a cell to `w`; overflowing values keep a 2-space separator. */
function cell(v: string, w: number): string {
  return v.length < w ? v.padEnd(w) : v + '  ';
}

/** The official column-header row. */
export function officialHeaderRow(): string {
  return COL_NAMES.map((name, i) => cell(name, HEADER_WIDTHS[i])).join('') + 'Message';
}

/** Format one decoded record as an official-export data row. */
export function formatRecord(rec: VtraceRecord): string {
  const values: string[] = [
    `${rec.sessionId}.${rec.seq}`,
    String(rec.sessionId),
    '--',
    rec.loggerMs == null ? '--' : fmtDate(rec.loggerMs),
    fmtDate(rec.uptimeNs / 1e6), // TraceTime: uptime rendered from the 1970 epoch
    rec.channel,
    rec.source,
    rec.level == null ? '--' : (LEVEL_NAMES[rec.level] ?? `L${rec.level}`),
    rec.privFlag,
    String(rec.size),
  ];
  return values.map((v, i) => cell(v, DATA_WIDTHS[i])).join('') + rec.message;
}

/** Detection helper: does this look like a vtrace file? (extension + structure/identity) */
export function isVtrace(filePath: string, head: Buffer): boolean {
  if (!/\.esotrace$/i.test(filePath)) return false;
  return head.includes(IDENTITY) || looksFramed(head);
}

/** Structural check: the head begins with a plausible self-framed record. */
export function looksFramed(head: Buffer): boolean {
  if (head.length < 6) return false;
  const len = head.readUInt32BE(0);
  if (len <= 0 || len > MAX_RECORD) return false;
  const type = head[4];
  return type === 3 || type === 4 || type === 17 || type === 20 || type === 21 || type === 32;
}

/**
 * Stream-decode a vtrace file to a newline-delimited text file the FileHandler
 * indexer can consume unchanged. The output reproduces the vendor's official export:
 * a `#----- BEGIN/END` session banner, the column-header row, then one 11-column
 * row per record (PacketID · SessionID · Label · LoggerTime · TraceTime · Channel ·
 * Source · Level · PrivFlag · Size · Message).
 */
export async function parseVtraceToFile(
  filePath: string,
  outPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const buf = fs.readFileSync(filePath);
  if (!buf.includes(IDENTITY) && !looksFramed(buf)) {
    throw new Error(`Not a vtrace file: ${path.basename(filePath)}`);
  }

  const base = path.basename(filePath);
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
    const sessionId = 0;
    writeLine(`#----- BEGIN: ${base}: session #${sessionId}`);
    writeLine(officialHeaderRow());

    const n = buf.length;
    let lastPct = -1;
    const total = decodeVtrace(buf, (rec) => {
      writeLine(formatRecord(rec));
      if (onProgress) {
        // approximate progress by uptime is unreliable; use record throughput.
        const pct = Math.min(99, Math.floor((rec.seq / Math.max(1, estimatedRecords(n))) * 100));
        if (pct !== lastPct) { onProgress(pct); lastPct = pct; }
      }
    });
    void total;

    writeLine(`#----- END: ${base}: session #${sessionId}`);
    flush();
  } finally {
    fs.closeSync(fd);
  }
  onProgress?.(100);
}

/** Rough record-count estimate for progress (avg ~200 B/record on real captures). */
function estimatedRecords(byteLen: number): number {
  return Math.max(1, Math.floor(byteLen / 200));
}
