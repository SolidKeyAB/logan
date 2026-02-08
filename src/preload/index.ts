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
  DATADOG_LOAD_CONFIG: 'datadog-load-config',
  DATADOG_SAVE_CONFIG: 'datadog-save-config',
  DATADOG_FETCH_LOGS: 'datadog-fetch-logs',
  DATADOG_FETCH_PROGRESS: 'datadog-fetch-progress',
  DATADOG_CANCEL_FETCH: 'datadog-cancel-fetch',
  GET_LINES_FOR_FILE: 'get-lines-for-file',
  DIFF_COMPUTE: 'diff-compute',
  DIFF_CANCEL: 'diff-cancel',
  DIFF_PROGRESS: 'diff-compute-progress',
  LOAD_ACTIVITY_HISTORY: 'load-activity-history',
  CLEAR_ACTIVITY_HISTORY: 'clear-activity-history',
  GET_LOCAL_FILE_STATUS: 'get-local-file-status',
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
  search: (options: { pattern: string; isRegex: boolean; isWildcard: boolean; matchCase: boolean; wholeWord: boolean; columnConfig?: { delimiter: string; columns: Array<{ index: number; visible: boolean }> } }): Promise<{ success: boolean; matches?: any[]; error?: string }> =>
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

  // Bookmark Sets
  bookmarkSetList: (): Promise<{ success: boolean; sets?: any[] }> =>
    ipcRenderer.invoke('bookmark-set-list'),
  bookmarkSetSave: (set: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-set-save', set),
  bookmarkSetUpdate: (set: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-set-update', set),
  bookmarkSetDelete: (setId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('bookmark-set-delete', setId),
  bookmarkSetLoad: (setId: string): Promise<{ success: boolean; bookmarks?: any[] }> =>
    ipcRenderer.invoke('bookmark-set-load', setId),

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

  // Highlight groups
  listHighlightGroups: (): Promise<{ success: boolean; groups?: Array<{ id: string; name: string; highlights: any[]; createdAt: number }> }> =>
    ipcRenderer.invoke('highlight-group-list'),
  saveHighlightGroup: (group: { id: string; name: string; highlights: any[]; createdAt: number }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-group-save', group),
  deleteHighlightGroup: (groupId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('highlight-group-delete', groupId),

  // Save selected lines
  saveSelectedLines: (startLine: number, endLine: number, columnConfig?: { delimiter: string; columns: Array<{ index: number; visible: boolean }> }): Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }> =>
    ipcRenderer.invoke('save-selected-lines', startLine, endLine, columnConfig),

  // Save to notes file
  findNotesFiles: (): Promise<{ success: boolean; files?: Array<{ name: string; path: string; created: string }>; logFilePath?: string; error?: string }> =>
    ipcRenderer.invoke('find-notes-files'),

  saveToNotes: (startLine: number, endLine: number, note?: string, targetFilePath?: string, columnConfig?: { delimiter: string; columns: Array<{ index: number; visible: boolean }> }): Promise<{ success: boolean; filePath?: string; lineCount?: number; isNewFile?: boolean; error?: string }> =>
    ipcRenderer.invoke('save-to-notes', startLine, endLine, note, targetFilePath, columnConfig),

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

  cancelFilter: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('cancel-filter'),

  onFilterProgress: (callback: (data: { percent: number }) => void): (() => void) => {
    const handler = (_: any, data: { percent: number }) => callback(data);
    ipcRenderer.on('filter-progress', handler);
    return () => ipcRenderer.removeListener('filter-progress', handler);
  },

  clearFilter: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('clear-filter'),

  // Time Gap Detection
  detectTimeGaps: (options: { thresholdSeconds: number; startLine?: number; endLine?: number; startPattern?: string; endPattern?: string }): Promise<{ success: boolean; gaps?: Array<{ lineNumber: number; prevLineNumber: number; gapSeconds: number; prevTimestamp: string; currTimestamp: string; linePreview: string }>; totalLines?: number; error?: string }> =>
    ipcRenderer.invoke('detect-time-gaps', options),

  cancelTimeGaps: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('cancel-time-gaps'),

  onTimeGapProgress: (callback: (data: { percent: number }) => void): (() => void) => {
    const handler = (_: any, data: { percent: number }) => callback(data);
    ipcRenderer.on('time-gap-progress', handler);
    return () => ipcRenderer.removeListener('time-gap-progress', handler);
  },

  onAnalyzeProgress: (callback: (data: { phase: string; percent: number; message?: string }) => void): (() => void) => {
    const handler = (_: any, data: { phase: string; percent: number; message?: string }) => callback(data);
    ipcRenderer.on('analyze-progress', handler);
    return () => ipcRenderer.removeListener('analyze-progress', handler);
  },

  // Open external URL in default browser
  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external-url', url),

  // JSON formatting
  formatJsonFile: (filePath: string): Promise<{ success: boolean; formattedPath?: string; error?: string }> =>
    ipcRenderer.invoke('format-json-file', filePath),

  // Datadog
  datadogLoadConfig: (): Promise<{ success: boolean; config?: { site: string; hasApiKey: boolean; hasAppKey: boolean } | null }> =>
    ipcRenderer.invoke(IPC.DATADOG_LOAD_CONFIG),

  datadogSaveConfig: (config: { site: string; apiKey: string; appKey: string } | null): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.DATADOG_SAVE_CONFIG, config),

  datadogFetchLogs: (params: { query: string; from: string; to: string; maxLogs: number }): Promise<{ success: boolean; filePath?: string; logCount?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.DATADOG_FETCH_LOGS, params),

  datadogCancelFetch: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.DATADOG_CANCEL_FETCH),

  onDatadogFetchProgress: (callback: (data: { message: string; count: number }) => void): (() => void) => {
    const handler = (_: any, data: { message: string; count: number }) => callback(data);
    ipcRenderer.on(IPC.DATADOG_FETCH_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.DATADOG_FETCH_PROGRESS, handler);
  },

  // Terminal
  terminalCreate: (options?: { cwd?: string; cols?: number; rows?: number }): Promise<{ success: boolean; pid?: number; error?: string }> =>
    ipcRenderer.invoke('terminal-create', options),

  terminalWrite: (data: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal-write', data),

  terminalResize: (cols: number, rows: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal-resize', cols, rows),

  terminalKill: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal-kill'),

  terminalCd: (directory: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal-cd', directory),

  onTerminalData: (callback: (data: string) => void): (() => void) => {
    const handler = (_: any, data: string) => callback(data);
    ipcRenderer.on('terminal-data', handler);
    return () => ipcRenderer.removeListener('terminal-data', handler);
  },

  onTerminalExit: (callback: (exitCode: number) => void): (() => void) => {
    const handler = (_: any, exitCode: number) => callback(exitCode);
    ipcRenderer.on('terminal-exit', handler);
    return () => ipcRenderer.removeListener('terminal-exit', handler);
  },

  // Split/Diff view
  getLinesForFile: (filePath: string, startLine: number, count: number): Promise<{ success: boolean; lines?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.GET_LINES_FOR_FILE, filePath, startLine, count),

  computeDiff: (leftFilePath: string, rightFilePath: string): Promise<{ success: boolean; result?: any; error?: string }> =>
    ipcRenderer.invoke(IPC.DIFF_COMPUTE, leftFilePath, rightFilePath),

  cancelDiff: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.DIFF_CANCEL),

  onDiffProgress: (callback: (data: { percent: number; phase: string }) => void): (() => void) => {
    const handler = (_: any, data: { percent: number; phase: string }) => callback(data);
    ipcRenderer.on(IPC.DIFF_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.DIFF_PROGRESS, handler);
  },

  // Local file status & activity history
  loadActivityHistory: (): Promise<{ success: boolean; history?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.LOAD_ACTIVITY_HISTORY),

  clearActivityHistory: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CLEAR_ACTIVITY_HISTORY),

  getLocalFileStatus: (): Promise<{ exists: boolean; writable: boolean; localPath: string | null }> =>
    ipcRenderer.invoke(IPC.GET_LOCAL_FILE_STATUS),

  // Window controls
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),
};

contextBridge.exposeInMainWorld('api', api);
