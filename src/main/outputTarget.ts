// Where tools that WRITE an output "next to the current file" should put it — extract,
// save-selected-lines, notes, split, bookmark export. A real file (and a segmented big
// file, which is a single real file read in segments) exposes a real path we can derive a
// directory + base name from. A single-session COMPOSITE has no real path — getFileInfo()
// returns a display label like "Single session (3 files)" — so we anchor its writes to the
// directory of a representative member file and derive a filename-safe base from the label.
// Kept pure (path math only, no app state) so it's unit-testable; index.ts wraps it with
// the live composite/handler state.

import * as path from 'path';

export interface OutputTarget {
  dir: string;         // real directory to write into
  baseName: string;    // filename-safe base (no extension)
  ext: string;         // extension incl. dot (e.g. ".log"), or "" for a composite
  displayPath: string; // human-readable source shown in headers/links/notes "Source:"
}

export type OutputView =
  | { kind: 'file'; path: string }
  | { kind: 'composite'; label: string; memberPath: string };

// Turn a label into a filename-safe base: non-word runs → single "_", trimmed; never empty.
export function sanitizeBaseName(label: string): string {
  const cleaned = label.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'session';
}

export function deriveOutputTarget(view: OutputView): OutputTarget {
  if (view.kind === 'composite') {
    return {
      dir: path.dirname(view.memberPath),
      baseName: sanitizeBaseName(view.label),
      ext: '',
      displayPath: view.label,
    };
  }
  return {
    dir: path.dirname(view.path),
    baseName: path.basename(view.path, path.extname(view.path)),
    ext: path.extname(view.path),
    displayPath: view.path,
  };
}
