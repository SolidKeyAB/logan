import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import * as pty from 'node-pty';
import { FileHandler, filterLineToVisibleColumns, ColumnConfig } from './fileHandler';
import { IPC, SearchOptions, Bookmark, Highlight, HighlightGroup, SearchConfig, ActivityEntry, LocalFileData } from '../shared/types';
import * as Diff from 'diff';
import { analyzerRegistry, AnalyzerOptions } from './analyzers';
import { loadDatadogConfig, saveDatadogConfig, clearDatadogConfig, fetchDatadogLogs, DatadogConfig, DatadogFetchParams } from './datadogClient';
import { startApiServer, stopApiServer, ApiContext } from './api-server';
import { SerialHandler } from './serialHandler';
import { LogcatHandler } from './logcatHandler';

let mainWindow: BrowserWindow | null = null;
let searchSignal: { cancelled: boolean } = { cancelled: false };
let diffSignal: { cancelled: boolean } = { cancelled: false };
let currentFilePath: string | null = null;

// Serial port handler
const serialHandler = new SerialHandler();

// Logcat handler
const logcatHandler = new LogcatHandler();

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
const getHighlightGroupsPath = () => path.join(getConfigDir(), 'highlight-groups.json');
const getBookmarksPath = () => path.join(getConfigDir(), 'bookmarks.json');
const getBookmarkSetsPath = () => path.join(getConfigDir(), 'bookmark-sets.json');

// Ensure config directory exists
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

// === Local .logan/ Persistence ===

function getLocalLoganDir(filePath: string): string {
  return path.join(path.dirname(filePath), '.logan');
}

function getLocalFilePath(filePath: string): string {
  return path.join(getLocalLoganDir(filePath), `${path.basename(filePath)}.json`);
}

