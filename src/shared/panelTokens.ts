// Panel theming engine — from a single panel BACKGROUND colour, derive a full set
// of contrast-guaranteed foreground + surface + border tokens.
//
// The old approach painted component surfaces as "foreground at N% alpha" (e.g.
// rgba(255,255,255,0.10)). That washes out on light / saturated / mid backgrounds:
// 10% white over a light or vivid panel is nearly invisible, so a card / input /
// button blends into the panel behind it. Here every surface is instead a SOLID
// colour whose luminance is SOLVED to hit a target WCAG contrast ratio against the
// panel background — so each surface is guaranteed visibly distinct from the panel
// it sits on, for ANY colour, while keeping the panel's hue (we tint toward pure
// white / black, i.e. a shade of the panel colour).
//
// Pure + dependency-light so it can be unit-tested (see panelTokens.test.ts) and
// shared by the renderer (applyPanelBgColor sets these as CSS custom properties).
import { parseRgb } from './textContrast';

export type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const NEAR_BLACK: RGB = [17, 17, 17];
const NEAR_WHITE: RGB = [242, 242, 242];

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0..1) of an sRGB colour. */
export function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio (1..21) between two relative luminances. */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgbStr([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

// Blend `bg` toward `pole` until the result's contrast vs `bg` reaches `target`.
// Luminance is monotonic along bg→pole, so we can binary-search the blend factor.
// If the target is unreachable (bg already near the pole) we clamp to the pole.
function surfaceAtContrast(bg: RGB, pole: RGB, Lbg: number, target: number): RGB {
  const poleLighter = relativeLuminance(pole) >= Lbg;
  // Luminance that yields exactly `target` contrast, on the reachable side.
  const wantL = clamp01(poleLighter ? target * (Lbg + 0.05) - 0.05 : (Lbg + 0.05) / target - 0.05);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const Lmid = relativeLuminance(mix(bg, pole, mid));
    // Move toward the smallest blend that reaches wantL (in the pole's direction).
    if (poleLighter ? Lmid < wantL : Lmid > wantL) lo = mid;
    else hi = mid;
  }
  return mix(bg, pole, (lo + hi) / 2);
}

// Target contrast ratios (surface / border vs the panel background). Kept subtle
// for fills (a card should read as a distinct plane, not a hard block) and firmer
// for borders (a line needs more separation to register than a filled area).
const TARGETS = {
  surface: 1.15,        // resting card / input / chip fill
  surfaceStrong: 1.35,  // hover / raised / header fill
  surfaceActive: 1.6,   // selected / pressed fill
  border: 1.9,          // dividers, control outlines
  borderStrong: 2.7,    // focus ring / emphasis outline
} as const;

/**
 * Derive the full CSS-custom-property token set for a panel painted `color`.
 * Returns a flat map of `--token` → CSS colour string; the renderer sets each on
 * the panel element so every descendant that reads `var(--token, fallback)` adapts.
 */
export function computePanelTokens(color: string): Record<string, string> {
  const bg = parseRgb(color) ?? [30, 30, 30];
  const Lbg = relativeLuminance(bg);

  // Foreground pole = whichever of near-black / near-white contrasts better as TEXT.
  const fgIsLight = contrastRatio(Lbg, relativeLuminance(NEAR_WHITE)) >= contrastRatio(Lbg, relativeLuminance(NEAR_BLACK));
  const fg: RGB = fgIsLight ? NEAR_WHITE : NEAR_BLACK;

  // BORDERS elevate toward the ink pole — the side the panel has the most luminance
  // range in — so a hairline can reach the firm border contrast targets.
  const borderPole: RGB = fgIsLight ? WHITE : BLACK;
  // FILLS (surfaces that HOLD TEXT) elevate AWAY from the ink pole, so text contrast
  // GROWS as a surface is raised instead of shrinking. If a fill went the ink-ward way
  // (as borders do), a raised card on a mid-tone panel would drift toward the ink and
  // the text on it would fall below AA — the bug that left grey/blue/red panels hard to
  // read. Fall back to the ink-ward pole ONLY when the away pole can't reach the
  // strongest fill target (a near-black / near-white panel), where the ink-ward
  // direction has ample text headroom anyway.
  const awayPole: RGB = fgIsLight ? BLACK : WHITE;
  const awayReachesFills = contrastRatio(Lbg, relativeLuminance(awayPole)) >= TARGETS.surfaceActive;
  const fillPole: RGB = awayReachesFills ? awayPole : borderPole;

  // Text shades = fg blended over the panel bg (solid, so no alpha compositing
  // surprises when text lands on an already-tinted surface).
  const textMix = (a: number): string => rgbStr(mix(bg, fg, a));

  // Compute each elevation once and reuse. Fills use fillPole (away from ink), borders
  // use borderPole (toward ink / max range) — see the pole selection above.
  const surface = rgbStr(surfaceAtContrast(bg, fillPole, Lbg, TARGETS.surface));
  const surfaceStrong = rgbStr(surfaceAtContrast(bg, fillPole, Lbg, TARGETS.surfaceStrong));
  const surfaceActive = rgbStr(surfaceAtContrast(bg, fillPole, Lbg, TARGETS.surfaceActive));
  const border = rgbStr(surfaceAtContrast(bg, borderPole, Lbg, TARGETS.border));
  const borderStrong = rgbStr(surfaceAtContrast(bg, borderPole, Lbg, TARGETS.borderStrong));
  const textPrimary = textMix(1);

  return {
    '--panel-bg': rgbStr(bg),
    '--text-primary': textPrimary,
    '--text-secondary': textMix(0.74),
    '--text-muted': textMix(0.54),
    '--text-muted-bright': textMix(0.84),
    '--panel-fg-strong': textPrimary,
    '--panel-surface': surface,
    '--panel-surface-strong': surfaceStrong,
    '--panel-surface-active': surfaceActive,
    '--panel-border': border,
    '--panel-border-strong': borderStrong,
    // ALSO override the app's core theme vars on the panel, so the MANY components
    // that reference the standard theme palette (var(--bg-primary), var(--border-color),
    // var(--bg-hover)…) re-theme automatically — without touching each rule. Without
    // this, such a component keeps the global DARK --bg-primary while its text flips to
    // the panel's contrast-picked --text-primary → dark-on-dark on a light panel.
    // Only defined on .bottom-panel, so the rest of the app is untouched.
    '--bg-primary': surface,
    '--bg-secondary': surfaceStrong,
    '--bg-tertiary': surfaceActive,
    '--bg-hover': surfaceStrong,
    '--bg-hover-subtle': surface,
    '--border-color': border,
  };
}
