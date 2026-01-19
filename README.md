# LOGAN - Log Analyzer

A fast, feature-rich log file viewer built with Electron.

## Features

- **Virtual scrolling** - Handle multi-million line log files smoothly
- **Fast search** - Powered by ripgrep when available
- **Multiple tabs** - Open and switch between multiple log files
- **Bookmarks** - Mark important lines with comments
- **Highlights** - Color-code patterns (per-file or global)
- **Save to Notes** - Extract code snippets for later analysis
- **Minimap** - Visual overview with error/warning indicators
- **File splitting** - Split large files into manageable parts
- **Zoom** - Adjust font size with Ctrl+/Ctrl-

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
| Ctrl+F | Find |
| F3 / Ctrl+G | Next match |
| Shift+F3 | Previous match |
| Ctrl+B | Toggle bookmark |
| Ctrl+H | Highlight selection |
| Ctrl+Shift+S | Save to notes |
| Ctrl++ | Zoom in |
| Ctrl+- | Zoom out |
| Ctrl+0 | Reset zoom |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Ctrl+W | Close tab |

## License

MIT
