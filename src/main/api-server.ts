import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { SearchOptions, Bookmark, Highlight } from '../shared/types';
import { FileHandler } from './fileHandler';
import { type BaselineStore, buildFingerprint } from './baselineStore';
import { AnalysisResult } from './analyzers/types';

const API_PORT = 19532;
const PORT_FILE = path.join(os.homedir(), '.logan', 'mcp-port');

// --- Chat message queue & SSE ---
export interface ChatMessage {
  id: string;
  from: 'user' | 'agent';
  text: string;
  timestamp: number;
}

const chatMessages: ChatMessage[] = [];

// Single-agent connection: one SSE client at a time
let activeAgent: { res: http.ServerResponse; name: string } | null = null;

// Polling agent heartbeat: tracks agents that call the API without SSE
let pollingAgent: { name: string; lastSeen: number } | null = null;
let pollingAgentTimer: ReturnType<typeof setInterval> | null = null;
const POLLING_AGENT_TIMEOUT = 30000; // 30s without activity = disconnected

function touchPollingAgent(name: string, ctx: ApiContext): void {
  const wasConnected = isAgentConnected();
  pollingAgent = { name, lastSeen: Date.now() };
  if (!wasConnected) notifyAgentConnectionChanged(ctx);

  // Start expiry check if not running
  if (!pollingAgentTimer) {
    pollingAgentTimer = setInterval(() => {
      if (pollingAgent && Date.now() - pollingAgent.lastSeen > POLLING_AGENT_TIMEOUT) {
        pollingAgent = null;
        if (!activeAgent) notifyAgentConnectionChanged(ctx);
        if (pollingAgentTimer) { clearInterval(pollingAgentTimer); pollingAgentTimer = null; }
      }
    }, 5000);
  }
}

function isAgentConnected(): boolean {
  return activeAgent !== null || (pollingAgent !== null && Date.now() - pollingAgent.lastSeen <= POLLING_AGENT_TIMEOUT);
}

function getConnectedAgentName(): string | null {
  if (activeAgent) return activeAgent.name;
  if (pollingAgent && Date.now() - pollingAgent.lastSeen <= POLLING_AGENT_TIMEOUT) return pollingAgent.name;
  return null;
}

export function getSseClientCount(): number {
  return isAgentConnected() ? 1 : 0;
}

export function getAgentName(): string | null {
  return getConnectedAgentName();
}

function notifyAgentConnectionChanged(ctx: ApiContext): void {
  const connected = isAgentConnected();
  const name = getConnectedAgentName();
  const win = ctx.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('agent-connection-changed', {
      connected,
      count: connected ? 1 : 0,
      name,
    });
  }
}

function broadcastSSE(msg: ChatMessage): void {
  if (!activeAgent) return;
  const data = `event: message\ndata: ${JSON.stringify(msg)}\n\n`;
  try { activeAgent.res.write(data); } catch { activeAgent = null; }
}

export function addChatMessage(from: 'user' | 'agent', text: string): ChatMessage {
  const msg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    from,
    text,
    timestamp: Date.now(),
  };
  chatMessages.push(msg);
  broadcastSSE(msg);
  return msg;
}

