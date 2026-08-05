// File-handler registry — the plugin seam for "what can LOGAN DO with a clicked
// file/folder?". This sits ABOVE the SourceAdapter layer (sourceAdapter.ts),
// which answers only the single "turn bytes INTO a log" action. Here each
// handler declares how it MATCHES an entry and what ACTION it produces, so the
// double-click default and the right-click menu are both driven by one registry
// — and the same runFileHandler() entry point can later back an MCP tool, giving
// the AI the identical actions ("same instrument, two operators").
//
// Phase 1 folds the existing hardcoded click dispatch (open-as-log / video /
// image, previously an if/else in the renderer) into the registry with ZERO
// behaviour change: matching reuses the fileType already sniffed during the
// folder scan (see sniffFileType in index.ts), so nothing is re-classified.
// New handlers (markdown viewer, archive extraction, esotrace file/folder
// conversion, user-declared handlers) are added by appending to the registry.

export type FileHandlerKind = 'open-log' | 'viewer' | 'transform' | 'folder' | 'external';

/** Wire-safe descriptor of a handler for the menu (no functions). */
export interface FileHandlerInfo {
  id: string;
  label: string;
  icon?: string;
  kind: FileHandlerKind;
  /** True for the top-priority handler — the double-click default. */
  isDefault: boolean;
}

/**
 * Wire-safe result of running a handler: what the renderer should do next. Kept
 * as a flat, structural shape (not a discriminated union) so it crosses IPC and
 * mirrors cleanly on the renderer side.
 */
export interface FileHandlerResult {
  action: 'open-log' | 'open-panel' | 'open-folder' | 'toast';
  path?: string;
  panel?: 'video' | 'image' | 'markdown';
  /** "Open as…" adapter override for open-log (Phase 2). */
  forceAdapterId?: string;
  message?: string;
  level?: 'info' | 'error';
}

/** What a caller (renderer click or MCP) knows about the entry being acted on. */
export interface FileHandlerQuery {
  path: string;
  isDirectory?: boolean;
  /** The fileType sniffed during the folder scan; avoids re-classifying. */
  fileType?: 'text' | 'image' | 'video' | 'binary';
}

/** Resolved match context handed to each handler's match()/run(). */
export interface FileHandlerContext {
  path: string;
  /** Lower-case extension without the dot ('' if none). */
  ext: string;
  isDirectory: boolean;
  fileType: 'text' | 'image' | 'video' | 'binary' | 'unknown';
}

/** A handler: the ONLY thing each file capability implements. */
export interface FileActionHandler {
  id: string;
  label: string;
  icon?: string;
  kind: FileHandlerKind;
  /** Higher wins as the double-click default and sorts first in the menu. */
  priority: number;
  /** Cheap predicate over path signals — no IO. */
  match(ctx: FileHandlerContext): boolean;
  /** Produce the action descriptor. May do work (Phase 2 transforms). */
  run(ctx: FileHandlerContext): FileHandlerResult | Promise<FileHandlerResult>;
}

function extOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() || filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function toContext(query: FileHandlerQuery): FileHandlerContext {
  return {
    path: query.path,
    ext: extOf(query.path),
    isDirectory: query.isDirectory ?? false,
    fileType: query.fileType ?? 'unknown',
  };
}

// ── Built-in handlers (Phase 1) ─────────────────────────────────────────────
// These reproduce the previous dblclick dispatch exactly. Media match on the
// already-sniffed fileType; open-log is the low-priority catch-all for any file,
// which also means media files gain a right-click "Open as log" alternative.

const imageHandler: FileActionHandler = {
  id: 'image', label: 'Open in Image Viewer', icon: '🖼', kind: 'viewer', priority: 80,
  match: (ctx) => !ctx.isDirectory && ctx.fileType === 'image',
  run: (ctx) => ({ action: 'open-panel', panel: 'image', path: ctx.path }),
};

const videoHandler: FileActionHandler = {
  id: 'video', label: 'Open in Video Player', icon: '🎬', kind: 'viewer', priority: 80,
  match: (ctx) => !ctx.isDirectory && ctx.fileType === 'video',
  run: (ctx) => ({ action: 'open-panel', panel: 'video', path: ctx.path }),
};

const openLogHandler: FileActionHandler = {
  id: 'open-log', label: 'Open as log', icon: '📄', kind: 'open-log', priority: 10,
  match: (ctx) => !ctx.isDirectory, // catch-all for any file (SourceAdapter picks the decoder on open)
  run: (ctx) => ({ action: 'open-log', path: ctx.path }),
};

// Registry order is not significant — resolveFileHandlers sorts by priority.
const fileHandlerRegistry: FileActionHandler[] = [imageHandler, videoHandler, openLogHandler];

/**
 * All handlers that match the entry, highest-priority first; the first is flagged
 * isDefault (the double-click action). Returns [] for a directory with no folder
 * handler registered (Phase 1 has none).
 */
export function resolveFileHandlers(query: FileHandlerQuery): FileHandlerInfo[] {
  const ctx = toContext(query);
  const matched = fileHandlerRegistry
    .filter((h) => {
      try { return h.match(ctx); } catch { return false; }
    })
    .sort((a, b) => b.priority - a.priority);
  return matched.map((h, i) => ({
    id: h.id, label: h.label, icon: h.icon, kind: h.kind, isDefault: i === 0,
  }));
}

/** Run one handler by id and return the action descriptor for the renderer. */
export async function runFileHandler(id: string, query: FileHandlerQuery): Promise<FileHandlerResult> {
  const handler = fileHandlerRegistry.find((h) => h.id === id);
  if (!handler) return { action: 'toast', message: `Unknown file handler: ${id}`, level: 'error' };
  const ctx = toContext(query);
  try {
    return await handler.run(ctx);
  } catch (e) {
    return { action: 'toast', message: `${handler.label} failed: ${String(e)}`, level: 'error' };
  }
}

/** Exposed for tests. */
export const __testables = { fileHandlerRegistry, extOf, toContext };
