// Core types for log analyzer

export interface FileInfo {
  path: string;
  size: number;
  totalLines: number;
}

export interface LineData {
  lineNumber: number;
  text: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'verbose' | 'trace';
}

export interface SearchMatch {
  lineNumber: number;
  column: number;
  length: number;
  lineText: string;
  displayIndex?: number;
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
  maxMatches?: number; // Cap on matches to collect (default DEFAULT_MAX_MATCHES). Raise for batch/config searches on huge files.
  silent?: boolean; // Background count only: skip logActivity + SEARCH_PROGRESS + don't touch the shared user search cancel signal (used by the Make-pattern live preview count).
  searchId?: number; // Monotonic id echoed back in SEARCH_PROGRESS so the renderer can drop late events from a search a newer one has superseded.
}

export interface Bookmark {
  id: string;
  lineNumber: number;
  label: string;
  color: string;
  lineText?: string;
  description?: string; // optional human/AI note: what this is for / why it was added
}

export interface Annotation {
  id: string;
  lineNumber: number;
  endLine?: number;        // optional range end (inclusive, 0-based)
  text: string;
  agentName: string;
  timestamp: number;
  severity?: 'info' | 'warning' | 'error';
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
  description?: string; // optional human/AI note: what this is for / why it was added
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
    | 'cadence_analysis'
    | 'analysis_run'
    | 'notes_saved'
    | 'lines_saved'
    | 'filter_extracted'
    | 'files_merged'
    | 'annotation_added';
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
  annotations?: Annotation[]; // agent annotations
  videoFilePath?: string;
  videoSyncOffsetMs?: number;
  // Decode identity of the adapter that produced the normalized text these marks
  // were pinned against (absent for plain-text passthrough). If a later open
  // decodes with a different adapter/version, marks may be stale — see index.ts.
  decodedBy?: { adapterId: string; decoderVersion: number };
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
  description?: string; // optional human/AI note: what this is for / why it was added
}

// A reusable, named pattern-property: a regex whose 1st capture group (or the
// whole match) is the tracked value, used by the Trends panel. Stored globally.
export interface PatternProperty {
  id: string;
  name: string;
  pattern: string;
  patternFlags?: string;
  unit?: string;
  createdAt: number;
  description?: string; // optional human/AI note: what this is for / why it was added
}

