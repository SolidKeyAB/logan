import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isDlt, decodeDlt, formatDltRecord, dltHeaderRow, parseDltToFile, DltRecord } from '../main/dltParse';
import { pickAdapter } from '../main/sourceAdapter';

// ─── DLT frame builder (matches the decoder's endianness rules) ──────────────
function id4(s: string): Buffer {
  const b = Buffer.alloc(4, 0);
  Buffer.from(s, 'latin1').copy(b, 0, 0, Math.min(4, s.length));
  return b;
}
function storageHeader(secs: number, usecs: number, ecu: string): Buffer {
  const b = Buffer.alloc(16);
  b[0] = 0x44; b[1] = 0x4c; b[2] = 0x54; b[3] = 0x01; // "DLT\x01"
  b.writeUInt32LE(secs >>> 0, 4);
  b.writeInt32LE(usecs | 0, 8);
  id4(ecu).copy(b, 12);
  return b;
}
// Verbose args (little-endian payload; MSBF off).
function strArg(s: string): Buffer {
  const str = Buffer.from(s + '\0', 'utf8');
  const b = Buffer.alloc(6 + str.length);
  b.writeUInt32LE(0x00000200, 0);      // STRG
  b.writeUInt16LE(str.length, 4);
  str.copy(b, 6);
  return b;
}
function uintArg(value: number, bytes: 1 | 2 | 4): Buffer {
  const tyle = bytes === 1 ? 1 : bytes === 2 ? 2 : 3;
  const b = Buffer.alloc(4 + bytes);
  b.writeUInt32LE(0x00000040 | tyle, 0); // UINT | tyle
  if (bytes === 1) b.writeUInt8(value, 4);
  else if (bytes === 2) b.writeUInt16LE(value, 4);
  else b.writeUInt32LE(value >>> 0, 4);
  return b;
}
interface MsgOpts { secs?: number; usecs?: number; ecu?: string; mcnt?: number; apid: string; ctid: string; mtin: number; args: Buffer[]; withStorage?: boolean; }
function logMsg(opts: MsgOpts): Buffer {
  const payload = Buffer.concat(opts.args);
  const ext = Buffer.alloc(10);
  const msin = 0x01 | (0 << 1) | ((opts.mtin & 0x0f) << 4); // VERB | MSTP=LOG | MTIN
  ext.writeUInt8(msin, 0);
  ext.writeUInt8(opts.args.length, 1); // NOAR
  id4(opts.apid).copy(ext, 2);
  id4(opts.ctid).copy(ext, 6);
  const htyp = 0x01 | (1 << 5); // UEH + version 1 (no WEID/WSID/WTMS, MSBF off)
  const len = 4 + ext.length + payload.length; // std(4) + ext(10) + payload
  const std = Buffer.alloc(4);
  std.writeUInt8(htyp, 0);
  std.writeUInt8(opts.mcnt ?? 0, 1);
  std.writeUInt16BE(len, 2); // LEN is big-endian
  const parts: Buffer[] = [std, ext, payload];
  if (opts.withStorage !== false) parts.unshift(storageHeader(opts.secs ?? 1700000000, opts.usecs ?? 0, opts.ecu ?? 'ECU1'));
  return Buffer.concat(parts);
}

