import { contextBridge, ipcRenderer } from 'electron';

// IPC Channel constants (must match main process)
const IPC = {
  OPEN_FILE_DIALOG: 'open-file-dialog',
  OPEN_FILE: 'open-file',
  GET_LINES: 'get-lines',
  SEARCH: 'search',
  SEARCH_PROGRESS: 'search-progress',
  SEARCH_CANCEL: 'search-cancel',
} as const;

// API exposed to renderer
const api = {
  // File operations
  openFileDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.OPEN_FILE_DIALOG),

  openFile: (path: string): Promise<{ success: boolean; info?: any; error?: string }> =>
    ipcRenderer.invoke(IPC.OPEN_FILE, path),

  getLines: (startLine: number, count: number): Promise<{ success: boolean; lines?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.GET_LINES, startLine, count),

  getFileInfo: (): Promise<{ success: boolean; info?: any; error?: string }> =>
    ipcRenderer.invoke('get-file-info'),

  // Search
  search: (options: { pattern: string; isRegex: boolean; matchCase: boolean; wholeWord: boolean }): Promise<{ success: boolean; matches?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.SEARCH, options),

  cancelSearch: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.SEARCH_CANCEL),

  // Bookmarks
  addBookmark: (bookmark: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-add', bookmark),

  removeBookmark: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-remove', id),

  listBookmarks: (): Promise<{ success: boolean; bookmarks?: any[] }> =>
    ipcRenderer.invoke('bookmark-list'),

  clearBookmarks: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-clear'),

  // Highlights
  addHighlight: (highlight: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-add', highlight),

  removeHighlight: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-remove', id),

  listHighlights: (): Promise<{ success: boolean; highlights?: any[] }> =>
    ipcRenderer.invoke('highlight-list'),

  clearHighlights: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-clear'),

  getNextHighlightColor: (): Promise<{ success: boolean; color?: string }> =>
    ipcRenderer.invoke('highlight-get-next-color'),

  // Save selected lines
  saveSelectedLines: (startLine: number, endLine: number): Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }> =>
    ipcRenderer.invoke('save-selected-lines', startLine, endLine),

  // Split file
  splitFile: (options: { mode: 'lines' | 'parts'; value: number }): Promise<{ success: boolean; outputDir?: string; files?: string[]; partCount?: number; error?: string }> =>
    ipcRenderer.invoke('split-file', options),

  onSplitProgress: (callback: (data: { percent: number; currentPart: number; totalParts: number }) => void): (() => void) => {
    const handler = (_: any, data: { percent: number; currentPart: number; totalParts: number }) => callback(data);
    ipcRenderer.on('split-progress', handler);
    return () => ipcRenderer.removeListener('split-progress', handler);
  },

  // Event listeners
  onIndexingProgress: (callback: (percent: number) => void): (() => void) => {
    const handler = (_: any, percent: number) => callback(percent);
    ipcRenderer.on('indexing-progress', handler);
    return () => ipcRenderer.removeListener('indexing-progress', handler);
  },

  onSearchProgress: (callback: (data: { percent: number; matchCount: number }) => void): (() => void) => {
    const handler = (_: any, data: { percent: number; matchCount: number }) => callback(data);
    ipcRenderer.on(IPC.SEARCH_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.SEARCH_PROGRESS, handler);
  },

  // Analysis
  analyzeFile: (path: string): Promise<{ success: boolean; result?: any; error?: string }> =>
    ipcRenderer.invoke('analyze-file', path),

  applyFilter: (config: any): Promise<{ success: boolean; stats?: { filteredLines: number }; error?: string }> =>
    ipcRenderer.invoke('apply-filter', config),

  onAnalyzeProgress: (callback: (data: { phase: string; percent: number }) => void): (() => void) => {
    const handler = (_: any, data: { phase: string; percent: number }) => callback(data);
    ipcRenderer.on('analyze-progress', handler);
    return () => ipcRenderer.removeListener('analyze-progress', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
