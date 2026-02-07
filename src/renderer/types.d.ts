interface FileStats {
  path: string;
  size: number;
  totalLines: number;
  indexedAt: number;
}

interface FileInfo {
  path: string;
  size: number;
  totalLines: number;
}

interface LogLine {
  lineNumber: number;
  text: string;
  level?: string;
  timestamp?: string;
  filtered?: boolean;
  duplicateCount?: number;
}

interface SearchResult {
  lineNumber: number;
  column: number;
  length: number;
  text: string;
  lineText: string;
}

interface SearchColumnConfig {
  delimiter: string;
  columns: Array<{ index: number; visible: boolean }>;
}

interface SearchOptions {
  pattern: string;
  isRegex: boolean;
  isWildcard: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  columnConfig?: SearchColumnConfig;
}

interface PatternGroup {
  pattern: string;
  template: string;
  count: number;
  sampleLines: number[];
  category: 'noise' | 'error' | 'warning' | 'info' | 'debug' | 'unknown';
}

interface DuplicateGroup {
  hash: string;
  text: string;
  count: number;
  lineNumbers: number[];
}

interface AnalysisResult {
  stats: {
    totalLines: number;
    analyzedLines: number;
    uniquePatterns: number;
    duplicateLines: number;
  };
  patterns: PatternGroup[];
  levelCounts: Record<string, number>;
  duplicateGroups: DuplicateGroup[];
  timeRange?: { start: string; end: string };
  analyzerName: string;
  analyzedAt: number;
}

interface AnalyzerOptions {
  maxPatterns?: number;
  maxDuplicates?: number;
  sampleSize?: number;
  includeLineText?: boolean;
}

interface FilterConfig {
  minFrequency?: number;
  maxFrequency?: number;
  excludePatterns: string[];
  includePatterns: string[];
  levels: string[];
  matchCase?: boolean;
  exactMatch?: boolean;
  timeRange?: { start: string; end: string };
  contextLines?: number;
}

interface Bookmark {
  id: string;
  lineNumber: number;
  label?: string;
  color?: string;
  lineText?: string;
  createdAt: number;
}

interface HighlightConfig {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  backgroundColor: string;
  textColor?: string;
  includeWhitespace: boolean;
  highlightAll: boolean; // true = all occurrences, false = first only per line
  isGlobal?: boolean; // true = applies to all files, false = file-specific
}

interface FolderFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

interface FolderSearchMatch {
  filePath: string;
  fileName: string;
  lineNumber: number;
  column: number;
  lineText: string;
}

interface ColumnInfo {
  index: number;
  sample: string[];
  visible: boolean;
}

interface ColumnAnalysis {
  delimiter: string;
  delimiterName: string;
  columns: ColumnInfo[];
  sampleLines: string[];
}

interface Api {
  // File operations
  openFileDialog: () => Promise<string | null>;
  openFile: (path: string) => Promise<{ success: boolean; info?: FileInfo; error?: string; splitFiles?: string[]; splitIndex?: number; bookmarks?: Bookmark[]; highlights?: HighlightConfig[] }>;
  getLines: (startLine: number, count: number) => Promise<{ success: boolean; lines?: LogLine[]; error?: string }>;
  getFileInfo: () => Promise<{ success: boolean; info?: FileInfo; error?: string }>;

  // Folder operations
  openFolderDialog: () => Promise<string | null>;
  readFolder: (folderPath: string) => Promise<{ success: boolean; files?: FolderFile[]; folderPath?: string; error?: string }>;

  // Folder search
  folderSearch: (folderPaths: string[], pattern: string, options: { isRegex: boolean; matchCase: boolean }) => Promise<{ success: boolean; matches?: FolderSearchMatch[]; cancelled?: boolean; error?: string }>;
  cancelFolderSearch: () => Promise<{ success: boolean }>;
  onFolderSearchProgress: (callback: (data: { matchCount: number }) => void) => () => void;

  // System info
  checkSearchEngine: () => Promise<{ engine: 'ripgrep' | 'stream'; version: string | null }>;

  // Search
  search: (options: SearchOptions) => Promise<{ success: boolean; matches?: SearchResult[]; error?: string }>;
  cancelSearch: () => Promise<{ success: boolean }>;

  // Bookmarks
  addBookmark: (bookmark: Bookmark) => Promise<{ success: boolean }>;
  removeBookmark: (id: string) => Promise<{ success: boolean }>;
  updateBookmark: (bookmark: Bookmark) => Promise<{ success: boolean }>;
  listBookmarks: () => Promise<{ success: boolean; bookmarks?: Bookmark[] }>;
  clearBookmarks: () => Promise<{ success: boolean }>;
  exportBookmarks: () => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // Highlights
  addHighlight: (highlight: HighlightConfig) => Promise<{ success: boolean }>;
  removeHighlight: (id: string) => Promise<{ success: boolean }>;
  updateHighlight: (highlight: HighlightConfig) => Promise<{ success: boolean }>;
  listHighlights: () => Promise<{ success: boolean; highlights?: HighlightConfig[] }>;
  clearHighlights: () => Promise<{ success: boolean; highlights?: HighlightConfig[] }>;
  clearAllHighlights: () => Promise<{ success: boolean }>;
  getNextHighlightColor: () => Promise<{ success: boolean; color?: string }>;

