import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { SearchOptions, Bookmark, Highlight, Annotation } from '../shared/types';
import { FileHandler } from './fileHandler';
import { type BaselineStore, buildFingerprint } from './baselineStore';
import { AnalysisResult } from './analyzers/types';
import { JournalEntry, buildTemplate, saveTemplate, listTemplates, getTemplate, deleteTemplate, resolveSteps } from './investigationStore';
import { bumpUsage, enterAiContext, exitAiContext } from './usageStore';
import { synthesizeConclusion, type ConclusionReport, type ConclusionGap, type ConclusionAnnotation, type ConclusionEvent } from './conclusion';

export const API_PORT = 19532;
const PORT_FILE = path.join(os.homedir(), '.logan', 'mcp-port');
const SESSION_FILE = path.join(os.homedir(), '.logan', 'agent-session.json');
const SESSION_MAX_MESSAGES = 100; // keep last 100 messages on disk

// --- Investigation journal (records the agent's investigative tool calls) ---
// Paths whose calls represent "investigative logic" worth capturing/replaying.
const INVESTIGATIVE_PATHS = new Set<string>([
  '/api/search', '/api/filter', '/api/clear-filter', '/api/analyze', '/api/time-gaps',
  '/api/trend-fields', '/api/trend-series', '/api/trend-transitions', '/api/trend-correlate',
  '/api/trend-show', '/api/investigate-crashes', '/api/investigate-component',
  '/api/investigate-timerange', '/api/triage', '/api/navigate', '/api/evidence-pack',
  '/api/build-conclusion',
]);
const JOURNAL_CAP = 200;
let agentJournal: JournalEntry[] = [];

// --- Usage Monitor (AI tap) ---
// Housekeeping / connection-management POST paths that are NOT real tool verbs;
// excluded from the per-feature usage counts. Everything else under /api/... is
// counted (as verb = path without the '/api/' prefix, operator = 'ai').
const USAGE_SKIP_PATHS = new Set<string>([
  '/api/status', '/api/agent-status', '/api/agent-register', '/api/agent-message',
  '/api/user-message', '/api/events', '/api/messages', '/api/shutdown',
  '/api/agent-memory', '/api/agent-memory-clear',
  '/api/investigation-log', '/api/investigation-clear',
]);

function journalLabel(p: string, body: Record<string, any>): string {
  const name = p.replace('/api/', '');
  if (p === '/api/search') return `search ${JSON.stringify(body.pattern ?? '')}`;
  if (p === '/api/filter') return `filter ${body.levels ? `levels=[${body.levels}]` : ''}${body.includePatterns ? ` include=${body.includePatterns}` : ''}`.trim();
  if (p === '/api/analyze') return `analyze${body.analyzerName ? ` (${body.analyzerName})` : ''}`;
  if (p === '/api/time-gaps') return `time-gaps ≥${body.thresholdSeconds ?? 30}s`;
  if (p.startsWith('/api/trend-')) return `${name} ${body.field ?? body.pattern ?? ''}`.trim();
  if (p === '/api/investigate-component') return `investigate component ${body.component ?? ''}`;
  if (p === '/api/triage') return `triage ${body.symptom ?? ''}`.trim();
  if (p === '/api/evidence-pack') return `evidence-pack${body.baselineId ? ' (vs baseline)' : ''}`;
  if (p === '/api/build-conclusion') return 'build-conclusion';
  return name;
}

function recordJournal(p: string, body: Record<string, any>): void {
  if (!INVESTIGATIVE_PATHS.has(p)) return;
  agentJournal.push({ path: p, body: { ...body }, ts: Date.now(), label: journalLabel(p, body) });
  if (agentJournal.length > JOURNAL_CAP) agentJournal = agentJournal.slice(-JOURNAL_CAP);
}

// Replay one step as an internal HTTP call to ourselves (reuses all endpoint
// logic, incl. finding-pinning). Marked so it is not itself re-journaled.
function replayStep(step: { path: string; body: Record<string, any> }): Promise<any> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(step.body || {});
    const req = http.request({
      hostname: '127.0.0.1', port: API_PORT, path: step.path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'x-logan-replay': '1' },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); } catch { resolve({ success: false }); } });
    });
    req.on('error', () => resolve({ success: false, error: 'replay request failed' }));
    req.write(payload); req.end();
  });
}

