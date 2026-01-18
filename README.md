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

```bash
npm install
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
