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
}

interface HiddenMatch {
  lineNumber: number;
  column: number;
  length: number;
  lineText: string;
}

interface PatternGroup {
  pattern: string;
  template: string;
  count: number;
  sampleLines: number[];
  sampleText?: string;
  category: 'noise' | 'error' | 'warning' | 'info' | 'debug' | 'unknown';
}

interface DuplicateGroup {
  hash: string;
  text: string;
  count: number;
  lineNumbers: number[];
}

interface ColumnStatValue {
  value: string;
  count: number;
  percentage: number;
}

interface ColumnStats {
  name: string;
  type: string;
  topValues: ColumnStatValue[];
  uniqueCount: number;
}

// Insight types for actionable analysis
interface NoiseCandidate {
  pattern: string;
  sampleText: string;
  count: number;
  percentage: number;
  channel?: string;
  suggestedFilter: string;
}

interface ErrorGroup {
  pattern: string;
  sampleText: string;
  count: number;
  level: 'error' | 'warning';
  channel?: string;
  firstLine: number;
  lastLine: number;
}

interface Anomaly {
  text: string;
  lineNumber: number;
  level?: string;
  channel?: string;
  reason: string;
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
  noiseCandidates: NoiseCandidate[];
  errorGroups: ErrorGroup[];
  anomalies: Anomaly[];
  filterSuggestions: FilterSuggestion[];
}

