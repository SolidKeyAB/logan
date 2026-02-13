import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// === Inline API server logic for testing (avoids Electron imports) ===

interface Bookmark {
  id: string;
  lineNumber: number;
  label: string;
  color: string;
  lineText?: string;
}

interface Highlight {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  backgroundColor: string;
  textColor?: string;
  includeWhitespace: boolean;
  highlightAll: boolean;
  isGlobal?: boolean;
}

interface ApiContext {
  getMainWindow(): any;
  getCurrentFilePath(): string | null;
  getFileHandler(): any;
  getFileHandlerForPath(filePath: string): any;
  getFilteredLines(): number[] | null;
  getBookmarks(): Map<string, Bookmark>;
  getHighlights(): Map<string, Highlight>;
  openFile(filePath: string): Promise<any>;
  getLines(startLine: number, count: number): any;
  search(options: any): Promise<any>;
  analyze(analyzerName?: string): Promise<any>;
  applyFilter(config: any): Promise<any>;
  clearFilter(): any;
  addBookmark(bookmark: Bookmark): any;
  addHighlight(highlight: Highlight): any;
  detectTimeGaps(options: any): Promise<any>;
  navigateToLine(lineNumber: number): void;
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, data: any, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res: http.ServerResponse, message: string, status = 400): void {
  sendJson(res, { success: false, error: message }, status);
}

