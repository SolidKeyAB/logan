import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/**
 * ── ASAM MDF4 (MF4) parser core ──────────────────────────────────────────────
 * MF4 is a binary automotive measurement format: channel groups of named numeric
 * signals sampled against a time master. This is a MINIMAL, dependency-free MDF
 * 4.x reader for the COMMON case:
 *   • data in ##DT (raw), ##DZ (deflate / transposed-deflate) or ##DL/##HL lists,
 *   • sorted groups (one channel group per data group),
 *   • fixed-length numeric channels (int/uint/float, LE/BE),
 *   • raw values (channel conversions/##CC are NOT applied yet).
 * Anything outside that is reported inline (a `[mf4] …` line) and skipped rather
 * than producing wrong numbers.
 *
 * Each record becomes a synthetic line `t=<master> <name>=<value> …` so the
 * existing viewer + Trends field-discovery chart the signals with zero new UI.
 *
 * Records are STREAMED chunk-by-chunk (never the whole decompressed dataset at
 * once), so memory stays bounded even for multi-GB recordings. This module is
 * run inside a worker thread (see mf4Worker.ts) so parsing never blocks the
 * Electron main/UI event loop.
 */

interface Mdf4Block { id: string; links: number[]; dataStart: number; dataEnd: number; }

function readMdf4Block(buf: Buffer, offset: number): Mdf4Block {
  const id = buf.toString('latin1', offset, offset + 4); // e.g. "##HD"
  const length = Number(buf.readBigUInt64LE(offset + 8));
  const linkCount = Number(buf.readBigUInt64LE(offset + 16));
  const links: number[] = [];
  let p = offset + 24;
  for (let i = 0; i < linkCount; i++) { links.push(Number(buf.readBigUInt64LE(p))); p += 8; }
  return { id, links, dataStart: p, dataEnd: offset + length };
}

/** Read a ##TX/##MD block's text (null-terminated UTF-8). 0 link → ''. */
function readMdf4Text(buf: Buffer, offset: number): string {
  if (!offset) return '';
  try {
    const b = readMdf4Block(buf, offset);
    if (b.id !== '##TX' && b.id !== '##MD') return '';
    let s = buf.toString('utf8', b.dataStart, b.dataEnd);
    const nul = s.indexOf('\0');
    if (nul >= 0) s = s.slice(0, nul);
    return s.trim();
  } catch { return ''; }
}

interface Mdf4Channel { name: string; type: number; dataType: number; bitOffset: number; byteOffset: number; bitCount: number; }

/** Decode one channel's value from a record slice. Returns null if unsupported. */
function decodeMdf4Value(rec: Buffer, base: number, cn: Mdf4Channel): number | null {
  const off = base + cn.byteOffset;
  const { dataType: dt, bitCount: bits, bitOffset } = cn;
  if (off < 0 || off >= rec.length) return null;

  // Byte-aligned, whole-byte fields → use Buffer's native readers.
  if (bitOffset === 0 && bits % 8 === 0) {
    const n = bits / 8;
    if (off + n > rec.length) return null;
    try {
      switch (dt) {
        case 0: return n <= 6 ? rec.readUIntLE(off, n) : Number(rec.readBigUInt64LE(off)); // uint LE
        case 1: return n <= 6 ? rec.readUIntBE(off, n) : Number(rec.readBigUInt64BE(off)); // uint BE
        case 2: return n <= 6 ? rec.readIntLE(off, n) : Number(rec.readBigInt64LE(off));   // int LE
        case 3: return n <= 6 ? rec.readIntBE(off, n) : Number(rec.readBigInt64BE(off));   // int BE
        case 4: return n === 4 ? rec.readFloatLE(off) : n === 8 ? rec.readDoubleLE(off) : null; // float LE
        case 5: return n === 4 ? rec.readFloatBE(off) : n === 8 ? rec.readDoubleBE(off) : null; // float BE
        default: return null; // strings/bytes/complex — not charted
      }
    } catch { return null; }
  }

  // Non-aligned integer bit-field (little-endian only).
  if (dt === 0 || dt === 2) {
    const totalBits = bitOffset + bits;
    const n = Math.ceil(totalBits / 8);
    if (n > 8 || off + n > rec.length) return null;
    let v = 0n;
    for (let i = 0; i < n; i++) v |= BigInt(rec[off + i]) << BigInt(8 * i);
    v = (v >> BigInt(bitOffset)) & ((1n << BigInt(bits)) - 1n);
    if (dt === 2 && (v & (1n << BigInt(bits - 1)))) v -= (1n << BigInt(bits)); // sign-extend
    return Number(v);
  }
  return null;
}

