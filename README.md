# LOGAN - Log Analyzer

A blazing-fast log file viewer built with Electron, designed for **massive log files**. Tested and working with files up to **14 million+ lines** — virtual scrolling keeps it smooth no matter how big the file gets.

## Features

### Core Viewer
- **Virtual scrolling** — Handles multi-million line files with constant memory usage and smooth 60fps scrolling
- **Fast search** — Powered by ripgrep (10-100x faster), with regex, wildcard, whole word, and case-sensitive modes
- **Multiple tabs** — Open and switch between log files without losing state
- **Minimap** — Bird's-eye overview with color-coded error/warning indicators, click to jump
- **Word wrap & zoom** — Toggle wrapping, adjust font size with Ctrl+/- or mouse wheel
- **Column visibility** — Auto-detect delimited columns and show/hide them

### Analysis & Filtering
- **Log analysis** — Pattern detection, duplicate grouping, level distribution, and time range stats
- **Advanced filtering** — Multi-group filter expressions (AND/OR), level filters, include/exclude patterns, context lines
- **Time gap detection** — Find gaps between timestamps with configurable thresholds and line/pattern ranges
- **Search configs** — Persistent multi-pattern search with color-coded highlighting (Ctrl+8)

### Annotations
- **Bookmarks** — Mark lines with comments and colors, save/load bookmark sets, export
- **Highlights** — Color-code patterns with regex support, per-file or global, organized in groups
- **Notes drawer** — Freeform notes per file with auto-save (Ctrl+Shift+N)
- **Save snippets** — Extract selected line ranges to `.notes.txt` files for later reference

### Split & Diff
- **File splitting** — Break huge files into manageable parts
- **Split view** — View two files side by side
- **Diff view** — Compare files with aligned hunk display, additions/deletions/modifications

### Video Player
- **Log-to-video sync** — Open a screen recording alongside logs, set a sync point from any log line, then click lines to seek the video to the corresponding moment (Ctrl+9)
- **Drag & drop** — Drop MP4/WebM/OGG files directly onto the panel
- **Per-file persistence** — Video path and sync offset remembered per log file

### Integrations
- **Built-in terminal** — Quake-style drop-down terminal, auto-cds to file directory (Ctrl+`)
- **Datadog** — Fetch logs directly from Datadog APIs
- **Folder browser** — Open folders, browse files, search across multiple files
- **Activity history** — Track searches, filters, bookmarks, and other actions per file (Ctrl+7)

### Local Persistence
- Per-file `.logan/` sidecar storage for bookmarks, highlights, notes, video sync, and history
- Global `~/.logan/` for highlight groups, bookmark sets, and settings
- State survives across sessions — reopen a file and everything is restored

## Requirements

- **Node.js** 18+
- **ripgrep** (optional, but highly recommended for fast search)

### Installing ripgrep

ripgrep provides ~10-100x faster search performance.

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
# or
winget install BurntSushi.ripgrep
```

**Arch Linux:**
```bash
sudo pacman -S ripgrep
```

If ripgrep is not installed, LOGAN falls back to a stream-based search which is still faster than traditional methods.

## Installation

### Download Pre-built Packages

Download the latest release from [GitHub Releases](https://github.com/SolidKeyAB/logan/releases).

**macOS:**
- Download `LOGAN-x.x.x-arm64.dmg` (Apple Silicon) or `LOGAN-x.x.x-x64.dmg` (Intel)
- Open the DMG and drag LOGAN to Applications
- On first launch, right-click and select "Open" to bypass Gatekeeper

**Linux:**
- **AppImage:** Download `LOGAN-x.x.x.AppImage`, make executable (`chmod +x`), and run
- **Debian/Ubuntu:** Download `logan_x.x.x_amd64.deb` and install with `sudo dpkg -i logan_x.x.x_amd64.deb`

**Windows:**
- **Installer:** Download and run `LOGAN.Setup.x.x.x.exe`
- **Portable:** Download `LOGAN.x.x.x.exe` and run directly (no installation needed)

### Build from Source

```bash
git clone https://github.com/SolidKeyAB/logan.git
cd logan
npm install
npm run build
npm start
```

## Development

```bash
npm run build
npm start
```

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
| Shift+Click | Select line range |
| Right-click | Context menu (bookmark, copy, highlight) |

## License

MIT
