import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import * as pty from 'node-pty';
import { FileHandler } from './fileHandler';
import { IPC, SearchOptions, Bookmark, Highlight } from '../shared/types';
import { analyzerRegistry, AnalyzerOptions } from './analyzers';

let mainWindow: BrowserWindow | null = null;
let searchSignal: { cancelled: boolean } = { cancelled: false };
let currentFilePath: string | null = null;

// Filter state - maps file path to array of visible line indices
const filterState = new Map<string, number[] | null>();

function getFilteredLines(): number[] | null {
  if (!currentFilePath) return null;
  return filterState.get(currentFilePath) || null;
}

// Cache FileHandlers by path to avoid re-indexing when switching tabs
const fileHandlerCache = new Map<string, FileHandler>();
const MAX_CACHED_FILES = 10; // Limit cache size to prevent memory issues

function getFileHandler(): FileHandler | null {
  if (!currentFilePath) return null;
  return fileHandlerCache.get(currentFilePath) || null;
}

function addToCache(filePath: string, handler: FileHandler): void {
  // If cache is full, remove oldest entry
  if (fileHandlerCache.size >= MAX_CACHED_FILES) {
    const firstKey = fileHandlerCache.keys().next().value;
    if (firstKey) {
      fileHandlerCache.delete(firstKey);
    }
  }
  fileHandlerCache.set(filePath, handler);
}

// In-memory storage
const bookmarks = new Map<string, Bookmark>();
const highlights = new Map<string, Highlight>();

// Config folder path (~/.logan/)
const getConfigDir = () => path.join(os.homedir(), '.logan');
const getHighlightsPath = () => path.join(getConfigDir(), 'highlights.json');
const getBookmarksPath = () => path.join(getConfigDir(), 'bookmarks.json');

// Ensure config directory exists
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

// Bookmarks storage structure: { "/path/to/file.log": [bookmark1, bookmark2, ...] }
interface BookmarksStore {
  [filePath: string]: Bookmark[];
}

// Highlights storage structure: { "_global": [...], "/path/to/file.log": [...] }
// _global key stores highlights that apply to all files
const GLOBAL_HIGHLIGHTS_KEY = '_global';
interface HighlightsStore {
  [key: string]: Highlight[]; // key is either "_global" or file path
}

// Color palette for auto-assignment
const COLOR_PALETTE = [
  '#ffff00', // Yellow
  '#ff9900', // Orange
  '#00ff00', // Green
  '#00ffff', // Cyan
  '#ff00ff', // Magenta
  '#ff6b6b', // Coral
  '#4ecdc4', // Teal
  '#a55eea', // Purple
  '#26de81', // Mint
  '#fd79a8', // Pink
];

function getNextColor(): string {
  const usedColors = Array.from(highlights.values()).map(h => h.backgroundColor);
  for (const color of COLOR_PALETTE) {
    if (!usedColors.includes(color)) {
      return color;
    }
  }
  // If all colors used, return random from palette
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

// Load all highlights from config file
function loadHighlightsStore(): HighlightsStore {
  try {
    ensureConfigDir();
    const configPath = getHighlightsPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(data);
      // Handle migration from old format (array) to new format (object)
      if (Array.isArray(parsed)) {
        // Old format: treat all as global
        return { [GLOBAL_HIGHLIGHTS_KEY]: parsed };
      }
      return parsed;
    }
  } catch (error) {
    console.error('Failed to load highlights config:', error);
  }
  return {};
}

// Save all highlights to config file
function saveHighlightsStore(store: HighlightsStore): void {
  try {
    ensureConfigDir();
    const configPath = getHighlightsPath();
    // Clean up empty arrays
    const cleanStore: HighlightsStore = {};
    for (const [key, value] of Object.entries(store)) {
      if (value.length > 0) {
        cleanStore[key] = value;
      }
    }
    const data = JSON.stringify(cleanStore, null, 2);
    fs.writeFileSync(configPath, data, 'utf-8');
  } catch (error) {
    console.error('Failed to save highlights config:', error);
  }
}

// Load highlights for a specific file (combines global + file-specific)
function loadHighlightsForFile(filePath: string): void {
  highlights.clear();
  const store = loadHighlightsStore();

  // Load global highlights first
  const globalHighlights = store[GLOBAL_HIGHLIGHTS_KEY] || [];
  for (const h of globalHighlights) {
    highlights.set(h.id, { ...h, isGlobal: true });
  }

  // Load file-specific highlights
  const fileHighlights = store[filePath] || [];
  for (const h of fileHighlights) {
    highlights.set(h.id, { ...h, isGlobal: false });
  }
}

// Save a highlight (to global or file-specific storage)
function saveHighlight(highlight: Highlight): void {
  if (!currentFilePath && !highlight.isGlobal) return;

  const store = loadHighlightsStore();
  const key = highlight.isGlobal ? GLOBAL_HIGHLIGHTS_KEY : currentFilePath!;

  if (!store[key]) {
    store[key] = [];
  }

  // Remove old version if exists (in case of update or global toggle change)
  for (const k of Object.keys(store)) {
    store[k] = store[k].filter(h => h.id !== highlight.id);
  }

  // Add to appropriate location
  store[key].push(highlight);
  saveHighlightsStore(store);
}

