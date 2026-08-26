import { describe, it, expect } from 'vitest';
import { computeColumnPreview } from '../main/columnPreview';
import type { ColumnPatternSpec } from '../main/columnPattern';

// The pure core behind the column-pattern preview — the "validate + refine over the
// file head" logic, extracted so it can run OFF the main thread (trend worker) without
// changing behavior. These lock the collect/cap/refine contract.

describe('computeColumnPreview — collect', () => {
  const lines = ['a=1', 'b=2', 'c=3', 'nomatch', 'd=4'];
  const spec: ColumnPatternSpec = { mode: 'regex', pattern: '(?<key>\\w+)=(?<val>\\w+)' };

  it('extracts named columns and counts matched/scanned', () => {
    const r = computeColumnPreview(lines, spec);
    expect(r.fields).toEqual(['key', 'val']);
    expect(r.named).toBe(true);
    expect(r.scanned).toBe(5);
    expect(r.matched).toBe(4);
    expect(r.rows).toEqual([['a', '1'], ['b', '2'], ['c', '3'], ['d', '4']]);
    expect(r.refined).toBe(false); // regex mode never refines
  });

  it('caps returned rows at maxRows but still counts every match', () => {
    const r = computeColumnPreview(lines, spec, { maxRows: 2 });
    expect(r.rows).toHaveLength(2);
    expect(r.matched).toBe(4);
    expect(r.scanned).toBe(5);
  });

  it('passes the compiled regex through', () => {
    expect(computeColumnPreview(lines, spec).regex).toContain('key');
  });
});

describe('computeColumnPreview — paint refine', () => {
  const sample = 'GET /abc/ 200';
  const spans = [{ start: 4, end: 9, name: 'id' }]; // "/abc/"
  const spec: ColumnPatternSpec = { mode: 'paint', sample, spans };
  const lines = ['GET /abc/ 200', 'GET /xyz/ 200', 'GET /q9/ 200'];

  it('refines from data (peels the shared /…/ wrapper) and re-extracts', () => {
    const r = computeColumnPreview(lines, spec);
    expect(r.refined).toBe(true);
    expect(r.rows[0]).toEqual(['abc']); // inner token, wrapper peeled
    expect(r.rows[1]).toEqual(['xyz']);
    expect(r.matched).toBe(3);
  });

  it('doScan=false skips the refine pass (keeps the raw painted span)', () => {
    const r = computeColumnPreview(lines, spec, { doScan: false });
    expect(r.refined).toBe(false);
    expect(r.rows[0]).toEqual(['/abc/']); // unrefined, wrapper intact
  });
});
