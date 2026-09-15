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
  // Surfaces "elevate" toward the same pole as the ink: lighter on dark panels,
  // darker on light panels — the direction that keeps them distinct from the bg.
  const pole: RGB = fgIsLight ? WHITE : BLACK;

  // Text shades = fg blended over the panel bg (solid, so no alpha compositing
  // surprises when text lands on an already-tinted surface).
  const textMix = (a: number): string => rgbStr(mix(bg, fg, a));

  return {
    '--panel-bg': rgbStr(bg),
    '--text-primary': textMix(1),
    '--text-secondary': textMix(0.74),
    '--text-muted': textMix(0.54),
    '--text-muted-bright': textMix(0.84),
    '--panel-fg-strong': textMix(1),
    '--panel-surface': rgbStr(surfaceAtContrast(bg, pole, Lbg, TARGETS.surface)),
    '--panel-surface-strong': rgbStr(surfaceAtContrast(bg, pole, Lbg, TARGETS.surfaceStrong)),
    '--panel-surface-active': rgbStr(surfaceAtContrast(bg, pole, Lbg, TARGETS.surfaceActive)),
    '--panel-border': rgbStr(surfaceAtContrast(bg, pole, Lbg, TARGETS.border)),
    '--panel-border-strong': rgbStr(surfaceAtContrast(bg, pole, Lbg, TARGETS.borderStrong)),
  };
}
