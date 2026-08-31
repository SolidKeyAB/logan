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

// Scope — run any verb over a subset (mirrors src/shared/types.ts; the renderer
// is a script so shared types are duplicated here). Line numbers 0-based.
type ScopeDescriptor =
  | { type: 'all' }
  | { type: 'active' }
  | { type: 'filter' }
  | { type: 'search' }
  | { type: 'selection' }
  | { type: 'range'; start: number; end: number }
  | { type: 'time'; from: string; to: string }
  | { type: 'component'; name: string }
  | { type: 'indices'; lines: number[]; label?: string }
  | { type: 'compose'; scopes: ScopeDescriptor[]; label?: string };

interface ScopeInfo {
  kind: 'range' | 'indices';
  label: string;
  count: number;
  startLine?: number; // 1-based, ranges only
  endLine?: number;
  warning?: string;
}

// Semantic-summary result (mirror of src/main/logTemplates.ts, ambient for the renderer).
interface LogTemplate {
  id: number;
  shape: string;
  count: number;
  firstLine: number; // 1-based viewerLine
  lastLine: number;
  firstTs?: string;
  lastTs?: string;
  severity: string | null;
  examples: number[]; // 1-based viewerLines
}
interface TemplateSummary {
  templates: LogTemplate[];
  other: { lines: number; shapes: number };
  totalLines: number;
  distinctShapes: number;
  coverage: number; // 0..1
  capped: boolean;
  matchedTemplates?: number; // present when a `contains` lens was applied
}

// In-place viewer folding — a contiguous repeating block (mirror of foldRegions.ts).
interface FoldRegion {
  start: number;       // 0-based first file line (inclusive)
  end: number;         // 0-based last file line (inclusive)
  blockLen: number;    // repeating-unit length; first blockLen lines stay visible
  repeatCount: number;
  totalLines: number;  // end - start + 1
  hiddenLines: number; // totalLines - blockLen
  sample: string;      // first line text (trimmed)
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
  silent?: boolean; // background count only: skip history/telemetry/progress + separate cancel signal
  columnConfig?: SearchColumnConfig;
  searchId?: number; // monotonic id echoed in SEARCH_PROGRESS so late events from a superseded search can be dropped
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
  description?: string; // optional human/AI note: what this is for / why it was added
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
  description?: string; // optional human/AI note: what this is for / why it was added
}

interface FolderFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  fileType?: 'text' | 'image' | 'video' | 'binary';
  hasChildren?: boolean;
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

interface DiffHunk {
  type: 'equal' | 'added' | 'removed' | 'modified';
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
}

interface DiffResult {
  hunks: DiffHunk[];
  stats: { additions: number; deletions: number; modifications: number };
  leftTotalLines: number;
  rightTotalLines: number;
}

interface DiffDisplayLine {
  type: 'equal' | 'added' | 'removed' | 'modified' | 'spacer';
  realLineNumber: number; // -1 for spacers
  hunkIndex: number; // which hunk this belongs to
}

interface ActivityEntry {
  timestamp: string;
  action: string;
  details: Record<string, unknown>;
}

interface SearchConfigDef {
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

// A reusable, named pattern-property: a regex whose 1st capture group (or whole
// match) is the tracked value. Saved globally and reusable across files in the
// Trends panel (chart value-over-time / flips / correlate).
interface PatternPropertyDef {
  id: string;
  name: string;
  pattern: string;
  patternFlags?: string;
  unit?: string;
  createdAt: number;
  description?: string; // optional human/AI note: what this is for / why it was added
}

// A reusable, named search/regex pattern in the Pattern Library. Written once,
// applied through different lenses and saved at global/ticket/file scope. PR-1
// uses only scope 'global'; scope + defaultLens carried for later PRs.
interface SavedPatternDef {
  id: string;
  label: string;
  regex: string;
  isRegex?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  color?: string;
  defaultLens?: string;
  scope: 'global' | 'ticket' | 'file';
  ticketId?: string;
  createdAt: number;
  updatedAt: number;
}

interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  identityFile?: string;
  createdAt: number;
}

