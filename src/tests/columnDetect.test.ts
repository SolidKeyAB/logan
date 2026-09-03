import { describe, it, expect } from 'vitest';
import { detectDelimiter, findHeaderRow, isCommentOrBanner, MULTISPACE_DELIM } from '../shared/columnDetect';
import { splitLineIntoColumns } from '../main/fileHandler';

// The real esotrace 11-column export (banner + header + aligned data rows) — the exact shape
// that was failing before this fix.
const ESOTRACE = [
  '#----- BEGIN: 20251211_SYS_CFB_NAR.esotrace: session #0',
  'PacketID  SessionID  Label  LoggerTime               TraceTime                Channel                    Source            Level     PrivFlag    Size  Message',
  '0.18628   0   --     11.12.2025 10:38:21.686  01.01.1970 00:00:00.027  Slog2Reader.bmetrics.16388  traceserverSYS    info      --          82    [16388:1:16023:0] MPMTIMER 1069997[us',
  '0.18629   0   --     11.12.2025 10:38:21.686  01.01.1970 00:00:00.027  Slog2Reader.bmetrics.16388  traceserverSYS    info      --          37    [16388:1:16023:1] 78162[us]: PBL, End',
  '0.18630   0   --     11.12.2025 10:38:21.686  01.01.1970 00:00:00.027  Slog2Reader.bmetrics.16388  traceserverSYS    info      --          40    [16388:1:16023:2] 91556[us]: SBL1, St',
];

describe('isCommentOrBanner', () => {
  it('flags the esotrace banner, comment markers, blanks and rule lines', () => {
    expect(isCommentOrBanner('#----- BEGIN: foo.esotrace: session #0')).toBe(true);
    expect(isCommentOrBanner('// a comment')).toBe(true);
    expect(isCommentOrBanner('; ini comment')).toBe(true);
    expect(isCommentOrBanner('==========')).toBe(true);
    expect(isCommentOrBanner('   ')).toBe(true);
  });
  it('does NOT flag real data / header rows', () => {
    expect(isCommentOrBanner('PacketID  SessionID  Label')).toBe(false);
    expect(isCommentOrBanner('0.18628   0   --')).toBe(false);
  });
});

describe('detectDelimiter', () => {
  it('picks whitespace-aligned for the esotrace format (single-space over-splits)', () => {
    const lines = ESOTRACE.filter(l => !isCommentOrBanner(l));
    expect(detectDelimiter(lines).delimiter).toBe(MULTISPACE_DELIM);
  });
  it('still picks single Space for ordinary single-space logs', () => {
    const lines = [
      '12:00:01 INFO user logged in',
      '12:00:02 WARN retrying request',
      '12:00:03 ERROR connection reset by peer',
    ];
    expect(detectDelimiter(lines).delimiter).toBe(' ');
  });
  it('still picks Comma for CSV', () => {
    const lines = ['a,b,c', '1,2,3', 'x,y,z'];
    expect(detectDelimiter(lines).delimiter).toBe(',');
  });
  it('still picks Tab for TSV', () => {
    const lines = ['a\tb\tc', '1\t2\t3'];
    expect(detectDelimiter(lines).delimiter).toBe('\t');
  });
});

describe('findHeaderRow', () => {
  it('finds the esotrace header even though row 0 is a banner', () => {
    const lines = ESOTRACE.filter(l => !isCommentOrBanner(l));
    const split = lines.map(l => splitLineIntoColumns(l, MULTISPACE_DELIM));
    const r = findHeaderRow(split);
    expect(r.headerIndex).toBe(0); // banner already stripped → header is now first
    expect(r.confident).toBe(true);
    expect(r.names.slice(0, 4)).toEqual(['PacketID', 'SessionID', 'Label', 'LoggerTime']);
  });
  it('locates a header at index > 0 via type contrast when a banner is NOT stripped', () => {
    const split = ESOTRACE.map(l => splitLineIntoColumns(l, MULTISPACE_DELIM));
    const r = findHeaderRow(split);
    expect(r.headerIndex).toBe(1); // the real header row, past the banner
    expect(r.names[0]).toBe('PacketID');
  });
  it('returns no header for numeric/data-only rows', () => {
    const split = [['1', '2', '3'], ['4', '5', '6']];
    expect(findHeaderRow(split).headerIndex).toBe(-1);
  });
  it('is confident on a keyword header with type contrast below it', () => {
    const split = [
      ['time', 'level', 'message'],
      ['12:00:01', 'INFO', 'started up'],
      ['12:00:02', 'WARN', 'slow'],
    ];
    const r = findHeaderRow(split);
    expect(r.headerIndex).toBe(0);
    expect(r.confident).toBe(true);
  });
});
