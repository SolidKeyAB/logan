import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, execSync, spawnSync } from 'child_process';
// Lazy-loaded: node-pty causes SIGSEGV on Linux when bindings mismatch
let pty: typeof import('node-pty') | null = null;
if (process.platform !== 'linux') {
  try {
    pty = require('node-pty');
  } catch {
    console.warn('node-pty not available — terminal feature disabled');
  }
} else {
  console.warn('node-pty not available on Linux — using child_process fallback for terminal');
}
import { FileHandler, filterLineToVisibleColumns, ColumnConfig } from './fileHandler';
import { IPC, SearchOptions, Bookmark, Highlight, HighlightGroup, SearchConfig, SearchConfigSession, ActivityEntry, LocalFileData, LiveConnectionInfo, ContextDefinition, ContextPattern, ContextMatchGroup, Annotation } from '../shared/types';
import * as Diff from 'diff';
import { analyzerRegistry, AnalyzerOptions, AnalysisResult } from './analyzers';
import { loadDatadogConfig, saveDatadogConfig, clearDatadogConfig, fetchDatadogLogs, DatadogConfig, DatadogFetchParams } from './datadogClient';
import { startApiServer, stopApiServer, ApiContext, addChatMessage, getChatMessages, getSseClientCount, getAgentName } from './api-server';
import { BaselineStore, buildFingerprint } from './baselineStore';
// Native-dependent modules — lazy-loaded to prevent SIGSEGV if bindings aren't built
let SerialHandler: any = null;
let LogcatHandler: any = null;
let SshHandler: any = null;
let SshClient: any = null;
if (process.platform !== 'linux') {
  try { SerialHandler = require('./serialHandler').SerialHandler; } catch { console.warn('serialport not available — serial feature disabled'); }
  try { SshHandler = require('./sshHandler').SshHandler; } catch { console.warn('ssh2 not available — SSH feature disabled'); }
  try { SshClient = require('ssh2').Client; } catch {}
} else {
  console.warn('serialport not available on Linux — serial feature disabled');
  // ssh2 bundles native .node addons (sshcrypto, cpu-features) that SIGSEGV on Linux
  // due to Electron ABI mismatch. Block .node loading so ssh2 uses pure JS fallbacks.
  const Module = require('module');
  const origNodeExt = Module._extensions['.node'];
  Module._extensions['.node'] = function(_mod: any, filename: string) {
    throw new Error(`Native module blocked on Linux: ${filename}`);
  };
  try { SshHandler = require('./sshHandler').SshHandler; } catch { console.warn('ssh2 not available — SSH feature disabled'); }
  try { SshClient = require('ssh2').Client; } catch {}
  Module._extensions['.node'] = origNodeExt;
  console.log('ssh2 loaded with pure JS crypto fallback');
}
try { LogcatHandler = require('./logcatHandler').LogcatHandler; } catch { console.warn('logcatHandler not available'); }
import { SshProfile, SavedConnection } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let searchSignal: { cancelled: boolean } = { cancelled: false };
let diffSignal: { cancelled: boolean } = { cancelled: false };
let currentFilePath: string | null = null;

// Built-in agent child process
import type { ChildProcess } from 'child_process';
let agentProcess: ChildProcess | null = null;

// Live connection registry (replaces per-source singletons)
interface LiveConnection {
  id: string;
  source: 'serial' | 'logcat' | 'ssh';
  handler: any;
  tempFilePath: string;
  displayName: string;
  detail: string;
  config: any;
  connectedSince: number;
  connected: boolean;
  listeners: Array<{ event: string; fn: (...args: any[]) => void }>;
}

const liveConnections = new Map<string, LiveConnection>();
const MAX_LIVE_CONNECTIONS = 4;

// Keep one SshHandler for SFTP/profile operations (not for live connections)
const sshUtilHandler = SshHandler ? new SshHandler() : null;

// Baseline store (JSON file in ~/.logan/baselines.json)
const baselineStore = new BaselineStore();

// Cache last analysis result per file for baseline fingerprinting (capped)
const analysisResultCache = new Map<string, AnalysisResult>();

function cacheAnalysisResult(filePath: string, result: AnalysisResult): void {
  if (analysisResultCache.has(filePath)) {
    analysisResultCache.delete(filePath);
  }
  if (analysisResultCache.size >= MAX_CACHED_FILES) {
    const firstKey = analysisResultCache.keys().next().value;
    if (firstKey) analysisResultCache.delete(firstKey);
  }
  analysisResultCache.set(filePath, result);
}

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
  const handler = fileHandlerCache.get(currentFilePath);
  if (handler) {
    // Move to end for LRU ordering
    fileHandlerCache.delete(currentFilePath);
    fileHandlerCache.set(currentFilePath, handler);
  }
  return handler || null;
}

function addToCache(filePath: string, handler: FileHandler): void {
  // If already cached, remove so it goes to end (most-recently-used)
  if (fileHandlerCache.has(filePath)) {
    fileHandlerCache.delete(filePath);
  }
  // If cache is full, evict least-recently-used (first entry) and close its fd
  if (fileHandlerCache.size >= MAX_CACHED_FILES) {
    const firstKey = fileHandlerCache.keys().next().value;
    if (firstKey) {
      const evicted = fileHandlerCache.get(firstKey);
      if (evicted) evicted.close();
      fileHandlerCache.delete(firstKey);
    }
  }
  fileHandlerCache.set(filePath, handler);
}

// In-memory storage
const bookmarks = new Map<string, Bookmark>();
const highlights = new Map<string, Highlight>();
const annotations = new Map<string, Annotation>();

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

// Recent files (global, for quick re-open)
const RECENT_FILES_CAP = 20;

function getRecentFilesPath(): string {
  return path.join(os.homedir(), '.logan', 'recent-files.json');
}

function loadRecentFiles(): Array<{ path: string; lastOpened: number }> {
  try {
    const data = fs.readFileSync(getRecentFilesPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* missing or invalid */ }
  return [];
}

function saveRecentFiles(list: Array<{ path: string; lastOpened: number }>): void {
  try {
    const dir = path.join(os.homedir(), '.logan');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getRecentFilesPath(), JSON.stringify(list, null, 2));
  } catch { /* ignore */ }
}

function addToRecentFiles(filePath: string): void {
  const list = loadRecentFiles().filter(e => e.path !== filePath);
  list.unshift({ path: filePath, lastOpened: Date.now() });
  if (list.length > RECENT_FILES_CAP) list.length = RECENT_FILES_CAP;
  saveRecentFiles(list);
}

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

// --- Agent Annotations ---

function loadAnnotationsForFile(filePath: string): void {
  annotations.clear();
  if (canWriteLocal(filePath)) {
    const localData = loadLocalFileData(filePath);
    for (const a of localData.annotations || []) {
      annotations.set(a.id, a);
    }
  }
}

function saveAnnotationsForCurrentFile(): void {
  if (!currentFilePath || !currentFileUsesLocalStorage) return;
  const localData = loadLocalFileData(currentFilePath);
  localData.annotations = Array.from(annotations.values())
    .sort((a, b) => a.lineNumber - b.lineNumber);
  saveLocalFileData(currentFilePath, localData);
}

function pushAnnotationsToRenderer(): void {
  const list = Array.from(annotations.values()).sort((a, b) => a.lineNumber - b.lineNumber);
  mainWindow?.webContents.send('annotations-changed', list);
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

// --- Single-instance lock (skipped on Linux — can SIGSEGV on some setups) ---
if (process.platform !== 'linux') {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  }
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const filePath = extractFilePathFromArgv(argv);
    if (filePath && mainWindow) {
      mainWindow.webContents.send('open-file-from-cli', filePath);
    }
  });
}

function extractFilePathFromArgv(argv: string[]): string | null {
  // argv layout: [electron, app-path, ...flags, --, filePath]
  // or: [electron, app-path, filePath] (no --)
  const dashDashIdx = argv.indexOf('--');
  if (dashDashIdx !== -1 && dashDashIdx + 1 < argv.length) {
    return argv[dashDashIdx + 1];
  }
  // Fallback: last arg that looks like a file path (not a flag, not electron path)
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i];
    if (arg.startsWith('-')) continue;
    // Skip the electron binary and app directory
    if (arg.includes('electron') || arg.includes('node_modules')) continue;
    if (fs.existsSync(arg) && fs.statSync(arg).isFile()) return arg;
  }
  return null;
}

