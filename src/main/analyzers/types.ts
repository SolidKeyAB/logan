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
  category: 'noise' | 'error' | 'warning' | 'info' | 'debug' | 'unknown';
}

export interface DuplicateGroup {
  hash: string;
  text: string;
  count: number;
  lineNumbers: number[];
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