interface SshHostEntry {
  host: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

interface SshStatus {
  connected: boolean;
  host: string | null;
  username: string | null;
  remotePath: string | null;
  linesReceived: number;
  connectedSince: number | null;
  tempFilePath: string | null;
}

interface SearchConfigSessionDef {
  id: string;
  name: string;
  configs: SearchConfigDef[];
  isGlobal: boolean;
  createdAt: number;
  description?: string; // optional human/AI note: what this is for / why it was added
}

interface BaselineRecord {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sourceFile: string;
  totalLines: number;
}

interface ComparisonFinding {
  severity: 'critical' | 'warning' | 'info';
  category: 'level-shift' | 'new-crash' | 'new-component' | 'missing-component' | 'error-rate' | 'time-pattern' | 'general';
  title: string;
  detail: string;
  baselineValue?: string;
  currentValue?: string;
}

interface ComparisonReport {
  baselineId: string;
  baselineName: string;
  comparedAt: number;
  findings: ComparisonFinding[];
  summary: { critical: number; warning: number; info: number };
}

interface ContextPatternDef {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  role: 'must' | 'clue';
  distance?: number;
  timeWindow?: number;
}

interface ContextDefinitionDef {
  id: string;
  name: string;
  color: string;
  patterns: ContextPatternDef[];
  proximityMode: 'lines' | 'time' | 'both';
  defaultDistance: number;
  defaultTimeWindow?: number;
  enabled: boolean;
  isGlobal: boolean;
  createdAt: number;
}

interface ContextMatchGroupDef {
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
  matchedPatternCount: number;
  totalCluePatterns: number;
  missingPatternIds: string[];
  complete: boolean;
}

// ── Trends notebook ──────────────────────────────────────────────────────────
type TrendFieldType = 'numeric' | 'boolean' | 'string' | 'array' | 'timestamp';

interface TrendFieldSpec {
  name: string;
  type: TrendFieldType;
  occurrences: number;
  distinct: number;
  examples: string[];
}

interface TrendPoint {
  lineNumber: number;
  viewerLine: number;
  epochMs: number | null;
  raw: string;
  num: number | null;
}

interface TrendTimeBucket {
  startMs: number;
  endMs: number;
  count: number;
  sum?: number;
  min?: number;
  max?: number;
  avg?: number;
  values?: Record<string, number>;
}

interface TrendSeriesResult {
  field: string;
  type: TrendFieldType;
  totalPoints: number;
  withTimestamp: number;
  truncated: boolean;
  timeRange: { startMs: number; endMs: number } | null;
  buckets: TrendTimeBucket[];
  // Meaning of bucket startMs/endMs: 'time' = epoch-ms, 'line' = viewer line number
  // (the fallback so a series always charts even without timestamps).
  xKind: 'time' | 'line' | 'relative' | 'number';
  points: TrendPoint[];
}

type AxisSpec =
  | { kind: 'line' }
  | { kind: 'time' }
  | { kind: 'relative' }
  | { kind: 'field'; field: string; asTime?: boolean };

interface AxisCandidate {
  id: string;            // 'line' | 'time' | 'relative' | 'field:<name>'
  label: string;
  spec: AxisSpec;
  detail: string;
  coverage: number;
  score: number;
}

interface SignalSeriesItem {
  field: string;
  type: TrendFieldType;
  values: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
  viewerLines: number[];
  globalMin: number;
  globalMax: number;
  present: number;
}

interface SignalSeriesResult {
  x: { field: string; values: number[]; isIndex: boolean; timeMs?: (number | null)[] };
  series: SignalSeriesItem[];
  totalRecords: number;
  buckets: number;
  truncated: boolean;
  sampled: boolean;
}

interface TrendTransition {
  lineNumber: number;
  viewerLine: number;
  epochMs: number | null;
  fromValue: string;
  toValue: string;
}

interface TrendTransitionsResult {
  field: string;
  type: TrendFieldType;
  transitions: TrendTransition[];
  totalTransitions: number;
  truncated: boolean;
}

interface TrendCorrelateResult {
  field: string;
  fieldType: TrendFieldType;
  event: string;
  matchedLines: number;
  unmatchedLines: number;
  truncated: boolean;
  numericStats?: {
    matched: { n: number; min: number; max: number; mean: number } | null;
    unmatched: { n: number; min: number; max: number; mean: number } | null;
  };
  categorical?: {
    matched: Record<string, number>;
    unmatched: Record<string, number>;
  };
}

// Compact "evidence pack" briefing — shape returned by getEvidencePack()
// (mirrors the AI's logan_evidence_pack). All viewerLine refs are 1-based.
interface EvidencePack {
  file?: { path?: string; totalLines?: number; timeRange?: { start?: string; end?: string } | null };
  severity?: 'healthy' | 'warning' | 'critical';
  summary?: string;
  levels?: Record<string, number> & { errorPercent?: number; warningPercent?: number };
  crashes?: Array<{ keyword?: string; count?: number; viewerLine?: number; sample?: string }>;
  topComponents?: Array<{ name?: string; errorCount?: number; warningCount?: number; sampleLine?: number }>;
  timeGaps?: Array<{ viewerLine?: number; gapSeconds?: number; from?: string; to?: string; preview?: string }>;
  fields?: Array<{ name?: string; type?: string; occurrences?: number; distinct?: number; examples?: any[] }>;
  filterSuggestions?: Array<{ id?: string; title?: string; description?: string }>;
  baselineDelta?: any;
  caps?: {
    fields?: { shown?: number; total?: number; truncated?: boolean };
    timeGaps?: { shown?: number; total?: number; truncated?: boolean };
    note?: string;
  };
}

// File-handler registry wire types (mirror src/main/fileHandlers.ts).
interface FileHandlerQuery {
  path: string;
  isDirectory?: boolean;
  fileType?: 'text' | 'image' | 'video' | 'binary';
}
interface FileHandlerInfo {
  id: string;
  label: string;
  icon?: string;
  kind: string;
  isDefault: boolean;
}
interface FileHandlerResult {
  action: 'open-log' | 'open-panel' | 'open-folder' | 'toast';
  path?: string;
  panel?: 'video' | 'image' | 'markdown';
  forceAdapterId?: string;
  message?: string;
  level?: 'info' | 'error';
}

interface Api {
  // File operations
  openFileDialog: () => Promise<string | null>;
  openFilesDialog: () => Promise<string[]>;
  openFile: (path: string) => Promise<{ success: boolean; info?: FileInfo; error?: string; splitFiles?: string[]; splitIndex?: number; bookmarks?: Bookmark[]; highlights?: HighlightConfig[]; hasLongLines?: boolean; maxLineLength?: number }>;
  // Auto-composite large files (default OFF): sync the Features toggle to main, and fetch
  // the live segment-plan readout (RAM budget vs whole-file index) for the open file.
  setAutoSegment: (enabled: boolean) => Promise<{ success: boolean }>;
  segmentPlanPreview: () => Promise<{
    success: boolean;
    enabled?: boolean;
    active?: boolean;
    passthrough?: boolean;
    fileSize?: number;
    residentSegments?: number;
    mem?: { freeBytes: number; heapLimitBytes: number; heapUsedBytes: number };
    plan?: {
      shouldSegment: boolean;
      budgetBytes: number;
      estWholeIndexBytes: number;
      segmentBytes: number;
      totalSegments: number;
      maxResidentSegments: number;
      estResidentIndexBytes: number;
    } | null;
    error?: string;
  }>;
  getLines: (startLine: number, count: number) => Promise<{ success: boolean; lines?: LogLine[]; error?: string }>;
  getSeverityInfo: (buckets: number) => Promise<{ success: boolean; counts?: { fatal: number; error: number; warning: number }; ticks?: number[]; totalLines?: number; capped?: boolean; error?: string }>;
  nextSeverityLine: (fromLine: number, dir: 1 | -1, levels: string[]) => Promise<{ success: boolean; line?: number | null; error?: string }>;
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
  search: (options: SearchOptions) => Promise<{ success: boolean; matches?: SearchResult[]; hiddenMatches?: Array<{ lineNumber: number; column: number; length: number; lineText: string }>; error?: string; engine?: 'ripgrep' | 'stream'; searchReason?: string; searchMs?: number }>;
  cancelSearch: () => Promise<{ success: boolean }>;

