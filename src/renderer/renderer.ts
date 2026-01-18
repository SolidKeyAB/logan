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
  bookmarks: Bookmark[];
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
  searchResults: SearchResult[];
  currentSearchIndex: number;
  bookmarks: Bookmark[];
  highlights: HighlightConfig[];
  visibleStartLine: number;
  visibleEndLine: number;
  selectedLine: number | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  splitFiles: string[];
  currentSplitIndex: number;
  // Tab management
  tabs: TabState[];
  activeTabId: string | null;
}

const state: AppState = {
  filePath: null,
  fileStats: null,
  analysisResult: null,
  totalLines: 0,
  filteredLines: null,
  isFiltered: false,
  searchResults: [],
  currentSearchIndex: -1,
  bookmarks: [],
  highlights: [],
  visibleStartLine: 0,
  visibleEndLine: 100,
  selectedLine: null,
  selectionStart: null,
  selectionEnd: null,
  splitFiles: [],
  currentSplitIndex: -1,
  tabs: [],
  activeTabId: null,
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

// Get current line height based on zoom
function getLineHeight(): number {
  return Math.round(BASE_LINE_HEIGHT * (zoomLevel / 100));
}

// Get current font size based on zoom
function getFontSize(): number {
  return Math.round(BASE_FONT_SIZE * (zoomLevel / 100));
}

// Scroll state for optimizations
let lastScrollTop = 0;
let scrollDirection: 'up' | 'down' = 'down';
let scrollRAF: number | null = null;
let isScrolling = false;
let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

// DOM Elements
const elements = {
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
  searchCase: document.getElementById('search-case') as HTMLInputElement,
  searchResultCount: document.getElementById('search-result-count') as HTMLSpanElement,
  sidebar: document.getElementById('sidebar') as HTMLElement,
  editorContainer: document.getElementById('editor-container') as HTMLDivElement,
  welcomeMessage: document.getElementById('welcome-message') as HTMLDivElement,
  fileStats: document.getElementById('file-stats') as HTMLDivElement,
  analysisResults: document.getElementById('analysis-results') as HTMLDivElement,
  patternsList: document.getElementById('patterns-list') as HTMLDivElement,
  duplicatesList: document.getElementById('duplicates-list') as HTMLDivElement,
  bookmarksList: document.getElementById('bookmarks-list') as HTMLDivElement,
  highlightsList: document.getElementById('highlights-list') as HTMLDivElement,
  btnAddHighlight: document.getElementById('btn-add-highlight') as HTMLButtonElement,
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
  includePatterns: document.getElementById('include-patterns') as HTMLTextAreaElement,
  excludePatterns: document.getElementById('exclude-patterns') as HTMLTextAreaElement,
  collapseDuplicates: document.getElementById('collapse-duplicates') as HTMLInputElement,
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
  // Bookmark modal
  bookmarkModal: document.getElementById('bookmark-modal') as HTMLDivElement,
  bookmarkModalTitle: document.getElementById('bookmark-modal-title') as HTMLHeadingElement,
  bookmarkComment: document.getElementById('bookmark-comment') as HTMLInputElement,
  bookmarkLineInfo: document.getElementById('bookmark-line-info') as HTMLParagraphElement,
  btnSaveBookmark: document.getElementById('btn-save-bookmark') as HTMLButtonElement,
  btnCancelBookmark: document.getElementById('btn-cancel-bookmark') as HTMLButtonElement,
  // Notes modal
  notesModal: document.getElementById('notes-modal') as HTMLDivElement,
  notesDescription: document.getElementById('notes-description') as HTMLInputElement,
  notesLineInfo: document.getElementById('notes-line-info') as HTMLParagraphElement,
  btnSaveNotes: document.getElementById('btn-save-notes') as HTMLButtonElement,
  btnCancelNotes: document.getElementById('btn-cancel-notes') as HTMLButtonElement,
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

  // Mouse wheel zoom (Ctrl + scroll)
  logViewerElement.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
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
      state.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, state.totalLines - 1);
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
  renderVisibleLines();
  updateMinimapViewport();

  // Defer data loading to RAF to avoid blocking scroll
  if (scrollRAF !== null) {
    cancelAnimationFrame(scrollRAF);
  }
  scrollRAF = requestAnimationFrame(() => {
    scrollRAF = null;
    // Load any missing data in background
    loadVisibleLines();
  });

  // Mark scrolling state
  isScrolling = true;
  if (scrollEndTimer) clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(() => {
    isScrolling = false;
  }, 150);
}

