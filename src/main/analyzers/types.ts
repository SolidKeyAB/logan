// Analyzer Plugin Interface

export interface AnalyzerOptions {
  sampleSize?: number;       // Lines to sample for large files
  includeLineText?: boolean; // Include full text in results
}

export interface AnalyzeProgress {
  phase: 'reading' | 'parsing' | 'analyzing' | 'grouping' | 'done';
  percent: number;
  message?: string;
}

// Crash/fatal entry found in the log
export interface CrashEntry {
  text: string;
  lineNumber: number;
  level?: string;
  channel?: string;
  keyword: string; // The crash keyword that matched (e.g. "fatal", "panic")
}

// Component/channel with high error count
export interface FailingComponent {
  name: string;
  errorCount: number;
  warningCount: number;
  sampleLine: number; // First error line number
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
  crashes: CrashEntry[];
  topFailingComponents: FailingComponent[];
  filterSuggestions: FilterSuggestion[];
}

export interface AnalysisResult {
  stats: {
    totalLines: number;
    analyzedLines: number;
  };
  levelCounts: Record<string, number>;
  timeRange?: { start: string; end: string };
  analyzerName: string;
  analyzedAt: number;
  insights: AnalysisInsights;
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