function createTestServer(ctx: ApiContext): http.Server {
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = req.url || '/';

    try {
      if (req.method === 'GET') {
        if (url === '/api/status') {
          const filePath = ctx.getCurrentFilePath();
          const handler = ctx.getFileHandler();
          const info = handler?.getFileInfo?.();
          const filteredLines = ctx.getFilteredLines();
          sendJson(res, {
            success: true,
            status: {
              filePath: filePath || null,
              totalLines: info?.totalLines || 0,
              fileSize: info?.size || 0,
              isFiltered: !!filteredLines,
              filteredLineCount: filteredLines?.length || null,
              bookmarkCount: ctx.getBookmarks().size,
              highlightCount: ctx.getHighlights().size,
            },
          });
          return;
        }
        if (url === '/api/bookmarks') {
          sendJson(res, { success: true, bookmarks: Array.from(ctx.getBookmarks().values()).sort((a, b) => a.lineNumber - b.lineNumber) });
          return;
        }
        if (url === '/api/highlights') {
          sendJson(res, { success: true, highlights: Array.from(ctx.getHighlights().values()) });
          return;
        }
        sendError(res, 'Not found', 404);
        return;
      }

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
          const result = ctx.getLines(body.startLine ?? 0, body.count ?? 100);
          sendJson(res, result);
          return;
        }
        if (url === '/api/search') {
          if (!body.pattern) return sendError(res, 'pattern required');
          const result = await ctx.search({ pattern: body.pattern, isRegex: body.isRegex ?? false, isWildcard: false, matchCase: body.matchCase ?? false, wholeWord: body.wholeWord ?? false });
          sendJson(res, result);
          return;
        }
        if (url === '/api/analyze') {
          const result = await ctx.analyze(body.analyzerName);
          sendJson(res, result);
          return;
        }
        if (url === '/api/filter') {
          const result = await ctx.applyFilter({ levels: body.levels || [], includePatterns: body.includePatterns || [], excludePatterns: body.excludePatterns || [], matchCase: body.matchCase ?? false });
          sendJson(res, result);
          return;
        }
        if (url === '/api/clear-filter') {
          sendJson(res, ctx.clearFilter());
          return;
        }
        if (url === '/api/bookmark') {
          const bm: Bookmark = {
            id: body.id || `bm-${Date.now()}`,
            lineNumber: body.lineNumber ?? 0,
            label: body.label || '',
            color: body.color || '#ffff00',
            lineText: body.lineText,
          };
          sendJson(res, ctx.addBookmark(bm));
          return;
        }
        if (url === '/api/highlight') {
          const hl: Highlight = {
            id: body.id || `hl-${Date.now()}`,
            pattern: body.pattern || '',
            isRegex: body.isRegex ?? false,
            matchCase: body.matchCase ?? false,
            backgroundColor: body.backgroundColor || '#ffff00',
            textColor: body.textColor,
            includeWhitespace: body.includeWhitespace ?? false,
            highlightAll: body.highlightAll ?? true,
            isGlobal: body.isGlobal ?? false,
          };
          sendJson(res, ctx.addHighlight(hl));
          return;
        }
        if (url === '/api/time-gaps') {
          const result = await ctx.detectTimeGaps({ thresholdSeconds: body.thresholdSeconds ?? 30 });
          sendJson(res, result);
          return;
        }
        if (url === '/api/navigate') {
          ctx.navigateToLine(body.lineNumber ?? 0);
          sendJson(res, { success: true });
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
}

// === HTTP helper ===

function request(port: number, method: string, urlPath: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ status: res.statusCode || 500, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode || 500, data: raw }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// === Mock context ===

function createMockContext(): ApiContext & { _navigatedLine: number | null } {
  const bookmarks = new Map<string, Bookmark>();
  const highlights = new Map<string, Highlight>();
  let navigatedLine: number | null = null;

  return {
    _navigatedLine: null,
    getMainWindow: () => null,
    getCurrentFilePath: () => '/tmp/test.log',
    getFileHandler: () => ({
      getFileInfo: () => ({ path: '/tmp/test.log', size: 1024, totalLines: 500 }),
    }),
    getFileHandlerForPath: () => null,
    getFilteredLines: () => null,
    getBookmarks: () => bookmarks,
    getHighlights: () => highlights,
    openFile: async (fp: string) => ({ success: true, info: { path: fp, size: 100, totalLines: 10 } }),
    getLines: (start: number, count: number) => ({
      success: true,
      lines: Array.from({ length: Math.min(count, 5) }, (_, i) => ({
        lineNumber: start + i,
        text: `Line ${start + i}: sample log content`,
      })),
    }),
    search: async (opts: any) => ({
      success: true,
      matches: [{ lineNumber: 10, column: 5, length: opts.pattern.length, lineText: `match for ${opts.pattern}` }],
    }),
    analyze: async () => ({ success: true, result: { stats: { totalLines: 500 }, patterns: [] } }),
    applyFilter: async (config: any) => ({ success: true, stats: { filteredLines: 42 } }),
    clearFilter: () => ({ success: true }),
    addBookmark: (bm: Bookmark) => { bookmarks.set(bm.id, bm); return { success: true }; },
    addHighlight: (hl: Highlight) => { highlights.set(hl.id, hl); return { success: true }; },
    detectTimeGaps: async () => ({ success: true, gaps: [], totalLines: 500 }),
    navigateToLine: (ln: number) => { navigatedLine = ln; (ctx as any)._navigatedLine = ln; },
  };

  // TypeScript needs the variable declaration before reference
  var ctx = arguments.callee as any; // won't actually work — fixed below
}

// Re-implement properly without closure issue
function buildMockContext() {
  const bookmarks = new Map<string, Bookmark>();
  const highlights = new Map<string, Highlight>();
  const state = { navigatedLine: null as number | null };

  const ctx: ApiContext & { state: typeof state } = {
    state,
    getMainWindow: () => null,
    getCurrentFilePath: () => '/tmp/test.log',
    getFileHandler: () => ({
      getFileInfo: () => ({ path: '/tmp/test.log', size: 1024, totalLines: 500 }),
    }),
    getFileHandlerForPath: () => null,
    getFilteredLines: () => null,
    getBookmarks: () => bookmarks,
    getHighlights: () => highlights,
    openFile: async (fp: string) => ({ success: true, info: { path: fp, size: 100, totalLines: 10 } }),
    getLines: (start: number, count: number) => ({
      success: true,
      lines: Array.from({ length: Math.min(count, 5) }, (_, i) => ({
        lineNumber: start + i,
        text: `Line ${start + i}: sample log content`,
      })),
    }),
    search: async (opts: any) => ({
      success: true,
      matches: [{ lineNumber: 10, column: 5, length: opts.pattern.length, lineText: `match for ${opts.pattern}` }],
    }),
    analyze: async () => ({ success: true, result: { stats: { totalLines: 500 }, patterns: [] } }),
    applyFilter: async () => ({ success: true, stats: { filteredLines: 42 } }),
    clearFilter: () => ({ success: true }),
    addBookmark: (bm: Bookmark) => { bookmarks.set(bm.id, bm); return { success: true }; },
    addHighlight: (hl: Highlight) => { highlights.set(hl.id, hl); return { success: true }; },
    detectTimeGaps: async () => ({ success: true, gaps: [], totalLines: 500 }),
    navigateToLine: (ln: number) => { state.navigatedLine = ln; },
  };
  return ctx;
}

// === Tests ===

describe('API Server', () => {
  let server: http.Server;
  let port: number;
  let ctx: ReturnType<typeof buildMockContext>;

  beforeAll(async () => {
    ctx = buildMockContext();
    server = createTestServer(ctx);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('GET /api/status', () => {
    it('should return current file status', async () => {
      const { status, data } = await request(port, 'GET', '/api/status');
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status.filePath).toBe('/tmp/test.log');
      expect(data.status.totalLines).toBe(500);
      expect(data.status.fileSize).toBe(1024);
      expect(data.status.isFiltered).toBe(false);
      expect(data.status.bookmarkCount).toBe(0);
      expect(data.status.highlightCount).toBe(0);
    });
  });

  describe('POST /api/get-lines', () => {
    it('should return lines with default params', async () => {
      const { status, data } = await request(port, 'POST', '/api/get-lines', {});
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.lines.length).toBeGreaterThan(0);
      expect(data.lines[0].lineNumber).toBe(0);
    });

    it('should respect startLine and count', async () => {
      const { data } = await request(port, 'POST', '/api/get-lines', { startLine: 10, count: 3 });
      expect(data.success).toBe(true);
      expect(data.lines[0].lineNumber).toBe(10);
    });
  });

  describe('POST /api/search', () => {
    it('should require pattern', async () => {
      const { status, data } = await request(port, 'POST', '/api/search', {});
      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('pattern required');
    });

    it('should search with pattern', async () => {
      const { data } = await request(port, 'POST', '/api/search', { pattern: 'error' });
      expect(data.success).toBe(true);
      expect(data.matches.length).toBe(1);
      expect(data.matches[0].lineNumber).toBe(10);
    });
  });

  describe('POST /api/analyze', () => {
    it('should run analysis', async () => {
      const { data } = await request(port, 'POST', '/api/analyze', {});
      expect(data.success).toBe(true);
      expect(data.result.stats.totalLines).toBe(500);
    });
  });

  describe('POST /api/filter + POST /api/clear-filter', () => {
    it('should apply filter', async () => {
      const { data } = await request(port, 'POST', '/api/filter', { levels: ['error'] });
      expect(data.success).toBe(true);
      expect(data.stats.filteredLines).toBe(42);
    });

    it('should clear filter', async () => {
      const { data } = await request(port, 'POST', '/api/clear-filter', {});
      expect(data.success).toBe(true);
    });
  });

  describe('POST /api/bookmark + GET /api/bookmarks', () => {
    it('should add a bookmark', async () => {
      const { data } = await request(port, 'POST', '/api/bookmark', {
        id: 'bm-test-1',
        lineNumber: 42,
        label: 'Important line',
        color: '#ff0000',
      });
      expect(data.success).toBe(true);
    });

    it('should list bookmarks', async () => {
      const { data } = await request(port, 'GET', '/api/bookmarks');
      expect(data.success).toBe(true);
      expect(data.bookmarks.length).toBe(1);
      expect(data.bookmarks[0].lineNumber).toBe(42);
      expect(data.bookmarks[0].label).toBe('Important line');
    });

    it('should auto-generate bookmark ID if missing', async () => {
      const { data } = await request(port, 'POST', '/api/bookmark', {
        lineNumber: 99,
        label: 'Auto ID',
      });
      expect(data.success).toBe(true);
      // Should now have 2 bookmarks
      const { data: list } = await request(port, 'GET', '/api/bookmarks');
      expect(list.bookmarks.length).toBe(2);
    });

    it('should sort bookmarks by line number', async () => {
      const { data } = await request(port, 'GET', '/api/bookmarks');
      for (let i = 1; i < data.bookmarks.length; i++) {
        expect(data.bookmarks[i].lineNumber).toBeGreaterThanOrEqual(data.bookmarks[i - 1].lineNumber);
      }
    });
  });

  describe('POST /api/highlight + GET /api/highlights', () => {
    it('should add a highlight', async () => {
      const { data } = await request(port, 'POST', '/api/highlight', {
        id: 'hl-test-1',
        pattern: 'ERROR',
        backgroundColor: '#ff0000',
      });
      expect(data.success).toBe(true);
    });

    it('should list highlights', async () => {
      const { data } = await request(port, 'GET', '/api/highlights');
      expect(data.success).toBe(true);
      expect(data.highlights.length).toBe(1);
      expect(data.highlights[0].pattern).toBe('ERROR');
    });

    it('should apply default values for highlight fields', async () => {
      const { data: list } = await request(port, 'GET', '/api/highlights');
      const hl = list.highlights[0];
      expect(hl.isRegex).toBe(false);
      expect(hl.matchCase).toBe(false);
      expect(hl.highlightAll).toBe(true);
      expect(hl.isGlobal).toBe(false);
    });
  });

  describe('POST /api/time-gaps', () => {
    it('should detect time gaps', async () => {
      const { data } = await request(port, 'POST', '/api/time-gaps', { thresholdSeconds: 60 });
      expect(data.success).toBe(true);
      expect(Array.isArray(data.gaps)).toBe(true);
    });
  });

  describe('POST /api/navigate', () => {
    it('should send navigation command', async () => {
      const { data } = await request(port, 'POST', '/api/navigate', { lineNumber: 150 });
      expect(data.success).toBe(true);
      expect(ctx.state.navigatedLine).toBe(150);
    });

    it('should default to line 0 when no lineNumber provided', async () => {
      await request(port, 'POST', '/api/navigate', {});
      expect(ctx.state.navigatedLine).toBe(0);
    });
  });

  describe('POST /api/open-file', () => {
    it('should require filePath', async () => {
      const { status, data } = await request(port, 'POST', '/api/open-file', {});
      expect(status).toBe(400);
      expect(data.error).toBe('filePath required');
    });

    it('should reject non-existent file', async () => {
      const { status, data } = await request(port, 'POST', '/api/open-file', { filePath: '/nonexistent/file.log' });
      expect(status).toBe(400);
      expect(data.error).toBe('File not found');
    });

    it('should open an existing file', async () => {
      // Create a temp file
      const tmpFile = path.join(os.tmpdir(), `logan-test-${Date.now()}.log`);
      fs.writeFileSync(tmpFile, 'test line\n', 'utf-8');
      try {
        const { data } = await request(port, 'POST', '/api/open-file', { filePath: tmpFile });
        expect(data.success).toBe(true);
        expect(data.info.path).toBe(tmpFile);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown GET endpoints', async () => {
      const { status, data } = await request(port, 'GET', '/api/nonexistent');
      expect(status).toBe(404);
      expect(data.success).toBe(false);
    });

    it('should return 404 for unknown POST endpoints', async () => {
      const { status, data } = await request(port, 'POST', '/api/nonexistent', {});
      expect(status).toBe(404);
      expect(data.success).toBe(false);
    });

    it('should return 405 for unsupported methods', async () => {
      const { status, data } = await request(port, 'PUT', '/api/status');
      expect(status).toBe(405);
      expect(data.error).toBe('Method not allowed');
    });

    it('should handle CORS preflight', async () => {
      const { status } = await request(port, 'OPTIONS', '/api/status');
      expect(status).toBe(204);
    });
  });
});