// Remove a highlight from storage
function removeHighlightFromStore(highlightId: string): void {
  const store = loadHighlightsStore();
  for (const key of Object.keys(store)) {
    store[key] = store[key].filter(h => h.id !== highlightId);
  }
  saveHighlightsStore(store);
}

// Load all bookmarks from config file
function loadBookmarksStore(): BookmarksStore {
  try {
    ensureConfigDir();
    const configPath = getBookmarksPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load bookmarks config:', error);
  }
  return {};
}

// Save all bookmarks to config file
function saveBookmarksStore(store: BookmarksStore): void {
  try {
    ensureConfigDir();
    const configPath = getBookmarksPath();
    const data = JSON.stringify(store, null, 2);
    fs.writeFileSync(configPath, data, 'utf-8');
  } catch (error) {
    console.error('Failed to save bookmarks config:', error);
  }
}

// Load bookmarks for a specific file into memory
function loadBookmarksForFile(filePath: string): void {
  bookmarks.clear();
  const store = loadBookmarksStore();
  const fileBookmarks = store[filePath] || [];
  for (const b of fileBookmarks) {
    bookmarks.set(b.id, b);
  }
  currentFilePath = filePath;
}

// Save current bookmarks to the store for the current file
function saveBookmarksForCurrentFile(): void {
  if (!currentFilePath) return;
  const store = loadBookmarksStore();
  const currentBookmarks = Array.from(bookmarks.values());
  if (currentBookmarks.length > 0) {
    store[currentFilePath] = currentBookmarks;
  } else {
    // Remove empty bookmark arrays to keep config clean
    delete store[currentFilePath];
  }
  saveBookmarksStore(store);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
    title: 'LOGAN - Log Analyzer',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close all cached file handlers
    for (const handler of fileHandlerCache.values()) {
      handler.close();
    }
    fileHandlerCache.clear();
  });
}

