import { describe, it, expect } from 'vitest';
import { extractBodyLine, extractHeaderLine } from '../shared/extractFormat';

describe('extractBodyLine', () => {
  it('prefixes the 1-based original line number + tab when enabled', () => {
    expect(extractBodyLine(0, 'first line', true)).toBe('1\tfirst line');
    expect(extractBodyLine(8046, '[ERROR] boom', true)).toBe('8047\t[ERROR] boom');
  });

  it('returns the body unchanged when line numbers are off', () => {
    expect(extractBodyLine(8046, '[ERROR] boom', false)).toBe('[ERROR] boom');
  });

  it('preserves an empty body', () => {
    expect(extractBodyLine(4, '', true)).toBe('5\t');
    expect(extractBodyLine(4, '', false)).toBe('');
  });
});

describe('extractHeaderLine', () => {
  it('is a comment line summarizing the extract, with thousands separators', () => {
    const h = extractHeaderLine(1234, 5000000, 'app.log', true);
    expect(h.startsWith('# LOGAN filtered extract')).toBe(true);
    expect(h).toContain('1,234 of 5,000,000 lines');
    expect(h).toContain('source: app.log');
    expect(h).toContain('col1 = original line #');
  });

  it('omits the col1 note when line numbers are off', () => {
    expect(extractHeaderLine(10, 20, 'x.log', false)).not.toContain('col1');
  });
});