/**
 * Decompress a ##DZ block (MDF4 compressed data). zip_type 0 = raw deflate,
 * 1 = transposition + deflate (used for record data so columns compress better).
 */
function inflateMdf4Dz(buf: Buffer, block: Mdf4Block): Buffer {
  const d = block.dataStart;
  const zipType = buf.readUInt8(d + 2);
  const zipParam = buf.readUInt32LE(d + 4);
  const orgLen = Number(buf.readBigUInt64LE(d + 8));
  const dataLen = Number(buf.readBigUInt64LE(d + 16));
  const comp = buf.subarray(d + 24, d + 24 + dataLen);
  let out: Buffer = zlib.inflateSync(comp);
  if (zipType === 1 && zipParam > 0) out = untransposeMdf4(out, zipParam, orgLen);
  return out;
}

/**
 * Reverse MDF4 column-transposition. The original byte matrix (orgLen bytes,
 * `cols` columns, N full rows) was stored column-major; any trailing remainder
 * bytes are appended untransposed.
 */
function untransposeMdf4(data: Buffer, cols: number, orgLen: number): Buffer {
  const N = Math.floor(orgLen / cols);
  const out = Buffer.alloc(orgLen);
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < N; i++) {
      out[i * cols + j] = data[j * N + i];
    }
  }
  for (let k = N * cols; k < orgLen && k < data.length; k++) out[k] = data[k];
  return out;
}

/**
 * Walk a data-section pointer and hand each contiguous chunk of raw record bytes
 * to `onChunk` — following ##DT/##RD (raw), ##DZ (decompressed), ##DL (each listed
 * chunk, then dl_dl_next) and ##HL (unwrap to its DL). Only ONE chunk is held in
 * memory at a time. `onChunk` returning false stops the walk early. Returns false
 * if stopped. `depth` guards cyclic links.
 */
function forEachMdf4DataChunk(
  buf: Buffer,
  off: number,
  onChunk: (chunk: Buffer) => boolean,
  depth = 0
): boolean {
  if (!off || depth > 64) return true;
  let block: Mdf4Block;
  try { block = readMdf4Block(buf, off); } catch { return true; }

  if (block.id === '##DT' || block.id === '##RD') {
    return onChunk(buf.subarray(block.dataStart, block.dataEnd)) !== false;
  }
  if (block.id === '##DZ') {
    let dec: Buffer;
    try { dec = inflateMdf4Dz(buf, block); } catch { return true; }
    return onChunk(dec) !== false;
  }
  if (block.id === '##HL') {
    return forEachMdf4DataChunk(buf, block.links[0], onChunk, depth + 1); // hl_dl_first
  }
  if (block.id === '##DL') {
    let dlOff = off;
    let guard = 0;
    while (dlOff && guard++ < 1_000_000) {
      const dl = readMdf4Block(buf, dlOff);
      const count = buf.readUInt32LE(dl.dataStart + 4); // dl_flags(1)+reserved(3), then dl_count
      for (let i = 0; i < count; i++) {
        const link = dl.links[1 + i]; // links[0] is dl_dl_next; data links follow
        if (link && !forEachMdf4DataChunk(buf, link, onChunk, depth + 1)) return false;
      }
      dlOff = dl.links[0]; // dl_dl_next
    }
    return true;
  }
  return true;
}

/**
 * Stream fixed-size records (recSize bytes each) across all data chunks, carrying
 * a small remainder across chunk boundaries. `onRecord(rec, base)` returning false
 * stops iteration. Peak memory ≈ one decompressed chunk + (< recSize) leftover.
 */
function streamMdf4Records(
  buf: Buffer,
  dataOff: number,
  recSize: number,
  onRecord: (rec: Buffer, base: number) => boolean
): void {
  let leftover: Buffer | null = null;
  let stop = false;
  forEachMdf4DataChunk(buf, dataOff, (chunk) => {
    if (stop) return false;
    const data = leftover && leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
    let i = 0;
    for (; i + recSize <= data.length; i += recSize) {
      if (onRecord(data, i) === false) { stop = true; break; }
    }
    leftover = stop ? null : data.subarray(i);
    return !stop;
  });
}

