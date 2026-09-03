import * as path from 'path';

// Pick candidate launch-path arguments out of process.argv, in priority order, while EXCLUDING
// Electron's own machinery. Without this, a normal dev launch — `electron . --no-sandbox`, i.e.
// `npm start` from inside the repo — mistakes the app-path argument "." for a folder-to-open, so
// LOGAN roots its Folders panel on the repo AND (if an agent is configured) auto-launches the AI
// agent to survey/triage a file the user never opened. The "." there is the APP path, not a
// user-supplied log folder.
//
// Priority:
//   1. The `--` form is explicit and always wins: everything after a standalone "--" is the
//      user's path (`electron . -- ./logs/`, `logan -- ./logs/`).
//   2. Otherwise the LAST positional arg that is not a flag, the electron binary, a node_modules
//      path, or the app directory itself.
//
// `isDefaultApp` = Electron's process.defaultApp — true when run via the `electron` binary in dev,
// where argv[1] is the app path; user args then begin at index 2 (index 1 when packaged).
// The caller stat()s each returned candidate and takes the first that is a real file/dir.
export function launchPathCandidates(
  argv: string[],
  appPath: string | null,
  isDefaultApp: boolean,
): string[] {
  const candidates: string[] = [];

  // (1) Explicit `--` path — unambiguous user intent, in both dev and packaged builds.
  const dashDashIdx = argv.indexOf('--');
  if (dashDashIdx !== -1 && dashDashIdx + 1 < argv.length && argv[dashDashIdx + 1]) {
    candidates.push(argv[dashDashIdx + 1]);
  }

  const samePath = (a: string, b: string): boolean => {
    try { return path.resolve(a) === path.resolve(b); } catch { return false; }
  };

  // (2) Fallback: last real positional. User args start at index 2 under the electron binary
  // (argv[1] = app path), else index 1 for a packaged app.
  const userArgStart = isDefaultApp ? 2 : 1;
  for (let i = argv.length - 1; i >= userArgStart; i--) {
    const arg = argv[i];
    if (!arg || arg.startsWith('-')) continue;
    if (arg.includes('electron') || arg.includes('node_modules')) continue;
    if (appPath && samePath(arg, appPath)) continue; // never the app dir itself (dev ".")
    candidates.push(arg);
  }
  return candidates;
}
