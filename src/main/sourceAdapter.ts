import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import * as protobuf from 'protobufjs';
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

/** Stringify a JSON value for inline display (scalars bare, objects/arrays compact). */
function jsonScalar(v: unknown): string {
  return v === null || typeof v !== 'object' ? String(v) : JSON.stringify(v);
}

/**
 * Render one parsed JSON record as a single human-readable log line:
 * `<timestamp> <LEVEL> <message> key=value …`. Common fields are surfaced first
 * (so FileHandler's level detection still works); the rest follow as key=value.
 */
function formatJsonRecord(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return jsonScalar(value);
  }
  const rec = value as Record<string, unknown>;
  const used = new Set<string>();
  const pick = (keys: string[]): unknown => {
    for (const k of keys) {
      if (k in rec && !used.has(k)) { used.add(k); return rec[k]; }
    }
    return undefined;
  };
  const ts = pick(['timestamp', '@timestamp', 'time', 'ts', 'date']);
  const level = pick(['level', 'severity', 'lvl', 'loglevel']);
  const msg = pick(['message', 'msg', 'text', 'event']);

  const parts: string[] = [];
  if (ts !== undefined) parts.push(jsonScalar(ts));
  if (level !== undefined) parts.push(jsonScalar(level).toUpperCase());
  if (msg !== undefined) parts.push(jsonScalar(msg));
  for (const [k, v] of Object.entries(rec)) {
    if (used.has(k)) continue;
    parts.push(`${k}=${jsonScalar(v)}`);
  }
  return parts.join(' ');
}

/**
 * JSON Lines / NDJSON adapter. Each input line is one JSON record; normalize()
 * reformats every record into a readable log line and writes the result to a
 * derived temp file (1:1 line correspondence with the original, so line numbers
 * still line up). Lines that aren't valid JSON pass through verbatim.
 *
 * Batch decode (supportsAppend: false) — live tail re-normalization is out of
 * scope for this adapter.
 */
export class JsonlAdapter implements SourceAdapter {
  readonly id = 'jsonl';
  readonly label = 'JSON Lines (NDJSON)';
  readonly capabilities: AdapterCapabilities = {
    isBinary: false,
    supportsAppend: false,
    needsSchema: false,
    supportsColumnFilter: false,
  };

  detect(filePath: string, headBytes: Buffer): boolean {
    if (/\.(jsonl|ndjson)$/i.test(filePath)) return true;

    // Content sniff: each line must itself be a complete JSON object. A pretty-
    // printed .json file's first line is just "{" (fails to parse); a plain log
    // that merely happens to start with one JSON-looking line won't have a
    // SECOND parseable record. So require every complete sniffed line to parse,
    // and at least 2 records when the head holds more than one line.
    const isJsonObjectLine = (line: string): boolean => {
      const t = line.trim();
      if (t[0] !== '{') return false;
      try {
        const parsed = JSON.parse(t);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
      } catch {
        return false;
      }
    };

    const rawLines = headBytes.toString('utf-8').split(/\r?\n/);
    // Drop a trailing partial line (head may have been cut mid-line).
    const complete = rawLines.slice(0, Math.max(1, rawLines.length - 1));
    const nonEmpty = complete.filter(l => l.trim() !== '').slice(0, 5);
    if (nonEmpty.length === 0) return false;
    if (!nonEmpty.every(isJsonObjectLine)) return false;
    // One lone JSON line in a multi-line head is too weak a signal.
    return nonEmpty.length >= 2 || complete.filter(l => l.trim() !== '').length === 1;
  }

  async normalize(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<NormalizedSource> {
    const totalBytes = Math.max(1, fs.statSync(filePath).size);
    const outPath = path.join(
      os.tmpdir(),
      `logan-jsonl-${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}.norm`
    );

    await new Promise<void>((resolve, reject) => {
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });
      const out = fs.createWriteStream(outPath, { encoding: 'utf-8' });
      let seenBytes = 0;
      let count = 0;
      let first = true;

      rl.on('line', (line) => {
        seenBytes += Buffer.byteLength(line) + 1;
        let formatted: string;
        if (line.trim() === '') {
          formatted = '';
        } else {
          try {
            formatted = formatJsonRecord(JSON.parse(line));
          } catch {
            formatted = line; // not valid JSON — keep the raw line
          }
        }
        out.write(first ? formatted : '\n' + formatted);
        first = false;
        if (++count % 5000 === 0 && onProgress) {
          onProgress(Math.min(99, Math.round((seenBytes / totalBytes) * 100)));
        }
      });
      rl.on('error', reject);
      out.on('error', reject);
      rl.on('close', () => out.end(() => resolve()));
    });

    onProgress?.(100);
    return {
      path: outPath,
      capabilities: this.capabilities,
      cleanup: () => { try { fs.unlinkSync(outPath); } catch { /* already gone */ } },
    };
  }
}

/** Where a protobuf file's decoding schema lives. */
export interface ProtoSchemaConfig {
  /** Path to the .proto definition (absolute, or relative to the log file). */
  protoPath: string;
  /** Fully-qualified message type to decode each frame as, e.g. "mypkg.LogEntry". */
  messageType: string;
}