const tmpFiles: string[] = [];
function tmp(name: string, data: Buffer): string {
  const p = path.join(os.tmpdir(), `dlt-test-${process.pid}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(p, data);
  tmpFiles.push(p);
  return p;
}
afterEach(() => { while (tmpFiles.length) { try { fs.unlinkSync(tmpFiles.pop()!); } catch { /* */ } } });

describe('dlt — isDlt detection', () => {
  it('matches the storage-header magic regardless of extension', () => {
    const head = storageHeader(1, 0, 'ECU1');
    expect(isDlt('/x/capture.bin', head)).toBe(true);
  });
  it('matches .dlt / .dlt1 / .dt1 by extension', () => {
    const empty = Buffer.alloc(0);
    expect(isDlt('/x/a.dlt', empty)).toBe(true);
    expect(isDlt('/x/a.DLT1', empty)).toBe(true);
    expect(isDlt('/x/a.dt1', empty)).toBe(true);
  });
  it('rejects a plain text file with no magic', () => {
    expect(isDlt('/x/a.txt', Buffer.from('hello world'))).toBe(false);
  });
});

describe('dlt — decodeDlt', () => {
  it('decodes ECU/APID/CTID/level/payload of a verbose LOG message', () => {
    const buf = logMsg({ apid: 'APP1', ctid: 'CTX1', mtin: 4 /* INFO */, args: [strArg('Hello')] });
    const recs: DltRecord[] = [];
    const n = decodeDlt(buf, (r) => recs.push(r));
    expect(n).toBe(1);
    expect(recs[0].ecu).toBe('ECU1');
    expect(recs[0].apid).toBe('APP1');
    expect(recs[0].ctid).toBe('CTX1');
    expect(recs[0].mtin).toBe(4);
    expect(recs[0].verbose).toBe(true);
    expect(recs[0].payload).toBe('Hello');
  });

  it('decodes multiple messages and mixed args', () => {
    const buf = Buffer.concat([
      logMsg({ apid: 'A', ctid: 'C', mtin: 2 /* ERROR */, mcnt: 1, args: [strArg('boom')] }),
      logMsg({ apid: 'B', ctid: 'D', mtin: 4 /* INFO */, mcnt: 2, args: [strArg('temp='), uintArg(42, 2)] }),
    ]);
    const recs: DltRecord[] = [];
    expect(decodeDlt(buf, (r) => recs.push(r))).toBe(2);
    expect(recs[0].payload).toBe('boom');
    expect(recs[0].mtin).toBe(2);
    expect(recs[1].payload).toBe('temp= 42');
    expect(recs[1].mcnt).toBe(2);
  });

  it('stops cleanly on a truncated tail instead of throwing', () => {
    const good = logMsg({ apid: 'A', ctid: 'C', mtin: 4, args: [strArg('ok')] });
    const buf = Buffer.concat([good, storageHeader(1, 0, 'ECU1').subarray(0, 10)]); // half a header
    const recs: DltRecord[] = [];
    expect(() => decodeDlt(buf, (r) => recs.push(r))).not.toThrow();
    expect(recs.length).toBe(1);
  });

  it('parses a message with no storage header (self-frames via LEN)', () => {
    const buf = logMsg({ apid: 'A', ctid: 'C', mtin: 5 /* DEBUG */, args: [strArg('x')], withStorage: false });
    const recs: DltRecord[] = [];
    expect(decodeDlt(buf, (r) => recs.push(r))).toBe(1);
    expect(recs[0].secs).toBeNull();
    expect(recs[0].payload).toBe('x');
  });
});

describe('dlt — formatDltRecord', () => {
  it('renders UTC time, ids, level word and payload', () => {
    const buf = logMsg({ secs: 1700000000, usecs: 123456, apid: 'APP1', ctid: 'CTX1', mtin: 4, args: [strArg('Hello world')] });
    const recs: DltRecord[] = [];
    decodeDlt(buf, (r) => recs.push(r));
    const line = formatDltRecord(recs[0]);
    expect(line).toContain('2023-11-14 22:13:20.123456');
    expect(line).toContain('ECU1');
    expect(line).toContain('APP1');
    expect(line).toContain('CTX1');
    expect(line).toContain('INFO');
    expect(line).toContain('Hello world');
  });

  it('preserves "=" (OTAF= case) and collapses embedded newlines/control chars', () => {
    const buf = logMsg({ apid: 'A', ctid: 'C', mtin: 4, args: [strArg('OTAF=5\nVOTAF\x01x')] });
    const recs: DltRecord[] = [];
    decodeDlt(buf, (r) => recs.push(r));
    const line = formatDltRecord(recs[0]);
    expect(line).toContain('OTAF=5');
    expect(line).toContain('VOTAFx');   // \x01 stripped
    expect(line).not.toMatch(/\n.+\n/); // stays a single logical line
  });
});

describe('dlt — parseDltToFile + adapter routing', () => {
  it('writes a banner, header row and one line per message', async () => {
    const src = tmp('cap.dlt', Buffer.concat([
      logMsg({ apid: 'A', ctid: 'C', mtin: 2, args: [strArg('err one')] }),
      logMsg({ apid: 'B', ctid: 'D', mtin: 4, args: [strArg('info two')] }),
    ]));
    const out = path.join(os.tmpdir(), `dlt-out-${process.pid}-${Math.random().toString(36).slice(2)}.norm`);
    tmpFiles.push(out);
    await parseDltToFile(src, out);
    const text = fs.readFileSync(out, 'utf8');
    expect(text).toContain(dltHeaderRow());
    expect(text).toContain('err one');
    expect(text).toContain('info two');
    // 1 banner + 1 header + 2 rows = 4 lines
    expect(text.split('\n').length).toBe(4);
  });

  it('pickAdapter routes a magic-headed file to the dlt adapter', () => {
    const src = tmp('capture.bin', logMsg({ apid: 'A', ctid: 'C', mtin: 4, args: [strArg('hi')] }));
    expect(pickAdapter(src).id).toBe('dlt');
  });

  it('emits the "no messages" note for a non-DLT .dlt1 file', async () => {
    const src = tmp('bogus.dlt1', Buffer.from('this is not dlt at all, just text\n'.repeat(3)));
    const out = path.join(os.tmpdir(), `dlt-out-${process.pid}-${Math.random().toString(36).slice(2)}.norm`);
    tmpFiles.push(out);
    await parseDltToFile(src, out);
    expect(fs.readFileSync(out, 'utf8')).toContain('no DLT messages decoded');
  });
});
