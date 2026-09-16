// VENDORED from sherlog/clients/sherlog-decode/src/index.ts — the canonical
// zero-dependency decoder core. Shared by the MCP server and main process;
// the renderer keeps a script-scope mirror (it can't import). Keep in sync.
/**
 * sherlog-decode — the portable, zero-dependency detokenizer.
 *
 * This is the CANONICAL TypeScript port of sherlog's `decode.py` + `tokens.py`.
 * It is deliberately a single self-contained module with NO imports (no Node, no
 * DOM, no third-party packages) so the exact same code runs everywhere a viewer
 * or editor can execute JS/TS:
 *
 *   • a browser context   (LOGAN's Electron renderer)
 *   • a Node context       (LOGAN's MCP server, a CLI, the VSCode extension host)
 *   • a web worker / etc.
 *
 * A tokenized log line carries only a short id + raw values; the human-readable
 * meaning lives in a token DB (a build artifact). Decoding is a pure function:
 *
 *   "@LOG a1b2c3d4 {\"user_id\":42,\"reason\":\"expired\"}"
 *     + tokenDb
 *     -> "[DEBUG] auth.py:login — user rejected | user_id=42 reason=expired"
 *
 * Keep this file in sync with sherlog's Python decoder — it is the shared wire
 * contract. If you vendor it into another project, copy it verbatim; do not fork
 * the format.
 */

/** One entry in the token DB — mirrors `TokenDB.upsert` in tokens.py. */
export interface SherlogTokenEntry {
  description: string;
  level: string;
  values: string[];
  file: string;
  function: string;
  kind: string;
}

/** The token DB shape as written by `TokenDB.save` (out/tokens.json). */
export interface SherlogTokenDb {
  version: string;
  tokens: Record<string, SherlogTokenEntry>;
}

/** Result of decoding a single line. `null` from `decodeSherlogLine` means the
 *  line is not a sherlog line at all (leave it untouched). */
export interface SherlogDecodeResult {
  /** Human-readable rendered line (what a viewer should show). */
  text: string;
  /** The token id extracted from the line. */
  id: string;
  /** Whether the id was found in the DB (false = map drift / wrong build). */
  known: boolean;
  /** The matched DB entry, when known. */
  entry?: SherlogTokenEntry;
  /** Parsed value payload (may be `{ _raw: "..." }` if the JSON was malformed). */
  values: Record<string, unknown>;
}

/**
 * Wire format: `@LOG <token-id> <optional-json-values>`
 * e.g. `@LOG a1b2c3d4 {"user_id": 42, "reason": "expired"}`
 * (Identical to the `_LINE` regex in decode.py.)
 */
const SHERLOG_LINE = /@LOG\s+([0-9a-f]{6,})\s*(\{.*\})?\s*$/;

/** Cheap predicate — does this line even look like a sherlog token line? */
export function isSherlogLine(line: string): boolean {
  return SHERLOG_LINE.test(line.trim());
}

/**
 * Coerce loaded JSON (string or already-parsed object) into a SherlogTokenDb.
 * Accepts either the full `{ version, tokens }` artifact or a bare
 * `{ <id>: entry }` map (older/hand-made DBs), so callers don't have to care.
 */
export function parseTokenDb(source: string | Record<string, unknown>): SherlogTokenDb {
  const blob: Record<string, unknown> =
    typeof source === 'string' ? JSON.parse(source) : source;
  const tokens = (blob && (blob.tokens as Record<string, SherlogTokenEntry>)) || undefined;
  if (tokens && typeof tokens === 'object') {
    return { version: String(blob.version ?? 'poc'), tokens };
  }
  // Fall back: treat the whole object as the id->entry map.
  return { version: 'poc', tokens: (blob as Record<string, SherlogTokenEntry>) ?? {} };
}

/** Render a value payload as `k=v k=v` (matches decode.py's join). */
function joinValues(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([k, v]) => `${k}=${formatScalar(v)}`)
    .join(' ');
}

function formatScalar(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Decode one line. Returns `null` if the line is not a sherlog token line
 * (so a viewer can leave non-matching lines exactly as they are).
 *
 * Output format mirrors decode.py's `decode_line`:
 *   known   -> `[LEVEL] file:function — description | k=v k=v`
 *   unknown -> `[?] unknown token <id> (map drift? wrong build) values={...}`
 */
export function decodeSherlogLine(
  line: string,
  db: SherlogTokenDb,
): SherlogDecodeResult | null {
  const m = SHERLOG_LINE.exec(line.trim());
  if (!m) return null;

  const id = m[1];
  const raw = m[2];
  let values: Record<string, unknown> = {};
  if (raw) {
    try {
      values = JSON.parse(raw);
    } catch {
      values = { _raw: raw };
    }
  }

  const entry = db.tokens[id];
  if (!entry) {
    return {
      id,
      known: false,
      values,
      text: `[?] unknown token ${id} (map drift? wrong build) values={${joinValues(values)}}`,
    };
  }

  const vals = joinValues(values);
  const loc = `${entry.file}:${entry.function}`;
  const text =
    `[${entry.level}] ${loc} — ${entry.description}` + (vals ? ` | ${vals}` : '');
  return { id, known: true, entry, values, text };
}

/**
 * Decode a whole stream, yielding only the lines that were sherlog lines
 * (mirrors decode.py's `decode_stream`). Pass `{ passthrough: true }` to also
 * emit non-sherlog lines unchanged (useful when decoding a mixed log file).
 */
export function* decodeSherlogStream(
  lines: Iterable<string>,
  db: SherlogTokenDb,
  opts: { passthrough?: boolean } = {},
): Generator<string> {
  for (const line of lines) {
    const result = decodeSherlogLine(line, db);
    if (result) yield result.text;
    else if (opts.passthrough) yield line;
  }
}