// Short per-step result summary for a replay run.
function summarizeReplay(p: string, r: any): string {
  if (!r || r.success === false) return r?.error || 'failed';
  if (p === '/api/search') return `${r.matches?.length ?? r.totalMatches ?? 0} matches`;
  if (p === '/api/filter') return `${r.filteredLines ?? r.lines?.length ?? 0} lines after filter`;
  if (p === '/api/analyze') return r.analysis?.summary || 'analyzed';
  if (p === '/api/time-gaps') return `${r.gaps?.length ?? 0} gaps`;
  if (p.startsWith('/api/trend')) return `${r.totalPoints ?? r.fields?.length ?? r.transitions?.length ?? 0} points/items`;
  return 'ok';
}

// --- Chat message queue & SSE ---
export interface ChatMessage {
  id: string;
  from: 'user' | 'agent';
  text: string;
  timestamp: number;
}

const chatMessages: ChatMessage[] = [];

// Persist session to disk (debounced)
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSessionSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const dir = path.dirname(SESSION_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const toSave = chatMessages.slice(-SESSION_MAX_MESSAGES);
      fs.writeFileSync(SESSION_FILE, JSON.stringify(toSave, null, 2));
    } catch { /* ignore */ }
  }, 1000);
}

// Load persisted session messages (called on startup)
export function loadPersistedSession(): void {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const saved: ChatMessage[] = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    if (!Array.isArray(saved)) return;
    // Only restore messages from the last 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = saved.filter(m => m.timestamp > cutoff);
    chatMessages.push(...recent);
  } catch { /* stale or invalid */ }
}

// Build a compact context string from recent messages for reconnect prompts
export function buildReconnectContext(maxMessages = 20, maxChars = 3000): string {
  if (chatMessages.length === 0) return '';
  const recent = chatMessages.slice(-maxMessages);
  let ctx = 'Previous conversation (reconnecting after interruption):\n---\n';
  for (const m of recent) {
    const label = m.from === 'user' ? 'User' : 'Agent';
    const text = m.text.length > 600 ? m.text.substring(0, 600) + '…' : m.text;
    ctx += `${label}: ${text}\n`;
  }
  ctx += '---\n';
  if (ctx.length > maxChars) {
    ctx = '…[earlier context omitted]\n' + ctx.substring(ctx.length - maxChars);
  }
  return ctx;
}

// Single-agent connection: one SSE client at a time (must supply a name)
let activeAgent: { res: http.ServerResponse; name: string } | null = null;

// Passive listeners (e.g. the MCP server) that receive chat events but do NOT
// count as a connected agent and do NOT affect the green-bulb status.
const chatListeners: Set<http.ServerResponse> = new Set();

// Polling agent heartbeat: tracks agents that call the API without SSE
let pollingAgent: { name: string; lastSeen: number } | null = null;
let pollingAgentTimer: ReturnType<typeof setInterval> | null = null;
const POLLING_AGENT_TIMEOUT = 300000; // 5 min without activity = disconnected

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

function notifyMemoryChanged(ctx: ApiContext): void {
  const win = ctx.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('agent-memory-changed', ctx.getAgentMemory());
  }
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

function broadcastSSE(msg: ChatMessage, ctx?: ApiContext): void {
  const data = `event: message\ndata: ${JSON.stringify(msg)}\n\n`;
  if (activeAgent) {
    try { activeAgent.res.write(data); } catch {
      activeAgent = null;
      if (ctx) notifyAgentConnectionChanged(ctx);
    }
  }
  for (const res of chatListeners) {
    try { res.write(data); } catch { chatListeners.delete(res); }
  }
}

// Push an "interrupt" signal to the connected agent (via the MCP server's SSE
// listener). The agent's next MCP tool call returns a STOP instruction so it
// aborts the current task and goes back to waiting — without killing the session.
export function broadcastInterrupt(): boolean {
  const data = `event: interrupt\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`;
  let delivered = false;
  if (activeAgent) {
    try { activeAgent.res.write(data); delivered = true; } catch { activeAgent = null; }
  }
  for (const res of chatListeners) {
    try { res.write(data); delivered = true; } catch { chatListeners.delete(res); }
  }
  return delivered;
}

