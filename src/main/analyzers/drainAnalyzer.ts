import * as fs from 'fs';
import * as readline from 'readline';
import {
  LogAnalyzer,
  AnalyzerOptions,
  AnalyzeProgress,
  AnalysisResult,
  PatternGroup,
  DuplicateGroup
} from './types';

/**
 * Drain Algorithm for Log Parsing
 *
 * A fixed-depth tree based online log parsing method that automatically
 * extracts log templates (patterns) from raw log messages.
 *
 * Paper: "Drain: An Online Log Parsing Approach with Fixed Depth Tree"
 * https://jiemingzhu.github.io/pub/pjhe_icws2017.pdf
 *
 * TODO: Clarify what analysis is finding by testing with various log formats
 */

// Configuration
const DEPTH = 4;              // Tree depth (number of prefix tokens to match)
const SIMILARITY_THRESHOLD = 0.4;  // Min similarity to merge into existing cluster
const MAX_CLUSTERS = 2000;    // Max number of pattern clusters
const MAX_CHILDREN = 100;     // Max children per tree node
const PARAM_TOKEN = '<*>';    // Placeholder for variable parts

// Tokens that are likely variables (won't be used as tree keys)
const VARIABLE_PATTERNS = [
  /^\d+$/,                           // Pure numbers
  /^\d+\.\d+$/,                      // Decimals
  /^0x[0-9a-f]+$/i,                  // Hex
  /^[0-9a-f]{8,}$/i,                 // Long hex strings
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i,      // UUIDs
  /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, // IPs
  /^[\w.-]+@[\w.-]+$/,               // Emails
  /^https?:\/\//,                    // URLs
  /^\/[\w\/.-]+$/,                   // Paths
];

function isVariable(token: string): boolean {
  return VARIABLE_PATTERNS.some(p => p.test(token));
}

// Log cluster (a group of logs matching a pattern)
interface LogCluster {
  template: string[];        // The log template (tokens with <*> for variables)
  count: number;             // Number of logs matching this pattern
  sampleLines: number[];     // Sample line numbers
  level?: string;            // Detected log level
}

// Tree node for prefix matching
interface TreeNode {
  children: Map<string, TreeNode>;
  clusters: LogCluster[];
}

function createNode(): TreeNode {
  return { children: new Map(), clusters: [] };
}

// Tokenize a log line
function tokenize(line: string): string[] {
  // Split on whitespace and common delimiters, keep meaningful tokens
  return line.split(/[\s=:,\[\](){}]+/).filter(t => t.length > 0);
}

// Calculate similarity between token sequence and template
function calculateSimilarity(tokens: string[], template: string[]): number {
  if (tokens.length !== template.length) return 0;

  let matches = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (template[i] === PARAM_TOKEN || tokens[i] === template[i]) {
      matches++;
    }
  }
  return matches / tokens.length;
}

// Merge tokens into template, replacing differing tokens with <*>
function mergeTemplate(tokens: string[], template: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (template[i] === PARAM_TOKEN || tokens[i] !== template[i]) {
      result.push(PARAM_TOKEN);
    } else {
      result.push(tokens[i]);
    }
  }
  return result;
}

// Detect log level
function detectLevel(text: string): string | undefined {
  const sample = text.substring(0, 200).toUpperCase();
  if (/\b(ERROR|FATAL|CRITICAL|SEVERE|EXCEPTION|PANIC)\b/.test(sample)) return 'error';
  if (/\b(WARN|WARNING)\b/.test(sample)) return 'warning';
  if (/\b(INFO|INFORMATION)\b/.test(sample)) return 'info';
  if (/\b(DEBUG)\b/.test(sample)) return 'debug';
  if (/\b(TRACE|VERBOSE)\b/.test(sample)) return 'trace';
  return undefined;
}