/**
 * Resolve the protobuf schema for a file from a sidecar `<file>.proto.json`:
 *   { "protoPath": "schema.proto", "messageType": "mypkg.LogEntry" }
 * Returns null when absent/invalid (the "Open as…" schema picker — a later UI
 * task — will write this sidecar). protoPath is resolved relative to the log file.
 */
export function resolveProtoSchema(filePath: string): ProtoSchemaConfig | null {
  const sidecar = filePath + '.proto.json';
  try {
    if (!fs.existsSync(sidecar)) return null;
    const cfg = JSON.parse(fs.readFileSync(sidecar, 'utf-8'));
    if (!cfg || typeof cfg.protoPath !== 'string' || typeof cfg.messageType !== 'string') {
      return null;
    }
    const protoPath = path.isAbsolute(cfg.protoPath)
      ? cfg.protoPath
      : path.resolve(path.dirname(filePath), cfg.protoPath);
    return { protoPath, messageType: cfg.messageType };
  } catch {
    return null;
  }
}

/**
 * Protobuf adapter. Protobuf is binary and NOT self-describing, so it needs a
 * schema (needsSchema:true) supplied via resolveProtoSchema(). The file is a
 * sequence of length-delimited frames (varint length prefix + message bytes);
 * normalize() decodes each frame with protobufjs and renders it as a readable log
 * line into a derived temp file, reusing the same field-surfacing as JSONL.
 *
 * Batch decode (supportsAppend:false). detect() claims a file only when it has a
 * protobuf-ish extension AND a resolvable schema — otherwise it falls through to
 * the text fallback (raw bytes) rather than failing the open.
 */
export class ProtobufAdapter implements SourceAdapter {
  readonly id = 'protobuf';
  readonly label = 'Protobuf (length-delimited)';
  readonly capabilities: AdapterCapabilities = {
    isBinary: true,
    supportsAppend: false,
    needsSchema: true,
    supportsColumnFilter: false,
  };

  detect(filePath: string): boolean {
    if (!/\.(pb|binpb|protobuf)$/i.test(filePath)) return false;
    return resolveProtoSchema(filePath) !== null;
  }

  async normalize(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<NormalizedSource> {
    const cfg = resolveProtoSchema(filePath);
    if (!cfg) {
      throw new Error(
        `Protobuf schema not configured for ${path.basename(filePath)} ` +
        `(expected sidecar ${path.basename(filePath)}.proto.json with protoPath + messageType)`
      );
    }
    const root = await protobuf.load(cfg.protoPath);
    const type = root.lookupType(cfg.messageType);

    const buffer = fs.readFileSync(filePath);
    const reader = protobuf.Reader.create(buffer);
    const total = Math.max(1, reader.len);

    const outPath = path.join(
      os.tmpdir(),
      `logan-protobuf-${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}.norm`
    );

    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(outPath, { encoding: 'utf-8' });
      out.on('error', reject);
      let first = true;
      let count = 0;
      const writeLine = (line: string) => {
        out.write(first ? line : '\n' + line);
        first = false;
      };
      try {
        while (reader.pos < reader.len) {
          const message = type.decodeDelimited(reader);
          const obj = type.toObject(message, {
            longs: String,
            bytes: String,
            enums: String,
            defaults: false,
          });
          writeLine(formatJsonRecord(obj));
          if (++count % 1000 === 0 && onProgress) {
            onProgress(Math.min(99, Math.round((reader.pos / total) * 100)));
          }
        }
      } catch (err) {
        // Truncated/malformed frame — surface it inline and stop decoding rather
        // than discarding the records we already recovered.
        writeLine(`[protobuf] decode stopped at byte ${reader.pos}/${reader.len}: ${String(err)}`);
      }
      out.end(() => resolve());
    });

    onProgress?.(100);
    return {
      path: outPath,
      capabilities: this.capabilities,
      cleanup: () => { try { fs.unlinkSync(outPath); } catch { /* already gone */ } },
    };
  }
}

const textAdapter = new TextAdapter();
const jsonlAdapter = new JsonlAdapter();
const protobufAdapter = new ProtobufAdapter();

/**
 * Adapters in priority order, most-specific first; TextAdapter is the final
 * fallback. New formats (ProtobufAdapter, …) register here ahead of the text
 * fallback.
 */
export const adapterRegistry: SourceAdapter[] = [
  jsonlAdapter,
  protobufAdapter,
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
  // Text is a pure passthrough — indexing drives the whole 0–100 bar as before.
  // For adapters that derive a normalized file, split the bar: normalize 0–50,
  // index 50–100, so progress stays monotonic across both phases.
  const passthrough = adapter.id === textAdapter.id;
  const normProgress = !onProgress || passthrough
    ? onProgress
    : (p: number) => onProgress(Math.round(p * 0.5));
  const openProgress = !onProgress || passthrough
    ? onProgress
    : (p: number) => onProgress(50 + Math.round(p * 0.5));

  const source = await adapter.normalize(filePath, normProgress);
  const info = await indexer.open(source.path, openProgress);
  return { info, source };
}
