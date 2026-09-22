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
 * Calibrated byte-for-byte against a real ground-truth pair (a SYS(2)/*.esotrace
 * capture and its official `sys.log` export). On the self-contained first segment
 * every output column except LoggerTime reproduces the official export exactly:
 * PacketID, SessionID, Label, TraceTime, Channel, Source, Level, PrivFlag, Size,
 * Message all byte-match; LoggerTime is within a fraction of a second (see below).
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
 * itself. On-disk record types seen: 0 (session identity/restart marker), 3 (ESO_COMM
 * entity registration), 4 (trace message), 5 (dropped-data counter), 17/19/20/21/32
 * (clock/eventing), 33 (a rare event marker). The official exporter emits an output
 * row ONLY for type-4 (one row per embedded line) and type-5 (one "Dropped Data" row);
 * every other on-disk type is consumed to build the name map, clock anchors and session
 * boundaries. Whether a type-4 row is decoded text or printed `UNDECODED` is decided by
 * its LOGICAL type at [22] — NOT by the on-disk record type.
 *
 * ── Type-4 (trace message) payload layout, all multi-byte fields big-endian ────
 *     [0]      uint8   on-disk type = 0x04
 *     [1:5]    uint32  reserved (0)
 *     [5:9]    uint32  monotonic uptime, MILLISECONDS — this is the TraceTime source
 *                      (the official renders TraceTime from THIS coarse field, not the
 *                      ns tail; they can differ by ~1 ms). The exact ns tail is kept
 *                      verbatim in `uptimeNs` but is not used for the TraceTime column.
 *     [9:11]   uint16  level                (0..4 → see LEVEL_NAMES; 0=trace … 4=ERROR)
 *     [11]     uint8   flags. Bit 0x40 ⇒ this record carries a 4-byte PrivFlag tail
 *                      AFTER the ns stamp (and a real PrivFlag); clear ⇒ PrivFlag '--'.
 *     [12]     uint8   reserved (0)
 *     [13:17]  uint32  channel entity id    (resolved to a name via type-3 records)
 *     [17:21]  uint32  source  entity id    (resolved to a name via type-3 records)
 *     [21]     uint8   reserved (0)
 *     [22]     uint8   LOGICAL message type: 1 ⇒ UTF-8 text; else non-text ⇒ UNDECODED
 *                      (3→ESO_COMM, 136/0x88→RSTP, …).
 *     [23]     uint8   reserved (0)
 *     [24:27]  uint24  size = message byte length (3 bytes: [24] high, [25:27] low —
 *                      [24] is only non-zero for the rare >64 KB message).
 *     [27:27+size]     message payload (UTF-8 text when [22]==1, else opaque binary)
 *     [27+size : +8]   uint64  monotonic uptime, NANOSECONDS (verbatim in `uptimeNs`)
 *     [+8 : +12]       uint32  PrivFlag bitmask tail, present iff flags bit 0x40 (below)
 *
 * ── PacketID = absolute record index ───────────────────────────────────────────
 * The PacketID column is `${fileIndex}.${recordIndex}` where recordIndex is the record's
 * 0-based position in the stream counting EVERY record of every type (so the first
 * emitted row is not 0 — the leading entity/clock records occupy the low indices), and
 * fileIndex is the file's position in a rotated ring-buffer set (0 for a standalone
 * decode; the merged official export numbers 0,1,2,… across the segment files). Because
 * it is the raw stream position, the suffix does NOT reset at a session boundary — only
 * the SessionID column does.
 *
 * ── Sessions ───────────────────────────────────────────────────────────────────
 * A type-0 `traceserver…` identity record marks the start of a trace session. The first
 * one opens session #0; each subsequent one (after data has been emitted) closes the
 * current session and opens the next, incrementing the SessionID column. The official
 * brackets each session with `#----- BEGIN/END … session #N` banners and repeats the
 * column header; parseVtraceToFile() reproduces that from the per-row sessionId.
 *
 * ── PrivFlag ────────────────────────────────────────────────────────────────────
 * When flags bit 0x40 is set the record ends with a 4-byte tail (after the ns stamp).
 * Its first byte is a bitmask of privacy letters, rendered high-bit→low: 0x80→u, 0x40→l,
 * 0x20→i, 0x08→r, 0x04→n, 0x02→g; the tail's last byte bit 0x01 prepends a 'U'. So e.g.
 * `04 00 00 01` ⇒ "Un", `80 00 00 00` ⇒ "u". No 0x40 flag ⇒ '--'.
 *
 * ── Channel / Source names ──────────────────────────────────────────────────────
 * type-3 records register `id → (name, parentId)`, forming a dotted hierarchy rooted at
 * the trace-server identity (e.g. `traceserverGEN.serviceA.moduleB.Thread.StateInfo`).
 * The official renders the SOURCE as the last two path segments (process.component), and
 * the CHANNEL as the path with the common prefix it shares with the source removed. Ids
 * are re-registered across sessions, so names resolve against a RUNNING map (the map as
 * it stands when the record is reached), not a whole-file pre-pass.
 *
 * ── Wall-clock (LoggerTime) — the one approximate column ─────────────────────────
 * LoggerTime is a wall clock the official reconstructs by interpolating the device's
 * realtime anchors (type-20 index-4 UTC / type-32) against the monotonic clock. That
 * relationship drifts between anchors and is not stored per record, so we reproduce it
 * only to sub-second accuracy: boot = median(epoch−mono) over the UTC anchors, then
 * LoggerTime = boot + coarse-uptime-ms. TraceTime (monotonic, from [5:9]) is exact.
 */

/** Magic identity string present in a valid file (a marker of the input). */
const IDENTITY = Buffer.from('traceserverIVI', 'latin1');

const TYPE_SESSION = 0x00; // session identity / restart marker
const TYPE_ENTITY = 0x03;  // ESO_COMM entity (id → name) registration
const TYPE_MESSAGE = 0x04; // trace message
const TYPE_DROPPED = 0x05; // dropped-data counter (num = u32 at [1:5])
const TYPE_SYSCLOCK = 32;  // system-clock anchor (type 0x20)
const TYPE_DEVCLOCK = 20;  // device-realtime clock anchor (type 0x14)
const MAX_RECORD = 0x02000000; // 32 MB sanity cap on a single record

/** level number → official name. 0 = least severe (trace) … 4 = most severe (ERROR). */
const LEVEL_NAMES = ['trace', 'debug', 'info', 'warn', 'ERROR'];

/** A type-4 record whose LOGICAL type ([22]) is this carries UTF-8 text; else UNDECODED. */
const LOGICAL_TEXT = 1;

/**
 * Logical message type → official name for the `UNDECODED: type=N[name]` label, read
 * from record byte [22]. Verified against a real capture (3→ESO_COMM, 0x88→RSTP); the
 * official prints `[null]` for any type it has no name for.
 */
const LOGICAL_TYPE_NAMES: Record<number, string> = { 3: 'ESO_COMM', 136: 'RSTP' };

/**
 * Official export column widths (Message takes the remainder). The vendor pads the
 * SessionID header label wider (11) than its data cells (4); every other column shares
 * one width, so the header and data rows use the same table bar that one entry.
 */
const COL_NAMES = ['PacketID', 'SessionID', 'Label', 'LoggerTime', 'TraceTime', 'Channel', 'Source', 'Level', 'PrivFlag', 'Size'];
const HEADER_WIDTHS = [10, 11, 7, 25, 25, 34, 50, 10, 12, 6];
const DATA_WIDTHS = [10, 4, 7, 25, 25, 34, 50, 10, 12, 6];

/** One decoded OUTPUT ROW, carrying every official column. A multi-line message emits
 *  several records sharing one packetIndex (one per embedded line). */
export interface VtraceRecord {
  /** 0-based record index within the file → the PacketID suffix (shared across split lines). */
  packetIndex: number;
  /** session number → the SessionID column; increments at each session-restart marker. */
  sessionId: number;
  /** ring-buffer file index → the PacketID prefix (0 for a standalone single-file decode). */
  fileIndex: number;
  /** on-disk record type byte (4 = message, 5 = dropped-data). */
  type: number;
  /** raw monotonic ns from the record tail, verbatim (0 for a truncated/edge record). */
  uptimeNs: number;
  /** coarse monotonic uptime, milliseconds (from [5:9]) → the TraceTime column. */
  traceMs: number;
  /** absolute wall-clock ms (UTC), or null when the file carries no clock anchor. */
  loggerMs: number | null;
  /** numeric level (null for the dropped-data row). */
  level: number | null;
  /** resolved channel name, or the numeric id, or '--'. */
  channel: string;
  /** resolved source name, or the numeric id, or '--'. */
  source: string;
  /** privacy flag (decoded from the record tail; '--' when the record carries none). */
  privFlag: string;
  /** message byte length (Size column) — the whole record's length, shared across split lines. */
  size: number;
  /** one output line of the decoded message (UNDECODED records get the placeholder). */
  message: string;
  /** true when the logical type isn't text (printed as UNDECODED). */
  undecoded: boolean;
}

function readU64BE(buf: Buffer, o: number): number {
  return buf.readUInt32BE(o) * 0x100000000 + buf.readUInt32BE(o + 4);
}

/**
 * Walk the self-framing record stream, invoking `cb(type, payloadStart, payloadLen, index)`
 * for each record in file order (`index` is the 0-based record position, counting every
 * record of every type). Stops cleanly at EOF or on the first malformed length prefix.
 */
function walkRecords(
  buf: Buffer,
  cb: (type: number, pStart: number, pLen: number, index: number) => void,
): void {
  const n = buf.length;
  let off = 0;
  let index = 0;
  while (off + 4 <= n) {
    const len = buf.readUInt32BE(off);
    if (len <= 0 || len > MAX_RECORD || off + 4 + len > n) break;
    const pStart = off + 4;
    cb(buf[pStart], pStart, len, index);
    index++;
    off = pStart + len;
  }
}

/** First-pass context: the system/device clock boot epoch used for LoggerTime. */
interface DecodeContext {
  bootMs: number | null; // median(epoch − mono) over the UTC clock anchors, ms
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  return xs[xs.length >> 1];
}

/**
 * Push this buffer's clock deltas (epoch_ms − mono_ms) into `deltas`. Split out of
 * scanContext so a MERGED segment set can pool anchors from EVERY segment into one global
 * boot epoch — a capture shares a single monotonic boot, and later ring-buffer segments
 * often carry no clock anchor of their own (see decodeVtraceSegments).
 */
function collectClockDeltas(buf: Buffer, deltas: number[]): void {
  walkRecords(buf, (type, p, len) => {
    const end = p + len;
    if (type === TYPE_SYSCLOCK && p + 17 <= end) {
      // system clock: [1:9] epoch_ms, [9:17] mono_ms
      const epochMs = readU64BE(buf, p + 1);
      const monoMs = readU64BE(buf, p + 9);
      if (epochMs > 1e12) deltas.push(epochMs - monoMs);
    } else if (type === TYPE_DEVCLOCK && p + 21 <= end) {
      // device realtime clock: [1:5] index, [5:13] epoch_ms, [13:21] mono_ms. Index 4 is
      // the UTC entry; index 3 is the same instant offset by local time — skip it.
      const index = buf.readUInt32BE(p + 1);
      const epochMs = readU64BE(buf, p + 5);
      const monoMs = readU64BE(buf, p + 13);
      if (index === 4 && epochMs > 1e12) deltas.push(epochMs - monoMs);
    }
  });
}

/**
 * Scan once for the LoggerTime boot epoch. The official LoggerTime is UTC, so we take the
 * type-32 system anchors and the type-20 device anchors whose index is 4 (the UTC entry of
 * each device-clock group — its sibling index-3 entry is the same instant shifted by the
 * local-time/DST offset, which we must NOT use). boot = median(epoch_ms − mono_ms).
 */
function scanContext(buf: Buffer): DecodeContext {
  const deltas: number[] = [];
  collectClockDeltas(buf, deltas);
  return { bootMs: median(deltas) };
}

/** Resolve an entity id to its full dotted path (root..leaf) via the running name map. */
function resolvePath(id: number, names: Map<number, { name: string; parent: number }>): string[] {
  const segs: string[] = [];
  const seen = new Set<number>();
  let i = id;
  while (names.has(i) && !seen.has(i)) {
    seen.add(i);
    const node = names.get(i)!;
    if (node.name) segs.push(node.name);
    i = node.parent;
  }
  return segs.reverse();
}

/**
 * Running decode state carried across the records of a decode. For a MERGED segment set it
 * is also carried across the segment FILES, so an entity name or session opened in an
 * earlier segment resolves in a later one — exactly what the vendor's `*.esotrace` merge
 * does, and what a per-file decode cannot (later ring-buffer segments reference ids/clocks
 * registered only in the first segment).
 */
interface DecodeState {
  names: Map<number, { name: string; parent: number }>;
  sessionId: number;
  sawData: boolean;
  lastTraceMs: number;
}

function newDecodeState(): DecodeState {
  return { names: new Map(), sessionId: 0, sawData: false, lastTraceMs: 0 };
}

/**
 * Walk ONE buffer's records, emitting a VtraceRecord per OUTPUT ROW (a message with
 * embedded newlines emits one row per line, all sharing the same packetIndex), while
 * mutating `st` (names/session/lastTrace) so a caller can thread the SAME state through
 * several segments. `bootMs` and `fileIndex` are supplied by the caller (global across a
 * merge). Returns the number of rows emitted.
 */
function decodeBufferInto(
  buf: Buffer,
  bootMs: number | null,
  fileIndex: number,
  st: DecodeState,
  emit: (rec: VtraceRecord) => void,
): number {
  let rows = 0;

  walkRecords(buf, (type, p, len, index) => {
    const end = p + len;

    if (type === TYPE_ENTITY) {
      // [0]=03 [1:3]=0 [3]=nameLen [4:4+nameLen]=name … own-id u32 at nameEnd+2, parent u32 at end-4.
      const nameLen = buf[p + 3];
      const nameEnd = p + 4 + nameLen;
      if (nameEnd + 6 <= end) {
        const own = buf.readUInt32BE(nameEnd + 2);
        const parent = buf.readUInt32BE(end - 4);
        st.names.set(own, { name: buf.toString('utf8', p + 4, nameEnd), parent });
      }
      return;
    }

    if (type === TYPE_SESSION) {
      // A restart marker after data closes the current session and opens the next; the
      // very first identity record (before any row) just labels session #0.
      if (st.sawData) st.sessionId++;
      return;
    }

    if (type === TYPE_DROPPED && len >= 5) {
      // The official injects one "Dropped Data: num=N" row (N = u32 at [1:5]). Its clock
      // isn't stored in the 5-byte record, so it inherits the last known monotonic time.
      st.sawData = true;
      const num = buf.readUInt32BE(p + 1);
      emit({
        packetIndex: index, sessionId: st.sessionId, fileIndex, type,
        uptimeNs: 0, traceMs: st.lastTraceMs,
        loggerMs: bootMs == null ? null : bootMs + st.lastTraceMs,
        level: null, channel: '--', source: '--', privFlag: '--',
        size: 0, message: `Dropped Data: num=${num}`, undecoded: false,
      });
      rows++;
      return;
    }

    if (type !== TYPE_MESSAGE || len < 35) return;
    st.sawData = true;

    const logicalType = buf[p + 22];
    const isText = logicalType === LOGICAL_TEXT;
    // size is a 3-byte big-endian field at [24:27] ([24] non-zero only for >64 KB messages).
    const size = buf[p + 24] * 0x10000 + buf.readUInt16BE(p + 25);
    const msgStart = p + 27;
    const tsOff = msgStart + size;

    // TraceTime uses the coarse monotonic ms at [5:9]; the ns tail is kept only verbatim.
    const traceMs = buf.readUInt32BE(p + 5);
    const uptimeNs = tsOff + 8 <= end ? readU64BE(buf, tsOff) : 0;
    st.lastTraceMs = traceMs;

    const level = buf.readUInt16BE(p + 9);

    // Channel/Source: hierarchical dotted paths. Source = last two segments; Channel =
    // the channel path with the common prefix it shares with the source removed.
    const chanPath = resolvePath(buf.readUInt32BE(p + 13), st.names);
    const srcPath = resolvePath(buf.readUInt32BE(p + 17), st.names);
    let common = 0;
    while (common < chanPath.length && common < srcPath.length && chanPath[common] === srcPath[common]) common++;
    const channel = chanPath.length
      ? (chanPath.slice(common).join('.') || chanPath.slice(-1).join('.'))
      : String(buf.readUInt32BE(p + 13));
    const source = srcPath.length ? srcPath.slice(-2).join('.') : String(buf.readUInt32BE(p + 17));

    // PrivFlag: 4-byte tail after the ns stamp, present iff flags bit 0x40.
    let privFlag = '--';
    if ((buf[p + 11] & 0x40) && tsOff + 12 <= end) {
      privFlag = decodePrivFlag(buf[tsOff + 8], buf[tsOff + 11]);
    }

    const loggerMs = bootMs == null ? null : bootMs + traceMs;

    if (isText) {
      // Split the payload on newlines: the official emits one row per line, verbatim
      // (trailing whitespace preserved), and drops a single trailing empty line from a
      // message that ends in a newline.
      const body = buf.toString('utf8', msgStart, Math.min(tsOff, end));
      const parts = body.split('\n');
      if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
      for (const raw of parts) {
        const message = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        emit({ packetIndex: index, sessionId: st.sessionId, fileIndex, type, uptimeNs, traceMs, loggerMs, level, channel, source, privFlag, size, message, undecoded: false });
        rows++;
      }
    } else {
      const message = `UNDECODED: type=${logicalType}[${LOGICAL_TYPE_NAMES[logicalType] ?? 'null'}] size=${size}`;
      emit({ packetIndex: index, sessionId: st.sessionId, fileIndex, type, uptimeNs, traceMs, loggerMs, level, channel, source, privFlag, size, message, undecoded: true });
      rows++;
    }
  });

  return rows;
}

/**
 * Decode a SINGLE vtrace buffer into VtraceRecords, invoking `emit` in file order — one
 * record per OUTPUT ROW. Returns the number of rows emitted. `fileIndex` sets the PacketID
 * prefix (0 for a standalone decode). Unchanged behavior: computes this buffer's own boot
 * epoch and uses a fresh name/session map.
 */
export function decodeVtrace(buf: Buffer, emit: (rec: VtraceRecord) => void, fileIndex = 0): number {
  const { bootMs } = scanContext(buf);
  return decodeBufferInto(buf, bootMs, fileIndex, newDecodeState(), emit);
}

/**
 * Decode a MERGED SEGMENT SET — a rotated ring-buffer capture split across several
 * `.esotrace` files (log_0000, log_0001, …), in the given order — as ONE continuous
 * stream, the way the vendor's `vtrace_parse.py *.esotrace` merge does. The entity-name
 * map, session counter and last monotonic time are carried across segment boundaries so
 * later segments resolve the names/clock/numbering they'd otherwise lose, and the PacketID
 * prefix (`fileIndex`) increments 0,1,2,… per segment. The boot epoch is pooled from every
 * segment's clock anchors (a capture shares one monotonic boot). Returns total rows emitted.
 */
export function decodeVtraceSegments(bufs: Buffer[], emit: (rec: VtraceRecord) => void): number {
  const deltas: number[] = [];
  for (const b of bufs) collectClockDeltas(b, deltas);
  const bootMs = median(deltas);
  const st = newDecodeState();
  let rows = 0;
  for (let i = 0; i < bufs.length; i++) rows += decodeBufferInto(bufs[i], bootMs, i, st, emit);
  return rows;
}

/** Render the 4-byte PrivFlag tail (bitmask byte, U-flag byte) as its official letters. */
function decodePrivFlag(mask: number, uFlag: number): string {
  let s = (uFlag & 0x01) ? 'U' : '';
  const bits: Array<[number, string]> = [[0x80, 'u'], [0x40, 'l'], [0x20, 'i'], [0x08, 'r'], [0x04, 'n'], [0x02, 'g']];
  for (const [bit, ch] of bits) if (mask & bit) s += ch;
  return s || '--';
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
    `${rec.fileIndex}.${rec.packetIndex}`,
    String(rec.sessionId),
    '--',
    rec.loggerMs == null ? '--' : fmtDate(rec.loggerMs),
    fmtDate(rec.traceMs), // TraceTime: coarse monotonic uptime rendered from the 1970 epoch
    rec.channel,
    rec.source,
    rec.level == null ? '--' : (LEVEL_NAMES[rec.level] ?? `L${rec.level}`),
    rec.privFlag,
    rec.type === TYPE_DROPPED ? '--' : String(rec.size),
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
  return type === 0 || type === 3 || type === 4 || type === 17 || type === 20 || type === 21 || type === 32;
}

/**
 * Stream-decode a vtrace file to a newline-delimited text file the FileHandler
 * indexer can consume unchanged. The output reproduces the vendor's official export:
 * a `#----- BEGIN/END` session banner (re-emitted at every session restart), the
 * column-header row, then one 11-column row per output line (PacketID · SessionID ·
 * Label · LoggerTime · TraceTime · Channel · Source · Level · PrivFlag · Size · Message).
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
    let curSession = 0;
    writeLine(`#----- BEGIN: ${base}: session #${curSession}`);
    writeLine(officialHeaderRow());

    const n = buf.length;
    let lastPct = -1;
    decodeVtrace(buf, (rec) => {
      // A session restart re-brackets the output: close the current session, open the next.
      if (rec.sessionId !== curSession) {
        writeLine(`#----- END: ${base}: session #${curSession}`);
        writeLine(`#----- BEGIN: ${base}: session #${rec.sessionId}`);
        writeLine(officialHeaderRow());
        curSession = rec.sessionId;
      }
      writeLine(formatRecord(rec));
      if (onProgress) {
        const pct = Math.min(99, Math.floor((rec.packetIndex / Math.max(1, estimatedRecords(n))) * 100));
        if (pct !== lastPct) { onProgress(pct); lastPct = pct; }
      }
    });

    writeLine(`#----- END: ${base}: session #${curSession}`);
    flush();
  } finally {
    fs.closeSync(fd);
  }
  onProgress?.(100);
}

/**
 * Merge-decode a vtrace SEGMENT SET into one text file — the multi-file counterpart of
 * parseVtraceToFile. `filePaths` are the ordered segments (log_0000, log_0001, …); they are
 * decoded as ONE continuous stream (names/clock/session carried across, PacketID prefix
 * 0,1,2,… per segment), so later segments no longer come out with numeric channel/source,
 * a blank LoggerTime or restarted numbering — reproducing the vendor's merged `session.log`.
 * `label` names the session banners (defaults to the output file's stem).
 */
export async function parseVtraceSegmentsToFile(
  filePaths: string[],
  outPath: string,
  opts: { label?: string; onProgress?: (percent: number) => void } = {},
): Promise<void> {
  if (filePaths.length === 0) throw new Error('No segments to merge');

  // Read + validate every segment up front (a merge is all-or-nothing: one non-vtrace file
  // in the set means the set was mis-grouped).
  const bufs: Buffer[] = [];
  let totalBytes = 0;
  for (const fp of filePaths) {
    const buf = fs.readFileSync(fp);
    if (!buf.includes(IDENTITY) && !looksFramed(buf)) {
      throw new Error(`Not a vtrace file: ${path.basename(fp)}`);
    }
    bufs.push(buf);
    totalBytes += buf.length;
  }

  const label = opts.label || path.basename(outPath).replace(/\.decoded\.txt$/i, '');
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
    let curSession = 0;
    writeLine(`#----- BEGIN: ${label}: session #${curSession}`);
    writeLine(officialHeaderRow());

    const estRecords = estimatedRecords(totalBytes);
    let seen = 0;
    let lastPct = -1;
    decodeVtraceSegments(bufs, (rec) => {
      // A session restart re-brackets the output — a session can span segments, so this is
      // driven by rec.sessionId (carried across segments), NOT by the file boundary.
      if (rec.sessionId !== curSession) {
        writeLine(`#----- END: ${label}: session #${curSession}`);
        writeLine(`#----- BEGIN: ${label}: session #${rec.sessionId}`);
        writeLine(officialHeaderRow());
        curSession = rec.sessionId;
      }
      writeLine(formatRecord(rec));
      seen++;
      if (opts.onProgress) {
        const pct = Math.min(99, Math.floor((seen / estRecords) * 100));
        if (pct !== lastPct) { opts.onProgress(pct); lastPct = pct; }
      }
    });

    writeLine(`#----- END: ${label}: session #${curSession}`);
    flush();
  } finally {
    fs.closeSync(fd);
  }
  opts.onProgress?.(100);
}

/** Rough record-count estimate for progress (avg ~200 B/record on real captures). */
function estimatedRecords(byteLen: number): number {
  return Math.max(1, Math.floor(byteLen / 200));
}
