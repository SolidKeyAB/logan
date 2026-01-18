# Log Analyzer Design Document

## Overview

**Plugin-based architecture** for log analysis. Analyzers are swappable modules that implement a common interface.

## Plugin Architecture

```typescript
// Base interface - all analyzers must implement this
interface LogAnalyzer {
  name: string;
  description: string;

  // Analyze file and return results
  analyze(
    filePath: string,
    options: AnalyzerOptions,
    onProgress?: (progress: AnalyzeProgress) => void
  ): Promise<AnalysisResult>;

  // Optional: Check if analyzer is available (e.g., AI needs API key)
  isAvailable?(): Promise<boolean>;
}

interface AnalyzerOptions {
  maxPatterns?: number;      // Limit pattern groups
  maxDuplicates?: number;    // Limit duplicate groups
  sampleSize?: number;       // Lines to sample for large files
  includeLineText?: boolean; // Include full text in results
}

interface AnalyzeProgress {
  phase: 'reading' | 'analyzing' | 'grouping' | 'done';
  percent: number;
  message?: string;
}
```

## Built-in Analyzers

### 1. RuleBasedAnalyzer (Default)
- Fast, regex-based pattern detection
- Deterministic results
- No external dependencies

### 2. AIAnalyzer (Future)
- Uses LLM to understand log semantics
- Better pattern grouping
- Can explain what patterns mean
- Requires API key

### 3. CustomAnalyzer (User-defined)
- Load from .logan/analyzers/
- User can write their own pattern rules

## Analyzer Registry

```typescript
// Registry for available analyzers
class AnalyzerRegistry {
  private analyzers = new Map<string, LogAnalyzer>();

  register(analyzer: LogAnalyzer): void {
    this.analyzers.set(analyzer.name, analyzer);
  }

  get(name: string): LogAnalyzer | undefined {
    return this.analyzers.get(name);
  }

  list(): LogAnalyzer[] {
    return [...this.analyzers.values()];
  }

  async getAvailable(): Promise<LogAnalyzer[]> {
    const available: LogAnalyzer[] = [];
    for (const analyzer of this.analyzers.values()) {
      if (!analyzer.isAvailable || await analyzer.isAvailable()) {
        available.push(analyzer);
      }
    }
    return available;
  }
}

// Global registry
const analyzerRegistry = new AnalyzerRegistry();
analyzerRegistry.register(new RuleBasedAnalyzer());
// analyzerRegistry.register(new AIAnalyzer()); // Future
```

## IPC Interface

```typescript
// List available analyzers
ipcMain.handle('list-analyzers', async () => {
  const analyzers = await analyzerRegistry.getAvailable();
  return analyzers.map(a => ({ name: a.name, description: a.description }));
});

// Run analysis with specific analyzer
ipcMain.handle('analyze-file', async (_, analyzerName: string, options?: AnalyzerOptions) => {
  const analyzer = analyzerRegistry.get(analyzerName);
  if (!analyzer) return { success: false, error: 'Analyzer not found' };

  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const result = await analyzer.analyze(
    handler.getFilePath(),
    options || {},
    (progress) => mainWindow?.webContents.send('analyze-progress', progress)
  );

  return { success: true, result };
});
```

## UI: Analyzer Selection

```
┌─────────────────────────────────────┐
│ Analyze File                    [X] │
├─────────────────────────────────────┤
│ Select Analyzer:                    │
│ ○ Rule-based (fast, deterministic)  │
│ ○ AI-powered (requires API key)     │
│ ○ Custom rules                      │
├─────────────────────────────────────┤
│ Options:                            │
│ Max patterns: [1000]                │
│ Max duplicates: [500]               │
├─────────────────────────────────────┤
│           [Cancel]  [Analyze]       │
└─────────────────────────────────────┘
```

---

## RuleBasedAnalyzer Implementation

## Data Structures (existing in types.d.ts)

```typescript
interface AnalysisResult {
  stats: FileStats;
  patterns: PatternGroup[];
  levelCounts: Record<string, number>;
  duplicateGroups: DuplicateGroup[];
  timeRange?: { start: string; end: string };
}

interface PatternGroup {
  pattern: string;      // Regex pattern
  template: string;     // Human-readable template: "Connection to {ip} failed"
  count: number;
  sampleLines: number[];
  category: 'noise' | 'error' | 'warning' | 'info' | 'debug' | 'unknown';
}

interface DuplicateGroup {
  hash: string;         // MD5/simple hash of line text
  text: string;         // The actual line text
  count: number;
  lineNumbers: number[];
}
```