/**
 * Parse an MF4 file at `filePath` into newline-delimited `t=… name=value` text at
 * `outPath`. Synchronous CPU work — call it from a worker thread. Internal parse
 * errors are written as a `[mf4] …` note rather than thrown; only a non-MDF file
 * throws. Output is written incrementally so a large input never materialises as
 * one giant string.
 */
export async function parseMdf4ToFile(
  filePath: string,
  outPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 64 || buf.toString('latin1', 0, 3) !== 'MDF') {
    throw new Error(`Not an MDF/MF4 file: ${path.basename(filePath)}`);
  }

  const fd = fs.openSync(outPath, 'w');
  let first = false;
  let pending = '';
  const flush = (): void => {
    if (pending) { fs.writeSync(fd, pending); pending = ''; }
  };
  const writeLine = (line: string): void => {
    pending += first ? '\n' + line : line;
    first = true;
    if (pending.length >= 1 << 20) flush(); // flush every ~1 MB
  };

  try {
    const hd = readMdf4Block(buf, 64); // HDBLOCK directly after the 64-byte IDBLOCK
    let dgOff = hd.links[0] || 0;       // hd_dg_first
    let totalRecords = 0;

    while (dgOff) {
      const dg = readMdf4Block(buf, dgOff);
      const recIdSize = buf.readUInt8(dg.dataStart);
      const cgFirst = dg.links[1];
      const dgData = dg.links[2];

      if (cgFirst) {
        const cg = readMdf4Block(buf, cgFirst);
        if (cg.links[0]) writeLine('[mf4] note: data group has multiple channel groups; reading the first only');
        const cycleCount = Number(buf.readBigUInt64LE(cg.dataStart + 8));
        const cgFlags = buf.readUInt16LE(cg.dataStart + 16);
        const dataBytes = buf.readUInt32LE(cg.dataStart + 24);
        const invalBytes = buf.readUInt32LE(cg.dataStart + 28);

        if (cgFlags & 0x1) {
          writeLine('[mf4] variable-length (VLSD) channel group not supported — skipped');
        } else {
          // Collect channels.
          const channels: Mdf4Channel[] = [];
          let master: Mdf4Channel | null = null;
          let cnOff = cg.links[1]; // cg_cn_first
          while (cnOff) {
            const cn = readMdf4Block(buf, cnOff);
            const d = cn.dataStart;
            const ch: Mdf4Channel = {
              name: readMdf4Text(buf, cn.links[2]) || `ch${buf.readUInt32LE(d + 4)}`,
              type: buf.readUInt8(d),
              dataType: buf.readUInt8(d + 2),
              bitOffset: buf.readUInt8(d + 3),
              byteOffset: buf.readUInt32LE(d + 4),
              bitCount: buf.readUInt32LE(d + 8),
            };
            if (ch.type === 2 || ch.type === 3) master = ch; // master / virtual master
            else channels.push(ch);
            cnOff = cn.links[0]; // cn_cn_next
          }

          const recSize = recIdSize + dataBytes + invalBytes;
          let groupRecords = 0;
          if (dgData && recSize > 0 && cycleCount > 0) {
            // Stream records chunk-by-chunk (handles ##DT/##DZ/##DL/##HL).
            streamMdf4Records(buf, dgData, recSize, (rec, recStart) => {
              const base = recStart + recIdSize;
              if (base + dataBytes > rec.length) return false;
              const parts: string[] = [];
              if (master) {
                const mv = decodeMdf4Value(rec, base, master);
                if (mv !== null) parts.push(`t=${mv}`);
              }
              for (const ch of channels) {
                const v = decodeMdf4Value(rec, base, ch);
                if (v !== null) parts.push(`${ch.name}=${v}`);
              }
              if (parts.length) writeLine(parts.join(' '));
              if (++totalRecords % 5000 === 0 && onProgress) {
                onProgress(Math.min(99, Math.round((dgOff / buf.length) * 100)));
              }
              return ++groupRecords < cycleCount;
            });
          }
          if (groupRecords === 0) {
            const blk = dgData ? readMdf4Block(buf, dgData) : null;
            writeLine(`[mf4] data block ${blk ? blk.id : 'missing'} produced no readable records — skipped`);
          }
        }
      }
      dgOff = dg.links[0]; // dg_dg_next
    }

    if (!first) writeLine('[mf4] no readable records found (file may use compression or an unsupported layout)');
  } catch (err) {
    writeLine(`[mf4] parse stopped: ${String(err)}`);
  } finally {
    flush();
    fs.closeSync(fd);
  }

  onProgress?.(100);
}
