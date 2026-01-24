import { contextBridge, ipcRenderer } from 'electron';

// IPC Channel constants (must match main process)
const IPC = {
  OPEN_FILE_DIALOG: 'open-file-dialog',
  OPEN_FILE: 'open-file',
  GET_LINES: 'get-lines',
  SEARCH: 'search',
  SEARCH_PROGRESS: 'search-progress',
  SEARCH_CANCEL: 'search-cancel',
  OPEN_FOLDER_DIALOG: 'open-folder-dialog',
  READ_FOLDER: 'read-folder',
  FOLDER_SEARCH: 'folder-search',
  FOLDER_SEARCH_PROGRESS: 'folder-search-progress',
  FOLDER_SEARCH_CANCEL: 'folder-search-cancel',
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

  // Folder operations
  openFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.OPEN_FOLDER_DIALOG),

  readFolder: (folderPath: string): Promise<{ success: boolean; files?: Array<{ name: string; path: string; isDirectory: boolean; size?: number }>; folderPath?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.READ_FOLDER, folderPath),

  // Folder search
  folderSearch: (folderPaths: string[], pattern: string, options: { isRegex: boolean; matchCase: boolean }): Promise<{ success: boolean; matches?: Array<{ filePath: string; fileName: string; lineNumber: number; column: number; lineText: string }>; cancelled?: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.FOLDER_SEARCH, folderPaths, pattern, options),

  cancelFolderSearch: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.FOLDER_SEARCH_CANCEL),

  onFolderSearchProgress: (callback: (data: { matchCount: number }) => void): (() => void) => {
    const handler = (_: any, data: { matchCount: number }) => callback(data);
    ipcRenderer.on(IPC.FOLDER_SEARCH_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.FOLDER_SEARCH_PROGRESS, handler);
  },

  getFileInfo: (): Promise<{ success: boolean; info?: any; error?: string }> =>
    ipcRenderer.invoke('get-file-info'),

  // System info
  checkSearchEngine: (): Promise<{ engine: 'ripgrep' | 'stream'; version: string | null }> =>
    ipcRenderer.invoke('check-search-engine'),

  // Search
  search: (options: { pattern: string; isRegex: boolean; matchCase: boolean; wholeWord: boolean; columnConfig?: { delimiter: string; columns: Array<{ index: number; visible: boolean }> } }): Promise<{ success: boolean; matches?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.SEARCH, options),

  cancelSearch: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.SEARCH_CANCEL),

  // Bookmarks
  addBookmark: (bookmark: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-add', bookmark),

  removeBookmark: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-remove', id),

  updateBookmark: (bookmark: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-update', bookmark),

  listBookmarks: (): Promise<{ success: boolean; bookmarks?: any[] }> =>
    ipcRenderer.invoke('bookmark-list'),

  clearBookmarks: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-clear'),

  exportBookmarks: (): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('export-bookmarks'),

  // Highlights
  addHighlight: (highlight: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-add', highlight),

  removeHighlight: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-remove', id),

  updateHighlight: (highlight: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-update', highlight),

  listHighlights: (): Promise<{ success: boolean; highlights?: any[] }> =>
    ipcRenderer.invoke('highlight-list'),

  clearHighlights: (): Promise<{ success: boolean; highlights?: any[] }> =>
    ipcRenderer.invoke('highlight-clear'),

  clearAllHighlights: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-clear-all'),

  getNextHighlightColor: (): Promise<{ success: boolean; color?: string }> =>
    ipcRenderer.invoke('highlight-get-next-color'),

  // Save selected lines
  saveSelectedLines: (startLine: number, endLine: number): Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }> =>
    ipcRenderer.invoke('save-selected-lines', startLine, endLine),

  // Save to notes file
  findNotesFiles: (): Promise<{ success: boolean; files?: Array<{ name: string; path: string; created: string }>; logFilePath?: string; error?: string }> =>
    ipcRenderer.invoke('find-notes-files'),

  saveToNotes: (startLine: number, endLine: number, note?: string, targetFilePath?: string): Promise<{ success: boolean; filePath?: string; lineCount?: number; isNewFile?: boolean; error?: string }> =>
    ipcRenderer.invoke('save-to-notes', startLine, endLine, note, targetFilePath),

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

  // Column Analysis
  analyzeColumns: (): Promise<{ success: boolean; analysis?: { delimiter: string; delimiterName: string; columns: Array<{ index: number; sample: string[]; visible: boolean }>; sampleLines: string[] }; error?: string }> =>
    ipcRenderer.invoke('analyze-columns'),

  // Analysis
  listAnalyzers: (): Promise<{ success: boolean; analyzers?: Array<{ name: string; description: string }> }> =>
    ipcRenderer.invoke('list-analyzers'),

  analyzeFile: (analyzerName?: string, options?: any): Promise<{ success: boolean; result?: any; error?: string }> =>
    ipcRenderer.invoke('analyze-file', analyzerName, options),

  cancelAnalysis: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('cancel-analysis'),

  applyFilter: (config: any): Promise<{ success: boolean; stats?: { filteredLines: number }; error?: string }> =>
    ipcRenderer.invoke('apply-filter', config),

  clearFilter: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('clear-filter'),

  onAnalyzeProgress: (callback: (data: { phase: string; percent: number; message?: string }) => void): (() => void) => {
    const handler = (_: any, data: { phase: string; percent: number; message?: string }) => callback(data);
    ipcRenderer.on('analyze-progress', handler);
    return () => ipcRenderer.removeListener('analyze-progress', handler);
  },

  // Open external URL in default browser
  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external-url', url),
};

contextBridge.exposeInMainWorld('api', api);