function canWriteLocal(filePath: string): boolean {
  try {
    const dir = path.dirname(filePath);
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureLocalLoganDir(filePath: string): boolean {
  if (!canWriteLocal(filePath)) return false;
  try {
    const loganDir = getLocalLoganDir(filePath);
    if (!fs.existsSync(loganDir)) {
      fs.mkdirSync(loganDir, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

function createDefaultLocalFileData(filePath: string): LocalFileData {
  return {
    version: 1,
    logFile: filePath,
    lastOpened: new Date().toISOString(),
    bookmarks: [],
    highlights: [],
    activityHistory: [],
  };
}

function loadLocalFileData(filePath: string): LocalFileData {
  try {
    const localPath = getLocalFilePath(filePath);
    if (fs.existsSync(localPath)) {
      const data = fs.readFileSync(localPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load local file data:', error);
  }
  return createDefaultLocalFileData(filePath);
}

function saveLocalFileData(filePath: string, data: LocalFileData): void {
  try {
    if (!ensureLocalLoganDir(filePath)) return;
    const localPath = getLocalFilePath(filePath);
    // Atomic write: write to temp then rename
    const tmpPath = localPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, localPath);
  } catch (error) {
    console.error('Failed to save local file data:', error);
  }
}

// Track whether current file uses local storage or fallback
let currentFileUsesLocalStorage = false;

// Activity history logging
const ACTIVITY_HISTORY_CAP = 500;
const ACTIVITY_HISTORY_TRIM_TO = 400;

function logActivity(filePath: string, action: ActivityEntry['action'], details: Record<string, unknown>): void {
  if (!canWriteLocal(filePath)) return;
  try {
    const data = loadLocalFileData(filePath);
    const entry: ActivityEntry = {
      timestamp: new Date().toISOString(),
      action,
      details,
    };
    data.activityHistory.push(entry);
    // Cap at ACTIVITY_HISTORY_CAP, trim oldest to ACTIVITY_HISTORY_TRIM_TO
    if (data.activityHistory.length > ACTIVITY_HISTORY_CAP) {
      data.activityHistory = data.activityHistory.slice(-ACTIVITY_HISTORY_TRIM_TO);
    }
    saveLocalFileData(filePath, data);
  } catch (error) {
    console.error('Failed to log activity:', error);
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

  // Load global highlights from ~/.logan/ (always)
  const globalHighlights = store[GLOBAL_HIGHLIGHTS_KEY] || [];
  for (const h of globalHighlights) {
    highlights.set(h.id, { ...h, isGlobal: true });
  }

  if (canWriteLocal(filePath)) {
    // Load file-specific highlights from local .logan/
    const localData = loadLocalFileData(filePath);

    if (localData.highlights.length > 0) {
      for (const h of localData.highlights) {
        highlights.set(h.id, { ...h, isGlobal: false });
      }
    } else {
      // Check global store for migration
      const fileHighlights = store[filePath] || [];
      if (fileHighlights.length > 0) {
        // Migrate: copy to local, remove from global
        for (const h of fileHighlights) {
          highlights.set(h.id, { ...h, isGlobal: false });
        }
        localData.highlights = fileHighlights;
        saveLocalFileData(filePath, localData);
        delete store[filePath];
        saveHighlightsStore(store);
      }
    }
  } else {
    // Fallback: load file-specific from global store
    const fileHighlights = store[filePath] || [];
    for (const h of fileHighlights) {
      highlights.set(h.id, { ...h, isGlobal: false });
    }
  }
}

// Save a highlight (to global or file-specific storage)
function saveHighlight(highlight: Highlight): void {
  if (!currentFilePath && !highlight.isGlobal) return;

  if (highlight.isGlobal) {
    // Global highlights always go to ~/.logan/highlights.json
    const store = loadHighlightsStore();
    // Remove old version from all keys in global store
    for (const k of Object.keys(store)) {
      store[k] = store[k].filter(h => h.id !== highlight.id);
    }
    if (!store[GLOBAL_HIGHLIGHTS_KEY]) {
      store[GLOBAL_HIGHLIGHTS_KEY] = [];
    }
    store[GLOBAL_HIGHLIGHTS_KEY].push(highlight);
    saveHighlightsStore(store);

    // Also remove from local if it was previously file-specific
    if (currentFilePath && currentFileUsesLocalStorage) {
      const localData = loadLocalFileData(currentFilePath);
      localData.highlights = localData.highlights.filter(h => h.id !== highlight.id);
      saveLocalFileData(currentFilePath, localData);
    }
  } else if (currentFilePath && currentFileUsesLocalStorage) {
    // File-specific → local .logan/
    const localData = loadLocalFileData(currentFilePath);
    localData.highlights = localData.highlights.filter(h => h.id !== highlight.id);
    localData.highlights.push(highlight);
    saveLocalFileData(currentFilePath, localData);

    // Remove from global store if it was previously global
    const store = loadHighlightsStore();
    let changed = false;
    for (const k of Object.keys(store)) {
      const before = store[k].length;
      store[k] = store[k].filter(h => h.id !== highlight.id);
      if (store[k].length !== before) changed = true;
    }
    if (changed) saveHighlightsStore(store);
  } else {
    // Fallback to global store (read-only directory)
    const store = loadHighlightsStore();
    for (const k of Object.keys(store)) {
      store[k] = store[k].filter(h => h.id !== highlight.id);
    }
    const key = currentFilePath!;
    if (!store[key]) store[key] = [];
    store[key].push(highlight);
    saveHighlightsStore(store);
  }
}

// Remove a highlight from storage
function removeHighlightFromStore(highlightId: string): void {
  // Remove from global store
  const store = loadHighlightsStore();
  let globalChanged = false;
  for (const key of Object.keys(store)) {
    const before = store[key].length;
    store[key] = store[key].filter(h => h.id !== highlightId);
    if (store[key].length !== before) globalChanged = true;
  }
  if (globalChanged) saveHighlightsStore(store);

  // Remove from local .logan/ if applicable
  if (currentFilePath && currentFileUsesLocalStorage) {
    const localData = loadLocalFileData(currentFilePath);
    const before = localData.highlights.length;
    localData.highlights = localData.highlights.filter(h => h.id !== highlightId);
    if (localData.highlights.length !== before) {
      saveLocalFileData(currentFilePath, localData);
    }
  }
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

  if (canWriteLocal(filePath)) {
    currentFileUsesLocalStorage = true;
    const localData = loadLocalFileData(filePath);

    if (localData.bookmarks.length > 0) {
      // Load from local .logan/
      for (const b of localData.bookmarks) {
        bookmarks.set(b.id, b);
      }
    } else {
      // Check global store for migration
      const store = loadBookmarksStore();
      const globalBookmarks = store[filePath] || [];
      if (globalBookmarks.length > 0) {
        // Migrate: copy to local, remove from global
        for (const b of globalBookmarks) {
          bookmarks.set(b.id, b);
        }
        localData.bookmarks = globalBookmarks;
        saveLocalFileData(filePath, localData);
        delete store[filePath];
        saveBookmarksStore(store);
      }
    }
  } else {
    // Fallback: read-only directory, use global store
    currentFileUsesLocalStorage = false;
    const store = loadBookmarksStore();
    const fileBookmarks = store[filePath] || [];
    for (const b of fileBookmarks) {
      bookmarks.set(b.id, b);
    }
  }

  currentFilePath = filePath;
}

// Save current bookmarks to the store for the current file
function saveBookmarksForCurrentFile(): void {
  if (!currentFilePath) return;

  const currentBookmarks = Array.from(bookmarks.values())
    .sort((a, b) => a.lineNumber - b.lineNumber);

  if (currentFileUsesLocalStorage) {
    // Save to local .logan/
    const localData = loadLocalFileData(currentFilePath);
    localData.bookmarks = currentBookmarks;
    saveLocalFileData(currentFilePath, localData);
  } else {
    // Fallback to global store
    const store = loadBookmarksStore();
    if (currentBookmarks.length > 0) {
      store[currentFilePath] = currentBookmarks;
    } else {
      delete store[currentFilePath];
    }
    saveBookmarksStore(store);
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    frame: false,
    ...(isMac ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 10, y: 6 },
    } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
    title: 'LOGAN - Log Analyzer',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

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

  // Start HTTP API server for MCP integration
  const apiContext: ApiContext = {
    getMainWindow: () => mainWindow,
    getCurrentFilePath: () => currentFilePath,
    getFileHandler: () => getFileHandler(),
    getFileHandlerForPath: (fp: string) => fileHandlerCache.get(fp) || null,
    getFilteredLines: () => getFilteredLines(),
    getBookmarks: () => bookmarks,
    getHighlights: () => highlights,
    openFile: async (filePath: string) => {
      // Reuse the same logic as the IPC.OPEN_FILE handler
      let fileHandler = fileHandlerCache.get(filePath);
      let info;
      if (fileHandler) {
        currentFilePath = filePath;
        info = fileHandler.getFileInfo();
      } else {
        fileHandler = new FileHandler();
        info = await fileHandler.open(filePath, () => {});
        addToCache(filePath, fileHandler);
        currentFilePath = filePath;
      }
      loadBookmarksForFile(filePath);
      loadHighlightsForFile(filePath);
      if (canWriteLocal(filePath)) {
        const localData = loadLocalFileData(filePath);
        localData.lastOpened = new Date().toISOString();
        saveLocalFileData(filePath, localData);
      }
      logActivity(filePath, 'file_opened', { filePath });
      return { success: true, info };
    },
    getLines: (startLine: number, count: number) => {
      const handler = getFileHandler();
      if (!handler) return { success: false, error: 'No file open' };
      const filteredIndices = getFilteredLines();
      if (filteredIndices) {
        const endIdx = Math.min(startLine + count, filteredIndices.length);
        const lineNumbers = filteredIndices.slice(startLine, endIdx);
        const lines = [];
        for (const lineNum of lineNumbers) {
          const [line] = handler.getLines(lineNum, 1);
          if (line) lines.push(line);
        }
        return { success: true, lines };
      }
      const lines = handler.getLines(startLine, count);
      return { success: true, lines };
    },
    search: async (options: SearchOptions) => {
      const handler = getFileHandler();
      if (!handler) return { success: false, error: 'No file open' };
      searchSignal = { cancelled: false };
      try {
        const matches = await handler.search(options, () => {}, searchSignal);
        if (currentFilePath) logActivity(currentFilePath, 'search', { pattern: options.pattern, isRegex: options.isRegex, matchCount: matches.length });
        return { success: true, matches };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    analyze: async (analyzerName?: string) => {
      if (!currentFilePath) return { success: false, error: 'No file open' };
      const analyzer = analyzerName ? analyzerRegistry.get(analyzerName) : analyzerRegistry.getDefault();
      if (!analyzer) return { success: false, error: 'Analyzer not found' };
      analyzeSignal = { cancelled: false };
      try {
        const result = await analyzer.analyze(currentFilePath, {}, () => {}, analyzeSignal);
        logActivity(currentFilePath, 'analysis_run', { analyzerName: analyzer.name });
        return { success: true, result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    applyFilter: async (config: any) => {
      const handler = getFileHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      filterSignal = { cancelled: false };
      try {
        const totalLines = handler.getTotalLines();
        const matchingLines: Set<number> = new Set();
        const batchSize = 10000;
        for (let start = 0; start < totalLines; start += batchSize) {
          if (filterSignal.cancelled) return { success: false, error: 'Cancelled' };
          const count = Math.min(batchSize, totalLines - start);
          const lines = handler.getLines(start, count);
          for (const line of lines) {
            let matches = true;
            const lineLevel = line.level || 'other';
            if (config.levels && config.levels.length > 0) {
              matches = config.levels.includes(lineLevel);
            }
            if (matches && config.includePatterns && config.includePatterns.length > 0) {
              matches = config.includePatterns.some((p: string) => {
                try { return new RegExp(p, config.matchCase ? '' : 'i').test(line.text); }
                catch { return line.text.toLowerCase().includes(p.toLowerCase()); }
              });
            }
            if (matches && config.excludePatterns && config.excludePatterns.length > 0) {
              const excluded = config.excludePatterns.some((p: string) => {
                try { return new RegExp(p, config.matchCase ? '' : 'i').test(line.text); }
                catch { return line.text.toLowerCase().includes(p.toLowerCase()); }
              });
              if (excluded) matches = false;
            }
            if (matches) matchingLines.add(line.lineNumber);
          }
        }
        const sortedLines = Array.from(matchingLines).sort((a, b) => a - b);
        filterState.set(currentFilePath, sortedLines);
        logActivity(currentFilePath, 'filter_applied', { levels: config.levels, filteredLines: sortedLines.length });
        return { success: true, stats: { filteredLines: sortedLines.length } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    clearFilter: () => {
      if (currentFilePath) {
        filterState.delete(currentFilePath);
        logActivity(currentFilePath, 'filter_cleared', {});
      }
      return { success: true };
    },
    addBookmark: (bookmark: Bookmark) => {
      bookmarks.set(bookmark.id, bookmark);
      saveBookmarksForCurrentFile();
      if (currentFilePath) logActivity(currentFilePath, 'bookmark_added', { lineNumber: bookmark.lineNumber, label: bookmark.label });
      return { success: true };
    },
    addHighlight: (highlight: Highlight) => {
      highlights.set(highlight.id, highlight);
      saveHighlight(highlight);
      if (currentFilePath) logActivity(currentFilePath, 'highlight_added', { pattern: highlight.pattern, isGlobal: !!highlight.isGlobal });
      return { success: true };
    },
    detectTimeGaps: async (options: any) => {
      const handler = getFileHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      timeGapSignal = { cancelled: false };
      try {
        const totalLines = handler.getTotalLines();
        const gaps: any[] = [];
        const MAX_GAPS = 500;
        const thresholdSeconds = options.thresholdSeconds || 30;
        let prevTimestamp: Date | null = null;
        let prevTimestampStr: string | null = null;
        let prevLineNumber = 0;
        const batchSize = 5000;
        for (let start = 0; start < totalLines && gaps.length < MAX_GAPS; start += batchSize) {
          if (timeGapSignal.cancelled) return { success: false, error: 'Cancelled' };
          const count = Math.min(batchSize, totalLines - start);
          const lines = handler.getLines(start, count);
          for (const line of lines) {
            const parsed = parseTimestampFast(line.text);
            if (parsed && prevTimestamp) {
              const diffSeconds = (parsed.date.getTime() - prevTimestamp.getTime()) / 1000;
              if (Math.abs(diffSeconds) >= thresholdSeconds) {
                gaps.push({
                  lineNumber: line.lineNumber,
                  prevLineNumber,
                  gapSeconds: Math.abs(diffSeconds),
                  prevTimestamp: prevTimestampStr || '',
                  currTimestamp: parsed.str,
                  linePreview: line.text.length > 80 ? line.text.substring(0, 80) + '...' : line.text,
                });
                if (gaps.length >= MAX_GAPS) break;
              }
            }
            if (parsed) {
              prevTimestamp = parsed.date;
              prevTimestampStr = parsed.str;
              prevLineNumber = line.lineNumber;
            }
          }
        }
        gaps.sort((a, b) => b.gapSeconds - a.gapSeconds);
        logActivity(currentFilePath, 'time_gap_analysis', { threshold: thresholdSeconds, gapsFound: gaps.length });
        return { success: true, gaps, totalLines };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    navigateToLine: (lineNumber: number) => {
      mainWindow?.webContents.send('navigate-to-line', lineNumber);
    },
  };
  startApiServer(apiContext);
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

app.on('will-quit', () => {
  serialHandler.cleanupTempFile();
  logcatHandler.cleanupTempFile();
  stopApiServer();
});

// === Window Controls ===

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow?.close();
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

// === Serial Port ===

ipcMain.handle(IPC.SERIAL_LIST_PORTS, async () => {
  try {
    const ports = await serialHandler.listPorts();
    return { success: true, ports };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SERIAL_CONNECT, async (_, config: { path: string; baudRate: number }) => {
  try {
    const tempFilePath = await serialHandler.connect(config);

    // Open temp file with FileHandler
    const fileHandler = new FileHandler();
    const info = await fileHandler.open(tempFilePath, () => {});
    addToCache(tempFilePath, fileHandler);
    currentFilePath = tempFilePath;

    // Forward events to renderer
    const onLinesAdded = (count: number) => {
      // Incrementally index new bytes in the file handler
      const handler = fileHandlerCache.get(tempFilePath);
      if (handler) {
        const newLines = handler.indexNewLines();
        if (newLines > 0) {
          mainWindow?.webContents.send(IPC.SERIAL_LINES_ADDED, {
            totalLines: handler.getTotalLines(),
            newLines,
          });
        }
      }
    };

    const onError = (message: string) => {
      mainWindow?.webContents.send(IPC.SERIAL_ERROR, message);
    };

    const onDisconnected = () => {
      mainWindow?.webContents.send(IPC.SERIAL_DISCONNECTED);
      serialHandler.removeListener('lines-added', onLinesAdded);
      serialHandler.removeListener('error', onError);
      serialHandler.removeListener('disconnected', onDisconnected);
    };

    serialHandler.on('lines-added', onLinesAdded);
    serialHandler.on('error', onError);
    serialHandler.on('disconnected', onDisconnected);

    return { success: true, info, tempFilePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SERIAL_DISCONNECT, async () => {
  try {
    serialHandler.disconnect();
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SERIAL_STATUS, async () => {
  return serialHandler.getStatus();
});

ipcMain.handle(IPC.SERIAL_SAVE_SESSION, async () => {
  const tempPath = serialHandler.getTempFilePath();
  if (!tempPath || !fs.existsSync(tempPath)) {
    return { success: false, error: 'No serial session data' };
  }

  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Serial Session',
    defaultPath: path.basename(tempPath),
    filters: [
      { name: 'Log Files', extensions: ['log', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { success: false, error: 'Cancelled' };
  }

  try {
    fs.copyFileSync(tempPath, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Logcat ===

ipcMain.handle(IPC.LOGCAT_LIST_DEVICES, async () => {
  try {
    const devices = await logcatHandler.listDevices();
    return { success: true, devices };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LOGCAT_CONNECT, async (_, config: { device?: string; filter?: string }) => {
  try {
    const tempFilePath = await logcatHandler.connect(config);

    // Open temp file with FileHandler
    const fileHandler = new FileHandler();
    const info = await fileHandler.open(tempFilePath, () => {});
    addToCache(tempFilePath, fileHandler);
    currentFilePath = tempFilePath;

    // Forward events to renderer
    const onLinesAdded = (count: number) => {
      const handler = fileHandlerCache.get(tempFilePath);
      if (handler) {
        const newLines = handler.indexNewLines();
        if (newLines > 0) {
          mainWindow?.webContents.send(IPC.LOGCAT_LINES_ADDED, {
            totalLines: handler.getTotalLines(),
            newLines,
          });
        }
      }
    };

    const onError = (message: string) => {
      mainWindow?.webContents.send(IPC.LOGCAT_ERROR, message);
    };

    const onDisconnected = () => {
      mainWindow?.webContents.send(IPC.LOGCAT_DISCONNECTED);
      logcatHandler.removeListener('lines-added', onLinesAdded);
      logcatHandler.removeListener('error', onError);
      logcatHandler.removeListener('disconnected', onDisconnected);
    };

    logcatHandler.on('lines-added', onLinesAdded);
    logcatHandler.on('error', onError);
    logcatHandler.on('disconnected', onDisconnected);

    return { success: true, info, tempFilePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LOGCAT_DISCONNECT, async () => {
  try {
    logcatHandler.disconnect();
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LOGCAT_STATUS, async () => {
  return logcatHandler.getStatus();
});

ipcMain.handle(IPC.LOGCAT_SAVE_SESSION, async () => {
  const tempPath = logcatHandler.getTempFilePath();
  if (!tempPath || !fs.existsSync(tempPath)) {
    return { success: false, error: 'No logcat session data' };
  }

  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Logcat Session',
    defaultPath: path.basename(tempPath),
    filters: [
      { name: 'Log Files', extensions: ['log', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { success: false, error: 'Cancelled' };
  }

  try {
    fs.copyFileSync(tempPath, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: String(error) };
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
  name?: string;
  sample: string[];  // Sample values from this column
  visible: boolean;
}

interface ColumnAnalysis {
  delimiter: string;
  delimiterName: string;
  columns: ColumnInfo[];
  sampleLines: string[];
  hasHeaderRow?: boolean;
}

// Split a line respecting quoted fields (basic CSV support)
function splitWithQuotes(line: string, delimiter: string): string[] {
  if (delimiter === ' ' || delimiter === '\t') {
    // For whitespace delimiters, no quoting support needed
    return delimiter === ' ' ? line.split(/\s+/) : line.split(delimiter);
  }

  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// Detect delimiter by analyzing character frequencies
function detectDelimiter(lines: string[]): { delimiter: string; name: string } {
  const candidates = [
    { char: '\t', name: 'Tab' },
    { char: ',', name: 'Comma' },
    { char: '|', name: 'Pipe' },
    { char: ';', name: 'Semicolon' },
    { char: ':', name: 'Colon' },
    { char: '=', name: 'Equals' },
  ];

  // Count occurrences of each delimiter and check consistency
  const scores: Map<string, number> = new Map();

  for (const { char } of candidates) {
    const escapedChar = char === '|' ? '\\|' : char === '=' ? '=' : char;
    const counts = lines.map(line => (line.match(new RegExp(escapedChar, 'g')) || []).length);
    const nonZeroCounts = counts.filter(c => c > 0);

    if (nonZeroCounts.length === 0) continue;

    // Check if count is consistent across lines (good delimiter has consistent column count)
    const avgCount = nonZeroCounts.reduce((a, b) => a + b, 0) / nonZeroCounts.length;
    const consistency = nonZeroCounts.filter(c => Math.abs(c - avgCount) <= 1).length / nonZeroCounts.length;

    // Score based on: presence, count, and consistency
    let score = avgCount * consistency * (nonZeroCounts.length / lines.length);

    // Colon heuristic: penalize if it looks like timestamps (e.g. 10:30:45)
    if (char === ':' && avgCount <= 3) {
      const timestampPattern = /\d{1,2}:\d{2}/;
      const timestampLines = lines.filter(l => timestampPattern.test(l)).length;
      if (timestampLines / lines.length > 0.8) {
        score *= 0.3; // Strong penalty
      }
    }

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

// Check if the first row looks like a header row
function inferHeaderRow(firstRow: string[]): { hasHeader: boolean; names: string[] } {
  if (firstRow.length === 0) return { hasHeader: false, names: [] };

  // Check if all values are non-empty, non-numeric, and unique
  const trimmed = firstRow.map(v => v.trim());
  const allNonEmpty = trimmed.every(v => v.length > 0);
  const allNonNumeric = trimmed.every(v => isNaN(Number(v)));
  const allUnique = new Set(trimmed.map(v => v.toLowerCase())).size === trimmed.length;

  if (allNonEmpty && allNonNumeric && allUnique && trimmed.length >= 2) {
    return { hasHeader: true, names: trimmed };
  }

  return { hasHeader: false, names: [] };
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

    // Split lines into columns (with quoted field support)
    const splitLines = nonEmptyLines.map(line => splitWithQuotes(line, delimiter));

    // Find max column count
    const maxColumns = Math.max(...splitLines.map(cols => cols.length));

    // Check if first row is a header
    const { hasHeader, names: headerNames } = inferHeaderRow(splitLines[0] || []);

    // Build column info with samples (skip header row for samples if detected)
    const sampleStartIdx = hasHeader ? 1 : 0;
    const columns: ColumnInfo[] = [];
    for (let i = 0; i < maxColumns; i++) {
      const samples = splitLines
        .slice(sampleStartIdx)
        .map(cols => cols[i] || '')
        .filter(s => s.trim().length > 0)
        .slice(0, 5); // Keep 5 samples per column

      columns.push({
        index: i,
        name: hasHeader && i < headerNames.length ? headerNames[i] : undefined,
        sample: samples,
        visible: true, // All visible by default
      });
    }

    const result: ColumnAnalysis = {
      delimiter,
      delimiterName,
      columns,
      sampleLines: nonEmptyLines.slice(0, 5), // First 5 lines as preview
      hasHeaderRow: hasHeader,
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

    // Detect long lines for warning
    const LONG_LINE_THRESHOLD = 5000; // chars
    const maxLineLength = fileHandler.getMaxLineLength();
    const hasLongLines = maxLineLength > LONG_LINE_THRESHOLD && !filePath.includes('.formatted.');

    // Load bookmarks and highlights for this file
    const persistPath = filePath;
    loadBookmarksForFile(persistPath);
    loadHighlightsForFile(persistPath);

    // Update lastOpened in local sidecar
    if (canWriteLocal(persistPath)) {
      const localData = loadLocalFileData(persistPath);
      localData.lastOpened = new Date().toISOString();
      saveLocalFileData(persistPath, localData);
    }
    logActivity(persistPath, 'file_opened', { filePath: persistPath });

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
      highlights: Array.from(highlights.values()),
      hasLongLines,
      maxLineLength,
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

    if (currentFilePath) logActivity(currentFilePath, 'search', { pattern: options.pattern, isRegex: options.isRegex, matchCount: matches.length });

    // Check if filter is active for current file
    const filteredIndices = getFilteredLines();

    // If filter is active, separate matches into visible and hidden
    if (filteredIndices && filteredIndices.length > 0) {
      const filteredSet = new Set(filteredIndices);
      const lineToFilteredIndex = new Map<number, number>();
      filteredIndices.forEach((lineNum, idx) => {
        lineToFilteredIndex.set(lineNum, idx);
      });

      const filteredMatches: any[] = [];
      const hiddenMatches: any[] = [];

      for (const m of matches) {
        if (filteredSet.has(m.lineNumber)) {
          filteredMatches.push({
            ...m,
            originalLineNumber: m.lineNumber,
            lineNumber: lineToFilteredIndex.get(m.lineNumber) ?? m.lineNumber,
          });
        } else {
          hiddenMatches.push({
            lineNumber: m.lineNumber,
            column: m.column,
            length: m.length,
            lineText: m.lineText,
          });
        }
      }

      return { success: true, matches: filteredMatches, hiddenMatches };
    }

    // Check for hidden column matches (matches in columns that are filtered out)
    if (options.columnConfig) {
      const visibleCols = options.columnConfig.columns.filter(c => c.visible).map(c => c.index);
      const hiddenCols = options.columnConfig.columns.filter(c => !c.visible).map(c => c.index);
      if (hiddenCols.length > 0) {
        // Do a full-text search (without column config) to find matches in hidden columns
        const fullOptions = { ...options, columnConfig: undefined };
        const fullMatches = await handler.search(fullOptions, () => {}, searchSignal);
        // Find matches that are NOT in the visible column results
        const visibleMatchSet = new Set(matches.map(m => `${m.lineNumber}:${m.column}`));
        const hiddenColumnMatches = fullMatches
          .filter(m => !visibleMatchSet.has(`${m.lineNumber}:${m.column}`))
          .map(m => ({
            lineNumber: m.lineNumber,
            column: m.column,
            length: m.length,
            lineText: m.lineText,
          }));
        if (hiddenColumnMatches.length > 0) {
          return { success: true, matches, hiddenColumnMatches };
        }
      }
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

// === Get Lines For File (used by secondary viewer in split/diff mode) ===

ipcMain.handle(IPC.GET_LINES_FOR_FILE, async (_, filePath: string, startLine: number, count: number) => {
  const handler = fileHandlerCache.get(filePath);
  if (!handler) return { success: false, error: 'File not in cache' };

  const filteredIndices = filterState.get(filePath) || null;

  if (filteredIndices) {
    const endIdx = Math.min(startLine + count, filteredIndices.length);
    const lineNumbers = filteredIndices.slice(startLine, endIdx);
    const lines = [];
    for (const lineNum of lineNumbers) {
      const [line] = handler.getLines(lineNum, 1);
      if (line) lines.push(line);
    }
    return { success: true, lines };
  }

  const lines = handler.getLines(startLine, count);
  return { success: true, lines };
});

// === Diff Compute ===

const DIFF_MAX_LINES = 100000;

ipcMain.handle(IPC.DIFF_COMPUTE, async (_, leftFilePath: string, rightFilePath: string) => {
  const leftHandler = fileHandlerCache.get(leftFilePath);
  const rightHandler = fileHandlerCache.get(rightFilePath);

  if (!leftHandler || !rightHandler) {
    return { success: false, error: 'Both files must be open in tabs' };
  }

  const leftTotal = leftHandler.getTotalLines();
  const rightTotal = rightHandler.getTotalLines();

  if (leftTotal > DIFF_MAX_LINES || rightTotal > DIFF_MAX_LINES) {
    return { success: false, error: `Files too large for diff (limit: ${DIFF_MAX_LINES.toLocaleString()} lines). Left: ${leftTotal.toLocaleString()}, Right: ${rightTotal.toLocaleString()}` };
  }

  diffSignal = { cancelled: false };

  try {
    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 10, phase: 'Reading files...' });

    // Read all lines from both files
    const leftLines: string[] = [];
    const rightLines: string[] = [];

    const CHUNK = 10000;
    for (let i = 0; i < leftTotal; i += CHUNK) {
      if (diffSignal.cancelled) return { success: false, error: 'Cancelled' };
      const lines = leftHandler.getLines(i, Math.min(CHUNK, leftTotal - i));
      for (const l of lines) leftLines.push(l.text);
    }

    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 30, phase: 'Reading files...' });

    for (let i = 0; i < rightTotal; i += CHUNK) {
      if (diffSignal.cancelled) return { success: false, error: 'Cancelled' };
      const lines = rightHandler.getLines(i, Math.min(CHUNK, rightTotal - i));
      for (const l of lines) rightLines.push(l.text);
    }

    if (diffSignal.cancelled) return { success: false, error: 'Cancelled' };

    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 50, phase: 'Computing diff...' });

    // Compute line-level diff
    const changes = Diff.diffArrays(leftLines, rightLines);

    if (diffSignal.cancelled) return { success: false, error: 'Cancelled' };

    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 80, phase: 'Building hunks...' });

    // Build hunks from changes, merging adjacent removed+added into modified
    interface DiffHunk {
      type: 'equal' | 'added' | 'removed' | 'modified';
      leftStart: number;
      leftCount: number;
      rightStart: number;
      rightCount: number;
    }

    const hunks: DiffHunk[] = [];
    let leftIdx = 0;
    let rightIdx = 0;
    let stats = { additions: 0, deletions: 0, modifications: 0 };

    for (let c = 0; c < changes.length; c++) {
      const change = changes[c];
      const count = change.count || 0;

      if (!change.added && !change.removed) {
        // Equal
        hunks.push({ type: 'equal', leftStart: leftIdx, leftCount: count, rightStart: rightIdx, rightCount: count });
        leftIdx += count;
        rightIdx += count;
      } else if (change.removed && c + 1 < changes.length && changes[c + 1].added) {
        // Removed followed by added → modified
        const nextChange = changes[c + 1];
        const nextCount = nextChange.count || 0;
        hunks.push({ type: 'modified', leftStart: leftIdx, leftCount: count, rightStart: rightIdx, rightCount: nextCount });
        stats.modifications += Math.max(count, nextCount);
        leftIdx += count;
        rightIdx += nextCount;
        c++; // skip the added part
      } else if (change.removed) {
        hunks.push({ type: 'removed', leftStart: leftIdx, leftCount: count, rightStart: rightIdx, rightCount: 0 });
        stats.deletions += count;
        leftIdx += count;
      } else if (change.added) {
        hunks.push({ type: 'added', leftStart: leftIdx, leftCount: 0, rightStart: rightIdx, rightCount: count });
        stats.additions += count;
        rightIdx += count;
      }
    }

    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 100, phase: 'Done' });

    if (currentFilePath) logActivity(currentFilePath, 'diff_compared', { leftFile: leftFilePath, rightFile: rightFilePath });

    return {
      success: true,
      result: {
        hunks,
        stats,
        leftTotalLines: leftTotal,
        rightTotalLines: rightTotal,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.DIFF_CANCEL, async () => {
  diffSignal.cancelled = true;
  return { success: true };
});

// === Bookmarks ===

ipcMain.handle('bookmark-add', async (_, bookmark: Bookmark) => {
  bookmarks.set(bookmark.id, bookmark);
  saveBookmarksForCurrentFile();
  if (currentFilePath) logActivity(currentFilePath, 'bookmark_added', { lineNumber: bookmark.lineNumber, label: bookmark.label });
  return { success: true };
});

ipcMain.handle('bookmark-remove', async (_, id: string) => {
  bookmarks.delete(id);
  saveBookmarksForCurrentFile();
  if (currentFilePath) logActivity(currentFilePath, 'bookmark_removed', { bookmarkId: id });
  return { success: true };
});

ipcMain.handle('bookmark-list', async () => {
  return { success: true, bookmarks: Array.from(bookmarks.values()).sort((a, b) => a.lineNumber - b.lineNumber) };
});

ipcMain.handle('bookmark-clear', async () => {
  const count = bookmarks.size;
  bookmarks.clear();
  saveBookmarksForCurrentFile();
  if (currentFilePath && count > 0) logActivity(currentFilePath, 'bookmark_cleared', { count });
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
      // Use stored lineText if available, otherwise fetch from file
      const lineText = bookmark.lineText || (handler?.getLines(bookmark.lineNumber, 1)?.[0]?.text) || '';

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
      lines.push(lineText);
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

// === Bookmark Sets ===

interface BookmarkSet {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bookmarks: Bookmark[];
}

function loadBookmarkSets(): BookmarkSet[] {
  try {
    const setsPath = getBookmarkSetsPath();
    if (fs.existsSync(setsPath)) {
      const data = JSON.parse(fs.readFileSync(setsPath, 'utf-8'));
      return data.sets || [];
    }
  } catch {}
  return [];
}

function saveBookmarkSets(sets: BookmarkSet[]): void {
  ensureConfigDir();
  fs.writeFileSync(getBookmarkSetsPath(), JSON.stringify({ sets }, null, 2), 'utf-8');
}

ipcMain.handle('bookmark-set-list', async () => {
  return { success: true, sets: loadBookmarkSets() };
});

ipcMain.handle('bookmark-set-save', async (_, set: BookmarkSet) => {
  const sets = loadBookmarkSets();
  sets.push(set);
  saveBookmarkSets(sets);
  return { success: true };
});

ipcMain.handle('bookmark-set-update', async (_, set: BookmarkSet) => {
  const sets = loadBookmarkSets();
  const idx = sets.findIndex(s => s.id === set.id);
  if (idx >= 0) {
    sets[idx] = set;
    saveBookmarkSets(sets);
    return { success: true };
  }
  return { success: false, error: 'Set not found' };
});

ipcMain.handle('bookmark-set-delete', async (_, setId: string) => {
  const sets = loadBookmarkSets();
  const filtered = sets.filter(s => s.id !== setId);
  saveBookmarkSets(filtered);
  return { success: true };
});

ipcMain.handle('bookmark-set-load', async (_, setId: string) => {
  const sets = loadBookmarkSets();
  const set = sets.find(s => s.id === setId);
  if (set) {
    return { success: true, bookmarks: set.bookmarks };
  }
  return { success: false, error: 'Set not found' };
});

// === Highlights ===

ipcMain.handle('highlight-add', async (_, highlight: Highlight) => {
  highlights.set(highlight.id, highlight);
  saveHighlight(highlight);
  if (currentFilePath) logActivity(currentFilePath, 'highlight_added', { pattern: highlight.pattern, isGlobal: !!highlight.isGlobal });
  return { success: true };
});

ipcMain.handle('highlight-remove', async (_, id: string) => {
  highlights.delete(id);
  removeHighlightFromStore(id);
  if (currentFilePath) logActivity(currentFilePath, 'highlight_removed', { highlightId: id });
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
  if (currentFilePath && currentFileUsesLocalStorage) {
    // Clear local .logan/ file-specific highlights
    const localData = loadLocalFileData(currentFilePath);
    const clearedCount = localData.highlights.length;
    localData.highlights = [];
    saveLocalFileData(currentFilePath, localData);
    if (clearedCount > 0) {
      logActivity(currentFilePath, 'highlight_cleared', { count: clearedCount });
    }
  }
  // Also clear from global store for this file (migration leftovers)
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
  // Also clear local file-specific highlights
  if (currentFilePath && currentFileUsesLocalStorage) {
    const localData = loadLocalFileData(currentFilePath);
    localData.highlights = [];
    saveLocalFileData(currentFilePath, localData);
  }
  return { success: true };
});

ipcMain.handle('highlight-get-next-color', async () => {
  return { success: true, color: getNextColor() };
});

// === Highlight Groups ===

function loadHighlightGroups(): HighlightGroup[] {
  try {
    const filePath = getHighlightGroupsPath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveHighlightGroups(groups: HighlightGroup[]): void {
  ensureConfigDir();
  fs.writeFileSync(getHighlightGroupsPath(), JSON.stringify(groups, null, 2), 'utf-8');
}

ipcMain.handle('highlight-group-list', async () => {
  return { success: true, groups: loadHighlightGroups() };
});

ipcMain.handle('highlight-group-save', async (_, group: HighlightGroup) => {
  const groups = loadHighlightGroups();
  const existingIdx = groups.findIndex(g => g.id === group.id);
  if (existingIdx >= 0) {
    groups[existingIdx] = group;
  } else {
    groups.push(group);
  }
  saveHighlightGroups(groups);
  return { success: true };
});

ipcMain.handle('highlight-group-delete', async (_, groupId: string) => {
  const groups = loadHighlightGroups().filter(g => g.id !== groupId);
  saveHighlightGroups(groups);
  return { success: true };
});

// === Search Configs ===

const getSearchConfigsPath = () => path.join(getConfigDir(), 'search-configs.json');
const GLOBAL_SEARCH_CONFIGS_KEY = '_global';

interface SearchConfigsStore {
  [key: string]: SearchConfig[];
}

function loadSearchConfigsStore(): SearchConfigsStore {
  try {
    ensureConfigDir();
    const configPath = getSearchConfigsPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load search configs:', error);
  }
  return {};
}

function saveSearchConfigsStore(store: SearchConfigsStore): void {
  try {
    ensureConfigDir();
    const configPath = getSearchConfigsPath();
    const cleanStore: SearchConfigsStore = {};
    for (const [key, value] of Object.entries(store)) {
      if (value.length > 0) {
        cleanStore[key] = value;
      }
    }
    fs.writeFileSync(configPath, JSON.stringify(cleanStore, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save search configs:', error);
  }
}

function loadSearchConfigsForFile(filePath: string): SearchConfig[] {
  const store = loadSearchConfigsStore();
  const configs: SearchConfig[] = [];

  // Load global configs
  const globalConfigs = store[GLOBAL_SEARCH_CONFIGS_KEY] || [];
  for (const c of globalConfigs) {
    configs.push({ ...c, isGlobal: true });
  }

  // Load file-specific configs
  if (filePath) {
    const fileConfigs = store[filePath] || [];
    for (const c of fileConfigs) {
      configs.push({ ...c, isGlobal: false });
    }
  }

  return configs;
}

function saveSearchConfig(config: SearchConfig): void {
  const store = loadSearchConfigsStore();

  // Remove from all keys first
  for (const k of Object.keys(store)) {
    store[k] = store[k].filter(c => c.id !== config.id);
  }

  const key = config.isGlobal ? GLOBAL_SEARCH_CONFIGS_KEY : (currentFilePath || GLOBAL_SEARCH_CONFIGS_KEY);
  if (!store[key]) store[key] = [];
  store[key].push(config);
  saveSearchConfigsStore(store);
}

function removeSearchConfigFromStore(id: string): void {
  const store = loadSearchConfigsStore();
  let changed = false;
  for (const k of Object.keys(store)) {
    const before = store[k].length;
    store[k] = store[k].filter(c => c.id !== id);
    if (store[k].length !== before) changed = true;
  }
  if (changed) saveSearchConfigsStore(store);
}

ipcMain.handle(IPC.SEARCH_CONFIG_SAVE, async (_, config: SearchConfig) => {
  saveSearchConfig(config);
  return { success: true };
});

ipcMain.handle(IPC.SEARCH_CONFIG_LOAD, async () => {
  const configs = loadSearchConfigsForFile(currentFilePath || '');
  return { success: true, configs };
});

ipcMain.handle(IPC.SEARCH_CONFIG_DELETE, async (_, id: string) => {
  removeSearchConfigFromStore(id);
  return { success: true };
});

ipcMain.handle(IPC.SEARCH_CONFIG_BATCH, async (_, configs: Array<{ id: string; pattern: string; isRegex: boolean; matchCase: boolean; wholeWord: boolean }>) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const results: Record<string, Array<{ lineNumber: number; column: number; length: number; lineText: string }>> = {};
  const totalConfigs = configs.length;

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    try {
      const searchOpts: SearchOptions = {
        pattern: cfg.pattern,
        isRegex: cfg.isRegex,
        isWildcard: false,
        matchCase: cfg.matchCase,
        wholeWord: cfg.wholeWord,
      };

      // Add filtered lines if filter is active
      const filteredIndices = getFilteredLines();
      if (filteredIndices) {
        searchOpts.filteredLineIndices = filteredIndices;
      }

      const matches = await handler.search(searchOpts, (percent) => {
        const overallPercent = Math.round(((i + percent / 100) / totalConfigs) * 100);
        mainWindow?.webContents.send(IPC.SEARCH_CONFIG_BATCH_PROGRESS, { percent: overallPercent, configId: cfg.id });
      }, { cancelled: false });

      // If filter is active, remap line numbers
      if (filteredIndices && filteredIndices.length > 0) {
        const filteredSet = new Set(filteredIndices);
        const lineToFilteredIndex = new Map<number, number>();
        filteredIndices.forEach((lineNum, idx) => lineToFilteredIndex.set(lineNum, idx));

        results[cfg.id] = matches
          .filter(m => filteredSet.has(m.lineNumber))
          .map(m => ({
            lineNumber: lineToFilteredIndex.get(m.lineNumber) ?? m.lineNumber,
            column: m.column,
            length: m.length,
            lineText: m.lineText,
          }));
      } else {
        results[cfg.id] = matches.map(m => ({
          lineNumber: m.lineNumber,
          column: m.column,
          length: m.length,
          lineText: m.lineText,
        }));
      }
    } catch (error) {
      console.error(`Search config batch error for ${cfg.id}:`, error);
      results[cfg.id] = [];
    }
  }

  return { success: true, results };
});

ipcMain.handle(IPC.SEARCH_CONFIG_EXPORT, async (_, configId: string, lines: string[]) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };

  try {
    const baseName = path.basename(currentFilePath, path.extname(currentFilePath));
    const date = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const exportName = `${baseName}_search_${configId.substring(0, 8)}_${date}.txt`;
    const exportPath = path.join(path.dirname(currentFilePath), exportName);
    fs.writeFileSync(exportPath, lines.join('\n'), 'utf-8');
    return { success: true, filePath: exportPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
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

// Show file in OS file manager
ipcMain.handle('show-item-in-folder', async (_, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// Read entire file content (for Copy All)
ipcMain.handle('read-file-content', async (_, filePath: string) => {
  try {
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > 50) {
      return { success: false, error: 'File too large to copy (>50MB)' };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, sizeMB };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Save Selected Lines ===

ipcMain.handle('save-selected-lines', async (_, startLine: number, endLine: number, columnConfig?: ColumnConfig) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    // Get the lines - respect filter if active
    const filteredIndices = getFilteredLines();
    let lines;
    if (filteredIndices) {
      // Filter is active - only fetch visible lines within the range
      const visibleLineNumbers = filteredIndices.filter(ln => ln >= startLine && ln <= endLine);
      lines = [];
      for (const ln of visibleLineNumbers) {
        const [line] = handler.getLines(ln, 1);
        if (line) lines.push(line);
      }
    } else {
      const count = endLine - startLine + 1;
      lines = handler.getLines(startLine, count);
    }

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

    // Write lines to file, respecting column visibility
    const content = lines.map(l => filterLineToVisibleColumns(l.text, columnConfig)).join('\n');
    fs.writeFileSync(filePath, content, 'utf-8');

    if (currentFilePath) logActivity(currentFilePath, 'lines_saved', { startLine, endLine });

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
  targetFilePath?: string, // If provided, append to this file; otherwise create new
  columnConfig?: ColumnConfig
) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    // Get the lines - respect filter if active
    const filteredIndices = getFilteredLines();
    let lines;
    if (filteredIndices) {
      // Filter is active - only fetch visible lines within the range
      const visibleLineNumbers = filteredIndices.filter(ln => ln >= startLine && ln <= endLine);
      lines = [];
      for (const ln of visibleLineNumbers) {
        const [line] = handler.getLines(ln, 1);
        if (line) lines.push(line);
      }
    } else {
      const count = endLine - startLine + 1;
      lines = handler.getLines(startLine, count);
    }

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

    // Build the note entry
    const noteDesc = note ? ` | ${note}` : '';
    const newEntry = [
      '',
      `--- [${timestamp}] Lines ${startLine + 1}-${endLine + 1}${noteDesc} ---`,
      ...lines.map(l => filterLineToVisibleColumns(l.text, columnConfig)),
      '',
    ].join('\n');

    if (isNewFile) {
      content += newEntry;
      fs.writeFileSync(notesFilePath, content, 'utf-8');
    } else {
      // Simple append to existing file
      fs.appendFileSync(notesFilePath, newEntry, 'utf-8');
    }

    // Invalidate cache for this file so it gets re-indexed with new content
    fileHandlerCache.delete(notesFilePath);

    if (currentFilePath) logActivity(currentFilePath, 'notes_saved', { startLine, endLine });

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

    logActivity(currentFilePath, 'analysis_run', { analyzerName: analyzer.name });

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

// Advanced Filter Types
type FilterRuleType = 'contains' | 'not_contains' | 'level' | 'not_level' | 'regex' | 'not_regex';

interface FilterRule {
  id: string;
  type: FilterRuleType;
  value: string;
  caseSensitive?: boolean;
}

interface FilterGroup {
  id: string;
  operator: 'AND' | 'OR';
  rules: FilterRule[];
}

interface AdvancedFilterConfig {
  enabled: boolean;
  groups: FilterGroup[];
  contextLines?: number;
}

interface FilterConfig {
  levels: string[];
  includePatterns: string[];
  excludePatterns: string[];
  matchCase?: boolean;
  exactMatch?: boolean;
  contextLines?: number;
  advancedFilter?: AdvancedFilterConfig;
}

// Compile advanced filter for performance - pre-compile regex and prepare matchers
type CompiledMatcher = (text: string, level: string) => boolean;

function compileAdvancedFilter(config: AdvancedFilterConfig): CompiledMatcher {
  const compiledGroups = config.groups.map(group => {
    const compiledRules = group.rules.map(rule => {
      // Pre-compile regex if needed
      if (rule.type === 'regex' || rule.type === 'not_regex') {
        try {
          const regex = new RegExp(rule.value, rule.caseSensitive ? '' : 'i');
          return rule.type === 'regex'
            ? (text: string, _level: string) => regex.test(text)
            : (text: string, _level: string) => !regex.test(text);
        } catch {
          // Invalid regex - return matcher that always fails/passes
          return rule.type === 'regex'
            ? (_text: string, _level: string) => false
            : (_text: string, _level: string) => true;
        }
      }

      // Pre-lowercase for contains
      const pattern = rule.caseSensitive ? rule.value : rule.value.toLowerCase();

      switch (rule.type) {
        case 'contains':
          return (text: string, _level: string) =>
            (rule.caseSensitive ? text : text.toLowerCase()).includes(pattern);
        case 'not_contains':
          return (text: string, _level: string) =>
            !(rule.caseSensitive ? text : text.toLowerCase()).includes(pattern);
        case 'level':
          return (_text: string, level: string) => level.toLowerCase() === rule.value.toLowerCase();
        case 'not_level':
          return (_text: string, level: string) => level.toLowerCase() !== rule.value.toLowerCase();
        default:
          return (_text: string, _level: string) => true;
      }
    });

    // Return group evaluator
    return group.operator === 'AND'
      ? (text: string, level: string) => compiledRules.every(fn => fn(text, level))
      : (text: string, level: string) => compiledRules.some(fn => fn(text, level));
  });

  // Groups are AND'd together
  return (text: string, level: string) => compiledGroups.every(fn => fn(text, level));
}

// Cancellation signal for filter
let filterSignal = { cancelled: false };

ipcMain.handle('apply-filter', async (_, config: FilterConfig) => {
  const handler = getFileHandler();
  if (!handler || !currentFilePath) {
    return { success: false, error: 'No file open' };
  }

  filterSignal = { cancelled: false };

  try {
    const totalLines = handler.getTotalLines();
    const matchingLines: Set<number> = new Set();

    // Check if advanced filter is enabled
    const useAdvancedFilter = config.advancedFilter?.enabled && config.advancedFilter.groups.length > 0;
    const contextLines = useAdvancedFilter
      ? (config.advancedFilter?.contextLines || 0)
      : (config.contextLines || 0);

    // Compile advanced filter if enabled
    const advancedMatcher = useAdvancedFilter
      ? compileAdvancedFilter(config.advancedFilter!)
      : null;

    // For basic filter: separate include and exclude passes
    // Include matches get context window, exclude removes exact lines only
    const hasBasicExclude = !useAdvancedFilter && config.excludePatterns.length > 0;
    const excludeLines: Set<number> = new Set();

    // Pattern matching helper respecting matchCase and exactMatch options
    const caseSensitive = config.matchCase || false;
    const exactMatch = config.exactMatch || false;

    // Pre-compile regex patterns once for performance (avoid re-creating RegExp per line)
    type CompiledPattern = { regex: RegExp } | { literal: string; lowerLiteral: string };
    const compilePattern = (pattern: string): CompiledPattern => {
      if (exactMatch) {
        return { literal: pattern, lowerLiteral: pattern.toLowerCase() };
      }
      try {
        return { regex: new RegExp(pattern, caseSensitive ? '' : 'i') };
      } catch {
        return { literal: pattern, lowerLiteral: pattern.toLowerCase() };
      }
    };

    const compiledIncludePatterns = config.includePatterns.map(compilePattern);
    const compiledExcludePatterns = config.excludePatterns.map(compilePattern);

    const matchCompiled = (text: string, compiled: CompiledPattern): boolean => {
      if ('regex' in compiled) {
        return compiled.regex.test(text);
      }
      return caseSensitive
        ? text.includes(compiled.literal)
        : text.toLowerCase().includes(compiled.lowerLiteral);
    };

    // Process in batches for performance
    const batchSize = 10000;
    let processedLines = 0;
    let lastProgressUpdate = Date.now();

    for (let start = 0; start < totalLines; start += batchSize) {
      // Check for cancellation
      if (filterSignal.cancelled) {
        return { success: false, error: 'Cancelled' };
      }

      const count = Math.min(batchSize, totalLines - start);
      const lines = handler.getLines(start, count);

      for (const line of lines) {
        let matches = true;
        const lineLevel = line.level || 'other';

        if (useAdvancedFilter && advancedMatcher) {
          // Use advanced filter
          matches = advancedMatcher(line.text, lineLevel);
        } else {
          // Use basic filter

          // Level filter
          if (config.levels.length > 0) {
            matches = config.levels.includes(lineLevel);
          }

          // Include patterns (OR logic)
          if (matches && compiledIncludePatterns.length > 0) {
            matches = compiledIncludePatterns.some(cp => matchCompiled(line.text, cp));
          }

          // Track exclude matches separately (exact lines only)
          if (hasBasicExclude) {
            const excluded = compiledExcludePatterns.some(cp => matchCompiled(line.text, cp));
            if (excluded) {
              excludeLines.add(line.lineNumber);
            }
          }
        }

        if (matches) {
          matchingLines.add(line.lineNumber);
        }
      }

      processedLines += count;

      // Yield to event loop and send progress every 50ms to keep UI responsive
      const now = Date.now();
      if (now - lastProgressUpdate > 50) {
        await yieldToEventLoop();
        const progress = Math.round((processedLines / totalLines) * 100);
        mainWindow?.webContents.send('filter-progress', { percent: Math.min(progress, 99) });
        lastProgressUpdate = Date.now();
      }
    }

    // Add context lines around include matches (before exclude removal)
    if (contextLines > 0) {
      const matchArray = Array.from(matchingLines);
      for (const lineNum of matchArray) {
        for (let i = 1; i <= contextLines; i++) {
          if (lineNum - i >= 0) matchingLines.add(lineNum - i);
          if (lineNum + i < totalLines) matchingLines.add(lineNum + i);
        }
      }
    }

    // Remove exact exclude lines after context expansion
    if (hasBasicExclude) {
      for (const lineNum of excludeLines) {
        matchingLines.delete(lineNum);
      }
    }

    // Sort and store
    const sortedLines = Array.from(matchingLines).sort((a, b) => a - b);
    filterState.set(currentFilePath, sortedLines);

    logActivity(currentFilePath, 'filter_applied', { levels: config.levels, filteredLines: sortedLines.length });

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

ipcMain.handle('cancel-filter', async () => {
  filterSignal.cancelled = true;
  return { success: true };
});

ipcMain.handle('clear-filter', async () => {
  if (currentFilePath) {
    filterState.delete(currentFilePath);
    logActivity(currentFilePath, 'filter_cleared', {});
  }
  return { success: true };
});

// === Time Gap Detection ===

interface TimeGap {
  lineNumber: number;
  prevLineNumber: number;
  gapSeconds: number;
  prevTimestamp: string;
  currTimestamp: string;
  linePreview: string;
}

// Timestamp patterns for parsing
const TIME_GAP_PATTERNS = [
  // ISO format: 2024-01-25T10:00:01 or 2024-01-25 10:00:01
  /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/,
  // European format: DD.MM.YYYY HH:mm:ss (e.g., 02.01.2026 18:16:01.061)
  /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
  // Syslog format: Jan 25 10:00:01 (assumes current year)
  /([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/,
];

const MONTH_MAP: Record<string, number> = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
  'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
};

function parseTimestamp(text: string): Date | null {
  const sample = text.length > 100 ? text.substring(0, 100) : text;

  // Try ISO format first
  const isoMatch = sample.match(TIME_GAP_PATTERNS[0]);
  if (isoMatch) {
    const [, year, month, day, hour, min, sec] = isoMatch;
    return new Date(
      parseInt(year), parseInt(month) - 1, parseInt(day),
      parseInt(hour), parseInt(min), parseInt(sec)
    );
  }

  // Try European format: DD.MM.YYYY HH:mm:ss
  const euroMatch = sample.match(TIME_GAP_PATTERNS[1]);
  if (euroMatch) {
    const [, day, month, year, hour, min, sec] = euroMatch;
    return new Date(
      parseInt(year), parseInt(month) - 1, parseInt(day),
      parseInt(hour), parseInt(min), parseInt(sec)
    );
  }

  // Try syslog format
  const syslogMatch = sample.match(TIME_GAP_PATTERNS[2]);
  if (syslogMatch) {
    const [, monthStr, day, hour, min, sec] = syslogMatch;
    const month = MONTH_MAP[monthStr];
    if (month !== undefined) {
      const now = new Date();
      return new Date(
        now.getFullYear(), month, parseInt(day),
        parseInt(hour), parseInt(min), parseInt(sec)
      );
    }
  }

  return null;
}

function extractTimestampString(text: string): string | null {
  const sample = text.length > 100 ? text.substring(0, 100) : text;
  for (const pattern of TIME_GAP_PATTERNS) {
    const match = sample.match(pattern);
    if (match) return match[0];
  }
  return null;
}

interface TimeGapOptions {
  thresholdSeconds: number;
  startLine?: number;
  endLine?: number;
  startPattern?: string;
  endPattern?: string;
}

// Cancellation signal for time gap detection
let timeGapSignal = { cancelled: false };

// Helper to yield to event loop - use setTimeout for better yielding
const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

// Optimized timestamp parser - pre-compiled regex
const ISO_TIMESTAMP_REGEX = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;
const EURO_TIMESTAMP_REGEX = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/;
const SYSLOG_TIMESTAMP_REGEX = /([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/;

function parseTimestampFast(text: string): { date: Date; str: string } | null {
  // Check first 60 chars for performance (enough for most timestamp formats)
  const sample = text.length > 60 ? text.substring(0, 60) : text;

  // Try ISO format first (most common)
  const isoMatch = sample.match(ISO_TIMESTAMP_REGEX);
  if (isoMatch) {
    const [match, year, month, day, hour, min, sec] = isoMatch;
    return {
      date: new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec)),
      str: match,
    };
  }

  // Try European format: DD.MM.YYYY HH:mm:ss
  const euroMatch = sample.match(EURO_TIMESTAMP_REGEX);
  if (euroMatch) {
    const [match, day, month, year, hour, min, sec] = euroMatch;
    return {
      date: new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec)),
      str: match,
    };
  }

  // Try syslog format
  const syslogMatch = sample.match(SYSLOG_TIMESTAMP_REGEX);
  if (syslogMatch) {
    const [match, monthStr, day, hour, min, sec] = syslogMatch;
    const month = MONTH_MAP[monthStr];
    if (month !== undefined) {
      return {
        date: new Date(new Date().getFullYear(), month, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec)),
        str: match,
      };
    }
  }

  return null;
}

// Get timestamp from a specific line
ipcMain.handle(IPC.GET_LINE_TIMESTAMP, async (_, lineNumber: number) => {
  const handler = getFileHandler();
  if (!handler) {
    return { epochMs: null, timestampStr: null };
  }
  try {
    const lines = handler.getLines(lineNumber, 1);
    if (lines.length === 0) {
      return { epochMs: null, timestampStr: null };
    }
    const parsed = parseTimestampFast(lines[0].text);
    if (!parsed) {
      return { epochMs: null, timestampStr: null };
    }
    return { epochMs: parsed.date.getTime(), timestampStr: parsed.str };
  } catch {
    return { epochMs: null, timestampStr: null };
  }
});

ipcMain.handle('detect-time-gaps', async (_, options: TimeGapOptions) => {
  const handler = getFileHandler();
  if (!handler || !currentFilePath) {
    return { success: false, error: 'No file open' };
  }

  // Reset cancellation signal
  timeGapSignal = { cancelled: false };

  try {
    const totalLines = handler.getTotalLines();
    const gaps: TimeGap[] = [];
    const MAX_GAPS = 500; // Lower limit for faster response

    const thresholdSeconds = options.thresholdSeconds || 30;

    // Determine the line range to scan
    let scanStartLine = 0;
    let scanEndLine = totalLines - 1;
    let inRange = !options.startPattern;
    let foundStartPattern = false;
    let foundEndPattern = false;

    if (options.startLine && options.startLine > 0) {
      scanStartLine = options.startLine - 1;
      inRange = !options.startPattern;
    }
    if (options.endLine && options.endLine > 0) {
      scanEndLine = Math.min(options.endLine - 1, totalLines - 1);
    }

    let prevTimestamp: Date | null = null;
    let prevTimestampStr: string | null = null;
    let prevLineNumber = 0;

    // Adaptive batch size based on file size
    const linesToScan = scanEndLine - scanStartLine + 1;
    const batchSize = linesToScan > 100000 ? 2000 : 5000;
    let processedLines = 0;
    let lastProgressUpdate = Date.now();

    for (let start = scanStartLine; start <= scanEndLine && gaps.length < MAX_GAPS; start += batchSize) {
      // Check for cancellation
      if (timeGapSignal.cancelled) {
        return { success: false, error: 'Cancelled' };
      }

      const count = Math.min(batchSize, scanEndLine - start + 1);
      const lines = handler.getLines(start, count);

      for (const line of lines) {
        if (options.startPattern && !foundStartPattern) {
          if (line.text.includes(options.startPattern)) {
            foundStartPattern = true;
            inRange = true;
          }
        }

        if (options.endPattern && inRange && !foundEndPattern) {
          if (line.text.includes(options.endPattern)) {
            foundEndPattern = true;
          }
        }

        if (!inRange) continue;

        const parsed = parseTimestampFast(line.text);

        if (parsed && prevTimestamp) {
          const diffSeconds = (parsed.date.getTime() - prevTimestamp.getTime()) / 1000;

          if (Math.abs(diffSeconds) >= thresholdSeconds) {
            gaps.push({
              lineNumber: line.lineNumber,
              prevLineNumber: prevLineNumber,
              gapSeconds: Math.abs(diffSeconds),
              prevTimestamp: prevTimestampStr || '',
              currTimestamp: parsed.str,
              linePreview: line.text.length > 80 ? line.text.substring(0, 80) + '...' : line.text,
            });

            if (gaps.length >= MAX_GAPS) break;
          }
        }

        if (parsed) {
          prevTimestamp = parsed.date;
          prevTimestampStr = parsed.str;
          prevLineNumber = line.lineNumber;
        }

        if (foundEndPattern) break;
      }

      if (foundEndPattern || gaps.length >= MAX_GAPS) break;

      processedLines += count;

      // Yield and send progress every 50ms to keep UI responsive
      const now = Date.now();
      if (now - lastProgressUpdate > 50) {
        await yieldToEventLoop();
        const progress = Math.round((processedLines / linesToScan) * 100);
        mainWindow?.webContents.send('time-gap-progress', { percent: progress });
        lastProgressUpdate = now;
      }
    }

    gaps.sort((a, b) => b.gapSeconds - a.gapSeconds);

    if (currentFilePath) logActivity(currentFilePath, 'time_gap_analysis', { threshold: thresholdSeconds, gapsFound: gaps.length });

    return { success: true, gaps, totalLines };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('cancel-time-gaps', async () => {
  timeGapSignal.cancelled = true;
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

// === Format JSON File (streaming - handles any file size) ===

function streamFormatJson(inputPath: string, outputPath: string, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const stats = fs.statSync(inputPath);
    const fileSize = stats.size;

    const readStream = fs.createReadStream(inputPath, { encoding: 'utf-8', highWaterMark: 1024 * 1024 }); // 1MB chunks
    const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

    let inString = false;
    let escaped = false;
    let depth = 0;
    let afterOpenOrComma = false;
    let bytesRead = 0;
    let lastProgressPercent = 0;
    let outputBuffer = '';
    const FLUSH_SIZE = 256 * 1024; // Flush every 256KB

    const indent = (d: number) => '  '.repeat(d);

    const flush = () => {
      if (outputBuffer.length > 0) {
        writeStream.write(outputBuffer);
        outputBuffer = '';
      }
    };

    const write = (s: string) => {
      outputBuffer += s;
      if (outputBuffer.length >= FLUSH_SIZE) flush();
    };

    readStream.on('data', (rawChunk: string | Buffer) => {
      const chunk = typeof rawChunk === 'string' ? rawChunk : rawChunk.toString('utf-8');
      bytesRead += Buffer.byteLength(chunk, 'utf-8');

      for (let i = 0; i < chunk.length; i++) {
        const char = chunk[i];

        if (escaped) {
          write(char);
          escaped = false;
          continue;
        }

        if (inString) {
          if (char === '\\') { escaped = true; }
          else if (char === '"') { inString = false; }
          write(char);
          continue;
        }

        // Outside string - skip existing whitespace
        if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue;

        if (char === '"') {
          if (afterOpenOrComma) { write('\n' + indent(depth)); afterOpenOrComma = false; }
          write(char);
          inString = true;
          continue;
        }

        if (char === '{' || char === '[') {
          if (afterOpenOrComma) { write('\n' + indent(depth)); afterOpenOrComma = false; }
          write(char);
          depth++;
          afterOpenOrComma = true;
          continue;
        }

        if (char === '}' || char === ']') {
          afterOpenOrComma = false;
          depth--;
          write('\n' + indent(depth) + char);
          continue;
        }

        if (char === ',') {
          write(char);
          afterOpenOrComma = true;
          continue;
        }

        if (char === ':') {
          write(': ');
          continue;
        }

        // Literal characters (digits, -, t, r, u, e, f, a, l, s, n)
        if (afterOpenOrComma) { write('\n' + indent(depth)); afterOpenOrComma = false; }
        write(char);
      }

      // Report progress
      const percent = Math.min(99, Math.round((bytesRead / fileSize) * 100));
      if (percent > lastProgressPercent) {
        lastProgressPercent = percent;
        if (onProgress) onProgress(percent);
      }
    });

    readStream.on('end', () => {
      write('\n');
      flush();
      writeStream.end(() => {
        if (onProgress) onProgress(100);
        resolve();
      });
    });

    readStream.on('error', (err) => {
      writeStream.destroy();
      reject(err);
    });

    writeStream.on('error', (err) => {
      readStream.destroy();
      reject(err);
    });
  });
}

ipcMain.handle('format-json-file', async (_, filePath: string) => {
  try {
    const stats = fs.statSync(filePath);
    console.log(`[JSON Format] File size: ${stats.size} bytes`);

    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath);
    const formattedPath = path.join(dir, `${baseName}.formatted${ext}`);

    // For very large files, warn about size limits
    const MAX_FORMATTED_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB

    await streamFormatJson(filePath, formattedPath, (percent) => {
      mainWindow?.webContents.send('json-format-progress', { percent });
    });

    const writtenStats = fs.statSync(formattedPath);
    console.log(`[JSON Format] Done. Output: ${writtenStats.size} bytes`);

    if (writtenStats.size > MAX_FORMATTED_SIZE) {
      // Clean up - file too large to index efficiently
      try { fs.unlinkSync(formattedPath); } catch { /* ignore */ }
      return { success: false, error: `Formatted output is too large (${(writtenStats.size / 1024 / 1024 / 1024).toFixed(1)} GB). The file has too many nested elements to reformat in-app. Try using the integrated terminal: jq . "${path.basename(filePath)}" > formatted.json` };
    }

    return { success: true, formattedPath };
  } catch (error) {
    console.error(`[JSON Format] Error:`, error);
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

// === Datadog Integration ===

let datadogFetchSignal: { cancelled: boolean } = { cancelled: false };

ipcMain.handle(IPC.DATADOG_LOAD_CONFIG, async () => {
  const config = loadDatadogConfig();
  if (config) {
    // Return config but mask the keys for display
    return { success: true, config: { site: config.site, hasApiKey: !!config.apiKey, hasAppKey: !!config.appKey } };
  }
  return { success: true, config: null };
});

ipcMain.handle(IPC.DATADOG_SAVE_CONFIG, async (_, config: DatadogConfig | null) => {
  try {
    if (config === null) {
      clearDatadogConfig();
    } else {
      saveDatadogConfig(config);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.DATADOG_FETCH_LOGS, async (_, params: DatadogFetchParams) => {
  const config = loadDatadogConfig();
  if (!config || !config.apiKey || !config.appKey) {
    return { success: false, error: 'Datadog not configured. Add credentials in Settings.' };
  }

  datadogFetchSignal = { cancelled: false };

  const result = await fetchDatadogLogs(
    config,
    params,
    (message, count) => {
      mainWindow?.webContents.send(IPC.DATADOG_FETCH_PROGRESS, { message, count });
    },
    datadogFetchSignal
  );

  return result;
});

ipcMain.handle(IPC.DATADOG_CANCEL_FETCH, async () => {
  datadogFetchSignal.cancelled = true;
  return { success: true };
});

// === Local File Status & Activity History ===

ipcMain.handle(IPC.GET_LOCAL_FILE_STATUS, async () => {
  if (!currentFilePath) return { exists: false, writable: false, localPath: null };
  const writable = canWriteLocal(currentFilePath);
  const localPath = getLocalFilePath(currentFilePath);
  const exists = writable && fs.existsSync(localPath);
  return { exists, writable, localPath };
});

ipcMain.handle(IPC.LOAD_ACTIVITY_HISTORY, async () => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const data = loadLocalFileData(currentFilePath);
  return { success: true, history: data.activityHistory };
});

ipcMain.handle(IPC.CLEAR_ACTIVITY_HISTORY, async () => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const data = loadLocalFileData(currentFilePath);
  data.activityHistory = [];
  saveLocalFileData(currentFilePath, data);
  return { success: true };
});

// Notes drawer — load/save freeform notes from .logan/<filename>.notes.txt
ipcMain.handle('load-notes', async () => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const notesPath = path.join(getLocalLoganDir(currentFilePath),
    path.basename(currentFilePath) + '.notes.txt');
  try {
    const content = fs.readFileSync(notesPath, 'utf-8');
    return { success: true, content };
  } catch {
    return { success: true, content: '' };
  }
});

ipcMain.handle('save-notes', async (_e: any, content: string) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  if (!ensureLocalLoganDir(currentFilePath)) {
    return { success: false, error: 'Cannot write to local .logan/ directory' };
  }
  const notesPath = path.join(getLocalLoganDir(currentFilePath),
    path.basename(currentFilePath) + '.notes.txt');
  fs.writeFileSync(notesPath, content, 'utf-8');
  return { success: true };
});
