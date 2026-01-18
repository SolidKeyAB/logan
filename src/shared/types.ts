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

export interface SearchOptions {
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
}

export interface Bookmark {
  id: string;
  lineNumber: number;
  label: string;
  color: string;
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

export interface ChunkRequest {
  startLine: number;
  lineCount: number;
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
} as const;
