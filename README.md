# LOGAN - Log Analyzer

A fast, AI-ready log file viewer built with Electron. Handles **14 million+ lines** with virtual scrolling, integrates with AI agents via MCP, connects to live serial/logcat/SSH streams, and provides deep analysis tools — all in one desktop app.

## Features

### Core Viewer
- **Virtual scrolling** — Constant memory usage and smooth 60fps, even with multi-million line files
- **Fast search** — Powered by ripgrep (10-100x faster), with regex, wildcard, whole word, and case-sensitive modes
- **Multiple tabs** — Open and switch between files without losing state
- **Minimap** — Bird's-eye overview with color-coded error/warning indicators, click to jump
- **Word wrap & zoom** — Toggle wrapping, adjust font size with Ctrl+/- or mouse wheel
- **Column visibility** — Auto-detect delimited columns and show/hide them
- **JSON auto-format** — Pretty-print JSON files on open

### AI Agent Integration
- **MCP support** — 30+ tools auto-discovered by Claude Code, Cursor, and other MCP clients via `.mcp.json`
- **Agent Chat tab** — Bidirectional messaging between LOGAN and AI agents with SSE real-time bridge
- **Built-in agent** — One-click launch from the Chat tab, handles triage/search/crash analysis/bookmarking
- **HTTP API** — Full REST API for custom agents (bash, Node.js, Python) — see [LOGAN-AGENT.md](LOGAN-AGENT.md)
- **Connection indicator** — Shows agent name and status, enforces single-agent connection
- **Custom agent scripts** — Point to your own agent via `~/.logan/agent-config.json`

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
- **Search configs** — Persistent multi-pattern search with color-coded highlighting (Ctrl+8)

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
- **Video sync** — Open a screen recording alongside logs, set a sync point, click lines to seek video (Ctrl+9)
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

```bash
git clone https://github.com/SolidKeyAB/logan.git
cd logan
npm install
npm run build
npm start
```

## AI Agent Integration

LOGAN exposes a full log-analysis API that AI agents can use. Three integration paths:

| Method | How |
|--------|-----|
| **MCP clients** (Claude Code, Cursor) | Tools auto-discovered via `.mcp.json` — just open the project |
| **Custom scripts** | Hit the HTTP API directly or use the `logan-listen` CLI helper |
| **Built-in agent** | Click "Launch Agent" in the Chat tab — no setup needed |

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
| Ctrl++ / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Ctrl+1...7 | Toggle panels (Folders/Stats/Analysis/Gaps/Bookmarks/Highlights/History) |
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
