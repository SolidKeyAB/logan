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

interface SearchOptions {
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
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
  stats: FileStats;
  patterns: PatternGroup[];
  levelCounts: Record<string, number>;
  duplicateGroups: DuplicateGroup[];
  timeRange?: { start: string; end: string };
}

interface FilterConfig {
  minFrequency?: number;
  maxFrequency?: number;
  excludePatterns: string[];
  includePatterns: string[];
  levels: string[];
  collapseDuplicates: boolean;
  timeRange?: { start: string; end: string };
}

interface Bookmark {
  id: string;
  lineNumber: number;
  label?: string;
  color?: string;
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

interface Api {
  // File operations
  openFileDialog: () => Promise<string | null>;
  openFile: (path: string) => Promise<{ success: boolean; info?: FileInfo; error?: string; splitFiles?: string[]; splitIndex?: number; bookmarks?: Bookmark[]; highlights?: HighlightConfig[] }>;
  getLines: (startLine: number, count: number) => Promise<{ success: boolean; lines?: LogLine[]; error?: string }>;
  getFileInfo: () => Promise<{ success: boolean; info?: FileInfo; error?: string }>;

  // Search
  search: (options: SearchOptions) => Promise<{ success: boolean; matches?: SearchResult[]; error?: string }>;
  cancelSearch: () => Promise<{ success: boolean }>;

  // Bookmarks
  addBookmark: (bookmark: Bookmark) => Promise<{ success: boolean }>;
  removeBookmark: (id: string) => Promise<{ success: boolean }>;
  updateBookmark: (bookmark: Bookmark) => Promise<{ success: boolean }>;
  listBookmarks: () => Promise<{ success: boolean; bookmarks?: Bookmark[] }>;
  clearBookmarks: () => Promise<{ success: boolean }>;

  // Highlights
  addHighlight: (highlight: HighlightConfig) => Promise<{ success: boolean }>;
  removeHighlight: (id: string) => Promise<{ success: boolean }>;
  updateHighlight: (highlight: HighlightConfig) => Promise<{ success: boolean }>;
  listHighlights: () => Promise<{ success: boolean; highlights?: HighlightConfig[] }>;
  clearHighlights: () => Promise<{ success: boolean; highlights?: HighlightConfig[] }>;
  clearAllHighlights: () => Promise<{ success: boolean }>;
  getNextHighlightColor: () => Promise<{ success: boolean; color?: string }>;

  // Save selected lines
  saveSelectedLines: (startLine: number, endLine: number) => Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }>;
  saveToNotes: (startLine: number, endLine: number, note?: string) => Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }>;

  // Split file
  splitFile: (options: { mode: 'lines' | 'parts'; value: number }) => Promise<{ success: boolean; outputDir?: string; files?: string[]; partCount?: number; error?: string }>;
  onSplitProgress: (callback: (data: { percent: number; currentPart: number; totalParts: number }) => void) => () => void;

  // Analysis
  analyzeFile: (path: string) => Promise<{ success: boolean; result?: AnalysisResult; error?: string }>;
  applyFilter: (config: FilterConfig) => Promise<{ success: boolean; stats?: { filteredLines: number }; error?: string }>;

  // Events
  onIndexingProgress: (callback: (percent: number) => void) => () => void;
  onSearchProgress: (callback: (data: { percent: number; matchCount: number }) => void) => () => void;
  onAnalyzeProgress: (callback: (data: { phase: string; percent: number }) => void) => () => void;
}

interface Window {
  api: Api;
}
