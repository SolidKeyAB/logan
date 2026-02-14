import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { SearchOptions, Bookmark, Highlight } from '../shared/types';
import { FileHandler } from './fileHandler';
import { BaselineStore, buildFingerprint } from './baselineStore';
import { AnalysisResult } from './analyzers/types';

const API_PORT = 19532;
const PORT_FILE = path.join(os.homedir(), '.logan', 'mcp-port');

export interface ApiContext {
  getMainWindow(): BrowserWindow | null;
  getCurrentFilePath(): string | null;
  getFileHandler(): FileHandler | null;
  getFileHandlerForPath(filePath: string): FileHandler | null;
  getFilteredLines(): number[] | null;
  getBookmarks(): Map<string, Bookmark>;
  getHighlights(): Map<string, Highlight>;
  openFile(filePath: string): Promise<any>;
  getLines(startLine: number, count: number): any;
  search(options: SearchOptions): Promise<any>;
  analyze(analyzerName?: string): Promise<any>;
  applyFilter(config: any): Promise<any>;
  clearFilter(): any;
  addBookmark(bookmark: Bookmark): any;
  addHighlight(highlight: Highlight): any;
  detectTimeGaps(options: any): Promise<any>;
  navigateToLine(lineNumber: number): void;
  getBaselineStore(): BaselineStore;
  getAnalysisResult(): AnalysisResult | null;
}

let server: http.Server | null = null;

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, data: any, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res: http.ServerResponse, message: string, status = 400): void {
  sendJson(res, { success: false, error: message }, status);
}

