import { describe, it, expect } from 'vitest';
import { computePanelTokens, relativeLuminance, contrastRatio, RGB } from '../shared/panelTokens';
import { parseRgb } from '../shared/textContrast';

function lum(cssColor: string): number {
  const rgb = parseRgb(cssColor) as RGB;
  return relativeLuminance(rgb);
}
function cr(cssColor: string, bg: string): number {
  return contrastRatio(lum(cssColor), lum(bg));
}

// A spread of backgrounds the picker can produce: near-black default, pure light,
// mid grey, and saturated hues (where a plain alpha overlay used to wash out).
const BACKGROUNDS = [
  'rgba(30, 30, 30, 0.95)', // default dark
  '#ffffff',                // pure white
  '#808080',                // mid grey
  'rgb(40, 90, 200)',       // saturated blue
  '#c0392b',                // saturated red
  '#f1c40f',                // bright yellow (light + saturated)
  '#0a3d2f',                // dark saturated green
  'rgb(200, 180, 220)',     // light lavender
];

// Minimum contrast each token is designed to clear against the panel bg. Kept a
// hair below the engine's target to absorb the ±1 rounding of 8-bit channels.
const MINS: Record<string, number> = {
  '--panel-surface': 1.13,
  '--panel-surface-strong': 1.32,
  '--panel-surface-active': 1.55,
  '--panel-border': 1.82,
  '--panel-border-strong': 2.5,
};

describe('computePanelTokens — guaranteed surface/border contrast', () => {
  for (const bg of BACKGROUNDS) {
    it(`every surface & border is distinct from ${bg}`, () => {
      const t = computePanelTokens(bg);
      for (const [token, min] of Object.entries(MINS)) {
        expect(cr(t[token], bg), `${token} on ${bg}`).toBeGreaterThanOrEqual(min);
      }
    });

    it(`elevation is ordered (subtle → strong) on ${bg}`, () => {
      const t = computePanelTokens(bg);
      const chain = [
        cr(t['--panel-surface'], bg),
        cr(t['--panel-surface-strong'], bg),
        cr(t['--panel-surface-active'], bg),
        cr(t['--panel-border'], bg),
        cr(t['--panel-border-strong'], bg),
      ];
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i]).toBeGreaterThan(chain[i - 1]);
      }
    });

    it(`primary text is readable on ${bg}`, () => {
      const t = computePanelTokens(bg);
      // WCAG AA for normal text is 4.5:1; primary text clears it comfortably.
      expect(cr(t['--text-primary'], bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('elevates lighter on a dark panel, darker on a light panel', () => {
    const dark = computePanelTokens('#101010');
    expect(lum(dark['--panel-surface'])).toBeGreaterThan(lum('#101010'));

    const light = computePanelTokens('#f5f5f5');
    expect(lum(light['--panel-surface'])).toBeLessThan(lum('#f5f5f5'));
  });

  it('keeps the panel hue in its surfaces (tint/shade, not neutral grey)', () => {
    // A saturated blue panel should yield blue-dominant surfaces, not grey.
    const t = computePanelTokens('rgb(40, 90, 200)');
    const [r, g, b] = parseRgb(t['--panel-surface']) as RGB;
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('falls back gracefully on an unparseable colour', () => {
    const t = computePanelTokens('not-a-color');
    expect(t['--panel-surface']).toMatch(/^rgb\(/);
    expect(t['--text-primary']).toMatch(/^rgb\(/);
  });
});
