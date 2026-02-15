#!/usr/bin/env node

// LOGAN MCP Server — standalone process communicating via stdio (JSON-RPC)
// Bridges AI agents to LOGAN's HTTP API with optional data obfuscation.
// CRITICAL: Only console.error() for logging — stdout is the JSON-RPC transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { Obfuscator } from './obfuscate';

const PORT_FILE = path.join(os.homedir(), '.logan', 'mcp-port');

function getApiPort(): number | null {
  try {
    if (fs.existsSync(PORT_FILE)) {
      const port = parseInt(fs.readFileSync(PORT_FILE, 'utf-8').trim(), 10);
      return isNaN(port) ? null : port;
    }
  } catch { /* ignore */ }
  return null;
}

function apiCall(method: string, urlPath: string, body?: any): Promise<any> {
  const port = getApiPort();
  if (!port) {
    return Promise.reject(new Error('LOGAN is not running. Start LOGAN first, then retry.'));
  }

  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: 60000, // 60s timeout for long operations like analysis
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Invalid response from LOGAN API: ${raw.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Cannot connect to LOGAN (port ${port}): ${err.message}. Is LOGAN running?`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('LOGAN API request timed out'));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// --- Obfuscation ---
const obfuscator = new Obfuscator();

function maybeRedact<T>(data: T, redact: boolean): T {
  if (!redact) return data;
  return obfuscator.obfuscateObject(data);
}

// --- MCP Server Setup ---

const server = new McpServer({
  name: 'logan',
  version: '1.0.0',
});

// === Tool: logan_status ===
server.tool(
  'logan_status',
  'Get LOGAN status: current file, line count, filter/bookmark/highlight state',
  {},
  async () => {
    try {
      const result = await apiCall('GET', '/api/status');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_open_file ===
server.tool(
  'logan_open_file',
  'Open a log file in LOGAN',
  { filePath: z.string().describe('Absolute path to the log file to open') },
  async ({ filePath }) => {
    try {
      const result = await apiCall('POST', '/api/open-file', { filePath });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_get_lines ===
server.tool(
  'logan_get_lines',
  'Read a range of lines from the currently open log file',
  {
    startLine: z.number().int().min(0).default(0).describe('0-based start line index'),
    count: z.number().int().min(1).max(1000).default(100).describe('Number of lines to read (max 1000)'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data (IPs, emails, tokens, etc.)'),
  },
  async ({ startLine, count, redact }) => {
    try {
      const result = await apiCall('POST', '/api/get-lines', { startLine, count });
      const output = redact ? maybeRedact(result, true) : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_search ===
server.tool(
  'logan_search',
  'Search for a pattern in the currently open log file. Returns matching lines with line numbers.',
  {
    pattern: z.string().describe('Search pattern (text or regex)'),
    isRegex: z.boolean().default(false).describe('Treat pattern as regex'),
    matchCase: z.boolean().default(false).describe('Case-sensitive search'),
    wholeWord: z.boolean().default(false).describe('Match whole words only'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
  },
  async ({ pattern, isRegex, matchCase, wholeWord, redact }) => {
    try {
      const result = await apiCall('POST', '/api/search', { pattern, isRegex, matchCase, wholeWord });
      const output = redact ? maybeRedact(result, true) : result;
      // Summarize if too many matches
      if (output.success && output.matches && output.matches.length > 200) {
        const summary = {
          success: true,
          totalMatches: output.matches.length,
          first200Matches: output.matches.slice(0, 200),
          note: `Showing first 200 of ${output.matches.length} matches. Use logan_get_lines to read specific line ranges.`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_analyze ===
server.tool(
  'logan_analyze',
  'Run analysis on the currently open log file — detects crashes, counts error/warning levels, identifies top failing components, and suggests filters',
  {
    analyzerName: z.string().optional().describe('Specific analyzer name (omit for default)'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
  },
  async ({ analyzerName, redact }) => {
    try {
      const result = await apiCall('POST', '/api/analyze', { analyzerName });
      const output = redact ? maybeRedact(result, true) : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_filter ===
server.tool(
  'logan_filter',
  'Apply a filter to show only matching lines. Supports level filtering and include/exclude patterns.',
  {
    levels: z.array(z.string()).optional().describe('Log levels to include (e.g. ["error", "warning"])'),
    includePatterns: z.array(z.string()).optional().describe('Regex patterns — line must match at least one'),
    excludePatterns: z.array(z.string()).optional().describe('Regex patterns — matching lines are excluded'),
    matchCase: z.boolean().default(false).describe('Case-sensitive pattern matching'),
  },
  async ({ levels, includePatterns, excludePatterns, matchCase }) => {
    try {
      const result = await apiCall('POST', '/api/filter', { levels, includePatterns, excludePatterns, matchCase });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_clear_filter ===
server.tool(
  'logan_clear_filter',
  'Remove the active filter and show all lines again',
  {},
  async () => {
    try {
      const result = await apiCall('POST', '/api/clear-filter');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_add_bookmark ===
server.tool(
  'logan_add_bookmark',
  'Bookmark a specific line in the log file',
  {
    lineNumber: z.number().int().min(0).describe('0-based line number to bookmark'),
    label: z.string().default('').describe('Optional label/note for the bookmark'),
    color: z.string().default('#ffff00').describe('Bookmark color (hex)'),
  },
  async ({ lineNumber, label, color }) => {
    try {
      const result = await apiCall('POST', '/api/bookmark', { lineNumber, label, color });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_bookmarks ===
server.tool(
  'logan_bookmarks',
  'List all bookmarks in the currently open file',
  {
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
  },
  async ({ redact }) => {
    try {
      const result = await apiCall('GET', '/api/bookmarks');
      const output = redact ? maybeRedact(result, true) : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_highlight ===
server.tool(
  'logan_highlight',
  'Add a highlight rule to visually mark matching text in the log viewer',
  {
    pattern: z.string().describe('Text or regex pattern to highlight'),
    isRegex: z.boolean().default(false).describe('Treat pattern as regex'),
    matchCase: z.boolean().default(false).describe('Case-sensitive matching'),
    backgroundColor: z.string().default('#ffff00').describe('Highlight background color (hex)'),
    isGlobal: z.boolean().default(false).describe('Apply to all files (true) or current file only (false)'),
  },
  async ({ pattern, isRegex, matchCase, backgroundColor, isGlobal }) => {
    try {
      const result = await apiCall('POST', '/api/highlight', { pattern, isRegex, matchCase, backgroundColor, isGlobal });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_highlights ===
server.tool(
  'logan_highlights',
  'List all active highlight rules',
  {},
  async () => {
    try {
      const result = await apiCall('GET', '/api/highlights');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_time_gaps ===
server.tool(
  'logan_time_gaps',
  'Find gaps in timestamps between consecutive log lines — useful for detecting pauses, hangs, or missing data',
  {
    thresholdSeconds: z.number().min(1).default(30).describe('Minimum gap duration in seconds to report'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
  },
  async ({ thresholdSeconds, redact }) => {
    try {
      const result = await apiCall('POST', '/api/time-gaps', { thresholdSeconds });
      const output = redact ? maybeRedact(result, true) : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_navigate ===
server.tool(
  'logan_navigate',
  'Scroll the LOGAN UI to a specific line number',
  {
    lineNumber: z.number().int().min(0).describe('0-based line number to scroll to'),
  },
  async ({ lineNumber }) => {
    try {
      const result = await apiCall('POST', '/api/navigate', { lineNumber });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_baseline_save ===
server.tool(
  'logan_baseline_save',
  'Save current analysis as a named baseline for future comparison',
  {
    name: z.string().describe('Name for the baseline (e.g. "production-healthy")'),
    description: z.string().default('').describe('Optional description'),
    tags: z.array(z.string()).default([]).describe('Optional tags (e.g. ["production", "v2.1"])'),
  },
  async ({ name, description, tags }) => {
    try {
      const result = await apiCall('POST', '/api/baseline-save', { name, description, tags });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_baseline_list ===
server.tool(
  'logan_baseline_list',
  'List all saved baselines',
  {},
  async () => {
    try {
      const result = await apiCall('GET', '/api/baselines');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_baseline_compare ===
server.tool(
  'logan_baseline_compare',
  'Compare current log against a saved baseline, returns findings with severity',
  {
    baselineId: z.string().describe('ID of the baseline to compare against'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
  },
  async ({ baselineId, redact }) => {
    try {
      const result = await apiCall('POST', '/api/baseline-compare', { baselineId });
      const output = redact ? maybeRedact(result, true) : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_baseline_delete ===
server.tool(
  'logan_baseline_delete',
  'Delete a saved baseline',
  {
    baselineId: z.string().describe('ID of the baseline to delete'),
  },
  async ({ baselineId }) => {
    try {
      const result = await apiCall('POST', '/api/baseline-delete', { baselineId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_triage ===
server.tool(
  'logan_triage',
  'Quick triage: "What\'s wrong with this log?" — returns severity, summary, crashes, failing components, time gaps, and filter suggestions in a single call',
  {
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
    timeGapThreshold: z.number().min(1).default(60).describe('Minimum time gap in seconds to report'),
  },
  async ({ redact, timeGapThreshold }) => {
    try {
      // 1. Status
      const status = await apiCall('GET', '/api/status');
      if (!status.success || !status.status.filePath) {
        return { content: [{ type: 'text', text: 'Error: No file open in LOGAN. Use logan_open_file first.' }], isError: true };
      }

      // 2. Analysis
      const analysis = await apiCall('POST', '/api/analyze', {});

      // 3. Time gaps
      const gaps = await apiCall('POST', '/api/time-gaps', { thresholdSeconds: timeGapThreshold });

      // 4. Bookmarks
      const bms = await apiCall('GET', '/api/bookmarks');

      // Build triage result
      const fileInfo = status.status;
      const result = analysis.success ? analysis.result : null;

      const levelCounts = result?.levelCounts || {};
      const totalAnalyzed = result?.stats?.analyzedLines || fileInfo.totalLines;
      const errorCount = levelCounts['error'] || 0;
      const warningCount = levelCounts['warning'] || 0;
      const errorPercent = totalAnalyzed > 0 ? (errorCount / totalAnalyzed) * 100 : 0;
      const warningPercent = totalAnalyzed > 0 ? (warningCount / totalAnalyzed) * 100 : 0;

      const crashes = result?.insights?.crashes || [];
      const topFailingComponents = result?.insights?.topFailingComponents || [];
      const filterSuggestions = result?.insights?.filterSuggestions || [];
      const timeGaps = (gaps.success ? gaps.gaps : []).slice(0, 5);

      // Group crashes by keyword
      const crashesByKeyword: Record<string, { keyword: string; count: number; firstLineNumber: number; sampleText: string }> = {};
      for (const c of crashes) {
        if (!crashesByKeyword[c.keyword]) {
          crashesByKeyword[c.keyword] = { keyword: c.keyword, count: 0, firstLineNumber: c.lineNumber, sampleText: c.text };
        }
        crashesByKeyword[c.keyword].count++;
      }

      // Determine severity
      let severity: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (crashes.length > 0 || errorPercent > 20) {
        severity = 'critical';
      } else if (errorPercent > 5 || timeGaps.some((g: any) => g.gapSeconds > 300) || topFailingComponents.length > 3) {
        severity = 'warning';
      }

      // Build summary string
      const parts = [`${fileInfo.totalLines.toLocaleString()} lines`];
      if (errorCount > 0) parts.push(`${errorCount.toLocaleString()} errors (${errorPercent.toFixed(1)}%)`);
      if (crashes.length > 0) parts.push(`${crashes.length} crashes`);
      if (timeGaps.length > 0) parts.push(`${timeGaps.length} time gaps`);
      const summary = parts.join(', ');

      const triage = {
        file: {
          path: fileInfo.filePath,
          totalLines: fileInfo.totalLines,
          fileSize: fileInfo.fileSize,
          timeRange: result?.timeRange || null,
        },
        severity,
        summary,
        levelDistribution: {
          ...levelCounts,
          errorPercent: Math.round(errorPercent * 100) / 100,
          warningPercent: Math.round(warningPercent * 100) / 100,
        },
        crashes: Object.values(crashesByKeyword),
        topFailingComponents: topFailingComponents.slice(0, 10),
        timeGaps,
        filterSuggestions: filterSuggestions.slice(0, 5),
        existingBookmarks: bms.success ? (bms.bookmarks?.length || 0) : 0,
      };

      const output = redact ? maybeRedact(triage, true) : triage;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_investigate_crashes ===
server.tool(
  'logan_investigate_crashes',
  'Deep-dive on crashes: returns every crash site with surrounding context lines so the AI can reason about root causes',
  {
    contextLines: z.number().int().min(1).max(50).default(10).describe('Number of context lines before and after each crash'),
    maxCrashes: z.number().int().min(1).max(100).default(20).describe('Maximum number of crash sites to return'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
    autoBookmark: z.boolean().default(false).describe('Automatically bookmark crash sites in LOGAN'),
    autoHighlight: z.boolean().default(false).describe('Automatically highlight crash keywords in LOGAN'),
  },
  async ({ contextLines, maxCrashes, redact, autoBookmark, autoHighlight }) => {
    try {
      const result = await apiCall('POST', '/api/investigate-crashes', {
        contextLines, maxCrashes, autoBookmark, autoHighlight,
      });
      const output = redact ? maybeRedact(result, true) : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_investigate_component ===
server.tool(
  'logan_investigate_component',
  'Focus on one component\'s health: shows error/warning/info breakdown, sample lines per level, and error sites with context',
  {
    component: z.string().describe('Component/channel name to investigate'),
    maxSamplesPerLevel: z.number().int().min(1).max(20).default(5).describe('Max sample lines per log level'),
    includeErrorContext: z.boolean().default(true).describe('Include context lines around error sites'),
    contextLines: z.number().int().min(1).max(20).default(5).describe('Context lines around error sites'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
  },
  async ({ component, maxSamplesPerLevel, includeErrorContext, contextLines, redact }) => {
    try {
      const result = await apiCall('POST', '/api/investigate-component', {
        component, maxSamplesPerLevel, includeErrorContext, contextLines,
      });
      const output = redact ? maybeRedact(result, true) : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_compare_baseline ===
server.tool(
  'logan_compare_baseline',
  'Enriched baseline comparison: compares current log against a saved baseline and returns findings with actual evidence lines from the log',
  {
    baselineId: z.string().describe('ID of the baseline to compare against'),
    maxEvidencePerFinding: z.number().int().min(1).max(10).default(3).describe('Max evidence lines per finding'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
  },
  async ({ baselineId, maxEvidencePerFinding, redact }) => {
    try {
      // 1. Ensure analysis exists
      await apiCall('POST', '/api/analyze', {});

      // 2. Get comparison findings
      const compareResult = await apiCall('POST', '/api/baseline-compare', { baselineId });
      if (!compareResult.success) {
        return { content: [{ type: 'text', text: `Error: ${compareResult.error}` }], isError: true };
      }

      const report = compareResult.report;
      const enrichedFindings: any[] = [];

      // 3. For each finding, search for evidence
      for (const finding of report.findings) {
        const evidence: { lineNumber: number; text: string }[] = [];

        try {
          let searchPattern: string | null = null;
          if (finding.category === 'new-crash') {
            // Extract crash keyword from title
            const kwMatch = finding.title.match(/crash keyword[:\s]*["']?(\w+)/i) ||
                           finding.title.match(/["'](\w+)["']/);
            searchPattern = kwMatch ? kwMatch[1] : null;
          } else if (finding.category === 'new-component' || finding.category === 'error-rate') {
            // Extract component name from detail
            const compMatch = finding.detail?.match(/["']([^"']+)["']/) ||
                             finding.title?.match(/["']([^"']+)["']/);
            searchPattern = compMatch ? compMatch[1] : null;
          } else if (finding.category === 'level-shift' && finding.currentValue) {
            // For level shifts, search the shifted level
            const levelMatch = finding.title?.match(/(error|warning|fatal)/i);
            if (levelMatch) searchPattern = levelMatch[1];
          }

          if (searchPattern) {
            const searchResult = await apiCall('POST', '/api/search', {
              pattern: searchPattern, isRegex: false, matchCase: false, wholeWord: false,
            });
            if (searchResult.success && searchResult.matches) {
              const matches = searchResult.matches.slice(0, maxEvidencePerFinding);
              for (const m of matches) {
                evidence.push({ lineNumber: m.lineNumber, text: m.lineText });
              }
            }
          }
        } catch { /* evidence is best-effort */ }

        enrichedFindings.push({
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
          detail: finding.detail,
          baselineValue: finding.baselineValue,
          currentValue: finding.currentValue,
          evidence,
        });
      }

      // 4. Compute overall verdict
      const critical = report.summary.critical;
      const warning = report.summary.warning;
      let overallVerdict: 'improved' | 'stable' | 'degraded' | 'significantly-degraded' = 'stable';
      if (critical > 2) {
        overallVerdict = 'significantly-degraded';
      } else if (critical > 0 || warning > 3) {
        overallVerdict = 'degraded';
      } else {
        // Check if error rate dropped with no new crashes
        const hasNewCrash = enrichedFindings.some(f => f.category === 'new-crash');
        const hasErrorDrop = enrichedFindings.some(f =>
          f.category === 'level-shift' && f.title?.toLowerCase().includes('error') &&
          parseFloat(f.currentValue || '0') < parseFloat(f.baselineValue || '0')
        );
        if (!hasNewCrash && hasErrorDrop) {
          overallVerdict = 'improved';
        }
      }

      const output = {
        baselineName: report.baselineName,
        baselineId: report.baselineId,
        overallVerdict,
        summary: report.summary,
        findings: enrichedFindings,
      };

      const finalOutput = redact ? maybeRedact(output, true) : output;
      return { content: [{ type: 'text', text: JSON.stringify(finalOutput, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// === Tool: logan_investigate_timerange ===
server.tool(
  'logan_investigate_timerange',
  'Analyze a specific time window: "What happened between 14:00 and 15:00?" — returns level counts, crashes, time gaps, and sample lines for the period',
  {
    startTime: z.string().describe('Start of time window (ISO 8601 or parseable date string)'),
    endTime: z.string().describe('End of time window (ISO 8601 or parseable date string)'),
    maxSamples: z.number().int().min(1).max(100).default(20).describe('Max sample lines per category'),
    redact: z.boolean().default(true).describe('Whether to redact sensitive data'),
  },
  async ({ startTime, endTime, maxSamples, redact }) => {
    try {
      const result = await apiCall('POST', '/api/investigate-timerange', {
        startTime, endTime, maxSamples,
      });
      const output = redact ? maybeRedact(result, true) : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Start server ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('LOGAN MCP server started (stdio transport)');
}

main().catch((err) => {
  console.error('Fatal MCP server error:', err);
  process.exit(1);
});