app.whenReady().then(() => {
  ensureConfigDir();
  createWindow();

  // Check if launched with a file path argument (e.g. `logan myfile.log`)
  const cliFilePath = extractFilePathFromArgv(process.argv);
  if (cliFilePath && mainWindow) {
    mainWindow.once('ready-to-show', () => {
      // Small delay to let renderer finish init
      setTimeout(() => {
        mainWindow?.webContents.send('open-file-from-cli', cliFilePath);
      }, 300);
    });
  }

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
      loadAnnotationsForFile(filePath);
      pushAnnotationsToRenderer();
      if (canWriteLocal(filePath)) {
        const localData = loadLocalFileData(filePath);
        localData.lastOpened = new Date().toISOString();
        saveLocalFileData(filePath, localData);
      }
      logActivity(filePath, 'file_opened', { filePath });
      // Notify renderer to load the file in the UI
      mainWindow?.webContents.send('open-file-from-cli', filePath);
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
        cacheAnalysisResult(currentFilePath, result);
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
              matches = config.includePatterns.some((p: any) => {
                const pattern = typeof p === 'string' ? p : p.pattern;
                const cs = typeof p === 'string' ? (config.matchCase || false) : p.caseSensitive;
                try { return new RegExp(pattern, cs ? '' : 'i').test(line.text); }
                catch { return cs ? line.text.includes(pattern) : line.text.toLowerCase().includes(pattern.toLowerCase()); }
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
    removeBookmark: (id: string) => {
      bookmarks.delete(id);
      saveBookmarksForCurrentFile();
      if (currentFilePath) logActivity(currentFilePath, 'bookmark_removed', { bookmarkId: id });
      return { success: true };
    },
    updateBookmark: (bookmark: Bookmark) => {
      if (!bookmarks.has(bookmark.id)) return { success: false, error: 'Bookmark not found' };
      bookmarks.set(bookmark.id, bookmark);
      saveBookmarksForCurrentFile();
      return { success: true };
    },
    clearBookmarks: () => {
      const count = bookmarks.size;
      bookmarks.clear();
      saveBookmarksForCurrentFile();
      if (currentFilePath && count > 0) logActivity(currentFilePath, 'bookmark_cleared', { count });
      return { success: true };
    },
    addHighlight: (highlight: Highlight) => {
      highlights.set(highlight.id, highlight);
      saveHighlight(highlight);
      if (currentFilePath) logActivity(currentFilePath, 'highlight_added', { pattern: highlight.pattern, isGlobal: !!highlight.isGlobal });
      return { success: true };
    },
    removeHighlight: (id: string) => {
      highlights.delete(id);
      removeHighlightFromStore(id);
      if (currentFilePath) logActivity(currentFilePath, 'highlight_removed', { highlightId: id });
      return { success: true };
    },
    updateHighlight: (highlight: Highlight) => {
      if (!highlights.has(highlight.id)) return { success: false, error: 'Highlight not found' };
      highlights.set(highlight.id, highlight);
      saveHighlight(highlight);
      return { success: true };
    },
    clearHighlights: () => {
      highlights.clear();
      saveHighlightsStore({});
      if (currentFilePath && currentFileUsesLocalStorage) {
        const localData = loadLocalFileData(currentFilePath);
        localData.highlights = [];
        saveLocalFileData(currentFilePath, localData);
      }
      return { success: true };
    },
    getAnnotations: () => annotations,
    addAnnotation: (annotation: Annotation) => {
      annotations.set(annotation.id, annotation);
      saveAnnotationsForCurrentFile();
      if (currentFilePath) logActivity(currentFilePath, 'annotation_added', { lineNumber: annotation.lineNumber, agentName: annotation.agentName });
      pushAnnotationsToRenderer();
      return { success: true };
    },
    removeAnnotation: (id: string) => {
      annotations.delete(id);
      saveAnnotationsForCurrentFile();
      pushAnnotationsToRenderer();
      return { success: true };
    },
    clearAnnotations: () => {
      annotations.clear();
      saveAnnotationsForCurrentFile();
      pushAnnotationsToRenderer();
      return { success: true };
    },
    loadNotes: async () => {
      if (!currentFilePath) return { success: false, error: 'No file open' };
      const notesPath = path.join(getLocalLoganDir(currentFilePath),
        path.basename(currentFilePath) + '.notes.txt');
      try {
        const content = fs.readFileSync(notesPath, 'utf-8');
        return { success: true, content };
      } catch {
        return { success: true, content: '' };
      }
    },
    getAgentMemory: () => getAgentMemory(currentFilePath),
    saveAgentMemory: (content: string, agentName?: string) =>
      saveAgentMemory(currentFilePath, content, agentName),
    clearAgentMemory: () => clearAgentMemory(currentFilePath),
    saveNotes: async (content: string) => {
      if (!currentFilePath) return { success: false, error: 'No file open' };
      if (!ensureLocalLoganDir(currentFilePath)) {
        return { success: false, error: 'Cannot write to local .logan/ directory' };
      }
      const notesPath = path.join(getLocalLoganDir(currentFilePath),
        path.basename(currentFilePath) + '.notes.txt');
      fs.writeFileSync(notesPath, content, 'utf-8');
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
    getBaselineStore: () => baselineStore,
    getAnalysisResult: () => {
      if (!currentFilePath) return null;
      return analysisResultCache.get(currentFilePath) || null;
    },
    getLinesRaw: (startLine: number, count: number) => {
      const handler = getFileHandler();
      if (!handler) return { success: false, error: 'No file open' };
      const lines = handler.getLines(startLine, count);
      return { success: true, lines };
    },
    investigateCrashes: async (options) => {
      const handler = getFileHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      const contextLines = options.contextLines ?? 10;
      const maxCrashes = options.maxCrashes ?? 20;

      // Get or run analysis
      let analysisResult = analysisResultCache.get(currentFilePath);
      if (!analysisResult) {
        const analyzer = analyzerRegistry.getDefault();
        if (!analyzer) return { success: false, error: 'No analyzer available' };
        analyzeSignal = { cancelled: false };
        analysisResult = await analyzer.analyze(currentFilePath, {}, () => {}, analyzeSignal);
        cacheAnalysisResult(currentFilePath, analysisResult);
      }

      const crashes = analysisResult.insights.crashes.slice(0, maxCrashes);
      const totalLines = handler.getTotalLines();

      // Group by keyword
      const crashesByKeyword: Record<string, number> = {};
      for (const c of analysisResult.insights.crashes) {
        crashesByKeyword[c.keyword] = (crashesByKeyword[c.keyword] || 0) + 1;
      }

      // Collect context for each crash
      const crashDetails = crashes.map(c => {
        const startIdx = Math.max(0, c.lineNumber - contextLines);
        const endIdx = Math.min(totalLines - 1, c.lineNumber + contextLines);
        const rawLines = handler.getLines(startIdx, endIdx - startIdx + 1);

        const contextBefore: { lineNumber: number; text: string; level?: string }[] = [];
        const contextAfter: { lineNumber: number; text: string; level?: string }[] = [];
        let crashLine = '';

        for (const line of rawLines) {
          if (line.lineNumber < c.lineNumber) {
            contextBefore.push({ lineNumber: line.lineNumber, text: line.text, level: line.level });
          } else if (line.lineNumber === c.lineNumber) {
            crashLine = line.text;
          } else {
            contextAfter.push({ lineNumber: line.lineNumber, text: line.text, level: line.level });
          }
        }

        return {
          lineNumber: c.lineNumber,
          keyword: c.keyword,
          level: c.level || 'error',
          component: c.channel || null,
          crashLine,
          contextBefore,
          contextAfter,
        };
      });

      // Optionally bookmark crash sites
      let bookmarksAdded = 0;
      if (options.autoBookmark) {
        for (const c of crashDetails) {
          const id = `crash-${c.lineNumber}-${Date.now()}`;
          const bm: Bookmark = {
            id,
            lineNumber: c.lineNumber,
            label: `Crash: ${c.keyword}`,
            color: '#ff4444',
          };
          bookmarks.set(bm.id, bm);
          bookmarksAdded++;
        }
        saveBookmarksForCurrentFile();
      }

      // Optionally highlight crash keywords
      const highlightsAdded: string[] = [];
      if (options.autoHighlight) {
        const uniqueKeywords = [...new Set(crashes.map(c => c.keyword))];
        for (const kw of uniqueKeywords) {
          const existing = Array.from(highlights.values()).find(h => h.pattern === kw);
          if (!existing) {
            const hl: Highlight = {
              id: `hl-crash-${kw}-${Date.now()}`,
              pattern: kw,
              isRegex: false,
              matchCase: false,
              backgroundColor: '#ff4444',
              highlightAll: true,
              isGlobal: false,
              includeWhitespace: false,
            };
            highlights.set(hl.id, hl);
            highlightsAdded.push(kw);
          }
        }
        if (highlightsAdded.length > 0) {
          for (const hl of highlights.values()) {
            saveHighlight(hl);
          }
        }
      }

      return {
        success: true,
        totalCrashesFound: analysisResult.insights.crashes.length,
        crashesByKeyword,
        crashes: crashDetails,
        bookmarksAdded,
        highlightsAdded,
      };
    },
    investigateComponent: async (options) => {
      const handler = getFileHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      const component = options.component;
      const maxSamplesPerLevel = options.maxSamplesPerLevel ?? 5;
      const includeErrorContext = options.includeErrorContext ?? true;
      const contextLines = options.contextLines ?? 5;

      // Get or run analysis
      let analysisResult = analysisResultCache.get(currentFilePath);
      if (!analysisResult) {
        const analyzer = analyzerRegistry.getDefault();
        if (!analyzer) return { success: false, error: 'No analyzer available' };
        analyzeSignal = { cancelled: false };
        analysisResult = await analyzer.analyze(currentFilePath, {}, () => {}, analyzeSignal);
        cacheAnalysisResult(currentFilePath, analysisResult);
      }

      // Search for component mentions
      const searchOpts: SearchOptions = {
        pattern: component,
        isRegex: false,
        isWildcard: false,
        matchCase: false,
        wholeWord: false,
      };
      searchSignal = { cancelled: false };
      const matches = await handler.search(searchOpts, () => {}, searchSignal);

      if (matches.length === 0) {
        return { success: true, component, found: false, totalMentions: 0 };
      }

      // Categorize by level
      const levelBuckets: Record<string, { lineNumber: number; text: string }[]> = {};
      const totalLines = handler.getTotalLines();
      for (const m of matches) {
        // Get the line to determine its level
        const [lineData] = handler.getLines(m.lineNumber, 1);
        const level = lineData?.level || 'other';
        if (!levelBuckets[level]) levelBuckets[level] = [];
        levelBuckets[level].push({ lineNumber: m.lineNumber, text: m.lineText });
      }

      // Pick evenly-spaced samples per level
      const samplesByLevel: Record<string, { lineNumber: number; text: string }[]> = {};
      const levelBreakdown: Record<string, number> = {};
      for (const [level, items] of Object.entries(levelBuckets)) {
        levelBreakdown[level] = items.length;
        if (items.length <= maxSamplesPerLevel) {
          samplesByLevel[level] = items;
        } else {
          const step = items.length / maxSamplesPerLevel;
          samplesByLevel[level] = [];
          for (let i = 0; i < maxSamplesPerLevel; i++) {
            samplesByLevel[level].push(items[Math.floor(i * step)]);
          }
        }
      }

      // Get error context sites
      const errorSites: any[] = [];
      if (includeErrorContext && levelBuckets['error']) {
        const errorLines = levelBuckets['error'];
        const maxErrorSites = Math.min(10, errorLines.length);
        const step = errorLines.length > maxErrorSites ? errorLines.length / maxErrorSites : 1;
        for (let i = 0; i < maxErrorSites; i++) {
          const errLine = errorLines[Math.floor(i * step)];
          const startIdx = Math.max(0, errLine.lineNumber - contextLines);
          const endIdx = Math.min(totalLines - 1, errLine.lineNumber + contextLines);
          const rawLines = handler.getLines(startIdx, endIdx - startIdx + 1);
          const contextBefore: { lineNumber: number; text: string }[] = [];
          const contextAfter: { lineNumber: number; text: string }[] = [];
          for (const line of rawLines) {
            if (line.lineNumber < errLine.lineNumber) {
              contextBefore.push({ lineNumber: line.lineNumber, text: line.text });
            } else if (line.lineNumber > errLine.lineNumber) {
              contextAfter.push({ lineNumber: line.lineNumber, text: line.text });
            }
          }
          errorSites.push({
            lineNumber: errLine.lineNumber,
            errorLine: errLine.text,
            contextBefore,
            contextAfter,
          });
        }
      }

      // Time range of component mentions
      let timeRange: { firstSeen: string; lastSeen: string } | null = null;
      const firstMatch = matches[0];
      const lastMatch = matches[matches.length - 1];
      const [firstLine] = handler.getLines(firstMatch.lineNumber, 1);
      const [lastLine] = handler.getLines(lastMatch.lineNumber, 1);
      if (firstLine && lastLine) {
        const firstTs = parseTimestampFast(firstLine.text);
        const lastTs = parseTimestampFast(lastLine.text);
        if (firstTs && lastTs) {
          timeRange = { firstSeen: firstTs.str, lastSeen: lastTs.str };
        }
      }

      // Check if this is a top failer
      const isTopFailer = analysisResult.insights.topFailingComponents.some(
        fc => fc.name.toLowerCase() === component.toLowerCase()
      );

      return {
        success: true,
        component,
        found: true,
        totalMentions: matches.length,
        levelBreakdown,
        timeRange,
        isTopFailer,
        samplesByLevel,
        errorSites,
      };
    },
    investigateTimerange: async (options) => {
      const handler = getFileHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      const totalLines = handler.getTotalLines();
      const maxSamples = options.maxSamples ?? 20;

      // Parse requested start/end times
      const requestedStart = new Date(options.startTime);
      const requestedEnd = new Date(options.endTime);
      if (isNaN(requestedStart.getTime()) || isNaN(requestedEnd.getTime())) {
        return { success: false, error: 'Invalid startTime or endTime format' };
      }

      // Binary search to find the start line of the time window
      const h = handler; // capture for nested function
      function findTimeBoundary(targetTime: Date, findFirst: boolean): number {
        let lo = 0, hi = totalLines - 1;
        let result = findFirst ? totalLines : -1;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const [line] = h.getLines(mid, 1);
          if (!line) { lo = mid + 1; continue; }
          const parsed = parseTimestampFast(line.text);
          if (!parsed) {
            // No timestamp — scan forward a bit
            lo = mid + 1;
            continue;
          }
          if (findFirst) {
            if (parsed.date >= targetTime) {
              result = mid;
              hi = mid - 1;
            } else {
              lo = mid + 1;
            }
          } else {
            if (parsed.date <= targetTime) {
              result = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
        }
        return result;
      }

      const startLine = findTimeBoundary(requestedStart, true);
      const endLine = findTimeBoundary(requestedEnd, false);

      if (startLine >= totalLines || endLine < 0 || startLine > endLine) {
        return {
          success: true,
          timeRange: {
            requestedStart: options.startTime,
            requestedEnd: options.endTime,
            actualStart: null,
            actualEnd: null,
          },
          lineRange: { startLine: 0, endLine: 0, lineCount: 0 },
          levelCounts: {},
          crashes: [],
          activeComponents: [],
          timeGaps: [],
          samples: { errors: [], warnings: [], firstLines: [], lastLines: [] },
        };
      }

      const lineCount = endLine - startLine + 1;

      // Scan the range
      const levelCounts: Record<string, number> = {};
      const crashes: { lineNumber: number; keyword: string; text: string }[] = [];
      const componentMentions: Record<string, { lineCount: number; errorCount: number }> = {};
      const CRASH_KEYWORDS = ['fatal', 'panic', 'crash', 'exception', 'segfault', 'abort', 'oom', 'killed', 'core dump'];
      const timeGaps: { lineNumber: number; gapSeconds: number; prevTimestamp: string; currTimestamp: string }[] = [];
      let prevTimestamp: Date | null = null;
      let prevTimestampStr = '';
      let actualStart: string | null = null;
      let actualEnd: string | null = null;

      // Collect samples
      const errorSamples: { lineNumber: number; text: string }[] = [];
      const warningSamples: { lineNumber: number; text: string }[] = [];
      const firstLines: { lineNumber: number; text: string }[] = [];
      const lastLines: { lineNumber: number; text: string }[] = [];

      const batchSize = 5000;
      for (let start = startLine; start <= endLine; start += batchSize) {
        const count = Math.min(batchSize, endLine - start + 1);
        const lines = handler.getLines(start, count);
        for (const line of lines) {
          // Level counting
          const level = line.level || 'other';
          levelCounts[level] = (levelCounts[level] || 0) + 1;

          // Crash keyword detection
          const textLower = line.text.toLowerCase();
          for (const kw of CRASH_KEYWORDS) {
            if (textLower.includes(kw)) {
              crashes.push({ lineNumber: line.lineNumber, keyword: kw, text: line.text });
              break;
            }
          }

          // Timestamp tracking
          const parsed = parseTimestampFast(line.text);
          if (parsed) {
            if (!actualStart) actualStart = parsed.str;
            actualEnd = parsed.str;
            if (prevTimestamp) {
              const diffSec = Math.abs((parsed.date.getTime() - prevTimestamp.getTime()) / 1000);
              if (diffSec >= 30) {
                timeGaps.push({
                  lineNumber: line.lineNumber,
                  gapSeconds: diffSec,
                  prevTimestamp: prevTimestampStr,
                  currTimestamp: parsed.str,
                });
              }
            }
            prevTimestamp = parsed.date;
            prevTimestampStr = parsed.str;
          }

          // Collect first/last lines
          if (line.lineNumber - startLine < 5) {
            firstLines.push({ lineNumber: line.lineNumber, text: line.text });
          }
          if (endLine - line.lineNumber < 5) {
            lastLines.push({ lineNumber: line.lineNumber, text: line.text });
          }

          // Collect error/warning samples (up to maxSamples each)
          if (level === 'error' && errorSamples.length < maxSamples) {
            errorSamples.push({ lineNumber: line.lineNumber, text: line.text });
          }
          if (level === 'warning' && warningSamples.length < maxSamples) {
            warningSamples.push({ lineNumber: line.lineNumber, text: line.text });
          }
        }
      }

      // Sort time gaps by duration descending, keep top 10
      timeGaps.sort((a, b) => b.gapSeconds - a.gapSeconds);
      const topTimeGaps = timeGaps.slice(0, 10);

      // Pick evenly-spaced error/warning samples
      function pickEvenlySpaced(arr: { lineNumber: number; text: string }[], max: number) {
        if (arr.length <= max) return arr;
        const step = arr.length / max;
        const result: typeof arr = [];
        for (let i = 0; i < max; i++) {
          result.push(arr[Math.floor(i * step)]);
        }
        return result;
      }

      return {
        success: true,
        timeRange: {
          requestedStart: options.startTime,
          requestedEnd: options.endTime,
          actualStart,
          actualEnd,
        },
        lineRange: { startLine, endLine, lineCount },
        levelCounts,
        crashes: crashes.slice(0, 50),
        activeComponents: [], // Would need component parsing which is analyzer-specific
        timeGaps: topTimeGaps,
        samples: {
          errors: pickEvenlySpaced(errorSamples, maxSamples),
          warnings: pickEvenlySpaced(warningSamples, maxSamples),
          firstLines,
          lastLines,
        },
      };
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
  for (const conn of liveConnections.values()) {
    try {
      if (conn.connected) conn.handler.disconnect();
      conn.handler.cleanupTempFile();
    } catch { /* ignore cleanup errors */ }
  }
  liveConnections.clear();
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
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

// === Device Discovery (per-source) ===

ipcMain.handle(IPC.SERIAL_LIST_PORTS, async () => {
  try {
    const tmpHandler = new SerialHandler();
    const ports = await tmpHandler.listPorts();
    return { success: true, ports };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LOGCAT_LIST_DEVICES, async () => {
  try {
    const tmpHandler = new LogcatHandler();
    const devices = await tmpHandler.listDevices();
    return { success: true, devices };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Unified Live Connection Management ===

function wireConnectionEvents(conn: LiveConnection): void {
  const { handler, id } = conn;

  const onLinesAdded = (_count: number) => {
    const fh = fileHandlerCache.get(conn.tempFilePath);
    if (fh) {
      const newLines = fh.indexNewLines();
      if (newLines > 0) {
        mainWindow?.webContents.send(IPC.LIVE_LINES_ADDED, {
          connectionId: id,
          totalLines: fh.getTotalLines(),
          newLines,
        });
      }
    }
  };

  const onError = (message: string) => {
    mainWindow?.webContents.send(IPC.LIVE_ERROR, { connectionId: id, message });
  };

  const onDisconnected = () => {
    conn.connected = false;
    mainWindow?.webContents.send(IPC.LIVE_DISCONNECTED, { connectionId: id });
    removeConnectionListeners(conn);
  };

  conn.listeners = [
    { event: 'lines-added', fn: onLinesAdded },
    { event: 'error', fn: onError },
    { event: 'disconnected', fn: onDisconnected },
  ];

  for (const l of conn.listeners) {
    handler.on(l.event, l.fn);
  }
}

function removeConnectionListeners(conn: LiveConnection): void {
  for (const l of conn.listeners) {
    conn.handler.removeListener(l.event, l.fn);
  }
  conn.listeners = [];
}

ipcMain.handle(IPC.LIVE_CONNECT, async (_, source: 'serial' | 'logcat' | 'ssh', config: any, displayName: string, detail: string) => {
  try {
    if (liveConnections.size >= MAX_LIVE_CONNECTIONS) {
      return { success: false, error: `Maximum ${MAX_LIVE_CONNECTIONS} concurrent connections reached` };
    }

    const connectionId = 'lc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

    let handler: any;
    if (source === 'serial') {
      handler = new SerialHandler();
    } else if (source === 'logcat') {
      handler = new LogcatHandler();
    } else {
      handler = new SshHandler();
    }

    const tempFilePath = await handler.connect(config);

    // Open temp file with FileHandler
    const fileHandler = new FileHandler();
    const info = await fileHandler.open(tempFilePath, () => {});
    addToCache(tempFilePath, fileHandler);

    const conn: LiveConnection = {
      id: connectionId,
      source,
      handler,
      tempFilePath,
      displayName,
      detail,
      config,
      connectedSince: Date.now(),
      connected: true,
      listeners: [],
    };

    wireConnectionEvents(conn);
    liveConnections.set(connectionId, conn);

    return { success: true, connectionId, tempFilePath, info };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LIVE_DISCONNECT, async (_, connectionId: string) => {
  try {
    const conn = liveConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found' };
    if (conn.connected) {
      conn.handler.disconnect();
      conn.connected = false;
    }
    removeConnectionListeners(conn);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LIVE_RESTART, async (_, connectionId: string) => {
  try {
    const conn = liveConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found' };

    // Disconnect old handler if still connected
    if (conn.connected) {
      conn.handler.disconnect();
    }
    removeConnectionListeners(conn);

    // Create fresh handler
    let handler: any;
    if (conn.source === 'serial') {
      handler = new SerialHandler();
    } else if (conn.source === 'logcat') {
      handler = new LogcatHandler();
    } else {
      handler = new SshHandler();
    }

    const tempFilePath = await handler.connect(conn.config);

    // Open new temp file with FileHandler
    const fileHandler = new FileHandler();
    const info = await fileHandler.open(tempFilePath, () => {});
    addToCache(tempFilePath, fileHandler);

    // Update connection
    conn.handler = handler;
    conn.tempFilePath = tempFilePath;
    conn.connectedSince = Date.now();
    conn.connected = true;

    wireConnectionEvents(conn);

    return { success: true, tempFilePath, info };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LIVE_REMOVE, async (_, connectionId: string) => {
  try {
    const conn = liveConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found' };

    if (conn.connected) {
      conn.handler.disconnect();
    }
    removeConnectionListeners(conn);
    conn.handler.cleanupTempFile();
    liveConnections.delete(connectionId);

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LIVE_SAVE_SESSION, async (_, connectionId: string) => {
  try {
    const conn = liveConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found' };

    const tempPath = conn.tempFilePath;
    if (!tempPath || !fs.existsSync(tempPath)) {
      return { success: false, error: 'No session data' };
    }

    const result = await showSaveDialog({
      title: `Save ${conn.displayName} Session`,
      defaultPath: path.basename(tempPath),
      filters: [
        { name: 'Log Files', extensions: ['log', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' };
    }

    fs.copyFileSync(tempPath, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === SSH Profiles & SFTP ===

const getSshProfilesPath = () => path.join(getConfigDir(), 'ssh-profiles.json');

function loadSshProfiles(): SshProfile[] {
  try {
    const p = getSshProfilesPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch { /* */ }
  return [];
}

function saveSshProfiles(profiles: SshProfile[]): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(getSshProfilesPath(), JSON.stringify(profiles, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save SSH profiles:', error);
  }
}

ipcMain.handle(IPC.SSH_PARSE_CONFIG, async () => {
  try {
    const hosts = sshUtilHandler ? sshUtilHandler.parseSSHConfig() : [];
    return { success: true, hosts };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_LIST_PROFILES, async () => {
  try {
    return { success: true, profiles: loadSshProfiles() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_SAVE_PROFILE, async (_, profile: SshProfile) => {
  try {
    const profiles = loadSshProfiles();
    const idx = profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push(profile);
    }
    saveSshProfiles(profiles);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_DELETE_PROFILE, async (_, id: string) => {
  try {
    const profiles = loadSshProfiles().filter(p => p.id !== id);
    saveSshProfiles(profiles);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Saved Connections ===

const getConnectionsPath = () => path.join(getConfigDir(), 'connections.json');

function loadSavedConnections(): SavedConnection[] {
  try {
    const p = getConnectionsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch { /* */ }
  return [];
}

function persistSavedConnections(connections: SavedConnection[]): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(getConnectionsPath(), JSON.stringify(connections, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save connections:', error);
  }
}

ipcMain.handle(IPC.CONNECTION_LIST, async () => {
  try {
    return { success: true, connections: loadSavedConnections() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.CONNECTION_SAVE, async (_, connection: SavedConnection) => {
  try {
    const connections = loadSavedConnections();
    const idx = connections.findIndex(c => c.id === connection.id);
    if (idx >= 0) {
      connections[idx] = connection;
    } else {
      connections.push(connection);
    }
    persistSavedConnections(connections);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.CONNECTION_DELETE, async (_, id: string) => {
  try {
    const connections = loadSavedConnections().filter(c => c.id !== id);
    persistSavedConnections(connections);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.CONNECTION_UPDATE, async (_, id: string, fields: Partial<SavedConnection>) => {
  try {
    const connections = loadSavedConnections();
    const conn = connections.find(c => c.id === id);
    if (!conn) return { success: false, error: 'Connection not found' };
    Object.assign(conn, fields);
    persistSavedConnections(connections);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_LIST_REMOTE_DIR, async (_, remotePath: string) => {
  try {
    // Find an active SSH connection to use for SFTP
    let sshConn: LiveConnection | undefined;
    for (const conn of liveConnections.values()) {
      if (conn.source === 'ssh' && conn.connected) {
        sshConn = conn;
        break;
      }
    }
    if (!sshConn) {
      return { success: false, error: 'No active SSH connection for SFTP' };
    }
    const files = await (sshConn.handler as any).listRemoteDir(remotePath);
    return { success: true, files };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_DOWNLOAD_FILE, async (_, remotePath: string) => {
  try {
    let sshConn: LiveConnection | undefined;
    for (const conn of liveConnections.values()) {
      if (conn.source === 'ssh' && conn.connected) {
        sshConn = conn;
        break;
      }
    }
    if (!sshConn) {
      return { success: false, error: 'No active SSH connection for download' };
    }
    const localPath = await (sshConn.handler as any).downloadRemoteFile(remotePath);
    return { success: true, localPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === File Operations ===

// On Linux, passing a parent BrowserWindow to dialog.show*Dialog causes the
// dialog to attach modally via XDG portal / GTK, which can deadlock and leave
// the window unresponsive. Calling the parentless overload avoids this entirely.
function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return process.platform === 'linux' || !mainWindow
    ? dialog.showOpenDialog(options)
    : dialog.showOpenDialog(mainWindow, options);
}

function showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return process.platform === 'linux' || !mainWindow
    ? dialog.showSaveDialog(options)
    : dialog.showSaveDialog(mainWindow, options);
}

ipcMain.handle(IPC.OPEN_FILE_DIALOG, async () => {
  const result = await showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Log Files', extensions: ['log', 'txt', 'out', 'err'] },
      { name: 'Data Files', extensions: ['json', 'xml', 'yaml', 'yml', 'csv', 'tsv', 'toml', 'ndjson', 'jsonl'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

// === Folder Operations ===

ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async () => {
  const result = await showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Text extensions used by folder search (ripgrep glob filters)
const TEXT_EXTENSIONS = new Set([
  '.log', '.out', '.err', '.txt', '.text', '.md', '.markdown', '.rst',
  '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.config',
  '.csv', '.tsv', '.ndjson', '.jsonl',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.properties', '.env', '.gitignore', '.dockerignore',
]);

// Detect file type purely by reading file header (magic bytes).
// No extension checks — works for extensionless files, misnamed files, etc.
async function sniffFileType(filePath: string): Promise<'text' | 'image' | 'video' | 'binary'> {
  try {
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(16);
      const { bytesRead } = await fh.read(buf, 0, 16, 0);
      if (bytesRead === 0) return 'text'; // empty file is openable as text

      // --- Image signatures ---
      if (bytesRead >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image'; // PNG
      if (bytesRead >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image'; // JPEG
      if (bytesRead >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image'; // GIF
      if (bytesRead >= 2 && buf[0] === 0x42 && buf[1] === 0x4D) return 'image'; // BMP
      // RIFF container: check subtype for WebP vs AVI
      if (bytesRead >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
        if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image'; // WebP
        if (buf[8] === 0x41 && buf[9] === 0x56 && buf[10] === 0x49 && buf[11] === 0x20) return 'video'; // AVI
      }

      // --- Video signatures ---
      if (bytesRead >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video'; // MP4/MOV/M4V (ftyp box)
      if (bytesRead >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'video'; // MKV/WebM (EBML)
      if (bytesRead >= 4 && buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'video'; // OGG/OGV

      // --- Binary detection: any NUL byte in the sample means binary ---
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0x00) return 'binary';
      }
      return 'text';
    } finally {
      await fh.close();
    }
  } catch {
    return 'binary';
  }
}

interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  fileType?: 'text' | 'image' | 'video' | 'binary';
  children?: FolderEntry[];
}

const FOLDER_SCAN_MAX_DEPTH = 3;
const FOLDER_SCAN_SKIP = new Set(['node_modules', '__pycache__', '.git', 'build', 'dist', '.next', 'target']);
const FOLDER_SCAN_PARALLEL = 16; // concurrent file sniff operations

async function scanFolder(folderPath: string, depth: number): Promise<FolderEntry[]> {
  const dirEntries = await fs.promises.readdir(folderPath, { withFileTypes: true });
  const results: FolderEntry[] = [];

  // Process subdirectories first (sequential to avoid fd exhaustion)
  if (depth < FOLDER_SCAN_MAX_DEPTH) {
    for (const entry of dirEntries) {
      if (entry.name.startsWith('.') || FOLDER_SCAN_SKIP.has(entry.name)) continue;
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(folderPath, entry.name);
      try {
        const children = await scanFolder(fullPath, depth + 1);
        if (children.length > 0) {
          results.push({ name: entry.name, path: fullPath, isDirectory: true, children });
        }
      } catch { /* skip unreadable dirs */ }
    }
  }

  // Process files in parallel batches for speed
  const fileEntries = dirEntries.filter(e => !e.name.startsWith('.') && e.isFile());
  for (let i = 0; i < fileEntries.length; i += FOLDER_SCAN_PARALLEL) {
    const batch = fileEntries.slice(i, i + FOLDER_SCAN_PARALLEL);
    const batchResults = await Promise.all(batch.map(async (entry) => {
      const fullPath = path.join(folderPath, entry.name);
      try {
        const [stat, fileType] = await Promise.all([
          fs.promises.stat(fullPath),
          sniffFileType(fullPath),
        ]);
        if (fileType === 'binary') return null;
        return { name: entry.name, path: fullPath, isDirectory: false, size: stat.size, fileType } as FolderEntry;
      } catch { return null; }
    }));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  // Directories first, then alphabetical
  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return results;
}

ipcMain.handle(IPC.READ_FOLDER, async (_, folderPath: string) => {
  try {
    const files = await scanFolder(folderPath, 0);
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
    loadAnnotationsForFile(persistPath);
    pushAnnotationsToRenderer();

    // Update lastOpened in local sidecar
    if (canWriteLocal(persistPath)) {
      const localData = loadLocalFileData(persistPath);
      localData.lastOpened = new Date().toISOString();
      saveLocalFileData(persistPath, localData);
    }
    logActivity(persistPath, 'file_opened', { filePath: persistPath });
    addToRecentFiles(persistPath);

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
            displayIndex: lineToFilteredIndex.get(m.lineNumber),
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

// === Agent Annotations IPC ===

ipcMain.handle('annotation-add', async (_, annotation: Annotation) => {
  annotations.set(annotation.id, annotation);
  saveAnnotationsForCurrentFile();
  if (currentFilePath) logActivity(currentFilePath, 'annotation_added', { lineNumber: annotation.lineNumber, agentName: annotation.agentName });
  pushAnnotationsToRenderer();
  return { success: true };
});

ipcMain.handle('annotation-remove', async (_, id: string) => {
  annotations.delete(id);
  saveAnnotationsForCurrentFile();
  pushAnnotationsToRenderer();
  return { success: true };
});

ipcMain.handle('annotation-list', async () => {
  return { success: true, annotations: Array.from(annotations.values()).sort((a, b) => a.lineNumber - b.lineNumber) };
});

ipcMain.handle('annotation-clear', async () => {
  annotations.clear();
  saveAnnotationsForCurrentFile();
  pushAnnotationsToRenderer();
  return { success: true };
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

  const results: Record<string, Array<{ lineNumber: number; column: number; length: number; lineText: string; displayIndex?: number }>> = {};
  const totalConfigs = configs.length;

  // Build filter lookup once (shared across all configs)
  const filteredIndices = getFilteredLines();
  let filteredSet: Set<number> | null = null;
  let lineToFilteredIndex: Map<number, number> | null = null;
  if (filteredIndices && filteredIndices.length > 0) {
    filteredSet = new Set(filteredIndices);
    lineToFilteredIndex = new Map<number, number>();
    filteredIndices.forEach((lineNum, idx) => lineToFilteredIndex!.set(lineNum, idx));
  }

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

      const matches = await handler.search(searchOpts, (percent) => {
        const overallPercent = Math.round(((i + percent / 100) / totalConfigs) * 100);
        mainWindow?.webContents.send(IPC.SEARCH_CONFIG_BATCH_PROGRESS, { percent: overallPercent, configId: cfg.id });
      }, { cancelled: false });

      // Keep original lineNumber, add displayIndex when filtered
      // (matches the same pattern as the regular SEARCH handler)
      if (filteredSet && lineToFilteredIndex) {
        results[cfg.id] = matches
          .filter(m => filteredSet!.has(m.lineNumber))
          .map(m => ({
            lineNumber: m.lineNumber,
            column: m.column,
            length: m.length,
            lineText: m.lineText,
            displayIndex: lineToFilteredIndex!.get(m.lineNumber),
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

ipcMain.handle(IPC.SEARCH_CONFIG_EXPORT_ALL, async (_, content: string) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };

  try {
    const baseName = path.basename(currentFilePath, path.extname(currentFilePath));
    const date = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const exportName = `${baseName}_multi-search_${date}.txt`;
    const exportPath = path.join(path.dirname(currentFilePath), exportName);
    fs.writeFileSync(exportPath, content, 'utf-8');
    return { success: true, filePath: exportPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Search Config Sessions ===

const getSearchConfigSessionsPath = () => path.join(getConfigDir(), 'search-config-sessions.json');

function loadGlobalSearchConfigSessions(): SearchConfigSession[] {
  try {
    const filePath = getSearchConfigSessionsPath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveGlobalSearchConfigSessions(sessions: SearchConfigSession[]): void {
  ensureConfigDir();
  fs.writeFileSync(getSearchConfigSessionsPath(), JSON.stringify(sessions, null, 2), 'utf-8');
}

function loadLocalSearchConfigSessions(filePath: string): SearchConfigSession[] {
  try {
    const data = loadLocalFileData(filePath);
    return (data as any).searchConfigSessions || [];
  } catch { /* ignore */ }
  return [];
}

function saveLocalSearchConfigSessions(filePath: string, sessions: SearchConfigSession[]): void {
  const data = loadLocalFileData(filePath);
  (data as any).searchConfigSessions = sessions;
  saveLocalFileData(filePath, data);
}

ipcMain.handle(IPC.SEARCH_CONFIG_SESSION_LIST, async () => {
  const globalSessions = loadGlobalSearchConfigSessions().map(s => ({ ...s, isGlobal: true }));
  const localSessions = currentFilePath
    ? loadLocalSearchConfigSessions(currentFilePath).map(s => ({ ...s, isGlobal: false }))
    : [];
  return { success: true, sessions: [...globalSessions, ...localSessions] };
});

ipcMain.handle(IPC.SEARCH_CONFIG_SESSION_SAVE, async (_, session: SearchConfigSession) => {
  if (session.isGlobal) {
    const sessions = loadGlobalSearchConfigSessions();
    const existingIdx = sessions.findIndex(s => s.id === session.id);
    if (existingIdx >= 0) {
      sessions[existingIdx] = session;
    } else {
      sessions.push(session);
    }
    saveGlobalSearchConfigSessions(sessions);
  } else {
    if (!currentFilePath) return { success: false, error: 'No file open' };
    const sessions = loadLocalSearchConfigSessions(currentFilePath);
    const existingIdx = sessions.findIndex(s => s.id === session.id);
    if (existingIdx >= 0) {
      sessions[existingIdx] = session;
    } else {
      sessions.push(session);
    }
    saveLocalSearchConfigSessions(currentFilePath, sessions);
  }
  return { success: true };
});

ipcMain.handle(IPC.SEARCH_CONFIG_SESSION_DELETE, async (_, sessionId: string, isGlobal: boolean) => {
  if (isGlobal) {
    const sessions = loadGlobalSearchConfigSessions().filter(s => s.id !== sessionId);
    saveGlobalSearchConfigSessions(sessions);
  } else {
    if (!currentFilePath) return { success: false, error: 'No file open' };
    const sessions = loadLocalSearchConfigSessions(currentFilePath).filter(s => s.id !== sessionId);
    saveLocalSearchConfigSessions(currentFilePath, sessions);
  }
  return { success: true };
});

// === Context Search ===

const getContextDefinitionsPath = () => path.join(getConfigDir(), 'context-definitions.json');
const GLOBAL_CONTEXT_KEY = '_global';

interface ContextDefinitionsStore {
  [key: string]: ContextDefinition[];
}

function loadContextDefinitionsStore(): ContextDefinitionsStore {
  try {
    ensureConfigDir();
    const configPath = getContextDefinitionsPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load context definitions:', error);
  }
  return {};
}

function saveContextDefinitionsStore(store: ContextDefinitionsStore): void {
  try {
    ensureConfigDir();
    const configPath = getContextDefinitionsPath();
    const cleanStore: ContextDefinitionsStore = {};
    for (const [key, value] of Object.entries(store)) {
      if (value.length > 0) {
        cleanStore[key] = value;
      }
    }
    fs.writeFileSync(configPath, JSON.stringify(cleanStore, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save context definitions:', error);
  }
}

function loadContextDefinitionsForFile(filePath: string): ContextDefinition[] {
  const store = loadContextDefinitionsStore();
  const defs: ContextDefinition[] = [];
  const globalDefs = store[GLOBAL_CONTEXT_KEY] || [];
  for (const d of globalDefs) defs.push({ ...d, isGlobal: true });
  if (filePath) {
    const fileDefs = store[filePath] || [];
    for (const d of fileDefs) defs.push({ ...d, isGlobal: false });
  }
  return defs;
}

function saveContextDefinition(def: ContextDefinition): void {
  const store = loadContextDefinitionsStore();
  // Remove from all keys first
  for (const k of Object.keys(store)) {
    store[k] = store[k].filter(d => d.id !== def.id);
  }
  const key = def.isGlobal ? GLOBAL_CONTEXT_KEY : (currentFilePath || GLOBAL_CONTEXT_KEY);
  if (!store[key]) store[key] = [];
  store[key].push(def);
  saveContextDefinitionsStore(store);
}

function removeContextDefinition(id: string): void {
  const store = loadContextDefinitionsStore();
  let changed = false;
  for (const k of Object.keys(store)) {
    const before = store[k].length;
    store[k] = store[k].filter(d => d.id !== id);
    if (store[k].length !== before) changed = true;
  }
  if (changed) saveContextDefinitionsStore(store);
}

ipcMain.handle(IPC.CONTEXT_DEFINITIONS_LOAD, async () => {
  const definitions = loadContextDefinitionsForFile(currentFilePath || '');
  return { success: true, definitions };
});

ipcMain.handle(IPC.CONTEXT_DEFINITIONS_SAVE, async (_, def: ContextDefinition) => {
  saveContextDefinition(def);
  return { success: true };
});

ipcMain.handle('context-definition-delete', async (_, id: string) => {
  removeContextDefinition(id);
  return { success: true };
});

ipcMain.handle(IPC.CONTEXT_SEARCH, async (_, contextIds: string[]) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const allDefs = loadContextDefinitionsForFile(currentFilePath || '');
  const enabledDefs = allDefs.filter(d => d.enabled && (contextIds.length === 0 || contextIds.includes(d.id)));

  if (enabledDefs.length === 0) return { success: true, results: [] };

  const filteredIndices = getFilteredLines();
  const fileInfo = handler.getFileInfo();
  const totalLines = fileInfo ? fileInfo.totalLines : 0;
  const results: Array<{ contextId: string; groups: ContextMatchGroup[] }> = [];

  for (let ci = 0; ci < enabledDefs.length; ci++) {
    const ctx = enabledDefs[ci];
    const mustPatterns = ctx.patterns.filter(p => p.role === 'must');
    const cluePatterns = ctx.patterns.filter(p => p.role === 'clue');

    if (mustPatterns.length === 0) continue;

    const groups: ContextMatchGroup[] = [];

    // Find all must-pattern matches
    for (const mustPat of mustPatterns) {
      const searchOpts: SearchOptions = {
        pattern: mustPat.pattern,
        isRegex: mustPat.isRegex,
        isWildcard: false,
        matchCase: mustPat.matchCase,
        wholeWord: false,
      };
      if (filteredIndices) searchOpts.filteredLineIndices = filteredIndices;

      let mustMatches: Array<{ lineNumber: number; lineText: string }>;
      try {
        mustMatches = await handler.search(searchOpts, () => {}, { cancelled: false });
      } catch { continue; }

      // For each must match, search for clues in proximity
      for (const mm of mustMatches) {
        const mustLineNum = mm.lineNumber;
        const distance = ctx.defaultDistance || 10;
        const windowStart = Math.max(0, mustLineNum - distance);
        const windowEnd = Math.min(totalLines - 1, mustLineNum + distance);
        const windowSize = windowEnd - windowStart + 1;

        // Read window lines
        let windowLines: Array<{ lineNumber: number; text: string }>;
        try {
          const res = await handler.getLines(windowStart, windowSize);
          windowLines = res.map((l: any) => ({ lineNumber: l.lineNumber, text: l.text }));
        } catch { continue; }

        const clues: ContextMatchGroup['clues'] = [];

        for (const cluePat of cluePatterns) {
          const clueDistance = cluePat.distance ?? distance;
          let regex: RegExp;
          try {
            regex = cluePat.isRegex
              ? new RegExp(cluePat.pattern, cluePat.matchCase ? '' : 'i')
              : new RegExp(cluePat.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cluePat.matchCase ? '' : 'i');
          } catch { continue; }

          for (const wl of windowLines) {
            if (wl.lineNumber === mustLineNum) continue;
            const lineDist = Math.abs(wl.lineNumber - mustLineNum);
            if (lineDist > clueDistance) continue;
            if (regex.test(wl.text)) {
              clues.push({
                lineNumber: wl.lineNumber,
                text: wl.text,
                patternId: cluePat.id,
                distance: lineDist,
              });
            }
          }
        }

        // Keep group if it has clues, or if context has no clue patterns (must-only context)
        if (clues.length > 0 || cluePatterns.length === 0) {
          groups.push({
            contextId: ctx.id,
            mustLine: mustLineNum,
            mustText: mm.lineText,
            mustPatternId: mustPat.id,
            clues,
            score: cluePatterns.length === 0 ? 1 : clues.length,
          });
        }
      }
    }

    // Sort by line number
    groups.sort((a, b) => a.mustLine - b.mustLine);
    results.push({ contextId: ctx.id, groups });

    // Report progress
    const percent = Math.round(((ci + 1) / enabledDefs.length) * 100);
    mainWindow?.webContents.send(IPC.CONTEXT_SEARCH_PROGRESS, { percent, contextId: ctx.id });
  }

  return { success: true, results };
});

// === Traceback ===

function extractComponent(text: string): string | null {
  const sample = text.length > 120 ? text.substring(0, 120) : text;
  const match = sample.match(/\[([A-Za-z][A-Za-z0-9_.\-/]{1,40})\]/);
  return match ? match[1] : null;
}

ipcMain.handle(IPC.TRACEBACK, async (_, request: { targetLine: number; windowLines?: number; windowSeconds?: number; maxResults?: number }) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const { targetLine, windowLines = 200, windowSeconds = 60, maxResults = 50 } = request;

  // Read target line
  const [targetLineData] = handler.getLines(targetLine, 1);
  if (!targetLineData) return { success: false, error: 'Target line not found' };

  const targetText = targetLineData.text;
  const targetComponent = extractComponent(targetText);
  const targetTimestamp = parseTimestampFast(targetText);

  // Determine scan window
  let windowStart = Math.max(0, targetLine - windowLines);

  // Read all lines in window
  const count = targetLine - windowStart;
  if (count <= 0) return { success: true, targetLine, targetText, targetComponent, windowStart, lines: [], summary: { total: 0, errors: 0, warnings: 0, stateChanges: 0, related: 0, context: 0 } };

  const windowLineData = handler.getLines(windowStart, count);

  // Narrow by time window if timestamps available
  if (targetTimestamp && windowSeconds < Infinity) {
    const cutoff = targetTimestamp.date.getTime() - windowSeconds * 1000;
    const firstValid = windowLineData.findIndex(l => {
      const ts = parseTimestampFast(l.text);
      return ts && ts.date.getTime() >= cutoff;
    });
    if (firstValid > 0) {
      windowLineData.splice(0, firstValid);
      windowStart = windowLineData.length > 0 ? windowLineData[0].lineNumber : targetLine;
    }
  }

  // Extract significant words from target line (3+ chars, alphanumeric)
  const targetWords = new Set(
    targetText.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(w => !['the', 'and', 'for', 'not', 'was', 'are', 'this', 'that', 'with', 'from', 'have', 'has'].includes(w)) || []
  );

  const windowSize = windowLineData.length;

  // Track level escalation per component
  const componentLastLevel = new Map<string, string>();
  const escalationLines = new Set<number>();

  // First pass: detect escalations
  for (const line of windowLineData) {
    const comp = extractComponent(line.text);
    const level = line.level;
    if (comp && level) {
      const prev = componentLastLevel.get(comp);
      if ((prev === 'info' && (level === 'warning' || level === 'error')) ||
          (prev === 'warning' && level === 'error')) {
        escalationLines.add(line.lineNumber);
      }
      componentLastLevel.set(comp, level);
    }
  }

  // Score each line
  const scored: Array<{
    lineNumber: number;
    text: string;
    score: number;
    component: string | null;
    level?: string;
  }> = [];

  const crashRegex = /\b(fatal|crash|exception|panic|oom|segfault|abort|sigsegv|sigabrt|unhandled|stack\s*trace)\b/i;

  for (let i = 0; i < windowLineData.length; i++) {
    const line = windowLineData[i];
    let score = 0;

    const lineComponent = extractComponent(line.text);

    // Same component: +30
    if (targetComponent && lineComponent === targetComponent) {
      score += 30;
    }

    // Level severity: +25
    if (line.level === 'error') score += 25;
    else if (line.level === 'warning') score += 15;
    else if (line.level === 'info') score += 5;

    // Level escalation: +15
    if (escalationLines.has(line.lineNumber)) {
      score += 15;
    }

    // Crash keyword: +20
    if (crashRegex.test(line.text)) {
      score += 20;
    }

    // Temporal proximity: +10
    const distance = windowSize - i - 1; // distance from target (end of window)
    score += Math.round(10 * (1 - distance / Math.max(windowSize, 1)));

    // Keyword overlap: +10
    if (targetWords.size > 0) {
      const lineWords = line.text.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
      let overlap = 0;
      for (const w of lineWords) {
        if (targetWords.has(w)) { overlap++; break; }
      }
      if (overlap > 0) {
        const overlapRatio = Math.min(1, lineWords.filter(w => targetWords.has(w)).length / targetWords.size);
        score += Math.round(10 * overlapRatio);
      }
    }

    if (score > 5) {
      scored.push({
        lineNumber: line.lineNumber,
        text: line.text,
        score,
        component: lineComponent,
        level: line.level,
      });
    }
  }

  // Take top maxResults by score
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxResults);

  // Re-sort chronologically
  top.sort((a, b) => a.lineNumber - b.lineNumber);

  // Assign categories
  const results = top.map(line => {
    let category: 'error' | 'warning' | 'state-change' | 'related' | 'context';
    if (line.level === 'error' || crashRegex.test(line.text)) {
      category = 'error';
    } else if (line.level === 'warning') {
      category = 'warning';
    } else if (escalationLines.has(line.lineNumber)) {
      category = 'state-change';
    } else if (targetComponent && line.component === targetComponent) {
      category = 'related';
    } else {
      category = 'context';
    }
    return { ...line, category };
  });

  // Build summary
  const summary = {
    total: results.length,
    errors: results.filter(r => r.category === 'error').length,
    warnings: results.filter(r => r.category === 'warning').length,
    stateChanges: results.filter(r => r.category === 'state-change').length,
    related: results.filter(r => r.category === 'related').length,
    context: results.filter(r => r.category === 'context').length,
  };

  return { success: true, targetLine, targetText, targetComponent, windowStart, lines: results, summary };
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

// === Agent Memory ===
// Per-file persistent memory for AI agents. Stored alongside the log file so
// agents can resume analysis across sessions.

interface AgentMemoryData {
  content: string;
  agentName: string;
  updatedAt: number;
}

function agentMemoryPath(filePath: string | null): string | null {
  if (!filePath) return null;
  return path.join(getLocalLoganDir(filePath), path.basename(filePath) + '.agent-memory.json');
}

function getAgentMemory(filePath: string | null): AgentMemoryData | null {
  const p = agentMemoryPath(filePath);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function saveAgentMemory(filePath: string | null, content: string, agentName?: string): boolean {
  if (!filePath) return false;
  if (!ensureLocalLoganDir(filePath)) return false;
  const p = agentMemoryPath(filePath)!;
  const data: AgentMemoryData = {
    content,
    agentName: agentName || 'Agent',
    updatedAt: Date.now(),
  };
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); return true; } catch { return false; }
}

function clearAgentMemory(filePath: string | null): boolean {
  const p = agentMemoryPath(filePath);
  if (!p) return false;
  try { if (fs.existsSync(p)) fs.unlinkSync(p); return true; } catch { return false; }
}

ipcMain.handle('agent-memory-get', () => {
  const mem = getAgentMemory(currentFilePath);
  return mem || null;
});

ipcMain.handle('agent-memory-save', (_e, content: string, agentName?: string) => {
  const ok = saveAgentMemory(currentFilePath, content, agentName);
  return { success: ok };
});

ipcMain.handle('agent-memory-clear', () => {
  return { success: clearAgentMemory(currentFilePath) };
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
      // Insert in line-number order among existing snippets
      const existing = fs.readFileSync(notesFilePath, 'utf-8');
      const entryPattern = /\n--- \[.*?\] Lines (\d+)-/g;
      // Collect positions and start-line numbers of existing entries
      const entries: { pos: number; line: number }[] = [];
      let match;
      while ((match = entryPattern.exec(existing)) !== null) {
        entries.push({ pos: match.index, line: parseInt(match[1], 10) });
      }

      // Find insertion point: before the first entry whose start line > our start line
      const newStartLine1 = startLine + 1; // 1-indexed as in the header
      let insertPos = -1;
      for (const e of entries) {
        if (e.line > newStartLine1) {
          insertPos = e.pos;
          break;
        }
      }

      if (insertPos === -1) {
        // All existing entries have smaller line numbers — append at end
        fs.appendFileSync(notesFilePath, newEntry, 'utf-8');
      } else {
        // Insert before the entry with larger line number
        const before = existing.substring(0, insertPos);
        const after = existing.substring(insertPos);
        fs.writeFileSync(notesFilePath, before + newEntry + after, 'utf-8');
      }
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
    cacheAnalysisResult(currentFilePath, result);

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

// === Baselines ===

ipcMain.handle(IPC.BASELINE_LIST, async () => {
  try {
    return { success: true, baselines: baselineStore.list() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_SAVE, async (_, name: string, description: string, tags: string[]) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file handler' };
  const analysisResult = analysisResultCache.get(currentFilePath);
  if (!analysisResult) return { success: false, error: 'Run analysis first' };
  try {
    const fingerprint = buildFingerprint(currentFilePath, analysisResult, handler);
    const id = baselineStore.save(name, description, tags, fingerprint);
    return { success: true, id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_GET, async (_, id: string) => {
  try {
    const baseline = baselineStore.get(id);
    if (!baseline) return { success: false, error: 'Baseline not found' };
    return { success: true, baseline };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_UPDATE, async (_, id: string, fields: { name?: string; description?: string; tags?: string[] }) => {
  try {
    const ok = baselineStore.update(id, fields);
    return { success: ok, error: ok ? undefined : 'Baseline not found' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_DELETE, async (_, id: string) => {
  try {
    const ok = baselineStore.delete(id);
    return { success: ok, error: ok ? undefined : 'Baseline not found' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_COMPARE, async (_, baselineId: string) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file handler' };
  const analysisResult = analysisResultCache.get(currentFilePath);
  if (!analysisResult) return { success: false, error: 'Run analysis first' };
  try {
    const currentFp = buildFingerprint(currentFilePath, analysisResult, handler);
    const report = baselineStore.compare(currentFp, baselineId);
    if (!report) return { success: false, error: 'Baseline not found' };
    return { success: true, report };
  } catch (error) {
    return { success: false, error: String(error) };
  }
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
    type CompiledPattern = { regex: RegExp } | { literal: string; lowerLiteral: string; patternCaseSensitive: boolean };

    // Compile exclude patterns (use global caseSensitive)
    const compileExcludePattern = (pattern: string): CompiledPattern => {
      if (exactMatch) {
        return { literal: pattern, lowerLiteral: pattern.toLowerCase(), patternCaseSensitive: caseSensitive };
      }
      try {
        return { regex: new RegExp(pattern, caseSensitive ? '' : 'i') };
      } catch {
        return { literal: pattern, lowerLiteral: pattern.toLowerCase(), patternCaseSensitive: caseSensitive };
      }
    };

    // Normalize include patterns: support both old string[] and new {pattern,caseSensitive}[]
    const normalizedIncludes: Array<{ pattern: string; caseSensitive: boolean }> =
      config.includePatterns.map((p: any) =>
        typeof p === 'string'
          ? { pattern: p, caseSensitive: caseSensitive }
          : { pattern: p.pattern, caseSensitive: p.caseSensitive }
      );

    // Compile include patterns with per-pattern case sensitivity
    const compileIncludePattern = (ip: { pattern: string; caseSensitive: boolean }): CompiledPattern => {
      if (exactMatch) {
        return { literal: ip.pattern, lowerLiteral: ip.pattern.toLowerCase(), patternCaseSensitive: ip.caseSensitive };
      }
      try {
        return { regex: new RegExp(ip.pattern, ip.caseSensitive ? '' : 'i') };
      } catch {
        return { literal: ip.pattern, lowerLiteral: ip.pattern.toLowerCase(), patternCaseSensitive: ip.caseSensitive };
      }
    };

    const compiledIncludePatterns = normalizedIncludes.map(compileIncludePattern);
    const compiledExcludePatterns = config.excludePatterns.map(compileExcludePattern);

    const matchCompiled = (text: string, compiled: CompiledPattern): boolean => {
      if ('regex' in compiled) {
        return compiled.regex.test(text);
      }
      return compiled.patternCaseSensitive
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
      filteredLineNumbers: sortedLines,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('get-filtered-line-numbers', () => {
  return getFilteredLines();
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

// Batch timestamp fetch for Time Align
ipcMain.handle(IPC.GET_LINE_TIMESTAMPS, async (_, lineNumbers: number[]) => {
  const handler = getFileHandler();
  if (!handler) return [];
  const results: Array<{ lineNumber: number; epochMs: number }> = [];
  try {
    for (const ln of lineNumbers) {
      const lines = handler.getLines(ln, 1);
      if (lines.length === 0) continue;
      const parsed = parseTimestampFast(lines[0].text);
      if (parsed) {
        results.push({ lineNumber: ln, epochMs: parsed.date.getTime() });
      }
    }
  } catch { /* ignore */ }
  return results;
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
  const isJsonl = /\.jsonl$|\.ndjson$/i.test(inputPath);

  return new Promise((resolve, reject) => {
    const stats = fs.statSync(inputPath);
    const fileSize = stats.size;

    const readStream = fs.createReadStream(inputPath, { encoding: 'utf-8', highWaterMark: 1024 * 1024 });
    const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

    let bytesRead = 0;
    let lastProgressPercent = 0;
    let outputBuffer = '';
    const FLUSH_SIZE = 256 * 1024;

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

    const reportProgress = (bytes: number) => {
      bytesRead += bytes;
      const percent = Math.min(99, Math.round((bytesRead / fileSize) * 100));
      if (percent > lastProgressPercent) {
        lastProgressPercent = percent;
        if (onProgress) onProgress(percent);
      }
    };

    // Shallow JSON formatter: expands only top-level keys to one line each,
    // keeping nested values compact. Limits line explosion for large JSONL files.
    const shallowFormat = (obj: any): string => {
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        return JSON.stringify(obj);
      }
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';
      const lines = ['{'];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const val = JSON.stringify(obj[k]);
        const comma = i < keys.length - 1 ? ',' : '';
        lines.push(`  ${JSON.stringify(k)}: ${val}${comma}`);
      }
      lines.push('}');
      return lines.join('\n');
    };

    if (isJsonl) {
      // JSONL: format each line with shallow expansion (top-level keys only)
      let lineBuffer = '';

      readStream.on('data', (rawChunk: string | Buffer) => {
        const chunk = typeof rawChunk === 'string' ? rawChunk : rawChunk.toString('utf-8');
        reportProgress(Buffer.byteLength(chunk, 'utf-8'));

        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { write('\n'); continue; }
          try {
            const obj = JSON.parse(trimmed);
            write(shallowFormat(obj) + '\n');
          } catch {
            write(trimmed + '\n');
          }
        }
      });

      readStream.on('end', () => {
        const trimmed = lineBuffer.trim();
        if (trimmed) {
          try {
            const obj = JSON.parse(trimmed);
            write(shallowFormat(obj) + '\n');
          } catch {
            write(trimmed + '\n');
          }
        }
        flush();
        writeStream.end(() => {
          if (onProgress) onProgress(100);
          resolve();
        });
      });
    } else {
      // Single JSON document — streaming character-by-character formatter
      let inString = false;
      let escaped = false;
      let depth = 0;
      let afterOpenOrComma = false;

      const indent = (d: number) => '  '.repeat(d);

      readStream.on('data', (rawChunk: string | Buffer) => {
        const chunk = typeof rawChunk === 'string' ? rawChunk : rawChunk.toString('utf-8');
        reportProgress(Buffer.byteLength(chunk, 'utf-8'));

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
            depth = Math.max(0, depth - 1);
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

          if (afterOpenOrComma) { write('\n' + indent(depth)); afterOpenOrComma = false; }
          write(char);
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
    }

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

// === Terminal (tabbed, multi-session) ===

interface TerminalSession {
  id: string;
  type: 'local' | 'ssh';
  label: string;
  ptyProcess?: any;
  sshStream?: any;
  borrowedClient?: boolean; // true = live connection's client, don't close
  ownedClient?: any;     // standalone SSH, close on kill
  cols: number;
  rows: number;
}

const terminalSessions = new Map<string, TerminalSession>();

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

ipcMain.handle(IPC.TERMINAL_CREATE_LOCAL, async (_, sessionId: string, options?: { cwd?: string; cols?: number; rows?: number }) => {
  try {
    const shellPath = getDefaultShell();
    const cwd = options?.cwd || os.homedir();
    const cols = options?.cols || 80;
    const rows = options?.rows || 24;

    if (pty) {
      // Full PTY via node-pty (macOS/Windows)
      const proc = pty.spawn(shellPath, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as { [key: string]: string },
      });

      const session: TerminalSession = {
        id: sessionId,
        type: 'local',
        label: 'Local',
        ptyProcess: proc,
        cols,
        rows,
      };
      terminalSessions.set(sessionId, session);

      proc.onData((data: string) => {
        mainWindow?.webContents.send(IPC.TERMINAL_DATA, sessionId, data);
      });

      proc.onExit(({ exitCode }) => {
        mainWindow?.webContents.send(IPC.TERMINAL_EXIT, sessionId, exitCode);
        terminalSessions.delete(sessionId);
      });

      return { success: true, label: 'Local' };
    }

    // Fallback for Linux (no node-pty): use `script` to wrap the shell
    // in a real PTY. `script -qfc <cmd> /dev/null` is portable across
    // util-linux and BSD `script` implementations.
    const env = { ...process.env, TERM: 'xterm-256color', COLUMNS: String(cols), LINES: String(rows) };
    let scriptCmd: string;
    let scriptArgs: string[];
    try {
      execSync('which script', { timeout: 1000 });
      // util-linux script: -q quiet, -f flush, -c command, /dev/null = no typescript file
      scriptCmd = 'script';
      scriptArgs = ['-qfc', shellPath, '/dev/null'];
    } catch {
      // No `script` available — fall back to direct bash (will have echo issues but works)
      scriptCmd = shellPath;
      scriptArgs = ['-i'];
    }
    const child = spawn(scriptCmd, scriptArgs, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });

    // Wrap child process to match pty interface used by session handlers
    const procShim = {
      write: (data: string) => child.stdin?.write(data),
      resize: (_c: number, _r: number) => { /* no-op for pipe-based shell */ },
      kill: () => child.kill(),
    };

    const session: TerminalSession = {
      id: sessionId,
      type: 'local',
      label: 'Local',
      ptyProcess: procShim,
      cols,
      rows,
    };
    terminalSessions.set(sessionId, session);

    child.stdout?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send(IPC.TERMINAL_DATA, sessionId, data.toString());
    });
    child.stderr?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send(IPC.TERMINAL_DATA, sessionId, data.toString());
    });
    child.on('exit', (exitCode) => {
      mainWindow?.webContents.send(IPC.TERMINAL_EXIT, sessionId, exitCode ?? 0);
      terminalSessions.delete(sessionId);
    });

    return { success: true, label: 'Local' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.TERMINAL_CREATE_SSH, async (_, sessionId: string, options: {
  liveConnectionId?: string;
  savedConnectionId?: string;
  sshConfig?: { host: string; port: number; username: string; identityFile?: string; passphrase?: string };
  cols?: number;
  rows?: number;
}) => {
  try {
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    let stream: any;
    let label: string;
    let borrowedClient = false;
    let ownedClient: any;

    if (options.liveConnectionId) {
      // Borrow client from live connection
      const conn = liveConnections.get(options.liveConnectionId);
      if (!conn || conn.source !== 'ssh' || !conn.connected) {
        return { success: false, error: 'SSH live connection not found or not connected' };
      }
      const handler = conn.handler as any;
      if (!handler.isClientConnected()) {
        return { success: false, error: 'SSH client not connected' };
      }
      stream = await handler.openShell(cols, rows);
      label = conn.displayName || 'SSH';
      borrowedClient = true;
    } else if (options.savedConnectionId) {
      // Load saved connection config
      const saved = loadSavedConnections().find(c => c.id === options.savedConnectionId);
      if (!saved || saved.source !== 'ssh') {
        return { success: false, error: 'Saved SSH connection not found' };
      }
      const cfg = saved.config;
      const result = await createStandaloneSshShell(cfg, cols, rows);
      stream = result.stream;
      ownedClient = result.client;
      label = saved.name || cfg.host || 'SSH';
      // Update lastUsedAt
      saved.lastUsedAt = Date.now();
      persistSavedConnections(loadSavedConnections().map(c => c.id === saved.id ? saved : c));
    } else if (options.sshConfig) {
      const result = await createStandaloneSshShell(options.sshConfig, cols, rows);
      stream = result.stream;
      ownedClient = result.client;
      label = `${options.sshConfig.username}@${options.sshConfig.host}`;
    } else {
      return { success: false, error: 'No SSH connection source specified' };
    }

    const session: TerminalSession = {
      id: sessionId,
      type: 'ssh',
      label,
      sshStream: stream,
      borrowedClient,
      ownedClient,
      cols,
      rows,
    };
    terminalSessions.set(sessionId, session);

    stream.on('data', (chunk: Buffer) => {
      mainWindow?.webContents.send(IPC.TERMINAL_DATA, sessionId, chunk.toString('utf-8'));
    });

    stream.on('close', () => {
      mainWindow?.webContents.send(IPC.TERMINAL_EXIT, sessionId, 0);
      if (session.ownedClient) {
        try { session.ownedClient.end(); } catch { /* */ }
      }
      terminalSessions.delete(sessionId);
    });

    return { success: true, label };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

async function createStandaloneSshShell(
  config: { host: string; port: number; username: string; identityFile?: string; passphrase?: string },
  cols: number,
  rows: number
): Promise<{ client: any; stream: any }> {
  if (!SshClient) throw new Error('SSH not available (ssh2 not installed)');
  const client = new SshClient();

  const connectConfig: any = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    readyTimeout: 10000,
  };

  if (process.env.SSH_AUTH_SOCK) {
    connectConfig.agent = process.env.SSH_AUTH_SOCK;
  }

  const keyPaths: string[] = [];
  if (config.identityFile && fs.existsSync(config.identityFile)) {
    keyPaths.push(config.identityFile);
  }
  const defaultKeys = [
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    path.join(os.homedir(), '.ssh', 'id_rsa'),
  ];
  for (const k of defaultKeys) {
    if (fs.existsSync(k) && !keyPaths.includes(k)) keyPaths.push(k);
  }
  if (keyPaths.length > 0) {
    try {
      connectConfig.privateKey = fs.readFileSync(keyPaths[0]);
      if (config.passphrase) connectConfig.passphrase = config.passphrase;
    } catch { /* fall through to agent auth */ }
  }

  return new Promise((resolve, reject) => {
    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err: Error | undefined, stream: any) => {
        if (err) { client.end(); return reject(err); }
        resolve({ client, stream });
      });
    });
    client.on('error', (err: any) => {
      reject(err);
    });
    client.connect(connectConfig);
  });
}

ipcMain.handle(IPC.TERMINAL_WRITE, async (_, sessionId: string, data: string) => {
  const session = terminalSessions.get(sessionId);
  if (!session) return { success: false, error: 'Session not found' };
  if (session.ptyProcess) {
    session.ptyProcess.write(data);
    return { success: true };
  }
  if (session.sshStream) {
    session.sshStream.write(data);
    return { success: true };
  }
  return { success: false, error: 'No process/stream' };
});

ipcMain.handle(IPC.TERMINAL_RESIZE, async (_, sessionId: string, cols: number, rows: number) => {
  const session = terminalSessions.get(sessionId);
  if (!session) return { success: false, error: 'Session not found' };
  session.cols = cols;
  session.rows = rows;
  if (session.ptyProcess) {
    session.ptyProcess.resize(cols, rows);
    return { success: true };
  }
  if (session.sshStream) {
    try { session.sshStream.setWindow(rows, cols, 0, 0); } catch { /* some ssh2 versions */ }
    return { success: true };
  }
  return { success: false, error: 'No process/stream' };
});

ipcMain.handle(IPC.TERMINAL_KILL, async (_, sessionId: string) => {
  const session = terminalSessions.get(sessionId);
  if (!session) return { success: false, error: 'Session not found' };
  if (session.ptyProcess) {
    session.ptyProcess.kill();
  }
  if (session.sshStream) {
    try { session.sshStream.close(); } catch { /* */ }
  }
  if (session.ownedClient) {
    try { session.ownedClient.end(); } catch { /* */ }
  }
  terminalSessions.delete(sessionId);
  return { success: true };
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

ipcMain.handle('save-notes-as', async (_e: any, content: string) => {
  if (!mainWindow) return { success: false, error: 'No window' };
  const result = await showSaveDialog({
    title: 'Save Notes As',
    defaultPath: currentFilePath
      ? path.basename(currentFilePath) + '.notes.txt'
      : 'notes.txt',
    filters: [
      { name: 'Text Files', extensions: ['txt', 'md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return { success: false, error: 'Cancelled' };
  }
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return { success: true, filePath: result.filePath };
});

// Agent chat — user sends message from renderer
ipcMain.handle('agent-send-message', async (_e: any, text: string) => {
  const msg = addChatMessage('user', text);
  return { success: true, message: msg };
});

// Agent chat — get chat history
ipcMain.handle('agent-get-messages', async () => {
  return { success: true, messages: getChatMessages() };
});

// Agent connection status
ipcMain.handle('agent-get-status', async () => {
  return { connected: getSseClientCount() > 0, count: getSseClientCount(), name: getAgentName() };
});

// --- Built-in agent launch/stop ---

interface AgentConfig {
  type?: 'claude-code' | 'builtin' | 'custom' | 'local-llm';
  scriptPath?: string;
  model?: string;
  llmEndpoint?: string;
  llmModel?: string;
  agentName?: string;
}

function getAgentConfig(): AgentConfig {
  const configPath = path.join(os.homedir(), '.logan', 'agent-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Backwards compatibility: old configs only have scriptPath
    if (!config.type && config.scriptPath) config.type = 'custom';
    return config;
  } catch { /* no config */ }
  return { type: 'builtin' };
}

function getBuiltinScriptPath(): string {
  const devPath = path.join(app.getAppPath(), 'examples', 'agent-node.mjs');
  if (fs.existsSync(devPath)) return devPath;
  const pkgPath = path.join(path.dirname(app.getAppPath()), 'examples', 'agent-node.mjs');
  if (fs.existsSync(pkgPath)) return pkgPath;
  return devPath;
}

function findClaudeCli(): string | null {
  // Try PATH first
  try {
    const result = execSync('which claude', { timeout: 3000, encoding: 'utf-8' }).trim();
    if (result) return result;
  } catch { /* not in PATH */ }
  // Common install locations
  const candidates = [
    path.join(os.homedir(), '.claude', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const CLAUDE_CHAT_LOOP_PROMPT = `You are connected to LOGAN, a log analysis tool, via MCP.
Use logan_status to check the current state, then greet the user with logan_send_message.
Then enter a chat loop: call logan_wait_for_message to receive user messages, process them
using LOGAN's MCP tools (logan_search, logan_analyze, logan_filter, logan_get_lines, etc.),
and reply with logan_send_message. Continue until the user says goodbye or stop.`;

ipcMain.handle('agent-launch', async () => {
  if (agentProcess) {
    return { success: false, error: 'Agent is already running' };
  }

  const config = getAgentConfig();

  try {
    if (config.type === 'claude-code') {
      // Launch Claude Code CLI with MCP config
      const claudePath = findClaudeCli();
      if (!claudePath) {
        return { success: false, error: 'Claude Code CLI not found. Please install it or reconfigure.' };
      }

      // Generate temp MCP config for Claude Code
      const mcpConfig = {
        mcpServers: {
          logan: {
            command: 'node',
            args: [path.join(app.getAppPath(), 'dist', 'mcp-server', 'index.js')],
            cwd: app.getAppPath(),
          },
        },
      };
      const tmpMcpPath = path.join(os.tmpdir(), 'logan-claude-mcp.json');
      fs.writeFileSync(tmpMcpPath, JSON.stringify(mcpConfig));

      const args = [
        '--print',
        '--mcp-config', tmpMcpPath,
        '--permission-mode', 'bypassPermissions',
        '--strict-mcp-config',
      ];
      if (config.model) args.push('--model', config.model);
      args.push(CLAUDE_CHAT_LOOP_PROMPT);

      agentProcess = spawn(claudePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } else if (config.type === 'local-llm') {
      // Launch local LLM bridge agent
      const llmScriptPath = path.join(app.getAppPath(), 'examples', 'agent-local-llm.mjs');
      if (!fs.existsSync(llmScriptPath)) {
        return { success: false, error: `Local LLM agent script not found: ${llmScriptPath}` };
      }
      agentProcess = spawn(process.execPath, [llmScriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          LLM_ENDPOINT: config.llmEndpoint || 'http://localhost:11434/v1',
          LLM_MODEL: config.llmModel || 'llama3',
          AGENT_NAME: config.agentName || 'wolvie',
        },
      });
    } else if (config.type === 'custom' && config.scriptPath) {
      if (!fs.existsSync(config.scriptPath)) {
        return { success: false, error: `Agent script not found: ${config.scriptPath}` };
      }
      agentProcess = spawn(process.execPath, [config.scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } else {
      // Built-in agent
      const scriptPath = getBuiltinScriptPath();
      if (!fs.existsSync(scriptPath)) {
        return { success: false, error: `Built-in agent script not found: ${scriptPath}` };
      }
      agentProcess = spawn(process.execPath, [scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    }

    agentProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.log(`[agent-stdout] ${text}`);
    });

    agentProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`[agent-stderr] ${text}`);
    });

    agentProcess.on('exit', (code) => {
      console.log(`[agent] exited with code ${code}`);
      agentProcess = null;
      mainWindow?.webContents.send('agent-connection-changed', { connected: false, count: 0 });
    });

    // Build display name — default is "wolvie" for all types
    const baseName = config.agentName || 'wolvie';
    const agentName = config.type === 'claude-code' ? `${baseName} (Claude${config.model ? ' ' + config.model : ''})`
      : config.type === 'local-llm' ? `${baseName} (${config.llmModel || 'local'})`
      : config.type === 'custom' ? baseName
      : baseName;

    return { success: true, agentName };
  } catch (err: any) {
    agentProcess = null;
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('agent-stop', async () => {
  if (!agentProcess) {
    return { success: true };
  }
  // Send "stop" as a user message so the agent exits its loop gracefully
  addChatMessage('user', 'stop');
  // Give it a moment to exit, then force kill
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (agentProcess) {
        agentProcess.kill();
        agentProcess = null;
      }
      resolve();
    }, 3000);
    if (agentProcess) {
      agentProcess.on('exit', () => {
        clearTimeout(timer);
        agentProcess = null;
        resolve();
      });
    } else {
      clearTimeout(timer);
      resolve();
    }
  });
  return { success: true };
});

ipcMain.handle('agent-get-running', async () => {
  return { running: agentProcess !== null };
});

// --- Agent Setup Wizard ---

ipcMain.handle('agent-detect-environment', async () => {
  const configPath = path.join(os.homedir(), '.logan', 'agent-config.json');
  let hasConfig = false;
  let existingConfig: any = null;
  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    hasConfig = true;
  } catch { /* no config */ }

  // Detect AI CLI tools. GUI apps on macOS/Linux don't inherit the user's shell
  // PATH, so we spawn a login shell to load ~/.bashrc / ~/.zshrc / nvm etc.
  function detectCli(bin: string): { found: boolean; version: string } {
    // 1. Try via login shell (loads user PATH — handles nvm, homebrew, pyenv…)
    const shells = process.platform === 'win32'
      ? []
      : ['/bin/bash', '/bin/zsh', '/bin/sh'].filter(s => { try { return fs.existsSync(s); } catch { return false; } });
    for (const sh of shells) {
      const r = spawnSync(sh, ['-lc', `${bin} --version`], { timeout: 4000, encoding: 'utf-8' });
      if (r.status === 0 && r.stdout) return { found: true, version: r.stdout.trim().split('\n')[0] };
    }
    // 2. Windows fallback
    if (process.platform === 'win32') {
      const r = spawnSync('cmd', ['/c', `${bin} --version`], { timeout: 4000, encoding: 'utf-8' });
      if (r.status === 0 && r.stdout) return { found: true, version: r.stdout.trim().split('\n')[0] };
    }
    // 3. Common install paths as last resort
    const extra: string[] = {
      claude: [
        path.join(os.homedir(), '.claude', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        path.join(os.homedir(), '.nvm', 'versions', 'node', 'current', 'bin', 'claude'),
      ],
      aider: ['/usr/local/bin/aider', path.join(os.homedir(), '.local', 'bin', 'aider')],
    }[bin] ?? [];
    for (const p of extra) {
      if (!fs.existsSync(p)) continue;
      const r = spawnSync(p, ['--version'], { timeout: 4000, encoding: 'utf-8' });
      if (r.status === 0 && r.stdout) return { found: true, version: r.stdout.trim().split('\n')[0] };
    }
    return { found: false, version: '' };
  }

  const claudeResult  = detectCli('claude');
  const aiderResult   = detectCli('aider');
  const geminiResult  = detectCli('gemini');

  // Backward-compat fields used by the existing wizard UI
  const hasClaudeCli  = claudeResult.found;
  const claudeVersion = claudeResult.version;

  const builtinPath = path.join(app.getAppPath(), 'examples', 'agent-node.mjs');
  const hasBuiltin = fs.existsSync(builtinPath);

  // Detect local LLM services
  let hasOllama = false;
  let ollamaModels: string[] = [];
  let hasLmStudio = false;

  // Check Ollama (port 11434)
  try {
    const ollamaResp = execSync('curl -sf http://localhost:11434/api/tags 2>/dev/null', { timeout: 3000, encoding: 'utf-8' });
    const data = JSON.parse(ollamaResp);
    if (data.models?.length > 0) {
      hasOllama = true;
      ollamaModels = data.models.map((m: any) => m.name);
    }
  } catch { /* not running */ }

  // Check LM Studio (port 1234)
  try {
    const lmsResp = execSync('curl -sf http://localhost:1234/v1/models 2>/dev/null', { timeout: 3000, encoding: 'utf-8' });
    const data = JSON.parse(lmsResp);
    if (data.data?.length > 0) {
      hasLmStudio = true;
    }
  } catch { /* not running */ }

  return {
    hasClaudeCli, claudeVersion,
    hasAider: aiderResult.found, aiderVersion: aiderResult.version,
    hasGemini: geminiResult.found, geminiVersion: geminiResult.version,
    hasConfig, existingConfig, hasBuiltin, builtinPath,
    hasOllama, ollamaModels, hasLmStudio,
  };
});

ipcMain.handle('agent-save-config', async (_event, config: any) => {
  const configDir = path.join(os.homedir(), '.logan');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'agent-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { success: true };
});

// === Recent Files ===

ipcMain.handle('recent-files-list', async () => {
  // Filter out files that no longer exist
  const list = loadRecentFiles().filter(e => {
    try { return fs.existsSync(e.path); } catch { return false; }
  });
  return { success: true, files: list };
});

ipcMain.handle('recent-files-clear', async () => {
  saveRecentFiles([]);
  return { success: true };
});

ipcMain.handle('agent-browse-script', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Agent Script',
    filters: [
      { name: 'Scripts', extensions: ['mjs', 'js', 'ts', 'sh', 'py'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});
