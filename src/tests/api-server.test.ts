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
  removeBookmark(id: string): any;
  updateBookmark(bookmark: Bookmark): any;
  clearBookmarks(): any;
  addHighlight(highlight: Highlight): any;
  removeHighlight(id: string): any;
  updateHighlight(highlight: Highlight): any;
  clearHighlights(): any;
  loadNotes(): Promise<any>;
  saveNotes(content: string): Promise<any>;
  detectTimeGaps(options: any): Promise<any>;
  navigateToLine(lineNumber: number): void;
  investigateCrashes(options: any): Promise<any>;
  investigateComponent(options: any): Promise<any>;
  investigateTimerange(options: any): Promise<any>;
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

// --- Chat message queue (mirrors api-server.ts) ---
interface ChatMessage {
  id: string;
  from: 'user' | 'agent';
  text: string;
  timestamp: number;
}

const chatMessages: ChatMessage[] = [];
let activeAgent: { res: http.ServerResponse; name: string } | null = null;

function addChatMessage(from: 'user' | 'agent', text: string): ChatMessage {
  const msg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    from, text, timestamp: Date.now(),
  };
  chatMessages.push(msg);
  return msg;
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

        // Agent status
        if (url === '/api/agent-status') {
          sendJson(res, { success: true, connected: activeAgent !== null, count: activeAgent ? 1 : 0, name: activeAgent?.name || null });
          return;
        }

        // SSE events (single-agent enforcement)
        if (url === '/api/events' || (req.url || '').startsWith('/api/events?')) {
          if (activeAgent) {
            sendJson(res, { success: false, error: 'Another agent is already connected', connectedAgent: activeAgent.name }, 409);
            return;
          }
          const fullUrl = new URL(req.url || '/api/events', `http://${req.headers.host || 'localhost'}`);
          const agentName = fullUrl.searchParams.get('name') || 'Unknown Agent';
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          res.write(`event: connected\ndata: ${JSON.stringify({ name: agentName })}\n\n`);
          activeAgent = { res, name: agentName };
          req.on('close', () => { if (activeAgent?.res === res) activeAgent = null; });
          return;
        }

        // Messages
        if (url === '/api/messages' || url?.startsWith('/api/messages?')) {
          const urlObj = new URL(url, 'http://127.0.0.1');
          const sinceStr = urlObj.searchParams.get('since');
          const since = sinceStr ? parseInt(sinceStr, 10) : undefined;
          const messages = since ? chatMessages.filter(m => m.timestamp > since) : [...chatMessages];
          sendJson(res, { success: true, messages });
          return;
        }

        // Notes (GET)
        if (url === '/api/notes') {
          const result = await ctx.loadNotes();
          sendJson(res, result);
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
        if (url === '/api/bookmark-remove') {
          if (!body.id) return sendError(res, 'id required');
          sendJson(res, ctx.removeBookmark(body.id));
          return;
        }
        if (url === '/api/bookmark-update') {
          if (!body.id) return sendError(res, 'id required');
          const existing = ctx.getBookmarks().get(body.id);
          if (!existing) return sendError(res, 'Bookmark not found');
          const updated: Bookmark = { ...existing, label: body.label ?? existing.label, color: body.color ?? existing.color };
          sendJson(res, ctx.updateBookmark(updated));
          return;
        }
        if (url === '/api/bookmark-clear') {
          sendJson(res, ctx.clearBookmarks());
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
        if (url === '/api/highlight-remove') {
          if (!body.id) return sendError(res, 'id required');
          sendJson(res, ctx.removeHighlight(body.id));
          return;
        }
        if (url === '/api/highlight-update') {
          if (!body.id) return sendError(res, 'id required');
          const existing = ctx.getHighlights().get(body.id);
          if (!existing) return sendError(res, 'Highlight not found');
          const updated: Highlight = { ...existing, pattern: body.pattern ?? existing.pattern, backgroundColor: body.backgroundColor ?? existing.backgroundColor };
          sendJson(res, ctx.updateHighlight(updated));
          return;
        }
        if (url === '/api/highlight-clear') {
          sendJson(res, ctx.clearHighlights());
          return;
        }
        if (url === '/api/notes') {
          if (body.content === undefined) return sendError(res, 'content required');
          const result = await ctx.saveNotes(body.content);
          sendJson(res, result);
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

        // Chat messages
        if (url === '/api/user-message') {
          if (!body.message) return sendError(res, 'message required');
          const msg = addChatMessage('user', body.message);
          sendJson(res, { success: true, message: msg });
          return;
        }
        if (url === '/api/agent-message') {
          if (!body.message) return sendError(res, 'message required');
          const msg = addChatMessage('agent', body.message);
          sendJson(res, { success: true, message: msg });
          return;
        }

        // Investigation endpoints
        if (url === '/api/investigate-crashes') {
          const result = await ctx.investigateCrashes({ contextLines: body.contextLines, maxCrashes: body.maxCrashes, autoBookmark: body.autoBookmark, autoHighlight: body.autoHighlight });
          sendJson(res, result);
          return;
        }
        if (url === '/api/investigate-component') {
          if (!body.component) return sendError(res, 'component required');
          const result = await ctx.investigateComponent({ component: body.component, maxSamplesPerLevel: body.maxSamplesPerLevel, includeErrorContext: body.includeErrorContext, contextLines: body.contextLines });
          sendJson(res, result);
          return;
        }
        if (url === '/api/investigate-timerange') {
          if (!body.startTime || !body.endTime) return sendError(res, 'startTime and endTime required');
          const result = await ctx.investigateTimerange({ startTime: body.startTime, endTime: body.endTime, maxSamples: body.maxSamples });
          sendJson(res, result);
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

function buildMockContext() {
  const bookmarks = new Map<string, Bookmark>();
  const highlights = new Map<string, Highlight>();
  const state = { navigatedLine: null as number | null, notes: '' };

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
    removeBookmark: (id: string) => { const existed = bookmarks.delete(id); return { success: existed }; },
    updateBookmark: (bm: Bookmark) => { bookmarks.set(bm.id, bm); return { success: true }; },
    clearBookmarks: () => { bookmarks.clear(); return { success: true }; },
    addHighlight: (hl: Highlight) => { highlights.set(hl.id, hl); return { success: true }; },
    removeHighlight: (id: string) => { const existed = highlights.delete(id); return { success: existed }; },
    updateHighlight: (hl: Highlight) => { highlights.set(hl.id, hl); return { success: true }; },
    clearHighlights: () => { highlights.clear(); return { success: true }; },
    loadNotes: async () => ({ success: true, content: state.notes }),
    saveNotes: async (content: string) => { state.notes = content; return { success: true }; },
    detectTimeGaps: async () => ({ success: true, gaps: [], totalLines: 500 }),
    navigateToLine: (ln: number) => { state.navigatedLine = ln; },
    investigateCrashes: async (opts: any) => ({ success: true, crashes: [{ lineNumber: 100, text: 'FATAL error', context: [] }], count: 1 }),
    investigateComponent: async (opts: any) => ({ success: true, component: opts.component, errorCount: 5, samples: [] }),
    investigateTimerange: async (opts: any) => ({ success: true, startTime: opts.startTime, endTime: opts.endTime, events: 42 }),
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

  describe('Bookmark CRUD', () => {
    it('should remove a bookmark', async () => {
      // Ensure bookmark exists
      await request(port, 'POST', '/api/bookmark', { id: 'bm-del', lineNumber: 10, label: 'Delete me' });
      const { data } = await request(port, 'POST', '/api/bookmark-remove', { id: 'bm-del' });
      expect(data.success).toBe(true);
    });

    it('should require id for bookmark-remove', async () => {
      const { status, data } = await request(port, 'POST', '/api/bookmark-remove', {});
      expect(status).toBe(400);
      expect(data.error).toBe('id required');
    });

    it('should update a bookmark', async () => {
      await request(port, 'POST', '/api/bookmark', { id: 'bm-upd', lineNumber: 20, label: 'Original', color: '#ff0000' });
      const { data } = await request(port, 'POST', '/api/bookmark-update', { id: 'bm-upd', label: 'Updated', color: '#00ff00' });
      expect(data.success).toBe(true);
      const { data: list } = await request(port, 'GET', '/api/bookmarks');
      const bm = list.bookmarks.find((b: any) => b.id === 'bm-upd');
      expect(bm.label).toBe('Updated');
      expect(bm.color).toBe('#00ff00');
    });

    it('should return error for updating non-existent bookmark', async () => {
      const { status, data } = await request(port, 'POST', '/api/bookmark-update', { id: 'bm-nonexistent', label: 'X' });
      expect(status).toBe(400);
      expect(data.error).toBe('Bookmark not found');
    });

    it('should clear all bookmarks', async () => {
      await request(port, 'POST', '/api/bookmark', { id: 'bm-c1', lineNumber: 1 });
      await request(port, 'POST', '/api/bookmark', { id: 'bm-c2', lineNumber: 2 });
      const { data } = await request(port, 'POST', '/api/bookmark-clear', {});
      expect(data.success).toBe(true);
      const { data: list } = await request(port, 'GET', '/api/bookmarks');
      expect(list.bookmarks.length).toBe(0);
    });
  });

  describe('Highlight CRUD', () => {
    it('should remove a highlight', async () => {
      await request(port, 'POST', '/api/highlight', { id: 'hl-del', pattern: 'test', backgroundColor: '#ff0' });
      const { data } = await request(port, 'POST', '/api/highlight-remove', { id: 'hl-del' });
      expect(data.success).toBe(true);
    });

    it('should require id for highlight-remove', async () => {
      const { status, data } = await request(port, 'POST', '/api/highlight-remove', {});
      expect(status).toBe(400);
      expect(data.error).toBe('id required');
    });

    it('should update a highlight', async () => {
      await request(port, 'POST', '/api/highlight', { id: 'hl-upd', pattern: 'error', backgroundColor: '#f00' });
      const { data } = await request(port, 'POST', '/api/highlight-update', { id: 'hl-upd', pattern: 'warning', backgroundColor: '#ff0' });
      expect(data.success).toBe(true);
      const { data: list } = await request(port, 'GET', '/api/highlights');
      const hl = list.highlights.find((h: any) => h.id === 'hl-upd');
      expect(hl.pattern).toBe('warning');
      expect(hl.backgroundColor).toBe('#ff0');
    });

    it('should return error for updating non-existent highlight', async () => {
      const { status, data } = await request(port, 'POST', '/api/highlight-update', { id: 'hl-nonexistent', pattern: 'X' });
      expect(status).toBe(400);
      expect(data.error).toBe('Highlight not found');
    });

    it('should clear all highlights', async () => {
      await request(port, 'POST', '/api/highlight', { id: 'hl-c1', pattern: 'a' });
      await request(port, 'POST', '/api/highlight', { id: 'hl-c2', pattern: 'b' });
      const { data } = await request(port, 'POST', '/api/highlight-clear', {});
      expect(data.success).toBe(true);
      const { data: list } = await request(port, 'GET', '/api/highlights');
      expect(list.highlights.length).toBe(0);
    });
  });

  describe('Notes endpoints', () => {
    it('should save notes', async () => {
      const { data } = await request(port, 'POST', '/api/notes', { content: 'My analysis notes' });
      expect(data.success).toBe(true);
    });

    it('should load notes', async () => {
      const { data } = await request(port, 'GET', '/api/notes');
      expect(data.success).toBe(true);
      expect(data.content).toBe('My analysis notes');
    });

    it('should require content for POST /api/notes', async () => {
      const { status, data } = await request(port, 'POST', '/api/notes', {});
      expect(status).toBe(400);
      expect(data.error).toBe('content required');
    });

    it('should allow saving empty notes', async () => {
      const { data } = await request(port, 'POST', '/api/notes', { content: '' });
      expect(data.success).toBe(true);
    });
  });

  describe('Chat messages', () => {
    it('should send a user message', async () => {
      const { data } = await request(port, 'POST', '/api/user-message', { message: 'Hello from user' });
      expect(data.success).toBe(true);
      expect(data.message.from).toBe('user');
      expect(data.message.text).toBe('Hello from user');
      expect(data.message.id).toBeTruthy();
      expect(data.message.timestamp).toBeGreaterThan(0);
    });

    it('should send an agent message', async () => {
      const { data } = await request(port, 'POST', '/api/agent-message', { message: 'Hello from agent' });
      expect(data.success).toBe(true);
      expect(data.message.from).toBe('agent');
      expect(data.message.text).toBe('Hello from agent');
    });

    it('should require message for user-message', async () => {
      const { status, data } = await request(port, 'POST', '/api/user-message', {});
      expect(status).toBe(400);
      expect(data.error).toBe('message required');
    });

    it('should require message for agent-message', async () => {
      const { status, data } = await request(port, 'POST', '/api/agent-message', {});
      expect(status).toBe(400);
      expect(data.error).toBe('message required');
    });

    it('should list chat messages', async () => {
      const { data } = await request(port, 'GET', '/api/messages');
      expect(data.success).toBe(true);
      expect(data.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter messages by since timestamp', async () => {
      const future = Date.now() + 100000;
      const { data } = await request(port, 'GET', `/api/messages?since=${future}`);
      expect(data.success).toBe(true);
      expect(data.messages.length).toBe(0);
    });
  });

  describe('Agent connection (SSE)', () => {
    it('should report no agent connected initially', async () => {
      const { data } = await request(port, 'GET', '/api/agent-status');
      expect(data.success).toBe(true);
      expect(data.connected).toBe(false);
      expect(data.count).toBe(0);
      expect(data.name).toBeNull();
    });

    it('should establish SSE connection with agent name', async () => {
      await new Promise<void>((resolve) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/api/events?name=TestAgent', method: 'GET' }, (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');
          let received = '';
          res.on('data', (chunk: Buffer) => {
            received += chunk.toString();
            if (received.includes('connected')) {
              expect(received).toContain('event: connected');
              expect(received).toContain('TestAgent');
              res.destroy();
              resolve();
            }
          });
        });
        req.end();
      });
    });

    it('should reject second agent connection with 409', async () => {
      await new Promise<void>((resolve) => {
        const req1 = http.request({ hostname: '127.0.0.1', port, path: '/api/events?name=Agent1', method: 'GET' }, async (res1) => {
          // Wait for connection to be established
          await new Promise(r => setTimeout(r, 50));
          const { status, data } = await request(port, 'GET', '/api/events?name=Agent2');
          expect(status).toBe(409);
          expect(data.error).toContain('already connected');
          expect(data.connectedAgent).toBe('Agent1');
          res1.destroy();
          resolve();
        });
        req1.end();
      });
    });

    it('should use "Unknown Agent" when no name param', async () => {
      // Wait for previous SSE to clean up
      await new Promise(r => setTimeout(r, 100));
      await new Promise<void>((resolve) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/api/events', method: 'GET' }, (res) => {
          let received = '';
          res.on('data', (chunk: Buffer) => {
            received += chunk.toString();
            if (received.includes('connected')) {
              expect(received).toContain('Unknown Agent');
              res.destroy();
              resolve();
            }
          });
        });
        req.end();
      });
    });
  });

  describe('Investigation endpoints', () => {
    it('should investigate crashes', async () => {
      const { data } = await request(port, 'POST', '/api/investigate-crashes', { contextLines: 5, maxCrashes: 10 });
      expect(data.success).toBe(true);
      expect(data.crashes).toBeDefined();
      expect(data.count).toBe(1);
    });

    it('should investigate component', async () => {
      const { data } = await request(port, 'POST', '/api/investigate-component', { component: 'AuthModule' });
      expect(data.success).toBe(true);
      expect(data.component).toBe('AuthModule');
    });

    it('should require component for investigate-component', async () => {
      const { status, data } = await request(port, 'POST', '/api/investigate-component', {});
      expect(status).toBe(400);
      expect(data.error).toBe('component required');
    });

    it('should investigate timerange', async () => {
      const { data } = await request(port, 'POST', '/api/investigate-timerange', { startTime: '10:00', endTime: '11:00' });
      expect(data.success).toBe(true);
      expect(data.events).toBe(42);
    });

    it('should require startTime and endTime for investigate-timerange', async () => {
      const { status: s1, data: d1 } = await request(port, 'POST', '/api/investigate-timerange', { startTime: '10:00' });
      expect(s1).toBe(400);
      expect(d1.error).toBe('startTime and endTime required');

      const { status: s2, data: d2 } = await request(port, 'POST', '/api/investigate-timerange', { endTime: '11:00' });
      expect(s2).toBe(400);
      expect(d2.error).toBe('startTime and endTime required');
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
