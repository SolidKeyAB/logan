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
  'Run analysis on the currently open log file — detects patterns, duplicates, error rates, and statistics',
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