export function getChatMessages(since?: number): ChatMessage[] {
  if (since) return chatMessages.filter(m => m.timestamp > since);
  return [...chatMessages];
}

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
  getBaselineStore(): BaselineStore;
  getAnalysisResult(): AnalysisResult | null;
  getLinesRaw(startLine: number, count: number): any;
  investigateCrashes(options: { contextLines?: number; maxCrashes?: number; autoBookmark?: boolean; autoHighlight?: boolean }): Promise<any>;
  investigateComponent(options: { component: string; maxSamplesPerLevel?: number; includeErrorContext?: boolean; contextLines?: number }): Promise<any>;
  investigateTimerange(options: { startTime: string; endTime: string; maxSamples?: number }): Promise<any>;
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

        if (url === '/api/notes') {
          const result = await ctx.loadNotes();
          sendJson(res, result);
          return;
        }

        if (url === '/api/agent-status') {
          sendJson(res, {
            success: true,
            connected: isAgentConnected(),
            count: isAgentConnected() ? 1 : 0,
            name: getConnectedAgentName(),
          });
          return;
        }

        if (url === '/api/events' || (req.url || '').startsWith('/api/events?')) {
          // Enforce single agent connection
          if (activeAgent) {
            sendJson(res, { success: false, error: 'Another agent is already connected', connectedAgent: activeAgent.name }, 409);
            return;
          }

          // Parse agent name from query string
          const fullUrl = new URL(req.url || '/api/events', `http://${req.headers.host || 'localhost'}`);
          const agentName = fullUrl.searchParams.get('name') || 'Unknown Agent';

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.write(`event: connected\ndata: ${JSON.stringify({ name: agentName })}\n\n`);
          activeAgent = { res, name: agentName };
          notifyAgentConnectionChanged(ctx);
          req.on('close', () => {
            if (activeAgent?.res === res) activeAgent = null;
            notifyAgentConnectionChanged(ctx);
          });
          return; // keep connection open
        }

        if (url === '/api/messages' || url?.startsWith('/api/messages?')) {
          const urlObj = new URL(url, `http://127.0.0.1:${API_PORT}`);
          const sinceStr = urlObj.searchParams.get('since');
          const since = sinceStr ? parseInt(sinceStr, 10) : undefined;
          const messages = getChatMessages(since);
          sendJson(res, { success: true, messages });
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

        if (url === '/api/bookmark-remove') {
          if (!body.id) return sendError(res, 'id required');
          const result = ctx.removeBookmark(body.id);
          sendJson(res, result);
          return;
        }

        if (url === '/api/bookmark-update') {
          if (!body.id) return sendError(res, 'id required');
          const existing = ctx.getBookmarks().get(body.id);
          if (!existing) return sendError(res, 'Bookmark not found');
          const updated: Bookmark = {
            ...existing,
            label: body.label ?? existing.label,
            color: body.color ?? existing.color,
          };
          const result = ctx.updateBookmark(updated);
          sendJson(res, result);
          return;
        }

        if (url === '/api/bookmark-clear') {
          const result = ctx.clearBookmarks();
          sendJson(res, result);
          return;
        }

        if (url === '/api/highlight-remove') {
          if (!body.id) return sendError(res, 'id required');
          const result = ctx.removeHighlight(body.id);
          sendJson(res, result);
          return;
        }

        if (url === '/api/highlight-update') {
          if (!body.id) return sendError(res, 'id required');
          const existing = ctx.getHighlights().get(body.id);
          if (!existing) return sendError(res, 'Highlight not found');
          const updated: Highlight = {
            ...existing,
            pattern: body.pattern ?? existing.pattern,
            backgroundColor: body.backgroundColor ?? existing.backgroundColor,
            textColor: body.textColor !== undefined ? body.textColor : existing.textColor,
          };
          const result = ctx.updateHighlight(updated);
          sendJson(res, result);
          return;
        }

        if (url === '/api/highlight-clear') {
          const result = ctx.clearHighlights();
          sendJson(res, result);
          return;
        }

        if (url === '/api/notes') {
          if (body.content === undefined) return sendError(res, 'content required');
          const result = await ctx.saveNotes(body.content);
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

        if (url === '/api/user-message') {
          if (!body.message) return sendError(res, 'message required');
          const msg = addChatMessage('user', body.message);
          sendJson(res, { success: true, message: msg });
          return;
        }

        if (url === '/api/agent-register') {
          const name = body.name || 'Unknown Agent';
          touchPollingAgent(name, ctx);
          sendJson(res, { success: true, name });
          return;
        }

        if (url === '/api/agent-message') {
          if (!body.message) return sendError(res, 'message required');
          // Touch polling agent heartbeat if no SSE agent connected
          if (!activeAgent) {
            touchPollingAgent(body.name || 'Agent', ctx);
          }
          const msg = addChatMessage('agent', body.message);
          // Push to renderer via main window
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('agent-message', msg);
          }
          sendJson(res, { success: true, message: msg });
          return;
        }

        if (url === '/api/investigate-crashes') {
          const result = await ctx.investigateCrashes({
            contextLines: body.contextLines,
            maxCrashes: body.maxCrashes,
            autoBookmark: body.autoBookmark,
            autoHighlight: body.autoHighlight,
          });
          sendJson(res, result);
          return;
        }

        if (url === '/api/investigate-component') {
          if (!body.component) return sendError(res, 'component required');
          const result = await ctx.investigateComponent({
            component: body.component,
            maxSamplesPerLevel: body.maxSamplesPerLevel,
            includeErrorContext: body.includeErrorContext,
            contextLines: body.contextLines,
          });
          sendJson(res, result);
          return;
        }

        if (url === '/api/investigate-timerange') {
          if (!body.startTime || !body.endTime) return sendError(res, 'startTime and endTime required');
          const result = await ctx.investigateTimerange({
            startTime: body.startTime,
            endTime: body.endTime,
            maxSamples: body.maxSamples,
          });
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
