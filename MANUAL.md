# LOGAN User Manual

## Keyboard Shortcuts

### Files & Tabs
| Shortcut | Action |
|----------|--------|
| Ctrl+O | Open file |
| Ctrl+T | New tab |
| Ctrl+W | Close tab |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Ctrl+R | Reload current file from disk |
| Drag & drop | Drop files or folders into window to open |

### Navigation
| Shortcut | Action |
|----------|--------|
| Arrow Up/Down | Move one line |
| Page Up/Down | Move by page |
| Home / End | Jump to first / last line |
| Arrow Left/Right | Scroll horizontally |
| Shift+Scroll wheel | Horizontal scroll |
| F8 / Shift+F8 | Jump to next / previous problem (fatal/error/warning) |

### Search
| Shortcut | Action |
|----------|--------|
| Ctrl+F | Focus search box |
| Enter | Run search |
| F3 / Ctrl+G | Next result |
| Shift+F3 / Ctrl+Shift+G | Previous result |
| Ctrl+Shift+R | Toggle search results panel |

### Bookmarks & Highlights
| Shortcut | Action |
|----------|--------|
| Ctrl+B | Toggle bookmark on current line |
| Ctrl+H | Highlight selected text (all occurrences) |
| Ctrl+Shift+H | Highlight selected text (first per line) |
| Ctrl+Shift+S | Save selected lines as snippet to notes file |

### Panels
| Shortcut | Action |
|----------|--------|
| Ctrl+1 | Folders |
| Ctrl+2 | Bookmarks |
| Ctrl+3 | Highlights |
| Ctrl+4 | Statistics |
| Ctrl+5 | History |
| Ctrl+6 | Analysis (bottom) |
| Ctrl+7 | Time Gaps (bottom) |
| Ctrl+8 | Search Configs (bottom) |
| Ctrl+9 | Video Sync (bottom) |
| Ctrl+Shift+P | Live connections panel |
| Ctrl+\\ | Toggle panel visibility |
| Escape | Close active panel or modal |

