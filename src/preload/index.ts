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
  SEARCH_CONFIG_SAVE: 'search-config-save',
  SEARCH_CONFIG_LOAD: 'search-config-load',
  SEARCH_CONFIG_DELETE: 'search-config-delete',
  SEARCH_CONFIG_BATCH: 'search-config-batch',
  SEARCH_CONFIG_BATCH_PROGRESS: 'search-config-batch-progress',
  SEARCH_CONFIG_EXPORT: 'search-config-export',
  SEARCH_CONFIG_EXPORT_ALL: 'search-config-export-all',
  SEARCH_CONFIG_SESSION_LIST: 'search-config-session-list',
  SEARCH_CONFIG_SESSION_SAVE: 'search-config-session-save',
  SEARCH_CONFIG_SESSION_DELETE: 'search-config-session-delete',
  GET_LINE_TIMESTAMP: 'get-line-timestamp',
  SERIAL_LIST_PORTS: 'serial-list-ports',
  LOGCAT_LIST_DEVICES: 'logcat-list-devices',
  SSH_PARSE_CONFIG: 'ssh-parse-config',
  SSH_LIST_PROFILES: 'ssh-list-profiles',
  SSH_SAVE_PROFILE: 'ssh-save-profile',
  SSH_DELETE_PROFILE: 'ssh-delete-profile',
  SSH_LIST_REMOTE_DIR: 'ssh-list-remote-dir',
  SSH_DOWNLOAD_FILE: 'ssh-download-file',
  LIVE_CONNECT: 'live-connect',
  LIVE_DISCONNECT: 'live-disconnect',
  LIVE_RESTART: 'live-restart',
  LIVE_REMOVE: 'live-remove',
  LIVE_SAVE_SESSION: 'live-save-session',
  LIVE_LINES_ADDED: 'live-lines-added',
  LIVE_ERROR: 'live-error',
  LIVE_DISCONNECTED: 'live-disconnected',
  BASELINE_LIST: 'baseline-list',
  BASELINE_SAVE: 'baseline-save',
  BASELINE_GET: 'baseline-get',
  BASELINE_UPDATE: 'baseline-update',
  BASELINE_DELETE: 'baseline-delete',
  BASELINE_COMPARE: 'baseline-compare',
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

  // JSON format progress
  onJsonFormatProgress: (callback: (data: { percent: number }) => void): (() => void) => {
    const handler = (_: any, data: { percent: number }) => callback(data);
    ipcRenderer.on('json-format-progress', handler);
    return () => ipcRenderer.removeListener('json-format-progress', handler);
  },

  // Local file status & activity history
  loadActivityHistory: (): Promise<{ success: boolean; history?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.LOAD_ACTIVITY_HISTORY),

  clearActivityHistory: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CLEAR_ACTIVITY_HISTORY),

  getLocalFileStatus: (): Promise<{ exists: boolean; writable: boolean; localPath: string | null }> =>
    ipcRenderer.invoke(IPC.GET_LOCAL_FILE_STATUS),

  // Notes drawer
  loadNotes: (): Promise<{ success: boolean; content?: string }> =>
    ipcRenderer.invoke('load-notes'),

  saveNotes: (content: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('save-notes', content),

  // File context menu actions
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('show-item-in-folder', filePath),

  readFileContent: (filePath: string): Promise<{ success: boolean; content?: string; sizeMB?: number; error?: string }> =>
    ipcRenderer.invoke('read-file-content', filePath),

  // Search configs
  searchConfigSave: (config: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_SAVE, config),

  searchConfigLoad: (): Promise<{ success: boolean; configs?: any[] }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_LOAD),

  searchConfigDelete: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_DELETE, id),

  searchConfigBatch: (configs: any[]): Promise<{ success: boolean; results?: Record<string, any[]>; error?: string }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_BATCH, configs),

  onSearchConfigBatchProgress: (callback: (data: { percent: number; configId: string }) => void): (() => void) => {
    const handler = (_: any, data: { percent: number; configId: string }) => callback(data);
    ipcRenderer.on(IPC.SEARCH_CONFIG_BATCH_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.SEARCH_CONFIG_BATCH_PROGRESS, handler);
  },

  searchConfigExport: (configId: string, lines: string[]): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_EXPORT, configId, lines),

  searchConfigExportAll: (content: string): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_EXPORT_ALL, content),

  // Search config sessions
  searchConfigSessionList: (): Promise<{ success: boolean; sessions?: any[] }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_SESSION_LIST),

  searchConfigSessionSave: (session: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_SESSION_SAVE, session),

  searchConfigSessionDelete: (sessionId: string, isGlobal: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC.SEARCH_CONFIG_SESSION_DELETE, sessionId, isGlobal),

  // Video player
  getLineTimestamp: (lineNumber: number): Promise<{ epochMs: number | null; timestampStr: string | null }> =>
    ipcRenderer.invoke(IPC.GET_LINE_TIMESTAMP, lineNumber),

  // MCP navigation
  onNavigateToLine: (callback: (lineNumber: number) => void): (() => void) => {
    const handler = (_: any, lineNumber: number) => callback(lineNumber);
    ipcRenderer.on('navigate-to-line', handler);
    return () => ipcRenderer.removeListener('navigate-to-line', handler);
  },

  // Device discovery
  serialListPorts: (): Promise<{ success: boolean; ports?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.SERIAL_LIST_PORTS),

  logcatListDevices: (): Promise<{ success: boolean; devices?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.LOGCAT_LIST_DEVICES),

  // SSH profiles & SFTP
  sshParseConfig: (): Promise<{ success: boolean; hosts?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.SSH_PARSE_CONFIG),

  sshListProfiles: (): Promise<{ success: boolean; profiles?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.SSH_LIST_PROFILES),

  sshSaveProfile: (profile: any): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SSH_SAVE_PROFILE, profile),

  sshDeleteProfile: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SSH_DELETE_PROFILE, id),

  sshListRemoteDir: (remotePath: string): Promise<{ success: boolean; files?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.SSH_LIST_REMOTE_DIR, remotePath),

  sshDownloadFile: (remotePath: string): Promise<{ success: boolean; localPath?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.SSH_DOWNLOAD_FILE, remotePath),

  // Unified live connection management
  liveConnect: (source: string, config: any, displayName: string, detail: string): Promise<{ success: boolean; connectionId?: string; tempFilePath?: string; info?: any; error?: string }> =>
    ipcRenderer.invoke(IPC.LIVE_CONNECT, source, config, displayName, detail),

  liveDisconnect: (connectionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.LIVE_DISCONNECT, connectionId),

  liveRestart: (connectionId: string): Promise<{ success: boolean; tempFilePath?: string; info?: any; error?: string }> =>
    ipcRenderer.invoke(IPC.LIVE_RESTART, connectionId),

  liveRemove: (connectionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.LIVE_REMOVE, connectionId),

  liveSaveSession: (connectionId: string): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.LIVE_SAVE_SESSION, connectionId),

  onLiveLinesAdded: (callback: (data: { connectionId: string; totalLines: number; newLines: number }) => void): (() => void) => {
    const handler = (_: any, data: { connectionId: string; totalLines: number; newLines: number }) => callback(data);
    ipcRenderer.on(IPC.LIVE_LINES_ADDED, handler);
    return () => ipcRenderer.removeListener(IPC.LIVE_LINES_ADDED, handler);
  },

  onLiveError: (callback: (data: { connectionId: string; message: string }) => void): (() => void) => {
    const handler = (_: any, data: { connectionId: string; message: string }) => callback(data);
    ipcRenderer.on(IPC.LIVE_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.LIVE_ERROR, handler);
  },

  onLiveDisconnected: (callback: (data: { connectionId: string }) => void): (() => void) => {
    const handler = (_: any, data: { connectionId: string }) => callback(data);
    ipcRenderer.on(IPC.LIVE_DISCONNECTED, handler);
    return () => ipcRenderer.removeListener(IPC.LIVE_DISCONNECTED, handler);
  },

  // Baselines
  baselineList: (): Promise<{ success: boolean; baselines?: any[]; error?: string }> =>
    ipcRenderer.invoke(IPC.BASELINE_LIST),

  baselineSave: (name: string, description: string, tags: string[]): Promise<{ success: boolean; id?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.BASELINE_SAVE, name, description, tags),

  baselineGet: (id: string): Promise<{ success: boolean; baseline?: any; error?: string }> =>
    ipcRenderer.invoke(IPC.BASELINE_GET, id),

  baselineUpdate: (id: string, fields: { name?: string; description?: string; tags?: string[] }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.BASELINE_UPDATE, id, fields),

  baselineDelete: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.BASELINE_DELETE, id),

  baselineCompare: (baselineId: string): Promise<{ success: boolean; report?: any; error?: string }> =>
    ipcRenderer.invoke(IPC.BASELINE_COMPARE, baselineId),

  // Window controls
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window-close'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),
};

contextBridge.exposeInMainWorld('api', api);