  // Highlight groups
  listHighlightGroups: () => Promise<{ success: boolean; groups?: Array<{ id: string; name: string; highlights: HighlightConfig[]; createdAt: number }> }>;
  saveHighlightGroup: (group: { id: string; name: string; highlights: HighlightConfig[]; createdAt: number }) => Promise<{ success: boolean }>;
  deleteHighlightGroup: (groupId: string) => Promise<{ success: boolean }>;

  // Save selected lines
  saveSelectedLines: (startLine: number, endLine: number, columnConfig?: { delimiter: string; columns: Array<{ index: number; visible: boolean }> }) => Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }>;

  // Notes files
  findNotesFiles: () => Promise<{ success: boolean; files?: Array<{ name: string; path: string; created: string }>; logFilePath?: string; error?: string }>;
  saveToNotes: (startLine: number, endLine: number, note?: string, targetFilePath?: string, columnConfig?: { delimiter: string; columns: Array<{ index: number; visible: boolean }> }) => Promise<{ success: boolean; filePath?: string; lineCount?: number; isNewFile?: boolean; error?: string }>;

  // Split file
  splitFile: (options: { mode: 'lines' | 'parts'; value: number }) => Promise<{ success: boolean; outputDir?: string; files?: string[]; partCount?: number; error?: string }>;
  onSplitProgress: (callback: (data: { percent: number; currentPart: number; totalParts: number }) => void) => () => void;

  // Analysis
  listAnalyzers: () => Promise<{ success: boolean; analyzers?: Array<{ name: string; description: string }> }>;
  analyzeFile: (analyzerName?: string, options?: AnalyzerOptions) => Promise<{ success: boolean; result?: AnalysisResult; error?: string }>;
  cancelAnalysis: () => Promise<{ success: boolean }>;
  applyFilter: (config: any) => Promise<{ success: boolean; stats?: { filteredLines: number }; error?: string }>;
  cancelFilter: () => Promise<{ success: boolean }>;
  onFilterProgress: (callback: (data: { percent: number }) => void) => () => void;
  clearFilter: () => Promise<{ success: boolean }>;

  // Time Gap Detection
  detectTimeGaps: (options: { thresholdSeconds: number; startLine?: number; endLine?: number; startPattern?: string; endPattern?: string }) => Promise<{ success: boolean; gaps?: Array<{ lineNumber: number; prevLineNumber: number; gapSeconds: number; prevTimestamp: string; currTimestamp: string; linePreview: string }>; totalLines?: number; error?: string }>;
  cancelTimeGaps: () => Promise<{ success: boolean }>;
  onTimeGapProgress: (callback: (data: { percent: number }) => void) => () => void;

  // Column Analysis
  analyzeColumns: () => Promise<{ success: boolean; analysis?: ColumnAnalysis; error?: string }>;

  // Events
  onIndexingProgress: (callback: (percent: number) => void) => () => void;
  onSearchProgress: (callback: (data: { percent: number; matchCount: number }) => void) => () => void;
  onAnalyzeProgress: (callback: (data: { phase: string; percent: number; message?: string }) => void) => () => void;

  // Utilities
  openExternalUrl: (url: string) => Promise<void>;

  // Terminal
  terminalCreate: (options?: { cwd?: string; cols?: number; rows?: number }) => Promise<{ success: boolean; pid?: number; error?: string }>;
  terminalWrite: (data: string) => Promise<{ success: boolean; error?: string }>;
  terminalResize: (cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
  terminalKill: () => Promise<{ success: boolean; error?: string }>;
  terminalCd: (directory: string) => Promise<{ success: boolean; error?: string }>;
  onTerminalData: (callback: (data: string) => void) => () => void;
  onTerminalExit: (callback: (exitCode: number) => void) => () => void;

  // Datadog
  datadogLoadConfig: () => Promise<{ success: boolean; config?: { site: string; hasApiKey: boolean; hasAppKey: boolean } | null }>;
  datadogSaveConfig: (config: { site: string; apiKey: string; appKey: string } | null) => Promise<{ success: boolean; error?: string }>;
  datadogFetchLogs: (params: { query: string; from: string; to: string; maxLogs: number }) => Promise<{ success: boolean; filePath?: string; logCount?: number; error?: string }>;
  datadogCancelFetch: () => Promise<{ success: boolean }>;
  onDatadogFetchProgress: (callback: (data: { message: string; count: number }) => void) => () => void;

  // Window controls
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  getPlatform: () => Promise<string>;
}

interface Window {
  api: Api;
}