## Analysis Algorithm

### Single Pass Strategy

```
for each line in file:
    1. Detect log level → increment levelCounts
    2. Extract timestamp → update timeRange
    3. Hash line → track in duplicateMap
    4. Normalize line → track in patternMap
```

### 1. Level Detection (Simple)

```typescript
function detectLevel(text: string): string | undefined {
  const upper = text.toUpperCase();
  if (/\b(ERROR|FATAL|CRITICAL)\b/.test(upper)) return 'error';
  if (/\b(WARN|WARNING)\b/.test(upper)) return 'warning';
  if (/\b(INFO)\b/.test(upper)) return 'info';
  if (/\b(DEBUG)\b/.test(upper)) return 'debug';
  if (/\b(TRACE|VERBOSE)\b/.test(upper)) return 'trace';
  return undefined;
}
```

### 2. Timestamp Detection

Common patterns to detect:
```
2024-01-15 14:30:45          ISO-like
2024-01-15T14:30:45.123Z     ISO 8601
Jan 15 14:30:45              Syslog
15/Jan/2024:14:30:45         Apache
1705329045                   Unix epoch
14:30:45.123                 Time only
```

Regex:
```typescript
const TIMESTAMP_PATTERNS = [
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/,  // ISO
  /[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/, // Syslog
  /\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2}/, // Apache
  /\d{2}:\d{2}:\d{2}[.,]\d{3}/, // Time with ms
];
```

### 3. Duplicate Detection

```typescript
// Use simple hash for speed (not cryptographic)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

// Track duplicates
const duplicateMap = new Map<string, { text: string; lines: number[] }>();

for each line:
  const hash = simpleHash(line.text);
  if (duplicateMap.has(hash)) {
    duplicateMap.get(hash).lines.push(lineNumber);
  } else {
    duplicateMap.set(hash, { text: line.text, lines: [lineNumber] });
  }

// Filter to only groups with count > 1
duplicateGroups = [...duplicateMap.values()]
  .filter(g => g.lines.length > 1)
  .sort((a, b) => b.lines.length - a.lines.length);
```

### 4. Pattern Detection (Most Complex)

**Goal**: Group lines like:
- "Connection to 192.168.1.1 failed after 30s"
- "Connection to 10.0.0.5 failed after 45s"

Into template: "Connection to {ip} failed after {num}s"

**Approach: Normalization + Clustering**

```typescript
function normalizeLine(text: string): string {
  return text
    // Remove timestamps
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*/g, '{timestamp}')
    // IPs
    .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '{ip}')
    // UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    // Hex strings (8+ chars)
    .replace(/\b[0-9a-f]{8,}\b/gi, '{hex}')
    // Numbers
    .replace(/\b\d+\b/g, '{num}')
    // Paths
    .replace(/\/[\w\-./]+/g, '{path}')
    // URLs
    .replace(/https?:\/\/[^\s]+/g, '{url}')
    // Email
    .replace(/[\w.-]+@[\w.-]+/g, '{email}');
}
```

**Pattern Tracking**:
```typescript
const patternMap = new Map<string, {
  template: string;
  lines: number[];
  level: string | undefined;
}>();

for each line:
  const normalized = normalizeLine(line.text);
  if (patternMap.has(normalized)) {
    patternMap.get(normalized).lines.push(lineNumber);
  } else {
    patternMap.set(normalized, {
      template: normalized,
      lines: [lineNumber],
      level: detectLevel(line.text)
    });
  }
```

**Categorization**:
```typescript
function categorizePattern(template: string, level: string | undefined): Category {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  if (level === 'info') return 'info';
  if (level === 'debug') return 'debug';

  // Heuristics for uncategorized
  if (/\b(fail|error|exception|crash)\b/i.test(template)) return 'error';
  if (/\b(warn|alert)\b/i.test(template)) return 'warning';

  // High frequency = likely noise
  return 'unknown';
}
```

## Performance Considerations

### Memory
- Don't store full line text for every pattern occurrence
- Store only first N sample lines (e.g., 5)
- Use streaming, don't load entire file

### Speed
- Single pass over file
- Simple hash (not crypto)
- Limit pattern groups to top 1000
- Limit duplicate groups to top 500
- Progress reporting every 10K lines

### Large Files
- For files > 100MB, sample every Nth line for patterns
- Always do full pass for duplicates and levels

## IPC Interface

