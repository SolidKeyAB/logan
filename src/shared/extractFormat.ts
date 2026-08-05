// Line/header formatting for "Extract filter → file". Kept as a tiny pure module
// so it's testable (the fs streaming that uses it lives in main/index.ts, which
// can't be imported in tests without booting the app).

/**
 * One line of the extracted file. When line numbers are included, each body is
 * prefixed with its 1-based ORIGINAL line number + a tab, so an extracted line
 * maps back to the source (and col 1 is splittable by the column tools).
 * @param lineIndex0Based the source line's 0-based index (as stored internally)
 */
export function extractBodyLine(lineIndex0Based: number, body: string, includeLineNumbers: boolean): string {
  return includeLineNumbers ? `${lineIndex0Based + 1}\t${body}` : body;
}

/** Self-describing first line of the extract (a plain comment, not a #SPLIT header). */
export function extractHeaderLine(
  matchedCount: number,
  totalLines: number,
  sourceName: string,
  includeLineNumbers: boolean,
): string {
  const n = matchedCount.toLocaleString('en-US');
  const t = totalLines.toLocaleString('en-US');
  return `# LOGAN filtered extract · ${n} of ${t} lines · source: ${sourceName}${includeLineNumbers ? ' · col1 = original line #' : ''}`;
}
