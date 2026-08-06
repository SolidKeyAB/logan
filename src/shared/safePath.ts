// Zip-slip / path-traversal guard for archive extraction.
//
// A malicious archive entry named "../../etc/passwd" (or an absolute path, or a
// Windows drive/UNC prefix, or one using backslash separators) can escape the
// intended extraction directory when its name is naively joined onto a root —
// the "zip-slip" class of vulnerability. Any Phase-2 archive-extraction handler
// MUST route every entry through resolveArchiveEntryPath() (validate + safe-join)
// and MUST NOT follow symlinks. See docs/FILE_HANDLER_SECURITY.md.
//
// Pure and platform-agnostic (normalizes separators before checking), so it can
// be unit-tested and reused anywhere.

import * as path from 'path';

/** True if `target` is the same as, or nested inside, `root` (after resolving). */
export function isPathInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot) return true;
  const withSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolvedTarget.startsWith(withSep);
}

/**
 * Reject archive entry names that are inherently unsafe, independent of platform.
 * Checks are done on a separator-normalized copy so a Windows-style
 * "..\\..\\x" is caught on POSIX too.
 */
export function validateArchiveEntry(entryPath: string): { ok: boolean; reason?: string } {
  if (!entryPath || typeof entryPath !== 'string') return { ok: false, reason: 'empty entry name' };
  if (entryPath.includes('\0')) return { ok: false, reason: 'NUL byte in entry name' };
  const p = entryPath.replace(/\\/g, '/');
  if (p.startsWith('/')) return { ok: false, reason: 'absolute path' };
  if (/^[a-zA-Z]:/.test(p)) return { ok: false, reason: 'drive-letter path' };
  if (p.split('/').some((seg) => seg === '..')) return { ok: false, reason: 'parent-directory (..) segment' };
  return { ok: true };
}

/**
 * Join an untrusted archive-entry path onto a trusted root, guaranteeing the
 * result stays inside root. Throws on any traversal/absolute escape. Returns the
 * absolute, normalized destination path.
 *
 * Belt-and-suspenders: even if validateArchiveEntry() is skipped, an escaping
 * entry still resolves outside root and is rejected here.
 */
export function safeJoin(root: string, entryPath: string): string {
  const resolvedRoot = path.resolve(root);
  const dest = path.resolve(resolvedRoot, entryPath);
  if (!isPathInside(resolvedRoot, dest)) {
    throw new Error(`Unsafe archive entry escapes extraction root: ${entryPath}`);
  }
  return dest;
}

/**
 * The one call an extractor should use per entry: validate the name, then
 * safe-join it onto root. Throws with a clear reason on anything unsafe.
 */
export function resolveArchiveEntryPath(root: string, entryPath: string): string {
  const check = validateArchiveEntry(entryPath);
  if (!check.ok) {
    throw new Error(`Unsafe archive entry (${check.reason}): ${entryPath}`);
  }
  return safeJoin(root, entryPath);
}

/**
 * Conservative default caps to bound a zip-bomb (extractors should enforce these
 * or stricter). Not a substitute for streaming with a running-total guard.
 */
export const ARCHIVE_LIMITS = {
  /** Max number of entries to extract from a single archive. */
  maxEntries: 50_000,
  /** Max total uncompressed bytes to write from a single archive (2 GiB). */
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
} as const;
