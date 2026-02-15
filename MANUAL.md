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
| Drag & drop | Drop files or folders into window to open |

### Navigation
| Shortcut | Action |
|----------|--------|
| Arrow Up/Down | Move one line |
| Page Up/Down | Move by page |
| Home / End | Jump to first / last line |
| Arrow Left/Right | Scroll horizontally |
| Shift+Scroll wheel | Horizontal scroll |

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

## Column Filtering

For structured logs (CSV, TSV, or fixed-width):
1. Click **Analyze Columns** in the search options
2. LOGAN auto-detects the delimiter and column structure
3. Toggle individual columns on/off
4. Search and display only the columns you care about

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
| `.logan/<file>.json` | Bookmarks, file-specific highlights, history (next to log file) |
| `.logan/<file>.notes.txt` | Notes for that file |
| `~/.logan/highlights.json` | Global highlights |
| `~/.logan/highlight-groups.json` | Saved highlight groups |
| `~/.logan/bookmark-sets.json` | Saved bookmark sets |
| `~/.logan/baselines.db` | Baseline snapshots (SQLite) |
| `~/.logan/redaction-rules.json` | Custom redaction rules for MCP/AI |

If the directory next to the log file is read-only, LOGAN falls back to `~/.logan/` with a keyed approach.

---

## MCP Server (AI Integration)

LOGAN exposes an MCP server for AI agents (like Claude Code) to control it programmatically:

```bash
npm run mcp
```

The AI can open files, search, filter, analyze, manage bookmarks/highlights, save/compare baselines, and navigate — all through natural language. The server communicates via stdio (MCP protocol) to LOGAN's HTTP API on localhost.

Sensitive data (IPs, emails, tokens) is automatically redacted before being sent to the AI. Custom redaction rules can be added in `~/.logan/redaction-rules.json`.
