// DLT (AUTOSAR / COVESA "Diagnostic Log and Trace") decoder.
//
// Turns a binary `.dlt` capture into normalized, newline-delimited text LOGAN can
// index/search â the same shape the vtrace/mf4 adapters produce. One decoded line
// per DLT message, columns: Time Â· Cnt Â· ECU Â· APID Â· CTID Â· Type Â· Level Â· Payload.
//
// Wire format (offline file = a run of these, each optionally prefixed by a
// 16-byte storage header):
//   Storage header (16B, little-endian): "DLT\x01" magic Â· uint32 secs Â· int32 usecs Â· 4B ECU
//   Standard header (>=4B):  HTYP(u8) Â· MCNT(u8) Â· LEN(u16 BIG-endian) [ + ECU|SID|TMSP ]
//   Extended header (10B, if HTYP.UEH): MSIN(u8) Â· NOAR(u8) Â· 4B APID Â· 4B CTID
//   Payload: verbose (NOAR typed args) or non-verbose (u32 msg-id + data)
// Endianness gotchas: storage secs/usecs are LITTLE-endian; LEN and the standard-
// header optional fields are BIG-endian; payload arg data follows HTYP.MSBF.
//
// NOTE: byte-verified only against synthetic frames so far (no real sample yet);
// header offsets/endianness should be re-confirmed against a real capture, then
// bump `decoderVersion` if the output layout changes. Pure + Electron-free so the
// decode logic is unit-tested; the worker + adapter wrap it.

import * as fs from 'fs';
import * as path from 'path';

// Storage-header magic: 'D' 'L' 'T' 0x01
const MAGIC0 = 0x44, MAGIC1 = 0x4c, MAGIC2 = 0x54, MAGIC3 = 0x01;

// HTYP (standard header type) bit flags.
const HTYP_UEH = 0x01;  // use extended header
const HTYP_MSBF = 0x02; // payload is big-endian
const HTYP_WEID = 0x04; // with ECU id in standard header
const HTYP_WSID = 0x08; // with session id
const HTYP_WTMS = 0x10; // with timestamp

