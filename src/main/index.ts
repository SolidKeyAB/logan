import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { FileHandler } from './fileHandler';
import { IPC, SearchOptions, Bookmark, Highlight } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let fileHandler: FileHandler | null = null;
let searchSignal: { cancelled: boolean } = { cancelled: false };

// In-memory storage
const bookmarks = new Map<string, Bookmark>();
const highlights = new Map<string, Highlight>();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
    title: 'Log Analyzer',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
    fileHandler?.close();
  });
}

app.whenReady().then(createWindow);

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
    return { success: true, info };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

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
  return { success: true };
});

ipcMain.handle('bookmark-remove', async (_, id: string) => {
  bookmarks.delete(id);
  return { success: true };
});

ipcMain.handle('bookmark-list', async () => {
  return { success: true, bookmarks: Array.from(bookmarks.values()) };
});

ipcMain.handle('bookmark-clear', async () => {
  bookmarks.clear();
  return { success: true };
});

// === Highlights ===

ipcMain.handle('highlight-add', async (_, highlight: Highlight) => {
  highlights.set(highlight.id, highlight);
  return { success: true };
});

ipcMain.handle('highlight-remove', async (_, id: string) => {
  highlights.delete(id);
  return { success: true };
});

ipcMain.handle('highlight-list', async () => {
  return { success: true, highlights: Array.from(highlights.values()) };
});

ipcMain.handle('highlight-clear', async () => {
  highlights.clear();
  return { success: true };
});

// === Utility ===

ipcMain.handle('get-file-info', async () => {
  if (!fileHandler) return { success: false, error: 'No file open' };
  return { success: true, info: fileHandler.getFileInfo() };
});
