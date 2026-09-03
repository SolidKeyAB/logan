// Readable-foreground picker — choose near-black or near-white text so that text drawn on top
// of an arbitrary user-chosen BACKGROUND colour (highlights, search-config matches, pattern
// marks) stays legible no matter the colour. Same WCAG relative-luminance + black-vs-white
// contrast maths the bottom-panel contrast tokens use (computePanelTokens), but as a small pure
// helper that also parses hex (#rgb / #rrggbb), since highlight colours come from a hex picker.

const NEAR_BLACK = '#111111';
const NEAR_WHITE = '#f2f2f2';

/** Parse a CSS colour string to [r,g,b] 0-255. Handles #rgb, #rrggbb, rgb()/rgba(). null if not. */
export function parseRgb(color: string): [number, number, number] | null {
  if (!color) return null;
  const s = color.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

/**
 * Pick the readable text colour (near-black or near-white) for a given background colour, by
 * whichever yields the higher WCAG contrast ratio. Unparseable backgrounds fall back to
 * near-black (highlight colours are usually bright). Pass custom `dark`/`light` to theme it.
 */
export function readableTextColor(bg: string, dark = NEAR_BLACK, light = NEAR_WHITE): string {
  const rgb = parseRgb(bg);
  if (!rgb) return dark;
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastBlack = (L + 0.05) / 0.05;
  return contrastBlack >= contrastWhite ? dark : light;
}
