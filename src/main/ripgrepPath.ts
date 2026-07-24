import * as fs from 'fs';

/**
 * Resolve the ripgrep binary to spawn. Prefers the binary bundled via
 * @vscode/ripgrep so search never depends on the user having ripgrep installed
 * — on a machine without a system `rg`, every search used to fall back to the
 * slow in-JS stream scan of the whole file (the "search starts indexing" hang on
 * big logcat files). Bundling makes ripgrep always available.
 *
 * In a packaged Electron app the binary lives inside app.asar, which can't be
 * executed directly — electron-builder unpacks it to app.asar.unpacked (see the
 * asarUnpack config in package.json), so we rewrite the path accordingly. Falls
 * back to a system `rg` on PATH if the bundled binary can't be resolved.
 */
let cached: string | undefined;

export function getRipgrepPath(): string {
  if (cached !== undefined) return cached;
  try {
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    // In a packaged build the binary is unpacked next to app.asar. In dev the
    // path has no "app.asar" segment, so this replace is a harmless no-op.
    const unpacked = rgPath.replace(/\bapp\.asar\b/, 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) {
      cached = unpacked;
      return cached;
    }
    if (fs.existsSync(rgPath)) {
      cached = rgPath;
      return cached;
    }
  } catch {
    // @vscode/ripgrep not installed — fall through to a system rg on PATH.
  }
  cached = 'rg';
  return cached;
}

// Test seam: reset the memoized path (used by unit tests).
export function _resetRipgrepPathCache(): void {
  cached = undefined;
}
