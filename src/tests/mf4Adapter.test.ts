import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { Mf4Adapter, pickAdapter, adapterRegistry } from '../main/sourceAdapter';
import { parseMdf4ToFile } from '../main/mf4Parse';

// ── Minimal MDF 4.x fixture builder ──────────────────────────────────────────
// Builds a tiny but spec-shaped MF4 buffer: ID + HD + DG + CG + 2×CN (a float64
// time master + an int16 "speed" signal) + TX + uncompressed ##DT with 3 records.
function mdf4Block(id: string, links: number[], data: Buffer): Buffer {
  const length = 24 + links.length * 8 + data.length;
  const b = Buffer.alloc(length);
  b.write(id, 0, 'latin1');
  b.writeBigUInt64LE(BigInt(length), 8);
  b.writeBigUInt64LE(BigInt(links.length), 16);
  links.forEach((l, i) => b.writeBigUInt64LE(BigInt(l), 24 + i * 8));
  data.copy(b, 24 + links.length * 8);
  return b;
}

type DataKind = 'dt' | 'dz' | 'dzt' | 'dl';

/** Wrap raw record bytes in a ##DZ block (deflate, zip_type 0, org_block_type "DT"). */
function makeDz(raw: Buffer): Buffer {
  const comp = zlib.deflateSync(raw);
  const d = Buffer.alloc(24 + comp.length);
  d.write('DT', 0, 'latin1');                  // dz_org_block_type
  d.writeUInt8(0, 2);                          // dz_zip_type = deflate
  d.writeUInt32LE(0, 4);                       // dz_zip_parameter
  d.writeBigUInt64LE(BigInt(raw.length), 8);   // dz_org_data_length
  d.writeBigUInt64LE(BigInt(comp.length), 16); // dz_data_length
  comp.copy(d, 24);
  return mdf4Block('##DZ', [], d);
}

/** Wrap raw record bytes in a transposed ##DZ block (zip_type 1), cols = record size. */
function makeDzTransposed(raw: Buffer, cols: number): Buffer {
  const N = Math.floor(raw.length / cols);
  const transposed = Buffer.alloc(raw.length);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < cols; j++) transposed[j * N + i] = raw[i * cols + j];
  }
  for (let k = N * cols; k < raw.length; k++) transposed[k] = raw[k];
  const comp = zlib.deflateSync(transposed);
  const d = Buffer.alloc(24 + comp.length);
  d.write('DT', 0, 'latin1');
  d.writeUInt8(1, 2);                          // dz_zip_type = transposition + deflate
  d.writeUInt32LE(cols, 4);                    // dz_zip_parameter = columns
  d.writeBigUInt64LE(BigInt(raw.length), 8);
  d.writeBigUInt64LE(BigInt(comp.length), 16);
  comp.copy(d, 24);
  return mdf4Block('##DZ', [], d);
}

function buildFixture(dataKind: DataKind = 'dt'): Buffer {
  // IDBLOCK — 64 bytes, "MDF     " + version.
  const id = Buffer.alloc(64);
  id.write('MDF     ', 0, 'latin1');
  id.write('4.10    ', 8, 'latin1');
  id.writeUInt16LE(410, 28);

  // Offsets are computed from fixed block sizes (see lengths below).
  const HD = 64;
  const DG = HD + 96;   // HD: 6 links + 24 data = 96
  const CG = DG + 64;   // DG: 4 links + 8 data = 64
  const CN1 = CG + 104; // CG: 6 links + 32 data = 104
  const CN2 = CN1 + 104; // CN: 8 links + 16 data = 104
  const TX = CN2 + 104;
  const TXlen = 24 + Buffer.from('speed\0').length; // 30
  const DT = TX + TXlen;

  // HDBLOCK — only hd_dg_first matters to the reader.
  const hd = mdf4Block('##HD', [DG, 0, 0, 0, 0, 0], Buffer.alloc(24));

  // DGBLOCK — dg_dg_next, dg_cg_first, dg_data, dg_md_comment; rec_id_size=0.
  const dg = mdf4Block('##DG', [0, CG, DT, 0], Buffer.alloc(8));

  // CGBLOCK — cg_cn_first = CN1; cycle_count=3, data_bytes=10, inval_bytes=0.
  const cgData = Buffer.alloc(32);
  cgData.writeBigUInt64LE(0n, 0);   // record_id
  cgData.writeBigUInt64LE(3n, 8);   // cycle_count
  cgData.writeUInt16LE(0, 16);      // flags
  cgData.writeUInt32LE(10, 24);     // cg_data_bytes
  cgData.writeUInt32LE(0, 28);      // cg_inval_bytes
  const cg = mdf4Block('##CG', [0, CN1, 0, 0, 0, 0], cgData);

  // CN1 — master/time, float64 LE at byte 0.
  const cn1Data = Buffer.alloc(16);
  cn1Data.writeUInt8(2, 0);  // cn_type = master
  cn1Data.writeUInt8(1, 1);  // sync_type = time
  cn1Data.writeUInt8(4, 2);  // data_type = float LE
  cn1Data.writeUInt8(0, 3);  // bit_offset
  cn1Data.writeUInt32LE(0, 4);   // byte_offset
  cn1Data.writeUInt32LE(64, 8);  // bit_count
  const cn1 = mdf4Block('##CN', [CN2, 0, 0, 0, 0, 0, 0, 0], cn1Data);

  // CN2 — "speed", int16 LE at byte 8.
  const cn2Data = Buffer.alloc(16);
  cn2Data.writeUInt8(0, 0);  // cn_type = fixed-length data
  cn2Data.writeUInt8(0, 1);  // sync_type = none
  cn2Data.writeUInt8(2, 2);  // data_type = int LE
  cn2Data.writeUInt8(0, 3);  // bit_offset
  cn2Data.writeUInt32LE(8, 4);   // byte_offset
  cn2Data.writeUInt32LE(16, 8);  // bit_count
  const cn2 = mdf4Block('##CN', [0, 0, TX, 0, 0, 0, 0, 0], cn2Data);

  const tx = mdf4Block('##TX', [], Buffer.from('speed\0'));

  // Record payload — 3 records × (float64 time + int16 speed).
  const recData = Buffer.alloc(30);
  for (let i = 0; i < 3; i++) {
    recData.writeDoubleLE(i * 0.1, i * 10);
    recData.writeInt16LE(100 * (i + 1), i * 10 + 8);
  }

  // The data section sits at offset DT regardless of kind (dg_data points there).
  let dataSection: Buffer;
  if (dataKind === 'dt') {
    dataSection = mdf4Block('##DT', [], recData);
  } else if (dataKind === 'dz') {
    dataSection = makeDz(recData);
  } else if (dataKind === 'dzt') {
    dataSection = makeDzTransposed(recData, 10); // record size = 10 bytes
  } else {
    // ##DL listing a single ##DZ chunk placed right after the DL block.
    const DLlen = 24 + 2 * 8 + 16; // header + (dl_dl_next + 1 data link) + data
    const dlData = Buffer.alloc(16);
    dlData.writeUInt8(0, 0);    // dl_flags (no equal-length → dl_offset[] follows)
    dlData.writeUInt32LE(1, 4); // dl_count = 1
    const dl = mdf4Block('##DL', [0, DT + DLlen], dlData); // links: dl_dl_next, dl_data[0]
    dataSection = Buffer.concat([dl, makeDz(recData)]);
  }

  return Buffer.concat([id, hd, dg, cg, cn1, cn2, tx, dataSection]);
}

