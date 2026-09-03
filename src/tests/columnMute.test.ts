import { describe, it, expect } from 'vitest';
import { buildColumnMuteCss, MUTED_COLUMN_WIDTH_CH } from '../shared/columnMute';

// A muted column is collapsed to a thin sliver AND dimmed via one rule per column.
const decl = (opacity = 0.35, w = MUTED_COLUMN_WIDTH_CH) =>
  `{display:inline-block;max-width:${w}ch;overflow:hidden;white-space:pre;vertical-align:bottom;opacity:${opacity}}`;

describe('buildColumnMuteCss', () => {
  it('returns empty string when nothing is muted', () => {
    expect(buildColumnMuteCss([])).toBe('');
  });

  it('collapses + dims a single column', () => {
    expect(buildColumnMuteCss([2])).toBe(`.log-col[data-col="2"]${decl()}`);
  });

  it('groups multiple muted columns into one rule', () => {
    expect(buildColumnMuteCss([0, 3])).toBe(`.log-col[data-col="0"],.log-col[data-col="3"]${decl()}`);
  });

  it('dedupes and drops invalid indices', () => {
    expect(buildColumnMuteCss([1, 1, -1, 2.5 as any])).toBe(`.log-col[data-col="1"]${decl()}`);
  });

  it('honors and clamps a custom opacity', () => {
    expect(buildColumnMuteCss([0], 0.5)).toBe(`.log-col[data-col="0"]${decl(0.5)}`);
    expect(buildColumnMuteCss([0], 2)).toBe(`.log-col[data-col="0"]${decl(1)}`);
    expect(buildColumnMuteCss([0], -1)).toBe(`.log-col[data-col="0"]${decl(0)}`);
  });

  it('honors a custom collapsed width (incl. 0 = collapse away entirely)', () => {
    expect(buildColumnMuteCss([0], 0.35, 1)).toBe(`.log-col[data-col="0"]${decl(0.35, 1)}`);
    expect(buildColumnMuteCss([0], 0.35, 0)).toBe(`.log-col[data-col="0"]${decl(0.35, 0)}`);
  });
});