function performScrollUpdate(): void {
  if (!logViewerElement || !logContentElement) return;

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
  return state.isFiltered && state.filteredLines !== null
    ? state.filteredLines
    : state.totalLines;
}

async function loadVisibleLines(): Promise<void> {
  if (!logContentElement) return;

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
        for (const line of result.lines) {
          cachedLines.set(line.lineNumber, line);
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

  // Batch create all line elements
  for (let i = startLine; i <= endLine; i++) {
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
      lineElement.style.cssText = `position:absolute;top:0;left:0;transform:translateY(${top}px);will-change:transform;white-space:pre;`;

      fragment.appendChild(lineElement);

      // Estimate width based on text length (rough calculation for performance)
      // 8px per character is a reasonable estimate for monospace font at 13px
      const estimatedWidth = 70 + (line.text.length * 8); // 70 = line number width + padding
      if (estimatedWidth > maxContentWidth) {
        maxContentWidth = estimatedWidth;
      }
    }
  }

  // Single DOM operation to replace all content
  logContentElement.innerHTML = '';
  logContentElement.appendChild(fragment);

  // Set content size for scrolling
  logContentElement.style.height = `${virtualHeight}px`;
  logContentElement.style.minWidth = `${Math.max(maxContentWidth, logViewerElement.clientWidth)}px`;

  // Restore horizontal scroll position
  if (scrollLeft > 0) {
    logViewerElement.scrollLeft = scrollLeft;
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
  } else {
    div.title = '';
  }
  div.className = className;

  // Create content using innerHTML for speed (single parse)
  const lineNumHtml = `<span class="line-number">${line.lineNumber + 1}</span>`;
  const contentHtml = `<span class="line-content">${applyHighlights(line.text)}</span>`;
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

  // Apply highlights
  const highlightedText = applyHighlights(line.text);
  contentSpan.innerHTML = highlightedText;

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
  const MAX_LINE_LENGTH = 5000;
  const MAX_DISPLAY_LENGTH = 2000;

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

  const viewportTop = (currentLine / totalLines) * minimapHeight;
  const viewportHeight = (visibleLines / totalLines) * minimapHeight;

  minimapViewportElement.style.top = `${viewportTop}px`;
  minimapViewportElement.style.height = `${Math.max(20, viewportHeight)}px`;
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
        } catch {
          // Ignore fetch errors for minimap
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

  const minimapHeight = minimapElement.clientHeight;
  const lineHeight = Math.max(1, minimapHeight / minimapData.length);

  minimapContentElement.innerHTML = '';

  for (let i = 0; i < minimapData.length; i++) {
    const data = minimapData[i];
    const line = document.createElement('div');
    line.className = `minimap-line level-${data.level || 'default'}`;
    line.style.height = `${Math.max(1, lineHeight)}px`;
    line.style.marginBottom = lineHeight < 2 ? '0' : '1px';
    minimapContentElement.appendChild(line);
  }

  // Add bookmark markers
  renderMinimapMarkers();
  updateMinimapViewport();
}

