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

// Application State
interface AppState {
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
  // Split file navigation
  splitFiles: string[];
  currentSplitIndex: number;
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
};

// Constants
const LINE_HEIGHT = 20;
const BUFFER_LINES = 50;
const MAX_SCROLL_HEIGHT = 10000000; // 10 million pixels - safe for all browsers

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
  highlightBgColor: document.getElementById('highlight-bg-color') as HTMLInputElement,
  highlightTextColor: document.getElementById('highlight-text-color') as HTMLInputElement,
  btnSaveHighlight: document.getElementById('btn-save-highlight') as HTMLButtonElement,
  btnCancelHighlight: document.getElementById('btn-cancel-highlight') as HTMLButtonElement,
};

// Virtual Log Viewer
let logViewerElement: HTMLDivElement | null = null;
let logContentElement: HTMLDivElement | null = null;
let logViewerWrapper: HTMLDivElement | null = null;
let minimapElement: HTMLDivElement | null = null;
let minimapContentElement: HTMLDivElement | null = null;
let minimapViewportElement: HTMLDivElement | null = null;
let cachedLines: Map<number, LogLine> = new Map();
let minimapData: Array<{ level: string | undefined }> = [];
const MINIMAP_SAMPLE_RATE = 1000; // Sample every N lines for minimap

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

  // Event listeners
  logViewerElement.addEventListener('scroll', handleScroll);
  logViewerElement.addEventListener('click', handleLogClick);
  logViewerElement.addEventListener('contextmenu', handleContextMenu);
  minimapElement.addEventListener('click', handleMinimapClick);
  minimapElement.addEventListener('mousedown', handleMinimapDrag);
}

function getVirtualHeight(): number {
  const totalLines = getTotalLines();
  const naturalHeight = totalLines * LINE_HEIGHT;
  return Math.min(naturalHeight, MAX_SCROLL_HEIGHT);
}

function isUsingScaledScroll(): boolean {
  const totalLines = getTotalLines();
  return totalLines * LINE_HEIGHT > MAX_SCROLL_HEIGHT;
}

function scrollTopToLine(scrollTop: number): number {
  const totalLines = getTotalLines();
  if (!isUsingScaledScroll()) {
    return Math.floor(scrollTop / LINE_HEIGHT);
  }
  // Proportional mapping for large files
  const virtualHeight = getVirtualHeight();
  const scrollRatio = scrollTop / (virtualHeight - (logViewerElement?.clientHeight || 0));
  const maxLine = totalLines - Math.ceil((logViewerElement?.clientHeight || 0) / LINE_HEIGHT);
  return Math.floor(scrollRatio * maxLine);
}

function lineToScrollTop(lineNumber: number): number {
  const totalLines = getTotalLines();
  if (!isUsingScaledScroll()) {
    return lineNumber * LINE_HEIGHT;
  }
  // Proportional mapping for large files
  const virtualHeight = getVirtualHeight();
  const maxLine = totalLines - Math.ceil((logViewerElement?.clientHeight || 0) / LINE_HEIGHT);
  const scrollRatio = lineNumber / maxLine;
  return scrollRatio * (virtualHeight - (logViewerElement?.clientHeight || 0));
}

function handleScroll(): void {
  if (!logViewerElement || !logContentElement) return;

  const scrollTop = logViewerElement.scrollTop;
  const containerHeight = logViewerElement.clientHeight;

  const startLine = scrollTopToLine(scrollTop);
  const visibleLines = Math.ceil(containerHeight / LINE_HEIGHT);
  const endLine = startLine + visibleLines;

  const bufferStart = Math.max(0, startLine - BUFFER_LINES);
  const bufferEnd = Math.min(getTotalLines() - 1, endLine + BUFFER_LINES);

  if (bufferStart !== state.visibleStartLine || bufferEnd !== state.visibleEndLine) {
    state.visibleStartLine = bufferStart;
    state.visibleEndLine = bufferEnd;
    loadVisibleLines();
  }

  // Update minimap viewport
  updateMinimapViewport();
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
  const count = end - start + 1;

  try {
    const result = await window.api.getLines(start, count);

    if (result.success && result.lines) {
      for (const line of result.lines) {
        cachedLines.set(line.lineNumber, line);
      }
      renderVisibleLines();
    }
  } catch (error) {
    console.error('Failed to load lines:', error);
  }
}

