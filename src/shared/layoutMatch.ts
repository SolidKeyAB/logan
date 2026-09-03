// Match a freshly-analyzed file against saved column layouts, so the "Start here" card can
// offer to Apply a layout the user already saved that fits this file. Kept pure + tiny so it
// can be unit-tested and mirrored into the renderer (matchColumnLayoutLocal), which is a script
// and can't import this module. KEEP THE TWO IN SYNC.
//
// Conservative on purpose: we only claim a match when the file has a HEADER row to key on and a
// saved layout shares the same delimiter, the same column count, and at least one column name.
// Matching on count alone (no header) would false-positive across unrelated same-shape logs.

export interface LayoutMatchAnalysis {
  delimiter: string;
  columns: Array<{ name?: string }>;
}

export interface LayoutMatchCandidate {
  method?: 'delimiter' | 'pattern';
  delimiter?: string;
  columns?: Array<{ name?: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export function matchColumnLayout<T extends LayoutMatchCandidate>(
  analysis: LayoutMatchAnalysis,
  layouts: T[],
): T | null {
  const colCount = (analysis.columns || []).length;
  const headerNames = (analysis.columns || []).map(c => (c.name || '').toLowerCase()).filter(Boolean);
  if (!colCount || !headerNames.length) return null; // only match when there's a header to key on

  let best: T | null = null;
  let bestScore = 0;
  for (const l of layouts || []) {
    if (l.method !== 'delimiter' || l.delimiter !== analysis.delimiter || !Array.isArray(l.columns)) continue;
    if (l.columns.length !== colCount) continue;
    const lnames = new Set(l.columns.map(c => (c.name || '').toLowerCase()).filter(Boolean));
    const score = headerNames.filter(n => lnames.has(n)).length;
    if (score > bestScore) { bestScore = score; best = l; } // most overlapping names wins
  }
  return best;
}
