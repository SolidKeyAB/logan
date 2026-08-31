// Folder-tree scanning for the left panel.
//
// The tree is LAZY: opening a folder (or expanding a subfolder) scans exactly ONE
// level — the immediate files (sniffed for type) and the immediate subdirectories.
// A subdirectory is NOT recursed into; instead it carries a cheap `hasChildren` hint
// (a shallow readdir peek) so the renderer can show a disclosure arrow and only pay
// the scan cost for branches the user actually opens. Cost is O(entries in THIS dir),
// independent of how deep or wide the subtree below is — so there is no depth cap and
// no whole-tree scan on open. Deeper levels load on expand (see the renderer's
// folder-subdir click handler and revealActiveFileInTree).

import * as path from 'path';
import * as fs from 'fs';

// Directories that are almost always noise / explosion sources — never scanned or shown.
export const FOLDER_SCAN_SKIP = new Set(['node_modules', '__pycache__', '.git', 'build', 'dist', '.next', 'target']);
const FOLDER_SCAN_PARALLEL = 16; // concurrent file sniff / dir peek operations

// Binary formats the app has a SourceAdapter for (see sourceAdapter.ts). Arbitrary
// binaries are hidden from the folder tree, but these are first-class OPENABLE files
// (they decode to text on open), so the tree must show them by extension —
// sniffFileType() only sees NUL bytes and would otherwise class them 'binary'.
// Keep this in sync with the binary adapters' detect() extensions
// (VtraceAdapter → .esotrace, Mf4Adapter → .mf4/.mdf).
const BINARY_OPENABLE_EXTENSIONS = new Set(['.esotrace', '.mf4', '.mdf']);

export interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  fileType?: 'text' | 'image' | 'video' | 'binary';
  children?: FolderEntry[];
  // Set on directories by the shallow scan: true if a one-level peek found any
  // non-hidden, non-skip-listed entry inside — i.e. the folder is worth expanding.
  hasChildren?: boolean;
}

// Classify a file by reading its first 16 bytes: image/video by magic signature,
// binary if it contains a NUL byte, otherwise text. Failure → 'binary' (unopenable).
export async function sniffFileType(filePath: string): Promise<'text' | 'image' | 'video' | 'binary'> {
  try {
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(16);
      const { bytesRead } = await fh.read(buf, 0, 16, 0);
      if (bytesRead === 0) return 'text'; // empty file is openable as text

      // --- Image signatures ---
      if (bytesRead >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image'; // PNG
      if (bytesRead >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image'; // JPEG
      if (bytesRead >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image'; // GIF
      if (bytesRead >= 2 && buf[0] === 0x42 && buf[1] === 0x4D) return 'image'; // BMP
      // RIFF container: check subtype for WebP vs AVI
      if (bytesRead >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
        if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image'; // WebP
        if (buf[8] === 0x41 && buf[9] === 0x56 && buf[10] === 0x49 && buf[11] === 0x20) return 'video'; // AVI
      }

      // --- Video signatures ---
      if (bytesRead >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video'; // MP4/MOV/M4V (ftyp box)
      if (bytesRead >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'video'; // MKV/WebM (EBML)
      if (bytesRead >= 4 && buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'video'; // OGG/OGV

      // --- Binary detection: any NUL byte in the sample means binary ---
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0x00) return 'binary';
      }
      return 'text';
    } finally {
      await fh.close();
    }
  } catch {
    return 'binary';
  }
}

// Cheap "is this folder worth an expand arrow?" peek: does it contain at least one
// non-hidden, non-skip-listed entry directly inside? Reads one directory listing and
// stops at the first hit — no stat, no sniff, no recursion. Files count by presence
// (their type is only sniffed when the folder is actually expanded), so a folder whose
// only file turns out to be an unopenable binary reports true here and then renders as
// "No supported files" on expand — an accepted, cheap approximation.
export async function dirHasVisibleEntry(dirPath: string): Promise<boolean> {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (!FOLDER_SCAN_SKIP.has(e.name)) return true;
    } else if (e.isFile()) {
      return true;
    }
  }
  return false;
}

// One level of a directory: immediate subdirectories (with a `hasChildren` hint, not
// recursed) and immediate files (sniffed for type + size, non-openable binaries dropped).
// Directories first, then alphabetical. This is the unit the lazy tree loads on open and
// on every expand.
export async function scanFolderShallow(folderPath: string): Promise<FolderEntry[]> {
  const dirEntries = await fs.promises.readdir(folderPath, { withFileTypes: true });
  const results: FolderEntry[] = [];

  // Subdirectories — no recursion; a shallow peek decides whether each is expandable.
  const subEntries = dirEntries.filter(
    (e) => e.isDirectory() && !e.name.startsWith('.') && !FOLDER_SCAN_SKIP.has(e.name),
  );
  for (let i = 0; i < subEntries.length; i += FOLDER_SCAN_PARALLEL) {
    const batch = subEntries.slice(i, i + FOLDER_SCAN_PARALLEL);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        const fullPath = path.join(folderPath, entry.name);
        let hasChildren = false;
        try {
          hasChildren = await dirHasVisibleEntry(fullPath);
        } catch {
          /* unreadable dir → treat as a leaf */
        }
        return { name: entry.name, path: fullPath, isDirectory: true, hasChildren } as FolderEntry;
      }),
    );
    results.push(...batchResults);
  }

  // Files — sniff type + size in parallel batches; drop arbitrary binaries but keep the
  // openable ones (.esotrace/.mf4/.mdf) by extension.
  const fileEntries = dirEntries.filter((e) => !e.name.startsWith('.') && e.isFile());
  for (let i = 0; i < fileEntries.length; i += FOLDER_SCAN_PARALLEL) {
    const batch = fileEntries.slice(i, i + FOLDER_SCAN_PARALLEL);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        const fullPath = path.join(folderPath, entry.name);
        try {
          const [stat, fileType] = await Promise.all([fs.promises.stat(fullPath), sniffFileType(fullPath)]);
          if (fileType === 'binary' && !BINARY_OPENABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return null;
          return { name: entry.name, path: fullPath, isDirectory: false, size: stat.size, fileType } as FolderEntry;
        } catch {
          return null;
        }
      }),
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  // Directories first, then alphabetical (case-insensitive).
  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return results;
}