### Special
| Shortcut | Action |
|----------|--------|
| Ctrl+\` | Terminal (drop-down from top) |
| Ctrl+Shift+N | Notes drawer (slide-up from bottom) |
| Ctrl+Shift+D | Diff view between two tabs |
| F7 / Shift+F7 | Next / previous diff hunk |
| Alt+Z | Toggle word wrap |
| Ctrl+Plus / Minus / 0 | Zoom in / out / reset |
| F1 | Help |

> On macOS, use Cmd instead of Ctrl.

---

## Right-Click Context Menu

Right-click any line in the log viewer for:

- **Highlight "..."** — highlight the selected text across the file
- **Include / Exclude "..."** — add selection to filter patterns
- **Distance from "..."** — open the Pattern Distance explorer seeded with the selection as the anchor (see [Pattern Distance](#pattern-distance))
- **Add Bookmark** / **Bookmark as "..."** — bookmark with optional label
- **Range from here / Range to here** — select a line range for export or review
- **Search from Ln N** — start searching from a specific line
- **Copy Line** / **Copy Selection**

---

## Search Features

Click the search options row to reveal:

- **Regex** — full regular expression support
- **Wildcard** — glob patterns (`*`, `?`)
- **Match Case** / **Whole Word**
- **Start Line** — search from a specific line number
- **Column Config** — analyze CSV/TSV structure, toggle individual column visibility, search within specific columns

LOGAN auto-detects if `ripgrep` (rg) is installed and uses it for 10-100x faster search. A badge in the status bar shows which engine is active.

---

## Filter System

The filter bar supports combining multiple criteria:

- **Include patterns** — lines must match at least one (OR)
- **Exclude patterns** — lines matching any are hidden
- **Level filter** — show only specific log levels
- **Time range** — filter by timestamp window
- **Context lines** — keep N surrounding lines around matches

### Advanced Filter
Build complex queries with groups of rules (`contains`, `not_contains`, `regex`, `level`) joined by AND/OR operators.

### Hidden Match Peek
When a filter is active and search results exist in hidden lines, a peek icon appears. Click it to see those hidden matches with surrounding context.

---

## Analysis & Baselines

### Run Analysis (Ctrl+6)
Detects crashes, errors, top failing components, and suggests filters. Click a suggestion to apply it instantly.

### Baselines
Save an analysis snapshot as a named baseline. Later, compare a different log against it to see:
- **Level shifts** — error/warning percentages changed significantly
- **New crashes** — crash keywords not present in baseline
- **Component changes** — new or missing components
- **Error rate spikes** — component error rate increased 2x or more
- **Time pattern variance** — log density changed drastically

---

## Triage on Open (Start-here pill)

When a log opens, LOGAN runs a cheap severity index and shows a **Start-here pill** in the tab bar: a coloured dot plus fatal/error/warning counts (e.g. `💥5 ⛔12 ⚠3`). Click it for a pulldown with:

- **Jump to first fatal / first error** — the fast path to the first real problem
- A **column-layout suggestion** — apply a matching saved layout, or set up a detected header
- **📋 Full brief** — run the heavier ranked briefing (crashes / worst components / time gaps) in the Analysis panel

The pill is remembered per file, so it reappears instantly on reopen. Press **F8 / Shift+F8** to walk through problems without opening the pulldown. Toggle the whole behaviour in the Features gear (*Triage on open*).

---

## Cadence / Missing Sequence

In the **Cadence** bottom tab, pick a repeating event. LOGAN auto-detects its period and flags **skipped occurrences** and **timing drift** on a negative-space strip. Click any gap to jump to where the event should have fired. Findings can be pinned. Native — no AI needed.

---

## Conclusion

The **Conclusion** bottom tab produces a one-click, native root-cause verdict: the first anomaly / trigger, a timeline, and the supporting evidence lines. Export it to `.md` or `.pdf` to share.

---

## Split & Diff View

- **Split view** — open two files side by side with synchronized scrolling
- **Diff view** (Ctrl+Shift+D) — compare current tab against the next tab, with added/removed lines color-coded
- **F7 / Shift+F7** — jump between diff hunks
- **Ctrl+PageDown / PageUp** — cycle through split files

---

## Live Connections (Ctrl+Shift+P)

Connect to up to 4 live log sources simultaneously:

### Serial
Select a USB serial port and baud rate. Incoming data is captured to a temp file and displayed live.

### Logcat (Android)
Select an ADB device, optionally set a filter pattern. Captures `adb logcat` output.

### SSH
Create or load an SSH profile, specify a remote file path to tail. Supports key-based auth with passphrase prompts. Also provides SFTP browsing to download remote files.

Each connection shows a card with a minimap preview, line count, duration, and stop/restart/save/remove controls.

---

## Notes Drawer (Ctrl+Shift+N)

A slide-up text editor for freeform notes. Auto-saves to `.logan/<filename>.notes.txt` next to the log file.

Use **Ctrl+Shift+S** (or right-click > Save Snippet) to append selected lines to the notes file.

---

## Terminal (Ctrl+\`)

A Quake-style drop-down terminal from the top of the window. Full shell access (bash/zsh) without leaving LOGAN. Resizable by dragging the bottom edge.

---

## Bookmark Sets & Highlight Groups

### Bookmark Sets
Save all current bookmarks as a named set. Load a set later to restore bookmarks — useful for switching between investigation contexts on the same file.

### Highlight Groups
Save all current highlights as a named group. Load groups to quickly apply a color scheme for a specific log format or investigation.

Both are stored globally in `~/.logan/` and available across files.

---

## Search Configs & Sessions

Save frequently-used search patterns with colors as **search configs**. Group related configs into **sessions** and batch-run them against any file. Results show colored ranges on the minimap.

- **Live progress & counts** — adding, enabling, or applying a session runs all enabled configs together and shows a progress bar (plus the full-screen overlay on large files). Each chip's found-count `(N)` ticks up **live** as matches stream in, and the progress text shows a running total (e.g. `Searching 3 configs… 45% · 12,340 found`).
- **Readable counts** — the `(N)` on each chip is a high-contrast pill, legible on any panel colour.
- **Grouped results** — the results list is one row per line; a line matched by 2+ configs shows a coloured dot per config. The list shows up to `2,000 × (active configs)` lines (capped at 10,000).
- **Export** — **Export All** writes every active config's matches to a text file next to the log.

### Pattern Distance (between two configs)

When two or more enabled configs have matches, a **📏 Distance** button appears. Pick two configs (A and B) and LOGAN measures, for each hit of A, the gap **in lines** to the nearest hit of B — answering *"do these two events travel together?"* You get:

- Gap stats: **min / median / mean / max**
- **within ≤5 / ≤20 / ≤100 lines** percentages (the narrow-down signal — a high % means they cluster)
- A **histogram** of gap ranges (same line, 1–2, 3–5 … 500+)
- The **top-20 closest co-occurrences**, each line number clickable to jump there

It's computed instantly from results already in memory — no re-search.

---

## Pattern Distance

Beyond the config-to-config tool above, you can measure distance for **any two patterns** ad hoc: select text in the log, right-click, and choose **Distance from "..."**. A dialog opens with the selection as the **anchor (A)**; type any **compare (B)** pattern (both accept regex/case toggles), pick a **direction**, and press **Measure**:

- **nearest (either side)** — closest B before or after each A
- **next after (A→B)** — the next B at or downstream of each A
- **previous before (B←A)** — the previous B at or upstream of each A

Results show the same gap stats plus a **diagram over the whole file**: anchor hits as ticks on the top lane, compare hits on the bottom lane, and a log-scaled distance curve between them (*far* up top, *near* at the bottom). **Click any point to jump** to that anchor line.

Currently line-based with a single compare pattern; measuring by timestamp and comparing against multiple patterns are planned follow-ups.

---

## Video Sync (Ctrl+9)

Drag a video file into the Video Sync panel. Set a sync point linking a log line number to a video timestamp. As you scroll the log, the video seeks to the corresponding time — useful for correlating screen recordings with log output.

---

## Datadog Integration

Fetch logs directly from Datadog into LOGAN:
1. Enter your API key and App key
2. Select your Datadog site (US1, US3, EU, or custom)
3. Write a query and choose a time range
4. Fetched logs open automatically in a new tab

---

## Columns

For structured logs (CSV, TSV, or whitespace-aligned/fixed-width), LOGAN turns rows into named columns you can shape:

1. LOGAN auto-detects the delimiter and column structure (and can auto-propose a named layout from a detected header row)
2. **Name** columns, **show/hide** them, or **mute** one to collapse it to a dimmed sliver
3. **Freeze the header** and switch to fixed-width columns; **drag** a column edge to resize (double-click to auto-fit)
4. Search and display only the columns you care about

### Column Patterns
When there's no clean delimiter, define a **column pattern** in the Column Patterns tab: grok (`%{name}`), paint-selected tokens, or a raw regex compile into a named-capture regex that drives live columns over the file.

### Column Layouts
Save a named **column layout** (per-file or as a generic template). On open, LOGAN offers to apply a matching layout from the Start-here pill; layouts also carry frozen-header and width settings.

---

## Multi-file: Single Session, Time Sync & Merge

- **Single session** (🔗) — Select 2+ open files in the Time Sync panel to combine them into **one continuous read-only view**. Nothing is written to disk; every tool (search, analysis, trends, investigate) runs across the whole set at once.
- **Time Sync** — Merge files onto a single **wall-clock timeline**, colour-tagged by source, with click-to-line — for answering "what did B log at the moment A errored?"
- **Merge to file** (⬇) — Write the full wall-clock merge to a **new file** with `<timestamp> | <origin> | <line>` columns (carry-forward for untimestamped lines).

---

## Decoding Binary & Tokenized Logs

- **Esotrace / vtrace decode** — A toolbar button force-runs the vtrace decoder on any file, producing the official byte-identical 11-column format. Recognized files also decode automatically on open.
- **Sherlog token decode** — Expand `@LOG <id> {json}` tokenized lines back into readable text. LOGAN looks for a token database next to the log, then a remembered pick, then `~/.logan/sherlog-tokens.json`; if none is found it offers a file picker. It reports how many lines it decoded so a no-op is never silent.

---

## Trends & Signals

- **Trends** (bottom tab) — **Discover** log variables (`key=value`, `key: value`, JSON), search them by name, and chart any field **over time**, as **value-flips**, or **correlated with an event**. Booleans render as a 0/1 step line. Right-click a value in the viewer for **📈 Chart over time** / **🔀 Show flips**.
- **Signals** — Overlay multiple numeric signals (including MF4 channels) on one shared time axis, with a normalize toggle and click-to-line.

---

## Saved Entities & Portable Catalogue

- **Saved panel** — One searchable, grouped panel lists every saveable entity: search configs, sessions, column layouts/patterns, highlight groups, bookmark sets, trend properties, baselines, investigations, contexts, and constants. Each row can **▶ Apply**, **↗ Open** (reveal its home panel), or **⧉ Copy**.
- **Portable catalogue** — Export your reusable global setup to a single `.logan-pack` file (optionally scrypt/AES-256-GCM encrypted) from the Saved panel, and import it on another machine. Secrets are excluded.

---

## Minimap

The vertical bar on the right edge shows a visual overview of the entire file:
- **Red** = errors, **Yellow** = warnings
- **Colored marks** = highlights, search matches, bookmarks
- **Click** to jump, **drag** to scroll
- Live connection cards show a horizontal density minimap per connection

---

## Data Storage

| Location | Contents |
|----------|----------|
| `.logan/<file>.json` | Bookmarks, file-specific highlights, annotations, history (next to log file) |
| `.logan/<file>.notes.txt` | Notes for that file |
| `.logan/<file>.agent-memory.json` | Per-file agent session scratchpad (survives reconnects) |
| `.logan/<file>.context-manifest.json` | Attached static environment (build/firmware/device/flags) |
| `.logan/reports/` | Saved Log Analysis Reports (`.md`) |
| `~/.logan/highlights.json` | Global highlights |
| `~/.logan/highlight-groups.json` | Saved highlight groups |
| `~/.logan/bookmark-sets.json` | Saved bookmark sets |
| `~/.logan/baselines.db` | Baseline snapshots (SQLite) |
| `~/.logan/sherlog-tokens.json` | Sherlog token database for `@LOG` decode |
| `~/.logan/agent-config.json` | Selected agent (Claude Code / built-in / custom script) |
| `~/.logan/redaction-rules.json` | Custom redaction rules for MCP/AI |

If the directory next to the log file is read-only, LOGAN falls back to `~/.logan/` with a keyed approach.

---

## MCP Server (AI Integration)

LOGAN exposes an MCP server (**75+ tools**) for AI agents (like Claude Code) to control it programmatically:

```bash
npm run mcp
```

The AI can open files, search, filter, analyze, discover and trend fields, investigate crashes/components/time-ranges, manage bookmarks/highlights/annotations, save/compare baselines, diff run-vs-run, attach environment context, pin findings, save reports, run and compose investigation templates, and combine files into one session — all through natural language. The server communicates via stdio (MCP protocol) to LOGAN's HTTP API on localhost. See [LOGAN-AGENT.md](LOGAN-AGENT.md) for the full tool list and API reference.

Sensitive data (IPs, emails, tokens) is automatically redacted before being sent to the AI. Custom redaction rules can be added in `~/.logan/redaction-rules.json`.