function renderVisibleLines(): void {
  if (!logContentElement || !logViewerElement) return;

  const totalLines = getTotalLines();
  const virtualHeight = getVirtualHeight();

  // Preserve horizontal scroll position
  const scrollLeft = logViewerElement.scrollLeft;

  logContentElement.style.height = `${virtualHeight}px`;
  logContentElement.style.position = 'relative';

  // Clear existing lines
  logContentElement.innerHTML = '';

  const scrollTop = logViewerElement.scrollTop;
  const containerHeight = logViewerElement.clientHeight;

  // Use scroll mapping for large files
  const centerLine = scrollTopToLine(scrollTop + containerHeight / 2);
  const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT);
  const startLine = Math.max(0, centerLine - Math.floor(visibleCount / 2) - BUFFER_LINES);
  const endLine = Math.min(totalLines - 1, startLine + visibleCount + BUFFER_LINES * 2);

  // Calculate the visual offset for positioning lines
  // For scaled scroll, we position lines relative to scroll position
  const usingScaled = isUsingScaledScroll();

  for (let i = startLine; i <= endLine; i++) {
    const line = cachedLines.get(i);
    if (line) {
      const lineElement = createLineElement(line);
      lineElement.style.position = 'absolute';

      if (usingScaled) {
        // For scaled scroll, position lines relative to the scroll position
        // startLine corresponds to scrollTop, so offset from there
        const lineOffset = i - startLine;
        const baseTop = scrollTop + lineOffset * LINE_HEIGHT;
        lineElement.style.top = `${baseTop}px`;
      } else {
        // Normal positioning for small files
        lineElement.style.top = `${i * LINE_HEIGHT}px`;
      }

      lineElement.style.left = '0';
      lineElement.style.right = '0';
      logContentElement.appendChild(lineElement);
    }
  }

  // Restore horizontal scroll position
  if (scrollLeft > 0) {
    logViewerElement.scrollLeft = scrollLeft;
  }
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
    result += `<span style="${style}">${escapeHtml(text.slice(match.start, match.end))}</span>`;
    lastEnd = match.end;
  }

  result += escapeHtml(text.slice(lastEnd));
  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
  const visibleLines = Math.ceil(clientHeight / LINE_HEIGHT);

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

