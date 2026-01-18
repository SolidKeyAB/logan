import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { FileHandler } from './fileHandler';
import { IPC, SearchOptions, Bookmark, Highlight } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let fileHandler: FileHandler | null = null;
let searchSignal: { cancelled: boolean } = { cancelled: false };
let currentFilePath: string | null = null;

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

function loadHighlightsFromConfig(): void {
  try {
    ensureConfigDir();
    const configPath = getHighlightsPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const savedHighlights: Highlight[] = JSON.parse(data);
      highlights.clear();
      for (const h of savedHighlights) {
        highlights.set(h.id, h);
      }
    }
  } catch (error) {
    console.error('Failed to load highlights config:', error);
  }
}

function saveHighlightsToConfig(): void {
  try {
    ensureConfigDir();
    const configPath = getHighlightsPath();
    const data = JSON.stringify(Array.from(highlights.values()), null, 2);
    fs.writeFileSync(configPath, data, 'utf-8');
  } catch (error) {
    console.error('Failed to save highlights config:', error);
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
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
    fileHandler?.close();
  });
}

app.whenReady().then(() => {
  loadHighlightsFromConfig();
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
      { name: 'Log Files', extensions: ['log', 'txt', 'json', 'out', 'err'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle(IPC.OPEN_FILE, async (_, filePath: string) => {
  try {
    fileHandler = new FileHandler();
    const info = await fileHandler.open(filePath, (percent) => {
      mainWindow?.webContents.send('indexing-progress', percent);
    });

    // Load bookmarks for this file
    loadBookmarksForFile(filePath);

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
      bookmarks: Array.from(bookmarks.values())
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
  if (!fileHandler) return { success: false, error: 'No file open' };
  const lines = fileHandler.getLines(startLine, count);
  return { success: true, lines };
});

// === Search ===

ipcMain.handle(IPC.SEARCH, async (_, options: SearchOptions) => {
  if (!fileHandler) return { success: false, error: 'No file open' };

  searchSignal = { cancelled: false };

  try {
    const matches = await fileHandler.search(
      options,
      (percent, matchCount) => {
        mainWindow?.webContents.send(IPC.SEARCH_PROGRESS, { percent, matchCount });
      },
      searchSignal
    );
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

// === Highlights ===

ipcMain.handle('highlight-add', async (_, highlight: Highlight) => {
  highlights.set(highlight.id, highlight);
  saveHighlightsToConfig();
  return { success: true };
});

ipcMain.handle('highlight-remove', async (_, id: string) => {
  highlights.delete(id);
  saveHighlightsToConfig();
  return { success: true };
});

ipcMain.handle('highlight-list', async () => {
  return { success: true, highlights: Array.from(highlights.values()) };
});

ipcMain.handle('highlight-clear', async () => {
  highlights.clear();
  saveHighlightsToConfig();
  return { success: true };
});

ipcMain.handle('highlight-get-next-color', async () => {
  return { success: true, color: getNextColor() };
});

// === Utility ===

ipcMain.handle('get-file-info', async () => {
  if (!fileHandler) return { success: false, error: 'No file open' };
  return { success: true, info: fileHandler.getFileInfo() };
});

// === Save Selected Lines ===

ipcMain.handle('save-selected-lines', async (_, startLine: number, endLine: number) => {
  if (!fileHandler) return { success: false, error: 'No file open' };

  try {
    // Get the lines
    const count = endLine - startLine + 1;
    const lines = fileHandler.getLines(startLine, count);

    if (lines.length === 0) {
      return { success: false, error: 'No lines to save' };
    }

    // Get current file's directory
    const fileInfo = fileHandler.getFileInfo();
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

// === Split File ===

interface SplitOptions {
  mode: 'lines' | 'parts';
  value: number; // lines per file or number of parts
}

ipcMain.handle('split-file', async (_, options: SplitOptions) => {
  if (!fileHandler) return { success: false, error: 'No file open' };

  try {
    const fileInfo = fileHandler.getFileInfo();
    if (!fileInfo) return { success: false, error: 'No file info' };

    const totalLines = fileHandler.getTotalLines();
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
          const lines = fileHandler!.getLines(batchStart, batchEnd - batchStart);
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