  // Bookmarks
  addBookmark: (bookmark: Bookmark) => Promise<{ success: boolean }>;
  removeBookmark: (id: string) => Promise<{ success: boolean }>;
  updateBookmark: (bookmark: Bookmark) => Promise<{ success: boolean }>;
  listBookmarks: () => Promise<{ success: boolean; bookmarks?: Bookmark[] }>;
  clearBookmarks: () => Promise<{ success: boolean }>;
  exportBookmarks: () => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // Bookmark Sets
  bookmarkSetList: () => Promise<{ success: boolean; sets?: Array<{ id: string; name: string; createdAt: number; updatedAt: number; bookmarks: Bookmark[] }> }>;
  bookmarkSetSave: (set: { id: string; name: string; createdAt: number; updatedAt: number; bookmarks: Bookmark[] }) => Promise<{ success: boolean }>;
  bookmarkSetUpdate: (set: { id: string; name: string; createdAt: number; updatedAt: number; bookmarks: Bookmark[] }) => Promise<{ success: boolean }>;
  bookmarkSetDelete: (setId: string) => Promise<{ success: boolean }>;
  bookmarkSetLoad: (setId: string) => Promise<{ success: boolean; bookmarks?: Bookmark[] }>;

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
  extractFilteredToFile: (opts?: { includeLineNumbers?: boolean; columnConfig?: { delimiter: string; columns: Array<{ index: number; visible: boolean }> } }) => Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }>;

  // Save snippets (selected lines to file)
  findNotesFiles: () => Promise<{ success: boolean; files?: Array<{ name: string; path: string; created: string }>; logFilePath?: string; error?: string }>;
  saveToNotes: (startLine: number, endLine: number, note?: string, targetFilePath?: string, columnConfig?: { delimiter: string; columns: Array<{ index: number; visible: boolean }> }) => Promise<{ success: boolean; filePath?: string; lineCount?: number; isNewFile?: boolean; error?: string }>;

  // Split file
  splitFile: (options: { mode: 'lines' | 'parts'; value: number }) => Promise<{ success: boolean; outputDir?: string; files?: string[]; partCount?: number; error?: string }>;
  onSplitProgress: (callback: (data: { percent: number; currentPart: number; totalParts: number }) => void) => () => void;

  // Analysis
  listAnalyzers: () => Promise<{ success: boolean; analyzers?: Array<{ name: string; description: string }> }>;
  analyzeFile: (analyzerName?: string, options?: AnalyzerOptions) => Promise<{ success: boolean; result?: AnalysisResult; error?: string }>;
  analyzeFilePath: (filePath: string) => Promise<{ success: boolean; result?: AnalysisResult; error?: string }>;
  cancelAnalysis: () => Promise<{ success: boolean }>;
  applyFilter: (config: any) => Promise<{ success: boolean; stats?: { filteredLines: number }; filteredLineNumbers?: number[]; error?: string }>;
  cancelFilter: () => Promise<{ success: boolean }>;
  onFilterProgress: (callback: (data: { percent: number }) => void) => () => void;
  clearFilter: () => Promise<{ success: boolean }>;
  getFilteredLineNumbers: () => Promise<number[] | null>;

