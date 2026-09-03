// Column mute — COLLAPSE a whole column to a thin sliver (the column-level sibling of the
// line mute). Muting a noisy column squeezes it to ~a couple of characters wide AND dims it,
// so it recedes and reclaims horizontal space while leaving a clickable stub to unmute — a
// middle ground between full-width dim and outright hide. Like the column-hide rule
// (updateColumnHideStyle) it's one CSS rule keyed on `.log-col[data-col]`, so it toggles
// instantly with no re-render.
//
// Pure + tested here so the rule-string generation is verified headlessly; the renderer owns
// the state + the <style> element and calls this to (re)build the rule.

// Default collapsed width of a muted column, in `ch` (≈ character widths in the monospace
// viewer). 2 leaves a visible stub; 1 is tighter; 0 collapses it away entirely (≈ hide).
export const MUTED_COLUMN_WIDTH_CH = 2;

/**
 * Build the single CSS rule that collapses+dims the muted columns, or '' when none are muted.
 * Each column span is `<span class="log-col" data-col="N">`, so a muted column N is targeted
 * by `.log-col[data-col="N"]`. Clipping needs `inline-block` + `overflow:hidden`; the
 * `vertical-align` keeps the sliver on the row's baseline next to the inline (un-muted) columns.
 * NOTE: pass only VISIBLE columns — a hidden column is `display:none` and this rule's
 * `display:inline-block` must not resurrect it.
 */
export function buildColumnMuteCss(
  mutedCols: number[],
  opacity = 0.35,
  widthCh = MUTED_COLUMN_WIDTH_CH,
): string {
  const cols = Array.from(new Set(mutedCols)).filter((n) => Number.isInteger(n) && n >= 0);
  if (cols.length === 0) return '';
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  const w = Math.max(0, widthCh);
  const sel = cols.map((i) => `.log-col[data-col="${i}"]`).join(',');
  return `${sel}{display:inline-block;max-width:${w}ch;overflow:hidden;white-space:pre;vertical-align:bottom;opacity:${clampedOpacity}}`;
}