// Heartbeat timer — SSE connections drop silently when idle without a periodic ping
let sseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startSseHeartbeat(ctx: ApiContext): void {
  if (sseHeartbeatTimer) return;
  sseHeartbeatTimer = setInterval(() => {
    const ping = ': ping\n\n'; // SSE comment, keeps TCP alive
    if (activeAgent) {
      try { activeAgent.res.write(ping); } catch {
        activeAgent = null;
        notifyAgentConnectionChanged(ctx);
      }
    }
    for (const res of chatListeners) {
      try { res.write(ping); } catch { chatListeners.delete(res); }
    }
  }, 20000); // every 20 seconds
}

export function addChatMessage(from: 'user' | 'agent', text: string): ChatMessage {
  const msg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    from,
    text,
    timestamp: Date.now(),
  };
  chatMessages.push(msg);
  scheduleSessionSave();
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
  getAgentMemory(): any;
  saveAgentMemory(content: string, agentName?: string): any;
  clearAgentMemory(): any;
  detectTimeGaps(options: any): Promise<any>;
  navigateToLine(lineNumber: number): void;
  getBaselineStore(): BaselineStore;
  getAnalysisResult(): AnalysisResult | null;
  getLinesRaw(startLine: number, count: number): any;
  investigateCrashes(options: { contextLines?: number; maxCrashes?: number; autoBookmark?: boolean; autoHighlight?: boolean }): Promise<any>;
  investigateComponent(options: { component: string; maxSamplesPerLevel?: number; includeErrorContext?: boolean; contextLines?: number }): Promise<any>;
  investigateTimerange(options: { startTime: string; endTime: string; maxSamples?: number }): Promise<any>;
  trendDiscoverFields(options: { startLine?: number; endLine?: number; sampleSize?: number }): Promise<any>;
  trendSeries(options: { field: string; startLine?: number; endLine?: number; bucketCount?: number; maxPoints?: number; pattern?: string; patternFlags?: string }): Promise<any>;
  trendTransitions(options: { field: string; startLine?: number; endLine?: number; maxTransitions?: number; pattern?: string; patternFlags?: string }): Promise<any>;
  trendCorrelate(options: { field: string; event: string; startLine?: number; endLine?: number; pattern?: string; patternFlags?: string }): Promise<any>;
  getAnnotations(): Map<string, Annotation>;
  addAnnotation(annotation: Annotation): any;
  removeAnnotation(id: string): any;
  clearAnnotations(): any;
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

// Options for the compact "evidence pack" briefing (see buildEvidencePack).
export interface EvidencePackOptions {
  thresholdSeconds?: number;
  topFields?: number;
  topGaps?: number;
  topComponents?: number;
  fieldSampleSize?: number;
  analyzerName?: string;
  baselineId?: string;
}

