// Column mute — dim a whole column IN PLACE (the column-level sibling of the line
// mute). Muting a column keeps it visible but de-emphasized (low opacity) so noisy
// columns recede while you read the ones that matter — no re-render, just like the
// column-hide rule (updateColumnHideStyle): one CSS rule keyed on `.log-col[data-col]`.
//
// Pure + tested here so the rule-string generation is verified headlessly; the
// renderer owns the state + the <style> element and calls this to (re)build the rule.

/**
 * Build the single CSS rule that dims the muted columns, or '' when none are muted.
 * Each column span is `<span class="log-col" data-col="N">`, so a muted column N is
 * targeted by `.log-col[data-col="N"]`.
 */
export function buildColumnMuteCss(mutedCols: number[], opacity = 0.35): string {
  const cols = Array.from(new Set(mutedCols)).filter((n) => Number.isInteger(n) && n >= 0);
  if (cols.length === 0) return '';
  const clamped = Math.max(0, Math.min(1, opacity));
  return cols.map((i) => `.log-col[data-col="${i}"]`).join(',') + `{opacity:${clamped}}`;
}