interface AnalysisResult {
  stats: FileStats;
  patterns: PatternGroup[];
  levelCounts: Record<string, number>;
  duplicateGroups: DuplicateGroup[];
  timeRange?: { start: string; end: string };
  columnStats?: ColumnStats[];
  insights?: AnalysisInsights;
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
  // Notes drawer
  notesVisible: boolean;
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
  notesVisible: false,
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
  { id: 'stats', label: 'File Stats', colorVar: '--section-color-stats' },
  { id: 'analysis', label: 'Analysis', colorVar: '--section-color-analysis' },
  { id: 'duplicates', label: 'Duplicates', colorVar: '--section-color-duplicates' },
  { id: 'time-gaps', label: 'Time Gaps', colorVar: '--section-color-timegaps' },
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
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar') as HTMLButtonElement,
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
  duplicatesList: document.getElementById('duplicates-list') as HTMLDivElement,
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
  includePatterns: document.getElementById('include-patterns') as HTMLTextAreaElement,
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
  btnSettings: document.getElementById('btn-settings') as HTMLButtonElement,
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
  btnTerminalToggle: document.getElementById('btn-terminal-toggle') as HTMLButtonElement,
  // Notes drawer
  notesOverlay: document.getElementById('notes-overlay') as HTMLDivElement,
  notesDrawer: document.getElementById('notes-drawer') as HTMLDivElement,
  notesTextarea: document.getElementById('notes-textarea') as HTMLTextAreaElement,
  notesSaveStatus: document.getElementById('notes-save-status') as HTMLSpanElement,
  notesResizeHandle: document.getElementById('notes-resize-handle') as HTMLDivElement,
  btnNotesToggle: document.getElementById('btn-notes-toggle') as HTMLButtonElement,
  btnNotesClose: document.getElementById('btn-notes-close') as HTMLButtonElement,
  // Panel resize
  panelContainer: document.getElementById('panel-container') as HTMLDivElement,
  panelTitle: document.getElementById('panel-title') as HTMLSpanElement,
  panelResizeHandle: document.getElementById('panel-resize-handle') as HTMLDivElement,
  btnClosePanel: document.getElementById('btn-close-panel') as HTMLButtonElement,
  btnPinPanel: document.getElementById('btn-pin-panel') as HTMLButtonElement,
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

// Terminal - xterm.js instance
// @ts-ignore - Terminal loaded via script tag
let terminal: any = null;
// @ts-ignore - FitAddon loaded via script tag
let fitAddon: any = null;
let terminalInputDisposable: { dispose(): void } | null = null;
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
      // Pixel-based scrolling (trackpad) - apply user's scroll speed setting
      const speedFactor = userSettings.scrollSpeed / 100;
      deltaY = deltaY * speedFactor;
      deltaX = deltaX * speedFactor;
    } else if (e.deltaMode === 1) {
      // Line-based scrolling (mouse wheel) - convert to pixels
      deltaY = deltaY * getLineHeight();
      deltaX = deltaX * getLineHeight();
    } else if (e.deltaMode === 2) {
      // Page-based scrolling - convert to pixels
      deltaY = deltaY * logViewerElement!.clientHeight;
      deltaX = deltaX * logViewerElement!.clientWidth;
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

  // Detect scroll slowness and suggest formatting
  if (!scrollSlownessWarningShown && renderTime > SLOW_SCROLL_THRESHOLD_MS) {
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
  const hasActiveHighlights = state.highlights.length > 0 || state.searchResults.length > 0;

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
  const hasActiveHighlights = state.highlights.length > 0 || state.searchResults.length > 0;

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
  minimapElement.querySelectorAll('.minimap-bookmark, .minimap-search-marker, .minimap-notes-marker').forEach(el => el.remove());

  const totalLines = getTotalLines();
  if (totalLines === 0) return;

  const minimapHeight = minimapElement.clientHeight;

  // Add saved notes range markers (drawn first, behind other markers)
  for (const range of state.savedRanges) {
    const marker = document.createElement('div');
    marker.className = 'minimap-notes-marker';
    const top = (range.startLine / totalLines) * minimapHeight;
    const height = Math.max(3, ((range.endLine - range.startLine + 1) / totalLines) * minimapHeight);
    marker.style.top = `${top}px`;
    marker.style.height = `${height}px`;
    marker.title = `Saved: Lines ${range.startLine + 1}-${range.endLine + 1}`;
    minimapElement.appendChild(marker);
  }

  // Add bookmark markers with colors and tooltips
  for (const bookmark of state.bookmarks) {
    const marker = document.createElement('div');
    marker.className = 'minimap-bookmark';
    marker.style.top = `${(bookmark.lineNumber / totalLines) * minimapHeight}px`;
    if (bookmark.color) {
      marker.style.backgroundColor = bookmark.color;
    }
    marker.title = bookmark.label || `Bookmark: Line ${bookmark.lineNumber + 1}`;
    minimapElement.appendChild(marker);
  }

  // Add search result markers (limit to prevent performance issues)
  const maxSearchMarkers = 100;
  const searchStep = Math.max(1, Math.floor(state.searchResults.length / maxSearchMarkers));
  for (let i = 0; i < state.searchResults.length; i += searchStep) {
    const result = state.searchResults[i];
    const marker = document.createElement('div');
    marker.className = 'minimap-search-marker';
    marker.style.top = `${(result.lineNumber / totalLines) * minimapHeight}px`;
    minimapElement.appendChild(marker);
  }
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
      <div class="folder-group ${folder.collapsed ? 'collapsed' : ''}" data-path="${folder.path}">
        <div class="folder-header">
          <span class="folder-toggle">&#9660;</span>
          <span class="folder-name" title="${folder.path}">${folder.name}</span>
          <button class="folder-close" title="Remove folder">&times;</button>
        </div>
        <div class="folder-files">
          ${
            folder.files.length === 0
              ? '<div class="placeholder" style="padding: 4px 0; font-size: 11px;">No log files</div>'
              : folder.files
                  .map(
                    (file) => `
              <div class="folder-file ${file.path === state.filePath ? 'active' : ''}" data-path="${file.path}">
                <span class="folder-file-name" title="${file.name}">${file.name}</span>
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
      if (filePath) {
        await loadFile(filePath);
        renderFolderTree(); // Update active state
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

// === Terminal ===

async function initTerminal(): Promise<void> {
  if (state.terminalInitialized) return;

  // @ts-ignore - Terminal loaded via script tag
  const Terminal = window.Terminal;
  // @ts-ignore - FitAddon loaded via script tag
  const FitAddon = window.FitAddon;

  if (!Terminal || !FitAddon) {
    console.error('xterm.js not loaded');
    return;
  }

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: "'SF Mono', 'Consolas', 'Monaco', monospace",
    allowProposedApi: true,
    allowTransparency: true,
    theme: {
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
    },
  });

  fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);

  terminal.open(elements.terminalContainer);

  // Handle terminal input
  terminalInputDisposable = terminal.onData((data: string) => {
    window.api.terminalWrite(data);
  });

  // Handle terminal output
  terminalDataUnsubscribe = window.api.onTerminalData((data) => {
    terminal.write(data);
  });

  // Handle terminal exit
  terminalExitUnsubscribe = window.api.onTerminalExit((exitCode) => {
    terminal.writeln(`\r\n[Process exited with code ${exitCode}]`);
    terminal.writeln('Press any key to restart...');
    const restartHandler = terminal.onKey(() => {
      restartHandler.dispose();
      startTerminalProcess();
    });
  });

  // Start the terminal process
  await startTerminalProcess();

  state.terminalInitialized = true;

  // Handle window resize
  window.addEventListener('resize', () => fitTerminalToPanel());

  // Click to focus terminal
  elements.terminalContainer.addEventListener('click', () => {
    terminal?.focus();
  });
}

async function startTerminalProcess(): Promise<void> {
  // Get current file directory or home
  let cwd: string | undefined;
  if (state.filePath) {
    const lastSlash = state.filePath.lastIndexOf('/');
    if (lastSlash > 0) {
      cwd = state.filePath.substring(0, lastSlash);
    }
  }

  const dims = fitAddon?.proposeDimensions();
  const cols = dims?.cols || 80;
  const rows = dims?.rows || 24;

  await window.api.terminalCreate({ cwd, cols, rows });
}

function showTerminalOverlay(): void {
  const overlay = elements.terminalOverlay;
  overlay.classList.remove('hidden');
  // Force reflow so the transition triggers from initial state
  void overlay.offsetHeight;
  overlay.classList.add('visible');
  elements.btnTerminalToggle.classList.add('active');

  // Fit terminal and focus after slide animation completes
  const panel = overlay.querySelector('.terminal-drop-panel') as HTMLElement;
  if (panel) {
    const onShown = () => {
      panel.removeEventListener('transitionend', onShown);
      fitTerminalToPanel();
      terminal?.focus();
    };
    panel.addEventListener('transitionend', onShown);
  }
}

function hideTerminalOverlay(): void {
  const overlay = elements.terminalOverlay;
  overlay.classList.remove('visible');
  elements.btnTerminalToggle.classList.remove('active');
  // Fallback if transitionend doesn't fire (e.g., display:none, no transition)
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
  if (fitAddon && state.terminalVisible) {
    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (dims) {
      window.api.terminalResize(dims.cols, dims.rows);
    }
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
  if (!state.terminalInitialized || !filePath) return;

  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash > 0) {
    const dir = filePath.substring(0, lastSlash);
    await window.api.terminalCd(dir);
    // Clear terminal and show fresh prompt
    if (terminal) {
      terminal.clear();
    }
  }
}

// ─── Notes Drawer ───────────────────────────────────────────────────
let notesSaveTimer: ReturnType<typeof setTimeout> | null = null;

function showNotesDrawer(): void {
  const overlay = elements.notesOverlay;
  overlay.classList.remove('hidden');
  // Force reflow so the transition triggers from initial state
  void overlay.offsetHeight;
  overlay.classList.add('visible');
  elements.btnNotesToggle.classList.add('active');

  // Focus textarea after slide animation completes
  const drawer = overlay.querySelector('.notes-drawer') as HTMLElement;
  if (drawer) {
    const onShown = () => {
      drawer.removeEventListener('transitionend', onShown);
      elements.notesTextarea.focus();
    };
    drawer.addEventListener('transitionend', onShown);
  }

  // Load notes content
  window.api.loadNotes().then((result) => {
    if (result.success && result.content) {
      elements.notesTextarea.value = result.content;
    } else {
      elements.notesTextarea.value = '';
    }
  });
}

function hideNotesDrawer(): void {
  const overlay = elements.notesOverlay;
  overlay.classList.remove('visible');
  elements.btnNotesToggle.classList.remove('active');
  // Fallback if transitionend doesn't fire (e.g., display:none, no transition)
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

function toggleNotesDrawer(): void {
  state.notesVisible = !state.notesVisible;
  if (state.notesVisible) {
    showNotesDrawer();
  } else {
    hideNotesDrawer();
  }
}

function closeNotesDrawer(): void {
  if (!state.notesVisible) return;
  state.notesVisible = false;
  hideNotesDrawer();
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

function setupNotesDrawerResize(): void {
  const handle = elements.notesResizeHandle;
  const drawer = elements.notesDrawer;
  let startY = 0;
  let startHeight = 0;
  let isDragging = false;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    isDragging = true;
    startY = e.clientY;
    startHeight = drawer.offsetHeight;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e: MouseEvent): void {
    if (!isDragging) return;
    // Dragging up increases height (startY - e.clientY is positive when moving up)
    const delta = startY - e.clientY;
    const newHeight = Math.max(120, Math.min(window.innerHeight * 0.7, startHeight + delta));
    drawer.style.height = newHeight + 'px';
  }

  function onMouseUp(): void {
    isDragging = false;
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
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

      // Show warning for files with long lines
      if (result.hasLongLines) {
        elements.longLinesWarning.classList.remove('hidden');
      } else {
        elements.longLinesWarning.classList.add('hidden');
      }

      // Reset JSON formatting state for non-formatted files
      if (!filePath.includes('.formatted.')) {
        jsonFormattingEnabled = false;
        jsonOriginalFile = null;
        elements.btnJsonFormat.classList.remove('active');
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
        elements.markdownPreview.classList.add('hidden');
        elements.btnWordWrap.textContent = 'Wrap';
        elements.btnWordWrap.title = 'Toggle word wrap (⌥Z)';
        const wrapper = document.querySelector('.log-viewer-wrapper') as HTMLElement;
        if (wrapper) {
          wrapper.style.display = '';
        }
      }

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
  goToLine(result.lineNumber);
  updateSearchUI();
  renderVisibleLines(); // Update current match highlight
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
function showFilterModal(): void {
  elements.filterModal.classList.remove('hidden');
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
      includePatterns: elements.includePatterns.value
        .split('\n')
        .filter((p) => p.trim()),
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
  // Validate that we have at least one group with rules
  const validGroups = advancedFilterGroups.filter(g =>
    g.rules.some(r => r.value.trim() !== '' || r.type === 'level' || r.type === 'not_level')
  );

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
        <div class="highlight-preview">
          <span class="highlight-color" style="background-color: ${h.backgroundColor}"></span>
          <span class="highlight-pattern">${escapeHtml(h.pattern)}</span>
          <span class="highlight-scope ${h.isGlobal ? 'global' : 'local'}">${h.isGlobal ? 'G' : 'L'}</span>
        </div>
        <div class="highlight-nav">
          <button class="highlight-nav-btn highlight-prev" data-id="${h.id}" title="Previous match">◀</button>
          <span class="highlight-nav-pos" data-id="${h.id}">${posText}</span>
          <button class="highlight-nav-btn highlight-next" data-id="${h.id}" title="Next match">▶</button>
        </div>
        <div class="highlight-actions">
          <button class="highlight-toggle-global" data-id="${h.id}" title="${h.isGlobal ? 'Make local (this file only)' : 'Make global (all files)'}">${h.isGlobal ? '🌐' : '📄'}</button>
          <button class="highlight-delete" data-id="${h.id}" title="Delete">&times;</button>
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
    elements.duplicatesList.innerHTML =
      '<p class="placeholder">No duplicates found</p>';
    return;
  }

  const result = state.analysisResult;

  // Level counts - clickable to filter
  let levelHtml = '<div class="level-counts">';
  for (const [level, count] of Object.entries(result.levelCounts)) {
    if (count > 0) {
      levelHtml += `<span class="level-badge ${level}" data-level="${level}" title="Click to filter by ${level}">${level}: ${count.toLocaleString()}</span>`;
    }
  }
  levelHtml += '</div>';

  // Build column stats HTML
  let columnStatsHtml = '';
  if (result.columnStats && result.columnStats.length > 0) {
    columnStatsHtml = result.columnStats.map(col => `
      <div class="column-stat">
        <div class="column-stat-header">
          <span class="column-stat-name">${col.name}</span>
          <span class="column-stat-count">${col.uniqueCount} unique</span>
        </div>
        <div class="column-stat-values">
          ${col.topValues.slice(0, 5).map(v => `
            <div class="column-value-row" title="${escapeHtml(v.value)}">
              <span class="column-value-name">${escapeHtml(v.value.length > 30 ? v.value.substring(0, 30) + '...' : v.value)}</span>
              <span class="column-value-bar" style="width: ${Math.max(v.percentage, 2)}%"></span>
              <span class="column-value-count">${v.count.toLocaleString()} (${v.percentage}%)</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  // Build insights HTML
  let insightsHtml = '';
  if (result.insights) {
    const ins = result.insights;

    // Filter Suggestions - most actionable, show first
    if (ins.filterSuggestions.length > 0 || state.appliedFilterSuggestion) {
      insightsHtml += `
        <div class="insight-section filter-suggestions">
          <div class="insight-header">💡 Suggested Filters</div>
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

    // Noise Detection
    if (ins.noiseCandidates.length > 0) {
      insightsHtml += `
        <div class="insight-section noise-section">
          <div class="insight-header">🔇 Noise (${ins.noiseCandidates.length})</div>
          ${ins.noiseCandidates.slice(0, 5).map(n => `
            <div class="noise-item" title="${escapeHtml(n.sampleText)}">
              <div class="noise-info">
                <span class="noise-count">${n.count.toLocaleString()}× (${n.percentage}%)</span>
                ${n.channel ? `<span class="noise-channel">${escapeHtml(n.channel)}</span>` : ''}
              </div>
              <div class="noise-pattern">${escapeHtml(n.pattern.length > 50 ? n.pattern.substring(0, 50) + '...' : n.pattern)}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Error Groups
    if (ins.errorGroups.length > 0) {
      insightsHtml += `
        <div class="insight-section error-section">
          <div class="insight-header">⚠️ Errors/Warnings (${ins.errorGroups.length})</div>
          ${ins.errorGroups.slice(0, 10).map(e => `
            <div class="error-group-item" data-line="${e.firstLine}" title="${escapeHtml(e.sampleText)}">
              <div class="error-group-header">
                <span class="level-badge ${e.level}">${e.level}</span>
                <span class="error-count">${e.count}×</span>
              </div>
              <div class="error-pattern">${escapeHtml(e.pattern.length > 60 ? e.pattern.substring(0, 60) + '...' : e.pattern)}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Anomalies
    if (ins.anomalies.length > 0) {
      insightsHtml += `
        <div class="insight-section anomaly-section">
          <div class="insight-header">🔍 Anomalies (${ins.anomalies.length})</div>
          ${ins.anomalies.slice(0, 5).map(a => `
            <div class="anomaly-item" data-line="${a.lineNumber}" title="${escapeHtml(a.reason)}">
              <div class="anomaly-header">
                <span class="anomaly-line">Line ${a.lineNumber}</span>
                ${a.level ? `<span class="level-badge ${a.level}">${a.level}</span>` : ''}
              </div>
              <div class="anomaly-text">${escapeHtml(a.text.length > 80 ? a.text.substring(0, 80) + '...' : a.text)}</div>
              <div class="anomaly-reason">${escapeHtml(a.reason)}</div>
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  elements.analysisResults.innerHTML = `
    ${levelHtml}
    ${columnStatsHtml}
    ${insightsHtml}
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

      // If clicking the same level that's already filtered, clear the filter
      if (state.isFiltered && state.activeLevelFilter === level) {
        await clearFilter();
        state.activeLevelFilter = null;
        updateLevelBadgeStyles();
        return;
      }

      // Apply filter for this level only
      await applyQuickLevelFilter(level);
    });
  });

  // Click handlers for error groups - navigate to first occurrence
  elements.analysisResults.querySelectorAll('.error-group-item').forEach((item) => {
    item.addEventListener('click', () => {
      const line = parseInt((item as HTMLElement).dataset.line || '0', 10);
      if (line > 0) goToLine(line);
    });
  });

  // Click handlers for anomalies - navigate to line
  elements.analysisResults.querySelectorAll('.anomaly-item').forEach((item) => {
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
      if (!filterId || !result.insights) return;

      const suggestion = result.insights.filterSuggestions.find(s => s.id === filterId);
      if (!suggestion) return;

      // Track which filter suggestion was applied
      state.appliedFilterSuggestion = { id: suggestion.id, title: suggestion.title };

      // Apply the suggested filter
      const filterConfig: FilterConfig = {
        excludePatterns: suggestion.filter.excludePatterns || [],
        includePatterns: suggestion.filter.includePatterns || [],
        levels: suggestion.filter.levels || [],
      };

      await applyFilter(filterConfig);

      // Refresh the UI to show applied state
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

  // Duplicates
  if (result.duplicateGroups.length === 0) {
    elements.duplicatesList.innerHTML =
      '<p class="placeholder">No duplicates found</p>';
  } else {
    elements.duplicatesList.innerHTML = result.duplicateGroups
      .slice(0, 20)
      .map(
        (d) => `
        <div class="duplicate-item" data-line="${d.lineNumbers[0]}">
          <span class="count">${d.count.toLocaleString()} times</span>
          <div class="template">${escapeHtml(d.text.substring(0, 100))}${
          d.text.length > 100 ? '...' : ''
        }</div>
        </div>
      `
      )
      .join('');

    // Click to navigate
    elements.duplicatesList.querySelectorAll('.duplicate-item').forEach((item) => {
      item.addEventListener('click', () => {
        const line = parseInt((item as HTMLElement).dataset.line || '0', 10);
        goToLine(line);
      });
    });
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
function syncLoadingOverlay(): void {
  const tab = getTab();

  // Get loading state - prefer tab state, fall back to global
  const isLoading = tab ? tab.isLoading : globalLoading.isLoading;
  const text = tab ? tab.loadingText : globalLoading.text;
  const percent = tab ? tab.loadingPercent : globalLoading.percent;

  if (isLoading) {
    // Show loading
    elements.progressContainer.classList.remove('hidden');
    elements.progressBar.style.setProperty('--progress', `${percent}%`);
    elements.progressText.textContent = text || `${percent}%`;

    elements.loadingOverlay.classList.remove('hidden');
    elements.loadingText.textContent = text;
    elements.loadingProgressFill.style.width = `${percent}%`;
    elements.loadingPercent.textContent = `${percent}%`;

    elements.loadingVideo.play().catch(() => {});
  } else {
    // Hide loading
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
const PANEL_IDS = ['folders', 'stats', 'analysis', 'time-gaps', 'bookmarks', 'highlights', 'history'];
const PANEL_NAMES: Record<string, string> = {
  'folders': 'Folders',
  'stats': 'File Stats',
  'analysis': 'Analysis',
  'time-gaps': 'Time Gaps',
  'bookmarks': 'Bookmarks',
  'highlights': 'Highlights',
  'history': 'History',
};

let activePanel: string | null = null;
let lastActivePanel: string | null = null;
let pinnedPanels: Set<string> = new Set();

function togglePanel(panelId: string): void {
  if (activePanel === panelId) {
    // Close panel (but not if pinned)
    if (!pinnedPanels.has(panelId)) {
      closePanel();
    }
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

  // Update pin button state
  elements.btnPinPanel.classList.toggle('pinned', pinnedPanels.has(panelId));

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

function togglePinPanel(): void {
  if (!activePanel) return;
  if (pinnedPanels.has(activePanel)) {
    pinnedPanels.delete(activePanel);
  } else {
    pinnedPanels.add(activePanel);
  }
  elements.btnPinPanel.classList.toggle('pinned', pinnedPanels.has(activePanel));
  savePanelState();
}

function savePanelState(): void {
  localStorage.setItem('logan-panel', JSON.stringify({
    activePanel,
    lastActivePanel,
    panelWidth: elements.panelContainer.style.width || '300px',
    pinnedPanels: [...pinnedPanels],
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
      if (data.pinnedPanels) {
        pinnedPanels = new Set(data.pinnedPanels);
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

  // Pin panel button
  elements.btnPinPanel.addEventListener('click', togglePinPanel);

  // Settings button in activity bar
  document.getElementById('btn-activity-settings')?.addEventListener('click', () => {
    document.getElementById('settings-modal')?.classList.remove('hidden');
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

  // Keyboard shortcuts: Ctrl+1..7 toggle panels, Ctrl+B toggle visibility, Escape close
  document.addEventListener('keydown', (e) => {
    // Ctrl+1..7 — toggle panels
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 7) {
        e.preventDefault();
        togglePanel(PANEL_IDS[num - 1]);
        return;
      }
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

    // Escape: Cancel range selection, close split/diff, close modals, or close terminal
    if (e.key === 'Escape') {
      if (viewMode !== 'single') {
        deactivateSplitView();
        return;
      }
      if (rangeSelectStartLine !== null) {
        rangeSelectStartLine = null;
        elements.statusCursor.textContent = 'Range cancelled';
      } else if (state.notesVisible) {
        closeNotesDrawer();
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

    // Ctrl/Cmd + Shift + N: Toggle notes drawer
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      toggleNotesDrawer();
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
        const newLine = Math.min((state.selectedLine ?? 0) + 1, totalLines - 1);
        state.selectedLine = newLine;
        goToLine(newLine);
        renderVisibleLines();
      }

      // Arrow Up: Move up one line
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newLine = Math.max((state.selectedLine ?? 0) - 1, 0);
        state.selectedLine = newLine;
        goToLine(newLine);
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

      // Page Down: Move down by visible lines
      if (e.key === 'PageDown' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newLine = Math.min((state.selectedLine ?? 0) + visibleLines, totalLines - 1);
        state.selectedLine = newLine;
        goToLine(newLine);
        renderVisibleLines();
      }

      // Page Up: Move up by visible lines
      if (e.key === 'PageUp' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newLine = Math.max((state.selectedLine ?? 0) - visibleLines, 0);
        state.selectedLine = newLine;
        goToLine(newLine);
        renderVisibleLines();
      }

      // Home: Go to first line
      if (e.key === 'Home' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.selectedLine = 0;
        goToLine(0);
        renderVisibleLines();
      }

      // End: Go to last line
      if (e.key === 'End' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.selectedLine = totalLines - 1;
        goToLine(totalLines - 1);
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

function init(): void {
  // Detect platform and setup window controls
  setupWindowControls();

  // Load user settings from localStorage
  loadSettings();
  applySettings();

  // Check search engine on startup
  checkSearchEngine();

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

  // Notes drawer events
  elements.btnNotesToggle.addEventListener('click', toggleNotesDrawer);
  elements.btnNotesClose.addEventListener('click', closeNotesDrawer);
  elements.notesOverlay.addEventListener('click', (e) => {
    if (e.target === elements.notesOverlay) {
      closeNotesDrawer();
    }
  });
  elements.notesTextarea.addEventListener('input', saveNotesDebounced);
  setupNotesDrawerResize();

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

  // Advanced Filter
  elements.btnAdvancedFilter.addEventListener('click', showAdvancedFilterModal);
  elements.btnAddFilterGroup.addEventListener('click', addFilterGroup);
  elements.btnApplyAdvancedFilter.addEventListener('click', applyAdvancedFilter);
  elements.btnClearAdvancedFilter.addEventListener('click', clearAdvancedFilter);
  elements.btnCancelAdvancedFilter.addEventListener('click', hideAdvancedFilterModal);
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

  // Datadog settings - load config when settings open
  const origSettingsClick = elements.btnSettings.onclick;
  elements.btnSettings.addEventListener('click', async () => {
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

  // Sidebar
  elements.btnToggleSidebar.addEventListener('click', togglePanelVisibility);

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

  // Settings modal
  elements.btnSettings.addEventListener('click', () => {
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
    elements.settingsModal.classList.remove('hidden');
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
      updateStatusBar();
      updateFileStatsUI();
      updateBookmarksUI();
      updateHighlightsUI();
    }
  }

  renderTabBar();
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

    // Context menu for split/diff (only on non-active tabs)
    tabElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (tab.id === state.activeTabId) return; // No context menu for active tab
      if (state.tabs.length < 2) return; // Need at least 2 tabs
      showTabContextMenu(e as MouseEvent, tab.id);
    });

    elements.tabsContainer.appendChild(tabElement);
  }
}

function showTabContextMenu(e: MouseEvent, targetTabId: string): void {
  // Remove existing context menu
  const existing = document.querySelector('.tab-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.innerHTML = `
    <div class="tab-context-item" data-action="split">Open in Split View</div>
    <div class="tab-context-item" data-action="diff">Compare with Current Tab</div>
  `;

  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  document.body.appendChild(menu);

  // Handle clicks
  menu.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest('.tab-context-item') as HTMLElement;
    if (!target) return;
    const action = target.dataset.action;
    menu.remove();
    if (action === 'split') {
      activateSplitView(targetTabId);
    } else if (action === 'diff') {
      activateDiffView(targetTabId);
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

function findTabByFilePath(filePath: string): TabState | undefined {
  return state.tabs.find(t => t.filePath === filePath);
}

// Start the app
init();