// Compose a compact "evidence pack" — one briefing (severity, level counts,
// grouped crashes, top failing components, top time gaps, discovered fields).
// Reuses existing primitives (analyze / time-gaps / trend-fields / baseline)
// in-process; returns counts + references (viewerLine), not raw log text.
// Shared by the /api/evidence-pack handler (AI path) and the EVIDENCE_PACK IPC
// (native "📋 Brief" button) — one implementation, no duplication.
export async function buildEvidencePack(
  ctx: ApiContext,
  opts: EvidencePackOptions = {}
): Promise<{ success: boolean; pack?: any; error?: string }> {
  const filePath = ctx.getCurrentFilePath();
  const handler = ctx.getFileHandler();
  if (!filePath || !handler) return { success: false, error: 'No file open' };
  const totalLines = handler.getTotalLines();

  const thresholdSeconds = opts.thresholdSeconds ?? 60;
  const topFieldsN = opts.topFields ?? 25;
  const topGapsN = opts.topGaps ?? 8;
  const topComponentsN = opts.topComponents ?? 10;

  // 1. Analysis (also caches getAnalysisResult() for the baseline step)
  const analysisResp = await ctx.analyze(opts.analyzerName);
  const aresult = analysisResp?.success ? analysisResp.result : (analysisResp?.result ?? null);
  const levelCounts = aresult?.levelCounts || {};
  const totalAnalyzed = aresult?.stats?.analyzedLines || totalLines;
  const errorCount = levelCounts['error'] || 0;
  const warningCount = levelCounts['warning'] || 0;
  const errorPercent = totalAnalyzed > 0 ? (errorCount / totalAnalyzed) * 100 : 0;
  const warningPercent = totalAnalyzed > 0 ? (warningCount / totalAnalyzed) * 100 : 0;
  const crashes = aresult?.insights?.crashes || [];
  const topFailingComponents = aresult?.insights?.topFailingComponents || [];
  const filterSuggestions = aresult?.insights?.filterSuggestions || [];

  // 2. Time gaps (top N, with 1-based viewerLine)
  const gapsResp = await ctx.detectTimeGaps({ thresholdSeconds });
  const allGaps = gapsResp?.success ? (gapsResp.gaps || []) : [];
  const timeGaps = allGaps.slice(0, topGapsN).map((g: any) => ({
    viewerLine: g.lineNumber + 1,
    gapSeconds: Math.round(g.gapSeconds),
    from: g.prevTimestamp,
    to: g.currTimestamp,
    preview: g.linePreview,
  }));

  // 3. Discovered fields (the agent's vocabulary) — top N by frequency
  const fieldsResp = await ctx.trendDiscoverFields({ sampleSize: opts.fieldSampleSize });
  const allFields = fieldsResp?.success ? (fieldsResp.fields || []) : [];
  const fields = allFields.slice(0, topFieldsN).map((f: any) => ({
    name: f.name, type: f.type, occurrences: f.occurrences,
    distinct: f.distinct, examples: f.examples,
  }));

  // Group crashes by keyword, keep first-occurrence viewerLine
  const crashGroups: Record<string, { keyword: string; count: number; viewerLine: number; sample: string }> = {};
  for (const c of crashes) {
    if (!crashGroups[c.keyword]) {
      crashGroups[c.keyword] = { keyword: c.keyword, count: 0, viewerLine: c.lineNumber + 1, sample: c.text };
    }
    crashGroups[c.keyword].count++;
  }

  // Severity + one-line summary (same rubric as logan_triage)
  let severity: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (crashes.length > 0 || errorPercent > 20) {
    severity = 'critical';
  } else if (errorPercent > 5 || timeGaps.some((g: any) => g.gapSeconds > 300) || topFailingComponents.length > 3) {
    severity = 'warning';
  }
  const parts = [`${totalLines.toLocaleString()} lines`];
  if (errorCount > 0) parts.push(`${errorCount.toLocaleString()} errors (${errorPercent.toFixed(1)}%)`);
  if (crashes.length > 0) parts.push(`${crashes.length} crashes`);
  if (allGaps.length > 0) parts.push(`${allGaps.length} time gaps`);
  if (allFields.length > 0) parts.push(`${allFields.length} fields`);

  // 4. Optional baseline delta (analysis just ran, so getAnalysisResult() is set)
  let baselineDelta: any = null;
  if (opts.baselineId) {
    const ar = ctx.getAnalysisResult();
    if (ar) {
      const fp = buildFingerprint(filePath, ar, handler);
      baselineDelta = ctx.getBaselineStore().compare(fp, opts.baselineId) || null;
    }
  }

  const pack = {
    file: { path: filePath, totalLines, timeRange: aresult?.timeRange || null },
    severity,
    summary: parts.join(', '),
    levels: {
      ...levelCounts,
      errorPercent: Math.round(errorPercent * 100) / 100,
      warningPercent: Math.round(warningPercent * 100) / 100,
    },
    crashes: Object.values(crashGroups),
    topComponents: topFailingComponents.slice(0, topComponentsN),
    timeGaps,
    fields,
    filterSuggestions: filterSuggestions.slice(0, 5),
    baselineDelta,
    caps: {
      fields: { shown: fields.length, total: allFields.length, truncated: allFields.length > fields.length },
      timeGaps: { shown: timeGaps.length, total: allGaps.length, truncated: allGaps.length > timeGaps.length },
      note: 'Compact briefing. Drill into any viewerLine with logan_get_lines; chart any field with logan_trend_show; pin issues with logan_report_finding.',
    },
  };
  return { success: true, pack };
}