function tmpMf4(kind: DataKind = 'dt'): string {
  const p = path.join(os.tmpdir(), `logan-mf4-fix-${process.pid}-${Math.random().toString(36).slice(2)}.mf4`);
  fs.writeFileSync(p, buildFixture(kind));
  return p;
}

/**
 * Parse a fixture of the given kind via the worker-thread parse core (called
 * directly here, no worker) and return the normalized output lines.
 */
async function parseToLines(kind: DataKind): Promise<string[]> {
  const p = tmpMf4(kind);
  const outPath = path.join(os.tmpdir(), `logan-mf4-out-${process.pid}-${Math.random().toString(36).slice(2)}.norm`);
  try {
    await parseMdf4ToFile(p, outPath);
    return fs.readFileSync(outPath, 'utf-8').split('\n');
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
}

describe('Mf4Adapter', () => {
  it('is registered ahead of the text fallback', () => {
    const ids = adapterRegistry.map(a => a.id);
    expect(ids).toContain('mf4');
    expect(ids.indexOf('mf4')).toBeLessThan(ids.indexOf('text'));
  });

  it('detect() matches an .mf4 file with the MDF magic, rejects others', () => {
    const a = new Mf4Adapter();
    expect(a.detect('x.mf4', Buffer.from('MDF     '))).toBe(true);
    expect(a.detect('x.mdf', Buffer.from('MDF     '))).toBe(true);
    expect(a.detect('x.mf4', Buffer.from('PK\x03\x04zip'))).toBe(false); // wrong magic
    expect(a.detect('x.log', Buffer.from('MDF     '))).toBe(false);      // wrong extension
  });

  it('pickAdapter() routes a real MF4 fixture to the mf4 adapter', () => {
    const p = tmpMf4();
    try {
      expect(pickAdapter(p).id).toBe('mf4');
    } finally {
      fs.unlinkSync(p);
    }
  });

  const expectedLines = ['t=0 speed=100', 't=0.1 speed=200', 't=0.2 speed=300'];

  it('parse decodes raw ##DT records into synthetic t=…/signal=… lines', async () => {
    expect(await parseToLines('dt')).toEqual(expectedLines);
  });

  it('parse decodes compressed ##DZ data blocks', async () => {
    expect(await parseToLines('dz')).toEqual(expectedLines);
  });

  it('parse decodes transposed ##DZ blocks (zip_type 1)', async () => {
    expect(await parseToLines('dzt')).toEqual(expectedLines);
  });

  it('parse decodes ##DL data lists pointing to ##DZ chunks', async () => {
    expect(await parseToLines('dl')).toEqual(expectedLines);
  });

  it('exposes binary, no-append capabilities', () => {
    const caps = new Mf4Adapter().capabilities;
    expect(caps.isBinary).toBe(true);
    expect(caps.supportsAppend).toBe(false);
  });
});
