import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Mf4Adapter, pickAdapter, adapterRegistry } from '../main/sourceAdapter';

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

function buildFixture(): Buffer {
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

  // DTBLOCK — 3 records × (float64 time + int16 speed).
  const dtData = Buffer.alloc(30);
  for (let i = 0; i < 3; i++) {
    dtData.writeDoubleLE(i * 0.1, i * 10);
    dtData.writeInt16LE(100 * (i + 1), i * 10 + 8);
  }
  const dt = mdf4Block('##DT', [], dtData);

  return Buffer.concat([id, hd, dg, cg, cn1, cn2, tx, dt]);
}

function tmpMf4(): string {
  const p = path.join(os.tmpdir(), `logan-mf4-fix-${process.pid}-${Math.random().toString(36).slice(2)}.mf4`);
  fs.writeFileSync(p, buildFixture());
  return p;
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

  it('normalize() decodes records into synthetic t=…/signal=… lines', async () => {
    const p = tmpMf4();
    let outPath = '';
    try {
      const source = await new Mf4Adapter().normalize(p);
      outPath = source.path;
      const lines = fs.readFileSync(source.path, 'utf-8').split('\n');
      expect(lines).toEqual([
        't=0 speed=100',
        't=0.1 speed=200',
        't=0.2 speed=300',
      ]);
      expect(source.capabilities.isBinary).toBe(true);
      expect(source.capabilities.supportsAppend).toBe(false);
      source.cleanup?.();
    } finally {
      fs.unlinkSync(p);
      if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  });
});
