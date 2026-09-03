// Offset-aware column splitting for CSS-based column hiding in the viewer.
//
// splitLineIntoColumns() returns column STRINGS; to render each column as its own
// <span> (so a filtered column can be hidden with a CSS rule instead of a
// re-render) we need each column's [start,end) byte range in the ORIGINAL line,
// with the ranges TILING the whole line so the on-screen text is byte-identical.
//
// Each segment owns the text of its column PLUS the delimiter that follows it, so
// hiding a column also hides its trailing delimiter (no doubled separators). The
// column indices match splitLineIntoColumns() exactly, so a column-visibility
// config lines up with what's shown.

export interface ColumnSegment {
  col: number;   // column index (matches splitLineIntoColumns)
  start: number; // inclusive char offset in the original line
  end: number;   // exclusive char offset; segments tile [0, text.length)
}

// Multi-space (whitespace-ALIGNED) columns: a column boundary is a run of >=2 whitespace;
// single spaces stay WITHIN a cell. Returns each column's start offset in `text` (leading
// whitespace folds into the first column). Mirrors splitLineIntoColumns(line, '  '): the
// count of starts equals line.trim().split(/\s{2,}/).length.
export function multiSpaceTokenStarts(text: string): number[] {
  const starts: number[] = [];
  const n = text.length;
  let i = 0;
  while (i < n && /\s/.test(text[i])) i++; // skip leading padding
  while (i < n) {
    starts.push(i);
    // advance to the end of this token: stop at a run of >=2 whitespace, or at trailing
    // whitespace that runs to end-of-line; a lone interior space stays inside the token.
    while (i < n) {
      if (/\s/.test(text[i])) {
        let j = i;
        while (j < n && /\s/.test(text[j])) j++;
        if (j - i >= 2 || j === n) break;
        i = j; // single interior space → keep the token going
      } else {
        i++;
      }
    }
    while (i < n && /\s/.test(text[i])) i++; // skip the separator run
  }
  return starts;
}

export function computeColumnSegments(text: string, delimiter: string): ColumnSegment[] {
  if (text.length === 0) {
    // splitLineIntoColumns: space / multi-space → [] ; tab/CSV → [''] (one empty column).
    return (delimiter === ' ' || delimiter === '  ') ? [] : [{ col: 0, start: 0, end: 0 }];
  }

  if (delimiter === '  ') {
    const starts = multiSpaceTokenStarts(text);
    if (starts.length === 0) return [];
    const segs: ColumnSegment[] = [];
    for (let c = 0; c < starts.length; c++) {
      const start = c === 0 ? 0 : starts[c];
      const end = c === starts.length - 1 ? text.length : starts[c + 1];
      segs.push({ col: c, start, end });
    }
    return segs;
  }

  if (delimiter === ' ') {
    // Columns are whitespace-separated tokens (leading/trailing ws trimmed away by
    // the splitter). Each token's segment runs to the start of the NEXT token, so
    // it carries the whitespace run that follows it; the first token's segment
    // also carries any leading whitespace so the tiling starts at 0.
    const tokenStarts: number[] = [];
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (i >= text.length) break;
      tokenStarts.push(i);
      while (i < text.length && !/\s/.test(text[i])) i++;
    }
    if (tokenStarts.length === 0) return []; // all whitespace → no columns (matches trim→'')
    const segs: ColumnSegment[] = [];
    for (let c = 0; c < tokenStarts.length; c++) {
      const start = c === 0 ? 0 : tokenStarts[c];
      const end = c === tokenStarts.length - 1 ? text.length : tokenStarts[c + 1];
      segs.push({ col: c, start, end });
    }
    return segs;
  }

  if (delimiter === '\t') {
    const segs: ColumnSegment[] = [];
    let col = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\t') {
        segs.push({ col, start, end: i + 1 }); // include the tab
        col++;
        start = i + 1;
      }
    }
    segs.push({ col, start, end: text.length });
    return segs;
  }

  // CSV-style single-char delimiter, quote-aware (mirrors splitLineIntoColumns).
  const segs: ColumnSegment[] = [];
  let col = 0;
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        i++; // escaped quote inside a quoted field
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      segs.push({ col, start, end: i + 1 }); // include the delimiter
      col++;
      start = i + 1;
    }
  }
  segs.push({ col, start, end: text.length });
  return segs;
}

// Segment a line by a COMPILED PATTERN's capture groups (pattern-mode Column Layouts:
// grok / regex / paint identify columns that aren't a simple delimiter split).
//
// Same invariants as computeColumnSegments so the two render paths are interchangeable:
//  • segments TILE [0, text.length) in order — concatenating text.slice(start,end) is
//    byte-identical to the original line (nothing added or lost on screen);
//  • each column carries the "glue" text that FOLLOWS it (up to the next column), so hiding
//    a column also hides its trailing glue — no doubled/dangling separators;
//  • column index = capture-group number − 1 (so it lines up with the layout's columns).
//
// `regex` MUST be compiled with the 'd' flag (hasIndices) so per-group [start,end) is known.
// Non-matching lines (or a regex without indices) return ONE segment at col -1, which the
// hide rule never targets — so an un-columned line is rendered whole and is never hidden.
export function computeColumnSegmentsByPattern(
  text: string,
  regex: RegExp,
  fieldCount: number,
): ColumnSegment[] {
  if (text.length === 0) return [{ col: 0, start: 0, end: 0 }];

  let m: RegExpExecArray | null = null;
  try { regex.lastIndex = 0; m = regex.exec(text); } catch { m = null; }
  const indices = m ? (m as unknown as { indices?: Array<[number, number] | undefined> }).indices : undefined;
  if (!m || !indices) return [{ col: -1, start: 0, end: text.length }];

  // Collect the [start,end) of each PRESENT capture group (skip unmatched optionals).
  const groups: Array<{ col: number; start: number }> = [];
  for (let g = 1; g <= fieldCount; g++) {
    const gi = indices[g];
    if (gi) groups.push({ col: g - 1, start: gi[0] });
  }
  if (groups.length === 0) return [{ col: -1, start: 0, end: text.length }];

  // Order by position (paint/grok usually already ordered; be safe).
  groups.sort((a, b) => a.start - b.start);

  // First column's segment starts at 0 (carries any leading glue); each column runs to the
  // NEXT column's start; the last runs to end-of-line.
  const segs: ColumnSegment[] = [];
  for (let i = 0; i < groups.length; i++) {
    const start = i === 0 ? 0 : groups[i].start;
    const end = i === groups.length - 1 ? text.length : groups[i + 1].start;
    if (end > start) segs.push({ col: groups[i].col, start, end });
  }
  return segs.length ? segs : [{ col: -1, start: 0, end: text.length }];
}