```typescript
// Main process handler
ipcMain.handle('analyze-file', async (_, filePath: string) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const result = await handler.analyze((progress) => {
    mainWindow?.webContents.send('analyze-progress', progress);
  });

  return { success: true, result };
});
```

## UI Display

### Sidebar Sections

**Level Counts**:
```
ERROR    123  ████████████
WARN     456  ████████████████████
INFO    2340  ████████████████████████████████████
DEBUG    890  ██████████████████████████
```
- Click level → filter to show only that level

**Patterns** (collapsible):
```
▼ Connection to {ip} failed (342 occurrences)
  Category: ERROR
  Sample: "Connection to 192.168.1.1 failed after 30s"
  [Show lines] [Add to filter] [Highlight]

▶ Request processed in {num}ms (1205 occurrences)

▶ User {email} logged in (89 occurrences)
```

**Duplicates**:
```
▼ "Health check passed" (5420 occurrences)
  Lines: 10, 25, 40, 55, 70, ... [show all]
  [Collapse in view] [Highlight]
```

### Interactions
- Click pattern → jump to first occurrence
- "Show lines" → list all line numbers (scrollable)
- "Add to filter" → exclude/include in filter config
- "Highlight" → add as highlight rule
- "Collapse in view" → collapse duplicates in main viewer

## Implementation Order

1. **Analyzer interface & registry** - Plugin architecture
2. **RuleBasedAnalyzer** - Default implementation
3. **IPC handlers** - Wire up to renderer
4. **Basic UI** - Level counts bar chart
5. **Duplicates UI** - List with collapse
6. **Patterns UI** - Grouped list with templates
7. **Interactions** - Click to jump, filter, highlight

---

## Future: AIAnalyzer

### Concept

Use LLM to understand log semantics beyond regex patterns:
- Understand context: "OOM" means "Out of Memory"
- Group semantically similar logs even with different wording
- Generate human-readable explanations
- Suggest root causes for errors

### Interface

```typescript
class AIAnalyzer implements LogAnalyzer {
  name = 'ai';
  description = 'AI-powered semantic analysis';

  private apiKey: string | null = null;
  private model: string = 'claude-3-haiku'; // Fast & cheap for analysis

  async isAvailable(): Promise<boolean> {
    // Check if API key is configured
    this.apiKey = await this.loadApiKey();
    return this.apiKey !== null;
  }

  async analyze(
    filePath: string,
    options: AnalyzerOptions,
    onProgress?: (progress: AnalyzeProgress) => void
  ): Promise<AnalysisResult> {
    // 1. Sample lines from file (don't send entire log to API)
    const samples = await this.sampleLines(filePath, 1000);

    // 2. Send to LLM for pattern detection
    onProgress?.({ phase: 'analyzing', percent: 30, message: 'AI analyzing patterns...' });
    const patterns = await this.detectPatternsWithAI(samples);

    // 3. Classify full file using detected patterns
    onProgress?.({ phase: 'grouping', percent: 60, message: 'Classifying lines...' });
    const result = await this.classifyFile(filePath, patterns, onProgress);

    return result;
  }

  private async detectPatternsWithAI(samples: string[]): Promise<AIPattern[]> {
    const prompt = `Analyze these log lines and identify patterns.
For each pattern, provide:
1. A template with {placeholders} for variable parts
2. A category (error/warning/info/debug/noise)
3. A brief explanation of what this log means

Log samples:
${samples.join('\n')}

Return as JSON array.`;

    const response = await this.callAPI(prompt);
    return JSON.parse(response);
  }
}
```

### AI-Enhanced Features

1. **Smart Grouping**: Group "Connection refused" and "Failed to connect" together
2. **Root Cause Analysis**: "These 50 timeout errors likely caused by network issue at 14:30"
3. **Anomaly Detection**: "This error pattern is unusual - not seen in typical logs"
4. **Natural Language Queries**: "Show me all authentication failures"

### Configuration

```
~/.logan/config.json
{
  "ai": {
    "enabled": true,
    "provider": "anthropic",  // or "openai", "local"
    "apiKey": "sk-...",
    "model": "claude-3-haiku-20240307",
    "maxTokensPerRequest": 4000
  }
}
```

---

## File Structure

```
src/
  main/
    analyzers/
      index.ts           # Registry & exports
      types.ts           # LogAnalyzer interface
      ruleBasedAnalyzer.ts
      aiAnalyzer.ts      # Future
    index.ts             # Main process
    fileHandler.ts
  shared/
    types.ts             # Shared types
```
