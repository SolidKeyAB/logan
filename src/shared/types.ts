// Core types for log analyzer

export interface FileInfo {
  path: string;
  size: number;
  totalLines: number;
}

export interface LineData {
  lineNumber: number;
  text: string;
  level?: 'error' | 'warning' | 'info' | 'debug' | 'trace';
}

export interface SearchMatch {
  lineNumber: number;
  column: number;
  length: number;
  lineText: string;
}

export interface SearchColumnConfig {
  delimiter: string;
  columns: Array<{ index: number; visible: boolean }>;
}

export interface SearchOptions {
  pattern: string;
  isRegex: boolean;
  isWildcard: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  columnConfig?: SearchColumnConfig;
  filteredLineIndices?: number[]; // When filter is active, only search these lines
}

export interface Bookmark {
  id: string;
  lineNumber: number;
  label: string;
  color: string;
  lineText?: string;
}

export interface BookmarkSet {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bookmarks: Bookmark[];
}

export interface Highlight {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  backgroundColor: string;
  textColor?: string;
  includeWhitespace: boolean;
  highlightAll: boolean; // true = all occurrences, false = first only per line
  isGlobal?: boolean; // true = applies to all files, false = file-specific
}

export interface HighlightGroup {
  id: string;
  name: string;
  highlights: Highlight[];
  createdAt: number;
}

export interface ChunkRequest {
  startLine: number;
  lineCount: number;
}

// Folder entry for tree view
export interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

// Folder search result
export interface FolderSearchMatch {
  filePath: string;
  fileName: string;
  lineNumber: number;
  column: number;
  lineText: string;
}

// Activity history entry for local .logan/ persistence
export interface ActivityEntry {
  timestamp: string; // ISO 8601
  action:
    | 'file_opened'
    | 'search'
    | 'filter_applied'
    | 'filter_cleared'
    | 'bookmark_added'
    | 'bookmark_removed'
    | 'bookmark_cleared'
    | 'highlight_added'
    | 'highlight_removed'
    | 'highlight_cleared'
    | 'diff_compared'
    | 'time_gap_analysis'
    | 'analysis_run'
    | 'notes_saved'
    | 'lines_saved';
  details: Record<string, unknown>;
}

// Local .logan/<filename>.json sidecar data
export interface LocalFileData {
  version: 1;
  logFile: string; // absolute path to source file
  lastOpened: string; // ISO 8601
  bookmarks: Bookmark[];
  highlights: Highlight[]; // file-specific only (non-global)
  activityHistory: ActivityEntry[]; // capped at 500
  videoFilePath?: string;
  videoSyncOffsetMs?: number;
}

// Search config definition
export interface SearchConfig {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  color: string;
  textColor?: string;
  enabled: boolean;
  isGlobal: boolean;
  createdAt: number;
}

// Serial port types
export interface SerialPortConfig {
  path: string;
  baudRate: number;
}

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

export interface SerialStatus {
  connected: boolean;
  portPath: string | null;
  baudRate: number;
  linesReceived: number;
  connectedSince: number | null; // epoch ms
  tempFilePath: string | null;
}

// Logcat types
export interface LogcatConfig {
  device?: string;
  filter?: string;
}

export interface LogcatDeviceInfo {
  id: string;
  state: string;
  model?: string;
}

export interface LogcatStatus {
  connected: boolean;
  deviceId: string | null;
  filter: string | null;
  linesReceived: number;
  connectedSince: number | null;
  tempFilePath: string | null;
}

// SSH types
export interface SshProfile {
  id: string;           // `ssh-${Date.now()}`
  name: string;         // user-friendly label
  host: string;         // hostname or SSH config alias
  port: number;         // default 22
  username: string;
  identityFile?: string; // path to key (from SSH config)
  createdAt: number;
}

export interface SshStatus {
  connected: boolean;
  host: string | null;
  username: string | null;
  remotePath: string | null;
  linesReceived: number;
  connectedSince: number | null;
  tempFilePath: string | null;
}

// Search config session (saved group of search configs)
export interface SearchConfigSession {
  id: string;           // `scs-${Date.now()}`
  name: string;
  configs: SearchConfig[];
  isGlobal: boolean;
  createdAt: number;
}

// Live connection info returned to renderer
export interface LiveConnectionInfo {
  id: string;
  source: 'serial' | 'logcat' | 'ssh';
  displayName: string;
  detail: string;
  connected: boolean;
  linesReceived: number;
  connectedSince: number | null;
  tempFilePath: string;
}

// IPC Channels
export const IPC = {
  OPEN_FILE_DIALOG: 'open-file-dialog',
  OPEN_FILE: 'open-file',
  GET_LINES: 'get-lines',
  SEARCH: 'search',
  SEARCH_PROGRESS: 'search-progress',
  SEARCH_CANCEL: 'search-cancel',
  GOTO_LINE: 'goto-line',
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
  // Device discovery (kept per-source)
  SERIAL_LIST_PORTS: 'serial-list-ports',
  LOGCAT_LIST_DEVICES: 'logcat-list-devices',
  // SSH profile/SFTP management
  SSH_PARSE_CONFIG: 'ssh-parse-config',
  SSH_LIST_PROFILES: 'ssh-list-profiles',
  SSH_SAVE_PROFILE: 'ssh-save-profile',
  SSH_DELETE_PROFILE: 'ssh-delete-profile',
  SSH_LIST_REMOTE_DIR: 'ssh-list-remote-dir',
  SSH_DOWNLOAD_FILE: 'ssh-download-file',
  // Unified live connection management
  LIVE_CONNECT: 'live-connect',
  LIVE_DISCONNECT: 'live-disconnect',
  LIVE_RESTART: 'live-restart',
  LIVE_REMOVE: 'live-remove',
  LIVE_SAVE_SESSION: 'live-save-session',
  LIVE_LINES_ADDED: 'live-lines-added',
  LIVE_ERROR: 'live-error',
  LIVE_DISCONNECTED: 'live-disconnected',
} as const;