  // Time Gap Detection
  detectTimeGaps: (options: { thresholdSeconds: number; startLine?: number; endLine?: number; startPattern?: string; endPattern?: string }) => Promise<{ success: boolean; gaps?: Array<{ lineNumber: number; prevLineNumber: number; gapSeconds: number; prevTimestamp: string; currTimestamp: string; linePreview: string }>; totalLines?: number; error?: string }>;
  cancelTimeGaps: () => Promise<{ success: boolean }>;
  onTimeGapProgress: (callback: (data: { percent: number }) => void) => () => void;
  detectCadence: (options: { pattern: string; isRegex?: boolean; matchCase?: boolean; toleranceFactor?: number; startLine?: number; endLine?: number }) => Promise<any>;
  cancelCadence: () => Promise<{ success: boolean }>;
  suggestCadenceEvents: () => Promise<any>;
  onCadenceProgress: (callback: (data: { percent: number }) => void) => () => void;

  // Column Analysis
  analyzeColumns: () => Promise<{ success: boolean; analysis?: ColumnAnalysis; error?: string }>;

  // Events
  onIndexingProgress: (callback: (percent: number) => void) => () => void;
  onSearchProgress: (callback: (data: { percent: number; matchCount: number; matches?: SearchResult[]; searchId?: number }) => void) => () => void;
  onAnalyzeProgress: (callback: (data: { phase: string; percent: number; message?: string }) => void) => () => void;
  onCompareAnalyzeProgress: (callback: (data: { phase: string; percent: number; message?: string }) => void) => () => void;

  // Utilities
  openExternalUrl: (url: string) => Promise<void>;