function renderMinimapMarkers(): void {
  if (!minimapElement) return;

  // Remove existing markers
  minimapElement.querySelectorAll('.minimap-bookmark, .minimap-search-marker').forEach(el => el.remove());

  const totalLines = getTotalLines();
  if (totalLines === 0) return;

  const minimapHeight = minimapElement.clientHeight;

  // Add bookmark markers
  for (const bookmark of state.bookmarks) {
    const marker = document.createElement('div');
    marker.className = 'minimap-bookmark';
    marker.style.top = `${(bookmark.lineNumber / totalLines) * minimapHeight}px`;
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
  const selectedText = selection?.toString().trim() || '';

  // Remove existing context menu
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  // If text is selected, show highlight options first
  if (selectedText) {
    const highlightThis = document.createElement('div');
    highlightThis.className = 'context-menu-item';
    highlightThis.textContent = `Highlight "${selectedText.substring(0, 20)}${selectedText.length > 20 ? '...' : ''}"`;
    highlightThis.addEventListener('click', () => {
      createHighlightFromSelection(selectedText, false);
      menu.remove();
    });
    menu.appendChild(highlightThis);

    const highlightAll = document.createElement('div');
    highlightAll.className = 'context-menu-item';
    highlightAll.textContent = 'Highlight All Occurrences';
    highlightAll.addEventListener('click', () => {
      createHighlightFromSelection(selectedText, true);
      menu.remove();
    });
    menu.appendChild(highlightAll);

    const separator1 = document.createElement('div');
    separator1.className = 'context-menu-separator';
    menu.appendChild(separator1);

    const copySelection = document.createElement('div');
    copySelection.className = 'context-menu-item';
    copySelection.textContent = 'Copy Selection';
    copySelection.addEventListener('click', () => {
      navigator.clipboard.writeText(selectedText);
      menu.remove();
    });
    menu.appendChild(copySelection);

    const separator2 = document.createElement('div');
    separator2.className = 'context-menu-separator';
    menu.appendChild(separator2);
  }

  // Save to Notes - always available (single line or range)
  const hasRange = state.selectionStart !== null && state.selectionEnd !== null;
  const saveStartLine = hasRange ? state.selectionStart! : lineNumber;
  const saveEndLine = hasRange ? state.selectionEnd! : lineNumber;
  const lineCount = saveEndLine - saveStartLine + 1;

  const saveToNotesItem = document.createElement('div');
  saveToNotesItem.className = 'context-menu-item';
  saveToNotesItem.textContent = lineCount === 1
    ? `Save Line to Notes`
    : `Save ${lineCount} Lines to Notes`;
  saveToNotesItem.addEventListener('click', () => {
    menu.remove();
    saveToNotesWithRange(saveStartLine, saveEndLine);
  });
  menu.appendChild(saveToNotesItem);

  const separatorSave = document.createElement('div');
  separatorSave.className = 'context-menu-separator';
  menu.appendChild(separatorSave);

  const hasBookmark = state.bookmarks.some((b) => b.lineNumber === lineNumber);

  if (hasBookmark) {
    const removeBookmark = document.createElement('div');
    removeBookmark.className = 'context-menu-item danger';
    removeBookmark.textContent = 'Remove Bookmark';
    removeBookmark.addEventListener('click', () => {
      removeBookmarkAtLine(lineNumber);
      menu.remove();
    });
    menu.appendChild(removeBookmark);
  } else {
    const addBookmark = document.createElement('div');
    addBookmark.className = 'context-menu-item';
    addBookmark.textContent = 'Add Bookmark';
    addBookmark.addEventListener('click', () => {
      addBookmarkAtLine(lineNumber);
      menu.remove();
    });
    menu.appendChild(addBookmark);
  }

  const separator = document.createElement('div');
  separator.className = 'context-menu-separator';
  menu.appendChild(separator);

  const copyLine = document.createElement('div');
  copyLine.className = 'context-menu-item';
  copyLine.textContent = 'Copy Line';
  copyLine.addEventListener('click', () => {
    const line = cachedLines.get(lineNumber);
    if (line) {
      navigator.clipboard.writeText(line.text);
    }
    menu.remove();
  });
  menu.appendChild(copyLine);

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

async function createHighlightFromSelection(text: string, highlightAll: boolean): Promise<void> {
  // Get next auto-assigned color
  const colorResult = await window.api.getNextHighlightColor();
  const backgroundColor = colorResult.success && colorResult.color ? colorResult.color : '#ffff00';

  const highlight: HighlightConfig = {
    id: `highlight-${Date.now()}`,
    pattern: text,
    isRegex: false,
    matchCase: true, // Exact match for selection
    wholeWord: false,
    backgroundColor,
    textColor: '#000000',
    includeWhitespace: false,
    highlightAll,
  };

  const result = await window.api.addHighlight(highlight);
  if (result.success) {
    state.highlights.push(highlight);
    updateHighlightsUI();
    renderVisibleLines();
  }
}

async function saveSelectedLinesToFile(): Promise<void> {
  if (state.selectionStart === null || state.selectionEnd === null) {
    alert('No lines selected. Use Shift+Click to select a range of lines.');
    return;
  }

  const result = await window.api.saveSelectedLines(state.selectionStart, state.selectionEnd);

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
let pendingNotesResolve: ((note: string | null) => void) | null = null;

function showNotesModal(startLine: number, endLine: number): Promise<string | null> {
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
  const note = save ? elements.notesDescription.value : null;
  elements.notesModal.classList.add('hidden');
  elements.notesDescription.value = '';

  if (pendingNotesResolve) {
    pendingNotesResolve(note);
    pendingNotesResolve = null;
  }
}

async function saveToNotesWithRange(startLine: number, endLine: number): Promise<void> {
  const note = await showNotesModal(startLine, endLine);
  if (note === null) return; // User cancelled

  const result = await window.api.saveToNotes(startLine, endLine, note || undefined);

  if (result.success) {
    // Clear selection after saving
    state.selectionStart = null;
    state.selectionEnd = null;
    renderVisibleLines();

    // Open notes file as inactive tab
    if (result.filePath) {
      const existingTab = findTabByFilePath(result.filePath);
      if (!existingTab) {
        // Open as new tab but don't switch to it
        await loadFileAsInactiveTab(result.filePath);
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

async function loadFile(filePath: string, createNewTab: boolean = true): Promise<void> {
  showProgress('Indexing file...');

  const unsubscribe = window.api.onIndexingProgress((progress) => {
    updateProgress(progress);
    updateProgressText(`Indexing file... ${progress}%`);
  });

  try {
    const result = await window.api.openFile(filePath);

    if (result.success && result.info) {
      // Check if file is already open in a tab
      const existingTab = findTabByFilePath(filePath);
      if (existingTab && existingTab.id !== state.activeTabId) {
        // Switch to existing tab instead of opening new one
        unsubscribe();
        hideProgress();
        await switchToTab(existingTab.id);
        return;
      }

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
      cachedLines.clear();

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

      // Wait for DOM layout before loading lines
      await new Promise(resolve => requestAnimationFrame(resolve));

      // Initialize visible range based on container size
      if (logViewerElement) {
        const containerHeight = logViewerElement.clientHeight;
        const visibleLines = Math.ceil(containerHeight / getLineHeight());
        state.visibleStartLine = 0;
        state.visibleEndLine = Math.min(visibleLines + BUFFER_LINES * 2, state.totalLines - 1);
      }

      await loadVisibleLines();

      elements.btnAnalyze.disabled = true; // Analysis not implemented yet
      elements.btnSplit.disabled = false;
      updateStatusBar();
      updateSplitNavigation();

      // Build minimap with progress
      unsubscribe(); // Stop listening to indexing progress
      showProgress('Building minimap...');
      await buildMinimap((percent) => {
        updateProgress(percent);
        updateProgressText(`Building minimap... ${percent}%`);
      });
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

// Analysis
async function analyzeFile(): Promise<void> {
  if (!state.filePath) return;

  showProgress('Analyzing...');

  const unsubscribe = window.api.onAnalyzeProgress((progress) => {
    elements.progressText.textContent = `${progress.phase} ${progress.percent}%`;
    elements.progressBar.style.setProperty('--progress', `${progress.percent}%`);
  });

  try {
    const result = await window.api.analyzeFile(state.filePath);

    if (result.success && result.result) {
      state.analysisResult = result.result;
      updateAnalysisUI();
    } else {
      alert(`Analysis failed: ${result.error}`);
    }
  } finally {
    unsubscribe();
    hideProgress();
  }
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
    const result = await window.api.search({
      pattern,
      isRegex: elements.searchRegex.checked,
      matchCase: elements.searchCase.checked,
      wholeWord: false,
    });

    if (result.success && result.matches) {
      state.searchResults = result.matches;
      state.currentSearchIndex = result.matches.length > 0 ? 0 : -1;
      updateSearchUI();
      renderMinimapMarkers(); // Update minimap with search markers

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
  elements.searchResultCount.textContent =
    count > 0 ? `${state.currentSearchIndex + 1}/${count}` : 'No results';
  elements.btnPrevResult.disabled = count === 0;
  elements.btnNextResult.disabled = count === 0;
}

function goToSearchResult(index: number): void {
  if (index < 0 || index >= state.searchResults.length) return;

  state.currentSearchIndex = index;
  const result = state.searchResults[index];
  goToLine(result.lineNumber);
  updateSearchUI();
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

async function applyFilter(): Promise<void> {
  const levelCheckboxes = document.querySelectorAll<HTMLInputElement>(
    'input[name="level"]:checked'
  );
  const levels = Array.from(levelCheckboxes).map((cb) => cb.value);

  const config: FilterConfig = {
    levels,
    includePatterns: elements.includePatterns.value
      .split('\n')
      .filter((p) => p.trim()),
    excludePatterns: elements.excludePatterns.value
      .split('\n')
      .filter((p) => p.trim()),
    collapseDuplicates: elements.collapseDuplicates.checked,
  };

  if (!state.analysisResult) {
    alert('Please run analysis first before applying filters.');
    return;
  }

  showProgress('Applying filter...');

  try {
    const result = await window.api.applyFilter(config);

    if (result.success && result.stats) {
      state.isFiltered = true;
      state.filteredLines = result.stats.filteredLines;
      cachedLines.clear();

      hideFilterModal();
      await loadVisibleLines();
      updateStatusBar();
    } else {
      alert(`Failed to apply filter: ${result.error}`);
    }
  } finally {
    hideProgress();
  }
}

async function clearFilter(): Promise<void> {
  state.isFiltered = false;
  state.filteredLines = null;
  cachedLines.clear();

  hideFilterModal();
  await loadVisibleLines();
  updateStatusBar();
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
let pendingBookmarkResolve: ((comment: string | null) => void) | null = null;
let pendingBookmarkLineNumber: number | null = null;
let pendingBookmarkId: string | null = null;

function showBookmarkModal(lineNumber: number, existingComment?: string, isEdit: boolean = false): Promise<string | null> {
  return new Promise((resolve) => {
    pendingBookmarkResolve = resolve;
    pendingBookmarkLineNumber = lineNumber;

    elements.bookmarkModalTitle.textContent = isEdit ? 'Edit Bookmark' : 'Add Bookmark';
    elements.bookmarkComment.value = existingComment || '';
    elements.bookmarkLineInfo.textContent = `Line ${lineNumber + 1}`;
    elements.bookmarkModal.classList.remove('hidden');
    elements.bookmarkComment.focus();
  });
}

function hideBookmarkModal(save: boolean): void {
  const comment = save ? elements.bookmarkComment.value : null;
  elements.bookmarkModal.classList.add('hidden');
  elements.bookmarkComment.value = '';

  if (pendingBookmarkResolve) {
    pendingBookmarkResolve(comment);
    pendingBookmarkResolve = null;
  }
  pendingBookmarkLineNumber = null;
  pendingBookmarkId = null;
}

// Bookmarks
async function addBookmarkAtLine(lineNumber: number, comment?: string): Promise<void> {
  // Show modal for comment if not provided
  let label: string | undefined;
  if (comment !== undefined) {
    label = comment || undefined;
  } else {
    const result = await showBookmarkModal(lineNumber);
    if (result === null) return; // User cancelled
    label = result || undefined;
  }

  const bookmark: Bookmark = {
    id: `bookmark-${Date.now()}`,
    lineNumber,
    label,
    createdAt: Date.now(),
  };

  const apiResult = await window.api.addBookmark(bookmark);
  if (apiResult.success) {
    state.bookmarks.push(bookmark);
    updateBookmarksUI();
    renderVisibleLines();
  }
}

async function editBookmarkComment(bookmarkId: string): Promise<void> {
  const bookmark = state.bookmarks.find(b => b.id === bookmarkId);
  if (!bookmark) return;

  pendingBookmarkId = bookmarkId;
  const newComment = await showBookmarkModal(bookmark.lineNumber, bookmark.label, true);
  if (newComment === null) return; // User cancelled

  bookmark.label = newComment || undefined;

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
  if (state.bookmarks.length === 0) {
    elements.bookmarksList.innerHTML = '<p class="placeholder">No bookmarks</p>';
    return;
  }

  elements.bookmarksList.innerHTML = state.bookmarks
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map(
      (b) => `
      <div class="bookmark-item" data-id="${b.id}" data-line="${b.lineNumber}" title="${b.label ? escapeHtml(b.label) : 'Click to go to line, double-click to edit comment'}">
        <div class="bookmark-info">
          <span class="bookmark-line">Line ${b.lineNumber + 1}</span>
          ${b.label ? `<span class="bookmark-label">${escapeHtml(b.label)}</span>` : '<span class="bookmark-label placeholder-text">No comment</span>'}
        </div>
        <div class="bookmark-actions">
          <button class="bookmark-edit" data-id="${b.id}" title="Edit comment">&#9998;</button>
          <button class="bookmark-delete" data-id="${b.id}" title="Delete bookmark">&times;</button>
        </div>
      </div>
    `
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

  const highlight: HighlightConfig = {
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
  };

  const result = await window.api.addHighlight(highlight);
  if (result.success) {
    state.highlights.push(highlight);
    updateHighlightsUI();
    renderVisibleLines();
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
  if (state.highlights.length === 0) {
    elements.highlightsList.innerHTML =
      '<p class="placeholder">No highlight rules</p>';
    return;
  }

  elements.highlightsList.innerHTML = state.highlights
    .map(
      (h) => `
      <div class="highlight-item" data-id="${h.id}" title="${h.isGlobal ? 'Global - applies to all files' : 'Local - applies to this file only'}">
        <div class="highlight-preview">
          <span class="highlight-color" style="background-color: ${h.backgroundColor}"></span>
          <span>${escapeHtml(h.pattern)}</span>
          <span class="highlight-scope ${h.isGlobal ? 'global' : 'local'}">${h.isGlobal ? 'G' : 'L'}</span>
        </div>
        <div class="highlight-actions">
          <button class="highlight-toggle-global" data-id="${h.id}" title="${h.isGlobal ? 'Make local (this file only)' : 'Make global (all files)'}">${h.isGlobal ? '🌐' : '📄'}</button>
          <button class="highlight-delete" data-id="${h.id}" title="Delete">&times;</button>
        </div>
      </div>
    `
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
    elements.patternsList.innerHTML =
      '<p class="placeholder">No patterns detected</p>';
    elements.duplicatesList.innerHTML =
      '<p class="placeholder">No duplicates found</p>';
    return;
  }

  const result = state.analysisResult;

  // Level counts
  let levelHtml = '<div class="level-counts">';
  for (const [level, count] of Object.entries(result.levelCounts)) {
    levelHtml += `<span class="level-badge ${level}">${level}: ${count.toLocaleString()}</span>`;
  }
  levelHtml += '</div>';

  elements.analysisResults.innerHTML = `
    ${levelHtml}
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

  // Patterns
  if (result.patterns.length === 0) {
    elements.patternsList.innerHTML =
      '<p class="placeholder">No patterns detected</p>';
  } else {
    elements.patternsList.innerHTML = result.patterns
      .slice(0, 20)
      .map(
        (p) => `
        <div class="pattern-item" data-lines="${p.sampleLines.join(',')}">
          <span class="category ${p.category}">${p.category}</span>
          <span class="count">${p.count.toLocaleString()} occurrences</span>
          <div class="template">${escapeHtml(p.template.substring(0, 100))}${
          p.template.length > 100 ? '...' : ''
        }</div>
        </div>
      `
      )
      .join('');

    // Click to navigate
    elements.patternsList.querySelectorAll('.pattern-item').forEach((item) => {
      item.addEventListener('click', () => {
        const lines = (item as HTMLElement).dataset.lines?.split(',');
        if (lines && lines.length > 0) {
          goToLine(parseInt(lines[0], 10));
        }
      });
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
    state.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, state.totalLines - 1);
    renderVisibleLines();
    updateMinimapViewport();
  }
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
function toggleSidebar(): void {
  elements.sidebar.classList.toggle('collapsed');
}

// Section toggle
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
        document.getElementById(modalId)?.classList.add('hidden');
      }
    });
  });

  // Close on backdrop click
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
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

    // F3 or Ctrl/Cmd + G: Next search result
    if (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.key === 'g')) {
      e.preventDefault();
      if (state.searchResults.length > 0) {
        const nextIndex = (state.currentSearchIndex + 1) % state.searchResults.length;
        goToSearchResult(nextIndex);
      }
    }

    // Shift + F3 or Ctrl/Cmd + Shift + G: Previous search result
    if (
      (e.key === 'F3' && e.shiftKey) ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G')
    ) {
      e.preventDefault();
      if (state.searchResults.length > 0) {
        const prevIndex =
          (state.currentSearchIndex - 1 + state.searchResults.length) %
          state.searchResults.length;
        goToSearchResult(prevIndex);
      }
    }

    // Escape: Close modals
    if (e.key === 'Escape') {
      hideFilterModal();
      hideHighlightModal();
      hideSplitModal();
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

    // Ctrl/Cmd + H: Highlight all occurrences of selected text
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'h') {
      e.preventDefault();
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      if (selectedText) {
        createHighlightFromSelection(selectedText, true);
      }
    }

    // Ctrl/Cmd + Shift + H: Highlight single occurrence of selected text
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
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
        const nextIndex = (currentIndex + 1) % state.tabs.length;
        switchToTab(state.tabs[nextIndex].id);
      }
    }

    // Ctrl/Cmd + Shift + Tab: Previous tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (state.tabs.length > 1 && state.activeTabId) {
        const currentIndex = state.tabs.findIndex(t => t.id === state.activeTabId);
        const prevIndex = (currentIndex - 1 + state.tabs.length) % state.tabs.length;
        switchToTab(state.tabs[prevIndex].id);
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

    // Help: F1 or ?
    if (e.key === 'F1' || (e.key === '?' && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      elements.helpModal.classList.toggle('hidden');
    }

    // Escape: Close help modal
    if (e.key === 'Escape' && !elements.helpModal.classList.contains('hidden')) {
      elements.helpModal.classList.add('hidden');
    }
  });
}

// Initialize event listeners
function init(): void {
  // File operations
  elements.btnOpenFile.addEventListener('click', openFile);
  elements.btnOpenWelcome.addEventListener('click', openFile);

  // Search
  elements.btnSearch.addEventListener('click', performSearch);
  elements.btnPrevResult.addEventListener('click', () => {
    if (state.searchResults.length > 0) {
      const prevIndex =
        (state.currentSearchIndex - 1 + state.searchResults.length) %
        state.searchResults.length;
      goToSearchResult(prevIndex);
    }
  });
  elements.btnNextResult.addEventListener('click', () => {
    if (state.searchResults.length > 0) {
      const nextIndex = (state.currentSearchIndex + 1) % state.searchResults.length;
      goToSearchResult(nextIndex);
    }
  });

  // Filter
  elements.btnFilter.addEventListener('click', showFilterModal);
  elements.btnApplyFilter.addEventListener('click', applyFilter);
  elements.btnClearFilter.addEventListener('click', clearFilter);

  // Analysis
  elements.btnAnalyze.addEventListener('click', analyzeFile);

  // Split
  elements.btnSplit.addEventListener('click', showSplitModal);
  elements.btnDoSplit.addEventListener('click', doSplit);
  elements.btnCancelSplit.addEventListener('click', hideSplitModal);

  // Split mode and value change handlers
  document.querySelectorAll('input[name="split-mode"]').forEach((radio) => {
    radio.addEventListener('change', updateSplitPreview);
  });
  elements.splitValue.addEventListener('input', updateSplitPreview);

  // Sidebar
  elements.btnToggleSidebar.addEventListener('click', toggleSidebar);

  // Highlights
  elements.btnAddHighlight.addEventListener('click', showHighlightModal);
  elements.btnSaveHighlight.addEventListener('click', saveHighlight);
  elements.btnCancelHighlight.addEventListener('click', hideHighlightModal);

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
  setupSectionToggles();
  setupModalCloseHandlers();
  setupKeyboardShortcuts();

  // Load initial data
  loadBookmarks();
  loadHighlights();
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
    bookmarks: [...state.bookmarks],
    cachedLines: cachedLines.toMap(),
    splitFiles: state.splitFiles,
    currentSplitIndex: state.currentSplitIndex,
    minimapData: minimapData.length > 0 ? [...minimapData] : null,
    isLoaded: true,
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
  state.bookmarks = [...tab.bookmarks];
  state.splitFiles = tab.splitFiles;
  state.currentSplitIndex = tab.currentSplitIndex;
  state.isFiltered = false;
  state.filteredLines = null;

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
    bookmarks: [],
    cachedLines: new Map(),
    splitFiles: [],
    currentSplitIndex: -1,
    isLoading: false,
    loadingText: '',
    loadingPercent: 0,
    minimapData: null,
    isLoaded: false,
  };
  return tab;
}

async function switchToTab(tabId: string): Promise<void> {
  if (tabId === state.activeTabId) return;

  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab || !tab.filePath) return;

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
        state.visibleEndLine = Math.min(startLine + visibleLines + BUFFER_LINES, state.totalLines - 1);
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

      // Mark as loaded
      tab.isLoaded = true;
    }
  } finally {
    hideProgress();
  }

  renderTabBar();
}

function closeTab(tabId: string): void {
  const tabIndex = state.tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

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

    elements.tabsContainer.appendChild(tabElement);
  }
}

function findTabByFilePath(filePath: string): TabState | undefined {
  return state.tabs.find(t => t.filePath === filePath);
}

// Start the app
init();