function handleMinimapDrag(event: MouseEvent): void {
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
  const maxLines = Math.min(totalLines, minimapHeight * 2); // Max 2 lines per pixel
  const sampleRate = Math.max(1, Math.floor(totalLines / maxLines));

  // Sample lines for minimap
  const samplesToFetch: number[] = [];
  for (let i = 0; i < totalLines; i += sampleRate) {
    samplesToFetch.push(i);
    if (samplesToFetch.length >= 500) break; // Limit samples
  }

  // Fetch samples in batches
  const batchSize = 100;
  const totalBatches = Math.ceil(samplesToFetch.length / batchSize);

  for (let i = 0; i < samplesToFetch.length; i += batchSize) {
    const batch = samplesToFetch.slice(i, i + batchSize);
    const start = batch[0];
    const end = batch[batch.length - 1];

    try {
      const count = end - start + 1;
      const result = await window.api.getLines(start, count);

      if (result.success && result.lines) {
        for (const line of result.lines) {
          if (batch.includes(line.lineNumber)) {
            minimapData.push({ level: line.level });
          }
        }
      }

      // Report progress
      if (onProgress) {
        const batchIndex = Math.floor(i / batchSize) + 1;
        const percent = Math.round((batchIndex / totalBatches) * 100);
        onProgress(percent);
      }
    } catch (error) {
      console.error('Failed to build minimap:', error);
    }
  }

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

  // Don't interfere with text selection
  const selection = window.getSelection();
  if (selection && selection.toString().length > 0) {
    return;
  }

  const target = event.target as HTMLElement;
  const lineElement = target.closest('.log-line') as HTMLDivElement;

  if (lineElement) {
    const lineNumber = parseInt(lineElement.dataset.lineNumber || '0', 10);

    // Shift+Click for range selection
    if (event.shiftKey && state.selectedLine !== null) {
      const start = Math.min(state.selectedLine, lineNumber);
      const end = Math.max(state.selectedLine, lineNumber);
      state.selectionStart = start;
      state.selectionEnd = end;
      renderVisibleLines();
      updateSelectionStatus();
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

  // Save range selection to file
  if (state.selectionStart !== null && state.selectionEnd !== null) {
    const lineCount = state.selectionEnd - state.selectionStart + 1;
    const saveSelection = document.createElement('div');
    saveSelection.className = 'context-menu-item';
    saveSelection.textContent = `Save ${lineCount} Lines to File`;
    saveSelection.addEventListener('click', () => {
      saveSelectedLinesToFile();
      menu.remove();
    });
    menu.appendChild(saveSelection);

    const separatorSave = document.createElement('div');
    separatorSave.className = 'context-menu-separator';
    menu.appendChild(separatorSave);
  }

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

// File Operations
async function openFile(): Promise<void> {
  const filePath = await window.api.openFileDialog();
  if (!filePath) return;

  await loadFile(filePath);
}

async function loadFile(filePath: string): Promise<void> {
  showProgress('Indexing file...');

  const unsubscribe = window.api.onIndexingProgress((progress) => {
    updateProgress(progress);
    elements.progressText.textContent = `Indexing file... ${progress}%`;
  });

  try {
    const result = await window.api.openFile(filePath);

    if (result.success && result.info) {
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

      updateFileStatsUI();
      createLogViewer();

      // Wait for DOM layout before loading lines
      await new Promise(resolve => requestAnimationFrame(resolve));
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
        elements.progressText.textContent = `Building minimap... ${percent}%`;
      });
    } else {
      alert(`Failed to open file: ${result.error}`);
    }
  } finally {
    hideProgress();
  }
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
  await loadFile(state.splitFiles[state.currentSplitIndex]);
}

async function loadPreviousSplitFile(): Promise<void> {
  if (state.splitFiles.length === 0) return;
  if (state.currentSplitIndex <= 0) return;

  state.currentSplitIndex--;
  await loadFile(state.splitFiles[state.currentSplitIndex]);
}

// Bookmarks
async function addBookmarkAtLine(lineNumber: number): Promise<void> {
  const bookmark: Bookmark = {
    id: `bookmark-${Date.now()}`,
    lineNumber,
    createdAt: Date.now(),
  };

  const result = await window.api.addBookmark(bookmark);
  if (result.success) {
    state.bookmarks.push(bookmark);
    updateBookmarksUI();
    renderVisibleLines();
  }
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
      <div class="bookmark-item" data-id="${b.id}" data-line="${b.lineNumber}">
        <div class="bookmark-info">
          <span class="bookmark-line">Line ${b.lineNumber + 1}</span>
          ${b.label ? `<span class="bookmark-label">${escapeHtml(b.label)}</span>` : ''}
        </div>
        <button class="bookmark-delete" data-id="${b.id}">&times;</button>
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
      } else {
        const line = parseInt((item as HTMLElement).dataset.line || '0', 10);
        goToLine(line);
      }
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
  };

  const result = await window.api.addHighlight(highlight);
  if (result.success) {
    state.highlights.push(highlight);
    updateHighlightsUI();
    renderVisibleLines();
    hideHighlightModal();
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
      <div class="highlight-item" data-id="${h.id}">
        <div class="highlight-preview">
          <span class="highlight-color" style="background-color: ${h.backgroundColor}"></span>
          <span>${escapeHtml(h.pattern)}</span>
        </div>
        <button class="highlight-delete" data-id="${h.id}">&times;</button>
      </div>
    `
    )
    .join('');

  // Add click handlers
  elements.highlightsList.querySelectorAll('.highlight-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id!;
      const result = await window.api.removeHighlight(id);
      if (result.success) {
        state.highlights = state.highlights.filter((h) => h.id !== id);
        updateHighlightsUI();
        renderVisibleLines();
      }
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

function showProgress(text: string): void {
  elements.progressContainer.classList.remove('hidden');
  elements.progressText.textContent = text;
  elements.progressBar.style.setProperty('--progress', '0%');
}

function updateProgress(percent: number): void {
  elements.progressBar.style.setProperty('--progress', `${percent}%`);
  elements.progressText.textContent = `${percent}%`;
}

function hideProgress(): void {
  elements.progressContainer.classList.add('hidden');
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

    // Ctrl/Cmd + Shift + S: Save selected lines to file
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      if (state.selectionStart !== null && state.selectionEnd !== null) {
        saveSelectedLinesToFile();
      }
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

// Start the app
init();