// Categorize pattern
function categorizePattern(template: string[], level?: string): PatternGroup['category'] {
  if (level) {
    if (level === 'error') return 'error';
    if (level === 'warning') return 'warning';
    if (level === 'info') return 'info';
    if (level === 'debug' || level === 'trace') return 'debug';
  }

  const text = template.join(' ').toLowerCase();
  if (/fail|error|exception|crash|fatal|panic/.test(text)) return 'error';
  if (/warn|alert/.test(text)) return 'warning';
  if (/success|start|complete|ready|connect/.test(text)) return 'info';

  return 'unknown';
}

// Timestamp patterns for stripping (to find true duplicates)
const TIMESTAMP_STRIP_PATTERN = /^[\d\-\/.:T\sZ+]+|^\w{3}\s+\d{1,2}\s+[\d:]+\s*/;

// Simple hash
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash | 0;
  }
  return hash;
}

export class DrainAnalyzer implements LogAnalyzer {
  name = 'drain';
  description = 'Drain algorithm - automatic log pattern discovery';

  private root: TreeNode = createNode();
  private lengthMap: Map<number, TreeNode> = new Map();
  private clusterCount = 0;

  async analyze(
    filePath: string,
    options: AnalyzerOptions,
    onProgress?: (progress: AnalyzeProgress) => void,
    signal?: { cancelled: boolean }
  ): Promise<AnalysisResult> {
    // Reset state
    this.root = createNode();
    this.lengthMap = new Map();
    this.clusterCount = 0;

    const maxPatterns = options.maxPatterns || 500;
    const maxDuplicates = options.maxDuplicates || 200;

    const levelCounts: Record<string, number> = {
      error: 0, warning: 0, info: 0, debug: 0, trace: 0
    };

    // For true duplicates (content without timestamp)
    const duplicateMap = new Map<number, { text: string; count: number; firstLine: number }>();

    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let lineNumber = 0;

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    let bytesRead = 0;
    let lastProgressUpdate = Date.now();

    onProgress?.({ phase: 'parsing', percent: 0, message: 'Parsing log structure...' });

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        if (signal?.cancelled) break;

        lineNumber++;
        bytesRead += line.length + 1;

        const trimmed = line.trim();
        if (!trimmed) continue;

        // Detect level
        const level = detectLevel(line);
        if (level) levelCounts[level]++;

        // Extract timestamp (simple pattern)
        const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})|(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
        if (tsMatch) {
          if (!firstTimestamp) firstTimestamp = tsMatch[0];
          lastTimestamp = tsMatch[0];
        }

        // True duplicates: strip timestamp prefix and hash
        const contentOnly = trimmed.replace(TIMESTAMP_STRIP_PATTERN, '').trim();
        if (contentOnly.length > 10) {
          const hash = simpleHash(contentOnly);
          const existing = duplicateMap.get(hash);
          if (existing) {
            existing.count++;
          } else if (duplicateMap.size < 50000) {
            duplicateMap.set(hash, {
              text: contentOnly.length > 200 ? contentOnly.substring(0, 200) + '...' : contentOnly,
              count: 1,
              firstLine: lineNumber
            });
          }
        }

        // Drain: parse into pattern
        if (this.clusterCount < MAX_CLUSTERS) {
          const tokens = tokenize(trimmed);
          if (tokens.length > 0 && tokens.length < 100) {
            this.addLogMessage(tokens, lineNumber, level);
          }
        }

        // Progress update
        const now = Date.now();
        if (now - lastProgressUpdate > 200) {
          lastProgressUpdate = now;
          const percent = Math.round((bytesRead / fileSize) * 80);
          onProgress?.({ phase: 'parsing', percent, message: `Parsing line ${lineNumber.toLocaleString()}...` });
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    if (signal?.cancelled) {
      return this.emptyResult();
    }

    onProgress?.({ phase: 'grouping', percent: 85, message: 'Building results...' });

    // Collect all clusters
    const allClusters: LogCluster[] = [];
    this.collectClusters(this.root, allClusters);
    for (const node of this.lengthMap.values()) {
      this.collectClusters(node, allClusters);
    }

    // Build pattern groups
    const patterns: PatternGroup[] = allClusters
      .filter(c => c.count > 1)
      .map(cluster => ({
        pattern: cluster.template.join(' '),
        template: cluster.template.join(' '),
        count: cluster.count,
        sampleLines: cluster.sampleLines.slice(0, 5),
        category: categorizePattern(cluster.template, cluster.level)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxPatterns);

    // Build duplicate groups
    const duplicateGroups: DuplicateGroup[] = [];
    for (const [hash, entry] of duplicateMap) {
      if (entry.count > 1) {
        duplicateGroups.push({
          hash: hash.toString(16),
          text: entry.text,
          count: entry.count,
          lineNumbers: [entry.firstLine]
        });
      }
    }
    duplicateGroups.sort((a, b) => b.count - a.count);
    const limitedDuplicates = duplicateGroups.slice(0, maxDuplicates);

    let duplicateLineCount = 0;
    for (const g of limitedDuplicates) {
      duplicateLineCount += g.count - 1;
    }

    onProgress?.({ phase: 'done', percent: 100, message: 'Analysis complete' });

    return {
      stats: {
        totalLines: lineNumber,
        analyzedLines: lineNumber,
        uniquePatterns: patterns.length,
        duplicateLines: duplicateLineCount
      },
      patterns,
      levelCounts,
      duplicateGroups: limitedDuplicates,
      timeRange: firstTimestamp && lastTimestamp
        ? { start: firstTimestamp, end: lastTimestamp }
        : undefined,
      analyzerName: this.name,
      analyzedAt: Date.now()
    };
  }

  private addLogMessage(tokens: string[], lineNumber: number, level?: string): void {
    const len = tokens.length;

    // Get or create length bucket
    if (!this.lengthMap.has(len)) {
      this.lengthMap.set(len, createNode());
    }
    let node = this.lengthMap.get(len)!;

    // Walk down the tree using prefix tokens
    for (let i = 0; i < DEPTH && i < tokens.length; i++) {
      const token = tokens[i];
      const key = isVariable(token) ? PARAM_TOKEN : token;

      if (!node.children.has(key)) {
        if (node.children.size >= MAX_CHILDREN) {
          // Use wildcard if too many children
          if (!node.children.has(PARAM_TOKEN)) {
            node.children.set(PARAM_TOKEN, createNode());
          }
          node = node.children.get(PARAM_TOKEN)!;
          continue;
        }
        node.children.set(key, createNode());
      }
      node = node.children.get(key)!;
    }

    // Find best matching cluster
    let bestCluster: LogCluster | null = null;
    let bestSimilarity = 0;

    for (const cluster of node.clusters) {
      if (cluster.template.length === tokens.length) {
        const sim = calculateSimilarity(tokens, cluster.template);
        if (sim > bestSimilarity && sim >= SIMILARITY_THRESHOLD) {
          bestSimilarity = sim;
          bestCluster = cluster;
        }
      }
    }

    if (bestCluster) {
      // Merge into existing cluster
      bestCluster.template = mergeTemplate(tokens, bestCluster.template);
      bestCluster.count++;
      if (bestCluster.sampleLines.length < 10) {
        bestCluster.sampleLines.push(lineNumber);
      }
      if (!bestCluster.level && level) {
        bestCluster.level = level;
      }
    } else {
      // Create new cluster
      const newCluster: LogCluster = {
        template: tokens.map(t => isVariable(t) ? PARAM_TOKEN : t),
        count: 1,
        sampleLines: [lineNumber],
        level
      };
      node.clusters.push(newCluster);
      this.clusterCount++;
    }
  }

  private collectClusters(node: TreeNode, result: LogCluster[]): void {
    result.push(...node.clusters);
    for (const child of node.children.values()) {
      this.collectClusters(child, result);
    }
  }

  private emptyResult(): AnalysisResult {
    return {
      stats: { totalLines: 0, analyzedLines: 0, uniquePatterns: 0, duplicateLines: 0 },
      patterns: [],
      levelCounts: { error: 0, warning: 0, info: 0, debug: 0, trace: 0 },
      duplicateGroups: [],
      analyzerName: this.name,
      analyzedAt: Date.now()
    };
  }
}
