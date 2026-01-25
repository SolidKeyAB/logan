// Analyzer Plugin Interface

export interface AnalyzerOptions {
  maxPatterns?: number;      // Limit pattern groups (default: 1000)
  maxDuplicates?: number;    // Limit duplicate groups (default: 500)
  sampleSize?: number;       // Lines to sample for large files
  includeLineText?: boolean; // Include full text in results
}

export interface AnalyzeProgress {
  phase: 'reading' | 'parsing' | 'analyzing' | 'grouping' | 'done';
  percent: number;
  message?: string;
}

export interface PatternGroup {
  pattern: string;      // Normalized pattern (used as key)
  template: string;     // Human-readable template with {placeholders}
  count: number;
  sampleLines: number[];
  sampleText?: string;  // Actual example log line
  category: 'noise' | 'error' | 'warning' | 'info' | 'debug' | 'unknown';
}

export interface DuplicateGroup {
  hash: string;
  text: string;
  count: number;
  lineNumbers: number[];
}

export interface ColumnStatValue {
  value: string;
  count: number;
  percentage: number;
}

export interface ColumnStats {
  name: string;
  type: string;
  topValues: ColumnStatValue[];
  uniqueCount: number;
}

// Noise candidate - high frequency message that could be filtered
export interface NoiseCandidate {
  pattern: string;
  sampleText: string;
  count: number;
  percentage: number;
  channel?: string;
  suggestedFilter: string;
}

// Grouped error/warning messages
export interface ErrorGroup {
  pattern: string;
  sampleText: string;
  count: number;
  level: 'error' | 'warning';
  channel?: string;
  firstLine: number;
  lastLine: number;
}

// Rare/anomalous message
export interface Anomaly {
  text: string;
  lineNumber: number;
  level?: string;
  channel?: string;
  reason: string; // Why it's considered anomalous
}

// Filter suggestion
export interface FilterSuggestion {
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

// Analysis insights - the useful stuff
export interface AnalysisInsights {
  noiseCandidates: NoiseCandidate[];
  errorGroups: ErrorGroup[];
  anomalies: Anomaly[];
  filterSuggestions: FilterSuggestion[];
}

export interface AnalysisResult {
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
  columnStats?: ColumnStats[];
  insights?: AnalysisInsights;
}

// Base interface - all analyzers must implement this
export interface LogAnalyzer {
  name: string;
  description: string;

  // Analyze file and return results
  analyze(
    filePath: string,
    options: AnalyzerOptions,
    onProgress?: (progress: AnalyzeProgress) => void,
    signal?: { cancelled: boolean }
  ): Promise<AnalysisResult>;

  // Optional: Check if analyzer is available (e.g., AI needs API key)
  isAvailable?(): Promise<boolean>;
}
