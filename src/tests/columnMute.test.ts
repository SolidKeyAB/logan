import { describe, it, expect } from 'vitest';
import { buildColumnMuteCss } from '../shared/columnMute';

describe('buildColumnMuteCss', () => {
  it('returns empty string when nothing is muted', () => {
    expect(buildColumnMuteCss([])).toBe('');
  });

  it('dims a single column', () => {
    expect(buildColumnMuteCss([2])).toBe('.log-col[data-col="2"]{opacity:0.35}');
  });

  it('groups multiple muted columns into one rule', () => {
    expect(buildColumnMuteCss([0, 3])).toBe('.log-col[data-col="0"],.log-col[data-col="3"]{opacity:0.35}');
  });

  it('dedupes and drops invalid indices', () => {
    expect(buildColumnMuteCss([1, 1, -1, 2.5 as any])).toBe('.log-col[data-col="1"]{opacity:0.35}');
  });

  it('honors and clamps a custom opacity', () => {
    expect(buildColumnMuteCss([0], 0.5)).toBe('.log-col[data-col="0"]{opacity:0.5}');
    expect(buildColumnMuteCss([0], 2)).toBe('.log-col[data-col="0"]{opacity:1}');
    expect(buildColumnMuteCss([0], -1)).toBe('.log-col[data-col="0"]{opacity:0}');
  });
});