  // Terminal (session-based)
  terminalCreateLocal: (sessionId: string, options: { cwd?: string; cols: number; rows: number }) => Promise<{ success: boolean; pid?: number; label?: string; error?: string }>;
  terminalCreateSsh: (sessionId: string, options: { liveConnectionId?: string; sshConfig?: any; cols: number; rows: number }) => Promise<{ success: boolean; label?: string; error?: string }>;
  terminalWrite: (sessionId: string, data: string) => Promise<{ success: boolean; error?: string }>;
  terminalResize: (sessionId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
  terminalKill: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
  terminalCd: (directory: string) => Promise<{ success: boolean; error?: string }>;
  onTerminalData: (callback: (sessionId: string, data: string) => void) => () => void;
  onTerminalExit: (callback: (sessionId: string, exitCode: number) => void) => () => void;

  // Saved connections
  connectionList: () => Promise<{ success: boolean; connections?: any[]; error?: string }>;
  connectionSave: (connection: any) => Promise<{ success: boolean; error?: string }>;
  connectionDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  connectionUpdate: (connection: any) => Promise<{ success: boolean; error?: string }>;

  // Datadog
  datadogLoadConfig: () => Promise<{ success: boolean; config?: { site: string; hasApiKey: boolean; hasAppKey: boolean } | null }>;
  datadogSaveConfig: (config: { site: string; apiKey: string; appKey: string } | null) => Promise<{ success: boolean; error?: string }>;
  datadogFetchLogs: (params: { query: string; from: string; to: string; maxLogs: number }) => Promise<{ success: boolean; filePath?: string; logCount?: number; error?: string }>;
  datadogCancelFetch: () => Promise<{ success: boolean }>;
  onDatadogFetchProgress: (callback: (data: { message: string; count: number }) => void) => () => void;

  // Split/Diff view
  getLinesForFile: (filePath: string, startLine: number, count: number) => Promise<{ success: boolean; lines?: LogLine[]; error?: string }>;
  computeDiff: (leftFilePath: string, rightFilePath: string) => Promise<{ success: boolean; result?: DiffResult; error?: string }>;
  cancelDiff: () => Promise<{ success: boolean }>;
  onDiffProgress: (callback: (data: { percent: number; phase: string }) => void) => () => void;

  // Notes drawer
  loadNotes: () => Promise<{ success: boolean; content?: string }>;
  saveNotes: (content: string) => Promise<{ success: boolean; error?: string }>;
  saveNotesAs: (content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  exportNotes: (content: string, format: 'md' | 'pdf') => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // Search configs
  searchConfigSave: (config: SearchConfigDef) => Promise<{ success: boolean }>;
  searchConfigLoad: () => Promise<{ success: boolean; configs?: SearchConfigDef[] }>;
  searchConfigDelete: (id: string) => Promise<{ success: boolean }>;
  searchConfigBatch: (configs: Array<{ id: string; pattern: string; isRegex: boolean; matchCase: boolean; wholeWord: boolean }>) => Promise<{ success: boolean; results?: Record<string, SearchResult[]>; error?: string }>;
  onSearchConfigBatchProgress: (callback: (data: { percent: number; configId: string; matchCount?: number }) => void) => () => void;
  onSearchConfigBatchChunk: (callback: (data: { configId: string; lines: number[] }) => void) => () => void;
  searchConfigExport: (configId: string, lines: string[]) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  searchConfigExportAll: (content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  searchConfigExportImage: (base64Png: string, label: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  patternPropList: () => Promise<{ success: boolean; properties?: PatternPropertyDef[]; error?: string }>;
  patternPropSave: (prop: PatternPropertyDef) => Promise<{ success: boolean; properties?: PatternPropertyDef[]; error?: string }>;
  patternPropDelete: (id: string) => Promise<{ success: boolean; properties?: PatternPropertyDef[]; error?: string }>;
  patternLibList: () => Promise<{ success: boolean; patterns?: SavedPatternDef[]; error?: string }>;
  patternLibSave: (pattern: SavedPatternDef) => Promise<{ success: boolean; patterns?: SavedPatternDef[]; error?: string }>;
  patternLibDelete: (id: string) => Promise<{ success: boolean; patterns?: SavedPatternDef[]; error?: string }>;
  searchConfigSessionList: () => Promise<{ success: boolean; sessions?: SearchConfigSessionDef[] }>;
  searchConfigSessionSave: (session: SearchConfigSessionDef) => Promise<{ success: boolean }>;
  searchConfigSessionDelete: (sessionId: string, isGlobal: boolean) => Promise<{ success: boolean }>;

  // Saved single sessions (composite file-sets)
  singleSessionList: () => Promise<{ success: boolean; sessions?: Array<{ id: string; name: string; files: string[]; isGlobal: boolean; createdAt: number; description?: string }> }>;
  singleSessionDelete: (sessionId: string, isGlobal: boolean) => Promise<{ success: boolean; error?: string }>;
  singleSessionRename: (sessionId: string, isGlobal: boolean, name: string) => Promise<{ success: boolean; error?: string }>;

  // Local file status & activity history
  loadActivityHistory: () => Promise<{ success: boolean; history?: ActivityEntry[]; error?: string }>;
  clearActivityHistory: () => Promise<{ success: boolean; error?: string }>;
  getLocalFileStatus: () => Promise<{ exists: boolean; writable: boolean; localPath: string | null }>;

  // File context menu actions
  showItemInFolder: (filePath: string) => Promise<void>;
  readFileContent: (filePath: string) => Promise<{ success: boolean; content?: string; sizeMB?: number; error?: string }>;

  // Video player
  getLineTimestamp: (lineNumber: number) => Promise<{ epochMs: number | null; timestampStr: string | null }>;
  transcodeVideo: (srcPath: string) => Promise<{ success: boolean; outputPath?: string; cached?: boolean; error?: string; cancelled?: boolean }>;
  cancelVideoTranscode: () => Promise<{ success: boolean }>;
  onVideoTranscodeProgress: (callback: (data: { percent: number }) => void) => () => void;

  // Time Align (batch)
  getLineTimestamps: (lineNumbers: number[]) => Promise<Array<{ lineNumber: number; epochMs: number }>>;

  // File-handler registry (plugin actions on a clicked file/folder)
  resolveFileHandlers: (query: FileHandlerQuery) => Promise<FileHandlerInfo[]>;
  runFileHandler: (id: string, query: FileHandlerQuery) => Promise<FileHandlerResult>;

  // MCP navigation
  onNavigateToLine: (callback: (lineNumber: number) => void) => () => void;

  // CLI file open
  onOpenFileFromCli: (callback: (filePath: string) => void) => () => void;
  onOpenFolderFromCli: (callback: (folderPath: string) => void) => () => void;
  onFileChanged: (callback: (filePath: string) => void) => () => void;
  onStaleMarksWarning: (callback: (info: { filePath: string; storedBy: { adapterId: string; decoderVersion: number }; currentBy: { adapterId: string; decoderVersion: number } }) => void) => () => void;
  reloadFile: (filePath: string) => Promise<{ success: boolean }>;

  // Agent chat
  sendAgentMessage: (text: string) => Promise<{ success: boolean; message?: { id: string; from: string; text: string; timestamp: number } }>;
  getAgentMessages: () => Promise<{ success: boolean; messages?: Array<{ id: string; from: string; text: string; timestamp: number }> }>;
  onAgentMessage: (callback: (msg: { id: string; from: string; text: string; timestamp: number }) => void) => () => void;
  getAgentStatus: () => Promise<{ connected: boolean; count: number }>;
  onAgentConnectionChanged: (callback: (data: { connected: boolean; count: number }) => void) => () => void;
  launchAgent: () => Promise<{ success: boolean; agentName?: string; error?: string }>;
  reconnectAgent: () => Promise<{ success: boolean; agentName?: string; resumed?: boolean; error?: string }>;
  stopAgent: () => Promise<{ success: boolean }>;
  interruptAgent: () => Promise<{ success: boolean; error?: string }>;
  listInvestigations: () => Promise<{ success: boolean; templates?: any[]; error?: string }>;
  saveInvestigation: (name: string, description?: string, requirements?: any, autoDetect?: boolean, aim?: string) => Promise<{ success: boolean; template?: any; error?: string }>;
  setInvestigationAim: (name: string, aim: string) => Promise<{ success: boolean; template?: any; error?: string }>;
  setInvestigationAnswer: (name: string, stepIndex: number) => Promise<{ success: boolean; template?: any; error?: string }>;
  runInvestigation: (name: string, params?: Record<string, any>, force?: boolean) => Promise<{ success: boolean; ran?: string; steps?: any[]; applied?: any[]; blocked?: boolean; requirements?: any; message?: string; error?: string }>;
  deleteInvestigation: (name: string) => Promise<{ success: boolean }>;
  checkInvestigation: (name: string) => Promise<{ success: boolean; name?: string; manifest?: any; requirements?: any; error?: string }>;
  forkInvestigation: (name: string, newName: string, params?: Record<string, any>, description?: string) => Promise<{ success: boolean; template?: any; error?: string }>;
  composeInvestigation: (input: { name: string; aim: string; steps: Array<{ investigation: string; params?: Record<string, any>; when?: { op: string; value?: number | string } }>; description?: string }) => Promise<{ success: boolean; template?: any; error?: string }>;
  showWorkflow: (investigation?: string) => Promise<{ success: boolean; graph?: any; source?: any; error?: string }>;
  setInvestigationRequirements: (name: string, requirements: any) => Promise<{ success: boolean; template?: any; error?: string }>;
  setInvestigationParams: (name: string, patches: any[]) => Promise<{ success: boolean; template?: any; applied?: number; errors?: string[]; error?: string }>;
  suggestInvestigationRequirements: () => Promise<{ success: boolean; requirements?: any; error?: string }>;
  listEntities: (kind?: string) => Promise<{ success: boolean; count?: number; entities?: any[]; error?: string }>;
  onInvestigationTemplatesChanged: (callback: () => void) => () => void;
  onInvestigationRunStep: (callback: (payload: { name?: string; slug?: string; phase?: string; index?: number; total?: number; ok?: boolean; summary?: string; label?: string }) => void) => () => void;
  onEntityApply: (callback: (payload: { kind: string; id: string; name: string }) => void) => () => void;
  getAgentRunning: () => Promise<{ running: boolean }>;
  detectAgentEnvironment: () => Promise<{
    hasClaudeCli: boolean;
    claudeVersion: string;
    hasConfig: boolean;
    existingConfig: any;
    hasBuiltin: boolean;
    builtinPath: string;
    hasOllama: boolean;
    ollamaModels: string[];
    hasLmStudio: boolean;
  }>;
  saveAgentConfig: (config: { type: 'claude-code' | 'builtin' | 'custom' | 'local-llm'; scriptPath?: string; model?: string; llmEndpoint?: string; llmModel?: string }) => Promise<{ success: boolean }>;
  browseAgentScript: () => Promise<string | null>;
  listRecentFiles: () => Promise<{ success: boolean; files?: Array<{ path: string; lastOpened: number }> }>;
  clearRecentFiles: () => Promise<{ success: boolean }>;
  listRecentFolders: () => Promise<{ success: boolean; folders?: Array<{ path: string; lastOpened: number }> }>;
  clearRecentFolders: () => Promise<{ success: boolean }>;
  filterPresetsList: () => Promise<{ success: boolean; presets?: any[] }>;
  filterPresetsSave: (preset: any) => Promise<{ success: boolean }>;
  filterPresetsDelete: (id: string) => Promise<{ success: boolean }>;

  // Agent annotations
  addAnnotation: (annotation: { id: string; lineNumber: number; text: string; agentName: string; timestamp: number; severity?: 'info' | 'warning' | 'error' }) => Promise<{ success: boolean }>;
  removeAnnotation: (id: string) => Promise<{ success: boolean }>;
  listAnnotations: () => Promise<{ success: boolean; annotations?: Array<{ id: string; lineNumber: number; text: string; agentName: string; timestamp: number; severity?: string }> }>;
  clearAnnotations: () => Promise<{ success: boolean }>;
  updateAnnotation: (id: string, patch: any) => Promise<{ success: boolean }>;
  clearHandoff: (handoffId: string) => Promise<{ success: boolean }>;
  onAnnotationsChanged: (callback: (annotations: any[]) => void) => () => void;

  getAgentMemory: () => Promise<{ content: string; agentName: string; updatedAt: number } | null>;
  saveAgentMemory: (content: string, agentName?: string) => Promise<{ success: boolean }>;
  clearAgentMemory: () => Promise<{ success: boolean }>;
  onAgentMemoryChanged: (callback: (memory: any) => void) => () => void;
  onAgentTrendCell: (callback: (spec: { type: string; label: string; result: any }) => void) => () => void;
  onAgentOpenSingleSession: (callback: (spec: { id: string; files: string[]; label?: string; info: any; boundaries: Array<{ filePath: string; startLine: number; lineCount: number }> }) => void) => () => void;

  // Device discovery
  serialListPorts: () => Promise<{ success: boolean; ports?: Array<{ path: string; manufacturer?: string; vendorId?: string; productId?: string }>; error?: string }>;
  logcatListDevices: () => Promise<{ success: boolean; devices?: Array<{ id: string; state: string; model?: string }>; error?: string }>;

  // SSH profiles & SFTP
  sshParseConfig: () => Promise<{ success: boolean; hosts?: SshHostEntry[]; error?: string }>;
  sshListProfiles: () => Promise<{ success: boolean; profiles?: SshProfile[]; error?: string }>;
  sshSaveProfile: (profile: SshProfile) => Promise<{ success: boolean; error?: string }>;
  sshDeleteProfile: (id: string) => Promise<{ success: boolean; error?: string }>;
  sshTestConnection: (config: { host: string; port: number; username: string; identityFile?: string; password?: string }) => Promise<{ success: boolean; error?: string }>;
  sshListRemoteDir: (remotePath: string, connectionId?: string) => Promise<{ success: boolean; files?: FolderFile[]; error?: string }>;
  sshDownloadFile: (remotePath: string) => Promise<{ success: boolean; localPath?: string; error?: string }>;

  // Unified live connection management
  liveConnect: (source: string, config: any, displayName: string, detail: string) => Promise<{ success: boolean; connectionId?: string; tempFilePath?: string; info?: FileInfo; error?: string }>;
  liveDisconnect: (connectionId: string) => Promise<{ success: boolean; error?: string }>;
  liveRestart: (connectionId: string) => Promise<{ success: boolean; tempFilePath?: string; info?: FileInfo; error?: string }>;
  liveRemove: (connectionId: string) => Promise<{ success: boolean; error?: string }>;
  liveSaveSession: (connectionId: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  onLiveLinesAdded: (callback: (data: { connectionId: string; totalLines: number; newLines: number }) => void) => () => void;
  onLiveError: (callback: (data: { connectionId: string; message: string }) => void) => () => void;
  onLiveDisconnected: (callback: (data: { connectionId: string }) => void) => () => void;

  // Baselines
  baselineList: () => Promise<{ success: boolean; baselines?: BaselineRecord[]; error?: string }>;
  baselineSave: (name: string, description: string, tags: string[]) => Promise<{ success: boolean; id?: string; error?: string }>;
  baselineGet: (id: string) => Promise<{ success: boolean; baseline?: any; error?: string }>;
  baselineUpdate: (id: string, fields: { name?: string; description?: string; tags?: string[] }) => Promise<{ success: boolean; error?: string }>;
  baselineDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  baselineCompare: (baselineId: string) => Promise<{ success: boolean; report?: ComparisonReport; error?: string }>;

  // Context search
  contextDefinitionsLoad: () => Promise<{ success: boolean; definitions?: ContextDefinitionDef[] }>;
  contextDefinitionsSave: (def: ContextDefinitionDef) => Promise<{ success: boolean }>;
  contextDefinitionDelete: (id: string) => Promise<{ success: boolean }>;
  contextSearch: (contextIds: string[]) => Promise<{ success: boolean; results?: Array<{ contextId: string; groups: ContextMatchGroupDef[] }>; error?: string }>;
  onContextSearchProgress: (callback: (data: { percent: number; contextId: string }) => void) => () => void;

  // Traceback
  traceback: (request: { targetLine: number; windowLines?: number; windowSeconds?: number; maxResults?: number }) => Promise<{
    success: boolean;
    targetLine?: number;
    targetText?: string;
    targetComponent?: string | null;
    windowStart?: number;
    lines?: Array<{
      lineNumber: number;
      text: string;
      score: number;
      category: 'error' | 'warning' | 'state-change' | 'related' | 'context';
      component?: string | null;
      level?: string;
    }>;
    summary?: { total: number; errors: number; warnings: number; stateChanges: number; related: number; context: number };
    error?: string;
  }>;

  // Trends notebook
  trendDiscoverFields: (options?: { startLine?: number; endLine?: number; sampleSize?: number }) => Promise<{ success: boolean; fields?: TrendFieldSpec[]; error?: string }>;
  trendDiscoverAxes: (options?: { startLine?: number; endLine?: number; sampleSize?: number }) => Promise<{ success: boolean; axes?: AxisCandidate[]; error?: string }>;
  trendSeries: (options: { field: string; startLine?: number; endLine?: number; bucketCount?: number; maxPoints?: number; pattern?: string; patternFlags?: string; xAxis?: AxisSpec }) => Promise<{ success: boolean; error?: string } & Partial<TrendSeriesResult>>;
  signalSeries: (options: { fields: string[]; xField?: string; startLine?: number; endLine?: number; maxPoints?: number }) => Promise<{ success: boolean; error?: string } & Partial<SignalSeriesResult>>;
  trendTransitions: (options: { field: string; startLine?: number; endLine?: number; maxTransitions?: number; pattern?: string; patternFlags?: string }) => Promise<{ success: boolean; error?: string } & Partial<TrendTransitionsResult>>;
  trendCorrelate: (options: { field: string; event: string; startLine?: number; endLine?: number; pattern?: string; patternFlags?: string }) => Promise<{ success: boolean; error?: string } & Partial<TrendCorrelateResult>>;

  // Guided triage
  triageRecipe: (options: { symptom: string; domain?: string; component?: string; sinceLine?: number; field?: string; expect?: string; baselineId?: string; maxFindings?: number; pin?: boolean }) => Promise<{ success: boolean; error?: string; [key: string]: any }>;

  // Semantic summary — fold the log into distinct message templates
  summarize: (opts?: { maxTemplates?: number; maxExamples?: number; detectSeverity?: boolean; detectTimestamp?: boolean; contains?: string }, scope?: ScopeDescriptor | null) => Promise<{ success: boolean; summary?: TemplateSummary; scope?: ScopeInfo; error?: string }>;
  summarizeCancel: () => Promise<{ success: boolean }>;

  // In-place viewer folding — detect repeating blocks, then apply/clear a fold view
  detectFoldRegions: (opts?: { maxPeriod?: number; minRepeats?: number; tolerance?: number; minHidden?: number }) => Promise<{ success: boolean; regions?: FoldRegion[]; totalLines?: number; foldableLines?: number; error?: string }>;
  setFoldFilter: (lines: number[]) => Promise<{ success: boolean; filteredLines?: number; filteredLineNumbers?: number[] | null; error?: string }>;

  // Component/text health — human twin of logan_investigate_component
  investigateComponent: (opts: { component: string; maxSamplesPerLevel?: number; includeErrorContext?: boolean; contextLines?: number }) => Promise<{ success: boolean; component?: string; found?: boolean; totalMentions?: number; levelBreakdown?: Record<string, number>; timeRange?: { firstSeen: string; lastSeen: string } | null; isTopFailer?: boolean; samplesByLevel?: Record<string, { lineNumber: number; text: string }[]>; errorSites?: any[]; error?: string }>;

  // Evidence pack (native "📋 Brief") — same briefing the AI's logan_evidence_pack builds
  getEvidencePack: (options?: { thresholdSeconds?: number; topFields?: number; topGaps?: number; topComponents?: number; fieldSampleSize?: number; analyzerName?: string; baselineId?: string }) => Promise<{ success: boolean; pack?: EvidencePack; error?: string }>;

  // Usage Monitor (per-feature usage counts, split human vs AI)
  bumpUsage: (verb: string) => Promise<void>;
  getUsage: () => Promise<{ success: boolean; entries?: Array<{ verb: string; operator: 'human' | 'ai'; count: number; firstUsed: string; lastUsed: string; daily: Record<string, number> }>; features?: Array<{ feature: string; display: string; human: number; ai: number; total: number; lastUsed: string }> }>;
  clearUsage: () => Promise<{ success: boolean }>;

  // Pattern log ("flight recorder" of pattern applications)
  getPatternLog: () => Promise<{ success: boolean; entries?: Array<{ id: string; ts: string; operator: 'human' | 'ai'; mode: string; source: string; scope: string; scanned: number; matched: number; hid: number; sampleHits: number[]; ms: number; capped: boolean; valid: boolean; error?: string }> }>;
  clearPatternLog: () => Promise<{ success: boolean }>;
  addPatternLog: (entry: { mode?: string; source?: string; scope?: string; scanned?: number; matched?: number; hid?: number; sampleHits?: number[]; ms?: number; capped?: boolean; valid?: boolean; error?: string; at?: number }) => Promise<{ success: boolean }>;

  // Controlled-pattern compiler ("Make pattern… from selection")
  compilePattern: (input: { mode: 'plain' | 'grok' | 'paint' | 'regex'; text?: string; sample?: string; spans?: Array<{ start: number; end: number; name: string }>; flags?: string; matchCase?: boolean; wholeWord?: boolean; invert?: boolean }) => Promise<{ ok: boolean; source: string; flags: string; error?: string; warnings: string[]; mode: string }>;

  // Named constants (captured from a selection via "Save as constant…")
  saveConstant: (name: string, value: string, description?: string) => Promise<{ success: boolean; error?: string }>;
  getConstants: () => Promise<{ success: boolean; entries?: Array<{ name: string; value: string; createdAt: string; updatedAt: string; description?: string }> }>;
  deleteConstant: (name: string) => Promise<{ success: boolean; removed?: boolean }>;

  // Active scope ("Use filter/search/selection as scope" + breadcrumb)
  setActiveScope: (desc: ScopeDescriptor | null) => Promise<{ success: boolean; scope?: ScopeDescriptor | null; info?: ScopeInfo | null; error?: string }>;
  getActiveScope: () => Promise<{ success: boolean; scope?: ScopeDescriptor | null; info?: ScopeInfo | null }>;

  // Window controls
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  getPlatform: () => Promise<string>;
  getPathForFile: (file: File) => string;
}

interface Window {
  api: Api;
}
