# File-Handler Phase-2 Security Decision

**Status:** binding gate — must be satisfied before any Phase-2 file handler ships.
**Applies to:** the file-handler registry (`src/main/fileHandlers.ts`) Phase-2
handlers — user-declared shell handlers, archive extraction, esotrace
file/folder conversion, and the markdown viewer.

Phase 1 (image / video / open-log) does no IO beyond opening a path and is safe.
Phase 2 introduces three genuinely dangerous capabilities. Fable's architecture
review flagged that shipping them naively collides with the constitution — in
particular **rule 5 (parity)**, which would otherwise hand an arbitrary-code-exec
capability to the AI. This document is the written decision that must exist
*before* that code lands.

---

## 1. User-declared shell handlers (`~/.logan/handlers.json`)

A glob→shell handler ("for `*.pcap`, run `tshark -r {path}`") is, by definition,
arbitrary code execution driven by a config file.

**Decision:**

- **Human-only. Never exposed via `/api/*` or MCP.** This is an explicit, written
  **parity exemption** (per `docs/PARITY_CHECKLIST.md`): rule-5 parity would give
  the AI a shell, which it must not have. `runFileHandler` must refuse to run a
  `kind: 'external'`/shell handler when invoked from the API path.
- **Disabled by default.** Shell handlers load only when the user has explicitly
  enabled the feature (a Features-gear toggle), off on first run.
- **Confirm-on-run.** Every shell invocation shows the exact resolved command and
  requires a per-run confirmation; no "remember / don't ask again" that silently
  auto-executes.
- **Trusted-local only.** `handlers.json` is read only from `~/.logan/`; it is
  never fetched, merged from a project sidecar, or imported from an opened file.
  Treat it as source code the user owns.
- **No shell string interpolation.** Spawn with an argv array (`execFile`/`spawn`,
  `shell: false`); `{path}` is passed as a discrete argument, never concatenated
  into a shell command line.

If any of these cannot be met, the shell-handler feature does not ship.

## 2. Archive extraction (zip / tar / …)

**Threats:** zip-slip (an entry named `../../etc/passwd` escaping the extraction
dir), zip-bombs (tiny archive, enormous output), and symlink entries redirecting
writes.

**Decision — an extractor MUST:**

- Route **every** entry name through `resolveArchiveEntryPath(root, entry)` from
  `src/shared/safePath.ts` (validate + safe-join). It rejects `..` segments,
  absolute paths, drive letters, backslash traversal, and NUL bytes, and throws
  if the resolved path escapes the root. See `src/tests/safePath.test.ts`.
- Extract into a **dedicated per-archive sandbox** dir under LOGAN's cache root
  (`~/.logan/cache/…`), never directly into `os.tmpdir()`'s root and never next
  to the source file.
- Enforce **entry-count and total-byte caps** while streaming (`ARCHIVE_LIMITS`
  in `safePath.ts` as the conservative default) and abort past them — do not
  trust the archive's declared sizes.
- **Skip symlink / hardlink / device entries** — extract regular files and
  directories only.
- **Never auto-execute** extracted content; extraction produces files the user
  then opens through the normal handlers.

## 3. Markdown viewer

**Threats:** HTML/script injection and remote resource fetches from rendered
markdown.

**Decision:**

- Render in the **renderer sandbox**, not the main process. Sanitize to a safe
  subset (no `<script>`, no inline event handlers, no `javascript:` URLs) and do
  **not** fetch remote images/resources by default.
- **Split from archive extraction into its own PR** (Fable: "markdown-in-main +
  zip-slip in the same phase = split it"). They share nothing and each needs its
  own review.

---

## Phase-2 pre-flight checklist

- [ ] Shell handlers: off by default, confirm-on-run, argv (no shell string), and `runFileHandler` refuses them on the API/MCP path (written parity exemption recorded).
- [ ] Archive extraction: every entry through `resolveArchiveEntryPath`; sandbox dir; entry/byte caps enforced while streaming; symlinks skipped.
- [ ] Markdown: sandboxed + sanitized render, no remote fetch, shipped as a separate PR from archive.
- [ ] `docs/PARITY_CHECKLIST.md` updated for any new verb (counterpart or written exemption).