// A reusable, named search/regex pattern in the Pattern Library. Written once,
// then applied through different "lenses" (highlight / filter / columns / trend
// / pin) and saved at one of three scopes. PR-1 only uses scope 'global'; the
// scope + defaultLens fields are carried from day one so later PRs don't need a
// data migration.
export interface SavedPattern {
  id: string;
  label: string;
  regex: string;          // the pattern source (literal text unless isRegex)
  isRegex?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  color?: string;
  defaultLens?: string;   // 'highlight' | 'filter' | 'columns' | 'trend' | 'flips' | 'pin' (later PRs)
  scope: 'global' | 'ticket' | 'file';
  ticketId?: string;      // set when scope === 'ticket' (later PRs)
  createdAt: number;
  updatedAt: number;
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
  password?: string;    // password auth (stored plaintext — local app only)
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

// Context Search types
export interface ContextPattern {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  role: 'must' | 'clue';
  distance?: number;
  timeWindow?: number;
}

export interface ContextDefinition {
  id: string;
  name: string;
  color: string;
  patterns: ContextPattern[];
  proximityMode: 'lines' | 'time' | 'both';
  defaultDistance: number;
  defaultTimeWindow?: number;
  enabled: boolean;
  isGlobal: boolean;
  createdAt: number;
}

export interface ContextMatchGroup {
  contextId: string;
  mustLine: number;
  mustText: string;
  mustPatternId: string;
  clues: Array<{
    lineNumber: number;
    text: string;
    patternId: string;
    distance: number;
  }>;
  score: number;
  // Fulfillment: how many DISTINCT clue patterns were satisfied vs. defined.
  matchedPatternCount: number;
  totalCluePatterns: number;
  missingPatternIds: string[];
  complete: boolean; // matchedPatternCount === totalCluePatterns (always true for must-only contexts)
}

// Search config session (saved group of search configs)
export interface SearchConfigSession {
  id: string;           // `scs-${Date.now()}`
  name: string;
  configs: SearchConfig[];
  isGlobal: boolean;
  createdAt: number;
  description?: string; // optional human/AI note: what this is for / why it was added
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

// Saved connection (persisted in ~/.logan/connections.json)
export interface SavedConnection {
  id: string;
  name: string;
  source: 'serial' | 'logcat' | 'ssh';
  config: any; // SerialPortConfig | LogcatConfig | SshConnectionConfig
  createdAt: number;
  lastUsedAt: number | null;
}

// IPC Channels
export const IPC = {
  OPEN_FILE_DIALOG: 'open-file-dialog',
  OPEN_FILE: 'open-file',
  CREATE_COMPOSITE: 'create-composite',
  GET_LINES: 'get-lines',
  SEVERITY_INFO: 'severity-info',
  SEVERITY_NEXT: 'severity-next',
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
  SEARCH_CONFIG_BATCH_CHUNK: 'search-config-batch-chunk',
  SEARCH_CONFIG_EXPORT: 'search-config-export',
  SEARCH_CONFIG_EXPORT_ALL: 'search-config-export-all',
  SEARCH_CONFIG_EXPORT_IMAGE: 'search-config-export-image',
  PATTERN_PROP_LIST: 'pattern-prop-list',
  PATTERN_PROP_SAVE: 'pattern-prop-save',
  PATTERN_PROP_DELETE: 'pattern-prop-delete',
  // Pattern Library (reusable named search/regex patterns, global store for PR-1)
  PATTERN_LIB_LIST: 'pattern-lib-list',
  PATTERN_LIB_SAVE: 'pattern-lib-save',
  PATTERN_LIB_DELETE: 'pattern-lib-delete',
  SEARCH_CONFIG_SESSION_LIST: 'search-config-session-list',
  SEARCH_CONFIG_SESSION_SAVE: 'search-config-session-save',
  SEARCH_CONFIG_SESSION_DELETE: 'search-config-session-delete',
  GET_LINE_TIMESTAMP: 'get-line-timestamp',
  // Video transcode (AVI/etc → MP4 for the built-in player)
  VIDEO_TRANSCODE: 'video-transcode',
  VIDEO_TRANSCODE_PROGRESS: 'video-transcode-progress',
  VIDEO_TRANSCODE_CANCEL: 'video-transcode-cancel',
  // Investigation templates (capture agent's logic → save → replay)
  INVESTIGATION_LIST: 'investigation-list',
  INVESTIGATION_SAVE: 'investigation-save',
  INVESTIGATION_RUN: 'investigation-run',
  INVESTIGATION_DELETE: 'investigation-delete',
  INVESTIGATION_CHECK: 'investigation-check',                          // preflight requirements vs open log
  INVESTIGATION_SET_REQS: 'investigation-set-requirements',           // attach/replace requirements manifest
  INVESTIGATION_SUGGEST_REQS: 'investigation-suggest-requirements',   // suggest a starter manifest from open file
  // Entity Registry — one browse catalog over every saved entity
  ENTITIES_LIST: 'entities-list',
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
  // Tabbed terminal
  TERMINAL_CREATE_LOCAL: 'terminal-create-local',
  TERMINAL_CREATE_SSH: 'terminal-create-ssh',
  TERMINAL_WRITE: 'terminal-write',
  TERMINAL_RESIZE: 'terminal-resize',
  TERMINAL_KILL: 'terminal-kill',
  TERMINAL_DATA: 'terminal-data',
  TERMINAL_EXIT: 'terminal-exit',
  // Saved connections
  CONNECTION_LIST: 'connection-list',
  CONNECTION_SAVE: 'connection-save',
  CONNECTION_DELETE: 'connection-delete',
  CONNECTION_UPDATE: 'connection-update',
  // Baseline store
  BASELINE_LIST: 'baseline-list',
  BASELINE_SAVE: 'baseline-save',
  BASELINE_GET: 'baseline-get',
  BASELINE_UPDATE: 'baseline-update',
  BASELINE_DELETE: 'baseline-delete',
  BASELINE_COMPARE: 'baseline-compare',
  // Context search
  CONTEXT_DEFINITIONS_LOAD: 'context-definitions-load',
  CONTEXT_DEFINITIONS_SAVE: 'context-definitions-save',
  CONTEXT_SEARCH: 'context-search',
  CONTEXT_SEARCH_PROGRESS: 'context-search-progress',
  // Traceback
  TRACEBACK: 'traceback',
  // Time Align (batch timestamp fetch)
  GET_LINE_TIMESTAMPS: 'get-line-timestamps',
  READ_FILE_TEXT: 'read-file-text',
  // Extract the active filter's subset into a new file
  EXTRACT_FILTERED_TO_FILE: 'extract-filtered-to-file',
  // File-handler registry (plugin actions on a clicked file/folder)
  FILE_HANDLERS_RESOLVE: 'file-handlers-resolve',
  FILE_HANDLER_RUN: 'file-handler-run',
  // Trends notebook
  TREND_DISCOVER_FIELDS: 'trend-discover-fields',
  TREND_DISCOVER_AXES: 'trend-discover-axes',
  TREND_SERIES: 'trend-series',
  TREND_SIGNAL_SERIES: 'trend-signal-series',
  TREND_TRANSITIONS: 'trend-transitions',
  TREND_CORRELATE: 'trend-correlate',
  // Guided triage
  TRIAGE_RECIPE: 'triage-recipe',
  // Evidence pack (native "📋 Brief" — same briefing the AI's logan_evidence_pack builds)
  EVIDENCE_PACK: 'evidence-pack',
  // Usage Monitor (per-feature usage counts, split human vs AI)
  USAGE_BUMP: 'usage-bump',
  USAGE_GET: 'usage-get',
  USAGE_CLEAR: 'usage-clear',
  // Pattern log ("flight recorder" of pattern applications)
  PATTERN_LOG_GET: 'pattern-log-get',
  PATTERN_LOG_CLEAR: 'pattern-log-clear',
  PATTERN_LOG_ADD: 'pattern-log-add',
  // Controlled-pattern compiler ("Make pattern… from selection")
  COMPILE_PATTERN: 'compile-pattern',
  // Named constants (captured from a selection via "Save as constant…")
  CONSTANTS_SAVE: 'constants-save',
  CONSTANTS_GET: 'constants-get',
  CONSTANTS_DELETE: 'constants-delete',
  // Active scope ("Use filter/search/selection as scope" — human sets what the
  // AI's scope:"active" then runs inside; same instrument, two operators)
  SET_ACTIVE_SCOPE: 'set-active-scope',
  GET_ACTIVE_SCOPE: 'get-active-scope',
} as const;

// ─── Scope — run any verb over any subset of the log (VERB × SCOPE) ───
// A ScopeDescriptor is what a caller supplies; resolveScope() turns it into a
// ResolvedScope (a concrete contiguous range OR an explicit line-set) that the
// engines already know how to consume (trend ScanRange / the EXTRACT index-loop).
// Line numbers here are 0-based internal indices (the HTTP/main convention). The
// MCP layer converts from 1-based viewer lines, exactly like trend start/endLine.
export type ScopeDescriptor =
  | { type: 'all' }                                        // whole file (default — today's behaviour)
  | { type: 'active' }                                     // whatever the human/app currently has set
  | { type: 'filter' }                                     // the active filter's line-set
  | { type: 'search' }                                     // current search results' line-set
  | { type: 'selection' }                                  // the current viewer selection
  | { type: 'range'; start: number; end: number }          // contiguous, 0-based inclusive
  | { type: 'time'; from: string; to: string }             // wall-clock window
  | { type: 'component'; name: string }                    // lines belonging to a component
  | { type: 'indices'; lines: number[]; label?: string }   // explicit line-set (selection, findings, AI hits)
  | { type: 'compose'; scopes: ScopeDescriptor[]; label?: string }; // intersect (filter ∩ search ∩ range …)

// The two canonical shapes engines consume. Both seams already exist in the
// codebase: `range` → trend engine ScanRange; `indices` → EXTRACT index-loop.
export type ResolvedScope =
  | { kind: 'range'; startLine: number; endLine: number; label: string; count: number; warning?: string }
  | { kind: 'indices'; lines: number[]; label: string; count: number; warning?: string };

// A compact, JSON-safe summary of a resolved scope for tool/endpoint/IPC
// responses — "what am I looking through" (human label + line count).
export interface ScopeInfo {
  kind: 'range' | 'indices';
  label: string;
  count: number;
  startLine?: number; // 1-based, ranges only (for display)
  endLine?: number;   // 1-based, ranges only
  warning?: string;
}
