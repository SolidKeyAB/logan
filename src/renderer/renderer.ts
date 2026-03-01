// Types defined inline for browser context (no imports)
interface FileStats {
  path: string;
  size: number;
  totalLines: number;
  indexedAt: number;
}

interface LogLine {
  lineNumber: number;
  text: string;
  level?: string;
  timestamp?: string;
  filtered?: boolean;
  duplicateCount?: number;
}

interface ChunkResponse {
  lines: LogLine[];
  startLine: number;
  endLine: number;
}

interface SearchResult {
  lineNumber: number;
  column: number;
  length: number;
  text: string;
  displayIndex?: number;
}

interface HiddenMatch {
  lineNumber: number;
  column: number;
  length: number;
  lineText: string;
}

interface CrashEntry {
  text: string;
  lineNumber: number;
  level?: string;
  channel?: string;
  keyword: string;
}

interface FailingComponent {
  name: string;
  errorCount: number;
  warningCount: number;
  sampleLine: number;
}

interface FilterSuggestion {
  id: string;
  title: string;
  description: string;
  type: 'exclude' | 'include' | 'level';
  filter: {
    excludePatterns?: string[];
    includePatterns?: string[];
    levels?: string[];
    channel?: string;
  };
}

interface AnalysisInsights {
  crashes: CrashEntry[];
  topFailingComponents: FailingComponent[];
  filterSuggestions: FilterSuggestion[];
}

interface AnalysisResult {
  stats: { totalLines: number; analyzedLines: number };
  levelCounts: Record<string, number>;
  timeRange?: { start: string; end: string };
  analyzerName: string;
  analyzedAt: number;
  insights: AnalysisInsights;
}

interface IncludePattern {
  pattern: string;
  caseSensitive: boolean;
}

interface FilterConfig {
  minFrequency?: number;
  maxFrequency?: number;
  excludePatterns: string[];
  includePatterns: IncludePattern[];
  levels: string[];
  matchCase?: boolean;
  exactMatch?: boolean;
  timeRange?: { start: string; end: string };
  contextLines?: number;
  // Advanced filter support
  advancedFilter?: AdvancedFilterConfig;
}

// Advanced Filter Types
type FilterRuleType = 'contains' | 'not_contains' | 'level' | 'not_level' | 'regex' | 'not_regex';

interface FilterRule {
  id: string;
  type: FilterRuleType;
  value: string;
  caseSensitive?: boolean;
}

interface FilterGroup {
  id: string;
  operator: 'AND' | 'OR';
  rules: FilterRule[];
}

interface AdvancedFilterConfig {
  enabled: boolean;
  groups: FilterGroup[];
  contextLines?: number;
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
}

// Folder State - stores opened folders and their files
interface LocalFolderFile {
  name: string;
  path: string;
  size?: number;
}

interface FolderState {
  path: string;
  name: string;
  files: LocalFolderFile[];
  collapsed: boolean;
  isRemote?: boolean;
  sshHost?: string;
}

// Column visibility state
interface ColumnConfig {
  delimiter: string;
  delimiterName: string;
  columns: Array<{
    index: number;
    sample: string[];
    visible: boolean;
  }>;
}

// Tab State - stores per-file state for inactive tabs
interface TabState {
  id: string;
  filePath: string;
  fileStats: FileStats | null;
  totalLines: number;
  scrollTop: number;
  scrollLeft: number;
  selectedLine: number | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  searchResults: SearchResult[];
  currentSearchIndex: number;
  hiddenSearchMatches: HiddenMatch[];
  bookmarks: Bookmark[];
  highlights: HighlightConfig[];
  cachedLines: Map<number, LogLine>;
  splitFiles: string[];
  currentSplitIndex: number;
  // Loading state
  isLoading: boolean;
  loadingText: string;
  loadingPercent: number;
  // Minimap cache
  minimapData: Array<{ level: string | undefined }> | null;
  isLoaded: boolean; // true if file was fully loaded (skip re-indexing progress)
  // Column visibility
  columnConfig: ColumnConfig | null;
  // Analysis & filter state (preserved across tab switches)
  analysisResult: AnalysisResult | null;
  isFiltered: boolean;
  filteredLines: number | null;
  activeLevelFilter: string | null;
  appliedFilterSuggestion: { id: string; title: string } | null;
}

// Per-connection state for Live panel
interface LiveConnectionState {
  id: string;
  source: 'serial' | 'logcat' | 'ssh';
  displayName: string;
  detail: string;
  tempFilePath: string;
  tabId: string | null;
  linesReceived: number;
  connectedSince: number | null;
  connected: boolean;
  followMode: boolean;
  minimapLevels: Array<string | undefined>;
  lastLine: string;
  config: any;
}

// Application State - maintains current file state for backward compatibility
interface AppState {
  // Current file state (active tab)
  filePath: string | null;
  fileStats: FileStats | null;
  analysisResult: AnalysisResult | null;
  totalLines: number;
  filteredLines: number | null;
  isFiltered: boolean;
  activeLevelFilter: string | null;
  appliedFilterSuggestion: { id: string; title: string } | null;
  searchResults: SearchResult[];
  currentSearchIndex: number;
  hiddenSearchMatches: HiddenMatch[];
  bookmarks: Bookmark[];
  highlights: HighlightConfig[];
  visibleStartLine: number;
  visibleEndLine: number;
  selectedLine: number | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  savedRanges: Array<{ startLine: number; endLine: number }>;
  splitFiles: string[];
  currentSplitIndex: number;
  // Tab management
  tabs: TabState[];
  activeTabId: string | null;
  // Folder tree
  folders: FolderState[];
  // Column visibility
  columnConfig: ColumnConfig | null;
  // Notes file tracking
  currentNotesFile: string | null;
  // Folder search
  folderSearchResults: FolderSearchMatch[];
  isFolderSearching: boolean;
  // Terminal
  terminalVisible: boolean;
  terminalInitialized: boolean;
  activeTerminalTabId: string | null;
  // Bottom panel (tabbed)
  bottomPanelVisible: boolean;
  activeBottomTab: string | null;
  lastActiveBottomTab: string | null;
  // Search configs
  searchConfigs: SearchConfigDef[];
  searchConfigResults: Map<string, SearchResult[]>;
  // Video player
  videoSyncOffsetMs: number;
  videoFilePath: string | null;
  // Live panel (multi-connection)
  liveConnections: Map<string, LiveConnectionState>;
  activeConnectionId: string | null;
  liveSource: 'serial' | 'logcat' | 'ssh';
  sshProfiles: SshProfile[];
  // Baselines
  baselineList: BaselineRecord[];
  comparisonReport: ComparisonReport | null;
  // Context search
  contextDefinitions: ContextDefinitionDef[];
  contextResults: Map<string, ContextMatchGroupDef[]>;
  contextViewMode: 'tree' | 'lanes';
  contextGroupMode: 'separate' | 'combined';
  editingContextId: string | null;
}

const state: AppState = {
  filePath: null,
  fileStats: null,
  analysisResult: null,
  totalLines: 0,
  filteredLines: null,
  isFiltered: false,
  activeLevelFilter: null,
  appliedFilterSuggestion: null,
  searchResults: [],
  currentSearchIndex: -1,
  hiddenSearchMatches: [],
  bookmarks: [],
  highlights: [],
  visibleStartLine: 0,
  visibleEndLine: 100,
  selectedLine: null,
  selectionStart: null,
  selectionEnd: null,
  savedRanges: [],
  splitFiles: [],
  currentSplitIndex: -1,
  tabs: [],
  activeTabId: null,
  folders: [],
  columnConfig: null,
  currentNotesFile: null,
  folderSearchResults: [],
  isFolderSearching: false,
  terminalVisible: false,
  terminalInitialized: false,
  activeTerminalTabId: null,
  bottomPanelVisible: false,
  activeBottomTab: null,
  lastActiveBottomTab: null,
  searchConfigs: [],
  searchConfigResults: new Map(),
  videoSyncOffsetMs: 0,
  videoFilePath: null,
  liveConnections: new Map<string, LiveConnectionState>(),
  activeConnectionId: null,
  liveSource: 'serial' as 'serial' | 'logcat' | 'ssh',
  sshProfiles: [],
  baselineList: [],
  comparisonReport: null,
  contextDefinitions: [],
  contextResults: new Map(),
  contextViewMode: 'tree' as 'tree' | 'lanes',
  contextGroupMode: 'separate' as 'separate' | 'combined',
  editingContextId: null,
};

// Constants
const BASE_LINE_HEIGHT = 20;
const BASE_FONT_SIZE = 13;
const BUFFER_LINES = 50;
const MAX_SCROLL_HEIGHT = 10000000; // 10 million pixels - safe for all browsers
const CACHE_SIZE = 5000; // Max lines to keep in cache
const SCROLL_DEBOUNCE_MS = 16; // ~60fps
const PREFETCH_LINES = 100; // Lines to prefetch ahead of scroll direction

// Zoom settings
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
let zoomLevel = 100; // Percentage (100 = default)

// Panel resize state
let isResizingSidebar = false;
let sidebarStartX = 0;
let sidebarStartWidth = 0;

// User settings (persisted to localStorage)
interface UserSettings {
  scrollSpeed: number;        // 10-100, percentage
  defaultFontSize: number;    // 10-20, pixels
  defaultGapThreshold: number; // 1-60, seconds
  autoAnalyze: boolean;
  theme: 'dark' | 'paper';
  sidebarSections: Record<string, boolean>; // section-id → visible
}

const SIDEBAR_SECTIONS: { id: string; label: string; colorVar: string }[] = [
  { id: 'folders', label: 'Folders', colorVar: '--section-color-folders' },
  { id: 'bookmarks', label: 'Bookmarks', colorVar: '--section-color-bookmarks' },
  { id: 'highlights', label: 'Highlights', colorVar: '--section-color-highlights' },
];

const DEFAULT_SIDEBAR_SECTIONS: Record<string, boolean> = Object.fromEntries(
  SIDEBAR_SECTIONS.map(s => [s.id, true])
);

const DEFAULT_SETTINGS: UserSettings = {
  scrollSpeed: 30,
  defaultFontSize: 13,
  defaultGapThreshold: 5,
  autoAnalyze: false,
  theme: 'dark',
  sidebarSections: { ...DEFAULT_SIDEBAR_SECTIONS },
};

let userSettings: UserSettings = { ...DEFAULT_SETTINGS };

function loadSettings(): void {
  try {
    const saved = localStorage.getItem('logan-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      userSettings = { ...DEFAULT_SETTINGS, ...parsed };
      // Deep-merge sidebarSections so new sections get defaults
      userSettings.sidebarSections = { ...DEFAULT_SIDEBAR_SECTIONS, ...(parsed.sidebarSections || {}) };
    }
  } catch (e) {
    console.warn('Failed to load settings from localStorage:', e);
    userSettings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(): void {
  localStorage.setItem('logan-settings', JSON.stringify(userSettings));
}

function applySettings(): void {
  // Apply default font size to zoom level
  const fontSizeRatio = userSettings.defaultFontSize / BASE_FONT_SIZE;
  zoomLevel = Math.round(fontSizeRatio * 100);

  // Update gap threshold input if it exists
  const gapInput = document.getElementById('gap-threshold') as HTMLInputElement;
  if (gapInput) {
    gapInput.value = userSettings.defaultGapThreshold.toString();
  }

  // Apply theme
  applyTheme(userSettings.theme);

  // Apply sidebar section visibility
  applySidebarSectionVisibility();
}

function applySidebarSectionVisibility(): void {
  for (const section of SIDEBAR_SECTIONS) {
    // Hide/show activity bar buttons based on section visibility settings
    const btn = document.querySelector(`.activity-bar-btn[data-panel="${section.id}"]`) as HTMLElement;
    if (btn) {
      const visible = userSettings.sidebarSections[section.id] !== false;
      btn.style.display = visible ? '' : 'none';
    }
  }
}

function populateSidebarSectionToggles(): void {
  const container = document.getElementById('sidebar-section-toggles');
  if (!container) return;
  container.innerHTML = '';
  for (const section of SIDEBAR_SECTIONS) {
    const label = document.createElement('label');
    label.className = 'checkbox-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = userSettings.sidebarSections[section.id] !== false;
    checkbox.dataset.sectionId = section.id;

    const dot = document.createElement('span');
    dot.className = 'section-color-dot';
    const color = getComputedStyle(document.documentElement).getPropertyValue(section.colorVar).trim();
    dot.style.backgroundColor = color;

    const text = document.createTextNode(section.label);

    checkbox.addEventListener('change', () => {
      userSettings.sidebarSections[section.id] = checkbox.checked;
      saveSettings();
      applySidebarSectionVisibility();
    });

    label.appendChild(checkbox);
    label.appendChild(dot);
    label.appendChild(text);
    container.appendChild(label);
  }
}

function applyTheme(theme: string): void {
  document.documentElement.classList.remove('theme-paper');
  if (theme === 'paper') {
    document.documentElement.classList.add('theme-paper');
  }
}

// Word wrap setting
let wordWrapEnabled = false;

// Search direction and start line
let searchDirection: 'forward' | 'backward' = 'forward';

// JSON formatting setting
let jsonFormattingEnabled = false;
let jsonOriginalFile: string | null = null; // Track original file when viewing formatted JSON

// Check if text contains JSON
function containsJson(text: string): boolean {
  // Quick check for JSON-like content
  const trimmed = text.trim();
  const firstChar = trimmed[0];
  return firstChar === '{' || firstChar === '[';
}

// Format JSON with syntax highlighting
// If skipSyntaxHighlight is true, just pretty-print without colors (for use with user highlights)
function formatJsonContent(text: string, skipSyntaxHighlight: boolean = false): string {
  // Simple approach: try to parse the entire line as JSON
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    const prettyJson = JSON.stringify(parsed, null, 2);
    if (skipSyntaxHighlight) {
      // Return raw pretty-printed JSON - no escaping needed, will be escaped by caller
      return prettyJson;
    } else {
      // Apply syntax highlighting - this escapes HTML internally
      return syntaxHighlightJson(prettyJson);
    }
  } catch {
    // Not valid JSON, return escaped original
    if (skipSyntaxHighlight) {
      return text;
    } else {
      return escapeHtml(text);
    }
  }
}

// Escape HTML without sanitization (for pre-validated content like JSON)
function escapeHtmlSimple(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Simple JSON syntax highlighter using character scanning (no regex backtracking)
function syntaxHighlightJson(json: string): string {
  let result = '';
  let i = 0;

  while (i < json.length) {
    const char = json[i];

    // String (key or value)
    if (char === '"') {
      const start = i;
      i++; // skip opening quote
      while (i < json.length && json[i] !== '"') {
        if (json[i] === '\\' && i + 1 < json.length) {
          i += 2; // skip escaped char
        } else {
          i++;
        }
      }
      i++; // skip closing quote
      const str = json.slice(start, i);
      const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Check if it's a key (followed by colon)
      let j = i;
      while (j < json.length && (json[j] === ' ' || json[j] === '\t')) j++;
      if (json[j] === ':') {
        result += `<span class="json-key">${escaped}</span>`;
      } else {
        result += `<span class="json-string">${escaped}</span>`;
      }
      continue;
    }

    // Number
    if (char === '-' || (char >= '0' && char <= '9')) {
      const start = i;
      if (char === '-') i++;
      while (i < json.length && json[i] >= '0' && json[i] <= '9') i++;
      if (i < json.length && json[i] === '.') {
        i++;
        while (i < json.length && json[i] >= '0' && json[i] <= '9') i++;
      }
      if (i < json.length && (json[i] === 'e' || json[i] === 'E')) {
        i++;
        if (i < json.length && (json[i] === '+' || json[i] === '-')) i++;
        while (i < json.length && json[i] >= '0' && json[i] <= '9') i++;
      }
      result += `<span class="json-number">${json.slice(start, i)}</span>`;
      continue;
    }

    // true/false/null keywords
    if (json.slice(i, i + 4) === 'true') {
      result += '<span class="json-boolean">true</span>';
      i += 4;
      continue;
    }
    if (json.slice(i, i + 5) === 'false') {
      result += '<span class="json-boolean">false</span>';
      i += 5;
      continue;
    }
    if (json.slice(i, i + 4) === 'null') {
      result += '<span class="json-null">null</span>';
      i += 4;
      continue;
    }

    // Structural characters and whitespace - escape and pass through
    const escaped = char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : char;
    result += escaped;
    i++;
  }

  return result;
}

// Markdown preview
let isMarkdownFile = false;
let markdownPreviewMode = true; // Start in preview mode for md files
declare const marked: { parse: (text: string) => string };

// Get current line height based on zoom
function getLineHeight(): number {
  return Math.round(BASE_LINE_HEIGHT * (zoomLevel / 100));
}

// Get current font size based on zoom
function getFontSize(): number {
  return Math.round(BASE_FONT_SIZE * (zoomLevel / 100));
}

// Measure monospace character width at current zoom level
let _cachedCharWidth = 0;
let _charWidthZoom = 0;
function getCharWidth(): number {
  if (_charWidthZoom === zoomLevel && _cachedCharWidth > 0) return _cachedCharWidth;
  const span = document.createElement('span');
  span.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:var(--font-family);font-size:${getFontSize()}px;`;
  span.textContent = 'M';
  document.body.appendChild(span);
  _cachedCharWidth = span.getBoundingClientRect().width;
  document.body.removeChild(span);
  _charWidthZoom = zoomLevel;
  return _cachedCharWidth;
}

// Get line number gutter width (min-width 60px + padding-right 15px + margin-right 10px + border 1px)
const LINE_NUMBER_GUTTER_EXTRA = 86;

// Scroll state for optimizations
let lastScrollTop = 0;
let scrollDirection: 'up' | 'down' = 'down';
let scrollRAF: number | null = null;
let isScrolling = false;
let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
// Scroll slowness detection
let slowScrollFrames = 0;
let scrollSlownessWarningShown = false;
const SLOW_SCROLL_THRESHOLD_MS = 50; // Frame time above this = slow
const SLOW_SCROLL_FRAME_COUNT = 10; // Number of slow frames before warning

// DOM Elements
const elements = {
  logo: document.getElementById('logo') as HTMLImageElement,
  btnOpenFile: document.getElementById('btn-open-file') as HTMLButtonElement,
  btnOpenWelcome: document.getElementById('btn-open-welcome') as HTMLButtonElement,
  btnSearch: document.getElementById('btn-search') as HTMLButtonElement,
  btnPrevResult: document.getElementById('btn-prev-result') as HTMLButtonElement,
  btnNextResult: document.getElementById('btn-next-result') as HTMLButtonElement,
  btnFilter: document.getElementById('btn-filter') as HTMLButtonElement,
  btnAnalyze: document.getElementById('btn-analyze') as HTMLButtonElement,
  searchInput: document.getElementById('search-input') as HTMLInputElement,
  searchRegex: document.getElementById('search-regex') as HTMLInputElement,
  searchWildcard: document.getElementById('search-wildcard') as HTMLInputElement,
  searchCase: document.getElementById('search-case') as HTMLInputElement,
  searchWholeWord: document.getElementById('search-whole-word') as HTMLInputElement,
  searchResultCount: document.getElementById('search-result-count') as HTMLSpanElement,
  searchEngineBadge: document.getElementById('search-engine-badge') as HTMLSpanElement,
  hiddenMatchesBadge: document.getElementById('hidden-matches-badge') as HTMLSpanElement,
  hiddenMatchesPopup: document.getElementById('hidden-matches-popup') as HTMLDivElement,
  hiddenMatchesList: document.getElementById('hidden-matches-list') as HTMLDivElement,
  btnCloseHiddenMatches: document.getElementById('btn-close-hidden-matches') as HTMLButtonElement,
  peekPreview: document.getElementById('peek-preview') as HTMLDivElement,
  peekPreviewTitle: document.getElementById('peek-preview-title') as HTMLSpanElement,
  peekPreviewContent: document.getElementById('peek-preview-content') as HTMLDivElement,
  btnPeekClearFilter: document.getElementById('btn-peek-clear-filter') as HTMLButtonElement,
  btnPeekClose: document.getElementById('btn-peek-close') as HTMLButtonElement,
  searchEngineInfo: document.getElementById('search-engine-info') as HTMLParagraphElement,
  btnSearchOptions: document.getElementById('btn-search-options') as HTMLButtonElement,
  searchOptionsPopup: document.getElementById('search-options-popup') as HTMLDivElement,
  searchDirection: document.getElementById('search-direction') as HTMLButtonElement,
  searchStartLine: document.getElementById('search-start-line') as HTMLInputElement,
  activityBar: document.getElementById('activity-bar') as HTMLElement,
  editorContainer: document.getElementById('editor-container') as HTMLDivElement,
  welcomeMessage: document.getElementById('welcome-message') as HTMLDivElement,
  markdownPreview: document.getElementById('markdown-preview') as HTMLDivElement,
  foldersList: document.getElementById('folders-list') as HTMLDivElement,
  btnAddFolder: document.getElementById('btn-add-folder') as HTMLButtonElement,
  btnRefreshFolders: document.getElementById('btn-refresh-folders') as HTMLButtonElement,
  folderSearchInput: document.getElementById('folder-search-input') as HTMLInputElement,
  btnFolderSearch: document.getElementById('btn-folder-search') as HTMLButtonElement,
  btnFolderSearchCancel: document.getElementById('btn-folder-search-cancel') as HTMLButtonElement,
  folderSearchResults: document.getElementById('folder-search-results') as HTMLDivElement,
  fileStats: document.getElementById('file-stats') as HTMLDivElement,
  analysisResults: document.getElementById('analysis-results') as HTMLDivElement,
  baselineSection: document.getElementById('baseline-section') as HTMLDivElement,
  baselineControls: document.getElementById('baseline-controls') as HTMLDivElement,
  baselineComparisonResults: document.getElementById('baseline-comparison-results') as HTMLDivElement,
  bookmarksList: document.getElementById('bookmarks-list') as HTMLDivElement,
  btnExportBookmarks: document.getElementById('btn-export-bookmarks') as HTMLButtonElement,
  btnSaveBookmarkSet: document.getElementById('btn-save-bookmark-set') as HTMLButtonElement,
  btnLoadBookmarkSet: document.getElementById('btn-load-bookmark-set') as HTMLButtonElement,
  highlightsList: document.getElementById('highlights-list') as HTMLDivElement,
  btnAddHighlight: document.getElementById('btn-add-highlight') as HTMLButtonElement,
  highlightGroupsChips: document.getElementById('highlight-groups-chips') as HTMLDivElement,
  btnSaveHighlightGroup: document.getElementById('btn-save-highlight-group') as HTMLButtonElement,
  btnDeleteHighlightGroup: document.getElementById('btn-delete-highlight-group') as HTMLButtonElement,
  statusFile: document.getElementById('status-file') as HTMLSpanElement,
  statusLines: document.getElementById('status-lines') as HTMLSpanElement,
  statusFiltered: document.getElementById('status-filtered') as HTMLSpanElement,
  filteredCount: document.getElementById('filtered-count') as HTMLSpanElement,
  statusCursor: document.getElementById('status-cursor') as HTMLSpanElement,
  statusSize: document.getElementById('status-size') as HTMLSpanElement,
  progressContainer: document.getElementById('progress-container') as HTMLDivElement,
  progressBar: document.getElementById('progress-bar') as HTMLDivElement,
  progressText: document.getElementById('progress-text') as HTMLSpanElement,
  filterModal: document.getElementById('filter-modal') as HTMLDivElement,
  highlightModal: document.getElementById('highlight-modal') as HTMLDivElement,
  btnApplyFilter: document.getElementById('btn-apply-filter') as HTMLButtonElement,
  btnClearFilter: document.getElementById('btn-clear-filter') as HTMLButtonElement,
  btnSplit: document.getElementById('btn-split') as HTMLButtonElement,
  splitModal: document.getElementById('split-modal') as HTMLDivElement,
  splitValue: document.getElementById('split-value') as HTMLInputElement,
  splitHint: document.getElementById('split-hint') as HTMLSpanElement,
  splitPreview: document.getElementById('split-preview') as HTMLDivElement,
  btnDoSplit: document.getElementById('btn-do-split') as HTMLButtonElement,
  btnCancelSplit: document.getElementById('btn-cancel-split') as HTMLButtonElement,
  // Columns
  btnColumns: document.getElementById('btn-columns') as HTMLButtonElement,
  btnWordWrap: document.getElementById('btn-word-wrap') as HTMLButtonElement,
  btnJsonFormat: document.getElementById('btn-json-format') as HTMLButtonElement,
  columnsModal: document.getElementById('columns-modal') as HTMLDivElement,
  columnsLoading: document.getElementById('columns-loading') as HTMLDivElement,
  columnsContent: document.getElementById('columns-content') as HTMLDivElement,
  columnsDelimiter: document.getElementById('columns-delimiter') as HTMLSpanElement,
  columnsList: document.getElementById('columns-list') as HTMLDivElement,
  btnColumnsAll: document.getElementById('btn-columns-all') as HTMLButtonElement,
  btnColumnsNone: document.getElementById('btn-columns-none') as HTMLButtonElement,
  btnColumnsApply: document.getElementById('btn-columns-apply') as HTMLButtonElement,
  btnColumnsCancel: document.getElementById('btn-columns-cancel') as HTMLButtonElement,
  includePatternsContainer: document.getElementById('include-patterns-container') as HTMLDivElement,
  btnAddIncludePattern: document.getElementById('btn-add-include-pattern') as HTMLButtonElement,
  excludePatterns: document.getElementById('exclude-patterns') as HTMLTextAreaElement,
  filterMatchCase: document.getElementById('filter-match-case') as HTMLInputElement,
  filterExactMatch: document.getElementById('filter-exact-match') as HTMLInputElement,
  highlightPattern: document.getElementById('highlight-pattern') as HTMLInputElement,
  highlightRegex: document.getElementById('highlight-regex') as HTMLInputElement,
  highlightCase: document.getElementById('highlight-case') as HTMLInputElement,
  highlightWholeWord: document.getElementById('highlight-whole-word') as HTMLInputElement,
  highlightIncludeWhitespace: document.getElementById('highlight-include-whitespace') as HTMLInputElement,
  highlightAll: document.getElementById('highlight-all') as HTMLInputElement,
  highlightGlobal: document.getElementById('highlight-global') as HTMLInputElement,
  highlightBgColor: document.getElementById('highlight-bg-color') as HTMLInputElement,
  highlightTextColor: document.getElementById('highlight-text-color') as HTMLInputElement,
  btnSaveHighlight: document.getElementById('btn-save-highlight') as HTMLButtonElement,
  btnCancelHighlight: document.getElementById('btn-cancel-highlight') as HTMLButtonElement,
  // Tab bar
  tabBar: document.getElementById('tab-bar') as HTMLDivElement,
  tabsContainer: document.getElementById('tabs-container') as HTMLDivElement,
  btnNewTab: document.getElementById('btn-new-tab') as HTMLButtonElement,
  // Loading overlay
  loadingOverlay: document.getElementById('loading-overlay') as HTMLDivElement,
  loadingVideo: document.getElementById('loading-video') as HTMLVideoElement,
  loadingText: document.getElementById('loading-text') as HTMLSpanElement,
  loadingProgressFill: document.getElementById('loading-progress-fill') as HTMLDivElement,
  loadingPercent: document.getElementById('loading-percent') as HTMLSpanElement,
  // Zoom controls
  btnZoomIn: document.getElementById('btn-zoom-in') as HTMLButtonElement,
  btnZoomOut: document.getElementById('btn-zoom-out') as HTMLButtonElement,
  statusZoom: document.getElementById('status-zoom') as HTMLSpanElement,
  // Help
  btnHelp: document.getElementById('btn-help') as HTMLButtonElement,
  helpModal: document.getElementById('help-modal') as HTMLDivElement,
  btnCloseHelp: document.getElementById('btn-close-help') as HTMLButtonElement,
  // Settings
  settingsModal: document.getElementById('settings-modal') as HTMLDivElement,
  scrollSpeedSlider: document.getElementById('scroll-speed') as HTMLInputElement,
  scrollSpeedValue: document.getElementById('scroll-speed-value') as HTMLSpanElement,
  defaultFontSizeSlider: document.getElementById('default-font-size') as HTMLInputElement,
  defaultFontSizeValue: document.getElementById('default-font-size-value') as HTMLSpanElement,
  defaultGapThresholdSlider: document.getElementById('default-gap-threshold') as HTMLInputElement,
  defaultGapThresholdValue: document.getElementById('default-gap-threshold-value') as HTMLSpanElement,
  autoAnalyzeCheckbox: document.getElementById('auto-analyze') as HTMLInputElement,
  themeSelect: document.getElementById('theme-select') as HTMLSelectElement,
  btnResetSettings: document.getElementById('btn-reset-settings') as HTMLButtonElement,
  btnCloseSettings: document.getElementById('btn-close-settings') as HTMLButtonElement,
  // Long lines warning
  longLinesWarning: document.getElementById('long-lines-warning') as HTMLDivElement,
  btnFormatWarning: document.getElementById('btn-format-warning') as HTMLButtonElement,
  btnDismissWarning: document.getElementById('btn-dismiss-warning') as HTMLButtonElement,
  // Bookmark modal
  bookmarkModal: document.getElementById('bookmark-modal') as HTMLDivElement,
  bookmarkModalTitle: document.getElementById('bookmark-modal-title') as HTMLHeadingElement,
  bookmarkComment: document.getElementById('bookmark-comment') as HTMLInputElement,
  bookmarkColorPalette: document.getElementById('bookmark-color-palette') as HTMLDivElement,
  bookmarkLineInfo: document.getElementById('bookmark-line-info') as HTMLParagraphElement,
  btnSaveBookmark: document.getElementById('btn-save-bookmark') as HTMLButtonElement,
  btnCancelBookmark: document.getElementById('btn-cancel-bookmark') as HTMLButtonElement,
  // Notes modal
  notesModal: document.getElementById('notes-modal') as HTMLDivElement,
  notesFileOptions: document.getElementById('notes-file-options') as HTMLDivElement,
  notesDescription: document.getElementById('notes-description') as HTMLInputElement,
  notesLineInfo: document.getElementById('notes-line-info') as HTMLParagraphElement,
  btnSaveNotes: document.getElementById('btn-save-notes') as HTMLButtonElement,
  btnCancelNotes: document.getElementById('btn-cancel-notes') as HTMLButtonElement,
  // Terminal overlay
  terminalOverlay: document.getElementById('terminal-overlay') as HTMLDivElement,
  terminalPanel: document.getElementById('terminal-panel') as HTMLDivElement,
  terminalContainer: document.getElementById('terminal-container') as HTMLDivElement,
  terminalResizeHandle: document.getElementById('terminal-resize-handle') as HTMLDivElement,
  terminalTabBar: document.getElementById('terminal-tab-bar') as HTMLDivElement,
  terminalTabAdd: document.getElementById('terminal-tab-add') as HTMLDivElement,
  btnTerminalToggle: document.getElementById('btn-terminal-toggle') as HTMLButtonElement,
  // Notes content (in bottom panel)
  notesTextarea: document.getElementById('notes-textarea') as HTMLTextAreaElement,
  notesSaveStatus: document.getElementById('notes-save-status') as HTMLSpanElement,
  btnNotesToggle: document.getElementById('btn-notes-toggle') as HTMLButtonElement,
  // Agent Chat (in bottom panel)
  chatMessages: document.getElementById('chat-messages') as HTMLDivElement,
  chatInput: document.getElementById('chat-input') as HTMLInputElement,
  chatSendBtn: document.getElementById('chat-send-btn') as HTMLButtonElement,
  chatAgentDot: document.getElementById('chat-agent-dot') as HTMLSpanElement,
  chatAgentStatusText: document.getElementById('chat-agent-status-text') as HTMLSpanElement,
  chatLaunchAgent: document.getElementById('chat-launch-agent') as HTMLButtonElement,
  // Bottom panel
  bottomPanel: document.getElementById('bottom-panel') as HTMLDivElement,
  bottomPanelResizeHandle: document.getElementById('bottom-panel-resize-handle') as HTMLDivElement,
  btnBottomPanelClose: document.getElementById('btn-bottom-panel-close') as HTMLButtonElement,
  // Panel resize
  panelContainer: document.getElementById('panel-container') as HTMLDivElement,
  panelTitle: document.getElementById('panel-title') as HTMLSpanElement,
  panelResizeHandle: document.getElementById('panel-resize-handle') as HTMLDivElement,
  btnClosePanel: document.getElementById('btn-close-panel') as HTMLButtonElement,
  // Advanced Filter
  btnAdvancedFilter: document.getElementById('btn-advanced-filter') as HTMLButtonElement,
  advancedFilterModal: document.getElementById('advanced-filter-modal') as HTMLDivElement,
  filterGroupsContainer: document.getElementById('filter-groups-container') as HTMLDivElement,
  btnAddFilterGroup: document.getElementById('btn-add-filter-group') as HTMLButtonElement,
  basicContextLines: document.getElementById('basic-context-lines') as HTMLInputElement,
  advancedContextLinesEnabled: document.getElementById('advanced-context-lines-enabled') as HTMLInputElement,
  advancedContextLines: document.getElementById('advanced-context-lines') as HTMLInputElement,
  btnApplyAdvancedFilter: document.getElementById('btn-apply-advanced-filter') as HTMLButtonElement,
  btnClearAdvancedFilter: document.getElementById('btn-clear-advanced-filter') as HTMLButtonElement,
  btnCancelAdvancedFilter: document.getElementById('btn-cancel-advanced-filter') as HTMLButtonElement,
  // Time Gaps
  timeGapThreshold: document.getElementById('time-gap-threshold') as HTMLInputElement,
  btnDetectGaps: document.getElementById('btn-detect-gaps') as HTMLButtonElement,
  btnCancelGaps: document.getElementById('btn-cancel-gaps') as HTMLButtonElement,
  btnClearGaps: document.getElementById('btn-clear-gaps') as HTMLButtonElement,
  timeGapsList: document.getElementById('time-gaps-list') as HTMLDivElement,
  timeGapStartLine: document.getElementById('time-gap-start-line') as HTMLInputElement,
  timeGapEndLine: document.getElementById('time-gap-end-line') as HTMLInputElement,
  timeGapStartPattern: document.getElementById('time-gap-start-pattern') as HTMLInputElement,
  timeGapEndPattern: document.getElementById('time-gap-end-pattern') as HTMLInputElement,
  // Time gap navigation
  timeGapNav: document.getElementById('time-gap-nav') as HTMLDivElement,
  btnPrevGap: document.getElementById('btn-prev-gap') as HTMLButtonElement,
  btnNextGap: document.getElementById('btn-next-gap') as HTMLButtonElement,
  gapNavPosition: document.getElementById('gap-nav-position') as HTMLSpanElement,
  // History panel
  historyList: document.getElementById('history-list') as HTMLDivElement,
  historyFilter: document.getElementById('history-filter') as HTMLSelectElement,
  btnClearHistory: document.getElementById('btn-clear-history') as HTMLButtonElement,
  statusLocalStorage: document.getElementById('status-local-storage') as HTMLSpanElement,
  // Datadog
  btnDatadog: document.getElementById('btn-datadog') as HTMLButtonElement,
  datadogModal: document.getElementById('datadog-modal') as HTMLDivElement,
  ddQuery: document.getElementById('dd-query') as HTMLInputElement,
  ddTimePreset: document.getElementById('dd-time-preset') as HTMLSelectElement,
  ddCustomRange: document.getElementById('dd-custom-range') as HTMLDivElement,
  ddFrom: document.getElementById('dd-from') as HTMLInputElement,
  ddTo: document.getElementById('dd-to') as HTMLInputElement,
  ddMaxLogs: document.getElementById('dd-max-logs') as HTMLInputElement,
  ddFetchStatus: document.getElementById('dd-fetch-status') as HTMLDivElement,
  btnDdFetch: document.getElementById('btn-dd-fetch') as HTMLButtonElement,
  btnDdCancel: document.getElementById('btn-dd-cancel') as HTMLButtonElement,
  ddSiteSelect: document.getElementById('dd-site-select') as HTMLSelectElement,
  ddApiKey: document.getElementById('dd-api-key') as HTMLInputElement,
  ddAppKey: document.getElementById('dd-app-key') as HTMLInputElement,
  btnDdSaveConfig: document.getElementById('btn-dd-save-config') as HTMLButtonElement,
  btnDdClearConfig: document.getElementById('btn-dd-clear-config') as HTMLButtonElement,
  ddConfigStatus: document.getElementById('dd-config-status') as HTMLSpanElement,
  // Search configs content (in bottom panel)
  searchConfigsChips: document.getElementById('search-configs-chips') as HTMLDivElement,
  searchConfigsForm: document.getElementById('search-configs-form') as HTMLDivElement,
  searchConfigsResults: document.getElementById('search-configs-results') as HTMLDivElement,
  btnAddSearchConfig: document.getElementById('btn-add-search-config') as HTMLButtonElement,
  btnScExportAll: document.getElementById('btn-sc-export-all') as HTMLButtonElement,
  scSessionsChips: document.getElementById('sc-sessions-chips') as HTMLDivElement,
  btnSearchConfigs: document.getElementById('btn-search-configs') as HTMLButtonElement,
  scPatternInput: document.getElementById('sc-pattern-input') as HTMLInputElement,
  scRegex: document.getElementById('sc-regex') as HTMLInputElement,
  scMatchCase: document.getElementById('sc-match-case') as HTMLInputElement,
  scWholeWord: document.getElementById('sc-whole-word') as HTMLInputElement,
  scGlobal: document.getElementById('sc-global') as HTMLInputElement,
  scColorInput: document.getElementById('sc-color-input') as HTMLInputElement,
  btnScSave: document.getElementById('btn-sc-save') as HTMLButtonElement,
  btnScCancel: document.getElementById('btn-sc-cancel') as HTMLButtonElement,
  // Context search (in bottom panel)
  ctxAddBtn: document.getElementById('ctx-add-btn') as HTMLButtonElement,
  ctxRunBtn: document.getElementById('ctx-run-btn') as HTMLButtonElement,
  ctxResultsSummary: document.getElementById('ctx-results-summary') as HTMLSpanElement,
  ctxViewTree: document.getElementById('ctx-view-tree') as HTMLButtonElement,
  ctxViewLanes: document.getElementById('ctx-view-lanes') as HTMLButtonElement,
  ctxGroupSeparate: document.getElementById('ctx-group-separate') as HTMLButtonElement,
  ctxGroupCombined: document.getElementById('ctx-group-combined') as HTMLButtonElement,
  ctxChips: document.getElementById('ctx-chips') as HTMLDivElement,
  ctxForm: document.getElementById('ctx-form') as HTMLDivElement,
  ctxResults: document.getElementById('ctx-results') as HTMLDivElement,
  ctxLanes: document.getElementById('ctx-lanes') as HTMLDivElement,
  // Search results content (in bottom panel)
  searchResultsSummary: document.getElementById('search-results-summary') as HTMLSpanElement,
  searchResultsList: document.getElementById('search-results-list') as HTMLDivElement,
  // Video player content (in bottom panel)
  videoElement: document.getElementById('video-element') as HTMLVideoElement,
  videoContainer: document.getElementById('video-container') as HTMLDivElement,
  videoDropZone: document.getElementById('video-drop-zone') as HTMLDivElement,
  videoFileName: document.getElementById('video-file-name') as HTMLSpanElement,
  videoSyncInput: document.getElementById('video-sync-input') as HTMLInputElement,
  videoSyncStatus: document.getElementById('video-sync-status') as HTMLSpanElement,
  btnVideoPlayer: document.getElementById('btn-video-player') as HTMLButtonElement,
  btnVideoOpen: document.getElementById('btn-video-open') as HTMLButtonElement,
  btnVideoSyncFromLine: document.getElementById('btn-video-sync-from-line') as HTMLButtonElement,
  // Live panel content (in bottom panel)
  liveNameInput: document.getElementById('live-name-input') as HTMLInputElement,
  liveSourceSelect: document.getElementById('live-source-select') as HTMLSelectElement,
  livePortSelect: document.getElementById('live-port-select') as HTMLSelectElement,
  liveBaudSelect: document.getElementById('live-baud-select') as HTMLSelectElement,
  btnLiveRefresh: document.getElementById('btn-live-refresh') as HTMLButtonElement,
  btnLiveConnect: document.getElementById('btn-live-connect') as HTMLButtonElement,
  btnLive: document.getElementById('btn-live') as HTMLButtonElement,
  liveCardsRow: document.getElementById('live-cards-row') as HTMLDivElement,
  savedConnectionsRow: document.getElementById('saved-connections-row') as HTMLDivElement,
  // Logcat-specific controls
  liveSerialControls: document.getElementById('live-serial-controls') as HTMLSpanElement,
  liveLogcatControls: document.getElementById('live-logcat-controls') as HTMLSpanElement,
  liveDeviceSelect: document.getElementById('live-device-select') as HTMLSelectElement,
  btnLiveRefreshDevices: document.getElementById('btn-live-refresh-devices') as HTMLButtonElement,
  liveFilterInput: document.getElementById('live-filter-input') as HTMLInputElement,
  // SSH controls
  liveSshControls: document.getElementById('live-ssh-controls') as HTMLSpanElement,
  liveSshHostSelect: document.getElementById('live-ssh-host-select') as HTMLSelectElement,
  liveSshPathInput: document.getElementById('live-ssh-path-input') as HTMLInputElement,
  btnLiveSshRefresh: document.getElementById('btn-live-ssh-refresh') as HTMLButtonElement,
  btnLiveSshManage: document.getElementById('btn-live-ssh-manage') as HTMLButtonElement,
  btnOpenSshFolder: document.getElementById('btn-open-ssh-folder') as HTMLButtonElement,
};

// Virtual Log Viewer
let logViewerElement: HTMLDivElement | null = null;
let logContentElement: HTMLDivElement | null = null;
let logViewerWrapper: HTMLDivElement | null = null;
let minimapElement: HTMLDivElement | null = null;
let minimapContentElement: HTMLDivElement | null = null;
let minimapViewportElement: HTMLDivElement | null = null;
let minimapData: Array<{ level: string | undefined }> = [];
const MINIMAP_SAMPLE_RATE = 1000; // Sample every N lines for minimap

// Range selection (context menu)
let rangeSelectStartLine: number | null = null;

// Highlight groups
interface HighlightGroupData {
  id: string;
  name: string;
  highlights: HighlightConfig[];
  createdAt: number;
}
let highlightGroups: HighlightGroupData[] = [];
let activeHighlightGroupId: string | null = null;

// Search config sessions
let searchConfigSessions: SearchConfigSessionDef[] = [];
let activeSessionId: string | null = null;

// Terminal - tabbed multi-session
interface TerminalTab {
  id: string;
  type: 'local' | 'ssh';
  label: string;
  terminal: any;
  fitAddon: any;
  containerEl: HTMLDivElement;
  alive: boolean;
}
const terminalTabs = new Map<string, TerminalTab>();
let terminalDataUnsubscribe: (() => void) | null = null;
let terminalExitUnsubscribe: (() => void) | null = null;

// === Split/Diff View State ===
interface DiffHunkInfo {
  type: 'equal' | 'added' | 'removed' | 'modified';
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
}

interface DiffResultInfo {
  hunks: DiffHunkInfo[];
  stats: { additions: number; deletions: number; modifications: number };
  leftTotalLines: number;
  rightTotalLines: number;
}

interface DiffDisplayLineInfo {
  type: 'equal' | 'added' | 'removed' | 'modified' | 'spacer';
  realLineNumber: number; // -1 for spacers
  hunkIndex: number;
}

let viewMode: 'single' | 'split' | 'diff' = 'single';
let secondaryViewer: SecondaryViewerInstance | null = null;
let splitDiffState = {
  secondaryTabId: null as string | null,
  secondaryFilePath: null as string | null,
  diffResult: null as DiffResultInfo | null,
  leftDisplayLines: null as DiffDisplayLineInfo[] | null,
  rightDisplayLines: null as DiffDisplayLineInfo[] | null,
  currentHunkIndex: -1,
  syncScroll: true,
  isSyncScrolling: false,
};

// Split resize state
let isSplitResizing = false;
let splitStartX = 0;
let splitStartLeftWidth = 0;

// Advanced Filter State
let advancedFilterGroups: FilterGroup[] = [];

// Generate unique ID for filter groups/rules
function generateFilterId(): string {
  return `f_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// LRU Cache for lines - better memory management
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  // Get range of keys that exist in cache
  getExistingRange(start: number, end: number): number[] {
    const existing: number[] = [];
    for (let i = start; i <= end; i++) {
      if (this.cache.has(i as unknown as K)) {
        existing.push(i);
      }
    }
    return existing;
  }

  forEach(fn: (value: V, key: K) => void): void {
    this.cache.forEach(fn);
  }

  // Return a copy of internal map for serialization
  toMap(): Map<K, V> {
    return new Map(this.cache);
  }

  // Create from existing map
  static fromMap<K, V>(map: Map<K, V>, maxSize: number): LRUCache<K, V> {
    const cache = new LRUCache<K, V>(maxSize);
    map.forEach((value, key) => cache.set(key, value));
    return cache;
  }
}

let cachedLines = new LRUCache<number, LogLine>(CACHE_SIZE);

// DOM Element Pool for recycling
class ElementPool {
  private pool: HTMLDivElement[] = [];
  private inUse = new Set<HTMLDivElement>();

  acquire(): HTMLDivElement {
    let element = this.pool.pop();
    if (!element) {
      element = document.createElement('div');
      element.className = 'log-line';
    }
    this.inUse.add(element);
    return element;
  }

  release(element: HTMLDivElement): void {
    if (this.inUse.has(element)) {
      this.inUse.delete(element);
      element.innerHTML = '';
      element.className = 'log-line';
      element.removeAttribute('style');
      this.pool.push(element);
    }
  }

  releaseAll(): void {
    this.inUse.forEach(el => {
      el.innerHTML = '';
      el.className = 'log-line';
      el.removeAttribute('style');
      this.pool.push(el);
    });
    this.inUse.clear();
  }
}

const lineElementPool = new ElementPool();

// === Secondary Viewer for Split/Diff View ===
interface SecondaryViewerInstance {
  wrapper: HTMLDivElement;
  viewerElement: HTMLDivElement;
  contentElement: HTMLDivElement;
  headerElement: HTMLDivElement;
  filePath: string | null;
  totalLines: number;
  cache: LRUCache<number, LogLine>;
  pool: ElementPool;
  displayLines: DiffDisplayLineInfo[] | null;
  visibleStartLine: number;
  visibleEndLine: number;
  lastScrollTop: number;
  scrollDirection: 'up' | 'down';
  scrollRAF: number | null;
  resizeObserver: ResizeObserver | null;
}

function createSecondaryViewer(container: HTMLElement): SecondaryViewerInstance {
  const wrapper = document.createElement('div');
  wrapper.className = 'split-pane secondary-pane';

  const header = document.createElement('div');
  header.className = 'split-pane-header';
  header.innerHTML = '<span class="split-pane-filename"></span><button class="split-pane-close" title="Close split view">&times;</button>';
  wrapper.appendChild(header);

  const viewer = document.createElement('div');
  viewer.className = 'virtual-log-viewer secondary-viewer';
  const lineHeight = getLineHeight();
  const fontSize = getFontSize();
  viewer.style.setProperty('--line-height', `${lineHeight}px`);
  viewer.style.setProperty('--font-size', `${fontSize}px`);
  viewer.style.fontSize = `${fontSize}px`;

  const content = document.createElement('div');
  content.className = 'log-content';
  viewer.appendChild(content);
  wrapper.appendChild(viewer);
  container.appendChild(wrapper);

  const sv: SecondaryViewerInstance = {
    wrapper,
    viewerElement: viewer,
    contentElement: content,
    headerElement: header,
    filePath: null,
    totalLines: 0,
    cache: new LRUCache<number, LogLine>(CACHE_SIZE),
    pool: new ElementPool(),
    displayLines: null,
    visibleStartLine: 0,
    visibleEndLine: 0,
    lastScrollTop: 0,
    scrollDirection: 'down',
    scrollRAF: null,
    resizeObserver: null,
  };

  // Close button handler
  header.querySelector('.split-pane-close')?.addEventListener('click', () => {
    deactivateSplitView();
  });

  // Scroll handler
  viewer.addEventListener('scroll', () => secondaryHandleScroll(sv), { passive: true });

  // Wheel zoom
  viewer.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn(); else zoomOut();
      secondaryApplyZoom(sv);
    }
  }, { passive: false });

  // ResizeObserver
  const ro = new ResizeObserver(() => {
    if (sv.totalLines > 0) {
      const containerHeight = sv.viewerElement.clientHeight;
      const visibleLines = Math.ceil(containerHeight / getLineHeight());
      const startLine = secondaryScrollTopToLine(sv, sv.viewerElement.scrollTop);
      sv.visibleStartLine = Math.max(0, startLine - BUFFER_LINES);
      sv.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, secondaryGetTotalLines(sv) - 1);
      secondaryLoadVisibleLines(sv);
    }
  });
  ro.observe(viewer);
  sv.resizeObserver = ro;

  return sv;
}

function secondaryGetTotalLines(sv: SecondaryViewerInstance): number {
  if (sv.displayLines) return sv.displayLines.length;
  return sv.totalLines;
}

function secondaryGetVirtualHeight(sv: SecondaryViewerInstance): number {
  const totalLines = secondaryGetTotalLines(sv);
  const naturalHeight = totalLines * getLineHeight();
  return Math.min(naturalHeight, MAX_SCROLL_HEIGHT);
}

function secondaryIsUsingScaledScroll(sv: SecondaryViewerInstance): boolean {
  return secondaryGetTotalLines(sv) * getLineHeight() > MAX_SCROLL_HEIGHT;
}

function secondaryScrollTopToLine(sv: SecondaryViewerInstance, scrollTop: number): number {
  const totalLines = secondaryGetTotalLines(sv);
  if (!secondaryIsUsingScaledScroll(sv)) {
    return Math.floor(scrollTop / getLineHeight());
  }
  const virtualHeight = secondaryGetVirtualHeight(sv);
  const scrollRatio = scrollTop / (virtualHeight - (sv.viewerElement.clientHeight || 0));
  const maxLine = totalLines - Math.ceil((sv.viewerElement.clientHeight || 0) / getLineHeight());
  return Math.floor(scrollRatio * maxLine);
}

function secondaryLineToScrollTop(sv: SecondaryViewerInstance, lineNumber: number): number {
  const totalLines = secondaryGetTotalLines(sv);
  if (!secondaryIsUsingScaledScroll(sv)) {
    return lineNumber * getLineHeight();
  }
  const virtualHeight = secondaryGetVirtualHeight(sv);
  const maxLine = totalLines - Math.ceil((sv.viewerElement.clientHeight || 0) / getLineHeight());
  const scrollRatio = lineNumber / maxLine;
  return scrollRatio * (virtualHeight - (sv.viewerElement.clientHeight || 0));
}

function secondaryHandleScroll(sv: SecondaryViewerInstance): void {
  const scrollTop = sv.viewerElement.scrollTop;
  const containerHeight = sv.viewerElement.clientHeight;

  sv.scrollDirection = scrollTop > sv.lastScrollTop ? 'down' : 'up';
  sv.lastScrollTop = scrollTop;

  const startLine = secondaryScrollTopToLine(sv, scrollTop);
  const visibleLines = Math.ceil(containerHeight / getLineHeight());

  const prefetchUp = sv.scrollDirection === 'up' ? PREFETCH_LINES : BUFFER_LINES;
  const prefetchDown = sv.scrollDirection === 'down' ? PREFETCH_LINES : BUFFER_LINES;

  sv.visibleStartLine = Math.max(0, startLine - prefetchUp);
  sv.visibleEndLine = Math.min(secondaryGetTotalLines(sv) - 1, startLine + visibleLines + prefetchDown);

  secondaryRenderVisibleLines(sv);

  if (sv.scrollRAF !== null) cancelAnimationFrame(sv.scrollRAF);
  sv.scrollRAF = requestAnimationFrame(() => {
    sv.scrollRAF = null;
    secondaryLoadVisibleLines(sv);
  });

  // Sync scroll to primary (in diff mode)
  if (viewMode === 'diff' && splitDiffState.syncScroll && !splitDiffState.isSyncScrolling) {
    splitDiffState.isSyncScrolling = true;
    requestAnimationFrame(() => {
      if (logViewerElement) logViewerElement.scrollTop = scrollTop;
      splitDiffState.isSyncScrolling = false;
    });
  }
}

function secondaryRenderVisibleLines(sv: SecondaryViewerInstance): void {
  if (!sv.contentElement || !sv.viewerElement) return;

  const totalLines = secondaryGetTotalLines(sv);
  if (totalLines === 0) return;

  const virtualHeight = secondaryGetVirtualHeight(sv);
  const scrollLeft = sv.viewerElement.scrollLeft;

  sv.pool.releaseAll();
  const fragment = document.createDocumentFragment();

  const scrollTop = sv.viewerElement.scrollTop;
  const startLine = sv.visibleStartLine;
  const endLine = sv.visibleEndLine;

  const usingScaled = secondaryIsUsingScaledScroll(sv);
  const firstVisibleLine = secondaryScrollTopToLine(sv, scrollTop);

  let maxContentWidth = 0;

  for (let i = startLine; i <= endLine; i++) {
    const displayLine = sv.displayLines ? sv.displayLines[i] : null;

    if (displayLine && displayLine.type === 'spacer') {
      const spacerDiv = sv.pool.acquire();
      spacerDiv.className = 'log-line diff-spacer';
      spacerDiv.innerHTML = '<span class="line-number">&nbsp;</span><span class="line-content">&nbsp;</span>';
      let top: number;
      if (usingScaled) {
        top = scrollTop + (i - firstVisibleLine) * getLineHeight();
      } else {
        top = i * getLineHeight();
      }
      spacerDiv.style.cssText = `position:absolute;top:0;left:0;transform:translateY(${top}px);will-change:transform;white-space:pre;`;
      fragment.appendChild(spacerDiv);
      continue;
    }

    const cacheKey = displayLine ? displayLine.realLineNumber : i;
    const line = sv.cache.get(cacheKey);
    if (line) {
      const div = sv.pool.acquire();
      let className = 'log-line';
      if (line.level) className += ` level-${line.level}`;
      if (displayLine) {
        if (displayLine.type === 'added') className += ' diff-added';
        else if (displayLine.type === 'removed') className += ' diff-removed';
        else if (displayLine.type === 'modified') className += ' diff-modified';
      }
      div.className = className;
      div.dataset.lineNumber = String(line.lineNumber);

      const lineNumHtml = `<span class="line-number">${line.lineNumber + 1}</span>`;
      const contentHtml = `<span class="line-content">${escapeHtml(line.text)}</span>`;
      div.innerHTML = lineNumHtml + contentHtml;

      let top: number;
      if (usingScaled) {
        top = scrollTop + (i - firstVisibleLine) * getLineHeight();
      } else {
        top = i * getLineHeight();
      }
      div.style.cssText = `position:absolute;top:0;left:0;transform:translateY(${top}px);will-change:transform;white-space:pre;`;
      fragment.appendChild(div);

      const estimatedWidth = LINE_NUMBER_GUTTER_EXTRA + (line.text.length * getCharWidth());
      if (estimatedWidth > maxContentWidth) maxContentWidth = estimatedWidth;
    }
  }

  sv.contentElement.innerHTML = '';
  sv.contentElement.appendChild(fragment);
  sv.contentElement.style.height = `${virtualHeight}px`;
  sv.contentElement.style.minWidth = `${Math.max(maxContentWidth, sv.viewerElement.clientWidth)}px`;

  if (scrollLeft > 0) sv.viewerElement.scrollLeft = scrollLeft;
}

async function secondaryLoadVisibleLines(sv: SecondaryViewerInstance): Promise<void> {
  if (!sv.filePath) return;

  const totalLines = secondaryGetTotalLines(sv);
  const start = sv.visibleStartLine;
  const end = Math.min(sv.visibleEndLine, totalLines - 1);

  // Find cache gaps
  const gaps: Array<{ start: number; end: number }> = [];
  let gapStart: number | null = null;

  for (let i = start; i <= end; i++) {
    const displayLine = sv.displayLines ? sv.displayLines[i] : null;
    if (displayLine && displayLine.type === 'spacer') {
      if (gapStart !== null) { gaps.push({ start: gapStart, end: i - 1 }); gapStart = null; }
      continue;
    }
    const cacheKey = displayLine ? displayLine.realLineNumber : i;
    if (!sv.cache.has(cacheKey)) {
      if (gapStart === null) gapStart = i;
    } else {
      if (gapStart !== null) { gaps.push({ start: gapStart, end: i - 1 }); gapStart = null; }
    }
  }
  if (gapStart !== null) gaps.push({ start: gapStart, end });

  if (gaps.length === 0) {
    secondaryRenderVisibleLines(sv);
    return;
  }

  try {
    // When in diff mode with display lines, we need to fetch by real line numbers
    if (sv.displayLines) {
      // Collect real line numbers from gaps
      const realLineNumbers: number[] = [];
      for (const gap of gaps) {
        for (let i = gap.start; i <= gap.end; i++) {
          const dl = sv.displayLines[i];
          if (dl && dl.type !== 'spacer') realLineNumbers.push(dl.realLineNumber);
        }
      }
      if (realLineNumbers.length === 0) { secondaryRenderVisibleLines(sv); return; }

      // Batch into contiguous ranges for efficiency
      realLineNumbers.sort((a, b) => a - b);
      const ranges: Array<{ start: number; end: number }> = [];
      let rangeStart = realLineNumbers[0];
      let rangeEnd = rangeStart;
      for (let i = 1; i < realLineNumbers.length; i++) {
        if (realLineNumbers[i] === rangeEnd + 1) { rangeEnd = realLineNumbers[i]; }
        else { ranges.push({ start: rangeStart, end: rangeEnd }); rangeStart = realLineNumbers[i]; rangeEnd = rangeStart; }
      }
      ranges.push({ start: rangeStart, end: rangeEnd });

      const loadPromises = ranges.map(async (range) => {
        const count = range.end - range.start + 1;
        const result = await window.api.getLinesForFile(sv.filePath!, range.start, count);
        if (result.success && result.lines) {
          for (const line of result.lines) {
            sv.cache.set(line.lineNumber, line);
          }
        }
      });
      await Promise.all(loadPromises);
    } else {
      // Simple mode (split view without diff) - fetch by position
      const loadPromises = gaps.map(async (gap) => {
        const count = gap.end - gap.start + 1;
        const result = await window.api.getLinesForFile(sv.filePath!, gap.start, count);
        if (result.success && result.lines) {
          for (let idx = 0; idx < result.lines.length; idx++) {
            sv.cache.set(result.lines[idx].lineNumber, result.lines[idx]);
          }
        }
      });
      await Promise.all(loadPromises);
    }
    secondaryRenderVisibleLines(sv);
  } catch (error) {
    console.error('SecondaryViewer: Failed to load lines:', error);
  }
}

function secondarySetFile(sv: SecondaryViewerInstance, filePath: string, totalLines: number): void {
  sv.filePath = filePath;
  sv.totalLines = totalLines;
  sv.cache.clear();
  sv.displayLines = null;
  const fileNameSpan = sv.headerElement.querySelector('.split-pane-filename');
  if (fileNameSpan) fileNameSpan.textContent = getFileName(filePath);

  // Initial load
  const containerHeight = sv.viewerElement.clientHeight || 600;
  const visibleLines = Math.ceil(containerHeight / getLineHeight());
  sv.visibleStartLine = 0;
  sv.visibleEndLine = Math.min(visibleLines + BUFFER_LINES, totalLines - 1);
  secondaryLoadVisibleLines(sv);
}

function secondarySetDiffDisplayLines(sv: SecondaryViewerInstance, lines: DiffDisplayLineInfo[]): void {
  sv.displayLines = lines;
  sv.cache.clear();
  const total = lines.length;
  const containerHeight = sv.viewerElement.clientHeight || 600;
  const visibleLines = Math.ceil(containerHeight / getLineHeight());
  sv.visibleStartLine = 0;
  sv.visibleEndLine = Math.min(visibleLines + BUFFER_LINES, total - 1);
  secondaryLoadVisibleLines(sv);
}

function secondaryApplyZoom(sv: SecondaryViewerInstance): void {
  const lineHeight = getLineHeight();
  const fontSize = getFontSize();
  sv.viewerElement.style.setProperty('--line-height', `${lineHeight}px`);
  sv.viewerElement.style.setProperty('--font-size', `${fontSize}px`);
  sv.viewerElement.style.fontSize = `${fontSize}px`;

  if (secondaryGetTotalLines(sv) > 0) {
    const containerHeight = sv.viewerElement.clientHeight;
    const visibleLines = Math.ceil(containerHeight / getLineHeight());
    const startLine = secondaryScrollTopToLine(sv, sv.viewerElement.scrollTop);
    sv.visibleStartLine = Math.max(0, startLine - BUFFER_LINES);
    sv.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, secondaryGetTotalLines(sv) - 1);
    secondaryRenderVisibleLines(sv);
  }
}

function destroySecondaryViewer(sv: SecondaryViewerInstance): void {
  if (sv.resizeObserver) { sv.resizeObserver.disconnect(); sv.resizeObserver = null; }
  if (sv.scrollRAF !== null) cancelAnimationFrame(sv.scrollRAF);
  sv.cache.clear();
  sv.pool.releaseAll();
  sv.wrapper.remove();
}

// === Split/Diff Activation ===

function buildDiffDisplayLines(result: DiffResultInfo): { left: DiffDisplayLineInfo[]; right: DiffDisplayLineInfo[] } {
  const left: DiffDisplayLineInfo[] = [];
  const right: DiffDisplayLineInfo[] = [];

  for (let h = 0; h < result.hunks.length; h++) {
    const hunk = result.hunks[h];

    if (hunk.type === 'equal') {
      for (let i = 0; i < hunk.leftCount; i++) {
        left.push({ type: 'equal', realLineNumber: hunk.leftStart + i, hunkIndex: h });
        right.push({ type: 'equal', realLineNumber: hunk.rightStart + i, hunkIndex: h });
      }
    } else if (hunk.type === 'added') {
      for (let i = 0; i < hunk.rightCount; i++) {
        left.push({ type: 'spacer', realLineNumber: -1, hunkIndex: h });
        right.push({ type: 'added', realLineNumber: hunk.rightStart + i, hunkIndex: h });
      }
    } else if (hunk.type === 'removed') {
      for (let i = 0; i < hunk.leftCount; i++) {
        left.push({ type: 'removed', realLineNumber: hunk.leftStart + i, hunkIndex: h });
        right.push({ type: 'spacer', realLineNumber: -1, hunkIndex: h });
      }
    } else if (hunk.type === 'modified') {
      const maxCount = Math.max(hunk.leftCount, hunk.rightCount);
      for (let i = 0; i < maxCount; i++) {
        if (i < hunk.leftCount) {
          left.push({ type: 'modified', realLineNumber: hunk.leftStart + i, hunkIndex: h });
        } else {
          left.push({ type: 'spacer', realLineNumber: -1, hunkIndex: h });
        }
        if (i < hunk.rightCount) {
          right.push({ type: 'modified', realLineNumber: hunk.rightStart + i, hunkIndex: h });
        } else {
          right.push({ type: 'spacer', realLineNumber: -1, hunkIndex: h });
        }
      }
    }
  }

  return { left, right };
}

function activateSplitView(targetTabId: string): void {
  const targetTab = state.tabs.find(t => t.id === targetTabId);
  if (!targetTab || !targetTab.filePath) return;

  // Deactivate any existing split first
  if (viewMode !== 'single') deactivateSplitView();

  viewMode = 'split';
  splitDiffState.secondaryTabId = targetTabId;
  splitDiffState.secondaryFilePath = targetTab.filePath;

  // Add split layout classes
  elements.editorContainer.classList.add('split-view');

  // Wrap primary viewer in a pane
  if (logViewerWrapper) {
    logViewerWrapper.classList.add('split-pane', 'primary-pane');
    // Add primary header
    const existingHeader = logViewerWrapper.querySelector('.split-pane-header');
    if (!existingHeader) {
      const primaryHeader = document.createElement('div');
      primaryHeader.className = 'split-pane-header primary-header';
      primaryHeader.innerHTML = `<span class="split-pane-filename">${escapeHtml(getFileName(state.filePath || ''))}</span>`;
      logViewerWrapper.insertBefore(primaryHeader, logViewerWrapper.firstChild);
    }
  }

  // Add resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'split-resize-handle';
  elements.editorContainer.appendChild(resizeHandle);

  // Create secondary viewer
  secondaryViewer = createSecondaryViewer(elements.editorContainer);
  secondarySetFile(secondaryViewer, targetTab.filePath, targetTab.totalLines);

  // Resize handle drag
  resizeHandle.addEventListener('mousedown', (e) => {
    isSplitResizing = true;
    splitStartX = e.clientX;
    splitStartLeftWidth = logViewerWrapper?.offsetWidth || 0;
    resizeHandle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
}

async function activateDiffView(targetTabId: string): Promise<void> {
  const targetTab = state.tabs.find(t => t.id === targetTabId);
  if (!targetTab || !targetTab.filePath || !state.filePath) return;

  // Deactivate any existing split first
  if (viewMode !== 'single') deactivateSplitView();

  viewMode = 'diff';
  splitDiffState.secondaryTabId = targetTabId;
  splitDiffState.secondaryFilePath = targetTab.filePath;
  splitDiffState.syncScroll = true;

  // Show progress
  showProgress('Computing diff...');

  const progressUnsub = window.api.onDiffProgress((data) => {
    showProgress(`${data.phase} (${data.percent}%)`);
  });

  try {
    const result = await window.api.computeDiff(state.filePath, targetTab.filePath);

    progressUnsub();
    hideProgress();

    if (!result.success || !result.result) {
      alert(result.error || 'Diff computation failed');
      viewMode = 'single';
      splitDiffState.secondaryTabId = null;
      splitDiffState.secondaryFilePath = null;
      return;
    }

    splitDiffState.diffResult = result.result;

    // Build display line mappings
    const { left, right } = buildDiffDisplayLines(result.result);
    splitDiffState.leftDisplayLines = left;
    splitDiffState.rightDisplayLines = right;
    splitDiffState.currentHunkIndex = -1;

    // Add split layout classes
    elements.editorContainer.classList.add('split-view', 'diff-mode');

    // Wrap primary viewer in a pane
    if (logViewerWrapper) {
      logViewerWrapper.classList.add('split-pane', 'primary-pane');
      const existingHeader = logViewerWrapper.querySelector('.split-pane-header');
      if (!existingHeader) {
        const primaryHeader = document.createElement('div');
        primaryHeader.className = 'split-pane-header primary-header';
        primaryHeader.innerHTML = `<span class="split-pane-filename">${escapeHtml(getFileName(state.filePath || ''))}</span>`;
        logViewerWrapper.insertBefore(primaryHeader, logViewerWrapper.firstChild);
      }
    }

    // Add resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'split-resize-handle';
    elements.editorContainer.appendChild(resizeHandle);

    resizeHandle.addEventListener('mousedown', (e) => {
      isSplitResizing = true;
      splitStartX = e.clientX;
      splitStartLeftWidth = logViewerWrapper?.offsetWidth || 0;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    // Create secondary viewer
    secondaryViewer = createSecondaryViewer(elements.editorContainer);
    secondarySetFile(secondaryViewer, targetTab.filePath, targetTab.totalLines);
    secondarySetDiffDisplayLines(secondaryViewer, right);

    // Create diff nav bar
    createDiffNavBar(result.result);

    // Apply left display lines to primary (force re-render)
    cachedLines.clear();
    const totalDisplayLines = left.length;
    const containerHeight = logViewerElement?.clientHeight || 600;
    const visibleLines = Math.ceil(containerHeight / getLineHeight());
    state.visibleStartLine = 0;
    state.visibleEndLine = Math.min(visibleLines + BUFFER_LINES, totalDisplayLines - 1);
    loadVisibleLines();
  } catch (error) {
    progressUnsub();
    hideProgress();
    console.error('Diff computation failed:', error);
    viewMode = 'single';
    splitDiffState.secondaryTabId = null;
    splitDiffState.secondaryFilePath = null;
  }
}

function deactivateSplitView(): void {
  if (viewMode === 'single') return;

  // Remove diff nav bar
  const diffNavBar = document.querySelector('.diff-nav-bar');
  if (diffNavBar) diffNavBar.remove();

  // Remove resize handle
  const resizeHandle = elements.editorContainer.querySelector('.split-resize-handle');
  if (resizeHandle) resizeHandle.remove();

  // Destroy secondary viewer
  if (secondaryViewer) {
    destroySecondaryViewer(secondaryViewer);
    secondaryViewer = null;
  }

  // Remove primary pane header
  if (logViewerWrapper) {
    const primaryHeader = logViewerWrapper.querySelector('.primary-header');
    if (primaryHeader) primaryHeader.remove();
    logViewerWrapper.classList.remove('split-pane', 'primary-pane');
    logViewerWrapper.style.width = '';
  }

  // Remove layout classes
  elements.editorContainer.classList.remove('split-view', 'diff-mode');

  // Reset state
  const wasDiff = viewMode === 'diff';
  viewMode = 'single';
  splitDiffState.secondaryTabId = null;
  splitDiffState.secondaryFilePath = null;
  splitDiffState.diffResult = null;
  splitDiffState.leftDisplayLines = null;
  splitDiffState.rightDisplayLines = null;
  splitDiffState.currentHunkIndex = -1;
  splitDiffState.isSyncScrolling = false;

  // If was diff mode, re-render primary with normal lines
  if (wasDiff) {
    cachedLines.clear();
    if (state.totalLines > 0 && logViewerElement) {
      const containerHeight = logViewerElement.clientHeight;
      const visibleLines = Math.ceil(containerHeight / getLineHeight());
      const startLine = scrollTopToLine(logViewerElement.scrollTop);
      state.visibleStartLine = Math.max(0, startLine - BUFFER_LINES);
      state.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, getTotalLines() - 1);
      loadVisibleLines();
    }
  }
}

function createDiffNavBar(result: DiffResultInfo): void {
  const existing = document.querySelector('.diff-nav-bar');
  if (existing) existing.remove();

  const changeHunks = result.hunks.filter(h => h.type !== 'equal');
  const totalChanges = changeHunks.length;

  const navBar = document.createElement('div');
  navBar.className = 'diff-nav-bar';
  navBar.innerHTML = `
    <div class="diff-stats">
      <span class="diff-stat-added">+${result.stats.additions}</span>
      <span class="diff-stat-removed">-${result.stats.deletions}</span>
      <span class="diff-stat-modified">~${result.stats.modifications}</span>
    </div>
    <div class="diff-nav-position">
      <span class="diff-nav-pos-text">${totalChanges} changes</span>
    </div>
    <div class="diff-nav-controls">
      <button class="diff-nav-btn" id="diff-prev-hunk" title="Previous change (Shift+F7)">&#9650; Prev</button>
      <button class="diff-nav-btn" id="diff-next-hunk" title="Next change (F7)">&#9660; Next</button>
      <label class="diff-sync-toggle" title="Synchronized scrolling">
        <input type="checkbox" id="diff-sync-scroll" ${splitDiffState.syncScroll ? 'checked' : ''}>
        Sync Scroll
      </label>
      <button class="diff-nav-btn diff-close-btn" id="diff-close" title="Close diff view (Escape)">Close</button>
    </div>
  `;

  // Insert before editor container
  elements.editorContainer.parentElement?.insertBefore(navBar, elements.editorContainer);

  // Event handlers
  document.getElementById('diff-prev-hunk')?.addEventListener('click', () => navigateDiffHunk(-1));
  document.getElementById('diff-next-hunk')?.addEventListener('click', () => navigateDiffHunk(1));
  document.getElementById('diff-close')?.addEventListener('click', () => deactivateSplitView());
  document.getElementById('diff-sync-scroll')?.addEventListener('change', (e) => {
    splitDiffState.syncScroll = (e.target as HTMLInputElement).checked;
  });
}

function navigateDiffHunk(direction: number): void {
  if (!splitDiffState.diffResult || !splitDiffState.leftDisplayLines) return;

  const changeHunkIndices: number[] = [];
  for (let h = 0; h < splitDiffState.diffResult.hunks.length; h++) {
    if (splitDiffState.diffResult.hunks[h].type !== 'equal') changeHunkIndices.push(h);
  }
  if (changeHunkIndices.length === 0) return;

  let newIdx: number;
  if (splitDiffState.currentHunkIndex < 0) {
    newIdx = direction > 0 ? 0 : changeHunkIndices.length - 1;
  } else {
    const currentPos = changeHunkIndices.indexOf(splitDiffState.currentHunkIndex);
    const nextPos = currentPos + direction;
    if (nextPos < 0) newIdx = changeHunkIndices.length - 1;
    else if (nextPos >= changeHunkIndices.length) newIdx = 0;
    else newIdx = nextPos;
  }

  splitDiffState.currentHunkIndex = changeHunkIndices[newIdx];

  // Find first display line index for this hunk
  const displayLineIdx = splitDiffState.leftDisplayLines.findIndex(
    dl => dl.hunkIndex === splitDiffState.currentHunkIndex
  );
  if (displayLineIdx >= 0) {
    // Scroll primary
    if (logViewerElement) {
      const scrollTop = lineToScrollTop(displayLineIdx);
      logViewerElement.scrollTop = scrollTop;
    }
    // Scroll secondary (sync)
    if (secondaryViewer) {
      const scrollTop = secondaryLineToScrollTop(secondaryViewer, displayLineIdx);
      secondaryViewer.viewerElement.scrollTop = scrollTop;
    }
  }

  // Update position text
  const posText = document.querySelector('.diff-nav-pos-text');
  if (posText) {
    posText.textContent = `${newIdx + 1}/${changeHunkIndices.length} changes`;
  }
}

function createLogViewer(): void {
  // Remove existing wrapper if any
  if (logViewerWrapper) {
    logViewerWrapper.remove();
  }

  elements.welcomeMessage.classList.add('hidden');

  // Create wrapper for log viewer and minimap
  logViewerWrapper = document.createElement('div');
  logViewerWrapper.className = 'log-viewer-wrapper';

  // Create log viewer
  logViewerElement = document.createElement('div');
  logViewerElement.className = 'virtual-log-viewer';

  // Apply current zoom settings
  const lineHeight = getLineHeight();
  const fontSize = getFontSize();
  logViewerElement.style.setProperty('--line-height', `${lineHeight}px`);
  logViewerElement.style.setProperty('--font-size', `${fontSize}px`);
  logViewerElement.style.fontSize = `${fontSize}px`;

  logContentElement = document.createElement('div');
  logContentElement.className = 'log-content';

  logViewerElement.appendChild(logContentElement);

  // Create minimap
  minimapElement = document.createElement('div');
  minimapElement.className = 'minimap';

  minimapContentElement = document.createElement('div');
  minimapContentElement.className = 'minimap-content';

  minimapViewportElement = document.createElement('div');
  minimapViewportElement.className = 'minimap-viewport';

  minimapElement.appendChild(minimapContentElement);
  minimapElement.appendChild(minimapViewportElement);

  // Add to wrapper
  logViewerWrapper.appendChild(logViewerElement);
  logViewerWrapper.appendChild(minimapElement);
  elements.editorContainer.appendChild(logViewerWrapper);

  // Event listeners with passive flag for better scroll performance
  logViewerElement.addEventListener('scroll', handleScroll, { passive: true });
  logViewerElement.addEventListener('click', handleLogClick);
  logViewerElement.addEventListener('contextmenu', handleContextMenu);

  // Mouse wheel zoom (Ctrl + scroll) and scroll speed normalization
  logViewerElement.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
      return;
    }

    // Normalize scroll deltas for trackpad vs mouse
    // deltaMode: 0 = pixels (trackpad), 1 = lines (mouse), 2 = pages
    e.preventDefault();

    let deltaY = e.deltaY;
    let deltaX = e.deltaX;

    if (e.deltaMode === 0) {
      // Pixel-based scrolling (trackpad) - apply user's scroll speed setting for vertical only
      const speedFactor = userSettings.scrollSpeed / 100;
      deltaY = deltaY * speedFactor;
      // Horizontal scroll uses raw pixel values for natural trackpad feel
    } else if (e.deltaMode === 1) {
      // Line-based scrolling (mouse wheel) - convert to pixels
      deltaY = deltaY * getLineHeight();
      deltaX = deltaX * getLineHeight() * 3; // 3x multiplier for faster horizontal nav
    } else if (e.deltaMode === 2) {
      // Page-based scrolling - convert to pixels
      deltaY = deltaY * logViewerElement!.clientHeight;
      deltaX = deltaX * logViewerElement!.clientWidth;
    }

    // Shift+Scroll: convert vertical scroll to horizontal for easy line navigation
    if (e.shiftKey && deltaY !== 0 && deltaX === 0) {
      deltaX = deltaY;
      deltaY = 0;
    }

    // Apply normalized vertical scroll
    const newScrollTop = logViewerElement!.scrollTop + deltaY;
    const maxScrollY = logViewerElement!.scrollHeight - logViewerElement!.clientHeight;
    logViewerElement!.scrollTop = Math.max(0, Math.min(maxScrollY, newScrollTop));

    // Apply normalized horizontal scroll
    if (deltaX !== 0) {
      const newScrollLeft = logViewerElement!.scrollLeft + deltaX;
      const maxScrollX = logViewerElement!.scrollWidth - logViewerElement!.clientWidth;
      logViewerElement!.scrollLeft = Math.max(0, Math.min(maxScrollX, newScrollLeft));
    }
  }, { passive: false });
  minimapElement.addEventListener('click', handleMinimapClick);
  minimapElement.addEventListener('mousedown', handleMinimapDrag);

  // Use ResizeObserver for responsive updates
  const resizeObserver = new ResizeObserver(() => {
    if (state.totalLines > 0) {
      // Recalculate visible range on resize
      const containerHeight = logViewerElement!.clientHeight;
      const visibleLines = Math.ceil(containerHeight / getLineHeight());
      const startLine = scrollTopToLine(logViewerElement!.scrollTop);
      state.visibleStartLine = Math.max(0, startLine - BUFFER_LINES);
      state.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, getTotalLines() - 1);
      loadVisibleLines();
    }
  });
  resizeObserver.observe(logViewerElement);
}

function getVirtualHeight(): number {
  const totalLines = getTotalLines();
  const naturalHeight = totalLines * getLineHeight();
  return Math.min(naturalHeight, MAX_SCROLL_HEIGHT);
}

function isUsingScaledScroll(): boolean {
  const totalLines = getTotalLines();
  return totalLines * getLineHeight() > MAX_SCROLL_HEIGHT;
}

function scrollTopToLine(scrollTop: number): number {
  const totalLines = getTotalLines();
  if (!isUsingScaledScroll()) {
    return Math.floor(scrollTop / getLineHeight());
  }
  // Proportional mapping for large files
  const virtualHeight = getVirtualHeight();
  const scrollRatio = scrollTop / (virtualHeight - (logViewerElement?.clientHeight || 0));
  const maxLine = totalLines - Math.ceil((logViewerElement?.clientHeight || 0) / getLineHeight());
  return Math.floor(scrollRatio * maxLine);
}

function lineToScrollTop(lineNumber: number): number {
  const totalLines = getTotalLines();
  if (!isUsingScaledScroll()) {
    return lineNumber * getLineHeight();
  }
  // Proportional mapping for large files
  const virtualHeight = getVirtualHeight();
  const maxLine = totalLines - Math.ceil((logViewerElement?.clientHeight || 0) / getLineHeight());
  const scrollRatio = lineNumber / maxLine;
  return scrollRatio * (virtualHeight - (logViewerElement?.clientHeight || 0));
}

function handleScroll(): void {
  if (!logViewerElement || !logContentElement) return;

  // In JSON mode, content flows naturally - just update minimap
  if (jsonFormattingEnabled) {
    updateMinimapViewport();
    return;
  }

  // Render immediately with cached data for responsive feel
  // Only defer the data loading part
  const scrollTop = logViewerElement.scrollTop;
  const containerHeight = logViewerElement.clientHeight;

  // Track scroll direction for predictive prefetching
  scrollDirection = scrollTop > lastScrollTop ? 'down' : 'up';
  lastScrollTop = scrollTop;

  const startLine = scrollTopToLine(scrollTop);
  const visibleLines = Math.ceil(containerHeight / getLineHeight());

  // Immediately update visible range and render cached content
  const prefetchUp = scrollDirection === 'up' ? PREFETCH_LINES : BUFFER_LINES;
  const prefetchDown = scrollDirection === 'down' ? PREFETCH_LINES : BUFFER_LINES;

  state.visibleStartLine = Math.max(0, startLine - prefetchUp);
  state.visibleEndLine = Math.min(getTotalLines() - 1, startLine + visibleLines + prefetchDown);

  // Immediate render with cached data (synchronous, no delay)
  const renderStart = performance.now();
  renderVisibleLines();
  const renderTime = performance.now() - renderStart;
  updateMinimapViewport();

  // Detect scroll slowness and suggest formatting (only for JSON-like files)
  const lowerFilePath = (state.filePath || '').toLowerCase();
  const isJsonFile = lowerFilePath.endsWith('.json') || lowerFilePath.endsWith('.jsonl') || lowerFilePath.endsWith('.ndjson');
  if (!scrollSlownessWarningShown && isJsonFile && renderTime > SLOW_SCROLL_THRESHOLD_MS) {
    slowScrollFrames++;
    if (slowScrollFrames >= SLOW_SCROLL_FRAME_COUNT) {
      scrollSlownessWarningShown = true;
      elements.longLinesWarning.classList.remove('hidden');
    }
  } else if (renderTime <= SLOW_SCROLL_THRESHOLD_MS) {
    slowScrollFrames = Math.max(0, slowScrollFrames - 1);
  }

  // Defer data loading to RAF to avoid blocking scroll
  if (scrollRAF !== null) {
    cancelAnimationFrame(scrollRAF);
  }
  scrollRAF = requestAnimationFrame(() => {
    scrollRAF = null;
    // Load any missing data in background
    loadVisibleLines();
  });

  // Sync scroll to secondary (in diff mode)
  if (viewMode === 'diff' && splitDiffState.syncScroll && !splitDiffState.isSyncScrolling && secondaryViewer) {
    splitDiffState.isSyncScrolling = true;
    requestAnimationFrame(() => {
      if (secondaryViewer) secondaryViewer.viewerElement.scrollTop = scrollTop;
      splitDiffState.isSyncScrolling = false;
    });
  }

  // Mark scrolling state
  isScrolling = true;
  if (scrollEndTimer) clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(() => {
    isScrolling = false;
  }, 150);
}

function performScrollUpdate(): void {
  if (!logViewerElement || !logContentElement) return;

  // In JSON mode, content flows naturally - skip virtual scroll calculations
  if (jsonFormattingEnabled) {
    updateMinimapViewport();
    return;
  }

  const scrollTop = logViewerElement.scrollTop;
  const containerHeight = logViewerElement.clientHeight;

  // Track scroll direction for predictive prefetching
  scrollDirection = scrollTop > lastScrollTop ? 'down' : 'up';
  lastScrollTop = scrollTop;

  const startLine = scrollTopToLine(scrollTop);
  const visibleLines = Math.ceil(containerHeight / getLineHeight());
  const endLine = startLine + visibleLines;

  // Add extra buffer in scroll direction (predictive prefetching)
  const prefetchUp = scrollDirection === 'up' ? PREFETCH_LINES : BUFFER_LINES;
  const prefetchDown = scrollDirection === 'down' ? PREFETCH_LINES : BUFFER_LINES;

  const bufferStart = Math.max(0, startLine - prefetchUp);
  const bufferEnd = Math.min(getTotalLines() - 1, endLine + prefetchDown);

  // Only update if range changed significantly (reduces unnecessary loads)
  const rangeChanged = Math.abs(bufferStart - state.visibleStartLine) > 10 ||
                       Math.abs(bufferEnd - state.visibleEndLine) > 10;

  if (rangeChanged) {
    state.visibleStartLine = bufferStart;
    state.visibleEndLine = bufferEnd;
    loadVisibleLines();
  } else {
    // Just re-render with existing cache (fast path)
    renderVisibleLines();
  }

  // Update minimap viewport
  updateMinimapViewport();

  // Mark scrolling state for UI optimizations
  isScrolling = true;
  if (scrollEndTimer) clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(() => {
    isScrolling = false;
    // Do a final render when scrolling stops for any missed updates
    renderVisibleLines();
  }, 150);
}

function getTotalLines(): number {
  if (viewMode === 'diff' && splitDiffState.leftDisplayLines) {
    return splitDiffState.leftDisplayLines.length;
  }
  return state.isFiltered && state.filteredLines !== null
    ? state.filteredLines
    : state.totalLines;
}

// Find the display index for an original line number when filtered.
// Searches visible cached lines for a match. Returns undefined if not found.
function findDisplayIndexForLine(originalLineNumber: number): number | undefined {
  if (!state.isFiltered) return originalLineNumber;
  const total = getTotalLines();
  // Search cached lines for matching original lineNumber
  for (let i = 0; i < total; i++) {
    const line = cachedLines.get(i);
    if (line && line.lineNumber === originalLineNumber) return i;
  }
  return undefined;
}

async function loadVisibleLines(): Promise<void> {
  if (!logContentElement) return;

  // Diff mode: load by real line numbers from display line mapping
  if (viewMode === 'diff' && splitDiffState.leftDisplayLines) {
    const totalLines = getTotalLines();
    const start = state.visibleStartLine;
    const end = Math.min(state.visibleEndLine, totalLines - 1);

    // Collect real line numbers that need loading
    const realLineNumbers: number[] = [];
    for (let i = start; i <= end; i++) {
      const dl = splitDiffState.leftDisplayLines[i];
      if (dl && dl.type !== 'spacer' && !cachedLines.has(dl.realLineNumber)) {
        realLineNumbers.push(dl.realLineNumber);
      }
    }

    if (realLineNumbers.length === 0) {
      renderVisibleLines();
      return;
    }

    try {
      // Batch into contiguous ranges
      realLineNumbers.sort((a, b) => a - b);
      const ranges: Array<{ start: number; end: number }> = [];
      let rangeStart = realLineNumbers[0];
      let rangeEnd = rangeStart;
      for (let i = 1; i < realLineNumbers.length; i++) {
        if (realLineNumbers[i] === rangeEnd + 1) { rangeEnd = realLineNumbers[i]; }
        else { ranges.push({ start: rangeStart, end: rangeEnd }); rangeStart = realLineNumbers[i]; rangeEnd = rangeStart; }
      }
      ranges.push({ start: rangeStart, end: rangeEnd });

      const loadPromises = ranges.map(async (range) => {
        const count = range.end - range.start + 1;
        const result = await window.api.getLines(range.start, count);
        if (result.success && result.lines) {
          for (const line of result.lines) {
            cachedLines.set(line.lineNumber, line);
          }
        }
      });
      await Promise.all(loadPromises);
      renderVisibleLines();
    } catch (error) {
      console.error('Failed to load diff lines:', error);
    }
    return;
  }

  const totalLines = getTotalLines();
  const start = state.visibleStartLine;
  const end = Math.min(state.visibleEndLine, totalLines - 1);

  // Find gaps in cache - only load what we don't have (incremental loading)
  const gaps = findCacheGaps(start, end);

  if (gaps.length === 0) {
    // All lines already cached, just render
    renderVisibleLines();
    return;
  }

  try {
    // Load all gaps in parallel for faster loading
    const loadPromises = gaps.map(async (gap) => {
      const count = gap.end - gap.start + 1;
      const result = await window.api.getLines(gap.start, count);
      if (result.success && result.lines) {
        // When filtering, cache by filtered position (gap.start + offset)
        // When not filtering, cache by original line number
        for (let idx = 0; idx < result.lines.length; idx++) {
          const line = result.lines[idx];
          const cacheKey = state.isFiltered ? gap.start + idx : line.lineNumber;
          cachedLines.set(cacheKey, line);
        }
      }
    });

    await Promise.all(loadPromises);
    renderVisibleLines();
  } catch (error) {
    console.error('Failed to load lines:', error);
  }
}

// Find gaps in cache that need to be loaded
function findCacheGaps(start: number, end: number): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  let gapStart: number | null = null;

  for (let i = start; i <= end; i++) {
    if (!cachedLines.has(i)) {
      if (gapStart === null) {
        gapStart = i;
      }
    } else {
      if (gapStart !== null) {
        gaps.push({ start: gapStart, end: i - 1 });
        gapStart = null;
      }
    }
  }

  // Close final gap if open
  if (gapStart !== null) {
    gaps.push({ start: gapStart, end });
  }

  // Merge small gaps to reduce API calls (batch optimization)
  return mergeSmallGaps(gaps, 50);
}

// Merge gaps that are close together to reduce API calls
function mergeSmallGaps(gaps: Array<{ start: number; end: number }>, threshold: number): Array<{ start: number; end: number }> {
  if (gaps.length <= 1) return gaps;

  const merged: Array<{ start: number; end: number }> = [gaps[0]];

  for (let i = 1; i < gaps.length; i++) {
    const last = merged[merged.length - 1];
    const current = gaps[i];

    // If gap between them is small, merge
    if (current.start - last.end <= threshold) {
      last.end = current.end;
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function renderVisibleLines(): void {
  if (!logContentElement || !logViewerElement) return;

  const totalLines = getTotalLines();
  if (totalLines === 0) return;

  const virtualHeight = getVirtualHeight();

  // Preserve horizontal scroll position
  const scrollLeft = logViewerElement.scrollLeft;

  // Release all pooled elements back
  lineElementPool.releaseAll();

  // Use DocumentFragment for batch DOM insertion (reduces reflows)
  const fragment = document.createDocumentFragment();

  const scrollTop = logViewerElement.scrollTop;

  // Calculate visible range for rendering
  const startLine = state.visibleStartLine;
  const endLine = state.visibleEndLine;

  // For scaled scroll positioning
  const usingScaled = isUsingScaledScroll();
  const firstVisibleLine = scrollTopToLine(scrollTop);

  // Track max content width for horizontal scrolling
  let maxContentWidth = 0;

  // Diff mode display lines (null in normal mode - zero cost check)
  const diffDisplayLines = viewMode === 'diff' ? splitDiffState.leftDisplayLines : null;

  // Batch create all line elements
  for (let i = startLine; i <= endLine; i++) {
    // Diff mode: handle spacers and real line number mapping
    if (diffDisplayLines) {
      const dl = diffDisplayLines[i];
      if (!dl) continue;

      if (dl.type === 'spacer') {
        const spacerDiv = lineElementPool.acquire();
        spacerDiv.className = 'log-line diff-spacer';
        spacerDiv.innerHTML = '<span class="line-number">&nbsp;</span><span class="line-content">&nbsp;</span>';
        let top: number;
        if (usingScaled) { top = scrollTop + (i - firstVisibleLine) * getLineHeight(); }
        else { top = i * getLineHeight(); }
        spacerDiv.style.cssText = `position:absolute;top:0;left:0;transform:translateY(${top}px);will-change:transform;white-space:pre;`;
        fragment.appendChild(spacerDiv);
        continue;
      }

      const line = cachedLines.get(dl.realLineNumber);
      if (line) {
        const lineElement = createLineElementPooled(line);
        // Add diff CSS class
        if (dl.type === 'added') lineElement.classList.add('diff-added');
        else if (dl.type === 'removed') lineElement.classList.add('diff-removed');
        else if (dl.type === 'modified') lineElement.classList.add('diff-modified');

        let top: number;
        if (usingScaled) { top = scrollTop + (i - firstVisibleLine) * getLineHeight(); }
        else { top = i * getLineHeight(); }
        lineElement.style.cssText = `position:absolute;top:0;left:0;transform:translateY(${top}px);will-change:transform;white-space:pre;`;
        if (lineElement.dataset.bookmarkColor) {
          lineElement.style.borderLeftColor = lineElement.dataset.bookmarkColor;
        }
        fragment.appendChild(lineElement);

        const estimatedWidth = LINE_NUMBER_GUTTER_EXTRA + (line.text.length * getCharWidth());
        if (estimatedWidth > maxContentWidth) maxContentWidth = estimatedWidth;
      }
      continue;
    }

    const line = cachedLines.get(i);
    if (line) {
      const lineElement = createLineElementPooled(line);

      // Calculate position
      let top: number;
      if (usingScaled) {
        const lineOffset = i - firstVisibleLine;
        top = scrollTop + lineOffset * getLineHeight();
      } else {
        top = i * getLineHeight();
      }

      // Use transform for GPU-accelerated positioning (smoother scrolling)
      // Note: no right:0 to allow horizontal scroll expansion
      if (wordWrapEnabled || jsonFormattingEnabled) {
        // Word wrap or JSON mode: use relative positioning for natural flow
        lineElement.style.cssText = `position:relative;white-space:pre-wrap;word-break:break-word;`;
      } else {
        lineElement.style.cssText = `position:absolute;top:0;left:0;transform:translateY(${top}px);will-change:transform;white-space:pre;`;
      }
      // Apply bookmark color after cssText (which overwrites all inline styles)
      if (lineElement.dataset.bookmarkColor) {
        lineElement.style.borderLeftColor = lineElement.dataset.bookmarkColor;
      }

      fragment.appendChild(lineElement);

      const estimatedWidth = LINE_NUMBER_GUTTER_EXTRA + (line.text.length * getCharWidth());
      if (estimatedWidth > maxContentWidth) {
        maxContentWidth = estimatedWidth;
      }
    }
  }

  // Single DOM operation to replace all content
  logContentElement.innerHTML = '';
  logContentElement.appendChild(fragment);

  // Set content size for scrolling
  if (wordWrapEnabled || jsonFormattingEnabled) {
    // Word wrap or JSON mode: let content flow naturally
    logContentElement.style.height = 'auto';
    logContentElement.style.minWidth = '';
  } else {
    logContentElement.style.height = `${virtualHeight}px`;
    logContentElement.style.minWidth = `${Math.max(maxContentWidth, logViewerElement.clientWidth)}px`;
  }

  // Restore scroll positions
  if (scrollLeft > 0) {
    logViewerElement.scrollLeft = scrollLeft;
  }
  // In JSON mode, preserve vertical scroll position after re-render
  if (jsonFormattingEnabled && scrollTop > 0) {
    logViewerElement.scrollTop = scrollTop;
  }
}

// Pooled line element creation - reuses DOM elements
function createLineElementPooled(line: LogLine): HTMLDivElement {
  const div = lineElementPool.acquire();
  div.dataset.lineNumber = String(line.lineNumber);

  // Build class list
  let className = 'log-line';
  if (line.level) className += ` level-${line.level}`;
  if (state.selectedLine === line.lineNumber) className += ' selected';
  if (state.selectionStart !== null && state.selectionEnd !== null &&
      line.lineNumber >= state.selectionStart && line.lineNumber <= state.selectionEnd) {
    className += ' range-selected';
  }

  // Check for bookmark and get comment
  const bookmark = state.bookmarks.find(b => b.lineNumber === line.lineNumber);
  if (bookmark) {
    className += ' bookmarked';
    div.title = bookmark.label ? `Bookmark: ${bookmark.label}` : 'Bookmarked line';
    if (bookmark.color) {
      div.dataset.bookmarkColor = bookmark.color;
    } else {
      delete div.dataset.bookmarkColor;
    }
  } else {
    div.title = '';
    delete div.dataset.bookmarkColor;
  }
  div.className = className;

  // Create content using innerHTML for speed (single parse)
  const lineNumHtml = `<span class="line-number">${line.lineNumber + 1}</span>`;
  let displayText = applyColumnFilter(line.text);

  // Truncate very long lines to prevent DOM/rendering slowness
  const MAX_RENDER_LENGTH = 5000;
  let truncated = false;
  if (displayText.length > MAX_RENDER_LENGTH) {
    displayText = displayText.substring(0, MAX_RENDER_LENGTH);
    truncated = true;
  }

  // Check if there are active highlights or search
  const hasActiveHighlights = state.highlights.length > 0 || state.searchResults.length > 0 || state.searchConfigs.some(c => c.enabled);

  let formattedContent: string;
  if (jsonFormattingEnabled && containsJson(displayText)) {
    if (hasActiveHighlights) {
      // Pretty-print JSON first, then apply highlights to the formatted text
      const prettyText = formatJsonContent(displayText, true);
      const searchResult = applySearchHighlightsRaw(prettyText, line.lineNumber);
      // Use simple escaping for JSON - no truncation since JSON.parse validated the content
      formattedContent = applyHighlightsWithSearchJson(prettyText, searchResult.searchRanges);
    } else {
      // Full JSON formatting with syntax highlighting (already escaped internally)
      formattedContent = formatJsonContent(displayText);
    }
  } else {
    const searchResult = applySearchHighlightsRaw(displayText, line.lineNumber);
    formattedContent = applyHighlightsWithSearch(displayText, searchResult.searchRanges);
  }
  if (truncated) {
    formattedContent += '<span class="truncation-indicator"> \u2026 (truncated)</span>';
  }
  const contentHtml = `<span class="line-content">${formattedContent}</span>`;
  div.innerHTML = lineNumHtml + contentHtml;

  return div;
}

function createLineElement(line: LogLine): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'log-line';
  div.dataset.lineNumber = String(line.lineNumber);

  if (line.level) {
    div.classList.add(`level-${line.level}`);
  }

  if (state.selectedLine === line.lineNumber) {
    div.classList.add('selected');
  }

  // Range selection highlight
  if (state.selectionStart !== null && state.selectionEnd !== null) {
    if (line.lineNumber >= state.selectionStart && line.lineNumber <= state.selectionEnd) {
      div.classList.add('range-selected');
    }
  }

  const bookmark = state.bookmarks.find((b) => b.lineNumber === line.lineNumber);
  if (bookmark) {
    div.classList.add('bookmarked');
  }

  const lineNumSpan = document.createElement('span');
  lineNumSpan.className = 'line-number';
  lineNumSpan.textContent = String(line.lineNumber + 1);

  const contentSpan = document.createElement('span');
  contentSpan.className = 'line-content';

  // Apply column filter, then search highlights, then manual highlights
  const displayText = applyColumnFilter(line.text);

  // Check if there are active highlights or search
  const hasActiveHighlights = state.highlights.length > 0 || state.searchResults.length > 0 || state.searchConfigs.some(c => c.enabled);

  let finalHtml: string;
  if (jsonFormattingEnabled && containsJson(displayText)) {
    if (hasActiveHighlights) {
      // Pretty-print JSON first, then apply highlights to the formatted text
      const prettyText = formatJsonContent(displayText, true);
      const searchResult = applySearchHighlightsRaw(prettyText, line.lineNumber);
      // Use simple escaping for JSON - no truncation
      finalHtml = applyHighlightsWithSearchJson(prettyText, searchResult.searchRanges);
    } else {
      // Full JSON formatting with syntax highlighting
      finalHtml = formatJsonContent(displayText);
    }
  } else {
    const searchResult = applySearchHighlightsRaw(displayText, line.lineNumber);
    finalHtml = applyHighlightsWithSearch(displayText, searchResult.searchRanges);
  }
  contentSpan.innerHTML = finalHtml;

  div.appendChild(lineNumSpan);
  div.appendChild(contentSpan);

  return div;
}

function applyHighlights(text: string): string {
  if (state.highlights.length === 0) {
    return escapeHtml(text);
  }

  interface HighlightMatch {
    start: number;
    end: number;
    config: HighlightConfig;
  }

  const matches: HighlightMatch[] = [];

  for (const config of state.highlights) {
    try {
      let flags = config.highlightAll ? 'g' : '';
      if (!config.matchCase) flags += 'i';

      let pattern = config.pattern;
      if (!config.isRegex) {
        pattern = escapeRegex(pattern);
      }

      // Handle includeWhitespace - capture surrounding whitespace
      if (config.includeWhitespace) {
        pattern = `(\\s*)${pattern}(\\s*)`;
      }

      if (config.wholeWord && !config.includeWhitespace) {
        pattern = `\\b${pattern}\\b`;
      }

      const regex = new RegExp(pattern, flags || undefined);
      let match;

      if (config.highlightAll) {
        while ((match = regex.exec(text)) !== null) {
          let start = match.index;
          let end = match.index + match[0].length;

          matches.push({ start, end, config });
        }
      } else {
        // Only first match
        match = regex.exec(text);
        if (match) {
          let start = match.index;
          let end = match.index + match[0].length;

          matches.push({ start, end, config });
        }
      }
    } catch {
      // Invalid regex, skip
    }
  }

  if (matches.length === 0) {
    return escapeHtml(text);
  }

  // Sort by start position
  matches.sort((a, b) => a.start - b.start);

  // Build highlighted string
  let result = '';
  let lastEnd = 0;

  for (const match of matches) {
    if (match.start < lastEnd) continue; // Skip overlapping

    result += escapeHtml(text.slice(lastEnd, match.start));

    const style = `background-color: ${match.config.backgroundColor}; ${
      match.config.textColor ? `color: ${match.config.textColor}` : ''
    }`;
    // Convert spaces to &nbsp; in highlighted text so background color is visible
    const highlightedText = escapeHtml(text.slice(match.start, match.end)).replace(/ /g, '&nbsp;');
    result += `<span style="${style}">${highlightedText}</span>`;
    lastEnd = match.end;
  }

  result += escapeHtml(text.slice(lastEnd));
  return result;
}

interface SearchRange {
  start: number;
  end: number;
  isCurrent: boolean;
}

function applySearchHighlightsRaw(text: string, lineNumber: number): { searchRanges: SearchRange[] } {
  // Find search matches for this line
  const lineMatches = state.searchResults.filter(m => m.lineNumber === lineNumber);
  if (lineMatches.length === 0 || !elements.searchInput.value) {
    return { searchRanges: [] };
  }

  // Get the search pattern
  const pattern = elements.searchInput.value;
  const isRegex = elements.searchRegex.checked;
  const isWildcard = elements.searchWildcard.checked;
  const matchCase = elements.searchCase.checked;

  const searchRanges: SearchRange[] = [];

  try {
    let searchRegex: RegExp;
    if (isRegex) {
      searchRegex = new RegExp(pattern, matchCase ? 'g' : 'gi');
    } else if (isWildcard) {
      // Wildcard mode: * = any chars, ? = any single char, rest literal
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      searchRegex = new RegExp(escaped, matchCase ? 'g' : 'gi');
    } else {
      // Escape special regex chars for literal search
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchRegex = new RegExp(escaped, matchCase ? 'g' : 'gi');
    }

    // Check if current search result is on this line
    const isCurrent = state.currentSearchIndex >= 0 &&
      state.searchResults[state.currentSearchIndex]?.lineNumber === lineNumber;

    let match;
    while ((match = searchRegex.exec(text)) !== null) {
      searchRanges.push({
        start: match.index,
        end: match.index + match[0].length,
        isCurrent,
      });
    }
  } catch {
    // Invalid regex, return empty
  }

  return { searchRanges };
}

function applyHighlightsWithSearch(text: string, searchRanges: SearchRange[]): string {
  interface HighlightRange {
    start: number;
    end: number;
    type: 'search' | 'highlight';
    className: string;
    style?: string;
  }

  const ranges: HighlightRange[] = [];

  // Add search ranges
  for (const sr of searchRanges) {
    const className = sr.isCurrent ? 'search-match current' : 'search-match';
    ranges.push({ start: sr.start, end: sr.end, type: 'search', className });
  }

  // Add manual highlight ranges
  for (const config of state.highlights) {
    try {
      let flags = config.highlightAll ? 'g' : '';
      if (!config.matchCase) flags += 'i';

      let pattern = config.pattern;
      if (!config.isRegex) {
        pattern = escapeRegex(pattern);
      }

      if (config.includeWhitespace) {
        pattern = `(\\s*)${pattern}(\\s*)`;
      }

      if (config.wholeWord && !config.includeWhitespace) {
        pattern = `\\b${pattern}\\b`;
      }

      const regex = new RegExp(pattern, flags || undefined);
      let match;

      // Build inline style for this highlight
      const style = `background-color: ${config.backgroundColor}; ${
        config.textColor ? `color: ${config.textColor}` : ''
      }`;

      if (config.highlightAll) {
        while ((match = regex.exec(text)) !== null) {
          ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            type: 'highlight',
            className: 'highlight',
            style,
          });
        }
      } else {
        match = regex.exec(text);
        if (match) {
          ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            type: 'highlight',
            className: 'highlight',
            style,
          });
        }
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // Add search config ranges (enabled configs)
  for (const config of state.searchConfigs) {
    if (!config.enabled) continue;
    try {
      let flags = 'g';
      if (!config.matchCase) flags += 'i';

      let pattern = config.pattern;
      if (!config.isRegex) {
        pattern = escapeRegex(pattern);
      }
      if (config.wholeWord) {
        pattern = `\\b${pattern}\\b`;
      }

      const regex = new RegExp(pattern, flags);
      let match;
      const style = `background-color: ${config.color}; ${config.textColor ? `color: ${config.textColor}` : 'color: #000'}`;
      while ((match = regex.exec(text)) !== null) {
        ranges.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'highlight',
          className: 'highlight search-config-highlight',
          style,
        });
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // If no ranges, just escape and return
  if (ranges.length === 0) {
    return escapeHtml(text);
  }

  // Sort by start position, search matches have priority (rendered on top)
  ranges.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    // Search matches render after highlights (so they appear on top)
    return a.type === 'search' ? 1 : -1;
  });

  // Build result by iterating through text and applying ranges
  // We'll use a simpler non-overlapping approach: search matches take precedence
  let result = '';
  let pos = 0;

  // Remove overlapping highlight ranges where search matches exist
  const finalRanges: HighlightRange[] = [];
  for (const range of ranges) {
    if (range.type === 'search') {
      finalRanges.push(range);
    } else {
      // Check if this highlight overlaps with any search range
      const overlapsSearch = searchRanges.some(
        sr => !(range.end <= sr.start || range.start >= sr.end)
      );
      if (!overlapsSearch) {
        finalRanges.push(range);
      }
    }
  }

  // Re-sort and remove overlapping ranges (first one wins)
  finalRanges.sort((a, b) => a.start - b.start);
  const nonOverlapping: HighlightRange[] = [];
  for (const range of finalRanges) {
    if (nonOverlapping.length === 0 || range.start >= nonOverlapping[nonOverlapping.length - 1].end) {
      nonOverlapping.push(range);
    }
  }

  for (const range of nonOverlapping) {
    // Add text before this range
    if (range.start > pos) {
      result += escapeHtml(text.slice(pos, range.start));
    }
    // Add the highlighted range with style if available
    const styleAttr = range.style ? ` style="${range.style}"` : '';
    const highlightedText = escapeHtml(text.slice(range.start, range.end)).replace(/ /g, '&nbsp;');
    result += `<span class="${range.className}"${styleAttr}>${highlightedText}</span>`;
    pos = range.end;
  }

  // Add remaining text
  if (pos < text.length) {
    result += escapeHtml(text.slice(pos));
  }

  return result;
}

// Version for JSON content - uses simple escaping without truncation
// JSON content is already validated by JSON.parse, so no sanitization needed
function applyHighlightsWithSearchJson(text: string, searchRanges: SearchRange[]): string {
  interface HighlightRange {
    start: number;
    end: number;
    type: 'search' | 'highlight';
    className: string;
    style?: string;
  }

  const ranges: HighlightRange[] = [];

  // Add search ranges
  for (const sr of searchRanges) {
    const className = sr.isCurrent ? 'search-match current' : 'search-match';
    ranges.push({ start: sr.start, end: sr.end, type: 'search', className });
  }

  // Add manual highlight ranges
  for (const config of state.highlights) {
    try {
      let flags = config.highlightAll ? 'g' : '';
      if (!config.matchCase) flags += 'i';

      let pattern = config.pattern;
      if (!config.isRegex) {
        pattern = escapeRegex(pattern);
      }

      if (config.includeWhitespace) {
        pattern = `(\\s*)${pattern}(\\s*)`;
      }

      if (config.wholeWord && !config.includeWhitespace) {
        pattern = `\\b${pattern}\\b`;
      }

      const regex = new RegExp(pattern, flags || undefined);
      let match;

      const style = `background-color: ${config.backgroundColor}; ${
        config.textColor ? `color: ${config.textColor}` : ''
      }`;

      if (config.highlightAll) {
        while ((match = regex.exec(text)) !== null) {
          ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            type: 'highlight',
            className: 'highlight',
            style,
          });
        }
      } else {
        match = regex.exec(text);
        if (match) {
          ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            type: 'highlight',
            className: 'highlight',
            style,
          });
        }
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // Add search config ranges (enabled configs) - JSON version
  for (const scConfig of state.searchConfigs) {
    if (!scConfig.enabled) continue;
    try {
      let flags = 'g';
      if (!scConfig.matchCase) flags += 'i';
      let pattern = scConfig.pattern;
      if (!scConfig.isRegex) {
        pattern = escapeRegex(pattern);
      }
      if (scConfig.wholeWord) {
        pattern = `\\b${pattern}\\b`;
      }
      const regex = new RegExp(pattern, flags);
      let match;
      const style = `background-color: ${scConfig.color}; ${scConfig.textColor ? `color: ${scConfig.textColor}` : 'color: #000'}`;
      while ((match = regex.exec(text)) !== null) {
        ranges.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'highlight',
          className: 'highlight search-config-highlight',
          style,
        });
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // If no ranges, just escape and return (no sanitization for JSON)
  if (ranges.length === 0) {
    return escapeHtmlSimple(text);
  }

  // Sort and remove overlapping ranges
  ranges.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.type === 'search' ? 1 : -1;
  });

  const finalRanges: HighlightRange[] = [];
  for (const range of ranges) {
    if (range.type === 'search') {
      finalRanges.push(range);
    } else {
      const overlapsSearch = searchRanges.some(
        sr => !(range.end <= sr.start || range.start >= sr.end)
      );
      if (!overlapsSearch) {
        finalRanges.push(range);
      }
    }
  }

  finalRanges.sort((a, b) => a.start - b.start);
  const nonOverlapping: HighlightRange[] = [];
  for (const range of finalRanges) {
    if (nonOverlapping.length === 0 || range.start >= nonOverlapping[nonOverlapping.length - 1].end) {
      nonOverlapping.push(range);
    }
  }

  let result = '';
  let pos = 0;

  for (const range of nonOverlapping) {
    if (range.start > pos) {
      result += escapeHtmlSimple(text.slice(pos, range.start));
    }
    const styleAttr = range.style ? ` style="${range.style}"` : '';
    const highlightedText = escapeHtmlSimple(text.slice(range.start, range.end)).replace(/ /g, '&nbsp;');
    result += `<span class="${range.className}"${styleAttr}>${highlightedText}</span>`;
    pos = range.end;
  }

  if (pos < text.length) {
    result += escapeHtmlSimple(text.slice(pos));
  }

  return result;
}

// Yield to the browser event loop so UI stays responsive during heavy work
function yieldToUI(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function escapeHtml(text: string): string {
  return sanitizeText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Check if character is normal printable text
function isNormalChar(code: number): boolean {
  const isPrintableAscii = code >= 32 && code <= 126;
  const isTab = code === 9;
  const isNewline = code === 10 || code === 13;
  const isLatinExtended = code >= 160 && code <= 255;
  return isPrintableAscii || isTab || isNewline || isLatinExtended;
}

// Sanitize text by detecting and replacing binary/corrupted sections
function sanitizeText(text: string): string {
  // Safety limit for very long lines (corrupted files can have huge "lines")
  // Significantly increased for JSON mode - pretty-printed JSON can be very long
  const MAX_LINE_LENGTH = 500000;
  const MAX_DISPLAY_LENGTH = 500000;

  if (text.length === 0) return text;

  // Truncate extremely long lines
  if (text.length > MAX_LINE_LENGTH) {
    text = text.substring(0, MAX_LINE_LENGTH);
  }

  // First, count non-printable characters to detect if this is mostly binary
  let nonPrintableCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (!isNormalChar(text.charCodeAt(i))) {
      nonPrintableCount++;
    }
  }

  const binaryRatio = nonPrintableCount / text.length;

  // If very few non-printable chars (< 2%), just return as-is
  if (binaryRatio < 0.02) {
    return text.length > MAX_DISPLAY_LENGTH
      ? text.substring(0, MAX_DISPLAY_LENGTH) + '... [truncated]'
      : text;
  }

  // If more than 15% non-printable, this line likely contains binary/corrupted data
  if (binaryRatio > 0.15) {
    // Find where the good text ends and binary begins
    let lastGoodIndex = 0;
    let badCount = 0;

    for (let i = 0; i < text.length; i++) {
      if (!isNormalChar(text.charCodeAt(i))) {
        badCount++;
        // If we've seen 3+ bad chars in recent stretch, binary starts here
        if (badCount >= 3) {
          lastGoodIndex = Math.max(0, i - badCount);
          break;
        }
      } else {
        badCount = 0;
        lastGoodIndex = i + 1;
      }
    }

    const goodPart = text.substring(0, lastGoodIndex);
    if (goodPart.length > 0) {
      return goodPart + ' [binary/corrupted data - ' + (text.length - lastGoodIndex) + ' bytes]';
    } else {
      return '[binary/corrupted data - ' + text.length + ' bytes]';
    }
  }

  // Low ratio of bad chars - just replace them with dots
  let result = '';
  for (let i = 0; i < text.length && result.length < MAX_DISPLAY_LENGTH; i++) {
    const code = text.charCodeAt(i);
    if (isNormalChar(code)) {
      result += text[i];
    } else {
      result += '\u00B7';
    }
  }

  if (text.length > MAX_DISPLAY_LENGTH) {
    result += '... [truncated]';
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimap functions
function updateMinimapViewport(): void {
  if (!logViewerElement || !minimapViewportElement || !minimapElement) return;

  const totalLines = getTotalLines();
  if (totalLines === 0) return;

  const scrollTop = logViewerElement.scrollTop;
  const clientHeight = logViewerElement.clientHeight;
  const minimapHeight = minimapElement.clientHeight;

  // For scaled scroll, use line-based mapping instead of scroll-based
  const currentLine = scrollTopToLine(scrollTop);
  const visibleLines = Math.ceil(clientHeight / getLineHeight());

  const viewportHeight = Math.max(20, (visibleLines / totalLines) * minimapHeight);
  let viewportTop = (currentLine / totalLines) * minimapHeight;

  // Clamp viewport to stay within minimap bounds
  viewportTop = Math.max(0, Math.min(viewportTop, minimapHeight - viewportHeight));

  minimapViewportElement.style.top = `${viewportTop}px`;
  minimapViewportElement.style.height = `${viewportHeight}px`;
}

function handleMinimapClick(event: MouseEvent): void {
  if (!logViewerElement || !minimapElement) return;

  const rect = minimapElement.getBoundingClientRect();
  const clickY = event.clientY - rect.top;
  const minimapHeight = minimapElement.clientHeight;

  // Map click position to line number
  const totalLines = getTotalLines();
  const targetLine = Math.floor((clickY / minimapHeight) * totalLines);
  const targetScrollTop = lineToScrollTop(targetLine);

  logViewerElement.scrollTop = Math.max(0, targetScrollTop);
}

let isDraggingMinimap = false;

function handleMinimapDrag(_event: MouseEvent): void {
  if (!logViewerElement || !minimapElement) return;

  isDraggingMinimap = true;

  const onMouseMove = (e: MouseEvent) => {
    if (!isDraggingMinimap || !logViewerElement || !minimapElement) return;

    const rect = minimapElement.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const minimapHeight = minimapElement.clientHeight;

    // Map drag position to line number
    const totalLines = getTotalLines();
    const targetLine = Math.floor((clickY / minimapHeight) * totalLines);
    const targetScrollTop = lineToScrollTop(targetLine);

    logViewerElement.scrollTop = Math.max(0, targetScrollTop);
  };

  const onMouseUp = () => {
    isDraggingMinimap = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

async function buildMinimap(onProgress?: (percent: number) => void): Promise<void> {
  if (!minimapContentElement || !minimapElement) return;

  const totalLines = getTotalLines();
  if (totalLines === 0) return;

  minimapData = [];
  minimapContentElement.innerHTML = '';

  const minimapHeight = minimapElement.clientHeight;
  // Limit to reasonable number of samples for performance
  const maxSamples = Math.min(300, minimapHeight);
  const sampleRate = Math.max(1, Math.floor(totalLines / maxSamples));

  // Sample lines for minimap
  const samplesToFetch: number[] = [];
  for (let i = 0; i < totalLines; i += sampleRate) {
    samplesToFetch.push(i);
    if (samplesToFetch.length >= maxSamples) break;
  }

  // First, check what we already have in cache
  for (const lineNum of samplesToFetch) {
    const cached = cachedLines.get(lineNum);
    if (cached) {
      minimapData.push({ level: cached.level });
    } else {
      minimapData.push({ level: undefined });
    }
  }

  // Report initial progress
  if (onProgress) onProgress(30);

  // Fetch missing samples in small batches (fetch only 1 line per sample)
  const missingIndices: number[] = [];
  for (let i = 0; i < samplesToFetch.length; i++) {
    if (minimapData[i].level === undefined) {
      missingIndices.push(i);
    }
  }

  if (missingIndices.length > 0) {
    // Batch fetch: group consecutive or nearby samples
    const FETCH_BATCH = 50; // Fetch this many individual lines at a time
    const totalMissingBatches = Math.ceil(missingIndices.length / FETCH_BATCH);

    for (let b = 0; b < missingIndices.length; b += FETCH_BATCH) {
      const batchIndices = missingIndices.slice(b, b + FETCH_BATCH);

      // Fetch each sampled line individually (just 1 line each)
      const fetchPromises = batchIndices.map(async (idx) => {
        const lineNum = samplesToFetch[idx];
        try {
          const result = await window.api.getLines(lineNum, 1);
          if (result.success && result.lines && result.lines.length > 0) {
            const line = result.lines[0];
            minimapData[idx] = { level: line.level };
            cachedLines.set(lineNum, line);
          }
        } catch (e) {
          console.warn('Minimap: failed to fetch line', samplesToFetch[idx], e);
        }
      });

      await Promise.all(fetchPromises);

      // Report progress
      if (onProgress) {
        const batchNum = Math.floor(b / FETCH_BATCH) + 1;
        const percent = 30 + Math.round((batchNum / totalMissingBatches) * 70);
        onProgress(Math.min(percent, 100));
      }
    }
  }

  if (onProgress) onProgress(100);
  renderMinimap();
}

function renderMinimap(): void {
  if (!minimapContentElement || !minimapElement) return;

  const totalLines = getTotalLines();
  if (totalLines === 0 || minimapData.length === 0) return;

  const minimapHeight = minimapElement.clientHeight;
  // Calculate how many actual lines each sample represents
  const linesPerSample = totalLines / minimapData.length;
  // Each minimap line should take proportional height
  const lineHeight = minimapHeight / minimapData.length;

  minimapContentElement.innerHTML = '';

  for (let i = 0; i < minimapData.length; i++) {
    const data = minimapData[i];
    const line = document.createElement('div');
    line.className = `minimap-line level-${data.level || 'default'}`;
    // Use exact height without margin to ensure proper alignment with markers
    line.style.height = `${Math.max(1, lineHeight)}px`;
    minimapContentElement.appendChild(line);
  }

  // Add bookmark markers
  renderMinimapMarkers();
  updateMinimapViewport();
}

function renderMinimapMarkers(): void {
  if (!minimapElement) return;

  // Remove existing markers
  minimapElement.querySelectorAll('.minimap-bookmark, .minimap-search-marker, .minimap-notes-marker, .minimap-sc-marker').forEach(el => el.remove());

  const totalLines = getTotalLines();
  if (totalLines === 0) return;

  const minimapHeight = minimapElement.clientHeight;
  const fragment = document.createDocumentFragment();

  // Add saved notes range markers (drawn first, behind other markers)
  for (const range of state.savedRanges) {
    const marker = document.createElement('div');
    marker.className = 'minimap-notes-marker';
    const top = (range.startLine / totalLines) * minimapHeight;
    const height = Math.max(3, ((range.endLine - range.startLine + 1) / totalLines) * minimapHeight);
    marker.style.top = `${top}px`;
    marker.style.height = `${height}px`;
    marker.title = `Saved: Lines ${range.startLine + 1}-${range.endLine + 1}`;
    fragment.appendChild(marker);
  }

  // Add bookmark markers with colors and tooltips
  const maxBookmarkMarkers = 500;
  const bookmarkStep = Math.max(1, Math.floor(state.bookmarks.length / maxBookmarkMarkers));
  for (let i = 0; i < state.bookmarks.length; i += bookmarkStep) {
    const bookmark = state.bookmarks[i];
    const marker = document.createElement('div');
    marker.className = 'minimap-bookmark';
    marker.style.top = `${(bookmark.lineNumber / totalLines) * minimapHeight}px`;
    if (bookmark.color) {
      marker.style.backgroundColor = bookmark.color;
    }
    marker.title = bookmark.label || `Bookmark: Line ${bookmark.lineNumber + 1}`;
    fragment.appendChild(marker);
  }

  // Add search result markers (limit to prevent performance issues)
  const maxSearchMarkers = 100;
  const searchStep = Math.max(1, Math.floor(state.searchResults.length / maxSearchMarkers));
  for (let i = 0; i < state.searchResults.length; i += searchStep) {
    const result = state.searchResults[i];
    const marker = document.createElement('div');
    marker.className = 'minimap-search-marker';
    const markerPos = state.isFiltered && result.displayIndex != null
      ? result.displayIndex : result.lineNumber;
    marker.style.top = `${(markerPos / totalLines) * minimapHeight}px`;
    fragment.appendChild(marker);
  }

  // Add search config markers (colored by config)
  for (const config of state.searchConfigs) {
    if (!config.enabled) continue;
    const results = state.searchConfigResults.get(config.id) || [];
    const maxScMarkers = 50;
    const scStep = Math.max(1, Math.floor(results.length / maxScMarkers));
    for (let i = 0; i < results.length; i += scStep) {
      const r = results[i];
      const marker = document.createElement('div');
      marker.className = 'minimap-sc-marker';
      const scMarkerPos = state.isFiltered && r.displayIndex != null
        ? r.displayIndex : r.lineNumber;
      marker.style.top = `${(scMarkerPos / totalLines) * minimapHeight}px`;
      marker.style.backgroundColor = config.color;
      fragment.appendChild(marker);
    }
  }

  minimapElement.appendChild(fragment);
}

function handleLogClick(event: MouseEvent): void {
  // Ignore right-clicks (they're handled by contextmenu)
  if (event.button === 2) {
    return;
  }

  const target = event.target as HTMLElement;
  const lineElement = target.closest('.log-line') as HTMLDivElement;

  if (lineElement) {
    const lineNumber = parseInt(lineElement.dataset.lineNumber || '0', 10);

    // Shift+Click for range selection (takes priority over text selection)
    if (event.shiftKey && state.selectedLine !== null) {
      // Clear browser text selection
      window.getSelection()?.removeAllRanges();
      const start = Math.min(state.selectedLine, lineNumber);
      const end = Math.max(state.selectedLine, lineNumber);
      state.selectionStart = start;
      state.selectionEnd = end;
      renderVisibleLines();
      updateSelectionStatus();
      return;
    }

    // Don't interfere with text selection (for non-shift clicks)
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    // Clear range selection on regular click
    state.selectionStart = null;
    state.selectionEnd = null;

    // Only re-render if selection changed
    if (state.selectedLine !== lineNumber) {
      state.selectedLine = lineNumber;
      // Auto-populate search start line with clicked line
      elements.searchStartLine.value = String(lineNumber + 1);
      updateCursorStatus(lineNumber);
      renderVisibleLines();

      // Sync video player if visible and synced
      if (state.activeBottomTab === 'video' && state.videoFilePath && state.videoSyncOffsetMs) {
        syncVideoToLine(lineNumber);
      }
    }
  }
}

function handleContextMenu(event: MouseEvent): void {
  event.preventDefault();

  const target = event.target as HTMLElement;
  const lineElement = target.closest('.log-line') as HTMLDivElement;

  if (!lineElement) return;

  const lineNumber = parseInt(lineElement.dataset.lineNumber || '0', 10);

  // Get selected text
  const selection = window.getSelection();
  const selectedText = selection?.toString() || '';

  // Remove existing context menu
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  // Helper to create menu item with icon
  function menuItem(icon: string, text: string, className?: string): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'context-menu-item' + (className ? ' ' + className : '');
    const iconEl = document.createElement('span');
    iconEl.className = 'context-menu-icon';
    iconEl.textContent = icon;
    item.appendChild(iconEl);
    const label = document.createElement('span');
    label.textContent = text;
    item.appendChild(label);
    return item;
  }

  function menuSeparator(): HTMLDivElement {
    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    return sep;
  }

  // If text is selected, show highlight option
  if (selectedText) {
    const displayText = selectedText.trim();
    const highlightAll = menuItem('\u{1F58C}', `Highlight "${displayText.substring(0, 20)}${displayText.length > 20 ? '...' : ''}"`);
    highlightAll.addEventListener('click', () => {
      createHighlightFromSelection(selectedText, true);
      menu.remove();
    });
    menu.appendChild(highlightAll);

    menu.appendChild(menuSeparator());

    const copySelection = menuItem('\u{1F4CB}', 'Copy Selection');
    copySelection.addEventListener('click', () => {
      navigator.clipboard.writeText(selectedText);
      menu.remove();
    });
    menu.appendChild(copySelection);

    menu.appendChild(menuSeparator());
  }

  // Save to Notes - check for text selection across lines, Shift+click range, or single line
  let saveStartLine = lineNumber;
  let saveEndLine = lineNumber;

  // First, check if there's a text selection spanning multiple lines
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const startLineEl = (range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer as Element)?.closest('.log-line') as HTMLDivElement | null;
    const endLineEl = (range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : range.endContainer as Element)?.closest('.log-line') as HTMLDivElement | null;

    if (startLineEl && endLineEl) {
      const startLineNum = parseInt(startLineEl.dataset.lineNumber || '0', 10);
      const endLineNum = parseInt(endLineEl.dataset.lineNumber || '0', 10);
      if (startLineNum !== endLineNum || selectedText) {
        // Text selection spans lines or there's selected text on a single line
        saveStartLine = Math.min(startLineNum, endLineNum);
        saveEndLine = Math.max(startLineNum, endLineNum);
      }
    }
  }

  // If no text selection range, check for Shift+click range selection
  if (saveStartLine === saveEndLine && state.selectionStart !== null && state.selectionEnd !== null) {
    saveStartLine = state.selectionStart;
    saveEndLine = state.selectionEnd;
  }

  const lineCount = saveEndLine - saveStartLine + 1;

  const saveToNotesItem = menuItem('\u{1F4DD}', lineCount === 1 ? `Save Snippet` : `Save ${lineCount} Lines as Snippet`);
  saveToNotesItem.addEventListener('click', () => {
    menu.remove();
    saveToNotesWithRange(saveStartLine, saveEndLine);
  });
  menu.appendChild(saveToNotesItem);

  menu.appendChild(menuSeparator());

  // Range selection items
  const rangeFromItem = menuItem('\u{2194}', rangeSelectStartLine !== null ? 'Range from here (reset)' : 'Range from here');
  rangeFromItem.addEventListener('click', () => {
    rangeSelectStartLine = lineNumber;
    state.selectionStart = lineNumber;
    state.selectionEnd = lineNumber;
    renderVisibleLines();
    elements.statusCursor.textContent = `Range: from Ln ${lineNumber + 1} — right-click end line...`;
    menu.remove();
  });
  menu.appendChild(rangeFromItem);

  if (rangeSelectStartLine !== null && rangeSelectStartLine !== lineNumber) {
    const rangeToItem = menuItem('\u{2194}', 'Range to here');
    rangeToItem.addEventListener('click', () => {
      const start = Math.min(rangeSelectStartLine!, lineNumber);
      const end = Math.max(rangeSelectStartLine!, lineNumber);
      state.selectionStart = start;
      state.selectionEnd = end;
      renderVisibleLines();
      rangeSelectStartLine = null;
      menu.remove();
      saveToNotesWithRange(start, end);
      elements.statusCursor.textContent = `Range: Ln ${start + 1}–${end + 1} (${end - start + 1} lines)`;
    });
    menu.appendChild(rangeToItem);
  }

  menu.appendChild(menuSeparator());

  const hasBookmark = state.bookmarks.some((b) => b.lineNumber === lineNumber);

  if (hasBookmark) {
    const removeBookmark = menuItem('\u{1F516}', 'Remove Bookmark', 'danger');
    removeBookmark.addEventListener('click', () => {
      removeBookmarkAtLine(lineNumber);
      menu.remove();
    });
    menu.appendChild(removeBookmark);
  } else {
    const addBookmark = menuItem('\u{1F516}', 'Add Bookmark');
    addBookmark.addEventListener('click', () => {
      addBookmarkAtLine(lineNumber);
      menu.remove();
    });
    menu.appendChild(addBookmark);

    // If text is selected, offer "Bookmark with title" using selection as label
    if (selectedText.trim()) {
      const trimmedTitle = selectedText.trim().substring(0, 50);
      const bookmarkWithTitle = menuItem('\u{1F3F7}', `Bookmark as "${trimmedTitle}${selectedText.trim().length > 50 ? '...' : ''}"`);
      bookmarkWithTitle.addEventListener('click', () => {
        addBookmarkAtLineWithLabel(lineNumber, selectedText.trim());
        menu.remove();
      });
      menu.appendChild(bookmarkWithTitle);
    }
  }

  // Filter from selection — add to include/exclude patterns
  if (selectedText.trim()) {
    menu.appendChild(menuSeparator());

    const filterText = selectedText.trim().substring(0, 30);
    const filterInclude = menuItem('\u{2795}', `Include: "${filterText}${selectedText.trim().length > 30 ? '...' : ''}"`);
    filterInclude.addEventListener('click', () => {
      addToFilterPattern(selectedText.trim(), 'include');
      menu.remove();
    });
    menu.appendChild(filterInclude);

    const filterExclude = menuItem('\u{2796}', `Exclude: "${filterText}${selectedText.trim().length > 30 ? '...' : ''}"`);
    filterExclude.addEventListener('click', () => {
      addToFilterPattern(selectedText.trim(), 'exclude');
      menu.remove();
    });
    menu.appendChild(filterExclude);
  }

  menu.appendChild(menuSeparator());

  const copyLine = menuItem('\u{1F4CB}', 'Copy Line');
  copyLine.addEventListener('click', () => {
    const line = cachedLines.get(lineNumber);
    if (line) {
      navigator.clipboard.writeText(applyColumnFilter(line.text));
    }
    menu.remove();
  });
  menu.appendChild(copyLine);

  menu.appendChild(menuSeparator());

  const searchFromHere = menuItem('\u{1F50D}', `Search from Ln ${lineNumber + 1}`);
  searchFromHere.addEventListener('click', () => {
    elements.searchStartLine.value = String(lineNumber + 1);
    elements.searchInput.focus();
    elements.searchInput.select();
    menu.remove();
  });
  menu.appendChild(searchFromHere);

  document.body.appendChild(menu);

  // Close on click outside
  const closeMenu = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

async function commitHighlight(highlight: HighlightConfig): Promise<boolean> {
  const result = await window.api.addHighlight(highlight);
  if (result.success) {
    state.highlights.push(highlight);
    activeHighlightGroupId = null;
    updateHighlightGroupsUI();
    updateHighlightsUI();
    renderVisibleLines();
    return true;
  }
  return false;
}

async function createHighlightFromSelection(text: string, highlightAll: boolean): Promise<void> {
  // Check for duplicate pattern — if it exists, remove it instead (toggle)
  const existing = state.highlights.find(h => h.pattern === text && !h.isRegex);
  if (existing) {
    const result = await window.api.removeHighlight(existing.id);
    if (result.success) {
      state.highlights = state.highlights.filter(h => h.id !== existing.id);
      activeHighlightGroupId = null;
      updateHighlightGroupsUI();
      updateHighlightsUI();
      renderVisibleLines();
    }
    return;
  }

  // Get next auto-assigned color
  const colorResult = await window.api.getNextHighlightColor();
  const backgroundColor = colorResult.success && colorResult.color ? colorResult.color : '#ffff00';

  await commitHighlight({
    id: `highlight-${Date.now()}`,
    pattern: text,
    isRegex: false,
    matchCase: true,
    wholeWord: false,
    backgroundColor,
    textColor: '#000000',
    includeWhitespace: false,
    highlightAll,
  });
}

async function saveSelectedLinesToFile(): Promise<void> {
  if (state.selectionStart === null || state.selectionEnd === null) {
    alert('No lines selected. Use Shift+Click to select a range of lines.');
    return;
  }

  const colConfig = state.columnConfig && state.columnConfig.columns.some(c => !c.visible)
    ? { delimiter: state.columnConfig.delimiter, columns: state.columnConfig.columns.map(c => ({ index: c.index, visible: c.visible })) }
    : undefined;
  const result = await window.api.saveSelectedLines(state.selectionStart, state.selectionEnd, colConfig);

  if (result.success) {
    alert(`Saved ${result.lineCount} lines to:\n${result.filePath}`);
    // Clear selection after saving
    state.selectionStart = null;
    state.selectionEnd = null;
    renderVisibleLines();
  } else {
    alert(`Failed to save: ${result.error}`);
  }
}

// Notes modal state
interface NotesModalResult {
  note: string;
  targetFilePath: string | null; // null means create new file
}
let pendingNotesResolve: ((result: NotesModalResult | null) => void) | null = null;
let selectedNotesFilePath: string | null = null;

async function showNotesModal(startLine: number, endLine: number): Promise<NotesModalResult | null> {
  // Fetch existing notes files for the current log
  const existingFiles = await window.api.findNotesFiles();
  const filesList = existingFiles.success && existingFiles.files ? existingFiles.files : [];

  // Check if current notes file still exists in the list
  const currentFileExists = filesList.some(f => f.path === state.currentNotesFile);

  // Determine which option should be selected
  // If we have a valid current notes file, use it; otherwise default to "Create new"
  const selectedPath = currentFileExists ? state.currentNotesFile : null;
  selectedNotesFilePath = selectedPath;

  // Populate file options
  let optionsHtml = `
    <label class="radio-option">
      <input type="radio" name="notes-file" value="new" ${selectedPath === null ? 'checked' : ''}>
      <span>Create new snippet file</span>
    </label>
  `;

  for (const file of filesList) {
    const isSelected = selectedPath === file.path;
    optionsHtml += `
      <label class="radio-option">
        <input type="radio" name="notes-file" value="${file.path}" ${isSelected ? 'checked' : ''}>
        <span title="${file.path}">${file.name} <span class="hint">(${file.created})</span></span>
      </label>
    `;
  }

  elements.notesFileOptions.innerHTML = optionsHtml;

  // Add change listener
  const radioInputs = elements.notesFileOptions.querySelectorAll('input[type="radio"]');
  radioInputs.forEach((input) => {
    input.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      selectedNotesFilePath = target.value === 'new' ? null : target.value;
    });
  });

  return new Promise((resolve) => {
    pendingNotesResolve = resolve;
    const lineCount = endLine - startLine + 1;
    elements.notesDescription.value = '';
    elements.notesLineInfo.textContent = lineCount === 1
      ? `Line ${startLine + 1}`
      : `Lines ${startLine + 1}-${endLine + 1} (${lineCount} lines)`;
    elements.notesModal.classList.remove('hidden');
    elements.notesDescription.focus();
  });
}

function hideNotesModal(save: boolean): void {
  elements.notesModal.classList.add('hidden');

  if (pendingNotesResolve) {
    if (save) {
      pendingNotesResolve({
        note: elements.notesDescription.value,
        targetFilePath: selectedNotesFilePath,
      });
    } else {
      pendingNotesResolve(null);
    }
    pendingNotesResolve = null;
  }

  elements.notesDescription.value = '';
  selectedNotesFilePath = null;
}

async function saveToNotesWithRange(startLine: number, endLine: number): Promise<void> {
  const modalResult = await showNotesModal(startLine, endLine);
  if (modalResult === null) return; // User cancelled

  const colConfig = state.columnConfig && state.columnConfig.columns.some(c => !c.visible)
    ? { delimiter: state.columnConfig.delimiter, columns: state.columnConfig.columns.map(c => ({ index: c.index, visible: c.visible })) }
    : undefined;
  const result = await window.api.saveToNotes(
    startLine,
    endLine,
    modalResult.note || undefined,
    modalResult.targetFilePath || undefined,
    colConfig
  );

  if (result.success) {
    // Remember the selected notes file for this session
    if (result.filePath) {
      state.currentNotesFile = result.filePath;
    }

    // Track saved range for minimap
    state.savedRanges.push({ startLine, endLine });
    renderMinimapMarkers();

    // Clear selection after saving
    state.selectionStart = null;
    state.selectionEnd = null;
    renderVisibleLines();

    // Handle notes file tab
    if (result.filePath) {
      const existingTab = findTabByFilePath(result.filePath);
      if (!existingTab) {
        // Open as new tab but don't switch to it
        await loadFileAsInactiveTab(result.filePath);
      } else if (existingTab.id === state.activeTabId) {
        // Notes tab is currently active - refresh it
        await refreshActiveTab();
      } else {
        // Notes tab exists but is inactive - mark for reload when switched to
        existingTab.isLoaded = false;
        existingTab.totalLines = 0;
        existingTab.cachedLines.clear();
      }
    }
  } else {
    alert(`Failed to save: ${result.error}`);
  }
}

async function saveToNotes(): Promise<void> {
  if (state.selectionStart === null || state.selectionEnd === null) {
    alert('No lines selected. Use Shift+Click to select a range of lines.');
    return;
  }
  await saveToNotesWithRange(state.selectionStart, state.selectionEnd);
}

// File Operations
async function openFile(): Promise<void> {
  const filePath = await window.api.openFileDialog();
  if (!filePath) return;

  await loadFile(filePath);
}

// === Folder Operations ===

async function openFolder(): Promise<void> {
  const folderPath = await window.api.openFolderDialog();
  if (!folderPath) return;

  // Check if folder already open
  if (state.folders.some((f) => f.path === folderPath)) {
    return;
  }

  const result = await window.api.readFolder(folderPath);
  if (result.success && result.files) {
    const folderName = folderPath.split('/').pop() || folderPath;
    state.folders.push({
      path: folderPath,
      name: folderName,
      files: result.files.map((f) => ({ name: f.name, path: f.path, size: f.size })),
      collapsed: false,
    });
    renderFolderTree();
    updateFolderSearchState();
  }
}

function removeFolder(folderPath: string): void {
  state.folders = state.folders.filter((f) => f.path !== folderPath);
  renderFolderTree();
  updateFolderSearchState();
  if (state.folders.length === 0) {
    closeFolderSearchResults();
  }
}

function toggleFolder(folderPath: string): void {
  const folder = state.folders.find((f) => f.path === folderPath);
  if (folder) {
    folder.collapsed = !folder.collapsed;
    renderFolderTree();
  }
}

async function refreshFolders(): Promise<void> {
  if (state.folders.length === 0) return;

  // Show refreshing state
  elements.btnRefreshFolders.disabled = true;
  elements.btnRefreshFolders.textContent = '⟳';

  try {
    // Re-read each folder while preserving collapsed state
    for (const folder of state.folders) {
      const result = await window.api.readFolder(folder.path);
      if (result.success && result.files) {
        folder.files = result.files.map((f) => ({
          name: f.name,
          path: f.path,
          size: f.size,
        }));
      }
    }
    renderFolderTree();
  } finally {
    elements.btnRefreshFolders.disabled = false;
    elements.btnRefreshFolders.innerHTML = '&#8635;';
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFolderTree(): void {
  if (state.folders.length === 0) {
    elements.foldersList.innerHTML = '<p class="placeholder">No folders open</p>';
    return;
  }

  elements.foldersList.innerHTML = state.folders
    .map(
      (folder) => `
      <div class="folder-group ${folder.collapsed ? 'collapsed' : ''}${folder.isRemote ? ' remote' : ''}" data-path="${folder.path}" ${folder.isRemote ? 'data-remote="true"' : ''}>
        <div class="folder-header">
          <span class="folder-toggle">&#9660;</span>
          <span class="folder-name" title="${folder.path}">${folder.isRemote ? '<span class="ssh-badge">SSH</span> ' : ''}${escapeHtml(folder.name)}</span>
          <button class="folder-close" title="Remove folder">&times;</button>
        </div>
        <div class="folder-files">
          ${
            folder.files.length === 0
              ? '<div class="placeholder" style="padding: 4px 0; font-size: 11px;">No files</div>'
              : folder.files
                  .map(
                    (file) => `
              <div class="folder-file ${file.path === state.filePath ? 'active' : ''}" data-path="${escapeHtml(file.path)}" ${folder.isRemote ? 'data-remote="true"' : ''}>
                <span class="folder-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                ${file.size ? `<span class="folder-file-size">${formatFileSize(file.size)}</span>` : ''}
              </div>
            `
                  )
                  .join('')
          }
        </div>
      </div>
    `
    )
    .join('');

  // Add event listeners
  elements.foldersList.querySelectorAll('.folder-header').forEach((header) => {
    const folderPath = (header.closest('.folder-group') as HTMLElement)?.dataset.path;
    if (!folderPath) return;

    // Toggle collapse
    header.querySelector('.folder-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolder(folderPath);
    });
    header.querySelector('.folder-name')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolder(folderPath);
    });

    // Remove folder
    header.querySelector('.folder-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFolder(folderPath);
    });
  });

  // File click to open
  elements.foldersList.querySelectorAll('.folder-file').forEach((fileEl) => {
    fileEl.addEventListener('click', async () => {
      const filePath = (fileEl as HTMLElement).dataset.path;
      const isRemote = (fileEl as HTMLElement).dataset.remote === 'true';
      if (filePath) {
        if (isRemote) {
          // Download remote file first, then open
          const result = await window.api.sshDownloadFile(filePath);
          if (result.success && result.localPath) {
            await loadFile(result.localPath);
          } else {
            alert(`Failed to download: ${result.error}`);
          }
        } else {
          await loadFile(filePath);
        }
        renderFolderTree(); // Update active state
      }
    });
    // Right-click context menu on folder tree files
    fileEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const filePath = (fileEl as HTMLElement).dataset.path;
      if (filePath) {
        showFileContextMenu(e as MouseEvent, filePath);
      }
    });
  });
}

// === Folder Search ===

function updateFolderSearchState(): void {
  const hasFolders = state.folders.length > 0;
  elements.folderSearchInput.disabled = !hasFolders;
  elements.btnFolderSearch.disabled = !hasFolders;
}

async function performFolderSearch(): Promise<void> {
  const pattern = elements.folderSearchInput.value.trim();
  if (!pattern || state.folders.length === 0) return;

  state.isFolderSearching = true;
  state.folderSearchResults = [];

  elements.btnFolderSearch.classList.add('hidden');
  elements.btnFolderSearchCancel.classList.remove('hidden');
  elements.folderSearchResults.classList.remove('hidden');
  elements.folderSearchResults.innerHTML = '<div class="folder-search-searching">Searching...</div>';

  const unsubscribe = window.api.onFolderSearchProgress((data) => {
    if (state.isFolderSearching) {
      elements.folderSearchResults.innerHTML = `<div class="folder-search-searching">Searching... ${data.matchCount} matches found</div>`;
    }
  });

  try {
    const folderPaths = state.folders.map(f => f.path);
    const result = await window.api.folderSearch(folderPaths, pattern, { isRegex: false, matchCase: false });

    if (result.success && result.matches) {
      state.folderSearchResults = result.matches;
      renderFolderSearchResults(pattern, result.cancelled);
    } else {
      elements.folderSearchResults.innerHTML = `<div class="folder-search-searching">${result.error || 'Search failed'}</div>`;
    }
  } catch (error) {
    elements.folderSearchResults.innerHTML = `<div class="folder-search-searching">Error: ${error}</div>`;
  } finally {
    unsubscribe();
    state.isFolderSearching = false;
    elements.btnFolderSearch.classList.remove('hidden');
    elements.btnFolderSearchCancel.classList.add('hidden');
  }
}

function cancelFolderSearch(): void {
  if (state.isFolderSearching) {
    window.api.cancelFolderSearch();
  }
}

function closeFolderSearchResults(): void {
  state.folderSearchResults = [];
  elements.folderSearchResults.classList.add('hidden');
  elements.folderSearchResults.innerHTML = '';
}

function highlightMatch(text: string, pattern: string): string {
  const escaped = escapeHtml(text);
  const patternEscaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${patternEscaped})`, 'gi');
  return escaped.replace(regex, '<span class="folder-search-match">$1</span>');
}

function renderFolderSearchResults(pattern: string, cancelled?: boolean): void {
  const matches = state.folderSearchResults;

  if (matches.length === 0) {
    elements.folderSearchResults.innerHTML = '<div class="folder-search-searching">No matches found</div>';
    return;
  }

  const header = `
    <div class="folder-search-header">
      <span>${matches.length}${cancelled ? '+' : ''} match${matches.length !== 1 ? 'es' : ''}</span>
      <button class="folder-search-close" title="Close">&times;</button>
    </div>
  `;

  const items = matches.map((match, index) => {
    const relPath = match.filePath;
    const lineText = match.lineText.length > 200 ? match.lineText.substring(0, 200) + '...' : match.lineText;

    return `
      <div class="folder-search-item" data-index="${index}">
        <span class="folder-search-file">${escapeHtml(match.fileName)}</span>:<span class="folder-search-line">${match.lineNumber}</span>: <span class="folder-search-text">${highlightMatch(lineText, pattern)}</span>
      </div>
    `;
  }).join('');

  elements.folderSearchResults.innerHTML = header + items;

  // Add event listeners
  elements.folderSearchResults.querySelector('.folder-search-close')?.addEventListener('click', closeFolderSearchResults);

  elements.folderSearchResults.querySelectorAll('.folder-search-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const index = parseInt((item as HTMLElement).dataset.index || '0', 10);
      const match = state.folderSearchResults[index];
      if (match) {
        await loadFile(match.filePath);
        goToLine(match.lineNumber - 1); // Convert to 0-based
      }
    });
  });
}

// === Terminal (tabbed, multi-session) ===

const TERMINAL_THEME = {
  background: 'rgba(30, 30, 30, 0)',
  foreground: '#cccccc',
  cursor: '#cccccc',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#f5f543',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#cccccc',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

async function initTerminal(): Promise<void> {
  if (state.terminalInitialized) return;

  // Register global data/exit routing (once)
  terminalDataUnsubscribe = window.api.onTerminalData((sessionId: string, data: string) => {
    const tab = terminalTabs.get(sessionId);
    if (tab) tab.terminal.write(data);
  });

  terminalExitUnsubscribe = window.api.onTerminalExit((sessionId: string, exitCode: number) => {
    const tab = terminalTabs.get(sessionId);
    if (!tab) return;
    tab.alive = false;
    tab.terminal.writeln(`\r\n[Process exited with code ${exitCode}]`);
    tab.terminal.writeln('Press any key to restart...');
    const restartHandler = tab.terminal.onKey(() => {
      restartHandler.dispose();
      restartTerminalTab(tab.id);
    });
    updateTerminalTabButton(sessionId, tab.label + ' (exited)');
  });

  // "+" button click
  elements.terminalTabAdd.addEventListener('click', (e) => {
    e.stopPropagation();
    showTerminalNewTabMenu();
  });

  // Handle window resize
  window.addEventListener('resize', () => fitTerminalToPanel());

  // Click container to focus active tab
  elements.terminalContainer.addEventListener('click', () => {
    const tab = state.activeTerminalTabId ? terminalTabs.get(state.activeTerminalTabId) : null;
    tab?.terminal?.focus();
  });

  state.terminalInitialized = true;

  // Create first local tab
  await createTerminalTab('local');
}

function generateSessionId(): string {
  return 'ts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

async function createTerminalTab(
  type: 'local' | 'ssh',
  sshOptions?: { liveConnectionId?: string; savedConnectionId?: string; sshConfig?: any }
): Promise<void> {
  // @ts-ignore
  const Terminal = window.Terminal;
  // @ts-ignore
  const FitAddon = window.FitAddon;
  if (!Terminal || !FitAddon) return;

  const sessionId = generateSessionId();

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: "'SF Mono', 'Consolas', 'Monaco', monospace",
    allowProposedApi: true,
    allowTransparency: true,
    theme: TERMINAL_THEME,
  });

  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);

  // Create container div
  const container = document.createElement('div');
  container.className = 'terminal-tab-content';
  container.dataset.sessionId = sessionId;
  elements.terminalContainer.appendChild(container);
  term.open(container);

  // Wire input
  term.onData((data: string) => {
    window.api.terminalWrite(sessionId, data);
  });

  // Copy/paste/select-all handler
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.type === 'keydown') {
      if (e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (e.key === 'v') {
        navigator.clipboard.readText().then((text: string) => {
          window.api.terminalWrite(sessionId, text);
        });
        return false;
      }
      if (e.key === 'a') {
        term.selectAll();
        return false;
      }
    }
    return true;
  });

  const label = type === 'local' ? 'Local' : 'SSH';

  const tab: TerminalTab = {
    id: sessionId,
    type,
    label,
    terminal: term,
    fitAddon: fit,
    containerEl: container,
    alive: true,
  };

  terminalTabs.set(sessionId, tab);
  addTerminalTabButton(tab);
  switchTerminalTab(sessionId);

  // Start backend
  const dims = fit.proposeDimensions();
  const cols = dims?.cols || 80;
  const rows = dims?.rows || 24;

  if (type === 'local') {
    let cwd: string | undefined;
    if (state.filePath) {
      const lastSlash = state.filePath.lastIndexOf('/');
      if (lastSlash > 0) cwd = state.filePath.substring(0, lastSlash);
    }
    const result = await window.api.terminalCreateLocal(sessionId, { cwd, cols, rows });
    if (result.label) {
      tab.label = result.label;
      updateTerminalTabButton(sessionId, result.label);
    }
  } else {
    const result = await window.api.terminalCreateSsh(sessionId, { ...sshOptions, cols, rows });
    if (!result.success) {
      term.writeln(`\r\n[SSH connection failed: ${result.error}]`);
      tab.alive = false;
      return;
    }
    if (result.label) {
      tab.label = result.label;
      updateTerminalTabButton(sessionId, result.label);
    }
  }
}

async function restartTerminalTab(sessionId: string): Promise<void> {
  const tab = terminalTabs.get(sessionId);
  if (!tab) return;
  tab.terminal.clear();
  tab.alive = true;
  updateTerminalTabButton(sessionId, tab.label.replace(' (exited)', ''));

  const dims = tab.fitAddon.proposeDimensions();
  const cols = dims?.cols || 80;
  const rows = dims?.rows || 24;

  // Kill old session first
  await window.api.terminalKill(sessionId);

  if (tab.type === 'local') {
    let cwd: string | undefined;
    if (state.filePath) {
      const lastSlash = state.filePath.lastIndexOf('/');
      if (lastSlash > 0) cwd = state.filePath.substring(0, lastSlash);
    }
    await window.api.terminalCreateLocal(sessionId, { cwd, cols, rows });
  }
  // For SSH tabs, user needs to create a new tab since connection state may be stale
}

function addTerminalTabButton(tab: TerminalTab): void {
  const btn = document.createElement('div');
  btn.className = 'terminal-tab-btn';
  btn.dataset.sessionId = tab.id;
  const icon = tab.type === 'ssh' ? '&#8689;' : '$';
  btn.innerHTML = `<span class="terminal-tab-icon">${icon}</span><span class="terminal-tab-label">${escapeHtml(tab.label)}</span><span class="terminal-tab-close" title="Close">&times;</span>`;

  btn.querySelector('.terminal-tab-close')!.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTerminalTab(tab.id);
  });
  btn.addEventListener('click', () => switchTerminalTab(tab.id));

  elements.terminalTabBar.insertBefore(btn, elements.terminalTabAdd);
}

function updateTerminalTabButton(sessionId: string, label: string): void {
  const btn = elements.terminalTabBar.querySelector(`[data-session-id="${sessionId}"]`);
  if (btn) {
    const labelEl = btn.querySelector('.terminal-tab-label');
    if (labelEl) labelEl.textContent = label;
  }
}

function switchTerminalTab(sessionId: string): void {
  // Hide all tab contents
  elements.terminalContainer.querySelectorAll('.terminal-tab-content').forEach(el => {
    (el as HTMLElement).classList.remove('active');
  });
  // Deactivate all tab buttons
  elements.terminalTabBar.querySelectorAll('.terminal-tab-btn').forEach(el => {
    (el as HTMLElement).classList.remove('active');
  });

  const tab = terminalTabs.get(sessionId);
  if (!tab) return;

  tab.containerEl.classList.add('active');
  const btn = elements.terminalTabBar.querySelector(`[data-session-id="${sessionId}"]`);
  if (btn) btn.classList.add('active');

  state.activeTerminalTabId = sessionId;

  // Fit and focus
  requestAnimationFrame(() => {
    tab.fitAddon.fit();
    const dims = tab.fitAddon.proposeDimensions();
    if (dims) {
      window.api.terminalResize(sessionId, dims.cols, dims.rows);
    }
    tab.terminal.focus();
  });
}

async function closeTerminalTab(sessionId: string): Promise<void> {
  const tab = terminalTabs.get(sessionId);
  if (!tab) return;

  await window.api.terminalKill(sessionId);
  tab.terminal.dispose();
  tab.containerEl.remove();
  terminalTabs.delete(sessionId);

  // Remove tab button
  const btn = elements.terminalTabBar.querySelector(`[data-session-id="${sessionId}"]`);
  if (btn) btn.remove();

  // Switch to another tab or close overlay
  if (terminalTabs.size > 0) {
    const nextTab = terminalTabs.keys().next().value;
    if (nextTab) switchTerminalTab(nextTab);
  } else {
    closeTerminal();
  }
}

let terminalNewTabMenu: HTMLDivElement | null = null;

function showTerminalNewTabMenu(): void {
  // Close existing menu if open
  if (terminalNewTabMenu) {
    terminalNewTabMenu.remove();
    terminalNewTabMenu = null;
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'terminal-new-tab-menu';

  // Local shell option
  const localItem = document.createElement('div');
  localItem.className = 'terminal-new-tab-item';
  localItem.textContent = '$ Local Shell';
  localItem.addEventListener('click', () => {
    menu.remove();
    terminalNewTabMenu = null;
    createTerminalTab('local');
  });
  menu.appendChild(localItem);

  // SSH from live connections
  const sshLiveConns: Array<{ id: string; name: string }> = [];
  for (const [id, conn] of state.liveConnections) {
    if (conn.source === 'ssh' && conn.connected) {
      sshLiveConns.push({ id, name: conn.displayName });
    }
  }

  if (sshLiveConns.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'terminal-new-tab-separator';
    menu.appendChild(sep);

    const header = document.createElement('div');
    header.className = 'terminal-new-tab-header';
    header.textContent = 'SSH (Live Connections)';
    menu.appendChild(header);

    for (const conn of sshLiveConns) {
      const item = document.createElement('div');
      item.className = 'terminal-new-tab-item';
      item.textContent = `↗ ${conn.name}`;
      item.addEventListener('click', () => {
        menu.remove();
        terminalNewTabMenu = null;
        createTerminalTab('ssh', { liveConnectionId: conn.id });
      });
      menu.appendChild(item);
    }
  }

  // SSH from saved connections (loaded async)
  window.api.connectionList().then((result: any) => {
    if (!result.success || !result.connections) return;
    const sshSaved = result.connections.filter((c: any) => c.source === 'ssh');
    if (sshSaved.length === 0) return;

    const sep = document.createElement('div');
    sep.className = 'terminal-new-tab-separator';
    menu.appendChild(sep);

    const header = document.createElement('div');
    header.className = 'terminal-new-tab-header';
    header.textContent = 'SSH (Saved)';
    menu.appendChild(header);

    for (const saved of sshSaved) {
      const item = document.createElement('div');
      item.className = 'terminal-new-tab-item';
      item.textContent = `↗ ${saved.name}`;
      item.addEventListener('click', () => {
        menu.remove();
        terminalNewTabMenu = null;
        createTerminalTab('ssh', { savedConnectionId: saved.id });
      });
      menu.appendChild(item);
    }
  });

  // Position menu below the "+" button using fixed positioning (avoids overflow clipping)
  const addRect = elements.terminalTabAdd.getBoundingClientRect();
  menu.style.left = `${addRect.left}px`;
  menu.style.top = `${addRect.bottom + 2}px`;
  document.body.appendChild(menu);
  terminalNewTabMenu = menu;

  // Close on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== elements.terminalTabAdd) {
      menu.remove();
      terminalNewTabMenu = null;
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function showTerminalOverlay(): void {
  const overlay = elements.terminalOverlay;
  overlay.classList.remove('hidden');
  void overlay.offsetHeight;
  overlay.classList.add('visible');
  elements.btnTerminalToggle.classList.add('active');

  const panel = overlay.querySelector('.terminal-drop-panel') as HTMLElement;
  if (panel) {
    const onShown = () => {
      panel.removeEventListener('transitionend', onShown);
      fitTerminalToPanel();
      const tab = state.activeTerminalTabId ? terminalTabs.get(state.activeTerminalTabId) : null;
      tab?.terminal?.focus();
    };
    panel.addEventListener('transitionend', onShown);
  }
}

function hideTerminalOverlay(): void {
  const overlay = elements.terminalOverlay;
  overlay.classList.remove('visible');
  elements.btnTerminalToggle.classList.remove('active');
  const fallback = setTimeout(() => hide(), 350);
  const hide = () => {
    clearTimeout(fallback);
    overlay.removeEventListener('transitionend', onEnd);
    if (!overlay.classList.contains('visible')) {
      overlay.classList.add('hidden');
    }
  };
  const onEnd = () => hide();
  overlay.addEventListener('transitionend', onEnd);
}

function fitTerminalToPanel(): void {
  if (!state.terminalVisible || !state.activeTerminalTabId) return;
  const tab = terminalTabs.get(state.activeTerminalTabId);
  if (!tab) return;
  tab.fitAddon.fit();
  const dims = tab.fitAddon.proposeDimensions();
  if (dims) {
    window.api.terminalResize(tab.id, dims.cols, dims.rows);
  }
}

async function toggleTerminal(): Promise<void> {
  state.terminalVisible = !state.terminalVisible;

  if (state.terminalVisible) {
    showTerminalOverlay();

    if (!state.terminalInitialized) {
      await initTerminal();
    }
  } else {
    hideTerminalOverlay();
  }
}

function closeTerminal(): void {
  if (!state.terminalVisible) return;
  state.terminalVisible = false;
  hideTerminalOverlay();
}

async function terminalCdToFile(filePath: string): Promise<void> {
  // Only cd for the active local terminal tab
  if (!state.terminalInitialized || !filePath || !state.activeTerminalTabId) return;
  const tab = terminalTabs.get(state.activeTerminalTabId);
  if (!tab || tab.type !== 'local') return;
  // No terminalCd IPC any more — we'd need to write cd command directly
  // Skip auto-cd for tabbed terminal (user controls their own shell)
}

// ─── Bottom Panel (unified tabbed panel) ────────────────────────────

let notesSaveTimer: ReturnType<typeof setTimeout> | null = null;

function openBottomTab(tabId: string): void {
  state.bottomPanelVisible = true;
  state.activeBottomTab = tabId;
  state.lastActiveBottomTab = tabId;

  // Show the panel
  elements.bottomPanel.classList.remove('hidden');

  // Activate the correct tab button and content view
  document.querySelectorAll('.bottom-tab-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.bottomTab === tabId);
  });
  document.querySelectorAll('.bottom-tab-view').forEach(view => {
    view.classList.toggle('active', (view as HTMLElement).dataset.bottomTab === tabId);
  });

  // Update activity bar buttons (for bottom-tab buttons)
  document.querySelectorAll('.activity-bar-btn[data-bottom-tab]').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.bottomTab === tabId);
  });

  // Also activate toolbar notes toggle button
  elements.btnNotesToggle.classList.toggle('active', tabId === 'notes');

  // Tab-specific init
  if (tabId === 'notes') {
    elements.notesTextarea.focus();
    window.api.loadNotes().then((result) => {
      if (result.success && result.content) {
        elements.notesTextarea.value = result.content;
      } else {
        elements.notesTextarea.value = '';
      }
    });
  }
  if (tabId === 'chat') {
    loadChatHistory();
    elements.chatInput.focus();
    // Clear notification badge
    const badge = document.getElementById('badge-chat');
    if (badge) badge.textContent = '';
    // Refresh agent connection status
    window.api.getAgentStatus().then((s: any) => updateAgentConnectionStatus(s.connected, s.count, s.name));
  }
  if (tabId === 'live') {
    refreshLiveDevices();
  }
  if (tabId === 'contexts') {
    loadContextDefinitions();
  }

  saveBottomPanelState();
}

function closeBottomPanel(): void {
  state.bottomPanelVisible = false;
  state.activeBottomTab = null;

  elements.bottomPanel.classList.add('hidden');

  // Deactivate all tab buttons
  document.querySelectorAll('.bottom-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.bottom-tab-view').forEach(view => view.classList.remove('active'));

  // Deactivate activity bar bottom-tab buttons
  document.querySelectorAll('.activity-bar-btn[data-bottom-tab]').forEach(btn => {
    btn.classList.remove('active');
  });

  // Deactivate toolbar notes toggle
  elements.btnNotesToggle.classList.remove('active');

  saveBottomPanelState();
}

function toggleBottomTab(tabId: string): void {
  if (state.activeBottomTab === tabId) {
    closeBottomPanel();
  } else {
    openBottomTab(tabId);
  }
}

// ─── Agent Chat ──────────────────────────────────────────────────────

function addChatMessage(msg: { id?: string; from: string; text: string; timestamp: number }): void {
  const el = document.createElement('div');
  el.className = `chat-message from-${msg.from}`;
  if (msg.id) el.dataset.msgId = msg.id;

  const sender = document.createElement('div');
  sender.className = 'chat-sender';
  sender.textContent = msg.from === 'user' ? 'You' : 'Agent';

  const text = document.createElement('div');
  text.className = 'chat-text';
  text.textContent = msg.text;

  const time = document.createElement('div');
  time.className = 'chat-time';
  const d = new Date(msg.timestamp);
  time.textContent = d.toLocaleTimeString();

  el.appendChild(sender);
  el.appendChild(text);
  el.appendChild(time);
  elements.chatMessages.appendChild(el);

  // Auto-scroll to bottom
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function sendChatMessage(): void {
  const text = elements.chatInput.value.trim();
  if (!text) return;

  // Optimistically show in UI
  const msg = { from: 'user', text, timestamp: Date.now() };
  addChatMessage(msg);
  elements.chatInput.value = '';

  // Send to main process
  window.api.sendAgentMessage(text).catch(() => {
    // Message already shown; ignore send failure silently
  });
}

function updateAgentConnectionStatus(connected: boolean, count: number, name?: string | null): void {
  const dot = elements.chatAgentDot;
  const text = elements.chatAgentStatusText;
  if (connected) {
    dot.className = 'chat-agent-status-dot connected';
    text.textContent = name ? `${name} connected` : 'Agent connected';
  } else {
    dot.className = 'chat-agent-status-dot disconnected';
    text.textContent = 'No agent connected';
  }
}

let agentRunning = false;

function updateLaunchButton(): void {
  const btn = elements.chatLaunchAgent;
  if (agentRunning) {
    btn.textContent = 'Stop Agent';
    btn.classList.add('running');
  } else {
    btn.textContent = 'Launch Agent';
    btn.classList.remove('running');
  }
}

async function toggleAgent(): Promise<void> {
  const btn = elements.chatLaunchAgent;
  btn.disabled = true;
  try {
    if (agentRunning) {
      await window.api.stopAgent();
      agentRunning = false;
    } else {
      const res = await window.api.launchAgent();
      if (res.success) {
        agentRunning = true;
      } else {
        addChatMessage({ from: 'agent', text: `Failed to launch agent: ${res.error || 'unknown error'}`, timestamp: Date.now() });
      }
    }
    updateLaunchButton();
  } finally {
    btn.disabled = false;
  }
}

let chatHistoryLoaded = false;

function loadChatHistory(): void {
  if (chatHistoryLoaded) return;
  window.api.getAgentMessages().then((result) => {
    if (result.success && result.messages) {
      // Clear existing (if any)
      elements.chatMessages.innerHTML = '';
      for (const msg of result.messages) {
        addChatMessage(msg);
      }
      chatHistoryLoaded = true;
    }
  });
}

function setupBottomPanelResize(): void {
  const handle = elements.bottomPanelResizeHandle;
  const panel = elements.bottomPanel;
  let startY = 0;
  let startHeight = 0;
  let isDragging = false;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    isDragging = true;
    startY = e.clientY;
    startHeight = panel.offsetHeight;
    handle.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e: MouseEvent): void {
    if (!isDragging) return;
    const delta = startY - e.clientY;
    const newHeight = Math.max(120, Math.min(window.innerHeight * 0.7, startHeight + delta));
    panel.style.height = newHeight + 'px';
  }

  function onMouseUp(): void {
    isDragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    saveBottomPanelState();
  }
}

function saveBottomPanelState(): void {
  localStorage.setItem('logan-bottom-panel', JSON.stringify({
    visible: state.bottomPanelVisible,
    activeTab: state.activeBottomTab,
    lastActiveTab: state.lastActiveBottomTab,
    height: elements.bottomPanel.style.height || '30vh',
  }));
}

function restoreBottomPanelState(): void {
  try {
    const saved = localStorage.getItem('logan-bottom-panel');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.height) {
        elements.bottomPanel.style.height = data.height;
      }
      state.lastActiveBottomTab = data.lastActiveTab || null;
      if (data.visible && data.activeTab) {
        openBottomTab(data.activeTab);
      }
    }
  } catch (e) {
    console.warn('Failed to restore bottom panel state:', e);
  }
}

function saveNotesDebounced(): void {
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  elements.notesSaveStatus.textContent = 'Saving...';
  elements.notesSaveStatus.classList.add('saving');
  notesSaveTimer = setTimeout(async () => {
    const content = elements.notesTextarea.value;
    const result = await window.api.saveNotes(content);
    if (result.success) {
      elements.notesSaveStatus.textContent = 'Saved';
    } else {
      elements.notesSaveStatus.textContent = 'Save failed';
    }
    elements.notesSaveStatus.classList.remove('saving');
    // Clear status after 3s
    setTimeout(() => {
      if (elements.notesSaveStatus.textContent === 'Saved' ||
          elements.notesSaveStatus.textContent === 'Save failed') {
        elements.notesSaveStatus.textContent = '';
      }
    }, 3000);
  }, 1000);
}

function showNotesContextMenu(e: MouseEvent): void {
  const existing = document.querySelector('.tab-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.innerHTML = `<div class="tab-context-item" data-action="save-as">Save As...</div>`;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  document.body.appendChild(menu);

  menu.addEventListener('click', async (ev) => {
    const target = (ev.target as HTMLElement).closest('.tab-context-item') as HTMLElement;
    if (!target) return;
    menu.remove();
    if (target.dataset.action === 'save-as') {
      const content = elements.notesTextarea.value;
      const result = await window.api.saveNotesAs(content);
      if (result.success && result.filePath) {
        elements.notesSaveStatus.textContent = `Saved to ${result.filePath}`;
        setTimeout(() => {
          if (elements.notesSaveStatus.textContent?.startsWith('Saved to')) {
            elements.notesSaveStatus.textContent = '';
          }
        }, 3000);
      }
    }
  });

  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// ─── Search Results Panel ────────────────────────────────────────────

const SEARCH_RESULTS_LIST_CAP = 500;

async function renderSearchResultsList(): Promise<void> {
  const list = elements.searchResultsList;
  const results = state.searchResults;
  const searchPattern = elements.searchInput.value;

  if (results.length === 0) {
    list.innerHTML = '<div class="search-results-cap-notice">No results</div>';
    elements.searchResultsSummary.textContent = '';
    return;
  }

  const displayCount = Math.min(results.length, SEARCH_RESULTS_LIST_CAP);
  elements.searchResultsSummary.textContent = results.length > SEARCH_RESULTS_LIST_CAP
    ? `Showing ${SEARCH_RESULTS_LIST_CAP} of ${results.length}`
    : `${results.length} results`;

  list.innerHTML = '';
  const CHUNK_SIZE = 200;

  for (let chunkStart = 0; chunkStart < displayCount; chunkStart += CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, displayCount);
    const fragment = document.createDocumentFragment();

    for (let i = chunkStart; i < chunkEnd; i++) {
      const r = results[i];
      const item = document.createElement('div');
      item.className = 'search-result-item';
      if (i === state.currentSearchIndex) {
        item.classList.add('current');
      }
      item.dataset.index = String(i);

      const lineNum = document.createElement('span');
      lineNum.className = 'search-result-line-num';
      lineNum.textContent = `${r.lineNumber + 1}`;

      const text = document.createElement('span');
      text.className = 'search-result-text';
      const lineText = r.lineText || '';
      const truncated = lineText.length > 300 ? lineText.substring(0, 300) + '...' : lineText;
      if (searchPattern && r.column >= 0 && r.length > 0) {
        const before = escapeHtml(truncated.substring(0, r.column));
        const match = escapeHtml(truncated.substring(r.column, r.column + r.length));
        const after = escapeHtml(truncated.substring(r.column + r.length));
        text.innerHTML = `${before}<mark>${match}</mark>${after}`;
      } else {
        text.textContent = truncated;
      }

      item.appendChild(lineNum);
      item.appendChild(text);
      item.addEventListener('click', () => {
        goToSearchResult(i);
        updateSearchResultsCurrent();
        scrollSearchResultIntoView();
      });
      fragment.appendChild(item);
    }

    list.appendChild(fragment);
    if (chunkEnd < displayCount) await yieldToUI();
  }

  if (results.length > SEARCH_RESULTS_LIST_CAP) {
    const notice = document.createElement('div');
    notice.className = 'search-results-cap-notice';
    notice.textContent = `... and ${results.length - SEARCH_RESULTS_LIST_CAP} more results`;
    list.appendChild(notice);
  }
}

function updateSearchResultsCurrent(): void {
  const list = elements.searchResultsList;
  const prev = list.querySelector('.search-result-item.current');
  if (prev) prev.classList.remove('current');

  const idx = state.currentSearchIndex;
  if (idx >= 0 && idx < SEARCH_RESULTS_LIST_CAP) {
    const item = list.querySelector(`.search-result-item[data-index="${idx}"]`);
    if (item) item.classList.add('current');
  }
}

function scrollSearchResultIntoView(): void {
  const idx = state.currentSearchIndex;
  if (idx < 0 || idx >= SEARCH_RESULTS_LIST_CAP) return;
  const item = elements.searchResultsList.querySelector(`.search-result-item[data-index="${idx}"]`);
  if (item) {
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ─── Search Configs Panel ────────────────────────────────────────────

let editingSearchConfigId: string | null = null;

// ─── Live Panel (Serial / Logcat) ────────────────────────────────────

// Single duration timer for all live connections
let liveDurationTimer: ReturnType<typeof setInterval> | null = null;

function updateLiveSourceControls(): void {
  const source = state.liveSource;
  elements.liveSerialControls.style.display = source === 'serial' ? '' : 'none';
  elements.liveLogcatControls.style.display = source === 'logcat' ? '' : 'none';
  elements.liveSshControls.style.display = source === 'ssh' ? '' : 'none';
}

async function refreshLiveDevices(): Promise<void> {
  if (state.liveSource === 'serial') {
    await refreshSerialPorts();
  } else if (state.liveSource === 'logcat') {
    await refreshLogcatDevices();
  } else if (state.liveSource === 'ssh') {
    await refreshSshHosts();
  }
}

async function refreshSerialPorts(): Promise<void> {
  const result = await window.api.serialListPorts();
  const select = elements.livePortSelect;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Select port...</option>';
  if (result.success && result.ports) {
    for (const port of result.ports) {
      const opt = document.createElement('option');
      opt.value = port.path;
      opt.textContent = port.manufacturer
        ? `${port.path} (${port.manufacturer})`
        : port.path;
      select.appendChild(opt);
    }
    if (currentValue) {
      select.value = currentValue;
    }
  }
}

async function refreshLogcatDevices(): Promise<void> {
  const result = await window.api.logcatListDevices();
  const select = elements.liveDeviceSelect;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Select device...</option>';
  if (result.success && result.devices) {
    for (const device of result.devices) {
      if (device.state !== 'device') continue; // Only show connected devices
      const opt = document.createElement('option');
      opt.value = device.id;
      opt.textContent = device.model
        ? `${device.model} (${device.id})`
        : device.id;
      select.appendChild(opt);
    }
    if (currentValue) {
      select.value = currentValue;
    }
  }
}

async function liveConnect(): Promise<void> {
  if (state.liveConnections.size >= 4) {
    alert('Maximum 4 concurrent connections.');
    return;
  }

  const source = state.liveSource;
  const connectionName = elements.liveNameInput.value.trim();
  let config: any;
  let displayName: string;
  let detail: string;

  if (source === 'serial') {
    const portPath = elements.livePortSelect.value;
    if (!portPath) { alert('Select a serial port first.'); return; }
    const baudRate = parseInt(elements.liveBaudSelect.value, 10);
    config = { path: portPath, baudRate };
    displayName = connectionName || portPath;
    detail = `@ ${baudRate}`;
  } else if (source === 'logcat') {
    const device = elements.liveDeviceSelect.value || undefined;
    const filter = elements.liveFilterInput.value.trim() || undefined;
    config = { device, filter };
    displayName = connectionName || device || 'logcat';
    detail = filter ? `filter: ${filter}` : '';
  } else {
    // SSH - special handling for passphrase
    await liveConnectSsh();
    return;
  }

  elements.btnLiveConnect.textContent = 'Connecting...';
  elements.btnLiveConnect.disabled = true;

  const result = await window.api.liveConnect(source, config, displayName, detail);

  elements.btnLiveConnect.textContent = 'Connect';
  elements.btnLiveConnect.disabled = false;

  if (!result.success) {
    alert(`Failed to connect: ${result.error}`);
    return;
  }

  liveOnConnected(result.connectionId!, source, result.tempFilePath!, displayName, detail, config);
  elements.liveNameInput.value = '';
}

async function refreshSshHosts(): Promise<void> {
  const select = elements.liveSshHostSelect;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Select host...</option>';

  // Merge SSH config hosts + saved profiles
  const [configResult, profilesResult] = await Promise.all([
    window.api.sshParseConfig(),
    window.api.sshListProfiles(),
  ]);

  const seen = new Set<string>();

  // Add saved profiles first
  if (profilesResult.success && profilesResult.profiles) {
    state.sshProfiles = profilesResult.profiles;
    for (const profile of profilesResult.profiles) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ host: profile.host, port: profile.port, username: profile.username, identityFile: profile.identityFile });
      opt.textContent = `${profile.name} (${profile.username}@${profile.host})`;
      select.appendChild(opt);
      seen.add(profile.host);
    }
  }

  // Add SSH config hosts that aren't already saved as profiles
  if (configResult.success && configResult.hosts) {
    for (const host of configResult.hosts) {
      const hostName = host.hostName || host.host;
      if (seen.has(hostName) || seen.has(host.host)) continue;
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ host: host.hostName || host.host, port: host.port || 22, username: host.user || '', identityFile: host.identityFile });
      const user = host.user || 'user';
      opt.textContent = `${host.host} (${user}@${host.hostName || host.host})`;
      select.appendChild(opt);
    }
  }

  if (currentValue) {
    select.value = currentValue;
  }
}

async function liveConnectSsh(passphrase?: string): Promise<void> {
  const hostValue = elements.liveSshHostSelect.value;
  if (!hostValue) {
    alert('Select an SSH host first.');
    return;
  }
  const remotePath = elements.liveSshPathInput.value.trim();
  if (!remotePath) {
    alert('Enter a remote file path to tail.');
    return;
  }

  let hostConfig: { host: string; port: number; username: string; identityFile?: string };
  try {
    hostConfig = JSON.parse(hostValue);
  } catch {
    alert('Invalid host selection.');
    return;
  }

  if (!hostConfig.username) {
    alert('Username is required. Configure it in SSH profiles or ~/.ssh/config.');
    return;
  }

  if (state.liveConnections.size >= 4) {
    alert('Maximum 4 concurrent connections.');
    return;
  }

  const connectionName = elements.liveNameInput.value.trim();
  const config = {
    host: hostConfig.host,
    port: hostConfig.port,
    username: hostConfig.username,
    identityFile: hostConfig.identityFile,
    remotePath,
    passphrase,
  };

  elements.btnLiveConnect.textContent = 'Connecting...';
  elements.btnLiveConnect.disabled = true;

  const displayName = connectionName || `${hostConfig.username}@${hostConfig.host}`;
  const result = await window.api.liveConnect('ssh', config, displayName, remotePath);

  elements.btnLiveConnect.textContent = 'Connect';
  elements.btnLiveConnect.disabled = false;

  if (!result.success) {
    if (result.error === 'Error: PASSPHRASE_NEEDED') {
      showSshPassphrasePrompt();
      return;
    }
    alert(`Failed to connect: ${result.error}`);
    return;
  }

  liveOnConnected(result.connectionId!, 'ssh', result.tempFilePath!, displayName, remotePath, config);
  elements.liveNameInput.value = '';
}

function showSshPassphrasePrompt(): void {
  const modal = document.getElementById('ssh-passphrase-modal')!;
  const input = document.getElementById('ssh-passphrase-input') as HTMLInputElement;
  const btnOk = document.getElementById('btn-ssh-passphrase-ok') as HTMLButtonElement;
  const btnCancel = document.getElementById('btn-ssh-passphrase-cancel') as HTMLButtonElement;

  input.value = '';
  modal.classList.remove('hidden');
  input.focus();

  const cleanup = () => {
    modal.classList.add('hidden');
    btnOk.removeEventListener('click', onOk);
    btnCancel.removeEventListener('click', onCancel);
    input.removeEventListener('keydown', onKeydown);
  };

  const onOk = () => {
    const passphrase = input.value;
    cleanup();
    if (passphrase) {
      liveConnectSsh(passphrase);
    }
  };

  const onCancel = () => cleanup();

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  btnOk.addEventListener('click', onOk);
  btnCancel.addEventListener('click', onCancel);
  input.addEventListener('keydown', onKeydown);
}

function showSshProfileManager(): void {
  const modal = document.getElementById('ssh-profile-modal')!;
  const listEl = document.getElementById('ssh-profile-list') as HTMLDivElement;
  const nameInput = document.getElementById('ssh-profile-name') as HTMLInputElement;
  const hostInput = document.getElementById('ssh-profile-host') as HTMLInputElement;
  const portInput = document.getElementById('ssh-profile-port') as HTMLInputElement;
  const usernameInput = document.getElementById('ssh-profile-username') as HTMLInputElement;
  const identityInput = document.getElementById('ssh-profile-identity') as HTMLInputElement;
  const btnSave = document.getElementById('btn-ssh-profile-save') as HTMLButtonElement;
  const btnImport = document.getElementById('btn-ssh-import-config') as HTMLButtonElement;

  let editingId: string | null = null;

  function clearForm(): void {
    nameInput.value = '';
    hostInput.value = '';
    portInput.value = '22';
    usernameInput.value = '';
    identityInput.value = '';
    editingId = null;
    btnSave.textContent = 'Save Profile';
  }

  async function renderProfiles(): Promise<void> {
    const result = await window.api.sshListProfiles();
    const profiles = result.success && result.profiles ? result.profiles : [];
    state.sshProfiles = profiles;

    if (profiles.length === 0) {
      listEl.innerHTML = '<p class="placeholder">No saved profiles</p>';
      return;
    }

    listEl.innerHTML = profiles.map(p => `
      <div class="ssh-profile-item" data-id="${escapeHtml(p.id)}">
        <div class="ssh-profile-info">
          <span class="ssh-profile-item-name">${escapeHtml(p.name)}</span>
          <span class="ssh-profile-item-detail">${escapeHtml(p.username)}@${escapeHtml(p.host)}:${p.port}</span>
        </div>
        <div class="ssh-profile-actions">
          <button class="ssh-profile-edit-btn" title="Edit">&#9998;</button>
          <button class="ssh-profile-delete-btn" title="Delete">&times;</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.ssh-profile-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn.closest('.ssh-profile-item') as HTMLElement).dataset.id;
        const profile = profiles.find(p => p.id === id);
        if (profile) {
          nameInput.value = profile.name;
          hostInput.value = profile.host;
          portInput.value = String(profile.port);
          usernameInput.value = profile.username;
          identityInput.value = profile.identityFile || '';
          editingId = profile.id;
          btnSave.textContent = 'Update Profile';
        }
      });
    });

    listEl.querySelectorAll('.ssh-profile-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn.closest('.ssh-profile-item') as HTMLElement).dataset.id;
        if (id) {
          await window.api.sshDeleteProfile(id);
          renderProfiles();
        }
      });
    });
  }

  clearForm();
  renderProfiles();
  modal.classList.remove('hidden');

  // Remove old listeners to prevent stacking
  const newBtnSave = btnSave.cloneNode(true) as HTMLButtonElement;
  btnSave.parentNode?.replaceChild(newBtnSave, btnSave);
  const newBtnImport = btnImport.cloneNode(true) as HTMLButtonElement;
  btnImport.parentNode?.replaceChild(newBtnImport, btnImport);

  newBtnSave.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const host = hostInput.value.trim();
    const port = parseInt(portInput.value, 10) || 22;
    const username = usernameInput.value.trim();
    const identityFile = identityInput.value.trim() || undefined;

    if (!name || !host || !username) {
      alert('Name, Host, and Username are required.');
      return;
    }

    const profile: SshProfile = {
      id: editingId || `ssh-${Date.now()}`,
      name, host, port, username, identityFile,
      createdAt: editingId ? (state.sshProfiles.find(p => p.id === editingId)?.createdAt || Date.now()) : Date.now(),
    };

    await window.api.sshSaveProfile(profile);
    clearForm();
    renderProfiles();
    refreshSshHosts();
  });

  newBtnImport.addEventListener('click', async () => {
    const result = await window.api.sshParseConfig();
    if (!result.success || !result.hosts || result.hosts.length === 0) {
      alert('No hosts found in ~/.ssh/config');
      return;
    }

    for (const host of result.hosts) {
      const existing = state.sshProfiles.find(p => p.host === (host.hostName || host.host));
      if (existing) continue;

      const profile: SshProfile = {
        id: `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: host.host,
        host: host.hostName || host.host,
        port: host.port || 22,
        username: host.user || '',
        identityFile: host.identityFile,
        createdAt: Date.now(),
      };
      await window.api.sshSaveProfile(profile);
    }

    renderProfiles();
    refreshSshHosts();
  });
}

// === SSH Folder Browsing ===

async function openSshFolder(): Promise<void> {
  // First, refresh hosts so we have an up-to-date list
  await refreshSshHosts();

  // Find an active SSH connection for SFTP browsing
  let sshConn: LiveConnectionState | undefined;
  for (const conn of state.liveConnections.values()) {
    if (conn.source === 'ssh' && conn.connected) {
      sshConn = conn;
      break;
    }
  }
  if (!sshConn) {
    alert('Connect to an SSH host first via the Live panel, then use this button to browse its files.');
    return;
  }

  // Prompt for remote path
  const remotePath = prompt('Enter remote directory path:', '/var/log');
  if (!remotePath) return;

  try {
    const result = await window.api.sshListRemoteDir(remotePath);
    if (!result.success) {
      alert(`Failed to list remote directory: ${result.error}`);
      return;
    }

    const files = result.files || [];
    const hostLabel = sshConn.displayName;
    const folderName = `${hostLabel}:${remotePath}`;

    // Check if already open
    if (state.folders.some(f => f.path === folderName)) return;

    state.folders.push({
      path: folderName,
      name: folderName,
      files: files.map(f => ({ name: f.name, path: f.path, size: f.size })),
      collapsed: false,
      isRemote: true,
      sshHost: hostLabel || undefined,
    });

    renderFolderTree();
  } catch (error) {
    alert(`Error: ${error}`);
  }
}

function liveOnConnected(connectionId: string, source: 'serial' | 'logcat' | 'ssh', tempFilePath: string, displayName: string, detail: string, config: any): void {
  const conn: LiveConnectionState = {
    id: connectionId,
    source,
    displayName,
    detail,
    tempFilePath,
    tabId: null,
    linesReceived: 0,
    connectedSince: Date.now(),
    connected: true,
    followMode: true,
    minimapLevels: [],
    lastLine: '',
    config,
  };
  state.liveConnections.set(connectionId, conn);
  state.activeConnectionId = connectionId;

  // Open the temp file in the viewer
  window.api.openFile(tempFilePath).then((openResult) => {
    if (openResult.success && openResult.info) {
      const tab = createTab(tempFilePath);
      state.tabs.push(tab);
      state.activeTabId = tab.id;
      conn.tabId = tab.id;
      state.filePath = tempFilePath;
      state.totalLines = openResult.info.totalLines;
      createLogViewer();
      renderTabBar();
    }
  });

  // Start global duration timer if not already running
  if (!liveDurationTimer) {
    liveDurationTimer = setInterval(updateAllCardDurations, 1000);
  }

  renderConnectionCards();
}

function renderConnectionCards(): void {
  const container = elements.liveCardsRow;
  if (!container) return;

  container.innerHTML = '';

  for (const conn of state.liveConnections.values()) {
    const card = document.createElement('div');
    card.className = 'live-card';
    card.dataset.connectionId = conn.id;
    card.dataset.active = (conn.id === state.activeConnectionId) ? 'true' : 'false';

    const statusClass = conn.connected ? 'connected' : 'disconnected';
    const statusDot = conn.connected ? '\u25CF' : '\u25CB';

    const duration = conn.connectedSince ? formatDurationMs(Date.now() - conn.connectedSince) : '';

    card.innerHTML = `
      <div class="live-card-header">
        <span class="live-card-name">${escapeHtml(conn.displayName)}</span>
        <span class="live-card-detail">${escapeHtml(conn.detail)}</span>
        <div class="live-card-actions">
          ${conn.connected
            ? `<button class="live-card-btn stop" title="Stop" data-action="stop">\u25A0</button>`
            : `<button class="live-card-btn restart" title="Restart" data-action="restart">\u21BB</button>`
          }
          <button class="live-card-btn save" title="Save session log" data-action="save">\u{1F4BE}</button>
          <button class="live-card-btn save-config" title="Save connection config" data-action="save-config">\u2606</button>
          <button class="live-card-btn remove" title="Remove" data-action="remove">\u00D7</button>
        </div>
      </div>
      <div class="live-card-stats">
        <span class="live-card-lines">${conn.linesReceived.toLocaleString()} lines</span>
        <span class="live-card-duration">${duration}</span>
        <span class="live-card-status ${statusClass}">${statusDot}</span>
      </div>
      <div class="live-card-preview">${escapeHtml(conn.lastLine)}</div>
      <canvas class="live-card-minimap" width="200" height="24"></canvas>
    `;

    // Card click → switch to connection's tab
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.live-card-btn')) return; // let button handler handle it
      state.activeConnectionId = conn.id;
      if (conn.tabId) {
        switchToTab(conn.tabId);
      }
      renderConnectionCards();
    });

    // Button actions
    card.querySelectorAll('.live-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action;
        if (action === 'stop') liveStopConnection(conn.id);
        else if (action === 'restart') liveRestartConnection(conn.id);
        else if (action === 'save') liveSaveConnection(conn.id);
        else if (action === 'save-config') liveSaveConnectionConfig(conn.id);
        else if (action === 'remove') liveRemoveConnection(conn.id);
      });
    });

    container.appendChild(card);
  }

  // Render all card minimaps
  requestCardMinimapRender();
}

function updateConnectionCard(connectionId: string): void {
  const conn = state.liveConnections.get(connectionId);
  if (!conn) return;

  const container = elements.liveCardsRow;
  const card = container?.querySelector(`[data-connection-id="${connectionId}"]`) as HTMLElement;
  if (!card) { renderConnectionCards(); return; }

  const linesEl = card.querySelector('.live-card-lines');
  if (linesEl) linesEl.textContent = `${conn.linesReceived.toLocaleString()} lines`;

  const previewEl = card.querySelector('.live-card-preview');
  if (previewEl) previewEl.textContent = conn.lastLine;
}

function updateAllCardDurations(): void {
  let anyConnected = false;
  for (const conn of state.liveConnections.values()) {
    if (conn.connectedSince) {
      anyConnected = true;
      const card = elements.liveCardsRow?.querySelector(`[data-connection-id="${conn.id}"]`);
      const durEl = card?.querySelector('.live-card-duration');
      if (durEl) durEl.textContent = formatDurationMs(Date.now() - conn.connectedSince);
    }
  }
  if (!anyConnected && liveDurationTimer) {
    clearInterval(liveDurationTimer);
    liveDurationTimer = null;
  }
}

function formatDurationMs(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs % 60}s`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

async function liveStopConnection(connectionId: string): Promise<void> {
  const conn = state.liveConnections.get(connectionId);
  if (!conn || !conn.connected) return;
  await window.api.liveDisconnect(connectionId);
  conn.connected = false;
  conn.connectedSince = null;
  renderConnectionCards();
}

async function liveRestartConnection(connectionId: string): Promise<void> {
  const conn = state.liveConnections.get(connectionId);
  if (!conn) return;

  const result = await window.api.liveRestart(connectionId);
  if (!result.success) {
    alert(`Restart failed: ${result.error}`);
    return;
  }

  conn.tempFilePath = result.tempFilePath!;
  conn.connected = true;
  conn.connectedSince = Date.now();
  conn.linesReceived = 0;
  conn.minimapLevels = [];
  conn.lastLine = '';

  // Open new temp file in viewer
  const openResult = await window.api.openFile(conn.tempFilePath);
  if (openResult.success && openResult.info) {
    // Close old tab if it exists
    if (conn.tabId) {
      const oldTabIdx = state.tabs.findIndex(t => t.id === conn.tabId);
      if (oldTabIdx >= 0) state.tabs.splice(oldTabIdx, 1);
    }
    const tab = createTab(conn.tempFilePath);
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    conn.tabId = tab.id;
    state.filePath = conn.tempFilePath;
    state.totalLines = openResult.info.totalLines;
    createLogViewer();
    renderTabBar();
  }

  if (!liveDurationTimer) {
    liveDurationTimer = setInterval(updateAllCardDurations, 1000);
  }

  renderConnectionCards();
}

async function liveSaveConnection(connectionId: string): Promise<void> {
  const result = await window.api.liveSaveSession(connectionId);
  if (result.success) {
    alert(`Session saved to:\n${result.filePath}`);
  } else if (result.error && result.error !== 'Cancelled') {
    alert(`Save failed: ${result.error}`);
  }
}

async function liveRemoveConnection(connectionId: string): Promise<void> {
  const conn = state.liveConnections.get(connectionId);
  if (!conn) return;

  await window.api.liveRemove(connectionId);

  // Close tab if it exists
  if (conn.tabId) {
    const tabIdx = state.tabs.findIndex(t => t.id === conn.tabId);
    if (tabIdx >= 0) {
      state.tabs.splice(tabIdx, 1);
      if (state.activeTabId === conn.tabId) {
        // Switch to another tab
        if (state.tabs.length > 0) {
          switchToTab(state.tabs[state.tabs.length - 1].id);
        } else {
          state.activeTabId = null;
          state.filePath = null;
        }
      }
      renderTabBar();
    }
  }

  state.liveConnections.delete(connectionId);
  if (state.activeConnectionId === connectionId) {
    // Pick next active connection
    const first = state.liveConnections.keys().next().value;
    state.activeConnectionId = first || null;
  }

  renderConnectionCards();
}

// === Saved Connections (persistent config) ===

async function liveSaveConnectionConfig(connectionId: string): Promise<void> {
  const conn = state.liveConnections.get(connectionId);
  if (!conn) return;

  // Electron doesn't support window.prompt — use a small inline dialog
  const name = await showInputDialog('Save Connection', 'Connection name:', conn.displayName);
  if (!name) return;

  const saved = {
    id: crypto.randomUUID(),
    name,
    source: conn.source,
    config: conn.config,
    createdAt: Date.now(),
    lastUsedAt: null,
  };

  const result = await window.api.connectionSave(saved);
  if (result.success) {
    renderSavedConnections();
  } else {
    alert(`Failed to save: ${result.error}`);
  }
}

function showInputDialog(title: string, label: string, defaultValue: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e1e1e;border:1px solid #555;border-radius:6px;padding:16px;min-width:300px;';
    dialog.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:#ddd;margin-bottom:8px;">${escapeHtml(title)}</div>
      <div style="font-size:11px;color:#aaa;margin-bottom:4px;">${escapeHtml(label)}</div>
      <input type="text" style="width:100%;box-sizing:border-box;background:#2d2d2d;border:1px solid #555;border-radius:3px;color:#ddd;padding:6px 8px;font-size:12px;outline:none;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        <button class="dlg-cancel" style="background:none;border:1px solid #555;color:#aaa;padding:4px 12px;border-radius:3px;cursor:pointer;font-size:11px;">Cancel</button>
        <button class="dlg-ok" style="background:var(--accent-color,#007acc);border:none;color:#fff;padding:4px 12px;border-radius:3px;cursor:pointer;font-size:11px;">Save</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector('input')!;
    input.value = defaultValue;
    input.select();
    input.focus();

    const cleanup = (val: string | null) => { overlay.remove(); resolve(val); };

    dialog.querySelector('.dlg-ok')!.addEventListener('click', () => cleanup(input.value.trim() || null));
    dialog.querySelector('.dlg-cancel')!.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') cleanup(input.value.trim() || null);
      if (e.key === 'Escape') cleanup(null);
    });
  });
}

async function renderSavedConnections(): Promise<void> {
  const container = elements.savedConnectionsRow;
  if (!container) return;

  const result = await window.api.connectionList();
  if (!result.success || !result.connections || result.connections.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';

  const sourceIcons: Record<string, string> = {
    serial: '\u{1F50C}',  // plug
    logcat: '\u{1F4F1}',  // phone
    ssh: '\u{1F5A5}',     // desktop
  };

  for (const saved of result.connections) {
    const card = document.createElement('div');
    card.className = 'saved-connection-card';
    card.dataset.savedId = saved.id;

    card.innerHTML = `
      <span class="saved-connection-icon">${sourceIcons[saved.source] || '\u25CB'}</span>
      <span class="saved-connection-name">${escapeHtml(saved.name)}</span>
      <span class="saved-connection-source">${escapeHtml(saved.source)}</span>
      <button class="saved-connection-delete" title="Delete saved connection">\u00D7</button>
    `;

    // Click → connect using saved config
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.saved-connection-delete')) return;
      activateSavedConnection(saved);
    });

    // Delete button
    const delBtn = card.querySelector('.saved-connection-delete')!;
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = confirm(`Delete saved connection "${saved.name}"?`);
      if (!ok) return;
      await window.api.connectionDelete(saved.id);
      renderSavedConnections();
    });

    container.appendChild(card);
  }
}

async function activateSavedConnection(saved: any): Promise<void> {
  if (state.liveConnections.size >= 4) {
    alert('Maximum 4 concurrent connections.');
    return;
  }

  const source = saved.source;
  const config = saved.config;
  const displayName = saved.name;
  let detail = '';

  if (source === 'serial') {
    detail = config.baudRate ? `@ ${config.baudRate}` : '';
  } else if (source === 'logcat') {
    detail = config.filter ? `filter: ${config.filter}` : '';
  } else if (source === 'ssh') {
    detail = config.remotePath || config.host || '';
    if (config.host) {
      const result = await window.api.liveConnect(source, config, displayName, detail);
      if (!result.success) {
        if (result.error && result.error.includes('passphrase')) {
          const passphrase = await showInputDialog('SSH Authentication', 'Key passphrase:', '');
          if (!passphrase) return;
          config.passphrase = passphrase;
          const retry = await window.api.liveConnect(source, config, displayName, detail);
          if (!retry.success) { alert(`Failed to connect: ${retry.error}`); return; }
          liveOnConnected(retry.connectionId!, source, retry.tempFilePath!, displayName, detail, config);
        } else {
          alert(`Failed to connect: ${result.error}`);
        }
        return;
      }
      liveOnConnected(result.connectionId!, source, result.tempFilePath!, displayName, detail, config);
      saved.lastUsedAt = Date.now();
      window.api.connectionUpdate(saved);
      return;
    }
  }

  // Serial / Logcat
  const result = await window.api.liveConnect(source, config, displayName, detail);
  if (!result.success) {
    alert(`Failed to connect: ${result.error}`);
    return;
  }
  liveOnConnected(result.connectionId!, source, result.tempFilePath!, displayName, detail, config);
  saved.lastUsedAt = Date.now();
  window.api.connectionUpdate(saved);
}

// Line cache invalidation for live streaming
function invalidateLineCache(): void {
  cachedLines.clear();
}

// Card minimap rendering — single RAF for all cards
let cardMinimapRafPending = false;

function requestCardMinimapRender(): void {
  if (cardMinimapRafPending) return;
  cardMinimapRafPending = true;
  requestAnimationFrame(() => {
    cardMinimapRafPending = false;
    for (const conn of state.liveConnections.values()) {
      renderCardMinimap(conn.id);
    }
  });
}

function renderCardMinimap(connectionId: string): void {
  const conn = state.liveConnections.get(connectionId);
  if (!conn) return;

  const card = elements.liveCardsRow?.querySelector(`[data-connection-id="${connectionId}"]`);
  const canvas = card?.querySelector('.live-card-minimap') as HTMLCanvasElement;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const levels = conn.minimapLevels;
  const totalLines = levels.length;
  if (totalLines === 0) {
    ctx.clearRect(0, 0, w, h);
    return;
  }

  const sampleRate = Math.max(1, Math.floor(totalLines / w));
  ctx.clearRect(0, 0, w, h);

  for (let x = 0; x < w; x++) {
    const lineIdx = Math.floor((x / w) * totalLines);
    const endIdx = Math.min(lineIdx + sampleRate, totalLines);

    let hasError = false;
    let hasWarning = false;

    for (let i = lineIdx; i < endIdx; i++) {
      const level = levels[i];
      if (level === 'error') hasError = true;
      else if (level === 'warning') hasWarning = true;
    }

    if (hasError) ctx.fillStyle = '#e74c3c';
    else if (hasWarning) ctx.fillStyle = '#f39c12';
    else ctx.fillStyle = 'rgba(150, 150, 150, 0.4)';

    ctx.fillRect(x, 0, 1, h);
  }
}

// Unified live event listeners — registered once in init()
function setupLiveEventListeners(): void {
  window.api.onLiveLinesAdded(({ connectionId, totalLines, newLines }) => {
    const conn = state.liveConnections.get(connectionId);
    if (!conn) return;
    conn.linesReceived = totalLines;
    for (let i = 0; i < newLines; i++) conn.minimapLevels.push(undefined);
    updateConnectionCard(connectionId);
    requestCardMinimapRender();

    // If this connection's tab is active, update the main viewer
    if (conn.tabId === state.activeTabId) {
      state.totalLines = totalLines;
      invalidateLineCache();
      if (conn.followMode) goToLine(Math.max(0, totalLines - 1));
      else renderVisibleLines();
    }

    // Fetch last line for preview (debounced via RAF coalescing in updateConnectionCard)
    window.api.getLinesForFile(conn.tempFilePath, Math.max(0, totalLines - 1), 1).then(res => {
      if (res.success && res.lines && res.lines.length > 0) {
        const text = res.lines[0].text || '';
        conn.lastLine = text.length > 80 ? text.slice(0, 80) + '\u2026' : text;
        const card = elements.liveCardsRow?.querySelector(`[data-connection-id="${connectionId}"]`);
        const previewEl = card?.querySelector('.live-card-preview');
        if (previewEl) previewEl.textContent = conn.lastLine;
      }
    });
  });

  window.api.onLiveError(({ connectionId, message }) => {
    const conn = state.liveConnections.get(connectionId);
    if (!conn) return;
    conn.lastLine = `Error: ${message}`;
    updateConnectionCard(connectionId);
  });

  window.api.onLiveDisconnected(({ connectionId }) => {
    const conn = state.liveConnections.get(connectionId);
    if (!conn) return;
    conn.connected = false;
    conn.connectedSince = null;
    renderConnectionCards();
  });
}

function openVideoFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv,.ogg';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) {
      loadVideoFromPath(file.path);
    }
  };
  input.click();
}

function loadVideoFromPath(videoPath: string): void {
  state.videoFilePath = videoPath;
  elements.videoElement.src = 'file://' + videoPath;
  elements.videoContainer.classList.add('has-video');
  const fileName = videoPath.split('/').pop() || videoPath;
  elements.videoFileName.textContent = fileName;
  saveVideoState();
}

function syncVideoToLine(lineNumber: number): void {
  if (!state.videoFilePath || !state.videoSyncOffsetMs || !elements.videoElement.src) return;

  window.api.getLineTimestamp(lineNumber).then((result) => {
    if (result.epochMs === null) return;
    const videoTime = (result.epochMs - state.videoSyncOffsetMs) / 1000;
    if (videoTime < 0 || videoTime > elements.videoElement.duration) return;
    elements.videoElement.currentTime = videoTime;
  });
}

function setVideoSyncFromInput(): void {
  const input = elements.videoSyncInput.value.trim();
  if (!input) {
    state.videoSyncOffsetMs = 0;
    elements.videoSyncStatus.textContent = '';
    saveVideoState();
    return;
  }
  // Try to parse as a timestamp by asking the main process for epoch ms
  // We'll search for a line that starts with this timestamp — or just parse it ourselves
  // Simple approach: try to parse common timestamp formats
  const parsed = tryParseTimestamp(input);
  if (parsed) {
    state.videoSyncOffsetMs = parsed;
    elements.videoSyncStatus.textContent = 'Sync set';
    setTimeout(() => { elements.videoSyncStatus.textContent = ''; }, 3000);
    saveVideoState();
  } else {
    elements.videoSyncStatus.textContent = 'Invalid timestamp';
    setTimeout(() => { elements.videoSyncStatus.textContent = ''; }, 3000);
  }
}

function tryParseTimestamp(text: string): number | null {
  // Try ISO format: 2024-01-15T10:30:00 or 2024-01-15 10:30:00
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (isoMatch) {
    const [, year, month, day, hour, min, sec] = isoMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec)).getTime();
  }
  // Try European format: DD.MM.YYYY HH:mm:ss
  const euroMatch = text.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (euroMatch) {
    const [, day, month, year, hour, min, sec] = euroMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec)).getTime();
  }
  return null;
}

function setVideoSyncFromCurrentLine(): void {
  if (state.selectedLine === null) {
    elements.videoSyncStatus.textContent = 'No line selected';
    setTimeout(() => { elements.videoSyncStatus.textContent = ''; }, 3000);
    return;
  }
  window.api.getLineTimestamp(state.selectedLine).then((result) => {
    if (result.epochMs === null) {
      elements.videoSyncStatus.textContent = 'No timestamp found';
      setTimeout(() => { elements.videoSyncStatus.textContent = ''; }, 3000);
      return;
    }
    const currentVideoTimeMs = (elements.videoElement.currentTime || 0) * 1000;
    state.videoSyncOffsetMs = result.epochMs - currentVideoTimeMs;
    elements.videoSyncInput.value = result.timestampStr || '';
    const videoTimeStr = formatVideoTime(elements.videoElement.currentTime || 0);
    elements.videoSyncStatus.textContent = 'Sync set: line ' + (state.selectedLine! + 1) + ' → ' + videoTimeStr;
    setTimeout(() => { elements.videoSyncStatus.textContent = ''; }, 3000);
    saveVideoState();
  });
}

function formatVideoTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ':' + String(secs).padStart(2, '0');
}

function saveVideoState(): void {
  // Save to LocalFileData via the existing persistence mechanism
  if (!state.filePath) return;
  // We update the local file data by re-loading, patching, and saving via IPC
  // Since we don't have a direct IPC for partial update, we'll store in a local variable
  // and hook into the existing save flow — but for now, use localStorage as a lightweight approach
  const key = 'logan-video-' + state.filePath;
  const data = {
    videoFilePath: state.videoFilePath,
    videoSyncOffsetMs: state.videoSyncOffsetMs,
  };
  localStorage.setItem(key, JSON.stringify(data));
}

function restoreVideoState(): void {
  if (!state.filePath) return;
  const key = 'logan-video-' + state.filePath;
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      const data = JSON.parse(stored);
      if (data.videoFilePath) {
        state.videoFilePath = data.videoFilePath;
        state.videoSyncOffsetMs = data.videoSyncOffsetMs || 0;
        loadVideoFromPath(data.videoFilePath);
        if (data.videoSyncOffsetMs) {
          elements.videoSyncInput.value = new Date(data.videoSyncOffsetMs).toISOString().replace('T', ' ').substring(0, 19);
        }
      }
    } catch { /* ignore */ }
  }
}

function setupVideoDragDrop(): void {
  const dropZone = elements.videoDropZone;
  const container = elements.videoContainer;

  const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };

  container.addEventListener('dragover', (e) => {
    prevent(e);
    dropZone.classList.add('drag-over');
  });

  container.addEventListener('dragleave', (e) => {
    prevent(e);
    dropZone.classList.remove('drag-over');
  });

  container.addEventListener('drop', (e) => {
    prevent(e);
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('video/')) {
      loadVideoFromPath(file.path);
    }
  });
}

// Search Configs Color Palette (reuse from main process palette)
const SC_COLOR_PALETTE = [
  '#ffff00', '#ff9900', '#00ff00', '#00ffff', '#ff00ff',
  '#ff6b6b', '#4ecdc4', '#a55eea', '#26de81', '#fd79a8',
];

function getNextSearchConfigColor(): string {
  const usedColors = state.searchConfigs.map(c => c.color);
  for (const color of SC_COLOR_PALETTE) {
    if (!usedColors.includes(color)) return color;
  }
  return SC_COLOR_PALETTE[Math.floor(Math.random() * SC_COLOR_PALETTE.length)];
}

function showSearchConfigForm(configId?: string): void {
  editingSearchConfigId = configId || null;
  const form = elements.searchConfigsForm;
  form.classList.remove('hidden');

  if (configId) {
    const config = state.searchConfigs.find(c => c.id === configId);
    if (config) {
      elements.scPatternInput.value = config.pattern;
      elements.scRegex.checked = config.isRegex;
      elements.scMatchCase.checked = config.matchCase;
      elements.scWholeWord.checked = config.wholeWord;
      elements.scGlobal.checked = config.isGlobal;
      elements.scColorInput.value = config.color;
    }
  } else {
    elements.scPatternInput.value = '';
    elements.scRegex.checked = false;
    elements.scMatchCase.checked = false;
    elements.scWholeWord.checked = false;
    elements.scGlobal.checked = false;
    elements.scColorInput.value = getNextSearchConfigColor();
  }

  elements.scPatternInput.focus();
}

function hideSearchConfigForm(): void {
  elements.searchConfigsForm.classList.add('hidden');
  editingSearchConfigId = null;
}

async function addSearchConfig(): Promise<void> {
  const pattern = elements.scPatternInput.value.trim();
  if (!pattern) return;

  const config: SearchConfigDef = {
    id: editingSearchConfigId || `sc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    pattern,
    isRegex: elements.scRegex.checked,
    matchCase: elements.scMatchCase.checked,
    wholeWord: elements.scWholeWord.checked,
    color: elements.scColorInput.value,
    enabled: true,
    isGlobal: elements.scGlobal.checked,
    createdAt: editingSearchConfigId
      ? (state.searchConfigs.find(c => c.id === editingSearchConfigId)?.createdAt || Date.now())
      : Date.now(),
  };

  // Remove old if editing
  state.searchConfigs = state.searchConfigs.filter(c => c.id !== config.id);
  state.searchConfigs.push(config);

  await window.api.searchConfigSave(config);
  hideSearchConfigForm();
  renderSearchConfigsChips();
  await runSearchConfigsBatch();
}

async function deleteSearchConfig(id: string): Promise<void> {
  state.searchConfigs = state.searchConfigs.filter(c => c.id !== id);
  state.searchConfigResults.delete(id);
  await window.api.searchConfigDelete(id);
  renderSearchConfigsChips();
  await renderSearchConfigsResults();
  renderVisibleLines();
}

async function toggleSearchConfigEnabled(id: string): Promise<void> {
  const config = state.searchConfigs.find(c => c.id === id);
  if (!config) return;
  config.enabled = !config.enabled;
  await window.api.searchConfigSave(config);
  renderSearchConfigsChips();

  if (config.enabled) {
    // Run batch just for this one
    await runSearchConfigsBatch();
  } else {
    await renderSearchConfigsResults();
    renderVisibleLines();
  }
}

async function runSearchConfigsBatch(): Promise<void> {
  const enabledConfigs = state.searchConfigs.filter(c => c.enabled);
  if (enabledConfigs.length === 0) {
    state.searchConfigResults.clear();
    await renderSearchConfigsResults();
    renderVisibleLines();
    return;
  }

  const batchArgs = enabledConfigs.map(c => ({
    id: c.id,
    pattern: c.pattern,
    isRegex: c.isRegex,
    matchCase: c.matchCase,
    wholeWord: c.wholeWord,
  }));

  const result = await window.api.searchConfigBatch(batchArgs);
  if (result.success && result.results) {
    for (const [configId, matches] of Object.entries(result.results)) {
      state.searchConfigResults.set(configId, matches as SearchResult[]);
    }
    // Clear results for configs that were removed
    for (const key of state.searchConfigResults.keys()) {
      if (!enabledConfigs.some(c => c.id === key)) {
        state.searchConfigResults.delete(key);
      }
    }
  }

  renderSearchConfigsChips(); // Update counts
  await yieldToUI();
  await renderSearchConfigsResults();
  await yieldToUI();
  renderVisibleLines();
  renderMinimapMarkers();
}

function renderSearchConfigsChips(): void {
  const container = elements.searchConfigsChips;
  // Keep the add button, remove existing chips
  const addBtn = elements.btnAddSearchConfig;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();

  for (const config of state.searchConfigs) {
    const chip = document.createElement('div');
    chip.className = `search-config-chip${config.enabled ? '' : ' disabled'}`;
    chip.dataset.configId = config.id;

    const swatch = document.createElement('span');
    swatch.className = 'sc-chip-swatch';
    swatch.style.backgroundColor = config.color;

    const patternText = document.createElement('span');
    patternText.className = 'sc-chip-pattern';
    patternText.textContent = config.pattern;
    patternText.title = config.pattern;

    const count = document.createElement('span');
    count.className = 'sc-chip-count';
    const resultCount = state.searchConfigResults.get(config.id)?.length || 0;
    count.textContent = config.enabled ? `(${resultCount})` : '';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'sc-chip-toggle';
    toggleBtn.innerHTML = config.enabled ? '&#9673;' : '&#9675;';
    toggleBtn.title = config.enabled ? 'Disable' : 'Enable';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSearchConfigEnabled(config.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'sc-chip-delete';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSearchConfig(config.id);
    });

    chip.appendChild(swatch);
    chip.appendChild(patternText);
    chip.appendChild(count);
    chip.appendChild(toggleBtn);
    chip.appendChild(deleteBtn);

    // Right-click context menu
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showSearchConfigContextMenu(e, config);
    });

    fragment.appendChild(chip);
  }

  container.appendChild(fragment);
  container.appendChild(addBtn);
  container.appendChild(elements.btnScExportAll);

  // Show/hide Export All button based on whether any results exist
  const hasResults = state.searchConfigs.some(c => c.enabled && (state.searchConfigResults.get(c.id)?.length || 0) > 0);
  elements.btnScExportAll.style.display = hasResults ? '' : 'none';

  // Update badge
  const badge = document.getElementById('badge-search-configs');
  const enabledCount = state.searchConfigs.filter(c => c.enabled).length;
  if (badge) {
    badge.textContent = enabledCount > 0 ? String(enabledCount) : '';
  }
}

const SC_RESULTS_LIST_CAP = 1000;

async function renderSearchConfigsResults(): Promise<void> {
  const list = elements.searchConfigsResults;
  const enabledConfigs = state.searchConfigs.filter(c => c.enabled);

  if (enabledConfigs.length === 0) {
    list.innerHTML = '<div class="sc-results-cap-notice">No active search configs</div>';
    return;
  }

  // Merge all results sorted by line number
  const allResults: Array<{ lineNumber: number; column: number; length: number; lineText: string; configId: string; color: string }> = [];
  for (const config of enabledConfigs) {
    const matches = state.searchConfigResults.get(config.id) || [];
    for (const m of matches) {
      allResults.push({ ...m, configId: config.id, color: config.color });
    }
  }

  allResults.sort((a, b) => a.lineNumber - b.lineNumber);

  if (allResults.length === 0) {
    list.innerHTML = '<div class="sc-results-cap-notice">No matches found</div>';
    return;
  }

  const displayCount = Math.min(allResults.length, SC_RESULTS_LIST_CAP);
  // Summary text removed (was in overlay header, now tab handles it)

  list.innerHTML = '';
  const CHUNK_SIZE = 200;

  for (let chunkStart = 0; chunkStart < displayCount; chunkStart += CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, displayCount);
    const fragment = document.createDocumentFragment();

    for (let i = chunkStart; i < chunkEnd; i++) {
      const r = allResults[i];
      const item = document.createElement('div');
      item.className = 'sc-result-item';

      const dot = document.createElement('span');
      dot.className = 'sc-result-dot';
      dot.style.backgroundColor = r.color;

      const lineNum = document.createElement('span');
      lineNum.className = 'sc-result-line-num';
      lineNum.textContent = `${r.lineNumber + 1}`;

      const text = document.createElement('span');
      text.className = 'sc-result-text';
      const lineText = r.lineText || '';
      const truncated = lineText.length > 300 ? lineText.substring(0, 300) + '...' : lineText;
      if (r.column >= 0 && r.length > 0) {
        const before = escapeHtml(truncated.substring(0, r.column));
        const match = escapeHtml(truncated.substring(r.column, r.column + r.length));
        const after = escapeHtml(truncated.substring(r.column + r.length));
        text.innerHTML = `${before}<mark style="background:${r.color};color:#000">${match}</mark>${after}`;
      } else {
        text.textContent = truncated;
      }

      item.appendChild(dot);
      item.appendChild(lineNum);
      item.appendChild(text);
      item.addEventListener('click', () => {
        goToLine(r.lineNumber);
      });
      fragment.appendChild(item);
    }

    list.appendChild(fragment);
    if (chunkEnd < displayCount) await yieldToUI();
  }

  if (allResults.length > SC_RESULTS_LIST_CAP) {
    const notice = document.createElement('div');
    notice.className = 'sc-results-cap-notice';
    notice.textContent = `Showing first ${SC_RESULTS_LIST_CAP} of ${allResults.length} matches`;
    list.appendChild(notice);
  }
}

function showSearchConfigContextMenu(e: MouseEvent, config: SearchConfigDef): void {
  // Remove existing context menu
  document.querySelectorAll('.sc-context-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'sc-context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const editItem = document.createElement('button');
  editItem.className = 'sc-context-menu-item';
  editItem.textContent = 'Edit';
  editItem.addEventListener('click', () => {
    menu.remove();
    showSearchConfigForm(config.id);
  });

  const exportItem = document.createElement('button');
  exportItem.className = 'sc-context-menu-item';
  exportItem.textContent = 'Export Results';
  exportItem.addEventListener('click', async () => {
    menu.remove();
    const results = state.searchConfigResults.get(config.id) || [];
    if (results.length === 0) return;
    const lines = results.map(r => `${r.lineNumber + 1}: ${r.lineText}`);
    const result = await window.api.searchConfigExport(config.id, lines);
    if (result.success && result.filePath) {
      // Export success notification (summary was in old overlay header)
    }
  });

  const deleteItem = document.createElement('button');
  deleteItem.className = 'sc-context-menu-item danger';
  deleteItem.textContent = 'Delete';
  deleteItem.addEventListener('click', () => {
    menu.remove();
    deleteSearchConfig(config.id);
  });

  menu.appendChild(editItem);
  menu.appendChild(exportItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);

  // Close on click outside
  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

async function loadSearchConfigs(): Promise<void> {
  const result = await window.api.searchConfigLoad();
  if (result.success && result.configs) {
    state.searchConfigs = result.configs;
  } else {
    state.searchConfigs = [];
  }
  state.searchConfigResults.clear();
  renderSearchConfigsChips();

  // Auto-run batch if any enabled configs
  if (state.searchConfigs.some(c => c.enabled)) {
    await runSearchConfigsBatch();
  }
}

// === Export All Search Config Results ===

async function exportAllSearchConfigResults(): Promise<void> {
  const enabledConfigs = state.searchConfigs.filter(c => c.enabled);
  if (enabledConfigs.length === 0) return;

  let totalMatches = 0;
  for (const config of enabledConfigs) {
    totalMatches += state.searchConfigResults.get(config.id)?.length || 0;
  }
  if (totalMatches === 0) return;

  const filePath = state.filePath || 'unknown';
  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);

  const parts: string[] = [];
  parts.push('LOGAN Multi-Search Export');
  parts.push(`Source: ${filePath}`);
  parts.push(`Exported: ${dateStr}`);
  parts.push(`Configs: ${enabledConfigs.length} active (${totalMatches} total matches)`);
  parts.push('================================================================');
  parts.push('');

  for (const config of enabledConfigs) {
    const results = state.searchConfigResults.get(config.id) || [];
    const flags: string[] = [];
    if (config.isRegex) flags.push('regex');
    if (config.matchCase) flags.push('case-sensitive');
    else flags.push('case-insensitive');
    if (config.wholeWord) flags.push('whole-word');

    parts.push(`--- [Pattern: "${config.pattern}"] (${flags.join(', ')}, ${results.length} matches) ---`);
    for (const r of results) {
      parts.push(`${r.lineNumber + 1}: ${r.lineText}`);
    }
    parts.push('');
  }

  const content = parts.join('\n');
  const result = await window.api.searchConfigExportAll(content);
  if (result.success && result.filePath) {
    // Could show notification, but keeping it simple
  }
}

// === Search Config Sessions ===

async function loadSearchConfigSessions(): Promise<void> {
  const result = await window.api.searchConfigSessionList();
  if (result.success && result.sessions) {
    searchConfigSessions = result.sessions;
  } else {
    searchConfigSessions = [];
  }
  renderSearchConfigSessionsUI();
}

function renderSearchConfigSessionsUI(): void {
  const container = elements.scSessionsChips;
  container.innerHTML = '';

  if (searchConfigSessions.length === 0 && state.searchConfigs.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  const fragment = document.createDocumentFragment();

  // Save Session button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'sc-session-save-btn';
  saveBtn.innerHTML = '&#128190; Save Session';
  saveBtn.title = 'Save current search configs as a reusable session';
  saveBtn.addEventListener('click', saveCurrentAsSearchConfigSession);
  fragment.appendChild(saveBtn);

  for (const session of searchConfigSessions) {
    const chip = document.createElement('span');
    chip.className = `sc-session-chip${session.id === activeSessionId ? ' active' : ''}`;
    chip.dataset.id = session.id;
    chip.title = `${escapeHtml(session.name)} (${session.configs.length} configs)${session.isGlobal ? ' [Global]' : ' [Local]'}`;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'sc-session-chip-name';
    nameSpan.textContent = session.name;

    const badge = document.createElement('span');
    badge.className = 'sc-session-chip-badge';
    badge.textContent = String(session.configs.length);

    chip.appendChild(nameSpan);
    chip.appendChild(badge);

    chip.addEventListener('click', () => applySearchConfigSession(session.id));
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showSearchConfigSessionContextMenu(e as MouseEvent, session);
    });

    fragment.appendChild(chip);
  }

  container.appendChild(fragment);
}

async function saveCurrentAsSearchConfigSession(): Promise<void> {
  if (state.searchConfigs.length === 0) {
    alert('No search configs to save. Add search configs first.');
    return;
  }

  const name = await showTextInputModal('Save Search Session', 'Session Name', 'e.g., Error investigation, Auth flow...');
  if (!name) return;

  // Default: global if all configs are global, local otherwise
  const allGlobal = state.searchConfigs.every(c => c.isGlobal);

  const session: SearchConfigSessionDef = {
    id: `scs-${Date.now()}`,
    name,
    configs: state.searchConfigs.map(c => {
      const { ...def } = c;
      return def;
    }),
    isGlobal: allGlobal,
    createdAt: Date.now(),
  };

  const result = await window.api.searchConfigSessionSave(session);
  if (result.success) {
    searchConfigSessions.push(session);
    activeSessionId = session.id;
    renderSearchConfigSessionsUI();
  }
}

async function applySearchConfigSession(sessionId: string): Promise<void> {
  const session = searchConfigSessions.find(s => s.id === sessionId);
  if (!session) return;

  // Clear current search configs
  for (const config of [...state.searchConfigs]) {
    await window.api.searchConfigDelete(config.id);
  }
  state.searchConfigs = [];
  state.searchConfigResults.clear();

  // Load session's configs
  for (const config of session.configs) {
    const newConfig = { ...config, id: `sc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` };
    await window.api.searchConfigSave(newConfig);
    state.searchConfigs.push(newConfig);
  }

  activeSessionId = sessionId;
  renderSearchConfigsChips();
  renderSearchConfigSessionsUI();

  // Run batch search
  if (state.searchConfigs.some(c => c.enabled)) {
    await runSearchConfigsBatch();
  }
}

function showSearchConfigSessionContextMenu(e: MouseEvent, session: SearchConfigSessionDef): void {
  document.querySelectorAll('.sc-context-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'sc-context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const renameItem = document.createElement('button');
  renameItem.className = 'sc-context-menu-item';
  renameItem.textContent = 'Rename';
  renameItem.addEventListener('click', async () => {
    menu.remove();
    const newName = await showTextInputModal('Rename Session', 'New Name', session.name);
    if (!newName) return;
    session.name = newName;
    const result = await window.api.searchConfigSessionSave(session);
    if (result.success) {
      const idx = searchConfigSessions.findIndex(s => s.id === session.id);
      if (idx >= 0) searchConfigSessions[idx] = session;
      renderSearchConfigSessionsUI();
    }
  });

  const deleteItem = document.createElement('button');
  deleteItem.className = 'sc-context-menu-item danger';
  deleteItem.textContent = 'Delete';
  deleteItem.addEventListener('click', async () => {
    menu.remove();
    if (!confirm(`Delete session "${session.name}"?`)) return;
    const result = await window.api.searchConfigSessionDelete(session.id, session.isGlobal);
    if (result.success) {
      searchConfigSessions = searchConfigSessions.filter(s => s.id !== session.id);
      if (activeSessionId === session.id) activeSessionId = null;
      renderSearchConfigSessionsUI();
    }
  });

  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);

  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// === Context Search ===

const CTX_DEFAULT_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
let ctxColorIndex = 0;

async function loadContextDefinitions(): Promise<void> {
  const result = await window.api.contextDefinitionsLoad();
  if (result.success && result.definitions) {
    state.contextDefinitions = result.definitions;
  }
  renderContextChips();
}

function renderContextChips(): void {
  const container = elements.ctxChips;
  container.innerHTML = '';

  for (const def of state.contextDefinitions) {
    const chip = document.createElement('div');
    chip.className = `ctx-chip${def.enabled ? '' : ' disabled'}`;

    const swatch = document.createElement('span');
    swatch.className = 'ctx-chip-swatch';
    swatch.style.backgroundColor = def.color;

    const name = document.createElement('span');
    name.className = 'ctx-chip-name';
    name.textContent = def.name;
    name.title = def.name;

    const count = document.createElement('span');
    count.className = 'ctx-chip-count';
    const groups = state.contextResults.get(def.id);
    count.textContent = groups ? `(${groups.length})` : '';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ctx-chip-toggle';
    toggleBtn.innerHTML = def.enabled ? '&#9673;' : '&#9675;';
    toggleBtn.title = def.enabled ? 'Disable' : 'Enable';
    toggleBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      def.enabled = !def.enabled;
      await window.api.contextDefinitionsSave(def);
      renderContextChips();
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'ctx-chip-edit';
    editBtn.textContent = 'edit';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextForm(def);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'ctx-chip-delete';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete context "${def.name}"?`)) return;
      await window.api.contextDefinitionDelete(def.id);
      state.contextDefinitions = state.contextDefinitions.filter(d => d.id !== def.id);
      state.contextResults.delete(def.id);
      renderContextChips();
      renderContextResults();
    });

    chip.appendChild(swatch);
    chip.appendChild(name);
    chip.appendChild(count);
    chip.appendChild(toggleBtn);
    chip.appendChild(editBtn);
    chip.appendChild(deleteBtn);
    container.appendChild(chip);
  }
}

function showContextForm(existingDef?: ContextDefinitionDef): void {
  const form = elements.ctxForm;
  form.classList.remove('hidden');
  form.innerHTML = '';
  state.editingContextId = existingDef?.id || null;

  const def = existingDef || {
    id: '',
    name: '',
    color: CTX_DEFAULT_COLORS[ctxColorIndex % CTX_DEFAULT_COLORS.length],
    patterns: [
      { id: `cp-${Date.now()}-1`, pattern: '', isRegex: false, matchCase: false, role: 'must' as const, distance: undefined, timeWindow: undefined },
    ],
    proximityMode: 'lines' as const,
    defaultDistance: 10,
    enabled: true,
    isGlobal: false,
    createdAt: 0,
  };

  // Name + color row
  const nameRow = document.createElement('div');
  nameRow.className = 'ctx-form-row';
  nameRow.innerHTML = `<label>Name</label>`;
  const nameInput = document.createElement('input');
  nameInput.className = 'ctx-form-input';
  nameInput.value = def.name;
  nameInput.placeholder = 'Context name...';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'ctx-color-input';
  colorInput.value = def.color;
  nameRow.appendChild(nameInput);
  nameRow.appendChild(colorInput);

  // Global toggle
  const globalLabel = document.createElement('label');
  globalLabel.style.cssText = 'font-size:10px;color:var(--text-secondary);display:flex;align-items:center;gap:3px';
  const globalCheck = document.createElement('input');
  globalCheck.type = 'checkbox';
  globalCheck.checked = def.isGlobal;
  globalLabel.appendChild(globalCheck);
  globalLabel.appendChild(document.createTextNode('Global'));
  nameRow.appendChild(globalLabel);
  form.appendChild(nameRow);

  // Patterns section
  const patSection = document.createElement('div');
  patSection.className = 'ctx-form-section';
  patSection.textContent = 'PATTERNS';
  form.appendChild(patSection);

  const patternsContainer = document.createElement('div');
  patternsContainer.id = 'ctx-patterns-container';

  function addPatternRow(pat: ContextPatternDef): void {
    const row = document.createElement('div');
    row.className = 'ctx-pattern-row';

    const roleSelect = document.createElement('select');
    roleSelect.className = 'ctx-pattern-role';
    roleSelect.innerHTML = `<option value="must">must</option><option value="clue">clue</option>`;
    roleSelect.value = pat.role;

    const patternInput = document.createElement('input');
    patternInput.className = 'ctx-pattern-input';
    patternInput.value = pat.pattern;
    patternInput.placeholder = 'Pattern...';

    const regexBtn = document.createElement('button');
    regexBtn.className = `ctx-pattern-toggle${pat.isRegex ? ' active' : ''}`;
    regexBtn.textContent = '.*';
    regexBtn.title = 'Regex';
    regexBtn.addEventListener('click', () => {
      regexBtn.classList.toggle('active');
    });

    const caseBtn = document.createElement('button');
    caseBtn.className = `ctx-pattern-toggle${pat.matchCase ? ' active' : ''}`;
    caseBtn.textContent = 'Aa';
    caseBtn.title = 'Match case';
    caseBtn.addEventListener('click', () => {
      caseBtn.classList.toggle('active');
    });

    const distInput = document.createElement('input');
    distInput.type = 'number';
    distInput.className = 'ctx-pattern-dist';
    distInput.value = pat.distance !== undefined ? String(pat.distance) : '';
    distInput.placeholder = '±N';
    distInput.title = 'Override distance for this pattern';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ctx-pattern-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(roleSelect);
    row.appendChild(patternInput);
    row.appendChild(regexBtn);
    row.appendChild(caseBtn);
    row.appendChild(distInput);
    row.appendChild(removeBtn);
    row.dataset.patId = pat.id;
    patternsContainer.appendChild(row);
  }

  for (const pat of def.patterns) addPatternRow(pat);
  form.appendChild(patternsContainer);

  const addPatBtn = document.createElement('button');
  addPatBtn.className = 'ctx-add-pattern-btn';
  addPatBtn.textContent = '+ Add pattern';
  addPatBtn.addEventListener('click', () => {
    addPatternRow({
      id: `cp-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      pattern: '',
      isRegex: false,
      matchCase: false,
      role: 'clue',
    });
  });
  form.appendChild(addPatBtn);

  // Proximity settings
  const proxRow = document.createElement('div');
  proxRow.className = 'ctx-proximity-row';
  proxRow.innerHTML = `<label>Proximity:</label>`;
  const distGlobal = document.createElement('input');
  distGlobal.type = 'number';
  distGlobal.className = 'ctx-proximity-input';
  distGlobal.value = String(def.defaultDistance);
  distGlobal.min = '1';
  const distLabel = document.createElement('label');
  distLabel.textContent = 'lines';
  proxRow.appendChild(distGlobal);
  proxRow.appendChild(distLabel);
  form.appendChild(proxRow);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'ctx-form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'ctx-form-btn primary';
  saveBtn.textContent = existingDef ? 'Update' : 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ctx-form-btn';
  cancelBtn.textContent = 'Cancel';

  cancelBtn.addEventListener('click', () => {
    form.classList.add('hidden');
    form.innerHTML = '';
    state.editingContextId = null;
  });

  saveBtn.addEventListener('click', async () => {
    const ctxName = nameInput.value.trim();
    if (!ctxName) { nameInput.focus(); return; }

    // Collect patterns
    const patRows = patternsContainer.querySelectorAll('.ctx-pattern-row');
    const patterns: ContextPatternDef[] = [];
    patRows.forEach((row) => {
      const r = row as HTMLElement;
      const role = (r.querySelector('.ctx-pattern-role') as HTMLSelectElement).value as 'must' | 'clue';
      const pattern = (r.querySelector('.ctx-pattern-input') as HTMLInputElement).value.trim();
      if (!pattern) return;
      const isRegex = r.querySelector('.ctx-pattern-toggle')?.classList.contains('active') || false;
      const toggles = r.querySelectorAll('.ctx-pattern-toggle');
      const matchCase = toggles[1]?.classList.contains('active') || false;
      const distVal = (r.querySelector('.ctx-pattern-dist') as HTMLInputElement).value;
      patterns.push({
        id: r.dataset.patId || `cp-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        pattern,
        isRegex,
        matchCase,
        role,
        distance: distVal ? parseInt(distVal, 10) : undefined,
      });
    });

    if (patterns.length === 0) return;
    if (!patterns.some(p => p.role === 'must')) {
      alert('At least one "must" pattern is required.');
      return;
    }

    const newDef: ContextDefinitionDef = {
      id: existingDef?.id || `ctx-${Date.now()}`,
      name: ctxName,
      color: colorInput.value,
      patterns,
      proximityMode: 'lines',
      defaultDistance: parseInt(distGlobal.value, 10) || 10,
      enabled: true,
      isGlobal: globalCheck.checked,
      createdAt: existingDef?.createdAt || Date.now(),
    };

    await window.api.contextDefinitionsSave(newDef);

    // Update local state
    const idx = state.contextDefinitions.findIndex(d => d.id === newDef.id);
    if (idx >= 0) {
      state.contextDefinitions[idx] = newDef;
    } else {
      state.contextDefinitions.push(newDef);
      ctxColorIndex++;
    }

    form.classList.add('hidden');
    form.innerHTML = '';
    state.editingContextId = null;
    renderContextChips();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);
  nameInput.focus();
}

async function runContextSearch(): Promise<void> {
  if (!state.filePath) {
    elements.ctxResultsSummary.textContent = 'No file open';
    return;
  }

  // Always reload definitions from disk before searching
  await loadContextDefinitions();

  const enabled = state.contextDefinitions.filter(d => d.enabled);
  if (enabled.length === 0) {
    elements.ctxResultsSummary.textContent = 'No enabled contexts';
    return;
  }

  elements.ctxResultsSummary.textContent = 'Searching...';
  showProgress('Context search... 0%');

  const cleanupProgress = window.api.onContextSearchProgress((data) => {
    updateProgress(data.percent);
    updateProgressText(`Context search... ${data.percent}%`);
  });

  try {
    const result = await window.api.contextSearch([]);
    cleanupProgress();
    hideProgress();

    if (result.success && result.results) {
      state.contextResults.clear();
      let totalGroups = 0;
      for (const r of result.results) {
        state.contextResults.set(r.contextId, r.groups);
        totalGroups += r.groups.length;
      }
      elements.ctxResultsSummary.textContent = `${totalGroups} match group${totalGroups !== 1 ? 's' : ''}`;
      renderContextChips();
      if (state.contextViewMode === 'tree') {
        renderContextResults();
      } else {
        renderContextLanes();
      }
    } else {
      elements.ctxResultsSummary.textContent = result.error || 'Search failed';
    }
  } catch (err) {
    cleanupProgress();
    hideProgress();
    elements.ctxResultsSummary.textContent = 'Search error';
  }
}

function renderContextResults(): void {
  const container = elements.ctxResults;
  container.innerHTML = '';
  // Only hide lanes when in tree-only mode (not when called from renderContextLanes)
  if (state.contextViewMode === 'tree') {
    elements.ctxLanes.classList.add('hidden');
  }
  container.style.display = '';

  if (state.contextGroupMode === 'combined') {
    renderContextResultsCombined(container);
  } else {
    renderContextResultsSeparate(container);
  }

  if (container.children.length === 0) {
    container.innerHTML = '<p class="placeholder">No context matches found. Create contexts and click Run.</p>';
  }
}

function renderContextResultsSeparate(container: HTMLDivElement): void {
  for (const def of state.contextDefinitions) {
    if (!def.enabled) continue;
    const groups = state.contextResults.get(def.id);
    if (!groups || groups.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'ctx-context-section';

    const header = document.createElement('div');
    header.className = 'ctx-context-header';
    header.style.borderLeftColor = def.color;
    header.style.background = `linear-gradient(to right, ${def.color}18, ${def.color}08 60%, #1c2230)`;
    const colorBar = document.createElement('span');
    colorBar.className = 'ctx-context-color-bar';
    colorBar.style.backgroundColor = def.color;
    colorBar.style.color = def.color;
    const headerName = document.createElement('span');
    headerName.textContent = def.name;
    const matchCount = document.createElement('span');
    matchCount.className = 'ctx-context-match-count';
    matchCount.textContent = `${groups.length} groups`;
    header.appendChild(colorBar);
    header.appendChild(headerName);
    header.appendChild(matchCount);
    section.appendChild(header);

    const shouldCollapseAll = groups.length > 10;

    groups.forEach((group, gi) => {
      section.appendChild(buildGroupElement(def, group, shouldCollapseAll && gi >= 3, false));
    });

    container.appendChild(section);
  }
}

function renderContextResultsCombined(container: HTMLDivElement): void {
  // Collect all groups with their context def, then sort by line number
  const allGroups: { def: ContextDefinitionDef; group: ContextMatchGroupDef }[] = [];
  for (const def of state.contextDefinitions) {
    if (!def.enabled) continue;
    const groups = state.contextResults.get(def.id);
    if (!groups || groups.length === 0) continue;
    for (const group of groups) {
      allGroups.push({ def, group });
    }
  }
  allGroups.sort((a, b) => a.group.mustLine - b.group.mustLine);

  const shouldCollapseAll = allGroups.length > 10;
  allGroups.forEach((item, i) => {
    container.appendChild(buildGroupElement(item.def, item.group, shouldCollapseAll && i >= 5, true));
  });
}

function buildGroupElement(def: ContextDefinitionDef, group: ContextMatchGroupDef, collapsed: boolean, showCtxTag: boolean): HTMLDivElement {
  const groupEl = document.createElement('div');
  groupEl.className = 'ctx-group';
  if (collapsed) groupEl.classList.add('collapsed');

  // Group header (must match line)
  const gHeader = document.createElement('div');
  gHeader.className = 'ctx-group-header';
  gHeader.style.borderLeft = `2px solid ${def.color}`;

  const toggle = document.createElement('span');
  toggle.className = 'ctx-group-toggle';
  toggle.textContent = collapsed ? '\u25B6' : '\u25BC';

  if (showCtxTag) {
    const ctxTag = document.createElement('span');
    ctxTag.className = 'ctx-group-ctx-tag';
    ctxTag.style.background = def.color;
    ctxTag.textContent = def.name;
    gHeader.appendChild(ctxTag);
  }

  const lineNum = document.createElement('span');
  lineNum.className = 'ctx-group-line-num';
  lineNum.textContent = `L${group.mustLine + 1}`;

  const text = document.createElement('span');
  text.className = 'ctx-group-text';
  text.textContent = group.mustText;
  text.title = group.mustText;

  const score = document.createElement('span');
  score.className = 'ctx-score-badge';
  score.textContent = `${group.score} clue${group.score !== 1 ? 's' : ''}`;

  gHeader.appendChild(toggle);
  gHeader.appendChild(lineNum);
  gHeader.appendChild(text);
  gHeader.appendChild(score);

  gHeader.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).classList.contains('ctx-group-toggle')) {
      groupEl.classList.toggle('collapsed');
      toggle.textContent = groupEl.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
    } else {
      goToLine(group.mustLine);
    }
  });

  groupEl.appendChild(gHeader);

  // Clue lines
  const cluesEl = document.createElement('div');
  cluesEl.className = 'ctx-group-clues';

  group.clues.forEach((clue, ci) => {
    const clueItem = document.createElement('div');
    clueItem.className = 'ctx-clue-item';

    const connector = document.createElement('span');
    connector.className = 'ctx-connector';
    connector.style.color = def.color;
    connector.textContent = ci === group.clues.length - 1 ? '\u2514\u2500' : '\u251C\u2500';

    const cLineNum = document.createElement('span');
    cLineNum.className = 'ctx-clue-line-num';
    cLineNum.textContent = `L${clue.lineNumber + 1}`;

    const cText = document.createElement('span');
    cText.className = 'ctx-clue-text';
    cText.textContent = clue.text;
    cText.title = clue.text;

    const dist = document.createElement('span');
    dist.className = 'ctx-clue-dist';
    dist.textContent = `\u00B1${clue.distance}`;

    clueItem.appendChild(connector);
    clueItem.appendChild(cLineNum);
    clueItem.appendChild(cText);
    clueItem.appendChild(dist);

    clueItem.addEventListener('click', () => goToLine(clue.lineNumber));
    cluesEl.appendChild(clueItem);
  });

  groupEl.appendChild(cluesEl);
  return groupEl;
}

function renderContextLanes(): void {
  const lanesEl = elements.ctxLanes;
  lanesEl.classList.remove('hidden');
  lanesEl.innerHTML = '';
  elements.ctxResults.style.display = '';

  const totalLines = getTotalLines() || 1;

  for (const def of state.contextDefinitions) {
    if (!def.enabled) continue;
    const groups = state.contextResults.get(def.id);
    if (!groups || groups.length === 0) continue;

    const lane = document.createElement('div');
    lane.className = 'ctx-lane';

    // Label with color swatch
    const label = document.createElement('div');
    label.className = 'ctx-lane-label';
    const swatch = document.createElement('span');
    swatch.className = 'ctx-lane-color';
    swatch.style.background = def.color;
    swatch.style.color = def.color;
    label.appendChild(swatch);
    label.appendChild(document.createTextNode(def.name));
    label.title = def.name;
    lane.appendChild(label);

    // Track with marks — tinted background per context color
    const track = document.createElement('div');
    track.className = 'ctx-lane-track';
    track.style.background = `linear-gradient(to right, ${def.color}15, ${def.color}08)`;

    for (const group of groups) {
      const mark = document.createElement('div');
      mark.className = 'ctx-lane-mark';
      mark.style.left = `${(group.mustLine / totalLines) * 100}%`;
      mark.style.background = def.color;
      mark.style.color = def.color;
      mark.title = `${def.name} — L${group.mustLine + 1}`;
      mark.addEventListener('click', () => {
        goToLine(group.mustLine);
        // Focus matching group in tree below
        const allGroups = elements.ctxResults.querySelectorAll('.ctx-group');
        allGroups.forEach(g => {
          g.classList.remove('focused');
          g.classList.add('faded');
        });
        const targetLineText = `L${group.mustLine + 1}`;
        allGroups.forEach(g => {
          const lineEl = g.querySelector('.ctx-group-line-num');
          if (lineEl && lineEl.textContent === targetLineText) {
            g.classList.remove('faded');
            g.classList.add('focused');
            g.classList.remove('collapsed');
            const toggleEl = g.querySelector('.ctx-group-toggle');
            if (toggleEl) toggleEl.textContent = '\u25BC';
            g.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        });
      });
      track.appendChild(mark);
    }

    lane.appendChild(track);
    lanesEl.appendChild(lane);
  }

  // Also render the tree below lanes
  renderContextResults();
}

function toggleContextView(mode: 'tree' | 'lanes'): void {
  state.contextViewMode = mode;
  elements.ctxViewTree.classList.toggle('active', mode === 'tree');
  elements.ctxViewLanes.classList.toggle('active', mode === 'lanes');

  if (mode === 'tree') {
    elements.ctxLanes.classList.add('hidden');
    renderContextResults();
  } else {
    renderContextLanes();
  }
}

function toggleContextGroupMode(mode: 'separate' | 'combined'): void {
  state.contextGroupMode = mode;
  elements.ctxGroupSeparate.classList.toggle('active', mode === 'separate');
  elements.ctxGroupCombined.classList.toggle('active', mode === 'combined');

  if (state.contextViewMode === 'lanes') {
    renderContextLanes();
  } else {
    renderContextResults();
  }
}

async function formatAndLoadJson(): Promise<void> {
  if (!state.filePath) return;

  if (!jsonFormattingEnabled) {
    // Enable JSON mode - format and open formatted file
    elements.btnJsonFormat.classList.add('active');
    const originalPath = state.filePath;

    showProgress('Formatting JSON... 0%');
    const unsubFormatProgress = (window.api as any).onJsonFormatProgress?.((data: { percent: number }) => {
      updateProgress(data.percent);
      updateProgressText(`Formatting JSON... ${data.percent}%`);
    });
    try {
      const result = await (window.api as any).formatJsonFile(originalPath);
      if (unsubFormatProgress) unsubFormatProgress();
      if (result.success && result.formattedPath) {
        jsonFormattingEnabled = true;
        jsonOriginalFile = originalPath;
        elements.longLinesWarning.classList.add('hidden');
        await loadFile(result.formattedPath);
      } else {
        elements.btnJsonFormat.classList.remove('active');
        hideProgress();
        // Show error in the warning bar
        const warningText = elements.longLinesWarning.querySelector('.warning-text');
        if (warningText && result.error) {
          warningText.innerHTML = `<strong>Format failed:</strong> ${escapeHtml(result.error)}`;
          elements.longLinesWarning.classList.remove('hidden');
          elements.btnFormatWarning.classList.add('hidden');
        }
      }
    } catch (error) {
      if (unsubFormatProgress) unsubFormatProgress();
      elements.btnJsonFormat.classList.remove('active');
      hideProgress();
    }
  } else {
    // Disable JSON mode - go back to original file
    jsonFormattingEnabled = false;
    elements.btnJsonFormat.classList.remove('active');

    if (jsonOriginalFile) {
      await loadFile(jsonOriginalFile);
      jsonOriginalFile = null;
    }
  }
}

async function loadFile(filePath: string, createNewTab: boolean = true): Promise<void> {
  // Check if file is already open in a tab BEFORE calling backend
  const existingTab = findTabByFilePath(filePath);
  if (existingTab && existingTab.id !== state.activeTabId) {
    // Switch to existing tab instead of re-opening
    await switchToTab(existingTab.id);
    renderFolderTree(); // Update active state in folder tree
    return;
  }

  // Handle image files in bottom panel (like video)
  if (isImageFile(filePath)) {
    openImageInPanel(filePath);
    return;
  }

  showProgress('Indexing file...');

  const unsubscribe = window.api.onIndexingProgress((progress) => {
    updateProgress(progress);
    updateProgressText(`Indexing file... ${progress}%`);
  });

  try {
    const result = await window.api.openFile(filePath);

    if (result.success && result.info) {

      // Save current tab state before switching (if there's an active tab)
      if (state.activeTabId && createNewTab) {
        saveCurrentTabState();
      }

      // Create new tab or update current one
      if (createNewTab && !existingTab) {
        const newTab = createTab(filePath);
        state.tabs.push(newTab);
        state.activeTabId = newTab.id;
      }

      state.filePath = filePath;
      state.fileStats = {
        path: result.info.path,
        size: result.info.size,
        totalLines: result.info.totalLines,
        indexedAt: Date.now(),
      };
      state.totalLines = result.info.totalLines;
      state.isFiltered = false;
      state.filteredLines = null;
      state.searchResults = [];
      state.currentSearchIndex = -1;
      state.hiddenSearchMatches = [];
      if (state.activeBottomTab === 'search-results') {
        renderSearchResultsList();
      }
      state.currentNotesFile = null; // Reset notes file for new log file
      cachedLines.clear();

      // Clear highlight navigation cache for new file
      highlightMatches.clear();
      highlightCurrentIndex.clear();

      // Load bookmarks from file open response (persisted per-file)
      if (result.bookmarks && Array.isArray(result.bookmarks)) {
        state.bookmarks = result.bookmarks;
      } else {
        state.bookmarks = [];
      }
      updateBookmarksUI();

      // Load highlights from file open response (global + file-specific)
      if (result.highlights && Array.isArray(result.highlights)) {
        state.highlights = result.highlights;
      } else {
        state.highlights = [];
      }
      updateHighlightsUI();

      // Handle split file detection (from opening an existing split file or header metadata)
      if (result.splitFiles && result.splitFiles.length > 0) {
        // Only update split state if not already navigating within the same split set
        if (state.splitFiles.length === 0 || !state.splitFiles.includes(filePath)) {
          state.splitFiles = result.splitFiles;
        }
        // Use the index from backend if available, otherwise find it
        state.currentSplitIndex = result.splitIndex ?? result.splitFiles.indexOf(filePath);
        if (state.currentSplitIndex === -1) state.currentSplitIndex = 0;
      } else {
        // Clear split state if opening a non-split file
        state.splitFiles = [];
        state.currentSplitIndex = -1;
      }

      // Update the current tab with the loaded data
      if (state.activeTabId) {
        const currentTab = state.tabs.find(t => t.id === state.activeTabId);
        if (currentTab) {
          currentTab.filePath = filePath;
          currentTab.fileStats = state.fileStats;
          currentTab.totalLines = state.totalLines;
          currentTab.splitFiles = state.splitFiles;
          currentTab.currentSplitIndex = state.currentSplitIndex;
        }
      }

      updateFileStatsUI();
      createLogViewer();
      renderTabBar();
      renderFolderTree(); // Update active file highlight

      // Auto-cd terminal to file's directory
      terminalCdToFile(filePath);

      // Wait for DOM layout before loading lines
      await new Promise(resolve => requestAnimationFrame(resolve));

      // Initialize visible range based on container size
      if (logViewerElement) {
        const containerHeight = logViewerElement.clientHeight;
        const visibleLines = Math.ceil(containerHeight / getLineHeight());
        state.visibleStartLine = 0;
        state.visibleEndLine = Math.min(visibleLines + BUFFER_LINES * 2, getTotalLines() - 1);
      }

      await loadVisibleLines();

      elements.btnAnalyze.disabled = false;
      elements.btnSplit.disabled = false;
      elements.btnColumns.disabled = false;
      state.columnConfig = null; // Reset column config for new file

      // Show warning for files with long lines (only for JSON-like files where reformatting helps)
      const lowerPath = filePath.toLowerCase();
      const isJsonLike = lowerPath.endsWith('.json') || lowerPath.endsWith('.jsonl') || lowerPath.endsWith('.ndjson');
      if (result.hasLongLines && isJsonLike) {
        elements.longLinesWarning.classList.remove('hidden');
      } else {
        elements.longLinesWarning.classList.add('hidden');
      }

      // Reset JSON formatting state for non-formatted files
      if (!filePath.includes('.formatted.')) {
        jsonFormattingEnabled = false;
        jsonOriginalFile = null;
        elements.btnJsonFormat.classList.remove('active');

        // Auto-activate JSON formatting for .json files
        if (isJsonLike) {
          formatAndLoadJson();
        }
      }

      // Reset scroll slowness detection
      slowScrollFrames = 0;
      scrollSlownessWarningShown = false;

      updateStatusBar();
      updateLocalStorageStatus();
      updateSplitNavigation();

      // Check if this is a markdown file
      isMarkdownFile = isMarkdownExtension(filePath);
      if (isMarkdownFile) {
        // Show markdown preview by default
        markdownPreviewMode = true;
        elements.btnWordWrap.textContent = 'Raw';
        elements.btnWordWrap.title = 'Show raw markdown';
        await renderMarkdownPreview();
        showMarkdownPreview();
      } else {
        // Reset for non-markdown files
        markdownPreviewMode = false;
        isMarkdownFile = false;
        elements.markdownPreview.classList.add('hidden');
        elements.markdownPreview.innerHTML = '';
        elements.btnWordWrap.textContent = 'Wrap';
        elements.btnWordWrap.title = 'Toggle word wrap (⌥Z)';
        const wrapper = document.querySelector('.log-viewer-wrapper') as HTMLElement;
        if (wrapper) {
          wrapper.style.display = '';
        }
      }

      // Restore video player state for this file
      restoreVideoState();

      // Load search configs, sessions, and context definitions for this file
      loadSearchConfigs();
      loadSearchConfigSessions();
      loadContextDefinitions();

      // Build minimap with progress
      unsubscribe(); // Stop listening to indexing progress
      showProgress('Building minimap...');
      await buildMinimap((percent) => {
        updateProgress(percent);
        updateProgressText(`Building minimap... ${percent}%`);
      });

      // Auto-analyze if enabled in settings
      if (userSettings.autoAnalyze && !isMarkdownFile) {
        hideProgress();
        await analyzeFile();
      }
    } else {
      alert(`Failed to open file: ${result.error}`);
    }
  } finally {
    hideProgress();
  }
}

// Add a tab for a file without loading it (tab loads when clicked)
async function loadFileAsInactiveTab(filePath: string): Promise<void> {
  // Check if already open
  const existingTab = findTabByFilePath(filePath);
  if (existingTab) {
    return; // Already has a tab
  }

  // Create tab entry without loading
  const newTab = createTab(filePath);
  state.tabs.push(newTab);
  renderTabBar();
}

// Refresh the currently active tab (reload file content)
async function refreshActiveTab(): Promise<void> {
  if (!state.filePath) return;

  try {
    const result = await window.api.openFile(state.filePath);

    if (result.success && result.info) {
      state.totalLines = result.info.totalLines;
      state.fileStats = {
        path: result.info.path,
        size: result.info.size,
        totalLines: result.info.totalLines,
        indexedAt: Date.now(),
      };

      // Clear cache and re-render
      cachedLines.clear();
      renderVisibleLines();
      updateStatusBar();
    }
  } catch (error) {
    console.error('Failed to refresh tab:', error);
  }
}

// Analysis
async function analyzeFile(): Promise<void> {
  if (!state.filePath) return;

  openBottomTab('analysis');
  showProgress('Analyzing...');
  elements.btnAnalyze.disabled = true;

  const unsubscribe = window.api.onAnalyzeProgress((progress) => {
    const message = progress.message || progress.phase;
    updateProgressText(`${message} ${progress.percent}%`);
    updateProgress(progress.percent);
  });

  try {
    // Use default analyzer (rule-based) - runs async without blocking UI
    const result = await window.api.analyzeFile();

    if (result.success && result.result) {
      state.analysisResult = result.result;
      state.comparisonReport = null;
      await loadBaselineList();
      updateAnalysisUI();
    } else {
      elements.analysisResults.innerHTML = `<p class="placeholder" style="color: var(--error-color);">Analysis failed: ${result.error}</p>`;
    }
  } catch (error) {
    elements.analysisResults.innerHTML = `<p class="placeholder" style="color: var(--error-color);">Analysis error: ${error}</p>`;
  } finally {
    unsubscribe();
    hideProgress();
    elements.btnAnalyze.disabled = false;
  }
}

// Column visibility
async function showColumnsModal(): Promise<void> {
  if (!state.filePath) return;

  elements.columnsModal.classList.remove('hidden');
  elements.columnsLoading.style.display = 'block';
  elements.columnsContent.style.display = 'none';

  try {
    const result = await window.api.analyzeColumns();

    if (result.success && result.analysis) {
      const { delimiter, delimiterName, columns } = result.analysis;

      // Restore previous visibility if we have a config
      if (state.columnConfig && state.columnConfig.delimiter === delimiter) {
        // Keep existing visibility settings
        for (let i = 0; i < columns.length; i++) {
          if (i < state.columnConfig.columns.length) {
            columns[i].visible = state.columnConfig.columns[i].visible;
          }
        }
      }

      const hasHeader = (result.analysis as any).hasHeaderRow;
      elements.columnsDelimiter.textContent = delimiterName + (hasHeader ? ' (header detected)' : '');

      // Render column list
      elements.columnsList.innerHTML = columns.map((col: ColumnInfo, idx: number) => {
        const colName = (col as any).name;
        const label = colName ? `Col ${idx + 1} (${escapeHtml(colName)})` : `Col ${idx + 1}`;
        const samples = col.sample.slice(0, 3).map((s: string) => s.length > 30 ? s.substring(0, 27) + '...' : s);
        return `
          <div class="column-item">
            <label class="checkbox-label">
              <input type="checkbox" data-col-index="${idx}" ${col.visible ? 'checked' : ''}>
              <span class="column-index">${label}</span>
            </label>
            <div class="column-samples">${samples.map((s: string) => `<code>${escapeHtml(s)}</code>`).join(' ')}</div>
          </div>
        `;
      }).join('');

      // Store temporarily for apply
      (elements.columnsModal as any)._tempConfig = { delimiter, delimiterName, columns };

      elements.columnsLoading.style.display = 'none';
      elements.columnsContent.style.display = 'block';
    } else {
      elements.columnsLoading.textContent = result.error || 'Failed to analyze columns';
    }
  } catch (error) {
    elements.columnsLoading.textContent = `Error: ${error}`;
  }
}

function hideColumnsModal(): void {
  elements.columnsModal.classList.add('hidden');
}

function applyColumnsConfig(): void {
  const tempConfig = (elements.columnsModal as any)._tempConfig;
  if (!tempConfig) return;

  // Read checkbox states
  const checkboxes = elements.columnsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    const idx = parseInt(cb.dataset.colIndex || '0', 10);
    if (idx < tempConfig.columns.length) {
      tempConfig.columns[idx].visible = cb.checked;
    }
  });

  state.columnConfig = {
    delimiter: tempConfig.delimiter,
    delimiterName: tempConfig.delimiterName,
    columns: tempConfig.columns.map((c: any) => ({
      index: c.index,
      sample: c.sample,
      visible: c.visible,
    })),
  };

  hideColumnsModal();

  // Re-render visible lines with new column filter
  if (logContentElement) {
    logContentElement.innerHTML = '';
    lineElementPool.releaseAll();
  }
  loadVisibleLines();
}

function setAllColumnsVisibility(visible: boolean): void {
  const checkboxes = elements.columnsList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    cb.checked = visible;
  });
}

// Apply column filter to a line of text
function applyColumnFilter(text: string): string {
  if (!state.columnConfig || state.columnConfig.columns.every(c => c.visible)) {
    return text;
  }

  const { delimiter, columns } = state.columnConfig;
  let parts: string[];

  if (delimiter === ' ') {
    parts = text.split(/\s+/);
  } else {
    parts = text.split(delimiter);
  }

  // Build filtered text with only visible columns
  const visibleParts = parts.filter((_, idx) => {
    return idx < columns.length ? columns[idx].visible : true;
  });

  return visibleParts.join(delimiter === ' ' ? ' ' : delimiter);
}

// Search
async function performSearch(): Promise<void> {
  const pattern = elements.searchInput.value;
  if (!pattern || !state.filePath) return;

  showProgress('Searching...');

  const unsubscribe = window.api.onSearchProgress((data) => {
    updateProgress(data.percent);
    elements.progressText.textContent = `Searching... ${data.matchCount} matches`;
  });

  try {
    // Build search options with column config if available
    const searchOptions: SearchOptions = {
      pattern,
      isRegex: elements.searchRegex.checked,
      isWildcard: elements.searchWildcard.checked,
      matchCase: elements.searchCase.checked,
      wholeWord: elements.searchWholeWord.checked,
    };

    // Add column config if columns are filtered
    if (state.columnConfig && state.columnConfig.columns.some(c => !c.visible)) {
      searchOptions.columnConfig = {
        delimiter: state.columnConfig.delimiter,
        columns: state.columnConfig.columns.map(c => ({ index: c.index, visible: c.visible })),
      };
    }

    const result = await window.api.search(searchOptions);

    if (result.success && result.matches) {
      state.searchResults = result.matches;
      // Merge hidden matches from filter and from hidden columns
      const filterHidden: HiddenMatch[] = (result as any).hiddenMatches || [];
      const columnHidden: HiddenMatch[] = (result as any).hiddenColumnMatches || [];
      state.hiddenSearchMatches = [...filterHidden, ...columnHidden];

      // Determine starting match index based on direction and start line
      const startLineVal = parseInt(elements.searchStartLine.value, 10);
      const startLine = startLineVal > 0 ? startLineVal - 1 : null; // Convert to 0-indexed

      if (result.matches.length > 0 && startLine !== null) {
        if (searchDirection === 'forward') {
          const idx = result.matches.findIndex(m => m.lineNumber >= startLine);
          state.currentSearchIndex = idx >= 0 ? idx : 0;
        } else {
          // Backward: find last match at or before startLine
          let idx = -1;
          for (let i = result.matches.length - 1; i >= 0; i--) {
            if (result.matches[i].lineNumber <= startLine) { idx = i; break; }
          }
          state.currentSearchIndex = idx >= 0 ? idx : result.matches.length - 1;
        }
      } else {
        state.currentSearchIndex = result.matches.length > 0 ? 0 : -1;
      }

      updateSearchUI();
      updateHiddenMatchesBadge();
      renderMinimapMarkers(); // Update minimap with search markers
      renderVisibleLines(); // Re-render to show search highlights

      // Always render search results list and auto-show panel if results exist
      renderSearchResultsList();
      if (result.matches.length > 0 && state.activeBottomTab !== 'search-results') {
        openBottomTab('search-results');
      }

      if (state.currentSearchIndex >= 0) {
        goToSearchResult(state.currentSearchIndex);
      }
    }
  } finally {
    unsubscribe();
    hideProgress();
  }
}

function updateSearchUI(): void {
  const count = state.searchResults.length;
  const arrow = searchDirection === 'forward' ? '\u2193' : '\u2191';
  const startLineVal = parseInt(elements.searchStartLine.value, 10);
  let label = count > 0 ? `${state.currentSearchIndex + 1}/${count}` : 'No results';
  if (count > 0 && startLineVal > 0) {
    label += ` ${arrow}Ln ${startLineVal}`;
  }
  elements.searchResultCount.textContent = label;
  elements.btnPrevResult.disabled = count === 0;
  elements.btnNextResult.disabled = count === 0;
}

// Hidden matches badge and peek preview
let peekLineNumber: number | null = null;

function updateHiddenMatchesBadge(): void {
  const count = state.hiddenSearchMatches.length;
  if (count > 0) {
    elements.hiddenMatchesBadge.textContent = `+${count} hidden`;
    elements.hiddenMatchesBadge.title = `${count} matches found in filtered-out lines. Click to preview.`;
    elements.hiddenMatchesBadge.classList.remove('hidden');
  } else {
    elements.hiddenMatchesBadge.classList.add('hidden');
    elements.hiddenMatchesPopup.classList.add('hidden');
    closePeekPreview();
  }
}

function showHiddenMatchesPopup(): void {
  const matches = state.hiddenSearchMatches;
  if (matches.length === 0) return;

  const list = elements.hiddenMatchesList;
  list.innerHTML = '';

  const displayLimit = Math.min(matches.length, 200);
  const searchPattern = elements.searchInput.value;

  for (let i = 0; i < displayLimit; i++) {
    const m = matches[i];
    const item = document.createElement('div');
    item.className = 'hidden-match-item';

    const lineNum = document.createElement('span');
    lineNum.className = 'hidden-match-line-num';
    lineNum.textContent = `Ln ${m.lineNumber + 1}`;

    const text = document.createElement('span');
    text.className = 'hidden-match-text';
    // Highlight match in text
    const lineText = m.lineText || '';
    const truncated = lineText.length > 200 ? lineText.substring(0, 200) + '...' : lineText;
    if (searchPattern && m.column >= 0 && m.length > 0) {
      const before = escapeHtml(truncated.substring(0, m.column));
      const match = escapeHtml(truncated.substring(m.column, m.column + m.length));
      const after = escapeHtml(truncated.substring(m.column + m.length));
      text.innerHTML = `${before}<mark>${match}</mark>${after}`;
    } else {
      text.textContent = truncated;
    }

    item.appendChild(lineNum);
    item.appendChild(text);
    item.addEventListener('click', () => showPeekPreview(m));

    list.appendChild(item);
  }

  if (matches.length > displayLimit) {
    const more = document.createElement('div');
    more.className = 'hidden-match-item';
    more.style.justifyContent = 'center';
    more.style.color = 'var(--text-muted)';
    more.textContent = `... and ${matches.length - displayLimit} more`;
    list.appendChild(more);
  }

  elements.hiddenMatchesPopup.classList.remove('hidden');
}

function showPeekPreview(match: HiddenMatch): void {
  peekLineNumber = match.lineNumber;
  const searchPattern = elements.searchInput.value;

  elements.peekPreviewTitle.textContent = `Hidden Match - Line ${match.lineNumber + 1}`;

  // Show the match line with 3 lines of context above and below
  const contextLines = 3;
  const startLine = Math.max(0, match.lineNumber - contextLines);
  const endLine = Math.min(state.totalLines - 1, match.lineNumber + contextLines);

  // Fetch lines around the match
  window.api.getLines(startLine, endLine - startLine + 1).then(result => {
    if (!result.success || !result.lines) return;

    const content = elements.peekPreviewContent;
    content.innerHTML = '';

    for (const line of result.lines) {
      const lineEl = document.createElement('div');
      lineEl.className = 'peek-line';
      if (line.lineNumber === match.lineNumber) {
        lineEl.classList.add('peek-match-line');
      }

      const numEl = document.createElement('span');
      numEl.className = 'peek-line-num';
      numEl.textContent = String(line.lineNumber + 1);

      const textEl = document.createElement('span');
      textEl.className = 'peek-line-text';

      // Highlight match text on the match line
      if (line.lineNumber === match.lineNumber && searchPattern && match.column >= 0 && match.length > 0) {
        const before = escapeHtml(line.text.substring(0, match.column));
        const matchText = escapeHtml(line.text.substring(match.column, match.column + match.length));
        const after = escapeHtml(line.text.substring(match.column + match.length));
        textEl.innerHTML = `${before}<mark>${matchText}</mark>${after}`;
      } else {
        textEl.textContent = line.text;
      }

      lineEl.appendChild(numEl);
      lineEl.appendChild(textEl);
      content.appendChild(lineEl);
    }
  });

  elements.peekPreview.classList.remove('hidden');
}

function closePeekPreview(): void {
  elements.peekPreview.classList.add('hidden');
  peekLineNumber = null;
}

async function peekClearFilterAndGoToLine(): Promise<void> {
  if (peekLineNumber === null) return;
  const lineNum = peekLineNumber;
  closePeekPreview();
  elements.hiddenMatchesPopup.classList.add('hidden');

  // Clear filter
  await clearFilter();

  // Go to line
  goToLine(lineNum);
  renderVisibleLines();
}

function navigateSearchNext(): void {
  if (state.searchResults.length === 0) return;
  const delta = searchDirection === 'forward' ? 1 : -1;
  const idx = (state.currentSearchIndex + delta + state.searchResults.length) % state.searchResults.length;
  goToSearchResult(idx);
}

function navigateSearchPrev(): void {
  if (state.searchResults.length === 0) return;
  const delta = searchDirection === 'forward' ? -1 : 1;
  const idx = (state.currentSearchIndex + delta + state.searchResults.length) % state.searchResults.length;
  goToSearchResult(idx);
}

function goToSearchResult(index: number): void {
  if (index < 0 || index >= state.searchResults.length) return;

  state.currentSearchIndex = index;
  const result = state.searchResults[index];
  // When filtered, scroll to display index but select by original line number
  const scrollTarget = state.isFiltered && result.displayIndex != null
    ? result.displayIndex : result.lineNumber;
  goToLine(scrollTarget);
  state.selectedLine = result.lineNumber; // original line number for highlight matching
  updateSearchUI();
  renderVisibleLines(); // Update current match highlight
  updateSearchResultsCurrent();
  scrollSearchResultIntoView();
}

function goToLine(lineNumber: number): void {
  if (!logViewerElement) return;

  state.selectedLine = lineNumber;
  // Use scroll mapping for large files
  const targetScrollTop = lineToScrollTop(lineNumber);
  logViewerElement.scrollTop = Math.max(0, targetScrollTop);
  updateCursorStatus(lineNumber);
}

// Filter
function addIncludePatternRow(pattern = '', caseSensitive = true): void {
  const row = document.createElement('div');
  row.className = 'include-pattern-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = pattern;
  input.placeholder = 'e.g., error';

  const caseBtn = document.createElement('button');
  caseBtn.className = 'include-pattern-case-btn' + (caseSensitive ? ' active' : '');
  caseBtn.textContent = 'Aa';
  caseBtn.title = caseSensitive ? 'Case sensitive (click to toggle)' : 'Case insensitive (click to toggle)';
  caseBtn.type = 'button';
  caseBtn.addEventListener('click', () => {
    caseBtn.classList.toggle('active');
    caseBtn.title = caseBtn.classList.contains('active')
      ? 'Case sensitive (click to toggle)'
      : 'Case insensitive (click to toggle)';
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'include-pattern-remove-btn';
  removeBtn.textContent = '\u00d7';
  removeBtn.title = 'Remove pattern';
  removeBtn.type = 'button';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(input, caseBtn, removeBtn);
  elements.includePatternsContainer.appendChild(row);
  input.focus();
}

function getIncludePatterns(): IncludePattern[] {
  const rows = elements.includePatternsContainer.querySelectorAll('.include-pattern-row');
  const patterns: IncludePattern[] = [];
  rows.forEach(row => {
    const input = row.querySelector('input') as HTMLInputElement;
    const caseBtn = row.querySelector('.include-pattern-case-btn') as HTMLElement;
    const val = input.value.trim();
    if (val) {
      patterns.push({
        pattern: val,
        caseSensitive: caseBtn.classList.contains('active'),
      });
    }
  });
  return patterns;
}

function showFilterModal(): void {
  elements.filterModal.classList.remove('hidden');
  // Add an empty row if container is empty
  if (elements.includePatternsContainer.children.length === 0) {
    addIncludePatternRow();
  }
}

function hideFilterModal(): void {
  elements.filterModal.classList.add('hidden');
}

async function applyFilter(providedConfig?: FilterConfig): Promise<void> {
  let config: FilterConfig;

  if (providedConfig) {
    config = providedConfig;
  } else {
    const levelCheckboxes = document.querySelectorAll<HTMLInputElement>(
      'input[name="level"]:checked'
    );
    const levels = Array.from(levelCheckboxes).map((cb) => cb.value);

    config = {
      levels,
      includePatterns: getIncludePatterns(),
      excludePatterns: elements.excludePatterns.value
        .split('\n')
        .filter((p) => p.trim()),
      matchCase: elements.filterMatchCase?.checked || false,
      exactMatch: elements.filterExactMatch?.checked || false,
      contextLines: elements.basicContextLines ? parseInt(elements.basicContextLines.value) || 0 : 0,
    };
  }

  if (!state.analysisResult) {
    alert('Please run analysis first before applying filters.');
    return;
  }

  showProgress('Applying filter...');

  // Listen for progress updates from the main process
  const removeProgressListener = window.api.onFilterProgress(({ percent }) => {
    updateProgress(percent);
    updateProgressText(`Applying filter... ${percent}%`);
  });

  try {
    const result = await window.api.applyFilter(config);

    if (result.success && result.stats) {
      state.isFiltered = true;
      state.filteredLines = result.stats.filteredLines;
      cachedLines.clear();

      // Reset scroll to top of filtered view
      state.visibleStartLine = 0;
      state.visibleEndLine = Math.min(100, state.filteredLines - 1);
      if (logViewerElement) {
        logViewerElement.scrollTop = 0;
      }

      hideFilterModal();
      await loadVisibleLines();
      updateStatusBar();
    } else if (result.error !== 'Cancelled') {
      alert(`Failed to apply filter: ${result.error}`);
    }
  } finally {
    removeProgressListener();
    hideProgress();
  }
}

async function clearFilter(): Promise<void> {
  state.isFiltered = false;
  state.filteredLines = null;
  state.activeLevelFilter = null;
  state.appliedFilterSuggestion = null;
  cachedLines.clear();

  // Clear backend filter state
  await window.api.clearFilter();

  hideFilterModal();
  await loadVisibleLines();
  updateStatusBar();
  updateLevelBadgeStyles();
}

async function applyQuickLevelFilter(level: string): Promise<void> {
  if (!state.analysisResult) return;

  const config: FilterConfig = {
    levels: [level],
    includePatterns: [],
    excludePatterns: [],
    contextLines: 3,
  };

  showProgress(`Filtering ${level}...`);

  const removeProgressListener = window.api.onFilterProgress(({ percent }) => {
    updateProgress(percent);
    updateProgressText(`Filtering ${level}... ${percent}%`);
  });

  try {
    const result = await window.api.applyFilter(config);

    if (result.success && result.stats) {
      state.isFiltered = true;
      state.filteredLines = result.stats.filteredLines;
      state.activeLevelFilter = level;
      cachedLines.clear();

      // Reset scroll to top of filtered view
      state.visibleStartLine = 0;
      state.visibleEndLine = Math.min(100, state.filteredLines - 1);
      if (logViewerElement) {
        logViewerElement.scrollTop = 0;
      }

      await loadVisibleLines();
      updateStatusBar();
      updateLevelBadgeStyles();
    }
  } finally {
    removeProgressListener();
    hideProgress();
  }
}

function updateLevelBadgeStyles(): void {
  elements.analysisResults.querySelectorAll('.level-badge[data-level]').forEach((badge) => {
    const level = (badge as HTMLElement).dataset.level;
    if (state.activeLevelFilter && state.activeLevelFilter === level) {
      badge.classList.add('active-filter');
    } else {
      badge.classList.remove('active-filter');
    }
  });
}

// === Advanced Filter ===

function showAdvancedFilterModal(): void {
  // Initialize with one empty group if no groups exist
  if (advancedFilterGroups.length === 0) {
    addFilterGroup();
  }
  renderAdvancedFilterUI();
  elements.filterModal.classList.add('hidden');
  elements.advancedFilterModal.classList.remove('hidden');
}

function hideAdvancedFilterModal(): void {
  elements.advancedFilterModal.classList.add('hidden');
}

function addFilterGroup(): void {
  const newGroup: FilterGroup = {
    id: generateFilterId(),
    operator: 'OR',
    rules: [{
      id: generateFilterId(),
      type: 'contains',
      value: '',
      caseSensitive: false,
    }],
  };
  advancedFilterGroups.push(newGroup);
  renderAdvancedFilterUI();
}

function removeFilterGroup(groupId: string): void {
  advancedFilterGroups = advancedFilterGroups.filter(g => g.id !== groupId);
  renderAdvancedFilterUI();
}

function addFilterRule(groupId: string): void {
  const group = advancedFilterGroups.find(g => g.id === groupId);
  if (group) {
    group.rules.push({
      id: generateFilterId(),
      type: 'contains',
      value: '',
      caseSensitive: false,
    });
    renderAdvancedFilterUI();
  }
}

function removeFilterRule(groupId: string, ruleId: string): void {
  const group = advancedFilterGroups.find(g => g.id === groupId);
  if (group) {
    group.rules = group.rules.filter(r => r.id !== ruleId);
    // Remove group if no rules left
    if (group.rules.length === 0) {
      removeFilterGroup(groupId);
    } else {
      renderAdvancedFilterUI();
    }
  }
}

function updateFilterGroupOperator(groupId: string, operator: 'AND' | 'OR'): void {
  const group = advancedFilterGroups.find(g => g.id === groupId);
  if (group) {
    group.operator = operator;
  }
}

function updateFilterRule(groupId: string, ruleId: string, updates: Partial<FilterRule>): void {
  const group = advancedFilterGroups.find(g => g.id === groupId);
  if (group) {
    const rule = group.rules.find(r => r.id === ruleId);
    if (rule) {
      Object.assign(rule, updates);
    }
  }
}

function renderAdvancedFilterUI(): void {
  const container = elements.filterGroupsContainer;
  container.innerHTML = '';

  advancedFilterGroups.forEach((group, groupIndex) => {
    // Add AND connector between groups
    if (groupIndex > 0) {
      const connector = document.createElement('div');
      connector.className = 'filter-group-connector';
      connector.textContent = 'AND';
      container.appendChild(connector);
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'filter-group-card';
    groupEl.dataset.groupId = group.id;

    groupEl.innerHTML = `
      <div class="filter-group-header">
        <span class="filter-group-title">Group ${groupIndex + 1}</span>
        <div class="filter-group-controls">
          <select class="filter-group-operator" data-group-id="${group.id}">
            <option value="OR" ${group.operator === 'OR' ? 'selected' : ''}>OR (any match)</option>
            <option value="AND" ${group.operator === 'AND' ? 'selected' : ''}>AND (all match)</option>
          </select>
          <button class="filter-group-remove" data-group-id="${group.id}" title="Remove group">&times;</button>
        </div>
      </div>
      <div class="filter-rules-list">
        ${group.rules.map(rule => renderFilterRuleHTML(group.id, rule)).join('')}
      </div>
      <button class="filter-add-rule-btn" data-group-id="${group.id}">+ Add Rule</button>
    `;

    container.appendChild(groupEl);
  });

  // Attach event listeners
  attachAdvancedFilterEventListeners();
}

function renderFilterRuleHTML(groupId: string, rule: FilterRule): string {
  const isLevelType = rule.type === 'level' || rule.type === 'not_level';
  const showCaseSensitive = !isLevelType;

  const levelOptions = ['error', 'warning', 'info', 'debug', 'trace']
    .map(l => `<option value="${l}" ${rule.value === l ? 'selected' : ''}>${l}</option>`)
    .join('');

  const valueInput = isLevelType
    ? `<select class="filter-rule-value level-select" data-group-id="${groupId}" data-rule-id="${rule.id}" data-field="value">
        ${levelOptions}
      </select>`
    : `<input type="text" class="filter-rule-value" data-group-id="${groupId}" data-rule-id="${rule.id}" data-field="value"
        value="${escapeHtml(rule.value)}" placeholder="Enter pattern...">`;

  return `
    <div class="filter-rule-row" data-rule-id="${rule.id}">
      <select class="filter-rule-type" data-group-id="${groupId}" data-rule-id="${rule.id}">
        <option value="contains" ${rule.type === 'contains' ? 'selected' : ''}>contains</option>
        <option value="not_contains" ${rule.type === 'not_contains' ? 'selected' : ''}>not contains</option>
        <option value="level" ${rule.type === 'level' ? 'selected' : ''}>level is</option>
        <option value="not_level" ${rule.type === 'not_level' ? 'selected' : ''}>level is not</option>
        <option value="regex" ${rule.type === 'regex' ? 'selected' : ''}>matches regex</option>
        <option value="not_regex" ${rule.type === 'not_regex' ? 'selected' : ''}>not matches regex</option>
      </select>
      ${valueInput}
      ${showCaseSensitive ? `
        <div class="filter-rule-options">
          <button class="filter-rule-case ${rule.caseSensitive ? 'active' : ''}"
            data-group-id="${groupId}" data-rule-id="${rule.id}" title="Case sensitive">Aa</button>
        </div>
      ` : ''}
      <button class="filter-rule-remove" data-group-id="${groupId}" data-rule-id="${rule.id}" title="Remove rule">&times;</button>
    </div>
  `;
}

function attachAdvancedFilterEventListeners(): void {
  // Group operator change
  elements.filterGroupsContainer.querySelectorAll('.filter-group-operator').forEach(el => {
    el.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      const groupId = target.dataset.groupId!;
      updateFilterGroupOperator(groupId, target.value as 'AND' | 'OR');
    });
  });

  // Remove group
  elements.filterGroupsContainer.querySelectorAll('.filter-group-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const groupId = target.dataset.groupId!;
      removeFilterGroup(groupId);
    });
  });

  // Add rule
  elements.filterGroupsContainer.querySelectorAll('.filter-add-rule-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const groupId = target.dataset.groupId!;
      addFilterRule(groupId);
    });
  });

  // Rule type change
  elements.filterGroupsContainer.querySelectorAll('.filter-rule-type').forEach(el => {
    el.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      const groupId = target.dataset.groupId!;
      const ruleId = target.dataset.ruleId!;
      const newType = target.value as FilterRuleType;

      // Reset value when switching to/from level type
      const isNowLevel = newType === 'level' || newType === 'not_level';
      const group = advancedFilterGroups.find(g => g.id === groupId);
      const rule = group?.rules.find(r => r.id === ruleId);
      const wasLevel = rule?.type === 'level' || rule?.type === 'not_level';

      if (isNowLevel !== wasLevel) {
        updateFilterRule(groupId, ruleId, {
          type: newType,
          value: isNowLevel ? 'error' : '',
        });
        renderAdvancedFilterUI();
      } else {
        updateFilterRule(groupId, ruleId, { type: newType });
      }
    });
  });

  // Rule value change
  elements.filterGroupsContainer.querySelectorAll('.filter-rule-value').forEach(el => {
    el.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      const groupId = target.dataset.groupId!;
      const ruleId = target.dataset.ruleId!;
      updateFilterRule(groupId, ruleId, { value: target.value });
    });
    el.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      const groupId = target.dataset.groupId!;
      const ruleId = target.dataset.ruleId!;
      updateFilterRule(groupId, ruleId, { value: target.value });
    });
  });

  // Case sensitive toggle
  elements.filterGroupsContainer.querySelectorAll('.filter-rule-case').forEach(el => {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const groupId = target.dataset.groupId!;
      const ruleId = target.dataset.ruleId!;
      const group = advancedFilterGroups.find(g => g.id === groupId);
      const rule = group?.rules.find(r => r.id === ruleId);
      if (rule) {
        updateFilterRule(groupId, ruleId, { caseSensitive: !rule.caseSensitive });
        target.classList.toggle('active');
      }
    });
  });

  // Remove rule
  elements.filterGroupsContainer.querySelectorAll('.filter-rule-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const groupId = target.dataset.groupId!;
      const ruleId = target.dataset.ruleId!;
      removeFilterRule(groupId, ruleId);
    });
  });
}

async function applyAdvancedFilter(): Promise<void> {
  // Strip empty rules from each group, then filter out empty groups
  const validGroups = advancedFilterGroups
    .map(g => ({
      ...g,
      rules: g.rules.filter(r => r.value.trim() !== '' || r.type === 'level' || r.type === 'not_level'),
    }))
    .filter(g => g.rules.length > 0);

  if (validGroups.length === 0) {
    alert('Please add at least one filter rule with a value.');
    return;
  }

  const contextEnabled = elements.advancedContextLinesEnabled.checked;
  const contextLines = contextEnabled ? parseInt(elements.advancedContextLines.value) || 0 : 0;

  const advancedConfig: AdvancedFilterConfig = {
    enabled: true,
    groups: validGroups,
    contextLines,
  };

  const config: FilterConfig = {
    levels: [],
    includePatterns: [],
    excludePatterns: [],
    advancedFilter: advancedConfig,
  };

  showProgress('Applying advanced filter...');

  const removeProgressListener = window.api.onFilterProgress(({ percent }) => {
    updateProgress(percent);
    updateProgressText(`Applying advanced filter... ${percent}%`);
  });

  try {
    const result = await window.api.applyFilter(config);

    if (result.success && result.stats) {
      state.isFiltered = true;
      state.filteredLines = result.stats.filteredLines;
      state.activeLevelFilter = null;
      cachedLines.clear();

      // Reset scroll to top of filtered view
      state.visibleStartLine = 0;
      state.visibleEndLine = Math.min(100, state.filteredLines - 1);
      if (logViewerElement) {
        logViewerElement.scrollTop = 0;
      }

      hideAdvancedFilterModal();
      await loadVisibleLines();
      updateStatusBar();
      updateLevelBadgeStyles();
    } else if (result.error !== 'Cancelled') {
      alert(`Failed to apply filter: ${result.error}`);
    }
  } finally {
    removeProgressListener();
    hideProgress();
  }
}

function clearAdvancedFilter(): void {
  advancedFilterGroups = [];
  addFilterGroup();
  renderAdvancedFilterUI();
}

// === Time Gap Detection ===

interface TimeGap {
  lineNumber: number;
  prevLineNumber: number;
  gapSeconds: number;
  prevTimestamp: string;
  currTimestamp: string;
  linePreview: string;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

interface TimeGapOptions {
  thresholdSeconds: number;
  startLine?: number;
  endLine?: number;
  startPattern?: string;
  endPattern?: string;
}

let timeGapProgressUnsubscribe: (() => void) | null = null;

// Time gap navigation state
let currentTimeGaps: TimeGap[] = [];
let currentGapIndex = -1;

// Highlight navigation state (per highlight ID)
const highlightMatches: Map<string, number[]> = new Map(); // highlightId -> line numbers
const highlightCurrentIndex: Map<string, number> = new Map(); // highlightId -> current index

async function detectTimeGaps(): Promise<void> {
  if (!state.filePath) {
    alert('Please open a log file first.');
    return;
  }

  const options: TimeGapOptions = {
    thresholdSeconds: parseInt(elements.timeGapThreshold.value) || 30,
  };

  // Get optional line range
  const startLine = parseInt(elements.timeGapStartLine.value);
  const endLine = parseInt(elements.timeGapEndLine.value);
  if (startLine > 0) options.startLine = startLine;
  if (endLine > 0) options.endLine = endLine;

  // Get optional pattern range
  const startPattern = elements.timeGapStartPattern.value.trim();
  const endPattern = elements.timeGapEndPattern.value.trim();
  if (startPattern) options.startPattern = startPattern;
  if (endPattern) options.endPattern = endPattern;

  // Show progress UI
  elements.timeGapsList.innerHTML = '<p class="placeholder">Detecting time gaps...</p>';
  elements.btnDetectGaps.classList.add('hidden');
  elements.btnCancelGaps.classList.remove('hidden');
  showProgress('Detecting time gaps...');

  // Subscribe to progress updates
  timeGapProgressUnsubscribe = window.api.onTimeGapProgress((data) => {
    updateProgress(data.percent);
    updateProgressText(`Detecting time gaps... ${data.percent}%`);
  });

  try {
    const result = await window.api.detectTimeGaps(options);

    if (result.success && result.gaps) {
      renderTimeGaps(result.gaps, options);
    } else if (result.error === 'Cancelled') {
      elements.timeGapsList.innerHTML = '<p class="placeholder">Detection cancelled</p>';
    } else {
      elements.timeGapsList.innerHTML = `<p class="placeholder">${result.error || 'Failed to detect time gaps'}</p>`;
    }
  } catch (error) {
    elements.timeGapsList.innerHTML = `<p class="placeholder">Error: ${error}</p>`;
  } finally {
    // Cleanup
    if (timeGapProgressUnsubscribe) {
      timeGapProgressUnsubscribe();
      timeGapProgressUnsubscribe = null;
    }
    elements.btnDetectGaps.classList.remove('hidden');
    elements.btnCancelGaps.classList.add('hidden');
    hideProgress();
  }
}

async function cancelTimeGaps(): Promise<void> {
  await window.api.cancelTimeGaps();
}

function clearTimeGaps(): void {
  elements.timeGapsList.innerHTML = '<p class="placeholder">Click Detect to find time gaps</p>';
  // Clear range inputs
  elements.timeGapStartLine.value = '';
  elements.timeGapEndLine.value = '';
  elements.timeGapStartPattern.value = '';
  elements.timeGapEndPattern.value = '';
  hideProgress();
  // Reset navigation state
  currentTimeGaps = [];
  currentGapIndex = -1;
  elements.timeGapNav.classList.add('hidden');
}

function renderTimeGaps(gaps: TimeGap[], options?: TimeGapOptions): void {
  // Store gaps for navigation
  currentTimeGaps = gaps;
  currentGapIndex = -1;

  if (gaps.length === 0) {
    let msg = 'No time gaps found exceeding threshold';
    if (options?.startPattern || options?.endPattern || options?.startLine || options?.endLine) {
      msg += ' in specified range';
    }
    elements.timeGapsList.innerHTML = `<p class="placeholder">${msg}</p>`;
    elements.timeGapNav.classList.add('hidden');
    return;
  }

  // Show navigation
  elements.timeGapNav.classList.remove('hidden');
  updateGapNavPosition();

  // Build range info text
  let rangeInfo = '';
  if (options) {
    const parts = [];
    if (options.startLine || options.endLine) {
      const start = options.startLine || 1;
      const end = options.endLine || 'end';
      parts.push(`lines ${start}-${end}`);
    }
    if (options.startPattern || options.endPattern) {
      const start = options.startPattern || '(start)';
      const end = options.endPattern || '(end)';
      parts.push(`"${start}" to "${end}"`);
    }
    if (parts.length > 0) {
      rangeInfo = `<div class="gap-range-info">Range: ${parts.join(', ')}</div>`;
    }
  }

  const html = gaps.map((gap, index) => `
    <div class="time-gap-item" data-line="${gap.lineNumber}" data-index="${index}">
      <div class="gap-header">
        <span class="gap-duration">${formatDuration(gap.gapSeconds)}</span>
        <span class="gap-line">Line ${gap.lineNumber}</span>
      </div>
      <div class="gap-times">${gap.prevTimestamp} → ${gap.currTimestamp}</div>
      <div class="gap-preview" title="${escapeHtml(gap.linePreview)}">${escapeHtml(gap.linePreview)}</div>
    </div>
  `).join('');

  elements.timeGapsList.innerHTML = `<div class="gap-count">${gaps.length} gap${gaps.length > 1 ? 's' : ''} found</div>${rangeInfo}${html}`;

  // Add click handlers to navigate to the line
  elements.timeGapsList.querySelectorAll('.time-gap-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt((item as HTMLElement).dataset.index || '0');
      const lineNumber = parseInt((item as HTMLElement).dataset.line || '0');
      if (lineNumber > 0) {
        currentGapIndex = index;
        updateGapNavPosition();
        highlightCurrentGapItem();
        goToLine(lineNumber);
      }
    });
  });
}

function updateGapNavPosition(): void {
  const total = currentTimeGaps.length;
  const current = currentGapIndex >= 0 ? currentGapIndex + 1 : 0;
  elements.gapNavPosition.textContent = `${current}/${total}`;
}

function highlightCurrentGapItem(): void {
  // Remove highlight from all items
  elements.timeGapsList.querySelectorAll('.time-gap-item').forEach(item => {
    item.classList.remove('active');
  });
  // Highlight current
  if (currentGapIndex >= 0) {
    const currentItem = elements.timeGapsList.querySelector(`.time-gap-item[data-index="${currentGapIndex}"]`);
    if (currentItem) {
      currentItem.classList.add('active');
      currentItem.scrollIntoView({ block: 'nearest' });
    }
  }
}

function navigateGap(direction: 'prev' | 'next'): void {
  if (currentTimeGaps.length === 0) return;

  if (direction === 'next') {
    currentGapIndex = (currentGapIndex + 1) % currentTimeGaps.length;
  } else {
    currentGapIndex = currentGapIndex <= 0 ? currentTimeGaps.length - 1 : currentGapIndex - 1;
  }

  updateGapNavPosition();
  highlightCurrentGapItem();
  goToLine(currentTimeGaps[currentGapIndex].lineNumber);
}

// Split File
function showSplitModal(): void {
  if (!state.filePath) return;
  updateSplitPreview();
  elements.splitModal.classList.remove('hidden');
}

function hideSplitModal(): void {
  elements.splitModal.classList.add('hidden');
}

function getSplitMode(): 'lines' | 'parts' {
  const checked = document.querySelector('input[name="split-mode"]:checked') as HTMLInputElement;
  return (checked?.value as 'lines' | 'parts') || 'lines';
}

function updateSplitPreview(): void {
  const mode = getSplitMode();
  const value = parseInt(elements.splitValue.value) || 1;
  const totalLines = state.totalLines;

  if (mode === 'lines') {
    elements.splitHint.textContent = 'Lines per output file';
    const numParts = Math.ceil(totalLines / value);
    elements.splitPreview.innerHTML = `
      Will create <strong>${numParts}</strong> files<br>
      ~${value.toLocaleString()} lines each
    `;
  } else {
    elements.splitHint.textContent = 'Number of output files';
    const linesPerFile = Math.ceil(totalLines / value);
    elements.splitPreview.innerHTML = `
      Will create <strong>${value}</strong> files<br>
      ~${linesPerFile.toLocaleString()} lines each
    `;
  }
}

async function doSplit(): Promise<void> {
  const mode = getSplitMode();
  const value = parseInt(elements.splitValue.value) || 1;

  hideSplitModal();
  showProgress('Splitting file...');

  const unsubscribe = window.api.onSplitProgress((data) => {
    updateProgress(data.percent);
    elements.progressText.textContent = `Splitting... Part ${data.currentPart}/${data.totalParts}`;
  });

  try {
    const result = await window.api.splitFile({ mode, value });

    if (result.success && result.files) {
      // Store split files for connected navigation
      state.splitFiles = result.files;
      state.currentSplitIndex = 0;

      const loadFirst = confirm(
        `Split complete!\n\n` +
        `Created ${result.partCount} files in:\n${result.outputDir}\n\n` +
        `Would you like to open the first part with connected navigation?`
      );

      if (loadFirst && result.files.length > 0) {
        await loadFile(result.files[0]);
      }
    } else {
      alert(`Split failed: ${result.error}`);
    }
  } finally {
    unsubscribe();
    hideProgress();
  }
}

async function loadNextSplitFile(): Promise<void> {
  if (state.splitFiles.length === 0) return;
  if (state.currentSplitIndex >= state.splitFiles.length - 1) return;

  state.currentSplitIndex++;
  // Don't create a new tab when navigating split files - update current tab
  await loadFile(state.splitFiles[state.currentSplitIndex], false);
}

async function loadPreviousSplitFile(): Promise<void> {
  if (state.splitFiles.length === 0) return;
  if (state.currentSplitIndex <= 0) return;

  state.currentSplitIndex--;
  // Don't create a new tab when navigating split files - update current tab
  await loadFile(state.splitFiles[state.currentSplitIndex], false);
}

// Bookmark modal state
let pendingBookmarkResolve: ((result: { comment: string; color: string } | null) => void) | null = null;
let pendingBookmarkLineNumber: number | null = null;
let pendingBookmarkId: string | null = null;
let selectedBookmarkColor: string = '';

const BOOKMARK_COLORS = [
  '',          // No color (default accent)
  '#3b82f6',  // Blue
  '#22c55e',  // Green
  '#eab308',  // Yellow
  '#f97316',  // Orange
  '#ef4444',  // Red
  '#a855f7',  // Purple
  '#ec4899',  // Pink
  '#14b8a6',  // Teal
  '#6b7280',  // Gray
];

function renderBookmarkColorPalette(activeColor: string): void {
  selectedBookmarkColor = activeColor;
  elements.bookmarkColorPalette.innerHTML = BOOKMARK_COLORS.map(color => {
    const isActive = color === activeColor;
    const bg = color || 'var(--accent-color)';
    const label = color ? '' : '&#10003;';
    return `<button class="bookmark-color-swatch${isActive ? ' active' : ''}" data-color="${color}" style="background:${bg}" title="${color || 'Default'}">${!color && isActive ? label : (isActive ? '&#10003;' : '')}</button>`;
  }).join('');

  elements.bookmarkColorPalette.querySelectorAll('.bookmark-color-swatch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const color = (btn as HTMLElement).dataset.color || '';
      selectedBookmarkColor = color;
      elements.bookmarkColorPalette.querySelectorAll('.bookmark-color-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      btn.innerHTML = '&#10003;';
      // Remove checkmark from others
      elements.bookmarkColorPalette.querySelectorAll('.bookmark-color-swatch:not(.active)').forEach(b => { b.innerHTML = ''; });
    });
  });
}

function showBookmarkModal(lineNumber: number, existingComment?: string, isEdit: boolean = false, existingColor?: string): Promise<{ comment: string; color: string } | null> {
  return new Promise((resolve) => {
    pendingBookmarkResolve = resolve;
    pendingBookmarkLineNumber = lineNumber;

    elements.bookmarkModalTitle.textContent = isEdit ? 'Edit Bookmark' : 'Add Bookmark';
    elements.bookmarkComment.value = existingComment || '';
    elements.bookmarkLineInfo.textContent = `Line ${lineNumber + 1}`;
    renderBookmarkColorPalette(existingColor || '');
    elements.bookmarkModal.classList.remove('hidden');
    elements.bookmarkComment.focus();
  });
}

function hideBookmarkModal(save: boolean): void {
  const result = save ? { comment: elements.bookmarkComment.value, color: selectedBookmarkColor } : null;
  elements.bookmarkModal.classList.add('hidden');
  elements.bookmarkComment.value = '';

  if (pendingBookmarkResolve) {
    pendingBookmarkResolve(result);
    pendingBookmarkResolve = null;
  }
  pendingBookmarkLineNumber = null;
  pendingBookmarkId = null;
}

// Bookmarks
async function addBookmarkAtLine(lineNumber: number, comment?: string): Promise<void> {
  // Prevent duplicate bookmark on the same line
  if (state.bookmarks.some(b => b.lineNumber === lineNumber)) return;

  // Show modal for comment and color if not provided
  let label: string | undefined;
  let color: string | undefined;
  if (comment !== undefined) {
    label = comment || undefined;
  } else {
    const result = await showBookmarkModal(lineNumber);
    if (result === null) return; // User cancelled
    label = result.comment || undefined;
    color = result.color || undefined;
  }

  const cachedLine = cachedLines.get(lineNumber);
  const bookmark: Bookmark = {
    id: `bookmark-${Date.now()}`,
    lineNumber,
    label,
    color,
    lineText: cachedLine?.text,
    createdAt: Date.now(),
  };

  const apiResult = await window.api.addBookmark(bookmark);
  if (apiResult.success) {
    state.bookmarks.push(bookmark);
    state.bookmarks.sort((a, b) => a.lineNumber - b.lineNumber);
    updateBookmarksUI();
    renderVisibleLines();
  }
}

async function addBookmarkAtLineWithLabel(lineNumber: number, label: string): Promise<void> {
  await addBookmarkAtLine(lineNumber, label);
}

function addToFilterPattern(pattern: string, type: 'include' | 'exclude'): void {
  const textarea = type === 'include'
    ? document.getElementById('include-patterns') as HTMLTextAreaElement
    : document.getElementById('exclude-patterns') as HTMLTextAreaElement;

  if (textarea) {
    const current = textarea.value.trim();
    textarea.value = current ? `${current}\n${pattern}` : pattern;
  }

  // Open filter modal so user can see and apply
  document.getElementById('filter-modal')?.classList.remove('hidden');
}

async function editBookmarkComment(bookmarkId: string): Promise<void> {
  const bookmark = state.bookmarks.find(b => b.id === bookmarkId);
  if (!bookmark) return;

  pendingBookmarkId = bookmarkId;
  const result = await showBookmarkModal(bookmark.lineNumber, bookmark.label, true, bookmark.color);
  if (result === null) return; // User cancelled

  bookmark.label = result.comment || undefined;
  bookmark.color = result.color || undefined;

  // Update in backend
  await window.api.updateBookmark(bookmark);

  updateBookmarksUI();
  renderVisibleLines();
}

async function removeBookmarkAtLine(lineNumber: number): Promise<void> {
  const bookmark = state.bookmarks.find((b) => b.lineNumber === lineNumber);
  if (!bookmark) return;

  const result = await window.api.removeBookmark(bookmark.id);
  if (result.success) {
    state.bookmarks = state.bookmarks.filter((b) => b.id !== bookmark.id);
    updateBookmarksUI();
    renderVisibleLines();
  }
}

function updateBookmarksUI(): void {
  // Always keep bookmarks sorted by line number
  state.bookmarks.sort((a, b) => a.lineNumber - b.lineNumber);
  updateActivityBadge('bookmarks', state.bookmarks.length);
  if (state.bookmarks.length === 0) {
    elements.bookmarksList.innerHTML = '<p class="placeholder">No bookmarks</p>';
    return;
  }

  elements.bookmarksList.innerHTML = state.bookmarks
    .map(
      (b) => {
        const colorDot = b.color
          ? `<span class="bookmark-color-dot" style="background:${b.color}"></span>`
          : '';
        return `
      <div class="bookmark-item" data-id="${b.id}" data-line="${b.lineNumber}" title="${b.lineText ? escapeHtml(b.lineText) : (b.label ? escapeHtml(b.label) : 'Click to go to line, double-click to edit')}">
        <div class="bookmark-info">
          ${colorDot}<span class="bookmark-line">Line ${b.lineNumber + 1}</span>
          ${b.lineText ? `<span class="bookmark-text">${escapeHtml(b.lineText.substring(0, 120))}</span>` : ''}
          ${b.label ? `<span class="bookmark-label">${escapeHtml(b.label)}</span>` : '<span class="bookmark-label placeholder-text">No comment</span>'}
        </div>
        <div class="bookmark-actions">
          <button class="bookmark-edit" data-id="${b.id}" title="Edit">&#9998;</button>
          <button class="bookmark-delete" data-id="${b.id}" title="Delete bookmark">&times;</button>
        </div>
      </div>
    `;
      }
    )
    .join('');

  // Add click handlers
  elements.bookmarksList.querySelectorAll('.bookmark-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('bookmark-delete')) {
        const id = target.dataset.id!;
        removeBookmarkById(id);
      } else if (target.classList.contains('bookmark-edit')) {
        const id = target.dataset.id!;
        editBookmarkComment(id);
      } else {
        const line = parseInt((item as HTMLElement).dataset.line || '0', 10);
        goToLine(line);
      }
    });

    // Double-click to edit comment
    item.addEventListener('dblclick', () => {
      const id = (item as HTMLElement).dataset.id!;
      editBookmarkComment(id);
    });
  });
}

async function removeBookmarkById(id: string): Promise<void> {
  const result = await window.api.removeBookmark(id);
  if (result.success) {
    state.bookmarks = state.bookmarks.filter((b) => b.id !== id);
    updateBookmarksUI();
    renderVisibleLines();
  }
}

// Bookmark Sets
async function saveBookmarkSet(): Promise<void> {
  if (state.bookmarks.length === 0) return;

  const name = prompt('Enter a name for this bookmark set:');
  if (!name) return;

  const set = {
    id: `set_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    bookmarks: [...state.bookmarks],
  };

  await window.api.bookmarkSetSave(set);
  refreshBookmarkSets();
}

async function refreshBookmarkSets(): Promise<void> {
  const result = await window.api.bookmarkSetList();
  if (!result.success || !result.sets) return;

  const setsBar = document.getElementById('bookmark-sets-bar')!;
  const setsList = document.getElementById('bookmark-sets-list')!;

  if (result.sets.length === 0) {
    setsBar.classList.add('hidden');
    return;
  }

  setsBar.classList.remove('hidden');
  setsList.innerHTML = result.sets
    .sort((a: any, b: any) => b.updatedAt - a.updatedAt)
    .map((s: any) => {
      const date = new Date(s.updatedAt).toLocaleDateString();
      return `
        <div class="bookmark-set-item" data-set-id="${s.id}">
          <div class="bookmark-set-info">
            <span class="bookmark-set-name">${escapeHtml(s.name)}</span>
            <span class="bookmark-set-meta">${s.bookmarks.length} bookmarks - ${date}</span>
          </div>
          <div class="bookmark-set-actions">
            <button class="bookmark-set-action-btn set-load" data-set-id="${s.id}" title="Load this set">Load</button>
            <button class="bookmark-set-action-btn set-overwrite" data-set-id="${s.id}" title="Overwrite with current bookmarks">Update</button>
            <button class="bookmark-set-action-btn danger set-delete" data-set-id="${s.id}" title="Delete this set">&times;</button>
          </div>
        </div>
      `;
    })
    .join('');

  // Event handlers
  setsList.querySelectorAll('.set-load').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const setId = (btn as HTMLElement).dataset.setId!;
      const loadResult = await window.api.bookmarkSetLoad(setId);
      if (loadResult.success && loadResult.bookmarks) {
        // Clear current bookmarks
        await window.api.clearBookmarks();
        state.bookmarks = [];
        // Add loaded bookmarks (sorted by line number)
        const sorted = [...loadResult.bookmarks].sort((a, b) => a.lineNumber - b.lineNumber);
        for (const b of sorted) {
          await window.api.addBookmark(b);
          state.bookmarks.push(b);
        }
        updateBookmarksUI();
        renderVisibleLines();
      }
    });
  });

  setsList.querySelectorAll('.set-overwrite').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.bookmarks.length === 0) return;
      const setId = (btn as HTMLElement).dataset.setId!;
      const sets = (await window.api.bookmarkSetList()).sets || [];
      const existing = sets.find((s: any) => s.id === setId);
      if (!existing) return;
      if (!confirm(`Overwrite "${existing.name}" with current bookmarks?`)) return;
      await window.api.bookmarkSetUpdate({
        ...existing,
        updatedAt: Date.now(),
        bookmarks: [...state.bookmarks],
      });
      refreshBookmarkSets();
    });
  });

  setsList.querySelectorAll('.set-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const setId = (btn as HTMLElement).dataset.setId!;
      if (!confirm('Delete this bookmark set?')) return;
      await window.api.bookmarkSetDelete(setId);
      refreshBookmarkSets();
    });
  });
}

// Highlights
async function showHighlightModal(): Promise<void> {
  elements.highlightPattern.value = '';
  elements.highlightRegex.checked = false;
  elements.highlightCase.checked = false;
  elements.highlightWholeWord.checked = false;
  elements.highlightIncludeWhitespace.checked = false;
  elements.highlightAll.checked = true;
  elements.highlightGlobal.checked = false;
  elements.highlightTextColor.value = '#000000';

  // Auto-assign next color
  const colorResult = await window.api.getNextHighlightColor();
  if (colorResult.success && colorResult.color) {
    elements.highlightBgColor.value = colorResult.color;
  } else {
    elements.highlightBgColor.value = '#ffff00';
  }

  elements.highlightModal.classList.remove('hidden');
}

function hideHighlightModal(): void {
  elements.highlightModal.classList.add('hidden');
}

async function saveHighlight(): Promise<void> {
  const pattern = elements.highlightPattern.value;
  if (!pattern) return;

  const saved = await commitHighlight({
    id: `highlight-${Date.now()}`,
    pattern,
    isRegex: elements.highlightRegex.checked,
    matchCase: elements.highlightCase.checked,
    wholeWord: elements.highlightWholeWord.checked,
    backgroundColor: elements.highlightBgColor.value,
    textColor: elements.highlightTextColor.value,
    includeWhitespace: elements.highlightIncludeWhitespace.checked,
    highlightAll: elements.highlightAll.checked,
    isGlobal: elements.highlightGlobal.checked,
  });

  if (saved) {
    hideHighlightModal();
  }
}

// Toggle highlight between global and file-specific
async function toggleHighlightGlobal(highlightId: string): Promise<void> {
  const highlight = state.highlights.find(h => h.id === highlightId);
  if (!highlight) return;

  highlight.isGlobal = !highlight.isGlobal;
  const result = await window.api.updateHighlight(highlight);
  if (result.success) {
    updateHighlightsUI();
  }
}

function updateHighlightsUI(): void {
  updateActivityBadge('highlights', state.highlights.length);
  if (state.highlights.length === 0) {
    elements.highlightsList.innerHTML =
      '<p class="placeholder">No highlight rules</p>';
    return;
  }

  elements.highlightsList.innerHTML = state.highlights
    .map(
      (h) => {
        const currentIdx = highlightCurrentIndex.get(h.id) ?? -1;
        const matches = highlightMatches.get(h.id);
        const total = matches?.length ?? 0;
        const posText = total > 0 ? `${currentIdx + 1}/${total}` : '0/0';
        return `
      <div class="highlight-item" data-id="${h.id}" title="${h.isGlobal ? 'Global - applies to all files' : 'Local - applies to this file only'}">
        <div class="highlight-row">
          <span class="highlight-color" data-id="${h.id}" style="background-color: ${h.backgroundColor}" title="Click to change color"></span>
          <input type="color" class="highlight-color-picker" data-id="${h.id}" value="${h.backgroundColor}" style="display:none">
          <span class="highlight-pattern">${escapeHtml(h.pattern)}</span>
          <span class="highlight-scope ${h.isGlobal ? 'global' : 'local'}">${h.isGlobal ? 'G' : 'L'}</span>
          <div class="highlight-actions">
            <button class="highlight-toggle-global" data-id="${h.id}" title="${h.isGlobal ? 'Make local (this file only)' : 'Make global (all files)'}">${h.isGlobal ? '🌐' : '📄'}</button>
            <button class="highlight-delete" data-id="${h.id}" title="Delete">&times;</button>
          </div>
        </div>
        <div class="highlight-nav">
          <button class="highlight-nav-btn highlight-prev" data-id="${h.id}" title="Previous match">◀</button>
          <span class="highlight-nav-pos" data-id="${h.id}">${posText}</span>
          <button class="highlight-nav-btn highlight-next" data-id="${h.id}" title="Next match">▶</button>
        </div>
      </div>
    `;
      }
    )
    .join('');

  // Add click handlers for delete
  elements.highlightsList.querySelectorAll('.highlight-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (e.target as HTMLElement).dataset.id!;
      const result = await window.api.removeHighlight(id);
      if (result.success) {
        state.highlights = state.highlights.filter((h) => h.id !== id);
        // Clear navigation cache for this highlight
        highlightMatches.delete(id);
        highlightCurrentIndex.delete(id);
        activeHighlightGroupId = null;
        updateHighlightGroupsUI();
        updateHighlightsUI();
        renderVisibleLines();
      }
    });
  });

  // Add click handlers for toggle global
  elements.highlightsList.querySelectorAll('.highlight-toggle-global').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (e.target as HTMLElement).dataset.id!;
      await toggleHighlightGlobal(id);
    });
  });

  // Add click handlers for highlight navigation
  elements.highlightsList.querySelectorAll('.highlight-prev').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (e.target as HTMLElement).dataset.id!;
      await navigateHighlight(id, 'prev');
    });
  });

  elements.highlightsList.querySelectorAll('.highlight-next').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (e.target as HTMLElement).dataset.id!;
      await navigateHighlight(id, 'next');
    });
  });

  // Click on color swatch opens the hidden color picker
  elements.highlightsList.querySelectorAll('.highlight-color').forEach((swatch) => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (swatch as HTMLElement).dataset.id!;
      const picker = elements.highlightsList.querySelector(`.highlight-color-picker[data-id="${id}"]`) as HTMLInputElement;
      if (picker) picker.click();
    });
  });

  // Color picker change updates highlight
  elements.highlightsList.querySelectorAll('.highlight-color-picker').forEach((picker) => {
    picker.addEventListener('input', async (e) => {
      const input = e.target as HTMLInputElement;
      const id = input.dataset.id!;
      const newColor = input.value;
      const highlight = state.highlights.find(h => h.id === id);
      if (!highlight) return;
      highlight.backgroundColor = newColor;
      await window.api.updateHighlight(highlight);
      // Update swatch color immediately without full re-render
      const swatch = elements.highlightsList.querySelector(`.highlight-color[data-id="${id}"]`) as HTMLElement;
      if (swatch) swatch.style.backgroundColor = newColor;
      renderVisibleLines();
    });
  });
}

async function navigateHighlight(highlightId: string, direction: 'prev' | 'next'): Promise<void> {
  const highlight = state.highlights.find(h => h.id === highlightId);
  if (!highlight || !state.filePath) return;

  // Check if we have cached matches
  let matches = highlightMatches.get(highlightId);

  if (!matches) {
    // Search for matches on-demand
    const result = await window.api.search({
      pattern: highlight.pattern,
      isRegex: highlight.isRegex,
      isWildcard: false,
      matchCase: highlight.matchCase,
      wholeWord: highlight.wholeWord,
    });

    if (!result.success || !result.matches || result.matches.length === 0) {
      // No matches found
      highlightMatches.set(highlightId, []);
      highlightCurrentIndex.set(highlightId, -1);
      updateHighlightNavPosition(highlightId);
      return;
    }

    // Store unique line numbers (sorted)
    const lineNumbers = [...new Set(result.matches.map(m => m.lineNumber))].sort((a, b) => a - b);
    highlightMatches.set(highlightId, lineNumbers);
    matches = lineNumbers;
  }

  if (matches.length === 0) return;

  let currentIdx = highlightCurrentIndex.get(highlightId) ?? -1;

  if (direction === 'next') {
    currentIdx = (currentIdx + 1) % matches.length;
  } else {
    currentIdx = currentIdx <= 0 ? matches.length - 1 : currentIdx - 1;
  }

  highlightCurrentIndex.set(highlightId, currentIdx);
  updateHighlightNavPosition(highlightId);
  goToLine(matches[currentIdx]);
}

function updateHighlightNavPosition(highlightId: string): void {
  const posEl = elements.highlightsList.querySelector(`.highlight-nav-pos[data-id="${highlightId}"]`);
  if (!posEl) return;

  const matches = highlightMatches.get(highlightId);
  const currentIdx = highlightCurrentIndex.get(highlightId) ?? -1;
  const total = matches?.length ?? 0;
  const posText = total > 0 ? `${currentIdx + 1}/${total}` : '0/0';
  posEl.textContent = posText;
}

// UI Updates
function updateFileStatsUI(): void {
  if (!state.fileStats) {
    elements.fileStats.innerHTML = '<p class="placeholder">No file loaded</p>';
    return;
  }

  elements.fileStats.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">File:</span>
      <span class="stat-value">${getFileName(state.fileStats.path)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Size:</span>
      <span class="stat-value">${formatBytes(state.fileStats.size)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Lines:</span>
      <span class="stat-value">${state.fileStats.totalLines.toLocaleString()}</span>
    </div>
  `;
}

function updateAnalysisUI(): void {
  if (!state.analysisResult) {
    elements.analysisResults.innerHTML =
      '<p class="placeholder">Run analysis to see results</p>';
    return;
  }

  const result = state.analysisResult;
  const ins = result.insights;

  // 1. Level counts - clickable to filter
  let levelHtml = '<div class="level-counts">';
  for (const [level, count] of Object.entries(result.levelCounts)) {
    if (count > 0) {
      levelHtml += `<span class="level-badge ${level}" data-level="${level}" title="Click to filter by ${level}">${level}: ${count.toLocaleString()}</span>`;
    }
  }
  levelHtml += '</div>';

  // 2. Crashes & Failures
  let crashesHtml = '';
  if (ins.crashes.length > 0) {
    crashesHtml = `
      <div class="insight-section crash-section">
        <div class="insight-header">Crashes & Failures (${ins.crashes.length}${ins.crashes.length >= 50 ? '+' : ''})</div>
        ${ins.crashes.map(c => `
          <div class="crash-item" data-line="${c.lineNumber}" title="Line ${c.lineNumber}">
            <div class="crash-line">
              <span class="crash-keyword">${escapeHtml(c.keyword)}</span>
              <span class="crash-line-num">line ${c.lineNumber}</span>
            </div>
            <div class="crash-text">${escapeHtml(c.text.length > 100 ? c.text.substring(0, 100) + '...' : c.text)}</div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    crashesHtml = `
      <div class="insight-section crash-section">
        <div class="insight-header">Crashes & Failures</div>
        <div class="no-crashes">No crashes detected</div>
      </div>
    `;
  }

  // 3. Top Failing Components
  let componentsHtml = '';
  if (ins.topFailingComponents.length > 0) {
    const maxErrors = ins.topFailingComponents[0].errorCount;
    componentsHtml = `
      <div class="insight-section components-section">
        <div class="insight-header">Top Failing Components</div>
        ${ins.topFailingComponents.map(comp => `
          <div class="component-item" data-line="${comp.sampleLine}" title="${comp.errorCount} errors, ${comp.warningCount} warnings">
            <div class="component-header">
              <span class="component-name">${escapeHtml(comp.name)}</span>
              <span class="component-errors">${comp.errorCount} err${comp.warningCount > 0 ? ` / ${comp.warningCount} warn` : ''}</span>
            </div>
            <div class="component-bar" style="width: ${Math.max(Math.round(comp.errorCount / maxErrors * 100), 4)}%"></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // 4. Filter Suggestions
  let suggestionsHtml = '';
  if (ins.filterSuggestions.length > 0 || state.appliedFilterSuggestion) {
    suggestionsHtml = `
      <div class="insight-section filter-suggestions">
        <div class="insight-header">Suggested Filters</div>
        ${state.appliedFilterSuggestion ? `
          <div class="active-filter-indicator">
            <span class="active-filter-label">Active: ${escapeHtml(state.appliedFilterSuggestion.title)}</span>
            <button class="clear-filter-btn" id="clearSuggestedFilter">Clear</button>
          </div>
        ` : ''}
        ${ins.filterSuggestions.map(s => `
          <div class="filter-suggestion-item${state.appliedFilterSuggestion?.id === s.id ? ' applied' : ''}" data-filter-id="${s.id}" title="${escapeHtml(s.description)}">
            <span class="filter-suggestion-title">${escapeHtml(s.title)}</span>
            <button class="apply-filter-btn" data-filter-id="${s.id}"${state.appliedFilterSuggestion?.id === s.id ? ' disabled' : ''}>
              ${state.appliedFilterSuggestion?.id === s.id ? 'Applied' : 'Apply'}
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  elements.analysisResults.innerHTML = `
    ${levelHtml}
    ${crashesHtml}
    ${componentsHtml}
    ${suggestionsHtml}
    ${
      result.timeRange
        ? `
    <div class="stat-row" style="margin-top: 8px;">
      <span class="stat-label">Time range:</span>
    </div>
    <div style="font-size: 11px; color: var(--text-secondary);">
      ${result.timeRange.start} - ${result.timeRange.end}
    </div>
    `
        : ''
    }
  `;

  // Add click handlers for level filtering
  elements.analysisResults.querySelectorAll('.level-badge[data-level]').forEach((badge) => {
    badge.addEventListener('click', async () => {
      const level = (badge as HTMLElement).dataset.level;
      if (!level) return;

      if (state.isFiltered && state.activeLevelFilter === level) {
        await clearFilter();
        state.activeLevelFilter = null;
        updateLevelBadgeStyles();
        return;
      }

      await applyQuickLevelFilter(level);
    });
  });

  // Click handlers for crash items - navigate to line
  elements.analysisResults.querySelectorAll('.crash-item').forEach((item) => {
    item.addEventListener('click', () => {
      const line = parseInt((item as HTMLElement).dataset.line || '0', 10);
      if (line > 0) goToLine(line);
    });
  });

  // Click handlers for component items - navigate to first error line
  elements.analysisResults.querySelectorAll('.component-item').forEach((item) => {
    item.addEventListener('click', () => {
      const line = parseInt((item as HTMLElement).dataset.line || '0', 10);
      if (line > 0) goToLine(line);
    });
  });

  // Click handlers for filter suggestions
  elements.analysisResults.querySelectorAll('.apply-filter-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filterId = (btn as HTMLElement).dataset.filterId;
      if (!filterId) return;

      const suggestion = ins.filterSuggestions.find(s => s.id === filterId);
      if (!suggestion) return;

      state.appliedFilterSuggestion = { id: suggestion.id, title: suggestion.title };

      const filterConfig: FilterConfig = {
        excludePatterns: suggestion.filter.excludePatterns || [],
        includePatterns: (suggestion.filter.includePatterns || []).map((p: string) => ({ pattern: p, caseSensitive: true })),
        levels: suggestion.filter.levels || [],
      };

      await applyFilter(filterConfig);
      updateAnalysisUI();
    });
  });

  // Click handler for clear suggested filter button
  const clearSuggestedFilterBtn = document.getElementById('clearSuggestedFilter');
  if (clearSuggestedFilterBtn) {
    clearSuggestedFilterBtn.addEventListener('click', async () => {
      state.appliedFilterSuggestion = null;
      await clearFilter();
      updateAnalysisUI();
    });
  }

  // Show baseline section when analysis is available
  updateBaselineUI();
}

async function loadBaselineList(): Promise<void> {
  try {
    const result = await window.api.baselineList();
    if (result.success && result.baselines) {
      state.baselineList = result.baselines;
    }
  } catch { /* ignore */ }
}

function updateBaselineUI(): void {
  if (!state.analysisResult) {
    elements.baselineSection.style.display = 'none';
    return;
  }
  elements.baselineSection.style.display = '';

  // Controls: save button + compare dropdown
  let controlsHtml = `<button class="secondary-btn small" id="btn-baseline-save">Save as Baseline</button>`;
  controlsHtml += `<div id="baseline-save-form-container"></div>`;

  if (state.baselineList.length > 0) {
    controlsHtml += `<div class="baseline-compare-row" style="margin-top: 6px;">`;
    controlsHtml += `<select class="baseline-dropdown" id="baseline-select">`;
    for (const bl of state.baselineList) {
      const date = new Date(bl.createdAt).toLocaleDateString();
      controlsHtml += `<option value="${bl.id}">${escapeHtml(bl.name)} (${date})</option>`;
    }
    controlsHtml += `</select>`;
    controlsHtml += `<button class="secondary-btn small" id="btn-baseline-compare">Compare</button>`;
    controlsHtml += `</div>`;

    // List with delete buttons
    controlsHtml += `<div id="baseline-list-items" style="margin-top: 4px;">`;
    for (const bl of state.baselineList) {
      const date = new Date(bl.createdAt).toLocaleDateString();
      const tagsHtml = bl.tags.map((t: string) => `<span class="baseline-tag">${escapeHtml(t)}</span>`).join('');
      controlsHtml += `<div class="baseline-item" data-id="${bl.id}">`;
      controlsHtml += `<span>${escapeHtml(bl.name)} <span style="color: var(--text-secondary); font-size: 10px;">${date}</span> ${tagsHtml}</span>`;
      controlsHtml += `<button class="baseline-delete-btn" data-id="${bl.id}" title="Delete baseline">&times;</button>`;
      controlsHtml += `</div>`;
    }
    controlsHtml += `</div>`;
  }

  elements.baselineControls.innerHTML = controlsHtml;

  // Save button handler
  const btnSave = document.getElementById('btn-baseline-save');
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      const container = document.getElementById('baseline-save-form-container');
      if (!container) return;
      container.innerHTML = `
        <div class="baseline-save-form">
          <input type="text" id="baseline-name-input" placeholder="Baseline name (e.g. production-healthy)" />
          <input type="text" id="baseline-tags-input" placeholder="Tags (comma-separated, e.g. production, v2.1)" />
          <textarea id="baseline-desc-input" placeholder="Description (optional)" rows="2"></textarea>
          <div class="baseline-form-actions">
            <button class="secondary-btn small" id="btn-baseline-confirm-save">Save</button>
            <button class="secondary-btn small" id="btn-baseline-cancel-save">Cancel</button>
          </div>
        </div>
      `;
      (document.getElementById('baseline-name-input') as HTMLInputElement)?.focus();

      document.getElementById('btn-baseline-cancel-save')?.addEventListener('click', () => {
        container.innerHTML = '';
      });

      document.getElementById('btn-baseline-confirm-save')?.addEventListener('click', async () => {
        const name = (document.getElementById('baseline-name-input') as HTMLInputElement)?.value.trim();
        if (!name) return;
        const desc = (document.getElementById('baseline-desc-input') as HTMLTextAreaElement)?.value.trim() || '';
        const tagsStr = (document.getElementById('baseline-tags-input') as HTMLInputElement)?.value.trim() || '';
        const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

        const result = await window.api.baselineSave(name, desc, tags);
        if (result.success) {
          container.innerHTML = '';
          await loadBaselineList();
          updateBaselineUI();
          showToast(`Baseline "${name}" saved`);
        } else {
          showToast(result.error || 'Failed to save baseline');
        }
      });
    });
  }

  // Compare button handler
  const btnCompare = document.getElementById('btn-baseline-compare');
  if (btnCompare) {
    btnCompare.addEventListener('click', async () => {
      const select = document.getElementById('baseline-select') as HTMLSelectElement;
      if (!select) return;
      const baselineId = select.value;
      if (!baselineId) return;

      (btnCompare as HTMLButtonElement).disabled = true;
      (btnCompare as HTMLButtonElement).textContent = 'Comparing...';

      const result = await window.api.baselineCompare(baselineId);

      (btnCompare as HTMLButtonElement).disabled = false;
      (btnCompare as HTMLButtonElement).textContent = 'Compare';

      if (result.success && result.report) {
        state.comparisonReport = result.report;
        renderComparisonReport(result.report);
      } else {
        elements.baselineComparisonResults.innerHTML = `<div style="color: var(--error-color); font-size: 11px;">${escapeHtml(result.error || 'Comparison failed')}</div>`;
      }
    });
  }

  // Delete button handlers
  elements.baselineControls.querySelectorAll('.baseline-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      const result = await window.api.baselineDelete(id);
      if (result.success) {
        await loadBaselineList();
        state.comparisonReport = null;
        elements.baselineComparisonResults.innerHTML = '';
        updateBaselineUI();
      }
    });
  });

  // Re-render comparison if still present
  if (state.comparisonReport) {
    renderComparisonReport(state.comparisonReport);
  }
}

function renderComparisonReport(report: ComparisonReport): void {
  if (report.findings.length === 0) {
    elements.baselineComparisonResults.innerHTML = `
      <div class="section-divider">Comparison Results</div>
      <div style="font-size: 11px; color: var(--text-secondary);">No anomalies detected — log matches baseline "${escapeHtml(report.baselineName)}".</div>
    `;
    return;
  }

  let html = `<div class="section-divider">Comparison Results</div>`;
  html += `<div class="comparison-summary">`;
  if (report.summary.critical > 0) html += `<span style="color: #e74c3c;">${report.summary.critical} critical</span>`;
  if (report.summary.warning > 0) html += `<span style="color: #f1c40f;">${report.summary.warning} warning</span>`;
  if (report.summary.info > 0) html += `<span style="color: #3498db;">${report.summary.info} info</span>`;
  html += `</div>`;

  for (const f of report.findings) {
    html += `<div class="comparison-finding ${f.severity}">`;
    html += `<div class="finding-title">${escapeHtml(f.title)}</div>`;
    html += `<div class="finding-detail">${escapeHtml(f.detail)}</div>`;
    html += `</div>`;
  }

  elements.baselineComparisonResults.innerHTML = html;
}

function showToast(message: string): void {
  // Simple toast via status bar — reuse existing status mechanism
  const statusFile = document.getElementById('status-file');
  if (statusFile) {
    const prev = statusFile.textContent;
    statusFile.textContent = message;
    setTimeout(() => {
      if (statusFile.textContent === message) statusFile.textContent = prev || '';
    }, 3000);
  }
}

function updateStatusBar(): void {
  if (state.filePath) {
    let fileName = getFileName(state.filePath);

    // Show split navigation info in status bar
    if (state.splitFiles.length > 0 && state.currentSplitIndex >= 0) {
      fileName = `${fileName} [${state.currentSplitIndex + 1}/${state.splitFiles.length}]`;
    }

    elements.statusFile.textContent = fileName;
    elements.statusLines.textContent = `${state.totalLines.toLocaleString()} lines`;
    elements.statusSize.textContent = formatBytes(state.fileStats?.size || 0);

    if (state.isFiltered && state.filteredLines !== null) {
      elements.statusFiltered.classList.remove('hidden');
      elements.filteredCount.textContent = state.filteredLines.toLocaleString();
    } else {
      elements.statusFiltered.classList.add('hidden');
    }
  } else {
    elements.statusFile.textContent = 'No file';
    elements.statusLines.textContent = '0 lines';
    elements.statusSize.textContent = '0 B';
    elements.statusFiltered.classList.add('hidden');
  }
}

function updateSplitNavigation(): void {
  // Remove existing navigation elements
  document.querySelectorAll('.split-nav-indicator').forEach(el => el.remove());

  if (state.splitFiles.length === 0 || state.currentSplitIndex < 0) return;

  // Add navigation indicator to the log viewer wrapper
  if (!logViewerWrapper) return;

  // Create navigation container fixed at bottom of viewer
  const navContainer = document.createElement('div');
  navContainer.className = 'split-nav-indicator';
  navContainer.style.cssText = `
    position: absolute;
    bottom: 0;
    left: 0;
    right: 100px;
    display: flex;
    justify-content: center;
    gap: 20px;
    padding: 10px 15px;
    background: linear-gradient(to bottom, transparent, var(--bg-secondary) 30%);
    z-index: 100;
  `;

  // Previous file button
  if (state.currentSplitIndex > 0) {
    const prevBtn = document.createElement('button');
    prevBtn.className = 'split-nav-btn';
    prevBtn.innerHTML = `&larr; Previous: ${getFileName(state.splitFiles[state.currentSplitIndex - 1])}`;
    prevBtn.style.cssText = `
      padding: 8px 16px;
      background-color: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-primary);
      cursor: pointer;
      font-size: 12px;
    `;
    prevBtn.addEventListener('click', loadPreviousSplitFile);
    navContainer.appendChild(prevBtn);
  }

  // Next file button
  if (state.currentSplitIndex < state.splitFiles.length - 1) {
    const nextBtn = document.createElement('button');
    nextBtn.className = 'split-nav-btn';
    nextBtn.innerHTML = `Next: ${getFileName(state.splitFiles[state.currentSplitIndex + 1])} &rarr;`;
    nextBtn.style.cssText = `
      padding: 8px 16px;
      background-color: var(--accent-color);
      border: none;
      border-radius: 4px;
      color: #fff;
      cursor: pointer;
      font-size: 12px;
    `;
    nextBtn.addEventListener('click', loadNextSplitFile);
    navContainer.appendChild(nextBtn);
  }

  // Only add if there are navigation buttons
  if (navContainer.children.length > 0) {
    logViewerWrapper.appendChild(navContainer);
  }
}

function updateCursorStatus(lineNumber: number): void {
  elements.statusCursor.textContent = `Ln ${lineNumber + 1}`;
}

function updateSelectionStatus(): void {
  if (state.selectionStart !== null && state.selectionEnd !== null) {
    const count = state.selectionEnd - state.selectionStart + 1;
    elements.statusCursor.textContent = `Ln ${state.selectionStart + 1}-${state.selectionEnd + 1} (${count} lines selected)`;
  }
}

// Helper to get tab by ID (DRY principle)
function getTab(tabId?: string): TabState | undefined {
  const id = tabId || state.activeTabId;
  return id ? state.tabs.find(t => t.id === id) : undefined;
}

// Global loading state for when no tab exists yet
let globalLoading = { isLoading: false, text: '', percent: 0 };

// Sync loading UI with current state (Single Responsibility)
// Show video overlay only for large files where operations take noticeable time
const OVERLAY_LINE_THRESHOLD = 100_000;

function syncLoadingOverlay(): void {
  const tab = getTab();

  // Get loading state - prefer tab state, fall back to global
  const isLoading = tab ? tab.isLoading : globalLoading.isLoading;
  const text = tab ? tab.loadingText : globalLoading.text;
  const percent = tab ? tab.loadingPercent : globalLoading.percent;

  if (isLoading) {
    // Status bar progress always shows
    elements.progressContainer.classList.remove('hidden');
    elements.progressBar.style.setProperty('--progress', `${percent}%`);
    elements.progressText.textContent = text || `${percent}%`;

    // Video overlay for large files (>100K lines) or when size is unknown (file opening)
    const lineCount = state.totalLines || 0;
    if (lineCount === 0 || lineCount >= OVERLAY_LINE_THRESHOLD) {
      elements.loadingOverlay.classList.remove('hidden');
      elements.loadingText.textContent = text;
      elements.loadingProgressFill.style.width = `${percent}%`;
      elements.loadingPercent.textContent = `${percent}%`;
      elements.loadingVideo.play().catch(() => {});
    }
  } else {
    // Hide everything
    elements.loadingOverlay.classList.add('hidden');
    elements.progressContainer.classList.add('hidden');
    elements.loadingVideo.pause();
  }
}

// Simple state updates - then sync UI (KISS principle)
function showProgress(text: string, tabId?: string): void {
  const tab = getTab(tabId);
  if (tab) {
    tab.isLoading = true;
    tab.loadingText = text;
    tab.loadingPercent = 0;
  } else {
    // No tab yet - use global loading state
    globalLoading = { isLoading: true, text, percent: 0 };
  }
  syncLoadingOverlay();
}

function updateProgress(percent: number, tabId?: string): void {
  const tab = getTab(tabId);
  if (tab) {
    tab.loadingPercent = percent;
  } else {
    globalLoading.percent = percent;
  }
  // Only sync if this is the active tab (avoid unnecessary DOM updates)
  if (!tabId || tabId === state.activeTabId || !tab) {
    syncLoadingOverlay();
  }
}

function updateProgressText(text: string, tabId?: string): void {
  const tab = getTab(tabId);
  if (tab) {
    tab.loadingText = text;
  } else {
    globalLoading.text = text;
  }
  if (!tabId || tabId === state.activeTabId || !tab) {
    syncLoadingOverlay();
  }
}

function hideProgress(tabId?: string): void {
  const tab = getTab(tabId);
  if (tab) {
    tab.isLoading = false;
    tab.loadingText = '';
    tab.loadingPercent = 0;
  }
  // Always reset global loading
  globalLoading = { isLoading: false, text: '', percent: 0 };
  syncLoadingOverlay();
}

// === Zoom Functions ===

function zoomIn(): void {
  if (zoomLevel < ZOOM_MAX) {
    zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP);
    applyZoom();
  }
}

function zoomOut(): void {
  if (zoomLevel > ZOOM_MIN) {
    zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP);
    applyZoom();
  }
}

function resetZoom(): void {
  zoomLevel = 100;
  applyZoom();
}

function toggleWordWrap(): void {
  wordWrapEnabled = !wordWrapEnabled;

  // Update button state
  if (wordWrapEnabled) {
    elements.btnWordWrap.classList.add('active');
  } else {
    elements.btnWordWrap.classList.remove('active');
  }

  if (logViewerElement) {
    if (wordWrapEnabled) {
      logViewerElement.classList.add('word-wrap');
    } else {
      logViewerElement.classList.remove('word-wrap');
    }
    // Re-render to apply word wrap
    renderVisibleLines();
  }
}

function isMarkdownExtension(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop();
  return ext === 'md' || ext === 'markdown';
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico', 'avif']);

function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

// Image viewer state (bottom panel)
let imageZoom = 1;
const imageViewerContainer = document.getElementById('image-viewer-container') as HTMLDivElement;
const imageViewerImg = document.getElementById('image-viewer-img') as HTMLImageElement;
const imageZoomLevelEl = document.getElementById('image-zoom-level') as HTMLSpanElement;
const imageDimensionsEl = document.getElementById('image-dimensions') as HTMLSpanElement;
const imageFileNameEl = document.getElementById('image-file-name') as HTMLSpanElement;
const imageDropZone = document.getElementById('image-drop-zone') as HTMLDivElement;

function openImageInPanel(filePath: string): void {
  imageZoom = 1;
  imageViewerImg.src = '';
  imageViewerImg.style.display = 'none';
  if (imageDropZone) imageDropZone.style.display = 'none';

  const fileName = filePath.split('/').pop() || filePath;
  if (imageFileNameEl) imageFileNameEl.textContent = fileName;

  imageViewerImg.onload = () => {
    imageViewerImg.style.display = '';
    imageDimensionsEl.textContent = `${imageViewerImg.naturalWidth} × ${imageViewerImg.naturalHeight}`;
    fitImageToWindow();
  };
  imageViewerImg.src = `file://${filePath}`;

  // Switch to image tab in bottom panel
  toggleBottomTab('image');
}

function setImageZoom(zoom: number): void {
  imageZoom = Math.max(0.05, Math.min(zoom, 20));
  imageViewerImg.style.width = `${imageViewerImg.naturalWidth * imageZoom}px`;
  imageViewerImg.style.height = `${imageViewerImg.naturalHeight * imageZoom}px`;
  imageZoomLevelEl.textContent = `${Math.round(imageZoom * 100)}%`;
}

function fitImageToWindow(): void {
  const containerW = imageViewerContainer.clientWidth - 40;
  const containerH = imageViewerContainer.clientHeight - 40;
  const imgW = imageViewerImg.naturalWidth;
  const imgH = imageViewerImg.naturalHeight;
  if (imgW === 0 || imgH === 0) return;
  const scale = Math.min(containerW / imgW, containerH / imgH, 1);
  setImageZoom(scale);
}

// Image viewer controls
document.getElementById('btn-image-zoom-in')?.addEventListener('click', () => setImageZoom(imageZoom * 1.25));
document.getElementById('btn-image-zoom-out')?.addEventListener('click', () => setImageZoom(imageZoom / 1.25));
document.getElementById('btn-image-zoom-fit')?.addEventListener('click', fitImageToWindow);
document.getElementById('btn-image-zoom-actual')?.addEventListener('click', () => setImageZoom(1));

// Mouse wheel zoom on image
imageViewerContainer?.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  setImageZoom(imageZoom * delta);
}, { passive: false });

async function renderMarkdownPreview(): Promise<void> {
  if (!state.filePath || !isMarkdownFile) return;

  try {
    // Fetch all content for markdown preview
    const result = await window.api.getLines(0, state.totalLines);
    if (result.success && result.lines) {
      const content = result.lines.map(l => l.text).join('\n');
      const html = marked.parse(content);
      elements.markdownPreview.innerHTML = html;

      // Make links open in external browser
      elements.markdownPreview.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const href = link.getAttribute('href');
          if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            window.api.openExternalUrl?.(href);
          }
        });
      });
    }
  } catch (error) {
    elements.markdownPreview.innerHTML = '<p>Error rendering markdown</p>';
  }
}

function showMarkdownPreview(): void {
  if (!isMarkdownFile) return;

  markdownPreviewMode = true;
  elements.markdownPreview.classList.remove('hidden');

  // Hide log viewer wrapper if it exists
  const wrapper = document.querySelector('.log-viewer-wrapper') as HTMLElement;
  if (wrapper) {
    wrapper.style.display = 'none';
  }

  // Update button state
  elements.btnWordWrap.textContent = 'Raw';
  elements.btnWordWrap.title = 'Show raw markdown';
}

function showMarkdownRaw(): void {
  markdownPreviewMode = false;
  elements.markdownPreview.classList.add('hidden');

  // Show log viewer wrapper
  const wrapper = document.querySelector('.log-viewer-wrapper') as HTMLElement;
  if (wrapper) {
    wrapper.style.display = '';
  }

  // Update button state
  elements.btnWordWrap.textContent = 'Preview';
  elements.btnWordWrap.title = 'Show markdown preview';
}

function toggleMarkdownPreview(): void {
  if (!isMarkdownFile) {
    toggleWordWrap();
    return;
  }

  if (markdownPreviewMode) {
    showMarkdownRaw();
  } else {
    showMarkdownPreview();
    renderMarkdownPreview();
  }
}

function applyZoom(): void {
  // Update status bar
  elements.statusZoom.textContent = `${zoomLevel}%`;

  // Update CSS custom properties on container for efficient styling
  // This avoids setting inline styles on each line element
  if (logViewerElement) {
    const lineHeight = getLineHeight();
    const fontSize = getFontSize();
    logViewerElement.style.setProperty('--line-height', `${lineHeight}px`);
    logViewerElement.style.setProperty('--font-size', `${fontSize}px`);
    logViewerElement.style.fontSize = `${fontSize}px`;
  }

  // Recalculate and re-render if file is loaded
  if (state.totalLines > 0 && logViewerElement) {
    const containerHeight = logViewerElement.clientHeight;
    const visibleLines = Math.ceil(containerHeight / getLineHeight());
    const startLine = scrollTopToLine(logViewerElement.scrollTop);
    state.visibleStartLine = Math.max(0, startLine - BUFFER_LINES);
    state.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, getTotalLines() - 1);
    renderVisibleLines();
    updateMinimapViewport();
  }

  // Propagate zoom to secondary viewer
  if (secondaryViewer) secondaryApplyZoom(secondaryViewer);
}

// Utility functions
function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Sidebar toggle
// Panel system
const PANEL_IDS = ['folders', 'bookmarks', 'highlights', 'stats', 'history'];
const PANEL_NAMES: Record<string, string> = {
  'folders': 'Folders',
  'bookmarks': 'Bookmarks',
  'highlights': 'Highlights',
  'stats': 'Stats',
  'history': 'History',
};

const BOTTOM_TAB_IDS = ['analysis', 'time-gaps', 'search-results', 'search-configs', 'video', 'live', 'notes'];
const BOTTOM_TAB_NAMES: Record<string, string> = {
  'analysis': 'Analysis',
  'time-gaps': 'Time Gaps',
  'search-results': 'Search Results',
  'search-configs': 'Search Configs',
  'video': 'Video',
  'live': 'Live',
  'notes': 'Notes',
};

let activePanel: string | null = null;
let lastActivePanel: string | null = null;

function togglePanel(panelId: string): void {
  if (activePanel === panelId) {
    closePanel();
    return;
  }
  openPanel(panelId);
}

function openPanel(panelId: string): void {
  activePanel = panelId;
  lastActivePanel = panelId;

  // Show panel container
  elements.panelContainer.classList.remove('hidden');
  elements.panelResizeHandle.classList.remove('hidden');
  elements.panelTitle.textContent = PANEL_NAMES[panelId] || panelId;

  // Show active view, hide others
  document.querySelectorAll('.panel-view').forEach(view => {
    view.classList.toggle('active', (view as HTMLElement).dataset.panel === panelId);
  });

  // Update activity bar buttons
  document.querySelectorAll('.activity-bar-btn[data-panel]').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.panel === panelId);
  });

  // Lazy-load history panel
  if (panelId === 'history') {
    loadAndRenderHistory();
  }

  savePanelState();
}

function closePanel(): void {
  activePanel = null;
  elements.panelContainer.classList.add('hidden');
  elements.panelResizeHandle.classList.add('hidden');

  // Deactivate all activity bar buttons
  document.querySelectorAll('.activity-bar-btn[data-panel]').forEach(btn => {
    btn.classList.remove('active');
  });

  savePanelState();
}

function togglePanelVisibility(): void {
  if (activePanel) {
    closePanel();
  } else if (lastActivePanel) {
    openPanel(lastActivePanel);
  } else {
    openPanel('folders');
  }
}

function savePanelState(): void {
  localStorage.setItem('logan-panel', JSON.stringify({
    activePanel,
    lastActivePanel,
    panelWidth: elements.panelContainer.style.width || '300px',
  }));
}

function restorePanelState(): void {
  try {
    const saved = localStorage.getItem('logan-panel');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.panelWidth) {
        elements.panelContainer.style.width = data.panelWidth;
      }
      lastActivePanel = data.lastActivePanel || null;
      if (data.activePanel) {
        openPanel(data.activePanel);
      }
    }
  } catch (e) {
    console.warn('Failed to restore panel state:', e);
  }
}

function updateActivityBadge(panelId: string, count: number): void {
  const badge = document.getElementById(`badge-${panelId}`);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

// === History Panel ===

const ACTION_CATEGORIES: Record<string, string[]> = {
  search: ['search'],
  filter: ['filter_applied', 'filter_cleared'],
  bookmark: ['bookmark_added', 'bookmark_removed', 'bookmark_cleared'],
  highlight: ['highlight_added', 'highlight_removed', 'highlight_cleared'],
  analysis: ['analysis_run', 'time_gap_analysis', 'diff_compared'],
  other: ['file_opened', 'notes_saved', 'lines_saved'],
};

const ACTION_ICONS: Record<string, string> = {
  file_opened: '&#128194;',
  search: '&#128269;',
  filter_applied: '&#9660;',
  filter_cleared: '&#9651;',
  bookmark_added: '&#128278;',
  bookmark_removed: '&#128278;',
  bookmark_cleared: '&#128278;',
  highlight_added: '&#127912;',
  highlight_removed: '&#127912;',
  highlight_cleared: '&#127912;',
  diff_compared: '&#8596;',
  time_gap_analysis: '&#9200;',
  analysis_run: '&#128202;',
  notes_saved: '&#128221;',
  lines_saved: '&#128190;',
};

const ACTION_LABELS: Record<string, string> = {
  file_opened: 'Opened file',
  search: 'Search',
  filter_applied: 'Filter applied',
  filter_cleared: 'Filter cleared',
  bookmark_added: 'Bookmark added',
  bookmark_removed: 'Bookmark removed',
  bookmark_cleared: 'Bookmarks cleared',
  highlight_added: 'Highlight added',
  highlight_removed: 'Highlight removed',
  highlight_cleared: 'Highlights cleared',
  diff_compared: 'Diff compared',
  time_gap_analysis: 'Time gap analysis',
  analysis_run: 'Analysis run',
  notes_saved: 'Notes saved',
  lines_saved: 'Lines saved',
};

function getRelativeTime(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function getDateGroup(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function formatActivityDetails(entry: ActivityEntry): string {
  const d = entry.details;
  switch (entry.action) {
    case 'search':
      return `"${d.pattern}" (${d.matchCount} matches)`;
    case 'filter_applied':
      return `${d.filteredLines} lines visible`;
    case 'bookmark_added':
      return `Line ${(d.lineNumber as number) + 1}${d.label ? ': ' + d.label : ''}`;
    case 'bookmark_removed':
      return `ID: ${d.bookmarkId}`;
    case 'bookmark_cleared':
      return `${d.count} removed`;
    case 'highlight_added':
      return `"${d.pattern}"${d.isGlobal ? ' (global)' : ''}`;
    case 'highlight_cleared':
      return `${d.count} removed`;
    case 'diff_compared':
      return `${(d.leftFile as string || '').split('/').pop()} vs ${(d.rightFile as string || '').split('/').pop()}`;
    case 'time_gap_analysis':
      return `${d.gapsFound} gaps (>${d.threshold}s)`;
    case 'analysis_run':
      return `${d.analyzerName}`;
    case 'notes_saved':
    case 'lines_saved':
      return `Lines ${(d.startLine as number) + 1}-${(d.endLine as number) + 1}`;
    default:
      return '';
  }
}

async function loadAndRenderHistory(): Promise<void> {
  const result = await window.api.loadActivityHistory();
  if (!result.success || !result.history) {
    elements.historyList.innerHTML = '<p class="placeholder">No activity recorded</p>';
    return;
  }
  renderActivityHistory(result.history as ActivityEntry[]);
}

function renderActivityHistory(entries: ActivityEntry[]): void {
  const filterValue = elements.historyFilter.value;

  // Filter entries by category
  let filtered = entries;
  if (filterValue !== 'all') {
    const allowedActions = ACTION_CATEGORIES[filterValue] || [];
    filtered = entries.filter(e => allowedActions.includes(e.action));
  }

  if (filtered.length === 0) {
    elements.historyList.innerHTML = '<p class="placeholder">No matching activity</p>';
    updateActivityBadge('history', 0);
    return;
  }

  // Reverse chronological
  const sorted = [...filtered].reverse();

  // Group by date
  const groups: Map<string, ActivityEntry[]> = new Map();
  for (const entry of sorted) {
    const group = getDateGroup(entry.timestamp);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(entry);
  }

  let html = '';
  for (const [dateLabel, groupEntries] of groups) {
    html += `<div class="history-date-group">${escapeHtml(dateLabel)}</div>`;
    for (const entry of groupEntries) {
      const icon = ACTION_ICONS[entry.action] || '&#9679;';
      const label = ACTION_LABELS[entry.action] || entry.action;
      const details = formatActivityDetails(entry);
      const time = getRelativeTime(entry.timestamp);
      const isClickable = entry.action === 'search' || entry.action === 'bookmark_added';
      const clickClass = isClickable ? ' clickable' : '';
      const dataAttr = isClickable ? ` data-action="${escapeHtml(entry.action)}" data-details='${escapeHtml(JSON.stringify(entry.details))}'` : '';

      html += `<div class="history-entry${clickClass}"${dataAttr}>`;
      html += `<span class="history-icon">${icon}</span>`;
      html += `<div class="history-entry-body">`;
      html += `<span class="history-label">${escapeHtml(label)}</span>`;
      if (details) html += `<span class="history-details">${escapeHtml(details)}</span>`;
      html += `</div>`;
      html += `<span class="history-time">${escapeHtml(time)}</span>`;
      html += `</div>`;
    }
  }

  elements.historyList.innerHTML = html;

  // Add click handlers for clickable entries
  elements.historyList.querySelectorAll('.history-entry.clickable').forEach(el => {
    el.addEventListener('click', () => {
      const action = (el as HTMLElement).dataset.action;
      try {
        const details = JSON.parse((el as HTMLElement).dataset.details || '{}');
        if (action === 'search' && details.pattern) {
          elements.searchInput.value = details.pattern;
          if (details.isRegex) elements.searchRegex.checked = true;
          elements.btnSearch.click();
        } else if (action === 'bookmark_added' && typeof details.lineNumber === 'number') {
          goToLine(details.lineNumber);
        }
      } catch (e) { console.warn('Failed to parse history action details:', e); }
    });
  });

  updateActivityBadge('history', entries.length);
}

async function updateLocalStorageStatus(): Promise<void> {
  try {
    const status = await window.api.getLocalFileStatus();
    if (status.writable) {
      elements.statusLocalStorage.textContent = '.logan';
      elements.statusLocalStorage.title = `Local storage: ${status.localPath}`;
      elements.statusLocalStorage.classList.remove('hidden', 'readonly');
    } else {
      elements.statusLocalStorage.textContent = '.logan (r/o)';
      elements.statusLocalStorage.title = 'Directory not writable - using global ~/.logan/ storage';
      elements.statusLocalStorage.classList.remove('hidden');
      elements.statusLocalStorage.classList.add('readonly');
    }
  } catch (e) {
    console.warn('Failed to check local storage status:', e);
    elements.statusLocalStorage.classList.add('hidden');
  }
}

function setupActivityBar(): void {
  // Click handlers for activity bar icons
  document.querySelectorAll('.activity-bar-btn[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = (btn as HTMLElement).dataset.panel!;
      togglePanel(panelId);
    });
  });

  // Close panel button
  elements.btnClosePanel.addEventListener('click', closePanel);

  // Settings button in activity bar
  document.getElementById('btn-activity-settings')?.addEventListener('click', async () => {
    // Load current settings into UI
    elements.scrollSpeedSlider.value = userSettings.scrollSpeed.toString();
    elements.scrollSpeedValue.textContent = `${userSettings.scrollSpeed}%`;
    elements.defaultFontSizeSlider.value = userSettings.defaultFontSize.toString();
    elements.defaultFontSizeValue.textContent = `${userSettings.defaultFontSize}px`;
    elements.defaultGapThresholdSlider.value = userSettings.defaultGapThreshold.toString();
    elements.defaultGapThresholdValue.textContent = `${userSettings.defaultGapThreshold}s`;
    elements.autoAnalyzeCheckbox.checked = userSettings.autoAnalyze;
    elements.themeSelect.value = userSettings.theme;
    populateSidebarSectionToggles();
    // Load Datadog config
    const result = await window.api.datadogLoadConfig();
    if (result.success && result.config) {
      elements.ddSiteSelect.value = result.config.site || 'US1';
      elements.ddApiKey.value = result.config.hasApiKey ? '••••••••' : '';
      elements.ddAppKey.value = result.config.hasAppKey ? '••••••••' : '';
      elements.ddConfigStatus.textContent = 'Configured';
      elements.ddConfigStatus.style.color = 'var(--debug-color)';
    } else {
      elements.ddSiteSelect.value = 'US1';
      elements.ddApiKey.value = '';
      elements.ddAppKey.value = '';
      elements.ddConfigStatus.textContent = 'Not configured';
      elements.ddConfigStatus.style.color = 'var(--text-muted)';
    }
    elements.settingsModal.classList.remove('hidden');
  });

  // History panel controls
  elements.historyFilter.addEventListener('change', () => {
    if (activePanel === 'history') loadAndRenderHistory();
  });

  elements.btnClearHistory.addEventListener('click', async () => {
    const result = await window.api.clearActivityHistory();
    if (result.success) {
      elements.historyList.innerHTML = '<p class="placeholder">No activity recorded</p>';
      updateActivityBadge('history', 0);
    }
  });

  // Panel resize handle
  elements.panelResizeHandle.addEventListener('mousedown', (e) => {
    isResizingSidebar = true;
    sidebarStartX = e.clientX;
    sidebarStartWidth = elements.panelContainer.offsetWidth;
    elements.panelResizeHandle.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  // Keyboard shortcuts: Ctrl+1..5 sidebar panels, Ctrl+6..7 bottom tabs, Escape close
  document.addEventListener('keydown', (e) => {
    // Ctrl+1..5 — toggle sidebar panels
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 5) {
        e.preventDefault();
        togglePanel(PANEL_IDS[num - 1]);
        return;
      }
      // Ctrl+6..7 — toggle bottom tabs (analysis, time-gaps)
      if (num === 6) { e.preventDefault(); toggleBottomTab('analysis'); return; }
      if (num === 7) { e.preventDefault(); toggleBottomTab('time-gaps'); return; }
    }

    // Ctrl+\ — toggle panel visibility
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '\\') {
      e.preventDefault();
      togglePanelVisibility();
      return;
    }

    // Escape from panel — close and return focus to log viewer
    if (e.key === 'Escape' && activePanel) {
      const focusedEl = document.activeElement as HTMLElement;
      if (focusedEl && elements.panelContainer.contains(focusedEl)) {
        e.preventDefault();
        closePanel();
        logViewerElement?.focus();
      }
    }
  });

  // Restore saved state
  restorePanelState();
}

// Section toggle (legacy - for collapsible sections within panels)
function setupSectionToggles(): void {
  document.querySelectorAll('.section-header').forEach((header) => {
    header.addEventListener('click', () => {
      const section = header.closest('.sidebar-section');
      section?.classList.toggle('collapsed');
    });
  });
}

// Modal close handlers
function setupModalCloseHandlers(): void {
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = (btn as HTMLElement).dataset.modal;
      if (modalId) {
        // Bookmark modal needs special handling to resolve the pending promise
        if (modalId === 'bookmark-modal') {
          hideBookmarkModal(false);
        } else {
          document.getElementById(modalId)?.classList.add('hidden');
        }
      }
    });
  });

  // Close on backdrop click
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        // Bookmark modal needs special handling to resolve the pending promise
        if ((modal as HTMLElement).id === 'bookmark-modal') {
          hideBookmarkModal(false);
        } else {
          modal.classList.add('hidden');
        }
      }
    });
  });
}

// Keyboard shortcuts
function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + O: Open file
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      openFile();
    }

    // Ctrl/Cmd + F: Focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      elements.searchInput.focus();
    }

    // Enter in search: Search
    if (e.key === 'Enter' && document.activeElement === elements.searchInput) {
      performSearch();
    }

    // F3 or Ctrl/Cmd + G: Next search result (respects direction)
    if (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.key === 'g')) {
      e.preventDefault();
      navigateSearchNext();
    }

    // Shift + F3 or Ctrl/Cmd + Shift + G: Previous search result (respects direction)
    if (
      (e.key === 'F3' && e.shiftKey) ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G')
    ) {
      e.preventDefault();
      navigateSearchPrev();
    }

    // F7: Next diff hunk, Shift+F7: Previous diff hunk
    if (e.key === 'F7' && viewMode === 'diff') {
      e.preventDefault();
      navigateDiffHunk(e.shiftKey ? -1 : 1);
      return;
    }

    // Ctrl/Cmd + Shift + D: Toggle diff with next tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (viewMode !== 'single') {
        deactivateSplitView();
      } else if (state.tabs.length >= 2 && state.activeTabId) {
        const currentIdx = state.tabs.findIndex(t => t.id === state.activeTabId);
        const nextIdx = (currentIdx + 1) % state.tabs.length;
        activateDiffView(state.tabs[nextIdx].id);
      }
      return;
    }

    // Escape: Cancel range selection, close split/diff, close bottom panel, terminal, or modals
    if (e.key === 'Escape') {
      if (viewMode !== 'single') {
        deactivateSplitView();
        return;
      }
      if (rangeSelectStartLine !== null) {
        rangeSelectStartLine = null;
        elements.statusCursor.textContent = 'Range cancelled';
      } else if (state.bottomPanelVisible) {
        closeBottomPanel();
      } else if (state.terminalVisible) {
        closeTerminal();
      } else {
        hideFilterModal();
        hideHighlightModal();
        hideSplitModal();
      }
    }

    // Ctrl/Cmd + `: Toggle terminal
    if ((e.ctrlKey || e.metaKey) && e.key === '`') {
      e.preventDefault();
      toggleTerminal();
    }

    // Ctrl/Cmd + Shift + N: Toggle notes tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      toggleBottomTab('notes');
    }

    // Ctrl/Cmd + Shift + R: Toggle search results tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      toggleBottomTab('search-results');
    }

    // Ctrl/Cmd + 8: Toggle search configs tab
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === '8') {
      e.preventDefault();
      toggleBottomTab('search-configs');
    }

    // Ctrl/Cmd + 9: Toggle video tab
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === '9') {
      e.preventDefault();
      toggleBottomTab('video');
    }

    // Ctrl/Cmd + Shift + P: Toggle live tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      toggleBottomTab('live');
    }

    // Ctrl/Cmd + PageDown: Next split file
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageDown') {
      e.preventDefault();
      loadNextSplitFile();
    }

    // Ctrl/Cmd + PageUp: Previous split file
    if ((e.ctrlKey || e.metaKey) && e.key === 'PageUp') {
      e.preventDefault();
      loadPreviousSplitFile();
    }

    // Ctrl/Cmd + B: Toggle bookmark
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      if (state.selectedLine !== null) {
        const hasBookmark = state.bookmarks.some(
          (b) => b.lineNumber === state.selectedLine
        );
        if (hasBookmark) {
          removeBookmarkAtLine(state.selectedLine);
        } else {
          addBookmarkAtLine(state.selectedLine);
        }
      }
    }

    // Ctrl/Cmd + H: Toggle highlight for selected text (all occurrences)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'h') {
      e.preventDefault();
      const selection = window.getSelection();
      const selectedText = selection?.toString();
      if (selectedText) {
        createHighlightFromSelection(selectedText, true);
      }
    }

    // Ctrl/Cmd + Shift + H: Toggle highlight for selected text (first per line)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      const selection = window.getSelection();
      const selectedText = selection?.toString();
      if (selectedText) {
        createHighlightFromSelection(selectedText, false);
      }
    }

    // Ctrl/Cmd + Shift + S: Save selected lines to notes
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      if (state.selectionStart !== null && state.selectionEnd !== null) {
        saveToNotes();
      }
    }

    // Tab navigation
    // Ctrl/Cmd + Tab: Next tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (state.tabs.length > 1 && state.activeTabId) {
        const currentIndex = state.tabs.findIndex(t => t.id === state.activeTabId);
        if (currentIndex >= 0) {
          const nextIndex = (currentIndex + 1) % state.tabs.length;
          switchToTab(state.tabs[nextIndex].id);
        }
      }
    }

    // Ctrl/Cmd + Shift + Tab: Previous tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (state.tabs.length > 1 && state.activeTabId) {
        const currentIndex = state.tabs.findIndex(t => t.id === state.activeTabId);
        if (currentIndex >= 0) {
          const prevIndex = (currentIndex - 1 + state.tabs.length) % state.tabs.length;
          switchToTab(state.tabs[prevIndex].id);
        }
      }
    }

    // Ctrl/Cmd + W: Close current tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      if (state.activeTabId) {
        closeTab(state.activeTabId);
      }
    }

    // Ctrl/Cmd + T: Open new file (new tab)
    if ((e.ctrlKey || e.metaKey) && e.key === 't') {
      e.preventDefault();
      openFile();
    }

    // Zoom: Ctrl/Cmd + Plus or Ctrl/Cmd + =
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      zoomIn();
    }

    // Zoom: Ctrl/Cmd + Minus
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      zoomOut();
    }

    // Zoom: Ctrl/Cmd + 0 (reset)
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      resetZoom();
    }

    // Arrow key navigation (only when not in input fields)
    const isInputFocused = document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement?.closest('.terminal-container');

    if (!isInputFocused && logViewerElement) {
      const totalLines = getTotalLines();
      const visibleLines = Math.floor(logViewerElement.clientHeight / getLineHeight());

      // Arrow Down: Move down one line
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const currentDisplayIdx = state.isFiltered
          ? (findDisplayIndexForLine(state.selectedLine ?? 0) ?? 0)
          : (state.selectedLine ?? 0);
        const newDisplayIdx = Math.min(currentDisplayIdx + 1, totalLines - 1);
        goToLine(newDisplayIdx);
        const cachedLine = cachedLines.get(newDisplayIdx);
        state.selectedLine = cachedLine ? cachedLine.lineNumber : newDisplayIdx;
        renderVisibleLines();
      }

      // Arrow Up: Move up one line
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const currentDisplayIdx = state.isFiltered
          ? (findDisplayIndexForLine(state.selectedLine ?? 0) ?? 0)
          : (state.selectedLine ?? 0);
        const newDisplayIdx = Math.max(currentDisplayIdx - 1, 0);
        goToLine(newDisplayIdx);
        const cachedLine = cachedLines.get(newDisplayIdx);
        state.selectedLine = cachedLine ? cachedLine.lineNumber : newDisplayIdx;
        renderVisibleLines();
      }

      // Arrow Right: Scroll right
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        logViewerElement.scrollLeft += 50;
      }

      // Arrow Left: Scroll left
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        logViewerElement.scrollLeft = Math.max(0, logViewerElement.scrollLeft - 50);
      }

      // Page Down: Scroll down by one screen from current view
      // Also: Ctrl+D = half page down (vim-style, Mac-friendly)
      const isPageDown = (e.key === 'PageDown' && !e.ctrlKey && !e.metaKey) ||
        (e.key === 'd' && e.ctrlKey && !e.metaKey && !e.shiftKey);
      if (isPageDown) {
        e.preventDefault();
        const currentLine = scrollTopToLine(logViewerElement.scrollTop);
        const jump = e.key === 'd' ? Math.floor(visibleLines / 2) : visibleLines;
        const newDisplayIdx = Math.min(currentLine + jump, totalLines - 1);
        goToLine(newDisplayIdx);
        const cachedLine = cachedLines.get(newDisplayIdx);
        state.selectedLine = cachedLine ? cachedLine.lineNumber : newDisplayIdx;
        renderVisibleLines();
      }

      // Page Up: Scroll up by one screen from current view
      // Also: Ctrl+U = half page up (vim-style, Mac-friendly)
      const isPageUp = (e.key === 'PageUp' && !e.ctrlKey && !e.metaKey) ||
        (e.key === 'u' && e.ctrlKey && !e.metaKey && !e.shiftKey);
      if (isPageUp) {
        e.preventDefault();
        const currentLine = scrollTopToLine(logViewerElement.scrollTop);
        const jump = e.key === 'u' ? Math.floor(visibleLines / 2) : visibleLines;
        const newDisplayIdx = Math.max(currentLine - jump, 0);
        goToLine(newDisplayIdx);
        const cachedLine = cachedLines.get(newDisplayIdx);
        state.selectedLine = cachedLine ? cachedLine.lineNumber : newDisplayIdx;
        renderVisibleLines();
      }

      // Option+Down / Option+Up: Fast scroll (5 lines at a time, Mac-friendly)
      if (e.key === 'ArrowDown' && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const currentLine = scrollTopToLine(logViewerElement.scrollTop);
        const newDisplayIdx = Math.min(currentLine + 5, totalLines - 1);
        goToLine(newDisplayIdx);
        const cachedLine = cachedLines.get(newDisplayIdx);
        state.selectedLine = cachedLine ? cachedLine.lineNumber : newDisplayIdx;
        renderVisibleLines();
      }
      if (e.key === 'ArrowUp' && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const currentLine = scrollTopToLine(logViewerElement.scrollTop);
        const newDisplayIdx = Math.max(currentLine - 5, 0);
        goToLine(newDisplayIdx);
        const cachedLine = cachedLines.get(newDisplayIdx);
        state.selectedLine = cachedLine ? cachedLine.lineNumber : newDisplayIdx;
        renderVisibleLines();
      }

      // Home: Go to first line
      if (e.key === 'Home' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        goToLine(0);
        const cachedLine = cachedLines.get(0);
        state.selectedLine = cachedLine && state.isFiltered ? cachedLine.lineNumber : 0;
        renderVisibleLines();
      }

      // End: Go to last line
      if (e.key === 'End' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const lastIdx = totalLines - 1;
        goToLine(lastIdx);
        const cachedLine = cachedLines.get(lastIdx);
        state.selectedLine = cachedLine && state.isFiltered ? cachedLine.lineNumber : lastIdx;
        renderVisibleLines();
      }
    }

    // Alt/Option + Z: Toggle word wrap (use code for Mac compatibility)
    if (e.altKey && e.code === 'KeyZ') {
      e.preventDefault();
      toggleWordWrap();
    }

    // Help: F1
    if (e.key === 'F1') {
      e.preventDefault();
      elements.helpModal.classList.toggle('hidden');
    }

    // Escape: Close help modal
    if (e.key === 'Escape' && !elements.helpModal.classList.contains('hidden')) {
      elements.helpModal.classList.add('hidden');
    }
  });
}

// Check and display search engine status
async function checkSearchEngine(): Promise<void> {
  try {
    const result = await window.api.checkSearchEngine();
    const badge = elements.searchEngineBadge;
    const info = elements.searchEngineInfo;

    if (result.engine === 'ripgrep') {
      badge.textContent = `rg ${result.version}`;
      badge.className = 'search-engine-badge ripgrep';
      badge.title = `Using ripgrep ${result.version} for fast search`;
      if (info) {
        info.textContent = `Using ripgrep ${result.version} for fast search`;
        info.style.color = '#7fff7f';
      }
    } else {
      badge.textContent = 'stream';
      badge.className = 'search-engine-badge stream';
      badge.title = 'Using stream-based search (install ripgrep for faster search)';
      if (info) {
        info.textContent = 'Using stream-based search. Install ripgrep for 10-100x faster search.';
        info.style.color = '#ffd27f';
      }
    }
  } catch (e) {
    console.warn('Failed to detect search engine:', e);
    elements.searchEngineBadge.textContent = '';
  }
}

// Initialize event listeners
const GITHUB_URL = 'https://github.com/SolidKeyAB/logan';

function setupWindowControls(): void {
  window.api.getPlatform().then(platform => {
    document.body.classList.add(`platform-${platform}`);

    // Show window controls on non-macOS platforms
    if (platform !== 'darwin') {
      const windowControls = document.getElementById('window-controls');
      if (windowControls) {
        windowControls.classList.remove('hidden');
      }
    }
  });

  // Wire window control buttons
  const btnMinimize = document.getElementById('btn-win-minimize');
  const btnMaximize = document.getElementById('btn-win-maximize');
  const btnClose = document.getElementById('btn-win-close');

  btnMinimize?.addEventListener('click', () => window.api.windowMinimize());
  btnMaximize?.addEventListener('click', () => window.api.windowMaximize());
  btnClose?.addEventListener('click', () => window.api.windowClose());
}

// Compute ISO timestamps from Datadog time range presets
function getDatadogTimeRange(): { from: string; to: string } {
  const preset = elements.ddTimePreset.value;
  if (preset === 'custom') {
    return {
      from: new Date(elements.ddFrom.value).toISOString(),
      to: new Date(elements.ddTo.value).toISOString(),
    };
  }
  const now = new Date();
  const to = now.toISOString();
  const msMap: Record<string, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  const offset = msMap[preset] || 60 * 60 * 1000;
  const from = new Date(now.getTime() - offset).toISOString();
  return { from, to };
}

function setupHelpTooltips(): void {
  const tooltip = document.createElement('div');
  tooltip.className = 'help-tooltip';
  document.body.appendChild(tooltip);

  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: HTMLElement | null = null;

  document.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement).closest('[data-help]') as HTMLElement | null;
    if (!target) {
      // Mouse moved to something without data-help — hide
      if (currentTarget) {
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
        tooltip.classList.remove('visible');
        currentTarget = null;
      }
      return;
    }
    // Still on the same target (moved between child elements) — do nothing
    if (target === currentTarget) return;

    // New target
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    tooltip.classList.remove('visible');
    currentTarget = target;

    showTimer = setTimeout(() => {
      const help = target.dataset.help;
      if (!help) return;
      tooltip.textContent = help;
      const rect = target.getBoundingClientRect();
      let top = rect.bottom + 6;
      let left = rect.left;
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
      tooltip.classList.add('visible');
      // Adjust if overflowing right
      const tipRect = tooltip.getBoundingClientRect();
      if (tipRect.right > window.innerWidth - 8) {
        tooltip.style.left = `${window.innerWidth - tipRect.width - 8}px`;
      }
      // Adjust if overflowing bottom — show above instead
      if (tipRect.bottom > window.innerHeight - 8) {
        tooltip.style.top = `${rect.top - tipRect.height - 6}px`;
      }
    }, 500);
  });

  // Hide when mouse leaves the window
  document.addEventListener('mouseleave', () => {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    tooltip.classList.remove('visible');
    currentTarget = null;
  });
}

function init(): void {
  // Detect platform and setup window controls
  setupWindowControls();

  // Load user settings from localStorage
  loadSettings();
  applySettings();

  // Load baselines list
  loadBaselineList();

  // Toolbar scroll indicators
  const toolbar = document.querySelector('.toolbar') as HTMLElement;
  if (toolbar) {
    const updateToolbarScroll = () => {
      const { scrollLeft, scrollWidth, clientWidth } = toolbar;
      toolbar.classList.toggle('scroll-left', scrollLeft > 4);
      toolbar.classList.toggle('scroll-right', scrollLeft + clientWidth < scrollWidth - 4);
    };
    toolbar.addEventListener('scroll', updateToolbarScroll, { passive: true });
    window.addEventListener('resize', updateToolbarScroll);
    updateToolbarScroll();
  }

  // Check search engine on startup
  checkSearchEngine();

  // MCP navigation — allow main process to scroll the viewer to a specific line
  window.api.onNavigateToLine((lineNumber: number) => {
    if (lineNumber >= 0 && lineNumber < getTotalLines()) {
      goToLine(lineNumber);
      state.selectedLine = lineNumber;
      renderVisibleLines();
    }
  });

  // Logo click - open GitHub
  elements.logo.addEventListener('click', () => {
    window.api.openExternalUrl(GITHUB_URL);
  });
  elements.logo.style.cursor = 'pointer';

  // File operations
  elements.btnOpenFile.addEventListener('click', openFile);
  elements.btnOpenWelcome.addEventListener('click', openFile);

  // Folder operations
  elements.btnAddFolder.addEventListener('click', openFolder);
  elements.btnRefreshFolders.addEventListener('click', refreshFolders);

  // Folder search
  elements.btnFolderSearch.addEventListener('click', performFolderSearch);
  elements.btnFolderSearchCancel.addEventListener('click', cancelFolderSearch);
  elements.folderSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      performFolderSearch();
    } else if (e.key === 'Escape') {
      closeFolderSearchResults();
    }
  });

  // Terminal
  elements.btnTerminalToggle.addEventListener('click', toggleTerminal);

  // Terminal overlay: click outside panel to close
  elements.terminalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.terminalOverlay) {
      closeTerminal();
    }
  });

  // Terminal panel: drag resize from bottom handle
  let isResizingTerminal = false;
  let terminalStartY = 0;
  let terminalStartHeight = 0;

  elements.terminalResizeHandle.addEventListener('mousedown', (e) => {
    isResizingTerminal = true;
    terminalStartY = e.clientY;
    terminalStartHeight = elements.terminalPanel.offsetHeight;
    elements.terminalResizeHandle.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizingTerminal) return;
    const deltaY = e.clientY - terminalStartY;
    const newHeight = Math.max(150, Math.min(window.innerHeight * 0.8, terminalStartHeight + deltaY));
    elements.terminalPanel.style.height = `${newHeight}px`;
    fitTerminalToPanel();
  });

  document.addEventListener('mouseup', () => {
    if (isResizingTerminal) {
      isResizingTerminal = false;
      elements.terminalResizeHandle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      fitTerminalToPanel();
    }
  });

  // Bottom panel (tabbed) events
  elements.btnBottomPanelClose.addEventListener('click', closeBottomPanel);
  elements.btnNotesToggle.addEventListener('click', () => toggleBottomTab('notes'));
  elements.notesTextarea.addEventListener('input', saveNotesDebounced);

  // Agent Chat event listeners
  elements.chatSendBtn.addEventListener('click', sendChatMessage);
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  // Receive agent messages in real-time
  window.api.onAgentMessage((msg) => {
    addChatMessage(msg);
    // Show badge if chat tab is not active
    if (state.activeBottomTab !== 'chat') {
      const badge = document.getElementById('badge-chat');
      if (badge) badge.textContent = '!';
    }
  });
  // Agent connection status changes
  window.api.onAgentConnectionChanged((data: any) => {
    updateAgentConnectionStatus(data.connected, data.count, data.name);
    // If agent was running but disconnected (count dropped to 0), update button
    if (agentRunning && !data.connected) {
      agentRunning = false;
      updateLaunchButton();
    }
  });
  // Launch/Stop agent button
  elements.chatLaunchAgent.addEventListener('click', toggleAgent);
  // Sync initial agent running state
  window.api.getAgentRunning().then((r) => {
    agentRunning = r.running;
    updateLaunchButton();
  });

  // Notes tab right-click context menu
  const notesTabBtn = document.querySelector('.bottom-tab-btn[data-bottom-tab="notes"]');
  if (notesTabBtn) {
    notesTabBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showNotesContextMenu(e as MouseEvent);
    });
  }

  // Bottom panel tab bar click delegation
  document.querySelectorAll('.bottom-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = (btn as HTMLElement).dataset.bottomTab;
      if (tabId) toggleBottomTab(tabId);
    });
  });

  // Activity bar bottom-tab buttons
  document.querySelectorAll('.activity-bar-btn[data-bottom-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = (btn as HTMLElement).dataset.bottomTab;
      if (tabId) toggleBottomTab(tabId);
    });
  });

  setupBottomPanelResize();
  restoreBottomPanelState();

  // Search configs panel events (inside bottom panel)
  elements.btnAddSearchConfig.addEventListener('click', () => showSearchConfigForm());
  elements.btnScExportAll.addEventListener('click', exportAllSearchConfigResults);
  elements.btnScSave.addEventListener('click', addSearchConfig);
  elements.btnScCancel.addEventListener('click', hideSearchConfigForm);
  elements.scPatternInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSearchConfig(); }
    if (e.key === 'Escape') { e.preventDefault(); hideSearchConfigForm(); }
  });

  // Context search panel events (inside bottom panel)
  elements.ctxAddBtn.addEventListener('click', () => showContextForm());
  elements.ctxRunBtn.addEventListener('click', () => runContextSearch());
  elements.ctxViewTree.addEventListener('click', () => toggleContextView('tree'));
  elements.ctxViewLanes.addEventListener('click', () => toggleContextView('lanes'));
  elements.ctxGroupSeparate.addEventListener('click', () => toggleContextGroupMode('separate'));
  elements.ctxGroupCombined.addEventListener('click', () => toggleContextGroupMode('combined'));

  // Video player events (inside bottom panel)
  elements.btnVideoOpen.addEventListener('click', openVideoFile);
  elements.btnVideoSyncFromLine.addEventListener('click', setVideoSyncFromCurrentLine);
  elements.videoSyncInput.addEventListener('change', setVideoSyncFromInput);
  elements.videoSyncInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); setVideoSyncFromInput(); }
  });
  setupVideoDragDrop();

  // Live panel events (inside bottom panel)
  elements.btnLiveRefresh.addEventListener('click', () => refreshSerialPorts());
  elements.btnLiveRefreshDevices.addEventListener('click', () => refreshLogcatDevices());
  elements.btnLiveConnect.addEventListener('click', () => liveConnect());
  elements.liveSourceSelect.addEventListener('change', () => {
    state.liveSource = elements.liveSourceSelect.value as 'serial' | 'logcat' | 'ssh';
    updateLiveSourceControls();
    refreshLiveDevices();
  });

  // SSH-specific events
  elements.btnLiveSshRefresh.addEventListener('click', () => refreshSshHosts());
  elements.btnLiveSshManage.addEventListener('click', () => showSshProfileManager());
  elements.btnOpenSshFolder.addEventListener('click', () => openSshFolder());

  // Unified live connection event listeners (register once)
  setupLiveEventListeners();

  // Load saved connections
  renderSavedConnections();

  // Panel resize is handled in setupActivityBar
  document.addEventListener('mousemove', (e) => {
    if (!isResizingSidebar) return;

    const deltaX = e.clientX - sidebarStartX;
    const newWidth = Math.max(200, Math.min(window.innerWidth * 0.5, sidebarStartWidth + deltaX));
    elements.panelContainer.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizingSidebar) {
      isResizingSidebar = false;
      elements.panelResizeHandle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      savePanelState();
    }
    if (isSplitResizing) {
      isSplitResizing = false;
      const resizeHandle = elements.editorContainer.querySelector('.split-resize-handle');
      resizeHandle?.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // Split pane resize
  document.addEventListener('mousemove', (e) => {
    if (!isSplitResizing || !logViewerWrapper) return;
    const deltaX = e.clientX - splitStartX;
    const containerWidth = elements.editorContainer.clientWidth;
    const newWidth = Math.max(200, Math.min(containerWidth - 200, splitStartLeftWidth + deltaX));
    logViewerWrapper.style.width = `${newWidth}px`;
    logViewerWrapper.style.flex = 'none';
  });

  // Search
  elements.btnSearch.addEventListener('click', performSearch);
  elements.btnPrevResult.addEventListener('click', () => navigateSearchPrev());
  elements.btnNextResult.addEventListener('click', () => navigateSearchNext());

  // Hidden matches
  elements.hiddenMatchesBadge.addEventListener('click', showHiddenMatchesPopup);
  elements.btnCloseHiddenMatches.addEventListener('click', () => {
    elements.hiddenMatchesPopup.classList.add('hidden');
  });
  elements.btnPeekClose.addEventListener('click', closePeekPreview);
  elements.btnPeekClearFilter.addEventListener('click', peekClearFilterAndGoToLine);

  // Close hidden matches popup when clicking outside
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!elements.hiddenMatchesPopup.classList.contains('hidden') &&
        !elements.hiddenMatchesPopup.contains(target) &&
        !elements.hiddenMatchesBadge.contains(target)) {
      elements.hiddenMatchesPopup.classList.add('hidden');
    }
  });

  // Regex and Wildcard are mutually exclusive
  elements.searchRegex.addEventListener('change', () => {
    if (elements.searchRegex.checked) {
      elements.searchWildcard.checked = false;
    }
  });
  elements.searchWildcard.addEventListener('change', () => {
    if (elements.searchWildcard.checked) {
      elements.searchRegex.checked = false;
    }
  });

  // Search options popup
  elements.btnSearchOptions.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.searchOptionsPopup.classList.toggle('hidden');
    if (!elements.searchOptionsPopup.classList.contains('hidden')) {
      const rect = elements.btnSearchOptions.getBoundingClientRect();
      elements.searchOptionsPopup.style.top = (rect.bottom + 4) + 'px';
      elements.searchOptionsPopup.style.left = rect.left + 'px';
    }
  });

  // Close search options popup on outside click
  document.addEventListener('click', (e) => {
    if (!elements.searchOptionsPopup.classList.contains('hidden') &&
        !elements.searchOptionsPopup.contains(e.target as Node) &&
        e.target !== elements.btnSearchOptions) {
      elements.searchOptionsPopup.classList.add('hidden');
    }
  });

  // Direction toggle
  elements.searchDirection.addEventListener('click', () => {
    searchDirection = searchDirection === 'forward' ? 'backward' : 'forward';
    elements.searchDirection.innerHTML = searchDirection === 'forward'
      ? '&#8595; Top to Bottom'
      : '&#8593; Bottom to Top';
    updateSearchUI();
  });

  // Start line input — Enter triggers search
  elements.searchStartLine.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      elements.searchOptionsPopup.classList.add('hidden');
      performSearch();
    }
  });

  // Filter
  elements.btnFilter.addEventListener('click', showFilterModal);
  elements.btnApplyFilter.addEventListener('click', () => applyFilter());
  elements.btnClearFilter.addEventListener('click', clearFilter);
  elements.btnAddIncludePattern.addEventListener('click', () => addIncludePatternRow());

  // Advanced Filter
  elements.btnAdvancedFilter.addEventListener('click', showAdvancedFilterModal);
  elements.btnAddFilterGroup.addEventListener('click', addFilterGroup);
  elements.btnApplyAdvancedFilter.addEventListener('click', applyAdvancedFilter);
  elements.btnClearAdvancedFilter.addEventListener('click', clearAdvancedFilter);
  elements.btnCancelAdvancedFilter.addEventListener('click', hideAdvancedFilterModal);
  document.getElementById('btn-basic-filter')?.addEventListener('click', () => {
    hideAdvancedFilterModal();
    showFilterModal();
  });
  elements.advancedContextLinesEnabled.addEventListener('change', () => {
    elements.advancedContextLines.disabled = !elements.advancedContextLinesEnabled.checked;
  });

  // Time Gap Detection
  elements.btnDetectGaps.addEventListener('click', detectTimeGaps);
  elements.btnCancelGaps.addEventListener('click', cancelTimeGaps);
  elements.btnClearGaps.addEventListener('click', clearTimeGaps);
  elements.btnPrevGap.addEventListener('click', () => navigateGap('prev'));
  elements.btnNextGap.addEventListener('click', () => navigateGap('next'));

  // Analysis
  elements.btnAnalyze.addEventListener('click', analyzeFile);
  document.getElementById('btn-run-analysis')?.addEventListener('click', analyzeFile);

  // Split
  elements.btnSplit.addEventListener('click', showSplitModal);
  elements.btnDoSplit.addEventListener('click', doSplit);
  elements.btnCancelSplit.addEventListener('click', hideSplitModal);

  // Columns
  elements.btnColumns.addEventListener('click', showColumnsModal);
  elements.btnColumnsApply.addEventListener('click', applyColumnsConfig);
  elements.btnColumnsCancel.addEventListener('click', hideColumnsModal);
  elements.btnColumnsAll.addEventListener('click', () => setAllColumnsVisibility(true));
  elements.btnColumnsNone.addEventListener('click', () => setAllColumnsVisibility(false));

  // Word wrap
  elements.btnWordWrap.addEventListener('click', toggleMarkdownPreview);

  // JSON formatting toggle
  elements.btnJsonFormat.addEventListener('click', formatAndLoadJson);

  // Long lines warning buttons
  elements.btnFormatWarning.addEventListener('click', formatAndLoadJson);
  elements.btnDismissWarning.addEventListener('click', () => {
    elements.longLinesWarning.classList.add('hidden');
  });

  // Datadog integration
  elements.btnDatadog.addEventListener('click', () => {
    elements.ddFetchStatus.textContent = '';
    elements.btnDdFetch.disabled = false;
    elements.datadogModal.classList.remove('hidden');
  });

  elements.ddTimePreset.addEventListener('change', () => {
    const isCustom = elements.ddTimePreset.value === 'custom';
    elements.ddCustomRange.style.display = isCustom ? '' : 'none';
  });

  let ddProgressCleanup: (() => void) | null = null;

  elements.btnDdFetch.addEventListener('click', async () => {
    const query = elements.ddQuery.value.trim() || '*';
    const maxLogs = Math.min(Math.max(parseInt(elements.ddMaxLogs.value, 10) || 5000, 100), 50000);
    const { from, to } = getDatadogTimeRange();

    elements.btnDdFetch.disabled = true;
    elements.ddFetchStatus.textContent = 'Starting fetch...';

    // Subscribe to progress
    ddProgressCleanup = window.api.onDatadogFetchProgress((data: { message: string; count: number }) => {
      elements.ddFetchStatus.textContent = data.message;
    });

    try {
      const result = await window.api.datadogFetchLogs({ query, from, to, maxLogs });

      if (result.success && result.filePath) {
        elements.ddFetchStatus.textContent = `Fetched ${result.logCount} logs.`;
        elements.datadogModal.classList.add('hidden');
        await loadFile(result.filePath);
      } else {
        elements.ddFetchStatus.textContent = result.error || 'Unknown error';
      }
    } catch (error: any) {
      elements.ddFetchStatus.textContent = `Error: ${error.message || error}`;
    } finally {
      elements.btnDdFetch.disabled = false;
      if (ddProgressCleanup) {
        ddProgressCleanup();
        ddProgressCleanup = null;
      }
    }
  });

  elements.btnDdCancel.addEventListener('click', async () => {
    await window.api.datadogCancelFetch();
    elements.datadogModal.classList.add('hidden');
    if (ddProgressCleanup) {
      ddProgressCleanup();
      ddProgressCleanup = null;
    }
  });


  elements.btnDdSaveConfig.addEventListener('click', async () => {
    const apiKey = elements.ddApiKey.value.trim();
    const appKey = elements.ddAppKey.value.trim();
    const site = elements.ddSiteSelect.value;

    // Don't save masked values
    if (!apiKey || apiKey === '••••••••' || !appKey || appKey === '••••••••') {
      elements.ddConfigStatus.textContent = 'Enter both keys to save';
      elements.ddConfigStatus.style.color = 'var(--warning-color)';
      return;
    }

    const result = await window.api.datadogSaveConfig({ site, apiKey, appKey });
    if (result.success) {
      elements.ddConfigStatus.textContent = 'Saved';
      elements.ddConfigStatus.style.color = 'var(--debug-color)';
      // Mask the keys after saving
      elements.ddApiKey.value = '••••••••';
      elements.ddAppKey.value = '••••••••';
    } else {
      elements.ddConfigStatus.textContent = `Error: ${result.error}`;
      elements.ddConfigStatus.style.color = 'var(--error-color)';
    }
  });

  elements.btnDdClearConfig.addEventListener('click', async () => {
    await window.api.datadogSaveConfig(null);
    elements.ddApiKey.value = '';
    elements.ddAppKey.value = '';
    elements.ddConfigStatus.textContent = 'Cleared';
    elements.ddConfigStatus.style.color = 'var(--text-muted)';
  });

  // Split mode and value change handlers
  document.querySelectorAll('input[name="split-mode"]').forEach((radio) => {
    radio.addEventListener('change', updateSplitPreview);
  });
  elements.splitValue.addEventListener('input', updateSplitPreview);

  // Highlights
  elements.btnAddHighlight.addEventListener('click', showHighlightModal);
  elements.btnSaveHighlight.addEventListener('click', saveHighlight);
  elements.btnCancelHighlight.addEventListener('click', hideHighlightModal);

  // Highlight groups
  elements.btnSaveHighlightGroup.addEventListener('click', saveCurrentAsHighlightGroup);
  elements.btnDeleteHighlightGroup.addEventListener('click', deleteActiveHighlightGroup);

  // Tab bar
  elements.btnNewTab.addEventListener('click', openFile);

  // Zoom controls
  elements.btnZoomIn.addEventListener('click', zoomIn);
  elements.btnZoomOut.addEventListener('click', zoomOut);
  elements.statusZoom.addEventListener('click', resetZoom); // Click on percentage to reset

  // Help modal
  elements.btnHelp.addEventListener('click', () => {
    elements.helpModal.classList.remove('hidden');
  });
  elements.btnCloseHelp.addEventListener('click', () => {
    elements.helpModal.classList.add('hidden');
  });


  elements.scrollSpeedSlider.addEventListener('input', () => {
    const value = parseInt(elements.scrollSpeedSlider.value, 10);
    elements.scrollSpeedValue.textContent = `${value}%`;
    userSettings.scrollSpeed = value;
    saveSettings();
  });

  elements.defaultFontSizeSlider.addEventListener('input', () => {
    const value = parseInt(elements.defaultFontSizeSlider.value, 10);
    elements.defaultFontSizeValue.textContent = `${value}px`;
    userSettings.defaultFontSize = value;
    saveSettings();
  });

  elements.defaultGapThresholdSlider.addEventListener('input', () => {
    const value = parseInt(elements.defaultGapThresholdSlider.value, 10);
    elements.defaultGapThresholdValue.textContent = `${value}s`;
    userSettings.defaultGapThreshold = value;
    saveSettings();
    // Update the gap threshold input if visible
    const gapInput = document.getElementById('gap-threshold') as HTMLInputElement;
    if (gapInput) {
      gapInput.value = value.toString();
    }
  });

  elements.autoAnalyzeCheckbox.addEventListener('change', () => {
    userSettings.autoAnalyze = elements.autoAnalyzeCheckbox.checked;
    saveSettings();
  });

  elements.themeSelect.addEventListener('change', () => {
    userSettings.theme = elements.themeSelect.value as 'dark' | 'paper';
    saveSettings();
    applyTheme(userSettings.theme);
  });

  elements.btnResetSettings.addEventListener('click', () => {
    userSettings = { ...DEFAULT_SETTINGS, sidebarSections: { ...DEFAULT_SIDEBAR_SECTIONS } };
    saveSettings();
    // Update UI
    elements.scrollSpeedSlider.value = userSettings.scrollSpeed.toString();
    elements.scrollSpeedValue.textContent = `${userSettings.scrollSpeed}%`;
    elements.defaultFontSizeSlider.value = userSettings.defaultFontSize.toString();
    elements.defaultFontSizeValue.textContent = `${userSettings.defaultFontSize}px`;
    elements.defaultGapThresholdSlider.value = userSettings.defaultGapThreshold.toString();
    elements.defaultGapThresholdValue.textContent = `${userSettings.defaultGapThreshold}s`;
    elements.autoAnalyzeCheckbox.checked = userSettings.autoAnalyze;
    elements.themeSelect.value = userSettings.theme;
    applyTheme(userSettings.theme);
    populateSidebarSectionToggles();
    applySidebarSectionVisibility();
  });

  elements.btnCloseSettings.addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });

  // Bookmark modal
  elements.btnSaveBookmark.addEventListener('click', () => hideBookmarkModal(true));
  elements.btnCancelBookmark.addEventListener('click', () => hideBookmarkModal(false));
  elements.bookmarkComment.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      hideBookmarkModal(true);
    } else if (e.key === 'Escape') {
      hideBookmarkModal(false);
    }
  });

  // Export bookmarks
  elements.btnExportBookmarks.addEventListener('click', async () => {
    if (state.bookmarks.length === 0) {
      alert('No bookmarks to export');
      return;
    }
    const result = await window.api.exportBookmarks();
    if (result.success && result.filePath) {
      // Open the exported file in a new tab
      await loadFileAsInactiveTab(result.filePath);
    } else if (result.error) {
      alert(`Export failed: ${result.error}`);
    }
  });

  // Bookmark Sets
  elements.btnSaveBookmarkSet.addEventListener('click', saveBookmarkSet);
  elements.btnLoadBookmarkSet.addEventListener('click', refreshBookmarkSets);

  // Notes modal
  elements.btnSaveNotes.addEventListener('click', () => hideNotesModal(true));
  elements.btnCancelNotes.addEventListener('click', () => hideNotesModal(false));
  elements.notesDescription.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      hideNotesModal(true);
    } else if (e.key === 'Escape') {
      hideNotesModal(false);
    }
  });

  // Setup utilities
  setupActivityBar();
  setupSectionToggles();
  setupModalCloseHandlers();
  setupKeyboardShortcuts();

  // Load initial data
  loadBookmarks();
  loadHighlights();
  loadHighlightGroups();
}

async function loadBookmarks(): Promise<void> {
  const result = await window.api.listBookmarks();
  if (result.success && result.bookmarks) {
    state.bookmarks = result.bookmarks;
    updateBookmarksUI();
  }
}

async function loadHighlights(): Promise<void> {
  const result = await window.api.listHighlights();
  if (result.success && result.highlights) {
    state.highlights = result.highlights;
    updateHighlightsUI();
  }
}

// === Highlight Groups ===

async function loadHighlightGroups(): Promise<void> {
  const result = await window.api.listHighlightGroups();
  if (result.success && result.groups) {
    highlightGroups = result.groups;
    updateHighlightGroupsUI();
  }
}

function updateHighlightGroupsUI(): void {
  const chipsContainer = elements.highlightGroupsChips;
  const deleteBtn = elements.btnDeleteHighlightGroup;

  if (highlightGroups.length === 0) {
    chipsContainer.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">No saved groups</span>';
    deleteBtn.style.display = 'none';
    return;
  }

  chipsContainer.innerHTML = highlightGroups
    .map(g => `<span class="highlight-group-chip${g.id === activeHighlightGroupId ? ' active' : ''}" data-id="${g.id}" title="${escapeHtml(g.name)} (${g.highlights.length} rules)">${escapeHtml(g.name)}</span>`)
    .join('');

  // Show/hide delete button based on active group
  deleteBtn.style.display = activeHighlightGroupId ? '' : 'none';

  // Add click handlers to chips
  chipsContainer.querySelectorAll('.highlight-group-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset.id!;
      applyHighlightGroup(id);
    });
  });
}

async function applyHighlightGroup(groupId: string): Promise<void> {
  // Toggle off if already active (unload)
  if (activeHighlightGroupId === groupId) {
    await window.api.clearAllHighlights();
    state.highlights = [];
    activeHighlightGroupId = null;
    updateHighlightGroupsUI();
    updateHighlightsUI();
    renderVisibleLines();
    return;
  }

  const group = highlightGroups.find(g => g.id === groupId);
  if (!group) return;

  // Clear current highlights
  await window.api.clearAllHighlights();

  // Apply group's highlights
  for (const h of group.highlights) {
    await window.api.addHighlight(h);
  }

  // Reload highlights from backend
  const result = await window.api.listHighlights();
  if (result.success && result.highlights) {
    state.highlights = result.highlights;
  }

  activeHighlightGroupId = groupId;
  updateHighlightGroupsUI();
  updateHighlightsUI();
  renderVisibleLines();
}

function showTextInputModal(title: string, label: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;';

    overlay.innerHTML = `
      <div class="modal-content" style="width:400px;">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="modal-body">
          <div class="filter-group">
            <label>${escapeHtml(label)}</label>
            <input type="text" class="modal-input" placeholder="${escapeHtml(placeholder)}" autofocus>
          </div>
        </div>
        <div class="modal-footer">
          <button class="secondary-btn" data-action="cancel">Cancel</button>
          <button class="primary-btn" data-action="save">Save</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('input') as HTMLInputElement;
    const btnSave = overlay.querySelector('[data-action="save"]') as HTMLButtonElement;
    const btnCancel = overlay.querySelector('[data-action="cancel"]') as HTMLButtonElement;

    const close = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    btnSave.addEventListener('click', () => {
      const val = input.value.trim();
      close(val || null);
    });
    btnCancel.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value.trim();
        close(val || null);
      } else if (e.key === 'Escape') {
        close(null);
      }
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    document.body.appendChild(overlay);
    input.focus();
  });
}

async function saveCurrentAsHighlightGroup(): Promise<void> {
  if (state.highlights.length === 0) {
    alert('No highlight rules to save. Add highlights first.');
    return;
  }

  const name = await showTextInputModal('Save Highlight Group', 'Group Name', 'e.g., Error patterns, Auth flow...');
  if (!name) return;

  const group: HighlightGroupData = {
    id: `hg-${Date.now()}`,
    name,
    highlights: state.highlights.map(h => ({ ...h })),
    createdAt: Date.now(),
  };

  const result = await window.api.saveHighlightGroup(group);
  if (result.success) {
    highlightGroups.push(group);
    activeHighlightGroupId = group.id;
    updateHighlightGroupsUI();
  }
}

async function deleteActiveHighlightGroup(): Promise<void> {
  if (!activeHighlightGroupId) return;

  const group = highlightGroups.find(g => g.id === activeHighlightGroupId);
  if (!group) return;

  if (!confirm(`Delete highlight group "${group.name}"?`)) return;

  const result = await window.api.deleteHighlightGroup(activeHighlightGroupId);
  if (result.success) {
    highlightGroups = highlightGroups.filter(g => g.id !== activeHighlightGroupId);
    activeHighlightGroupId = null;
    updateHighlightGroupsUI();
  }
}

// === Tab Management ===

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function saveCurrentTabState(): void {
  if (!state.activeTabId) return;

  const tabIndex = state.tabs.findIndex(t => t.id === state.activeTabId);
  if (tabIndex === -1) return;

  // Save current state to the tab
  state.tabs[tabIndex] = {
    ...state.tabs[tabIndex],
    filePath: state.filePath || '',
    fileStats: state.fileStats,
    totalLines: state.totalLines,
    scrollTop: logViewerElement?.scrollTop || 0,
    scrollLeft: logViewerElement?.scrollLeft || 0,
    selectedLine: state.selectedLine,
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    searchResults: state.searchResults,
    currentSearchIndex: state.currentSearchIndex,
    hiddenSearchMatches: state.hiddenSearchMatches,
    bookmarks: [...state.bookmarks],
    highlights: [...state.highlights],
    cachedLines: cachedLines.toMap(),
    splitFiles: state.splitFiles,
    currentSplitIndex: state.currentSplitIndex,
    minimapData: minimapData.length > 0 ? [...minimapData] : null,
    isLoaded: true,
    columnConfig: state.columnConfig,
    analysisResult: state.analysisResult,
    isFiltered: state.isFiltered,
    filteredLines: state.filteredLines,
    activeLevelFilter: state.activeLevelFilter,
    appliedFilterSuggestion: state.appliedFilterSuggestion,
  };
}

function restoreTabState(tab: TabState): void {
  state.filePath = tab.filePath;
  state.fileStats = tab.fileStats;
  state.totalLines = tab.totalLines;
  state.selectedLine = tab.selectedLine;
  state.selectionStart = tab.selectionStart;
  state.selectionEnd = tab.selectionEnd;
  state.searchResults = tab.searchResults;
  state.currentSearchIndex = tab.currentSearchIndex;
  state.hiddenSearchMatches = tab.hiddenSearchMatches;
  state.bookmarks = [...tab.bookmarks];
  state.highlights = [...tab.highlights];
  state.splitFiles = tab.splitFiles;
  state.currentSplitIndex = tab.currentSplitIndex;
  state.columnConfig = tab.columnConfig;

  // Restore analysis & filter state
  state.analysisResult = tab.analysisResult;
  state.isFiltered = tab.isFiltered;
  state.filteredLines = tab.filteredLines;
  state.activeLevelFilter = tab.activeLevelFilter;
  state.appliedFilterSuggestion = tab.appliedFilterSuggestion;

  // Restore cached lines
  cachedLines.clear();
  tab.cachedLines.forEach((line, key) => cachedLines.set(key, line));

  // Update UI
  updateFileStatsUI();
  updateStatusBar();
  updateBookmarksUI();
  updateSearchUI();
  if (state.activeBottomTab === 'search-results') {
    renderSearchResultsList();
  }
}

function createTab(filePath: string): TabState {
  const tab: TabState = {
    id: generateTabId(),
    filePath,
    fileStats: null,
    totalLines: 0,
    scrollTop: 0,
    scrollLeft: 0,
    selectedLine: null,
    selectionStart: null,
    selectionEnd: null,
    searchResults: [],
    currentSearchIndex: -1,
    hiddenSearchMatches: [],
    bookmarks: [],
    highlights: [],
    cachedLines: new Map(),
    splitFiles: [],
    currentSplitIndex: -1,
    isLoading: false,
    loadingText: '',
    loadingPercent: 0,
    minimapData: null,
    isLoaded: false,
    columnConfig: null,
    analysisResult: null,
    isFiltered: false,
    filteredLines: null,
    activeLevelFilter: null,
    appliedFilterSuggestion: null,
  };
  return tab;
}

async function switchToTab(tabId: string): Promise<void> {
  if (tabId === state.activeTabId) return;

  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab || !tab.filePath) return;

  // Deactivate split/diff when switching primary tab
  if (viewMode !== 'single') deactivateSplitView();

  // Save current tab state
  saveCurrentTabState();

  // Set new active tab
  state.activeTabId = tabId;

  // Sync loading overlay for new tab (may already be loading)
  syncLoadingOverlay();

  // Only show progress for files that haven't been loaded yet
  const isAlreadyLoaded = tab.isLoaded;
  if (!isAlreadyLoaded) {
    showProgress('Opening file...');
  }

  try {
    const result = await window.api.openFile(tab.filePath);

    if (result.success && result.info) {
      // Restore tab state
      restoreTabState(tab);

      // Handle markdown preview state for the new tab
      isMarkdownFile = isMarkdownExtension(tab.filePath);
      if (isMarkdownFile) {
        markdownPreviewMode = true;
        elements.btnWordWrap.textContent = 'Raw';
        elements.btnWordWrap.title = 'Show raw markdown';
        await renderMarkdownPreview();
        showMarkdownPreview();
      } else {
        markdownPreviewMode = false;
        elements.markdownPreview.classList.add('hidden');
        elements.markdownPreview.innerHTML = '';
        elements.btnWordWrap.textContent = 'Wrap';
        elements.btnWordWrap.title = 'Toggle word wrap (⌥Z)';
        const wrapper = document.querySelector('.log-viewer-wrapper') as HTMLElement;
        if (wrapper) {
          wrapper.style.display = '';
        }
      }

      // Update with fresh info from backend
      state.totalLines = result.info.totalLines;

      // Load bookmarks and highlights from backend (persisted per-file)
      if (result.bookmarks && Array.isArray(result.bookmarks)) {
        state.bookmarks = result.bookmarks;
        tab.bookmarks = result.bookmarks;
      }
      updateBookmarksUI();

      if (result.highlights && Array.isArray(result.highlights)) {
        state.highlights = result.highlights;
      }
      updateHighlightsUI();

      // Reload search configs, sessions, and context definitions for the new file
      loadSearchConfigs();
      loadSearchConfigSessions();
      loadContextDefinitions();

      createLogViewer();

      // Wait for DOM layout
      await new Promise(resolve => requestAnimationFrame(resolve));

      // Initialize visible range from saved scroll position
      if (logViewerElement) {
        const containerHeight = logViewerElement.clientHeight;
        const visibleLines = Math.ceil(containerHeight / getLineHeight());

        // Calculate visible range from saved scroll position
        const startLine = scrollTopToLine(tab.scrollTop);
        state.visibleStartLine = Math.max(0, startLine - BUFFER_LINES);
        state.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, getTotalLines() - 1);
      }

      await loadVisibleLines();

      // Restore scroll position AFTER content is rendered
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (logViewerElement) {
        logViewerElement.scrollTop = tab.scrollTop;
        logViewerElement.scrollLeft = tab.scrollLeft;
      }

      updateSplitNavigation();

      // Use cached minimap if available, otherwise rebuild
      if (tab.minimapData && tab.minimapData.length > 0) {
        minimapData = tab.minimapData;
        renderMinimap();
      } else if (!isAlreadyLoaded) {
        await buildMinimap();
      }

      // Restore analysis & filter UI
      updateAnalysisUI();
      updateLevelBadgeStyles();

      // Mark as loaded
      tab.isLoaded = true;

      // Change terminal directory to new file's folder
      terminalCdToFile(tab.filePath);
    }
  } finally {
    hideProgress();
  }

  renderTabBar();
}

function closeTab(tabId: string): void {
  const tabIndex = state.tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  // If closing the secondary tab in split/diff mode, deactivate
  if (viewMode !== 'single' && tabId === splitDiffState.secondaryTabId) {
    deactivateSplitView();
  }

  // Remove the tab
  state.tabs.splice(tabIndex, 1);

  // If closing the active tab, switch to another
  if (tabId === state.activeTabId) {
    if (state.tabs.length > 0) {
      // Switch to the previous tab, or the first one
      const newIndex = Math.min(tabIndex, state.tabs.length - 1);
      switchToTab(state.tabs[newIndex].id);
    } else {
      // No more tabs - reset to welcome state
      state.activeTabId = null;
      state.filePath = null;
      state.fileStats = null;
      state.totalLines = 0;
      state.searchResults = [];
      state.currentSearchIndex = -1;
      state.hiddenSearchMatches = [];
      state.bookmarks = [];
      state.highlights = [];
      cachedLines.clear();
      state.splitFiles = [];
      state.currentSplitIndex = -1;

      // Show welcome message
      if (logViewerWrapper) {
        logViewerWrapper.remove();
        logViewerWrapper = null;
        logViewerElement = null;
        logContentElement = null;
      }
      elements.welcomeMessage.classList.remove('hidden');
      elements.tabBar.classList.add('hidden');
      closeBottomPanel();
      updateStatusBar();
      updateFileStatsUI();
      updateBookmarksUI();
      updateHighlightsUI();
    }
  }

  renderTabBar();
  // setupHelpTooltips moved outside init
}

function renderTabBar(): void {
  if (state.tabs.length === 0) {
    elements.tabBar.classList.add('hidden');
    return;
  }

  elements.tabBar.classList.remove('hidden');
  elements.tabsContainer.innerHTML = '';

  for (const tab of state.tabs) {
    const tabElement = document.createElement('div');
    tabElement.className = `tab${tab.id === state.activeTabId ? ' active' : ''}`;
    tabElement.dataset.tabId = tab.id;

    const fileName = getFileName(tab.filePath);
    let displayName = fileName;

    // Add split indicator if part of a split set
    if (tab.splitFiles.length > 0 && tab.currentSplitIndex >= 0) {
      displayName += ` [${tab.currentSplitIndex + 1}/${tab.splitFiles.length}]`;
    }

    tabElement.innerHTML = `
      <span class="tab-title" title="${tab.filePath}">${displayName}</span>
      <button class="tab-close" data-tab-id="${tab.id}" title="Close">&times;</button>
    `;

    // Tab click - switch to tab
    tabElement.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('tab-close')) {
        switchToTab(tab.id);
      }
    });

    // Close button click
    const closeBtn = tabElement.querySelector('.tab-close') as HTMLButtonElement;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    // Context menu for tabs
    tabElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFileContextMenu(e as MouseEvent, tab.filePath, tab.id);
    });

    elements.tabsContainer.appendChild(tabElement);
  }
}

function showFileContextMenu(e: MouseEvent, filePath: string, tabId?: string): void {
  // Remove existing context menu
  const existing = document.querySelector('.tab-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';

  const fileName = getFileName(filePath);
  const items: string[] = [];

  items.push(`<div class="tab-context-item" data-action="copy-name">Copy Name</div>`);
  items.push(`<div class="tab-context-item" data-action="copy-path">Copy Path</div>`);
  items.push(`<div class="tab-context-item" data-action="copy-all">Copy All Content</div>`);
  items.push(`<div class="tab-context-item" data-action="show-in-folder">Show in Folder</div>`);

  // Split/Diff only for non-active tabs when there are 2+ tabs
  if (tabId && tabId !== state.activeTabId && state.tabs.length >= 2) {
    items.push(`<div class="tab-context-separator"></div>`);
    items.push(`<div class="tab-context-item" data-action="split">Open in Split View</div>`);
    items.push(`<div class="tab-context-item" data-action="diff">Compare with Current Tab</div>`);
  }

  // Close tab
  if (tabId) {
    items.push(`<div class="tab-context-separator"></div>`);
    items.push(`<div class="tab-context-item" data-action="close">Close Tab</div>`);
  }

  menu.innerHTML = items.join('');

  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  document.body.appendChild(menu);

  // Handle clicks
  menu.addEventListener('click', async (ev) => {
    const target = (ev.target as HTMLElement).closest('.tab-context-item') as HTMLElement;
    if (!target) return;
    const action = target.dataset.action;
    menu.remove();
    switch (action) {
      case 'copy-name':
        navigator.clipboard.writeText(fileName);
        break;
      case 'copy-path':
        navigator.clipboard.writeText(filePath);
        break;
      case 'copy-all':
        await copyAllFileContent(filePath);
        break;
      case 'show-in-folder':
        window.api.showItemInFolder(filePath);
        break;
      case 'split':
        if (tabId) activateSplitView(tabId);
        break;
      case 'diff':
        if (tabId) activateDiffView(tabId);
        break;
      case 'close':
        if (tabId) closeTab(tabId);
        break;
    }
  });

  // Close on click outside
  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

async function copyAllFileContent(filePath: string): Promise<void> {
  const result = await window.api.readFileContent(filePath);
  if (!result.success) {
    alert(result.error || 'Failed to read file');
    return;
  }
  if (result.sizeMB && result.sizeMB > 10) {
    const proceed = confirm(`This file is ${result.sizeMB.toFixed(1)}MB. Copying to clipboard may be slow. Continue?`);
    if (!proceed) return;
  }
  if (result.content !== undefined) {
    await navigator.clipboard.writeText(result.content);
  }
}

function findTabByFilePath(filePath: string): TabState | undefined {
  return state.tabs.find(t => t.filePath === filePath);
}

// Start the app
init();

// Setup help tooltips after init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setupHelpTooltips());
} else {
  setupHelpTooltips();
}