// MSTP (message type) â label. LOG is by far the common one.
const MSG_TYPES = ['LOG', 'APP_TRACE', 'NW_TRACE', 'CONTROL', '?4', '?5', '?6', '?7'];
// MTIN (message-type info) for MSTP=LOG â level name (index by MTIN 1..6).
const LOG_LEVELS = ['', 'FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'VERBOSE'];

// Type-info bits for a verbose argument (the low 32 bits before its data).
const TYPE_BOOL = 0x00000010;
const TYPE_SINT = 0x00000020;
const TYPE_UINT = 0x00000040;
const TYPE_FLOA = 0x00000080;
const TYPE_ARAY = 0x00000100;
const TYPE_STRG = 0x00000200;
const TYPE_RAWD = 0x00000400;
const TYPE_VARI = 0x00000800;

export interface DltRecord {
  /** Storage-header wall-clock seconds (Unix epoch), or null when absent. */
  secs: number | null;
  /** Storage-header microseconds part (0..999999), or null. */
  usecs: number | null;
  mcnt: number;            // message counter
  ecu: string;             // ECU id (storage header, overridden by WEID)
  sessionId: number | null;
  /** Standard-header timestamp in 0.1 ms ticks (uptime), or null. */
  tmsp: number | null;
  apid: string;            // application id (extended header)
  ctid: string;            // context id (extended header)
  mstp: number;            // message type (0=LOG â¦)
  mtin: number;            // message-type info (for LOG â level)
  verbose: boolean;
  payload: string;         // decoded, single-line
}

/**
 * Detect a DLT capture: the storage-header magic up front (reliable, extension-
 * independent — so a DLT-framed .dt1/.DLT1 is caught regardless of name), or a DLT-
 * family extension `.dlt` / `.dlt1` / `.dt1` (vendor diagnostic-log variants). A file
 * routed here that turns out not to be DLT decodes to a "no messages" note (the user
 * can still Open-as text), so extension matching is safe. Magic wins over extension.
 */
export function isDlt(filePath: string, head: Buffer): boolean {
  if (head.length >= 4 && head[0] === MAGIC0 && head[1] === MAGIC1 && head[2] === MAGIC2 && head[3] === MAGIC3) return true;
  return /\.(dlt1?|dt1)$/i.test(filePath);
}

function magicAt(buf: Buffer, pos: number): boolean {
  return pos + 4 <= buf.length && buf[pos] === MAGIC0 && buf[pos + 1] === MAGIC1 && buf[pos + 2] === MAGIC2 && buf[pos + 3] === MAGIC3;
}

// Read a fixed-width id (ECU/APID/CTID), trimming NULs and trailing spaces.
function readId(buf: Buffer, pos: number, len: number): string {
  if (pos + len > buf.length) return '';
  let end = pos + len;
  for (let i = pos; i < pos + len; i++) { if (buf[i] === 0) { end = i; break; } }
  return buf.toString('latin1', pos, end).replace(/\s+$/, '');
}

function tyleBytes(tyle: number): number {
  switch (tyle) { case 1: return 1; case 2: return 2; case 3: return 4; case 4: return 8; case 5: return 16; default: return 0; }
}

// Decode one verbose payload (NOAR typed args) into a single readable string.
// Best-effort: on an unknown/short arg it stops and appends the remaining bytes as
// hex, so an exotic payload degrades gracefully instead of throwing.
function decodeVerbose(buf: Buffer, msbf: boolean, noar: number): string {
  const parts: string[] = [];
  let p = 0;
  const rdU16 = (o: number) => (msbf ? buf.readUInt16BE(o) : buf.readUInt16LE(o));
  const rdU32 = (o: number) => (msbf ? buf.readUInt32BE(o) : buf.readUInt32LE(o));
  try {
    for (let i = 0; i < noar; i++) {
      if (p + 4 > buf.length) break;
      const info = rdU32(p); p += 4;
      const tyle = info & 0x0f;
      if (info & TYPE_STRG) {
        if (p + 2 > buf.length) break;
        const len = rdU16(p); p += 2;
        if (info & TYPE_VARI) { break; } // variable name/unit info â skip decode, fall to raw tail
        const s = buf.toString('utf8', p, Math.min(p + len, buf.length)); p += len;
        parts.push(s.replace(/\0+$/, ''));
      } else if (info & TYPE_RAWD) {
        if (p + 2 > buf.length) break;
        const len = rdU16(p); p += 2;
        parts.push(buf.toString('hex', p, Math.min(p + len, buf.length))); p += len;
      } else if (info & TYPE_BOOL) {
        const b = tyle || 1; if (p + b > buf.length) break;
        parts.push(buf[p] ? 'true' : 'false'); p += b;
      } else if (info & (TYPE_UINT | TYPE_SINT)) {
        const b = tyleBytes(tyle); if (b === 0 || p + b > buf.length) break;
        const signed = !!(info & TYPE_SINT);
        parts.push(readInt(buf, p, b, msbf, signed)); p += b;
      } else if (info & TYPE_FLOA) {
        const b = tyleBytes(tyle); if (p + b > buf.length) break;
        if (b === 4) parts.push(String(msbf ? buf.readFloatBE(p) : buf.readFloatLE(p)));
        else if (b === 8) parts.push(String(msbf ? buf.readDoubleBE(p) : buf.readDoubleLE(p)));
        else parts.push('0x' + buf.toString('hex', p, p + b));
        p += b;
      } else if (info & TYPE_ARAY) {
        break; // arrays are rare in logs â leave the rest as raw tail
      } else {
        break; // unknown type: can't know its length
      }
    }
  } catch { /* fall through to raw tail */ }
  if (p < buf.length) parts.push('0x' + buf.toString('hex', p, buf.length));
  return parts.join(' ');
}

function readInt(buf: Buffer, pos: number, bytes: number, msbf: boolean, signed: boolean): string {
  switch (bytes) {
    case 1: return String(signed ? buf.readInt8(pos) : buf.readUInt8(pos));
    case 2: return String(signed ? (msbf ? buf.readInt16BE(pos) : buf.readInt16LE(pos)) : (msbf ? buf.readUInt16BE(pos) : buf.readUInt16LE(pos)));
    case 4: return String(signed ? (msbf ? buf.readInt32BE(pos) : buf.readInt32LE(pos)) : (msbf ? buf.readUInt32BE(pos) : buf.readUInt32LE(pos)));
    case 8: return String(signed ? (msbf ? buf.readBigInt64BE(pos) : buf.readBigInt64LE(pos)) : (msbf ? buf.readBigUInt64BE(pos) : buf.readBigUInt64LE(pos)));
    default: return '0x' + buf.toString('hex', pos, pos + bytes);
  }
}

function decodeNonVerbose(buf: Buffer, msbf: boolean): string {
  if (buf.length < 4) return buf.length ? '0x' + buf.toString('hex') : '';
  const id = msbf ? buf.readUInt32BE(0) : buf.readUInt32LE(0);
  const rest = buf.length > 4 ? ' 0x' + buf.toString('hex', 4) : '';
  return `[non-verbose id=0x${id.toString(16).padStart(8, '0')}]${rest}`;
}

/**
 * Walk a DLT buffer, emitting one DltRecord per message. Self-framing via the
 * standard-header LEN, so it tolerates missing storage headers and stops cleanly on
 * a truncated/corrupt tail. Returns the number of messages decoded.
 */
export function decodeDlt(buf: Buffer, emit: (rec: DltRecord) => void): number {
  let pos = 0;
  let count = 0;
  const n = buf.length;
  while (pos + 4 <= n) {
    let secs: number | null = null, usecs: number | null = null, storageEcu = '';
    if (magicAt(buf, pos)) {
      if (pos + 16 > n) break;
      secs = buf.readUInt32LE(pos + 4);
      usecs = buf.readInt32LE(pos + 8);
      storageEcu = readId(buf, pos + 12, 4);
      pos += 16;
    }
    if (pos + 4 > n) break;
    const htyp = buf.readUInt8(pos);
    const mcnt = buf.readUInt8(pos + 1);
    const msgLen = buf.readUInt16BE(pos + 2);
    if (msgLen < 4 || pos + msgLen > n) break; // truncated or not framed â stop
    const msgEnd = pos + msgLen;

    let p = pos + 4;
    let ecu = storageEcu;
    if (htyp & HTYP_WEID) { ecu = readId(buf, p, 4) || storageEcu; p += 4; }
    let sessionId: number | null = null;
    if (htyp & HTYP_WSID) { if (p + 4 > msgEnd) break; sessionId = buf.readUInt32BE(p); p += 4; }
    let tmsp: number | null = null;
    if (htyp & HTYP_WTMS) { if (p + 4 > msgEnd) break; tmsp = buf.readUInt32BE(p); p += 4; }

    let msin = 0, noar = 0, apid = '', ctid = '', verbose = false, mstp = 0, mtin = 0;
    if (htyp & HTYP_UEH) {
      if (p + 10 > msgEnd) break;
      msin = buf.readUInt8(p);
      noar = buf.readUInt8(p + 1);
      apid = readId(buf, p + 2, 4);
      ctid = readId(buf, p + 6, 4);
      p += 10;
      verbose = !!(msin & 0x01);
      mstp = (msin >> 1) & 0x07;
      mtin = (msin >> 4) & 0x0f;
    }

    const payloadBuf = buf.subarray(p, msgEnd);
    const msbf = !!(htyp & HTYP_MSBF);
    let payload: string;
    if (htyp & HTYP_UEH) payload = verbose ? decodeVerbose(payloadBuf, msbf, noar) : decodeNonVerbose(payloadBuf, msbf);
    else payload = payloadBuf.length ? '0x' + payloadBuf.toString('hex') : '';

    emit({ secs, usecs, mcnt, ecu, sessionId, tmsp, apid, ctid, mstp, mtin, verbose, payload });
    count++;
    pos = msgEnd;
  }
  return count;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

// Storage wall-clock â "YYYY-MM-DD HH:MM:SS.ffffff" in UTC (deterministic). Falls
// back to the uptime timestamp, else a placeholder.
function fmtTime(rec: DltRecord): string {
  if (rec.secs != null) {
    const d = new Date(rec.secs * 1000);
    const frac = String(Math.max(0, Math.min(999999, rec.usecs ?? 0))).padStart(6, '0');
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${frac}`;
  }
  if (rec.tmsp != null) return `t=${(rec.tmsp / 10000).toFixed(4)}s`; // 0.1ms ticks â seconds
  return '--';
}

function levelName(rec: DltRecord): string {
  if (rec.mstp === 0) return LOG_LEVELS[rec.mtin] || `L${rec.mtin}`;
  return '--';
}

// Pad-right to a fixed column width (values that overflow are left intact â only
// timestamps and ids drive alignment, and those are bounded).
function cell(v: string, w: number): string { return v.length >= w ? v + ' ' : v.padEnd(w); }

const COLS: Array<[string, number]> = [
  ['Time', 27], ['Cnt', 5], ['ECU', 5], ['APID', 5], ['CTID', 5], ['Type', 10], ['Level', 8],
];

export function dltHeaderRow(): string {
  return COLS.map(([name, w]) => cell(name, w)).join('') + 'Payload';
}

// Collapse embedded newlines so one message stays one line; drop other control
// chars (tabs->space). Printable punctuation like "=" in "OTAF=" is preserved.
function sanitize(s: string): string {
  return s
    .replace(/\r\n|\r|\n/g, " ⏎ ")
    .replace(/\t/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trimEnd();
}

export function formatDltRecord(rec: DltRecord): string {
  const cells = [
    fmtTime(rec),
    String(rec.mcnt),
    rec.ecu || '-',
    rec.apid || '-',
    rec.ctid || '-',
    MSG_TYPES[rec.mstp] || `?${rec.mstp}`,
    levelName(rec),
  ];
  return cells.map((v, i) => cell(v, COLS[i][1])).join('') + sanitize(rec.payload);
}

/**
 * Decode a `.dlt` file to a normalized text file (banner + column header + one line
 * per message). Reads the whole file into memory (parity with the vtrace decoder);
 * streaming is a later optimization.
 */
export async function parseDltToFile(
  filePath: string,
  outPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const buf = fs.readFileSync(filePath);
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
    writeLine(`#----- BEGIN: ${base} (DLT decode)`);
    writeLine(dltHeaderRow());
    const n = buf.length || 1;
    let lastPct = -1;
    let count = 0;
    let bytePos = 0;
    count = decodeDlt(buf, (rec) => {
      writeLine(formatDltRecord(rec));
      // Coarse progress from decoded volume (records don't carry a byte offset here).
      bytePos += 40;
      if (onProgress) {
        const pct = Math.min(99, Math.floor((bytePos / n) * 100));
        if (pct !== lastPct) { onProgress(pct); lastPct = pct; }
      }
    });
    if (count === 0) writeLine('#----- (no DLT messages decoded â not a DLT capture, or an unsupported layout)');
    flush();
  } finally {
    fs.closeSync(fd);
  }
  onProgress?.(100);
}
