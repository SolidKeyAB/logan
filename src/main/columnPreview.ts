// Column-pattern preview — the pure "validate + refine over candidate lines" core.
//
// Split out of the main-process IPC handler so the SAME logic runs in two places:
//   • off-thread in the trend worker (kind:'columnPreview') for the heavy
//     "✓ Test over file" / Save path — a whole scan of the file head + a
//     (possibly backtracking) regex must never block the Electron UI thread; and
//   • on the main thread for the cheap live-painting path (a single sample line,
//     no file read) and the segmented-file fallback.
//
// Pure (no fs / electron / worker) so the collect + refine semantics stay
// unit-testable headlessly. The caller gathers the candidate lines (the user's
// sample first, then the file head); this compiles, extracts, and — in paint mode —
// refines each column's constant wrapper from the extracted values and re-extracts.

import {
  compileColumnPattern,
  makeColumnExtractor,
  refinePaintPattern,
  type CompiledColumnPattern,
  type ColumnPatternSpec,
} from './columnPattern';

export interface ColumnPreviewResult {
  regex: string;
  flags: string;
  fields: string[];
  named: boolean;
  rows: string[][];
  matched: number;
  scanned: number;
  refined: boolean;
}

export interface ColumnPreviewOpts {
  maxRows?: number;   // cap the returned preview rows (N). Default 200.
  doScan?: boolean;   // run the ✨ refine-from-data pass (paint mode). Default true.
}

/**
 * Compile `spec`, extract columns from every candidate line, and — for paint mode
 * with enough matches — refine each column's constant wrapper and re-extract.
 * Deterministic and side-effect-free; identical to the pre-extraction main-thread
 * logic so moving it off-thread changes nothing but WHERE it runs.
 */
export function computeColumnPreview(
  sampleLines: string[],
  spec: ColumnPatternSpec,
  opts: ColumnPreviewOpts = {},
): ColumnPreviewResult {
  const N = opts.maxRows ?? 200;
  const doScan = opts.doScan !== false;

  const collect = (compiled: CompiledColumnPattern) => {
    const extractor = makeColumnExtractor(compiled);
    const rows: string[][] = [];
    let matched = 0;
    let scanned = 0;
    for (const text of sampleLines) {
      scanned++;
      const vals = extractor(text);
      if (vals) { matched++; if (rows.length < N) rows.push(vals); }
    }
    return { rows, matched, scanned };
  };

  let compiled = compileColumnPattern(spec);
  let { rows, matched, scanned } = collect(compiled);

  // ✨ Refine from data (paint mode): peel each column's shared constant wrapper
  // (/…/, xx…xx, …blah…) from the extracted values, re-compile, and re-extract.
  let refined = false;
  if (doScan && spec.mode === 'paint' && rows.length >= 2 && compiled.fields.length > 0) {
    const fieldSamples = compiled.fields.map((_f, ci) => rows.map((r) => r[ci]).filter(Boolean));
    const refinedCompiled = refinePaintPattern(spec, fieldSamples);
    if (refinedCompiled.regex !== compiled.regex) {
      compiled = refinedCompiled;
      ({ rows, matched, scanned } = collect(compiled));
      refined = true;
    }
  }

  return {
    regex: compiled.regex,
    flags: compiled.flags,
    fields: compiled.fields,
    named: compiled.named,
    rows,
    matched,
    scanned,
    refined,
  };
}
