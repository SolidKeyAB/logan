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

export function computeColumnSegments(text: string, delimiter: string): ColumnSegment[] {
  if (text.length === 0) {
    // splitLineIntoColumns: space → [] ; tab/CSV → [''] (one empty column).
    return delimiter === ' ' ? [] : [{ col: 0, start: 0, end: 0 }];
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
