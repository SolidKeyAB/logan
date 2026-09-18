# LOGAN - Log Analyzer

A fast, AI-ready log file viewer built with Electron. Handles **tens of millions of lines** with virtual scrolling, integrates with AI agents via MCP (**75+ tools**), connects to live serial/logcat/SSH streams, decodes binary/tokenized formats, and provides deep analysis and correlation tools — all in one desktop app.

## TL;DR

**Download and run** — grab the latest build from [GitHub Releases](https://github.com/SolidKeyAB/logan/releases):

| Platform | File |
|----------|------|
| Linux | `.AppImage` or `.deb` |
| Windows | `LOGAN.Setup.x.x.x.exe` |

**Build from source:**

```bash
git clone https://github.com/SolidKeyAB/logan.git
cd logan
npm install
npm start
```

> Linux only: `sudo apt install -y build-essential cmake python3` before `npm install`.

---

## Features

### Core Viewer
- **Virtual scrolling** — Constant memory usage and smooth 60fps, even on files with tens of millions of lines
- **Fast search** — Powered by ripgrep (10-100x faster), with regex, wildcard, whole word, and case-sensitive modes
- **Multiple tabs** — Open and switch between files without losing state
- **Minimap** — Bird's-eye overview with color-coded error/warning indicators, click to jump
- **Jump to problem** — A cheap severity index lets you leap to the next/previous fatal/error/warning with **F8 / Shift+F8**, even on huge files
- **Start-here pill** — On open, a severity pill appears in the tab bar (fatal/error/warning counts) with a pulldown that jumps to the first problem, suggests a column layout, and opens the full brief — remembered per file
- **Word wrap & zoom** — Toggle wrapping, adjust font size with Ctrl+/- or mouse wheel
- **Columns panel** — Auto-detect delimited/whitespace-aligned columns; name them, show/hide/mute, freeze the header, drag-to-resize, and save reusable **column layouts** and **column patterns** (grok/regex)
- **Summarize & fold** — Collapse repeating vertical blocks into foldable regions to compress a noisy log while keeping its meaning
- **JSON auto-format** — Pretty-print JSON files on open

### AI Agent Integration
- **Setup Wizard** — Guided setup: auto-detects Claude Code CLI and configures the agent connection
- **MCP support** — **75+ tools** auto-discovered by Claude Code, Cursor, and other MCP clients via `.mcp.json`
- **Agent Chat tab** — Bidirectional messaging between LOGAN and AI agents with SSE real-time bridge
- **Claude Code integration** — Launch Claude Code directly from LOGAN with full MCP tool access
- **Built-in agent** — One-click launch from the Chat tab, handles triage/search/crash analysis/bookmarking
- **HTTP API** — Full REST API for custom agents (bash, Node.js, Python) — see [LOGAN-AGENT.md](LOGAN-AGENT.md)
- **Connection indicator** — Shows agent name and status, enforces single-agent connection
- **Custom agent scripts** — Point to your own agent via `~/.logan/agent-config.json`
- **Interrupt (⏹ Stop)** — Stop the agent's current task without killing the session; it acknowledges and goes back to waiting
- **Findings & reports** — The agent pins clickable findings in the viewer (`logan_report_finding`), hands off a whole batch for you to tick through (`logan_import_findings`), and saves a Jira-ready **Log Analysis Report** (`logan_save_report`)
- **Evidence pack** — One compact briefing (severity, crashes, components, discovered fields, filter hints, optional baseline delta) instead of dozens of exploratory calls (`logan_evidence_pack`)
- **Logs + environment** — Attach the static capture context (build id, firmware, device, feature flags) as typed facts that auto-inject into briefings and baselines (`logan_context_attach`)
- **Session memory** — A per-file scratchpad the agent writes so it can resume after a reconnect (`logan_memory_read`/`logan_memory_write`)
- **Agent-driven charts** — The agent can render trend charts straight into the Trends panel (`logan_trend_show`)
- **Investigation patterns** — The agent's investigative steps are recorded and can be saved as named, re-runnable, composable templates with requirement pre-flighting (see [docs/INVESTIGATION_TEMPLATES.md](docs/INVESTIGATION_TEMPLATES.md))
- **Run-vs-run diff** — Semantic template diff of a failing run against a last-known-good one — what shapes are new, vanished, or shifted (`logan_diff_runs`)

### Live Connections
- **Serial monitor** — Connect to serial ports with auto-device discovery
- **Android logcat** — Stream logcat output with device listing
- **SSH shell** — Remote log tailing via SSH with key/password auth
- **Datadog** — Fetch logs directly from Datadog APIs
- **Multi-connection** — Up to 4 parallel connections, each with its own live card and density minimap
- **Session recording** — Save live sessions to file for later analysis
- **SSH profiles** — Save, load, and manage connection profiles; auto-import from `~/.ssh/config`
- **SFTP browser** — Browse and download remote files

### Analysis & Filtering
- **Log analysis** — Pattern detection, duplicate grouping, level distribution, and time range stats
- **Context Search** — Define multi-pattern contexts (must + clue patterns) with proximity-based correlation for root cause analysis; tree view and timeline density bar
- **Advanced filtering** — Multi-group filter expressions (AND/OR), level filters, include/exclude patterns, context lines
- **Time gap detection** — Find gaps between timestamps with configurable thresholds
- **Crash investigation** — Deep-dive into crash sites with surrounding context and auto-bookmarking
- **Component analysis** — Investigate a specific component's health across the log
- **Time-range analysis** — Focus on a specific time window
- **Baseline comparison** — Save log fingerprints and compare future logs against them to detect regressions
- **Search configs** — Persistent multi-pattern search with color-coded highlighting, batched with live progress and per-config found-counts (Ctrl+8)
- **Pattern distance** — Measure how far two patterns sit from each other (line gaps): between two search configs, or ad hoc via right-click → *Distance from "..."* with an over-the-log diagram and click-to-jump
- **Trends** — Discover log variables (key=value/JSON), search them by name, and chart any field over time, as value-flips, or correlated with an event; booleans chart as a 0/1 step line
- **Signals** — Overlay multiple numeric signals (including MF4 channels) on one shared time axis with normalize toggle and click-to-line
- **Cadence / missing-sequence** — Pick a repeating event, auto-detect its period, and flag skipped occurrences and drift with a negative-space strip and click-to-line
- **Recipes** — Save the agent's investigation steps as named, re-runnable recipes; replay one on any log to search, trend, and pin clickable findings in one click

### Multi-file & Correlation
- **Single session** — Combine several open files into one continuous read-only view (no on-disk merge) so every tool runs across the set at once
- **Time Sync** — Merge 2+ files onto one wall-clock timeline, colour-tagged by source, with click-to-line — and optionally **merge to file** for a materialized interleaved log
- **Run-vs-run diff** — Fold two runs into message templates and set-diff them: new shapes, vanished shapes, and frequency shifts between a failing run and a good one
- **Compare & baseline** — Side-by-side diff view, plus fingerprint baselines to catch regressions across runs

### Decoding & Formats
- **Esotrace / vtrace decode** — Byte-identical decode of binary vtrace logs into the official 11-column format, on demand from the toolbar or auto-detected on open
- **Sherlog token decode** — Expand `@LOG <id> {json}` tokenized lines back into readable text using a discoverable token database
- **Column patterns** — Grok (`%{name}`) / paint-tokens / raw-regex → a compiled named-capture regex that drives live columns over any format

### Saved setup & portability
- **Saved panel** — Every saveable entity (search configs, sessions, column layouts/patterns, highlight groups, bookmark sets, trend properties, baselines, investigations, contexts, constants) is enumerable in one searchable panel — apply, reveal, or copy each
- **Portable catalogue** — Export your reusable global setup to a single `.logan-pack` file (optionally encrypted) and import it on another machine

### Annotations
- **Bookmarks** — Mark lines with comments and colors, save/load bookmark sets, export
- **Highlights** — Color-code patterns with regex support, per-file or global, organized in groups
- **Notes drawer** — Freeform notes per file with auto-save and Save-As (Ctrl+Shift+N)
- **Save snippets** — Extract selected line ranges to `.notes.txt` files

### Split & Diff
- **File splitting** — Break huge files into manageable parts
- **Split view** — View two files side by side
- **Diff view** — Compare files with aligned hunk display, additions/deletions/modifications

### Media
- **Video sync** — Open a screen recording alongside logs, set a sync point, click lines to seek video (Ctrl+9). Plays MP4/WebM/Ogg directly; AVI/MKV/WMV are auto-converted to MP4 via ffmpeg (cached per file)
- **Image viewer** — View PNG, JPG, SVG images with zoom in the bottom panel

### Built-in Tools
- **Tabbed terminal** — Quake-style drop-down with multiple shells and SSH sessions (Ctrl+`)
- **Folder browser** — Open folders, browse files, search across multiple files
- **Activity history** — Track searches, filters, bookmarks, and other actions per file (Ctrl+7)

### Persistence
- Per-file `.logan/` sidecar storage for bookmarks, highlights, notes, video sync, and history
- Global `~/.logan/` for highlight groups, bookmark sets, baselines, and settings
- State survives across sessions — reopen a file and everything is restored

## Requirements

- **Node.js** 18+
- **ripgrep** (optional, recommended for fast search)

### Installing ripgrep

**macOS:**
```bash
brew install ripgrep
```

**Ubuntu/Debian:**
```bash
sudo apt install ripgrep
```

**Windows:**
```bash
choco install ripgrep
```

**Arch Linux:**
```bash
sudo pacman -S ripgrep
```

If ripgrep is not installed, LOGAN falls back to a stream-based search.

## Installation

### Download Pre-built Packages

Download the latest release from [GitHub Releases](https://github.com/SolidKeyAB/logan/releases).

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | `LOGAN-x.x.x-arm64.dmg` |
| **macOS** (Intel) | `LOGAN-x.x.x-x64.dmg` |
| **Linux** (AppImage) | `LOGAN-x.x.x.AppImage` |
| **Linux** (Debian) | `logan_x.x.x_amd64.deb` |
| **Windows** (Installer) | `LOGAN.Setup.x.x.x.exe` |
| **Windows** (Portable) | `LOGAN.x.x.x.exe` |

### Build from Source

**Linux (Debian/Ubuntu) prerequisites** — needed for native modules (`node-pty`, `better-sqlite3`):

```bash
sudo apt update
sudo apt install -y build-essential cmake python3
```

Then build:

```bash
git clone https://github.com/SolidKeyAB/logan.git
cd logan
npm install
npm start        # builds and launches LOGAN
```

To package a distributable binary for your platform:

```bash
npm run package          # macOS
npm run package:win      # Windows
npm run package:linux    # Linux
npm run package:all      # all platforms
```

### CLI Command

Register the `logan` command globally (one-time, after install):

```bash
npm link
```

Then open log files from any terminal:

```bash
logan myfile.log                # launch LOGAN with file
logan /path/to/other.log        # open in existing window if LOGAN is running
logan                           # launch LOGAN with no file
```

If LOGAN is already running, the file opens in the existing window. If not, a new instance launches with the file.

## AI Agent Integration

LOGAN exposes a full log-analysis API that AI agents can use. Four integration paths:

| Method | How |
|--------|-----|
| **Claude Code** (recommended) | Click "Launch Agent" → Setup Wizard auto-detects CLI and configures MCP |
| **MCP clients** (Cursor, Windsurf) | Tools auto-discovered via `.mcp.json` — just open the project |
| **Custom scripts** | Hit the HTTP API directly or use the `logan-listen` CLI helper |
| **Built-in agent** | Click "Launch Agent" → select "Built-in Agent" — no setup needed |

### Quick Start: Agent Setup Wizard

1. Open the **Chat tab** (bottom panel, chat icon)
2. Click **Launch Agent** (or the gear icon next to it)
3. The wizard auto-detects available tools (Claude Code CLI, etc.)
4. Choose your agent type and click **Save & Launch**

The wizard saves configuration to `~/.logan/agent-config.json`. Subsequent launches skip the wizard.

See [LOGAN-AGENT.md](LOGAN-AGENT.md) for the full API reference, example scripts, and integration guide.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+O | Open file |
| Ctrl+T | Open in new tab |
| Ctrl+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+F | Focus search |
| F3 / Ctrl+G | Next match |
| Shift+F3 | Previous match |
| Ctrl+B | Toggle bookmark |
| Ctrl+H | Highlight all occurrences of selection |
| Ctrl+Shift+H | Highlight first occurrence per line |
| Ctrl+Shift+S | Save selected lines to notes |
| F8 / Shift+F8 | Jump to next / previous problem (fatal/error/warning) |
| PageDown / PageUp | Scroll one full page |
| Ctrl+D / Ctrl+U | Half page down / up (Mac-friendly) |
| Option+Down / Option+Up | Fast scroll (5 lines at a time) |
| Ctrl++ / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Ctrl+R | Reload current file from disk |
| Ctrl+1...5 | Toggle sidebar panels (Folders / Bookmarks / Highlights / Stats / History) |
| Ctrl+6 / Ctrl+7 | Toggle Analysis / Time Gaps (bottom) |
| Ctrl+8 | Toggle search configs |
| Ctrl+9 | Toggle video player |
| Ctrl+\ | Toggle panel visibility |
| Ctrl+` | Toggle terminal |
| Ctrl+Shift+N | Toggle notes drawer |
| Ctrl+Shift+R | Toggle search results |
| Alt+Z | Toggle word wrap |
| Esc | Close active panel/overlay |

## License

MIT