export function startApiServer(ctx: ApiContext): void {
  server = http.createServer(async (req, res) => {
    // Localhost-only: reject non-loopback connections
    const remoteAddr = req.socket.remoteAddress;
    if (remoteAddr && !remoteAddr.includes('127.0.0.1') && !remoteAddr.includes('::1')) {
      sendError(res, 'Forbidden', 403);
      return;
    }

    // CORS for local tooling
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || '/';

    try {
      // --- GET endpoints ---
      if (req.method === 'GET') {
        if (url === '/api/status') {
          const filePath = ctx.getCurrentFilePath();
          const handler = ctx.getFileHandler();
          const info = handler?.getFileInfo();
          const filteredLines = ctx.getFilteredLines();
          const bookmarkCount = ctx.getBookmarks().size;
          const highlightCount = ctx.getHighlights().size;
          sendJson(res, {
            success: true,
            status: {
              filePath: filePath || null,
              totalLines: info?.totalLines || 0,
              fileSize: info?.size || 0,
              isFiltered: !!filteredLines,
              filteredLineCount: filteredLines?.length || null,
              bookmarkCount,
              highlightCount,
            },
          });
          return;
        }

        if (url === '/api/bookmarks') {
          const bms = Array.from(ctx.getBookmarks().values())
            .sort((a, b) => a.lineNumber - b.lineNumber);
          sendJson(res, { success: true, bookmarks: bms });
          return;
        }

        if (url === '/api/highlights') {
          const hls = Array.from(ctx.getHighlights().values());
          sendJson(res, { success: true, highlights: hls });
          return;
        }

        if (url === '/api/baselines') {
          const baselines = ctx.getBaselineStore().list();
          sendJson(res, { success: true, baselines });
          return;
        }

        sendError(res, 'Not found', 404);
        return;
      }

      // --- POST endpoints ---
      if (req.method === 'POST') {
        const body = await parseBody(req);

        if (url === '/api/open-file') {
          if (!body.filePath) return sendError(res, 'filePath required');
          if (!fs.existsSync(body.filePath)) return sendError(res, 'File not found');
          const result = await ctx.openFile(body.filePath);
          sendJson(res, result);
          return;
        }

        if (url === '/api/get-lines') {
          const startLine = body.startLine ?? 0;
          const count = body.count ?? 100;
          const result = ctx.getLines(startLine, count);
          sendJson(res, result);
          return;
        }

        if (url === '/api/search') {
          if (!body.pattern) return sendError(res, 'pattern required');
          const options: SearchOptions = {
            pattern: body.pattern,
            isRegex: body.isRegex ?? false,
            isWildcard: false,
            matchCase: body.matchCase ?? false,
            wholeWord: body.wholeWord ?? false,
          };
          const result = await ctx.search(options);
          sendJson(res, result);
          return;
        }

        if (url === '/api/analyze') {
          const result = await ctx.analyze(body.analyzerName);
          sendJson(res, result);
          return;
        }

        if (url === '/api/filter') {
          const config = {
            levels: body.levels || [],
            includePatterns: body.includePatterns || [],
            excludePatterns: body.excludePatterns || [],
            matchCase: body.matchCase ?? false,
          };
          const result = await ctx.applyFilter(config);
          sendJson(res, result);
          return;
        }

        if (url === '/api/clear-filter') {
          const result = ctx.clearFilter();
          sendJson(res, result);
          return;
        }

        if (url === '/api/bookmark') {
          const bookmark: Bookmark = {
            id: body.id || `bm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            lineNumber: body.lineNumber ?? 0,
            label: body.label || '',
            color: body.color || '#ffff00',
            lineText: body.lineText,
          };
          const result = ctx.addBookmark(bookmark);
          sendJson(res, result);
          return;
        }

        if (url === '/api/highlight') {
          const highlight: Highlight = {
            id: body.id || `hl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            pattern: body.pattern || '',
            isRegex: body.isRegex ?? false,
            matchCase: body.matchCase ?? false,
            backgroundColor: body.backgroundColor || '#ffff00',
            textColor: body.textColor,
            includeWhitespace: body.includeWhitespace ?? false,
            highlightAll: body.highlightAll ?? true,
            isGlobal: body.isGlobal ?? false,
          };
          const result = ctx.addHighlight(highlight);
          sendJson(res, result);
          return;
        }

        if (url === '/api/time-gaps') {
          const result = await ctx.detectTimeGaps({
            thresholdSeconds: body.thresholdSeconds ?? 30,
          });
          sendJson(res, result);
          return;
        }

        if (url === '/api/navigate') {
          const lineNumber = body.lineNumber ?? 0;
          ctx.navigateToLine(lineNumber);
          sendJson(res, { success: true });
          return;
        }

        if (url === '/api/baseline-save') {
          const filePath = ctx.getCurrentFilePath();
          const handler = ctx.getFileHandler();
          const analysisResult = ctx.getAnalysisResult();
          if (!filePath || !handler) return sendError(res, 'No file open');
          if (!analysisResult) return sendError(res, 'Run analysis first');
          const fp = buildFingerprint(filePath, analysisResult, handler);
          const id = ctx.getBaselineStore().save(
            body.name || 'Unnamed baseline',
            body.description || '',
            body.tags || [],
            fp
          );
          sendJson(res, { success: true, id });
          return;
        }

        if (url === '/api/baseline-compare') {
          const filePath = ctx.getCurrentFilePath();
          const handler = ctx.getFileHandler();
          const analysisResult = ctx.getAnalysisResult();
          if (!filePath || !handler) return sendError(res, 'No file open');
          if (!analysisResult) return sendError(res, 'Run analysis first');
          if (!body.baselineId) return sendError(res, 'baselineId required');
          const fp = buildFingerprint(filePath, analysisResult, handler);
          const report = ctx.getBaselineStore().compare(fp, body.baselineId);
          if (!report) return sendError(res, 'Baseline not found');
          sendJson(res, { success: true, report });
          return;
        }

        if (url === '/api/baseline-delete') {
          if (!body.baselineId) return sendError(res, 'baselineId required');
          const ok = ctx.getBaselineStore().delete(body.baselineId);
          sendJson(res, { success: ok, error: ok ? undefined : 'Baseline not found' });
          return;
        }

        sendError(res, 'Not found', 404);
        return;
      }

      sendError(res, 'Method not allowed', 405);
    } catch (error) {
      sendError(res, String(error), 500);
    }
  });

  server.listen(API_PORT, '127.0.0.1', () => {
    console.log(`LOGAN API server listening on http://127.0.0.1:${API_PORT}`);
    // Write port file for MCP server discovery
    try {
      const configDir = path.join(os.homedir(), '.logan');
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(PORT_FILE, String(API_PORT), 'utf-8');
    } catch (err) {
      console.error('Failed to write MCP port file:', err);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`LOGAN API port ${API_PORT} already in use — MCP bridge disabled`);
    } else {
      console.error('LOGAN API server error:', err);
    }
  });
}

export function stopApiServer(): void {
  if (server) {
    server.close();
    server = null;
  }
  // Clean up port file
  try {
    if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
  } catch { /* ignore */ }
}
