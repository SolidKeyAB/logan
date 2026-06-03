import * as fs from 'fs';
import { FileInfo } from '../shared/types';

/**
 * Format-adapter layer (Phase 1).
 *
 * Two-layer design: a thin, format-specific SourceAdapter sits IN FRONT of the
 * existing, format-agnostic FileHandler indexer. An adapter's only job is to turn
 * its bytes into normalized UTF-8, newline-delimited text (plus an optional map
 * back to the original). Indexing, random access and search stay in FileHandler
 * and are NOT reimplemented per format.
 *
 * Plain text is a zero-overhead passthrough: TextAdapter.normalize() returns the
 * original path untouched, so the indexer reads the file directly with no copy or
 * decode step. Only non-text formats (JSONL, protobuf — Phase 3/4) produce a
 * derived normalized file.
 */

/**
 * What a format can and can't do. Lets the UI adapt (gray out live tail, prompt
 * for a schema, …) instead of failing silently on text-only assumptions.
 */
export interface AdapterCapabilities {
  /** True when the source bytes are not human-readable text (need decoding). */
  isBinary: boolean;
  /** True when appended bytes can be incrementally indexed (live tail). */
  supportsAppend: boolean;
  /** True when the format needs an external schema (e.g. a .proto/descriptor). */
  needsSchema: boolean;
  /** True when lines have a stable column structure for column filtering. */
  supportsColumnFilter: boolean;
}

/** Maps one normalized line back to a position in the original source. */
export interface LineMapEntry {
  /** Byte offset (text) or frame index (binary) in the ORIGINAL source. */
  sourceOffset: number;
}

/**
 * The product of normalizing a source: UTF-8, newline-delimited text the existing
 * FileHandler can consume unchanged.
 */
export interface NormalizedSource {
  /** Path the indexer should open. For text this IS the original path (no copy). */
  path: string;
  /** Capabilities of the originating format. */
  capabilities: AdapterCapabilities;
  /**
   * Map from normalized line index → original source position. Absent for
   * passthrough text, where normalized line N is already original line N.
   */
  lineMap?: LineMapEntry[];
  /** Release any derived/cache files. No-op (absent) for passthrough text. */
  cleanup?: () => void;
}

/**
 * A format-specific shim: the ONLY part each new file type implements. Everything
 * downstream (indexing/search/random-access) is handled by FileHandler against the
 * normalized text this returns.
 */
export interface SourceAdapter {
  /** Stable id, e.g. 'text', 'jsonl', 'protobuf'. */
  readonly id: string;
  /** Human label for the "Open as…" override menu. */
  readonly label: string;
  readonly capabilities: AdapterCapabilities;
  /** Decide whether this adapter handles the file (by extension + magic bytes). */
  detect(filePath: string, headBytes: Buffer): boolean;
  /** Produce normalized text for the indexer. */
  normalize(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<NormalizedSource>;
}

const TEXT_CAPABILITIES: AdapterCapabilities = {
  isBinary: false,
  supportsAppend: true,
  needsSchema: false,
  supportsColumnFilter: true,
};

/**
 * Plain-text passthrough and catch-all fallback. Zero overhead: normalize()
 * returns the original path so FileHandler reads the file directly — no copy, no
 * decode. Must always be the last adapter consulted (its detect() accepts
 * anything).
 */
export class TextAdapter implements SourceAdapter {
  readonly id = 'text';
  readonly label = 'Plain text';
  readonly capabilities = TEXT_CAPABILITIES;

  detect(): boolean {
    return true; // fallback — accepts anything
  }

  async normalize(filePath: string): Promise<NormalizedSource> {
    return { path: filePath, capabilities: this.capabilities };
  }
}

const textAdapter = new TextAdapter();

/**
 * Adapters in priority order, most-specific first; TextAdapter is the final
 * fallback. New formats (JsonlAdapter, ProtobufAdapter) register here ahead of
 * the text fallback.
 */
export const adapterRegistry: SourceAdapter[] = [
  // JsonlAdapter, ProtobufAdapter, … (most specific first)
  textAdapter,
];

const HEAD_BYTES = 4096;

/** Read up to the first HEAD_BYTES bytes for magic-byte detection. */
function readHead(filePath: string): Buffer {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(HEAD_BYTES, size);
    if (len === 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return buf;
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Pick the adapter for a file. With only the text fallback registered this skips
 * the head-byte read entirely (zero overhead on the common path). `forceId` is the
 * "Open as…" override and bypasses detection.
 */
export function pickAdapter(filePath: string, forceId?: string): SourceAdapter {
  if (forceId) {
    const forced = adapterRegistry.find(a => a.id === forceId);
    if (forced) return forced;
  }
  // Fast path: only the text fallback exists → no detection IO needed.
  if (adapterRegistry.length === 1) return adapterRegistry[0];

  const head = readHead(filePath);
  for (const adapter of adapterRegistry) {
    if (adapter === textAdapter) continue; // fallback checked last
    if (adapter.detect(filePath, head)) return adapter;
  }
  return textAdapter;
}

/**
 * Open a file through the adapter layer, then hand the normalized text to the
 * existing indexer. For text this is identical to `indexer.open(filePath)` with no
 * added IO. Returns both the FileInfo and the resolved NormalizedSource so callers
 * can track capabilities / lineMap and later release derived files.
 */
export async function openWithAdapter(
  indexer: { open(path: string, onProgress?: (p: number) => void): Promise<FileInfo> },
  filePath: string,
  onProgress?: (percent: number) => void,
  forceId?: string
): Promise<{ info: FileInfo; source: NormalizedSource }> {
  const adapter = pickAdapter(filePath, forceId);
  const source = await adapter.normalize(filePath, onProgress);
  const info = await indexer.open(source.path, onProgress);
  return { info, source };
}