// Options for the native root-cause conclusion (see buildConclusion).
export interface BuildConclusionOptions {
  thresholdSeconds?: number;
  analyzerName?: string;
}

// Compose the native root-cause "conclusion" — the AI-side counterpart to the
// human Conclusion panel. Assembles the same ingredients the panel uses:
//   • analysis (crashes, levels, failing components) — cached or freshly run,
//   • time gaps (native detector, default 10s threshold — matches the panel),
//   • pinned findings / annotations (the agent's or the human's),
// then calls the shared, deterministic synthesizeConclusion() to produce the
// verdict: first anomaly (the trigger), likely root cause, chronological
// timeline, and evidence. Returns the full ConclusionReport (no AI involved).
export async function buildConclusion(
  ctx: ApiContext,
  opts: BuildConclusionOptions = {}
): Promise<{ success: boolean; conclusion?: ConclusionReport; error?: string }> {
  const filePath = ctx.getCurrentFilePath();
  const handler = ctx.getFileHandler();
  if (!filePath || !handler) return { success: false, error: 'No file open' };
  const totalLines = handler.getTotalLines();

  // 1) Analysis — reuse the cached result if present, else run a full scan.
  let analysis = ctx.getAnalysisResult();
  if (!analysis) {
    const analysisResp = await ctx.analyze(opts.analyzerName);
    analysis = analysisResp?.success ? analysisResp.result : (analysisResp?.result ?? null);
  }

  // 2) Time gaps — 10s catches stalls without drowning in noise (panel default).
  const thresholdSeconds = opts.thresholdSeconds ?? 10;
  let gaps: ConclusionGap[] = [];
  try {
    const gapsResp = await ctx.detectTimeGaps({ thresholdSeconds });
    if (gapsResp?.success && Array.isArray(gapsResp.gaps)) gaps = gapsResp.gaps as ConclusionGap[];
  } catch { /* gaps optional */ }

  // 3) Pinned findings / annotations (agent or manual).
  const annotations: ConclusionAnnotation[] = Array.from(ctx.getAnnotations().values()).map((a) => ({
    lineNumber: a.lineNumber,
    severity: a.severity,
    text: a.text,
  }));

  // 4) Synthesize deterministically (shared with the human panel's logic).
  const conclusion = synthesizeConclusion(analysis, gaps, annotations, {
    sourceFilePath: filePath,
    totalLinesFallback: totalLines,
  });

  // Add 1-based viewerLine to every event so the AI pins findings on the same
  // line convention as every other tool (CLAUDE.md: pin using viewerLine). The
  // 0-based lineNumber is kept for the human panel's existing consumers.
  const withViewerLine = (e: ConclusionEvent | null): ConclusionEvent | null =>
    e ? { ...e, viewerLine: e.lineNumber + 1 } : e;
  conclusion.firstAnomaly = withViewerLine(conclusion.firstAnomaly);
  conclusion.rootCause = withViewerLine(conclusion.rootCause);
  conclusion.timeline = conclusion.timeline.map((e) => ({ ...e, viewerLine: e.lineNumber + 1 }));

  return { success: true, conclusion };
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
        if (url?.startsWith('/api/ping')) {
          const agentName = new URL(url, `http://127.0.0.1:${API_PORT}`).searchParams.get('name');
          if (agentName) touchPollingAgent(agentName, ctx);
          sendJson(res, { success: true });
          return;
        }

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

        if (url === '/api/annotations') {
          const anns = Array.from(ctx.getAnnotations().values())
            .sort((a, b) => a.lineNumber - b.lineNumber);
          sendJson(res, { success: true, annotations: anns });
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

        if (url === '/api/agent-memory') {
          const mem = ctx.getAgentMemory();
          sendJson(res, { success: true, memory: mem || null });
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
          const fullUrl = new URL(req.url || '/api/events', `http://${req.headers.host || 'localhost'}`);
          const agentName = fullUrl.searchParams.get('name') || '';

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          if (agentName) {
            // Real agent connection — shows green bulb, one at a time
            if (activeAgent) {
              sendJson(res, { success: false, error: 'Another agent is already connected', connectedAgent: activeAgent.name }, 409);
              return;
            }
            // Include any existing agent memory so the agent can resume context
            const memory = ctx.getAgentMemory();
            res.write(`event: connected\ndata: ${JSON.stringify({ name: agentName, memory: memory || null })}\n\n`);
            activeAgent = { res, name: agentName };
            notifyAgentConnectionChanged(ctx);
            req.on('close', () => {
              if (activeAgent?.res === res) { activeAgent = null; notifyAgentConnectionChanged(ctx); }
            });
          } else {
            // Passive listener (e.g. MCP server) — receives events, no bulb effect
            chatListeners.add(res);
            res.write(`event: connected\ndata: ${JSON.stringify({ name: 'listener' })}\n\n`);
            req.on('close', () => { chatListeners.delete(res); });
          }
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

        // Record investigative calls into the journal — unless this is a replay
        // (internal call from runTemplate), which would pollute the recording.
        if (req.headers['x-logan-replay'] !== '1') {
          recordJournal(url, body);
          // Usage Monitor: count every real AI tool call (verb = path minus
          // '/api/'). Skip replay + housekeeping paths. Fire-and-forget.
          if (url?.startsWith('/api/') && !USAGE_SKIP_PATHS.has(url)) {
            bumpUsage(url.replace('/api/', ''), 'ai');
          }
        }

        // Mark that an AI api-call is in flight for the whole dispatch body.
        // The ctx handlers below share the app's code paths (which call
        // logActivity → would otherwise record human::verb too). logActivity
        // consults isAiContext() and skips the human bump while set. The AI verb
        // is already counted by the tap above. Ref-counted; try/finally so every
        // return path (including sendError) restores the count.
        enterAiContext();
        try {

        // --- Investigation templates (capture → save → replay) ---
        if (url === '/api/investigation-log') {
          sendJson(res, { success: true, journal: agentJournal });
          return;
        }
        if (url === '/api/investigation-clear') {
          agentJournal = [];
          sendJson(res, { success: true });
          return;
        }
        if (url === '/api/investigation-save') {
          if (!body.name) return sendError(res, 'name required');
          if (agentJournal.length === 0) return sendError(res, 'Nothing to save — the agent has not run any investigative steps yet.');
          const tpl = buildTemplate(body.name, agentJournal, ctx.getCurrentFilePath() || undefined, body.description);
          saveTemplate(tpl);
          // Notify the renderer so the Investigate panel can refresh its list.
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: tpl });
          return;
        }
        if (url === '/api/investigations') {
          sendJson(res, { success: true, templates: listTemplates() });
          return;
        }
        if (url === '/api/investigation-delete') {
          const ok = deleteTemplate(body.name || body.slug || '');
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: ok });
          return;
        }
        if (url === '/api/investigation-run') {
          const tpl = getTemplate(body.name || body.slug || '');
          if (!tpl) return sendError(res, `No saved investigation named "${body.name || body.slug}"`);
          const steps = resolveSteps(tpl, body.params || {});
          const results: any[] = [];
          for (const step of steps) {
            const r = await replayStep(step);
            results.push({ step: step.label, path: step.path, ok: r?.success !== false, summary: summarizeReplay(step.path, r) });
          }
          sendJson(res, { success: true, ran: tpl.name, steps: results });
          return;
        }

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
          // Add viewerLine (1-based) so agents can use it in annotation/navigate calls
          if (result?.lines) {
            result.lines = result.lines.map((l: any) => ({ ...l, viewerLine: l.lineNumber + 1 }));
          }
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
          // Add viewerLine (1-based) to each match so agents use the right number
          if (result?.matches) {
            result.matches = result.matches.map((m: any) => ({ ...m, viewerLine: m.lineNumber + 1 }));
          }
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

        if (url === '/api/shutdown') {
          sendJson(res, { success: true });
          // Give response time to flush, then stop
          setTimeout(() => stopApiServer(), 100);
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

        // --- Agent Annotations ---
        if (url === '/api/annotate') {
          if (body.lineNumber === undefined || !body.text) return sendError(res, 'lineNumber and text required');
          const annotation: Annotation = {
            id: `ann-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            lineNumber: body.lineNumber,
            ...(body.endLine !== undefined ? { endLine: body.endLine } : {}),
            text: body.text,
            agentName: body.agentName || activeAgent?.name || 'Agent',
            timestamp: Date.now(),
            severity: body.severity || 'info',
          };
          const result = ctx.addAnnotation(annotation);
          sendJson(res, result);
          return;
        }

        if (url === '/api/annotation-remove') {
          if (!body.id) return sendError(res, 'id required');
          const result = ctx.removeAnnotation(body.id);
          sendJson(res, result);
          return;
        }

        if (url === '/api/annotation-clear') {
          const result = ctx.clearAnnotations();
          sendJson(res, result);
          return;
        }

        if (url === '/api/notes') {
          if (body.content === undefined) return sendError(res, 'content required');
          const result = await ctx.saveNotes(body.content);
          sendJson(res, result);
          return;
        }

        if (url === '/api/agent-memory') {
          if (body.content === undefined) return sendError(res, 'content required');
          const ok = ctx.saveAgentMemory(body.content, body.agentName || activeAgent?.name);
          notifyMemoryChanged(ctx);
          sendJson(res, { success: ok });
          return;
        }

        if (url === '/api/agent-memory-clear') {
          ctx.clearAgentMemory();
          notifyMemoryChanged(ctx);
          sendJson(res, { success: true });
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
          ctx.navigateToLine(body.lineNumber ?? 0);
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

        if (url === '/api/trend-fields') {
          const result = await ctx.trendDiscoverFields({
            startLine: body.startLine,
            endLine: body.endLine,
            sampleSize: body.sampleSize,
          });
          sendJson(res, result);
          return;
        }

        if (url === '/api/trend-series') {
          if (!body.field) return sendError(res, 'field required');
          const result = await ctx.trendSeries({
            field: body.field,
            startLine: body.startLine,
            endLine: body.endLine,
            bucketCount: body.bucketCount,
            maxPoints: body.maxPoints,
            pattern: body.pattern,
            patternFlags: body.patternFlags,
          });
          sendJson(res, result);
          return;
        }

        if (url === '/api/trend-transitions') {
          if (!body.field) return sendError(res, 'field required');
          const result = await ctx.trendTransitions({
            field: body.field,
            startLine: body.startLine,
            endLine: body.endLine,
            maxTransitions: body.maxTransitions,
            pattern: body.pattern,
            patternFlags: body.patternFlags,
          });
          sendJson(res, result);
          return;
        }

        if (url === '/api/trend-correlate') {
          if (!body.field || !body.event) return sendError(res, 'field and event required');
          const result = await ctx.trendCorrelate({
            field: body.field,
            event: body.event,
            startLine: body.startLine,
            endLine: body.endLine,
            pattern: body.pattern,
            patternFlags: body.patternFlags,
          });
          sendJson(res, result);
          return;
        }

        // Compute a trend AND render it as a cell in the Trends panel, so the agent
        // can build a vertical sequence of charts alongside the user's own cells.
        if (url === '/api/trend-show') {
          const type = body.type || 'series';
          if (!body.field && !body.pattern) return sendError(res, 'field or pattern required');
          const field = body.field || body.pattern;
          const common = { field, startLine: body.startLine, endLine: body.endLine, pattern: body.pattern, patternFlags: body.patternFlags };
          let result: any;
          if (type === 'transitions') {
            result = await ctx.trendTransitions({ ...common, maxTransitions: body.maxTransitions });
          } else if (type === 'correlate') {
            if (!body.event) return sendError(res, 'event required for correlate');
            result = await ctx.trendCorrelate({ ...common, event: body.event });
          } else {
            result = await ctx.trendSeries({ ...common, bucketCount: body.bucketCount, maxPoints: body.maxPoints });
          }
          const label = body.label || body.field || `/${body.pattern}/`;
          // Push the (unredacted) result to the renderer for display; the agent's
          // own text copy is redacted by the MCP layer separately.
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('agent-trend-cell', { type, label, result });
          }
          sendJson(res, result);
          return;
        }

        // Compose a compact "evidence pack" — one briefing the agent fetches
        // FIRST, instead of dozens of exploratory round-trips. Reuses existing
        // primitives (analyze / time-gaps / trend-fields / baseline) in-process;
        // returns counts + references (viewerLine), not raw log text.
        if (url === '/api/build-conclusion') {
          const result = await buildConclusion(ctx, {
            thresholdSeconds: body.thresholdSeconds,
            analyzerName: body.analyzerName,
          });
          if (!result.success) return sendError(res, result.error || 'No file open');
          sendJson(res, result);
          return;
        }

        if (url === '/api/evidence-pack') {
          const result = await buildEvidencePack(ctx, {
            thresholdSeconds: body.thresholdSeconds,
            topFields: body.topFields,
            topGaps: body.topGaps,
            topComponents: body.topComponents,
            fieldSampleSize: body.fieldSampleSize,
            analyzerName: body.analyzerName,
            baselineId: body.baselineId,
          });
          if (!result.success) return sendError(res, result.error || 'No file open');
          sendJson(res, result);
          return;
        }

        sendError(res, 'Not found', 404);
        return;

        } finally {
          exitAiContext();
        }
      }

      sendError(res, 'Method not allowed', 405);
    } catch (error) {
      sendError(res, String(error), 500);
    }
  });

  // Save request handler for potential retry
  const requestHandler = server.listeners('request')[0] as (...args: any[]) => void;

  const writePortFile = () => {
    try {
      const configDir = path.join(os.homedir(), '.logan');
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(PORT_FILE, String(API_PORT), 'utf-8');
    } catch (err) {
      console.error('Failed to write MCP port file:', err);
    }
  };

  const listenWithRetry = (srv: http.Server, isRetry: boolean) => {
    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && !isRetry) {
        console.log(`Port ${API_PORT} in use — requesting old instance to shut down...`);
        // Try graceful shutdown of old instance
        const shutdownReq = http.request(
          { hostname: '127.0.0.1', port: API_PORT, path: '/api/shutdown', method: 'POST', timeout: 2000 },
          () => {
            setTimeout(() => {
              server = http.createServer(requestHandler);
              listenWithRetry(server!, true);
              server!.listen(API_PORT, '127.0.0.1', () => {
                console.log(`LOGAN API server listening on http://127.0.0.1:${API_PORT}`);
                writePortFile();
              });
            }, 500);
          }
        );
        shutdownReq.on('error', () => {
          // Old instance not responding — force kill the process holding the port
          try {
            const { execSync } = require('child_process');
            let pid = '';
            if (process.platform === 'win32') {
              const out = execSync(`netstat -ano | findstr :${API_PORT} | findstr LISTENING`, { encoding: 'utf-8' }).trim();
              const match = out.split('\n')[0]?.trim().split(/\s+/).pop();
              if (match) pid = match;
            } else {
              pid = execSync(`lsof -ti:${API_PORT} 2>/dev/null`, { encoding: 'utf-8' }).trim();
            }
            if (pid) {
              console.log(`Killing old process ${pid} on port ${API_PORT}`);
              process.kill(parseInt(pid), 'SIGTERM');
              setTimeout(() => {
                server = http.createServer(requestHandler);
                listenWithRetry(server!, true);
                server!.listen(API_PORT, '127.0.0.1', () => {
                  console.log(`LOGAN API server listening on http://127.0.0.1:${API_PORT}`);
                  writePortFile();
                });
              }, 500);
            }
          } catch {
            console.error(`LOGAN API port ${API_PORT} already in use — MCP bridge disabled`);
          }
        });
        shutdownReq.end();
      } else {
        console.error(`LOGAN API server error: ${err.message}`);
      }
    });
  };

  listenWithRetry(server, false);
  server.listen(API_PORT, '127.0.0.1', () => {
    console.log(`LOGAN API server listening on http://127.0.0.1:${API_PORT}`);
    writePortFile();
    startSseHeartbeat(ctx);
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