app.whenReady().then(() => {
  ensureConfigDir();
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// === File Operations ===

ipcMain.handle(IPC.OPEN_FILE_DIALOG, async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'All Supported', extensions: ['log', 'txt', 'out', 'err', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'csv', 'ini', 'conf', 'cfg'] },
      { name: 'Log Files', extensions: ['log', 'txt', 'out', 'err'] },
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'Data Files', extensions: ['json', 'xml', 'yaml', 'yml', 'csv', 'tsv', 'toml'] },
      { name: 'Config Files', extensions: ['ini', 'conf', 'cfg', 'config', 'properties', 'env'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

// === Folder Operations ===

ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Text file extensions to show in folder tree - expanded to support many formats
const TEXT_EXTENSIONS = new Set([
  // Log files
  '.log', '.out', '.err',
  // Text files
  '.txt', '.text', '.md', '.markdown', '.rst',
  // Config files
  '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.config',
  // Data files
  '.csv', '.tsv', '.ndjson', '.jsonl',
  // Code/script files (often contain logs or can be viewed as text)
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  // Other common text formats
  '.properties', '.env', '.gitignore', '.dockerignore',
]);

ipcMain.handle(IPC.READ_FOLDER, async (_, folderPath: string) => {
  try {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const files: Array<{ name: string; path: string; isDirectory: boolean; size?: number }> = [];

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(folderPath, entry.name);

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Include text-based files or files without extension
        if (TEXT_EXTENSIONS.has(ext) || ext === '') {
          try {
            const stat = await fs.promises.stat(fullPath);
            files.push({
              name: entry.name,
              path: fullPath,
              isDirectory: false,
              size: stat.size,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    }

    // Sort by name
    files.sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, files, folderPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Folder Search ===
let folderSearchSignal: { cancelled: boolean } = { cancelled: false };

ipcMain.handle(IPC.FOLDER_SEARCH, async (_, folderPaths: string[], pattern: string, options: { isRegex: boolean; matchCase: boolean }) => {
  folderSearchSignal = { cancelled: false };

  if (!folderPaths.length || !pattern) {
    return { success: false, error: 'No folders or pattern provided' };
  }

  const matches: Array<{ filePath: string; fileName: string; lineNumber: number; column: number; lineText: string }> = [];
  const MAX_MATCHES = 1000;

  try {
    // Build ripgrep arguments
    const args: string[] = [
      '--line-number',
      '--column',
      '--no-heading',
      '--with-filename',
      '--max-count', '100', // Limit matches per file
    ];

    if (!options.matchCase) {
      args.push('--ignore-case');
    }

    if (options.isRegex) {
      args.push('--regexp', pattern);
    } else {
      args.push('--fixed-strings', pattern);
    }

    // Add file type filters for text files
    for (const ext of TEXT_EXTENSIONS) {
      args.push('--glob', `*${ext}`);
    }
    args.push('--glob', '!.*'); // Exclude hidden files

    // Add folder paths
    args.push(...folderPaths);

    return new Promise((resolve) => {
      const proc = spawn('rg', args);
      let buffer = '';
      let lastProgressUpdate = 0;

      proc.stdout.on('data', (data: Buffer) => {
        if (folderSearchSignal.cancelled) {
          proc.kill();
          return;
        }

        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) continue;

          // Parse ripgrep output: filename:line:column:text
          const colonIndex1 = line.indexOf(':');
          if (colonIndex1 === -1) continue;

          const colonIndex2 = line.indexOf(':', colonIndex1 + 1);
          if (colonIndex2 === -1) continue;

          const colonIndex3 = line.indexOf(':', colonIndex2 + 1);
          if (colonIndex3 === -1) continue;

          const filePath = line.substring(0, colonIndex1);
          const lineNum = parseInt(line.substring(colonIndex1 + 1, colonIndex2), 10);
          const column = parseInt(line.substring(colonIndex2 + 1, colonIndex3), 10);
          const lineText = line.substring(colonIndex3 + 1);

          if (isNaN(lineNum) || isNaN(column)) continue;

          matches.push({
            filePath,
            fileName: path.basename(filePath),
            lineNumber: lineNum,
            column: column - 1,
            lineText: lineText.length > 500 ? lineText.substring(0, 500) + '...' : lineText,
          });

          if (matches.length >= MAX_MATCHES) {
            proc.kill();
            break;
          }
        }

        // Send progress updates
        const now = Date.now();
        if (now - lastProgressUpdate > 100) {
          lastProgressUpdate = now;
          mainWindow?.webContents.send(IPC.FOLDER_SEARCH_PROGRESS, { matchCount: matches.length });
        }
      });

      proc.on('error', () => {
        resolve({ success: false, error: 'ripgrep not available. Install with: brew install ripgrep' });
      });

      proc.on('close', () => {
        if (folderSearchSignal.cancelled) {
          resolve({ success: true, matches, cancelled: true });
        } else {
          resolve({ success: true, matches });
        }
      });
    });
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.FOLDER_SEARCH_CANCEL, async () => {
  folderSearchSignal.cancelled = true;
  return { success: true };
});

// === Column Analysis ===

interface ColumnInfo {
  index: number;
  sample: string[];  // Sample values from this column
  visible: boolean;
}

interface ColumnAnalysis {
  delimiter: string;
  delimiterName: string;
  columns: ColumnInfo[];
  sampleLines: string[];
}

// Detect delimiter by analyzing character frequencies
function detectDelimiter(lines: string[]): { delimiter: string; name: string } {
  const candidates = [
    { char: '\t', name: 'Tab' },
    { char: ',', name: 'Comma' },
    { char: '|', name: 'Pipe' },
    { char: ';', name: 'Semicolon' },
  ];

  // Count occurrences of each delimiter and check consistency
  const scores: Map<string, number> = new Map();

  for (const { char } of candidates) {
    const counts = lines.map(line => (line.match(new RegExp(char === '|' ? '\\|' : char, 'g')) || []).length);
    const nonZeroCounts = counts.filter(c => c > 0);

    if (nonZeroCounts.length === 0) continue;

    // Check if count is consistent across lines (good delimiter has consistent column count)
    const avgCount = nonZeroCounts.reduce((a, b) => a + b, 0) / nonZeroCounts.length;
    const consistency = nonZeroCounts.filter(c => Math.abs(c - avgCount) <= 1).length / nonZeroCounts.length;

    // Score based on: presence, count, and consistency
    const score = avgCount * consistency * (nonZeroCounts.length / lines.length);
    scores.set(char, score);
  }

  // Find best delimiter
  let bestDelimiter = { char: ' ', name: 'Space' }; // Default to space
  let bestScore = 0;

  for (const { char, name } of candidates) {
    const score = scores.get(char) || 0;
    if (score > bestScore && score > 1) { // Must have at least some presence
      bestScore = score;
      bestDelimiter = { char, name };
    }
  }

  return { delimiter: bestDelimiter.char, name: bestDelimiter.name };
}

ipcMain.handle('analyze-columns', async () => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    // Get sample lines (first 100 non-empty lines)
    const sampleSize = 100;
    const lines = handler.getLines(1, sampleSize);
    const nonEmptyLines = lines.filter(l => l.text.trim().length > 0).map(l => l.text);

    if (nonEmptyLines.length === 0) {
      return { success: false, error: 'No content to analyze' };
    }

    // Detect delimiter
    const { delimiter, name: delimiterName } = detectDelimiter(nonEmptyLines);

    // Split lines into columns
    const splitLines = nonEmptyLines.map(line => {
      if (delimiter === ' ') {
        // For space delimiter, use whitespace splitting but preserve structure
        return line.split(/\s+/);
      }
      return line.split(delimiter);
    });

    // Find max column count
    const maxColumns = Math.max(...splitLines.map(cols => cols.length));

    // Build column info with samples
    const columns: ColumnInfo[] = [];
    for (let i = 0; i < maxColumns; i++) {
      const samples = splitLines
        .map(cols => cols[i] || '')
        .filter(s => s.trim().length > 0)
        .slice(0, 5); // Keep 5 samples per column

      columns.push({
        index: i,
        sample: samples,
        visible: true, // All visible by default
      });
    }

    const result: ColumnAnalysis = {
      delimiter,
      delimiterName,
      columns,
      sampleLines: nonEmptyLines.slice(0, 5), // First 5 lines as preview
    };

    return { success: true, analysis: result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.OPEN_FILE, async (_, filePath: string) => {
  try {
    // Check if file is already cached
    let fileHandler = fileHandlerCache.get(filePath);
    let info;

    if (fileHandler) {
      // File already indexed - just switch to it
      currentFilePath = filePath;
      info = fileHandler.getFileInfo();
      // Send 100% progress immediately since no indexing needed
      mainWindow?.webContents.send('indexing-progress', 100);
    } else {
      // New file - index it
      fileHandler = new FileHandler();
      info = await fileHandler.open(filePath, (percent) => {
        mainWindow?.webContents.send('indexing-progress', percent);
      });
      addToCache(filePath, fileHandler);
      currentFilePath = filePath;
    }

    // Load bookmarks and highlights for this file
    loadBookmarksForFile(filePath);
    loadHighlightsForFile(filePath);

    // Check for split metadata in file header (preferred)
    const splitMeta = fileHandler.getSplitMetadata();
    let splitInfo: { files: string[]; currentIndex: number } | undefined;

    if (splitMeta) {
      // Build file list from header metadata
      const dir = path.dirname(filePath);
      const files: string[] = [];
      let currentIndex = splitMeta.part - 1;

      // We need to find all parts - scan directory for matching files
      const baseMatch = path.basename(filePath).match(/^(.+)_part\d+(\.[^.]+)?$/);
      if (baseMatch) {
        const baseName = baseMatch[1];
        const ext = baseMatch[2] || '';
        const dirFiles = fs.readdirSync(dir);

        for (let i = 1; i <= splitMeta.total; i++) {
          const partNum = String(i).padStart(String(splitMeta.total).length, '0');
          const expectedName = `${baseName}_part${partNum}${ext}`;
          if (dirFiles.includes(expectedName)) {
            files.push(path.join(dir, expectedName));
          }
        }

        if (files.length > 0) {
          splitInfo = { files, currentIndex };
        }
      }
    } else {
      // Fall back to filename-based detection
      const splitFiles = detectSplitFiles(filePath);
      if (splitFiles) {
        splitInfo = {
          files: splitFiles,
          currentIndex: splitFiles.indexOf(filePath)
        };
      }
    }

    return {
      success: true,
      info,
      splitFiles: splitInfo?.files,
      splitIndex: splitInfo?.currentIndex,
      bookmarks: Array.from(bookmarks.values()),
      highlights: Array.from(highlights.values())
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Detect if a file is part of a split set and find all related parts
function detectSplitFiles(filePath: string): string[] | undefined {
  const fileName = path.basename(filePath);
  const dir = path.dirname(filePath);

  // Match pattern: name_part01.ext, name_part1.ext, etc.
  const partMatch = fileName.match(/^(.+)_part(\d+)(\.[^.]+)?$/);
  if (!partMatch) return undefined;

  const baseName = partMatch[1];
  const ext = partMatch[3] || '';

  // Find all files matching the pattern in the same directory
  try {
    const files = fs.readdirSync(dir);
    const partFiles: { path: string; num: number }[] = [];

    for (const file of files) {
      const match = file.match(new RegExp(`^${escapeRegex(baseName)}_part(\\d+)${escapeRegex(ext)}$`));
      if (match) {
        partFiles.push({
          path: path.join(dir, file),
          num: parseInt(match[1], 10)
        });
      }
    }

    // Sort by part number and return paths
    if (partFiles.length > 1) {
      partFiles.sort((a, b) => a.num - b.num);
      return partFiles.map(p => p.path);
    }
  } catch {
    // Ignore errors reading directory
  }

  return undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

ipcMain.handle(IPC.GET_LINES, async (_, startLine: number, count: number) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const filteredIndices = getFilteredLines();

  if (filteredIndices) {
    // Filter is active - startLine/count refer to positions in filtered list
    const endIdx = Math.min(startLine + count, filteredIndices.length);
    const lineNumbers = filteredIndices.slice(startLine, endIdx);

    // Fetch actual lines by their real line numbers
    const lines = [];
    for (const lineNum of lineNumbers) {
      const [line] = handler.getLines(lineNum, 1);
      if (line) lines.push(line);
    }
    return { success: true, lines };
  }

  // No filter - normal operation
  const lines = handler.getLines(startLine, count);
  return { success: true, lines };
});

// === Search ===

ipcMain.handle(IPC.SEARCH, async (_, options: SearchOptions) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  searchSignal = { cancelled: false };

  try {
    const matches = await handler.search(
      options,
      (percent, matchCount) => {
        mainWindow?.webContents.send(IPC.SEARCH_PROGRESS, { percent, matchCount });
      },
      searchSignal
    );

    // Check if filter is active for current file
    const filteredIndices = getFilteredLines();

    // If filter is active, only return matches within filtered lines
    // and map line numbers to filtered indices
    if (filteredIndices && filteredIndices.length > 0) {
      const filteredSet = new Set(filteredIndices);
      const lineToFilteredIndex = new Map<number, number>();
      filteredIndices.forEach((lineNum, idx) => {
        lineToFilteredIndex.set(lineNum, idx);
      });

      const filteredMatches = matches
        .filter(m => filteredSet.has(m.lineNumber))
        .map(m => ({
          ...m,
          originalLineNumber: m.lineNumber,
          lineNumber: lineToFilteredIndex.get(m.lineNumber) ?? m.lineNumber,
        }));

      return { success: true, matches: filteredMatches };
    }

    return { success: true, matches };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SEARCH_CANCEL, async () => {
  searchSignal.cancelled = true;
  return { success: true };
});

// === Bookmarks ===

ipcMain.handle('bookmark-add', async (_, bookmark: Bookmark) => {
  bookmarks.set(bookmark.id, bookmark);
  saveBookmarksForCurrentFile();
  return { success: true };
});

ipcMain.handle('bookmark-remove', async (_, id: string) => {
  bookmarks.delete(id);
  saveBookmarksForCurrentFile();
  return { success: true };
});

ipcMain.handle('bookmark-list', async () => {
  return { success: true, bookmarks: Array.from(bookmarks.values()) };
});

ipcMain.handle('bookmark-clear', async () => {
  bookmarks.clear();
  saveBookmarksForCurrentFile();
  return { success: true };
});

// Update bookmark (for editing comments)
ipcMain.handle('bookmark-update', async (_, bookmark: Bookmark) => {
  if (bookmarks.has(bookmark.id)) {
    bookmarks.set(bookmark.id, bookmark);
    saveBookmarksForCurrentFile();
    return { success: true };
  }
  return { success: false, error: 'Bookmark not found' };
});

// Export bookmarks to file
ipcMain.handle('export-bookmarks', async () => {
  if (!currentFilePath || bookmarks.size === 0) {
    return { success: false, error: 'No bookmarks to export' };
  }

  try {
    const handler = getFileHandler();
    const fileInfo = handler?.getFileInfo();
    if (!fileInfo) {
      return { success: false, error: 'No file info available' };
    }

    // Generate export filename
    const currentDir = path.dirname(fileInfo.path);
    const baseName = path.basename(fileInfo.path, path.extname(fileInfo.path));
    const timestamp = new Date().toISOString().substring(0, 10).replace(/-/g, '');
    const exportPath = path.join(currentDir, `${baseName}_bookmarks_${timestamp}.md`);

    // Build markdown content with clickable links
    const lines: string[] = [
      `# Bookmarks`,
      ``,
      `**Source:** \`${fileInfo.path}\``,
      `**Exported:** ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`,
      `**Total Bookmarks:** ${bookmarks.size}`,
      ``,
      `---`,
      ``,
    ];

    // Sort bookmarks by line number
    const sortedBookmarks = Array.from(bookmarks.values())
      .sort((a, b) => a.lineNumber - b.lineNumber);

    for (const bookmark of sortedBookmarks) {
      // Get the line text
      const [lineData] = handler?.getLines(bookmark.lineNumber, 1) || [];
      const lineText = lineData?.text || '';
      const truncatedText = lineText.length > 100 ? lineText.substring(0, 100) + '...' : lineText;

      lines.push(`## Line ${bookmark.lineNumber + 1}`);
      lines.push(``);
      if (bookmark.label) {
        lines.push(`**Note:** ${bookmark.label}`);
        lines.push(``);
      }
      // File link in format that some editors/tools can open (VSCode, etc)
      lines.push(`**Link:** \`${fileInfo.path}:${bookmark.lineNumber + 1}\``);
      lines.push(``);
      lines.push(`\`\`\``);
      lines.push(truncatedText);
      lines.push(`\`\`\``);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }

    fs.writeFileSync(exportPath, lines.join('\n'), 'utf-8');

    return { success: true, filePath: exportPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Highlights ===

ipcMain.handle('highlight-add', async (_, highlight: Highlight) => {
  highlights.set(highlight.id, highlight);
  saveHighlight(highlight);
  return { success: true };
});

ipcMain.handle('highlight-remove', async (_, id: string) => {
  highlights.delete(id);
  removeHighlightFromStore(id);
  return { success: true };
});

ipcMain.handle('highlight-update', async (_, highlight: Highlight) => {
  if (highlights.has(highlight.id)) {
    highlights.set(highlight.id, highlight);
    saveHighlight(highlight);
    return { success: true };
  }
  return { success: false, error: 'Highlight not found' };
});

ipcMain.handle('highlight-list', async () => {
  return { success: true, highlights: Array.from(highlights.values()) };
});

ipcMain.handle('highlight-clear', async () => {
  // Only clear file-specific highlights for current file, not global ones
  const store = loadHighlightsStore();
  if (currentFilePath && store[currentFilePath]) {
    delete store[currentFilePath];
    saveHighlightsStore(store);
  }
  // Reload to keep global highlights
  if (currentFilePath) {
    loadHighlightsForFile(currentFilePath);
  }
  return { success: true, highlights: Array.from(highlights.values()) };
});

ipcMain.handle('highlight-clear-all', async () => {
  // Clear all highlights including global
  highlights.clear();
  saveHighlightsStore({});
  return { success: true };
});

ipcMain.handle('highlight-get-next-color', async () => {
  return { success: true, color: getNextColor() };
});

// === Utility ===

ipcMain.handle('get-file-info', async () => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };
  return { success: true, info: handler.getFileInfo() };
});

// Check if ripgrep is available
ipcMain.handle('check-search-engine', async () => {
  return new Promise((resolve) => {
    const proc = spawn('rg', ['--version']);
    let version = '';

    proc.stdout.on('data', (data: Buffer) => {
      version += data.toString();
    });

    proc.on('error', () => {
      resolve({ engine: 'stream', version: null });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const match = version.match(/ripgrep\s+([\d.]+)/);
        resolve({ engine: 'ripgrep', version: match ? match[1] : 'unknown' });
      } else {
        resolve({ engine: 'stream', version: null });
      }
    });
  });
});

// Open external URL in default browser
ipcMain.handle('open-external-url', async (_, url: string) => {
  // Only allow https URLs for security
  if (url.startsWith('https://')) {
    await shell.openExternal(url);
  }
});

// === Save Selected Lines ===

ipcMain.handle('save-selected-lines', async (_, startLine: number, endLine: number) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    // Get the lines
    const count = endLine - startLine + 1;
    const lines = handler.getLines(startLine, count);

    if (lines.length === 0) {
      return { success: false, error: 'No lines to save' };
    }

    // Get current file's directory
    const fileInfo = handler.getFileInfo();
    if (!fileInfo) return { success: false, error: 'No file info' };

    const currentDir = path.dirname(fileInfo.path);
    const selectedDir = path.join(currentDir, 'selected');

    // Create 'selected' folder if it doesn't exist
    if (!fs.existsSync(selectedDir)) {
      fs.mkdirSync(selectedDir, { recursive: true });
    }

    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}.log`;
    const filePath = path.join(selectedDir, filename);

    // Write lines to file
    const content = lines.map(l => l.text).join('\n');
    fs.writeFileSync(filePath, content, 'utf-8');

    return { success: true, filePath, lineCount: lines.length };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Save to Notes ===

// Helper: Read notes file header to get source log path
function getNotesFileSource(notesFilePath: string): string | null {
  try {
    const content = fs.readFileSync(notesFilePath, 'utf-8');
    const lines = content.split('\n').slice(0, 10); // Read first 10 lines
    for (const line of lines) {
      if (line.startsWith('Source: ')) {
        return line.substring(8).trim();
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}

// Find existing notes files for the current log file
ipcMain.handle('find-notes-files', async () => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const fileInfo = handler.getFileInfo();
  if (!fileInfo) return { success: false, error: 'No file info' };

  const currentDir = path.dirname(fileInfo.path);
  const logFilePath = fileInfo.path;

  try {
    const files = fs.readdirSync(currentDir);
    const notesFiles: Array<{ name: string; path: string; created: string }> = [];

    for (const file of files) {
      if (file.endsWith('.notes.txt')) {
        const fullPath = path.join(currentDir, file);
        const source = getNotesFileSource(fullPath);

        // Check if this notes file belongs to the current log file
        if (source === logFilePath) {
          // Get created date from header
          const content = fs.readFileSync(fullPath, 'utf-8');
          const createdMatch = content.match(/Created: (.+)/);
          notesFiles.push({
            name: file,
            path: fullPath,
            created: createdMatch ? createdMatch[1].trim() : 'Unknown',
          });
        }
      }
    }

    return { success: true, files: notesFiles, logFilePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Save to notes - creates new file or appends to existing
ipcMain.handle('save-to-notes', async (
  _,
  startLine: number,
  endLine: number,
  note?: string,
  targetFilePath?: string // If provided, append to this file; otherwise create new
) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    // Get the lines
    const count = endLine - startLine + 1;
    const lines = handler.getLines(startLine, count);

    if (lines.length === 0) {
      return { success: false, error: 'No lines to save' };
    }

    // Get current file info
    const fileInfo = handler.getFileInfo();
    if (!fileInfo) return { success: false, error: 'No file info' };

    const currentDir = path.dirname(fileInfo.path);
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const separator = '='.repeat(80);

    let notesFilePath: string;
    let isNewFile = false;

    if (targetFilePath && fs.existsSync(targetFilePath)) {
      // Append to existing file
      notesFilePath = targetFilePath;
    } else {
      // Create new file with unique name
      const originalFileName = path.basename(fileInfo.path, path.extname(fileInfo.path));
      const dateStr = new Date().toISOString().substring(0, 10).replace(/-/g, '');
      let counter = 1;
      let notesFileName = `${originalFileName}_${dateStr}.notes.txt`;
      notesFilePath = path.join(currentDir, notesFileName);

      // Find unique filename if exists
      while (fs.existsSync(notesFilePath)) {
        counter++;
        notesFileName = `${originalFileName}_${dateStr}_${counter}.notes.txt`;
        notesFilePath = path.join(currentDir, notesFileName);
      }
      isNewFile = true;
    }

    // Build content
    let content = '';

    if (isNewFile) {
      // Add header for new file
      content = [
        separator,
        'LOGAN Notes',
        `Source: ${fileInfo.path}`,
        `Created: ${timestamp}`,
        separator,
        '',
      ].join('\n');
    }

    // Add the note entry
    const noteDesc = note ? ` | ${note}` : '';
    content += [
      '',
      `--- [${timestamp}] Lines ${startLine + 1}-${endLine + 1}${noteDesc} ---`,
      ...lines.map(l => l.text),
      '',
    ].join('\n');

    // Write or append
    if (isNewFile) {
      fs.writeFileSync(notesFilePath, content, 'utf-8');
    } else {
      fs.appendFileSync(notesFilePath, content, 'utf-8');
    }

    // Invalidate cache for this file so it gets re-indexed with new content
    fileHandlerCache.delete(notesFilePath);

    return {
      success: true,
      filePath: notesFilePath,
      lineCount: lines.length,
      isNewFile,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Analysis ===

let analyzeSignal: { cancelled: boolean } = { cancelled: false };

// List available analyzers
ipcMain.handle('list-analyzers', async () => {
  const analyzers = await analyzerRegistry.getAvailable();
  return {
    success: true,
    analyzers: analyzers.map(a => ({ name: a.name, description: a.description }))
  };
});

// Run analysis
ipcMain.handle('analyze-file', async (_, analyzerName?: string, options?: AnalyzerOptions) => {
  if (!currentFilePath) {
    return { success: false, error: 'No file open' };
  }

  // Get analyzer (default to first available if not specified)
  const analyzer = analyzerName
    ? analyzerRegistry.get(analyzerName)
    : analyzerRegistry.getDefault();

  if (!analyzer) {
    return { success: false, error: 'Analyzer not found' };
  }

  analyzeSignal = { cancelled: false };

  try {
    const result = await analyzer.analyze(
      currentFilePath,
      options || {},
      (progress) => {
        mainWindow?.webContents.send('analyze-progress', progress);
      },
      analyzeSignal
    );

    return { success: true, result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Cancel analysis
ipcMain.handle('cancel-analysis', async () => {
  analyzeSignal.cancelled = true;
  return { success: true };
});

// === Filter ===

interface FilterConfig {
  levels: string[];
  includePatterns: string[];
  excludePatterns: string[];
  collapseDuplicates: boolean;
  contextLines?: number;
}

ipcMain.handle('apply-filter', async (_, config: FilterConfig) => {
  const handler = getFileHandler();
  if (!handler || !currentFilePath) {
    return { success: false, error: 'No file open' };
  }

  try {
    const totalLines = handler.getTotalLines();
    const matchingLines: Set<number> = new Set();
    const contextLines = config.contextLines || 0;

    // Process in batches for performance
    const batchSize = 10000;
    for (let start = 0; start < totalLines; start += batchSize) {
      const count = Math.min(batchSize, totalLines - start);
      const lines = handler.getLines(start, count);

      for (const line of lines) {
        let matches = true;

        // Level filter
        if (config.levels.length > 0) {
          const lineLevel = line.level || 'other';
          matches = config.levels.includes(lineLevel);
        }

        // Include patterns (OR logic)
        if (matches && config.includePatterns.length > 0) {
          matches = config.includePatterns.some(pattern => {
            try {
              return new RegExp(pattern, 'i').test(line.text);
            } catch {
              return line.text.toLowerCase().includes(pattern.toLowerCase());
            }
          });
        }

        // Exclude patterns (AND logic - all must not match)
        if (matches && config.excludePatterns.length > 0) {
          matches = !config.excludePatterns.some(pattern => {
            try {
              return new RegExp(pattern, 'i').test(line.text);
            } catch {
              return line.text.toLowerCase().includes(pattern.toLowerCase());
            }
          });
        }

        if (matches) {
          matchingLines.add(line.lineNumber);
        }
      }
    }

    // Add context lines
    if (contextLines > 0) {
      const matchArray = Array.from(matchingLines);
      for (const lineNum of matchArray) {
        for (let i = 1; i <= contextLines; i++) {
          if (lineNum - i >= 0) matchingLines.add(lineNum - i);
          if (lineNum + i < totalLines) matchingLines.add(lineNum + i);
        }
      }
    }

    // Sort and store
    const sortedLines = Array.from(matchingLines).sort((a, b) => a - b);
    filterState.set(currentFilePath, sortedLines);

    return {
      success: true,
      stats: {
        filteredLines: sortedLines.length,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('clear-filter', async () => {
  if (currentFilePath) {
    filterState.delete(currentFilePath);
  }
  return { success: true };
});

// === Split File ===

interface SplitOptions {
  mode: 'lines' | 'parts';
  value: number; // lines per file or number of parts
}

ipcMain.handle('split-file', async (_, options: SplitOptions) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    const fileInfo = handler.getFileInfo();
    if (!fileInfo) return { success: false, error: 'No file info' };

    const totalLines = handler.getTotalLines();
    const currentDir = path.dirname(fileInfo.path);
    const baseName = path.basename(fileInfo.path, path.extname(fileInfo.path));
    const ext = path.extname(fileInfo.path);
    const splitDir = path.join(currentDir, `${baseName}_split`);

    // Create split folder
    if (!fs.existsSync(splitDir)) {
      fs.mkdirSync(splitDir, { recursive: true });
    }

    let linesPerFile: number;
    if (options.mode === 'lines') {
      linesPerFile = options.value;
    } else {
      linesPerFile = Math.ceil(totalLines / options.value);
    }

    const numParts = Math.ceil(totalLines / linesPerFile);
    const createdFiles: string[] = [];
    const BATCH_SIZE = 10000;

    // First, generate all filenames
    const partFileNames: string[] = [];
    for (let i = 0; i < numParts; i++) {
      const partNum = String(i + 1).padStart(String(numParts).length, '0');
      partFileNames.push(`${baseName}_part${partNum}${ext}`);
    }

    for (let part = 0; part < numParts; part++) {
      const startLine = part * linesPerFile;
      const endLine = Math.min(startLine + linesPerFile, totalLines);
      const partFileName = partFileNames[part];
      const partFilePath = path.join(splitDir, partFileName);

      // Build hidden header with navigation info (viewer will skip this line)
      const prevFile = part > 0 ? partFileNames[part - 1] : '';
      const nextFile = part < numParts - 1 ? partFileNames[part + 1] : '';
      const header = `#SPLIT:part=${part + 1},total=${numParts},prev=${prevFile},next=${nextFile}\n`;

      // Write in batches to handle large parts
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(partFilePath, { encoding: 'utf-8' });

        writeStream.on('finish', resolve);
        writeStream.on('error', reject);

        // Write header first (will be hidden by viewer)
        writeStream.write(header);

        for (let batchStart = startLine; batchStart < endLine; batchStart += BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE, endLine);
          const lines = handler.getLines(batchStart, batchEnd - batchStart);
          const content = lines.map(l => l.text).join('\n');
          writeStream.write(batchStart > startLine ? '\n' + content : content);
        }

        writeStream.end();
      });

      createdFiles.push(partFilePath);

      // Report progress
      const progress = Math.round(((part + 1) / numParts) * 100);
      mainWindow?.webContents.send('split-progress', { percent: progress, currentPart: part + 1, totalParts: numParts });
    }

    return { success: true, outputDir: splitDir, files: createdFiles, partCount: numParts };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Terminal ===

let ptyProcess: pty.IPty | null = null;

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

ipcMain.handle('terminal-create', async (_, options?: { cwd?: string; cols?: number; rows?: number }) => {
  try {
    // Kill existing terminal if any
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }

    const shell = getDefaultShell();
    const cwd = options?.cwd || os.homedir();
    const cols = options?.cols || 80;
    const rows = options?.rows || 24;

    ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as { [key: string]: string },
    });

    // Forward terminal output to renderer
    ptyProcess.onData((data: string) => {
      mainWindow?.webContents.send('terminal-data', data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      mainWindow?.webContents.send('terminal-exit', exitCode);
      ptyProcess = null;
    });

    return { success: true, pid: ptyProcess.pid };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('terminal-write', async (_, data: string) => {
  if (ptyProcess) {
    ptyProcess.write(data);
    return { success: true };
  }
  return { success: false, error: 'No terminal process' };
});

ipcMain.handle('terminal-resize', async (_, cols: number, rows: number) => {
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
    return { success: true };
  }
  return { success: false, error: 'No terminal process' };
});

ipcMain.handle('terminal-kill', async () => {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
    return { success: true };
  }
  return { success: false, error: 'No terminal process' };
});

ipcMain.handle('terminal-cd', async (_, directory: string) => {
  if (ptyProcess && fs.existsSync(directory)) {
    // Send cd command to terminal
    const cdCmd = process.platform === 'win32' ? `cd /d "${directory}"\r` : `cd "${directory}"\r`;
    ptyProcess.write(cdCmd);
    return { success: true };
  }
  return { success: false, error: 'No terminal process or invalid directory' };
});
