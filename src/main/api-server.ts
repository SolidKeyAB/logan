import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { SearchOptions, Bookmark, Highlight, Annotation, ScopeDescriptor, ResolvedScope } from '../shared/types';
import { FileHandler } from './fileHandler';
import { type BaselineStore, buildFingerprint } from './baselineStore';
import { factsToPlain } from './contextManifest';
import { AnalysisResult } from './analyzers/types';
import { JournalEntry, InvestigationTemplate, TemplateStep, buildTemplate, saveTemplate, listTemplates, getTemplate, deleteTemplate, resolveSteps, setTemplateParams, resolveTier, slugify } from './investigationStore';
import { resolveAnswerStep, outputLabelForPath, deriveAnswerValue, AnswerValue } from '../shared/recipeOutputs';
import { evaluateGuard, describeGuard, normalizeGuard, isCompositeStep, compositeTarget, COMPOSITE_STEP_PATH } from '../shared/recipeComposition';
import { investigationToGraph } from './workflowGraph';
import { listSequences, saveSequence, appendClue, deleteSequence } from './sequenceStore';
import { evaluateRequirements, suggestRequirements, mergeRequirements, RequirementCheckContext, EntityRef } from './investigationRequirements';
import { EntityDescriptor, toDescriptors } from './entityRegistry';
import { pickAdapter } from './sourceAdapter';
import { bumpUsage, enterAiContext, exitAiContext } from './usageStore';
import { saveConstant, getConstants, deleteConstant } from './constantsStore';
import { loadColumnLayouts, upsertColumnLayout, deleteColumnLayout } from './columnLayoutsStore';
import { canonicalizeAiVerb } from '../shared/verbRegistry';
import { compilePattern, CompileInput } from './compilePattern';
import { logPattern } from './patternLog';
import { synthesizeConclusion, type ConclusionReport, type ConclusionGap, type ConclusionAnnotation, type ConclusionEvent } from './conclusion';
import { buildReportMarkdown, reportFileName, type ReportFinding, type ReportLogLine, type ReportStep, type ReportComponent } from './reportDoc';

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
  '/api/build-conclusion', '/api/summarize', '/api/fold-regions', '/api/diff-runs',
]);
const JOURNAL_CAP = 200;
// A composite recipe recurses (its steps run sub-recipes, which may themselves be composite).
// Cap the nesting to break a self-referential recipe before it loops forever.
const MAX_COMPOSE_DEPTH = 8;
let agentJournal: JournalEntry[] = [];
// Distinct files touched during the CURRENT recording (same lifecycle as agentJournal):
// accumulates the current file each time an investigative call is journaled, so a saved
// recipe records every file/type it was built on. Reset when the journal is cleared.
let journalFiles: string[] = [];

// --- Usage Monitor (AI tap) ---
// Housekeeping / connection-management POST paths that are NOT real tool verbs;
// excluded from the per-feature usage counts. Everything else under /api/... is
// counted (as verb = path without the '/api/' prefix, operator = 'ai').
const USAGE_SKIP_PATHS = new Set<string>([
  '/api/status', '/api/agent-status', '/api/agent-register', '/api/agent-message',
  '/api/user-message', '/api/events', '/api/messages', '/api/shutdown',
  '/api/agent-memory', '/api/agent-memory-clear',
  '/api/investigation-log', '/api/investigation-clear',
  '/api/investigation-check', '/api/investigation-suggest-requirements', '/api/investigation-set-requirements',
  '/api/workflow-show',   // introspection (journal → graph), not a log-investigation verb
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
  if (p === '/api/summarize') return `summarize${body.opts?.contains ? ` ~"${body.opts.contains}"` : ''}`;
  if (p === '/api/fold-regions') return 'fold-regions';
  if (p === '/api/diff-runs') return `diff-runs vs ${String(body.reference ?? '').split(/[\\/]/).pop() || ''}`.trim();
  return name;
}

// Build 2: after a recorded investigative call responds, capture a compact result
// summary onto its journal entry. recordJournal returns the entry; the dispatch site
// maps it to the response object here, and sendJson fills in `.result` when it fires.
const resultPendingByRes = new WeakMap<http.ServerResponse, JournalEntry>();

function recordJournal(p: string, body: Record<string, any>): JournalEntry | null {
  if (!INVESTIGATIVE_PATHS.has(p)) return null;
  const entry: JournalEntry = { path: p, body: { ...body }, ts: Date.now(), label: journalLabel(p, body) };
  agentJournal.push(entry);
  if (agentJournal.length > JOURNAL_CAP) agentJournal = agentJournal.slice(-JOURNAL_CAP);
  return entry;
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
  if (p === '/api/investigate-component') {
    if (r.found === false) return 'not found';
    const err = r.levelBreakdown?.error ? `, ${r.levelBreakdown.error} err` : '';
    return `${r.totalMentions ?? 0} mentions${err}`;
  }
  if (p === '/api/fold-regions') return `${r.regions?.length ?? 0} repeat regions`;
  if (p === '/api/evidence-pack') return r.pack?.severity ? `${r.pack.severity}` : 'brief';
  if (p === '/api/investigate-crashes') return `${r.crashes?.length ?? r.groups?.length ?? 0} crash groups`;
  if (p === '/api/diff-runs') return r.diff ? `${r.diff.summary?.onlyInTarget ?? 0} new / ${r.diff.summary?.changed ?? 0} changed templates` : 'diffed';
  if (p === COMPOSITE_STEP_PATH) {
    if (r.blocked) return `↳ ${r.ran || 'sub-recipe'} blocked (requirements)`;
    const a = r.answer;
    return a ? `↳ ${r.ran}: ${a.summary || a.output || 'ran'}` : `↳ ${r.ran || 'sub-recipe'} ran`;
  }
  return 'ok';
}

// Build the live-file context an investigation's requirements are evaluated against:
// the current file path, its format adapter id, a sample of its lines, and resolvers
// that look saved entities (column layouts) up on disk. Kept here (not in the pure
// evaluator module) because it reaches into Electron/API state.
function buildRequirementContext(ctx: ApiContext, sampleCount = 200): RequirementCheckContext {
  const filePath = ctx.getCurrentFilePath();
  let adapterId: string | null = null;
  if (filePath) {
    try { adapterId = pickAdapter(filePath).id; } catch { adapterId = null; }
  }
  let sampleLines: string[] = [];
  try {
    const raw = ctx.getLinesRaw(0, sampleCount);
    if (raw && Array.isArray(raw.lines)) {
      sampleLines = raw.lines.map((l: any) => (typeof l?.text === 'string' ? l.text : String(l ?? '')));
    }
  } catch { /* no file open / read error → empty samples (checks report unsatisfied) */ }
  return {
    filePath,
    adapterId,
    sampleLines,
    resolveColumnPattern: (ref) => {
      const hit = loadColumnLayouts().find(l => (ref.id && l.id === ref.id) || (ref.name && l.name === ref.name));
      if (hit && hit.pattern && hit.pattern.regex) {
        return {
          regex: hit.pattern.regex,
          flags: hit.pattern.flags || '',
          fields: hit.pattern.fields || [],
          named: /\(\?<[A-Za-z_]/.test(hit.pattern.regex),
        };
      }
      return null;
    },
    // Entity existence is delegated to index.ts (it holds every saved-entity store);
    // unresolvable kinds come back null → reported 'unverified' (never a false negative).
    resolveEntity: (ref: EntityRef) => ctx.resolveSavedEntity(ref),
  };
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
  // The current view's read/search handler — the active "single session" composite when
  // one is open, else the current file's FileHandler. Only read-shape methods are
  // guaranteed (getLines/getLinesAsync/getLinesByNumbers/search/getTotalLines/getFileInfo).
  getReadHandler(): Pick<FileHandler, 'getLines' | 'getLinesAsync' | 'getLinesByNumbers' | 'search' | 'getTotalLines' | 'getFileInfo' | 'getMaxLineLength'> | null;
  getFileHandlerForPath(filePath: string): FileHandler | null;
  getFilteredLines(): number[] | null;
  resolveScope(scope?: ScopeDescriptor): ResolvedScope;
  getBookmarks(): Map<string, Bookmark>;
  getHighlights(): Map<string, Highlight>;
  openFile(filePath: string): Promise<any>;
  openFolder(folderPath: string): Promise<any>;
  getLines(startLine: number, count: number): any;
  search(options: SearchOptions & { scope?: ScopeDescriptor }): Promise<any>;
  analyze(analyzerName?: string, scope?: ScopeDescriptor): Promise<any>;
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
  // Write an agent-authored report doc into the log's .logan/reports/ (read-only
  // fallback to ~/.logan/reports/<basename>/). Shared by /api/save-report.
  saveReport(fileName: string, content: string): Promise<{ success: boolean; filePath?: string; error?: string }>;
  getAgentMemory(): any;
  saveAgentMemory(content: string, agentName?: string): any;
  clearAgentMemory(): any;
  // Static-env context manifest (per-file sidecar). read = the current manifest;
  // attach = merge a key→value patch (or replace); clear = drop it. The facts are
  // injected into evidence_pack / save_report / the baseline fingerprint.
  getContextManifest(): any;
  attachContextManifest(patch: Record<string, string>, opts?: { provenance?: Record<string, string>; source?: string; replace?: boolean; agentName?: string }): { success: boolean; manifest?: any; facts?: number };
  clearContextManifest(): { success: boolean };
  detectTimeGaps(options: any): Promise<any>;
  // Semantic compression: fold the (scoped) log into its distinct message templates.
  summarize(opts?: { maxTemplates?: number; maxExamples?: number; detectSeverity?: boolean; detectTimestamp?: boolean; contains?: string }, scope?: ScopeDescriptor): Promise<any>;
  // In-place viewer folding: detect contiguous repeating blocks (line spans + ×count).
  foldRegions(opts?: { maxPeriod?: number; minRepeats?: number; tolerance?: number; minHidden?: number }): Promise<any>;
  navigateToLine(lineNumber: number): void;
  getBaselineStore(): BaselineStore;
  getAnalysisResult(): AnalysisResult | null;
  getLinesRaw(startLine: number, count: number): any;
  // Best-effort existence check for a referenced saved entity (search/filter/highlight/
  // bookmark/columnLayout/columnPattern/session/constant/trendProperty/pattern). Returns
  // null when the kind can't be resolved (→ reported 'unverified', never a false negative).
  resolveSavedEntity(ref: { kind: string; id?: string; name?: string }): { present: boolean; applied?: boolean } | null;
  // The Entity Registry read model: a uniform catalog of every saved/reusable entity this
  // process owns (all kinds except investigations, which /api/entities appends itself).
  listSavedEntities(kind?: string): EntityDescriptor[];
  // Apply a saved LENS entity (filter/highlightGroup/columnLayout/session) to the open view —
  // the agent-parity write-half of listSavedEntities (reuses the human applySavedEntity).
  applyEntityRef(ref: { kind: string; id?: string; name?: string }): { success: boolean; applied?: boolean; entity?: any; error?: string };
  investigateCrashes(options: { contextLines?: number; maxCrashes?: number; autoBookmark?: boolean; autoHighlight?: boolean }): Promise<any>;
  investigateComponent(options: { component: string; maxSamplesPerLevel?: number; includeErrorContext?: boolean; contextLines?: number }): Promise<any>;
  investigateTimerange(options: { startTime: string; endTime: string; maxSamples?: number }): Promise<any>;
  trendDiscoverFields(options: { startLine?: number; endLine?: number; sampleSize?: number }): Promise<any>;
  trendSeries(options: { field: string; startLine?: number; endLine?: number; bucketCount?: number; maxPoints?: number; pattern?: string; patternFlags?: string }): Promise<any>;
  trendTransitions(options: { field: string; startLine?: number; endLine?: number; maxTransitions?: number; pattern?: string; patternFlags?: string }): Promise<any>;
  trendCorrelate(options: { field: string; event: string; startLine?: number; endLine?: number; pattern?: string; patternFlags?: string }): Promise<any>;
  // Build a "single session" composite from an ordered file-set and open it (agent parity
  // for the human 🔗 button). Shares buildComposite + autoSaveSingleSession with the human path.
  createComposite(filePaths: string[], label?: string): Promise<{ success: boolean; id?: string; info?: any; boundaries?: any[]; error?: string }>;
  // Wall-clock interleave of N files → a materialized merged .log, opened as active.
  mergeTimeline(filePaths: string[], label?: string): Promise<{ success: boolean; filePath?: string; info?: any; lineCount?: number; fileCount?: number; skipped?: string[]; collectCapped?: boolean; scanCapped?: boolean; from?: string; to?: string; error?: string }>;
  // Run-vs-run TEMPLATE diff: fold the active file (target) and a reference log (by path,
  // opened on demand) into message templates and set-diff them (onlyInTarget / onlyInReference
  // / changed). The multi-log "differential", beyond fingerprint baseline_compare.
  diffRuns(referencePath: string, opts?: { scope?: ScopeDescriptor; maxTemplates?: number; maxExamples?: number; minCount?: number; changeFactor?: number; topN?: number }): Promise<{ success: boolean; reference?: any; target?: any; diff?: any; error?: string }>;
  getAnnotations(): Map<string, Annotation>;
  addAnnotation(annotation: Annotation): any;
  addAnnotations(annotations: Annotation[]): any;
  updateAnnotation(id: string, patch: Partial<Annotation>): any;
  removeAnnotation(id: string): any;
  clearAnnotations(): any;
  clearHandoff(handoffId: string): any;
  extractFilteredToFile(opts?: { includeLineNumbers?: boolean; columnConfig?: any }): Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }>;
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
  // Build 2: attach a compact result summary to this call's journal entry, if any.
  const pending = resultPendingByRes.get(res);
  if (pending) { resultPendingByRes.delete(res); try { pending.result = summarizeReplay(pending.path, data); } catch { /* ignore */ } }
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
  scope?: ScopeDescriptor;
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

  // Static environment attached to this log (build/firmware/flags/config) — so the agent
  // sees the "what was this system" context up front, and the baseline delta below is
  // fingerprinted against it.
  const envFacts = factsToPlain(ctx.getContextManifest());
  const hasEnv = Object.keys(envFacts).length > 0;

  const thresholdSeconds = opts.thresholdSeconds ?? 60;
  const topFieldsN = opts.topFields ?? 25;
  const topGapsN = opts.topGaps ?? 8;
  const topComponentsN = opts.topComponents ?? 10;

  // Resolve the scope once — every sub-step below runs inside it. Field discovery
  // consumes a range, so an index-set scope is approximated by its bounding range.
  const scoped = !!opts.scope && opts.scope.type !== 'all';
  const resolvedScope: ResolvedScope = ctx.resolveScope(opts.scope);
  const fieldBounds = scoped
    ? (resolvedScope.kind === 'range'
        ? { startLine: resolvedScope.startLine, endLine: resolvedScope.endLine }
        : (resolvedScope.lines.length
            ? { startLine: resolvedScope.lines[0], endLine: resolvedScope.lines[resolvedScope.lines.length - 1] }
            : { startLine: 0, endLine: -1 }))
    : {};

  // 1. Analysis (also caches getAnalysisResult() for the baseline step)
  const analysisResp = await ctx.analyze(opts.analyzerName, opts.scope);
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
  const gapsResp = await ctx.detectTimeGaps({ thresholdSeconds, scope: opts.scope });
  const allGaps = gapsResp?.success ? (gapsResp.gaps || []) : [];
  const timeGaps = allGaps.slice(0, topGapsN).map((g: any) => ({
    viewerLine: g.lineNumber + 1,
    gapSeconds: Math.round(g.gapSeconds),
    from: g.prevTimestamp,
    to: g.currTimestamp,
    preview: g.linePreview,
  }));

  // 3. Discovered fields (the agent's vocabulary) — top N by frequency
  const fieldsResp = await ctx.trendDiscoverFields({ sampleSize: opts.fieldSampleSize, ...fieldBounds });
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
      const fp = buildFingerprint(filePath, ar, handler, envFacts);
      baselineDelta = ctx.getBaselineStore().compare(fp, opts.baselineId) || null;
    }
  }

  const pack = {
    file: { path: filePath, totalLines, timeRange: aresult?.timeRange || null },
    ...(hasEnv ? { env: envFacts } : {}),
    scope: analysisResp?.scope,
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
          const handler = ctx.getReadHandler();
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

        if (url === '/api/context-manifest') {
          const manifest = ctx.getContextManifest();
          sendJson(res, { success: true, manifest: manifest || null });
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
          const journaled = recordJournal(url, body);
          if (journaled) {
            resultPendingByRes.set(res, journaled); // fill .result at sendJson
            // Track every DISTINCT file the recorded steps ran against, so a saved recipe
            // shows which file(s)/type(s) it was built on (esp. a multi-file investigation).
            const fp = ctx.getCurrentFilePath();
            if (fp && !journalFiles.includes(fp)) journalFiles.push(fp);
          }
          // Usage Monitor: count every real AI tool call (verb = path minus
          // '/api/'). Skip replay + housekeeping paths. Fire-and-forget.
          if (url?.startsWith('/api/') && !USAGE_SKIP_PATHS.has(url)) {
            bumpUsage(canonicalizeAiVerb(url.replace('/api/', '')), 'ai');
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
          journalFiles = [];
          sendJson(res, { success: true });
          return;
        }
        // Workflow Canvas Phase 1 — project a hunt into the typed WorkflowGraph model
        // (workflowGraph.ts). Source = a named saved investigation (its steps +
        // requirements) or, by default, the agent's current session journal. Read-only
        // introspection; a Workflow is a PROJECTION of the investigation entity (no new
        // store). The visual step-list/canvas is Phase 2.
        if (url === '/api/workflow-show') {
          const name = body.investigation || body.name || body.slug;
          if (name) {
            const tpl = getTemplate(name);
            if (!tpl) return sendError(res, `No saved investigation named "${name}"`);
            const graph = investigationToGraph(tpl.steps, tpl.requirements);
            sendJson(res, { success: true, graph, source: { kind: 'investigation', name: tpl.name } });
          } else {
            const graph = investigationToGraph(agentJournal);
            sendJson(res, { success: true, graph, source: { kind: 'journal', steps: agentJournal.length } });
          }
          return;
        }
        if (url === '/api/investigation-save') {
          if (!body.name) return sendError(res, 'name required');
          // Aim is REQUIRED — a recipe must say what it is FOR, or a growing list of them
          // is unreadable (you can't tell one hunt from another). Gate every save here so
          // both operators (human "Save current" IPC + agent MCP) are covered by one rule.
          const aim = typeof body.aim === 'string' ? body.aim.trim() : '';
          if (!aim) return sendError(res, 'An aim is required — say what this recipe is for (e.g. "find the root-cause component of the 401 storm"). Without an aim, the recipe list becomes unreadable as it grows.');
          if (agentJournal.length === 0) return sendError(res, 'Nothing to save — the agent has not run any investigative steps yet.');
          let requirements = body.requirements;
          if (body.autoDetect) {
            const fp = ctx.getCurrentFilePath();
            const suggested = suggestRequirements({ filePath: fp, adapterId: fp ? pickAdapter(fp).id : null });
            requirements = mergeRequirements(requirements, suggested);
          }
          const tpl = buildTemplate(body.name, agentJournal, ctx.getCurrentFilePath() || undefined, body.description, requirements, aim, journalFiles.slice());
          saveTemplate(tpl);
          // Notify the renderer so the Investigate panel can refresh its list.
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: tpl });
          return;
        }
        if (url === '/api/investigations') {
          // Attach the EFFECTIVE tier (explicit or smart default) so both operators —
          // the renderer's grouped view and the agent via logan_list_investigations —
          // see fundamental-vs-complex without re-deriving it.
          const templates = listTemplates().map((t) => ({ ...t, tierEffective: resolveTier(t) }));
          sendJson(res, { success: true, templates });
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
          // Composite recipes recurse (a step runs a sub-recipe). Cap the nesting so a
          // self-referential recipe can't loop forever; depth is threaded through the body.
          const depth = Number(body._depth) || 0;
          if (depth > MAX_COMPOSE_DEPTH) return sendError(res, `Composite recursion too deep (>${MAX_COMPOSE_DEPTH}) — a recipe likely references itself. Aborting to avoid a loop.`);
          // Preflight: does the CURRENT log satisfy this investigation's requirements
          // (e.g. must be in a given column template / format)? A file-template mismatch
          // blocks the replay unless the caller passes force:true.
          const requirements = evaluateRequirements(tpl.requirements, buildRequirementContext(ctx));
          if (requirements.blocked && !body.force) {
            sendJson(res, {
              success: true, ran: null, blocked: true, requirements,
              message: `Replay blocked: this log does not match "${tpl.name}"'s required template. ${requirements.summary} Pass force:true to run anyway.`,
            });
            return;
          }
          // P1 "outfit": honor autoApply refs — dress the log in the recipe's saved LENSES
          // (filter / highlight / columns / session) BEFORE the steps run, via the shared
          // apply-engine (the same action as the human ▶ Apply). Non-lens refs are skipped.
          const AUTO_LENS: Record<string, string> = {
            filter: 'filter', highlight: 'highlightGroup', highlightGroup: 'highlightGroup',
            columnLayout: 'columnLayout', session: 'session',
          };
          const appliedLenses: any[] = [];
          for (const ref of (tpl.requirements?.entities || [])) {
            if (!ref || !ref.autoApply) continue;
            const kind = AUTO_LENS[ref.kind as string];
            if (!kind) { appliedLenses.push({ kind: ref.kind, name: ref.name || ref.id, applied: false, reason: 'not an applyable lens' }); continue; }
            const ar = ctx.applyEntityRef({ kind, id: ref.id, name: ref.name });
            appliedLenses.push({ kind, name: ref.name || ref.id, applied: !!ar.success, ...(ar.success ? {} : { reason: ar.error }) });
          }

          const steps = resolveSteps(tpl, body.params || {});
          // Live per-step progress → the renderer's template popup lights each step green
          // (red on failure) as it runs, instead of all-at-once. Pushed for BOTH operators:
          // when the agent replays, an open human popup for the same template animates too.
          const win = ctx.getMainWindow();
          const pushStep = (payload: Record<string, any>) => {
            if (win && !win.isDestroyed()) win.webContents.send('investigation-run-step', { name: tpl.name, slug: tpl.slug, ...payload });
          };
          pushStep({ phase: 'start', total: steps.length });
          const results: any[] = [];
          const raws: any[] = [];           // raw replay result per step (for the typed answer)
          let lastAnswer: AnswerValue | null = null; // typed answer of the last RUN step — what a guard tests
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            // CONDITIONAL: a composite step may carry a guard on the previous step's answer.
            // If it fails, skip the step (don't run its sub-recipe) and record why.
            if (step.when && !evaluateGuard(step.when, lastAnswer)) {
              const summary = `skipped · ${describeGuard(step.when)}`;
              results.push({ step: step.label, path: step.path, ok: true, skipped: true, summary, ...(isCompositeStep(step) ? { subRecipe: compositeTarget(step) } : {}) });
              raws.push(null);
              pushStep({ phase: 'step', index: i, ok: true, skipped: true, summary, label: step.label });
              continue;
            }
            // Composite (sub-recipe) step: recurse into the run handler, threading the depth
            // guard + force flag so nested requirement-gates and the loop cap still apply.
            const isRef = isCompositeStep(step);
            const runBody = isRef ? { ...step.body, _depth: depth + 1, force: body.force || step.body?.force } : step.body;
            const r = await replayStep({ path: step.path, body: runBody });
            const ok = r?.success !== false;
            const summary = summarizeReplay(step.path, r);
            raws.push(r);
            lastAnswer = deriveAnswerValue(step.path, r);
            results.push({ step: step.label, path: step.path, ok, summary, ...(isRef ? { subRecipe: compositeTarget(step) } : {}) });
            pushStep({ phase: 'step', index: i, ok, summary, label: step.label });
          }
          pushStep({ phase: 'done', total: steps.length });
          // The ANSWER — the recipe's valuable output (what its aim asked). Explicit marked
          // step if set, else the heuristic (last output step) — flagged so the caller can
          // tell the user it's a best guess. Both operators get this front-and-center.
          let ans = resolveAnswerStep(steps, tpl.answerStepIndex);
          // In a CONDITIONAL recipe the chosen answer step may have been skipped by a guard;
          // fall back to the last non-skipped output-producing step (the real result reached).
          if (ans && results[ans.index]?.skipped) {
            let fb: { index: number; heuristic: boolean } | null = null;
            for (let i = results.length - 1; i >= 0; i--) {
              if (!results[i]?.skipped && outputLabelForPath(steps[i]?.path)) { fb = { index: i, heuristic: true }; break; }
            }
            ans = fb;
          }
          const answer = ans ? {
            index: ans.index,
            heuristic: ans.heuristic,
            step: results[ans.index]?.step,
            output: outputLabelForPath(steps[ans.index]?.path),
            summary: results[ans.index]?.summary,
            value: deriveAnswerValue(steps[ans.index]?.path, raws[ans.index]), // typed value a conditional branches on
          } : null;
          sendJson(res, { success: true, ran: tpl.name, aim: tpl.aim, composite: !!tpl.composite, answer, steps: results, requirements, applied: appliedLenses });
          return;
        }
        // Fork (Workflow Canvas Phase 3) — "save as a new instance": derive a NEW saved
        // investigation from an existing one with tweaked nouns baked in as the new
        // captured defaults. Apply the param overrides to the source steps, then
        // re-extract the param schema from the overridden bodies (buildTemplate) so the
        // fork's own tweak-form prefills the new values. Requirements carry over.
        if (url === '/api/investigation-fork') {
          const src = getTemplate(body.name || body.slug || '');
          if (!src) return sendError(res, `No saved investigation named "${body.name || body.slug}"`);
          const newName = (body.newName || '').trim();
          if (!newName) return sendError(res, 'newName required');
          // Fork must also carry an aim: use the override if given, else inherit the source's.
          const forkAim = (typeof body.aim === 'string' ? body.aim.trim() : '') || (src.aim || '').trim();
          if (!forkAim) return sendError(res, 'An aim is required — say what this forked recipe is for. Pass `aim` (the source has none to inherit).');
          const resolved = resolveSteps(src, body.params || {});
          const journal = resolved.map(s => ({ path: s.path, body: s.body, ts: 0, label: s.label }));
          const tpl = buildTemplate(newName, journal, src.sourceFile, body.description || src.description, src.requirements, forkAim, src.sourceFiles);
          tpl.answerStepIndex = src.answerStepIndex; // carry over the marked answer step (same step count)
          saveTemplate(tpl);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: tpl });
          return;
        }
        // COMPOSE — build a "complicated" recipe out of simpler saved recipes. Each input
        // step names a saved sub-recipe, optional params to pass it, and an optional `when`
        // guard (run the sub-recipe only if the PREVIOUS step's typed answer satisfies it —
        // "if recipe-a returns true → run recipe-b with a,b"). The composite is itself a normal
        // InvestigationTemplate whose steps recurse into the run engine, so it lists / runs /
        // forks / pins like any other recipe. Reachable by both operators (agent MCP now; a
        // human compose panel is the follow-up — see PARITY note).
        if (url === '/api/investigation-compose') {
          const name = (body.name || '').trim();
          if (!name) return sendError(res, 'name required');
          // Same aim gate as save/fork — a composite is still a recipe and must say what it's for.
          const aim = typeof body.aim === 'string' ? body.aim.trim() : '';
          if (!aim) return sendError(res, 'An aim is required — say what this composite recipe is for (e.g. "if the crash-check finds crashes, confirm whether it is OOM").');
          const inSteps = Array.isArray(body.steps) ? body.steps : [];
          if (inSteps.length === 0) return sendError(res, 'steps required — list the sub-recipes to chain, each { investigation, params?, when? }.');
          const steps: TemplateStep[] = [];
          const missing: string[] = [];
          for (const s of inSteps) {
            const subName = String(s?.investigation || s?.name || s?.slug || '').trim();
            if (!subName) { missing.push('(unnamed)'); continue; }
            const sub = getTemplate(subName);
            if (!sub) { missing.push(subName); continue; }
            const when = normalizeGuard(s?.when);
            const guardTxt = when ? ` (${describeGuard(when)})` : '';
            steps.push({
              path: COMPOSITE_STEP_PATH,
              body: { name: sub.slug, params: (s?.params && typeof s.params === 'object') ? s.params : {} },
              label: `▶ ${sub.name}${guardTxt}`,
              ...(when ? { when } : {}),
            });
          }
          if (missing.length) return sendError(res, `Unknown sub-recipe(s): ${missing.join(', ')}. Use the saved investigations list to see valid names.`);
          const tpl: InvestigationTemplate = {
            name, slug: slugify(name), createdAt: Date.now(),
            aim, description: typeof body.description === 'string' ? body.description : undefined,
            steps, params: [], composite: true,
          };
          saveTemplate(tpl);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: tpl });
          return;
        }
        // Set/edit a recipe's AIM (what it's for) — the one thing that says why the recipe
        // exists. Reachable by both operators (human "Edit aim", agent at save via `aim`).
        if (url === '/api/investigation-set-aim') {
          const tpl = getTemplate(body.name || body.slug || '');
          if (!tpl) return sendError(res, `No saved investigation named "${body.name || body.slug}"`);
          // Aim can't be cleared to blank — a recipe must always say what it is for.
          const aim = typeof body.aim === 'string' ? body.aim.trim() : '';
          if (!aim) return sendError(res, 'An aim cannot be blank — a recipe must say what it is for. Enter an aim.');
          tpl.aim = aim;
          saveTemplate(tpl);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: tpl });
          return;
        }
        // Pin a recipe's TIER — fundamental (a reusable building block) vs complex (a
        // multi-step / composite workflow). tier = 'auto' (or null) clears the pin and
        // falls back to the smart default (resolveTier). Both operators reach it: human
        // via the recipe context menu, agent via logan_set_investigation_tier.
        if (url === '/api/investigation-set-tier') {
          const tpl = getTemplate(body.name || body.slug || '');
          if (!tpl) return sendError(res, `No saved investigation named "${body.name || body.slug}"`);
          const t = body.tier;
          if (t === null || t === undefined || t === 'auto' || t === '') {
            tpl.tier = undefined; // reset to the smart default
          } else if (t === 'fundamental' || t === 'complex') {
            tpl.tier = t;
          } else {
            return sendError(res, "tier must be 'fundamental', 'complex', or 'auto'/null to reset to the smart default");
          }
          saveTemplate(tpl);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: tpl, tier: resolveTier(tpl) });
          return;
        }
        // Mark WHICH step is the recipe's ANSWER (the valuable output). stepIndex = -1
        // (or null) clears it → the run falls back to the heuristic (last output step).
        if (url === '/api/investigation-set-answer') {
          const tpl = getTemplate(body.name || body.slug || '');
          if (!tpl) return sendError(res, `No saved investigation named "${body.name || body.slug}"`);
          const idx = body.stepIndex;
          const nSteps = (tpl.steps || []).length;
          if (idx === null || idx === undefined || idx === -1) {
            tpl.answerStepIndex = undefined; // clear → heuristic
          } else if (typeof idx === 'number' && idx >= 0 && idx < nSteps) {
            tpl.answerStepIndex = idx;
          } else {
            return sendError(res, `stepIndex out of range (0..${nSteps - 1}), or -1 to clear (use the heuristic)`);
          }
          saveTemplate(tpl);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: tpl });
          return;
        }
        if (url === '/api/investigation-check') {
          // Dry-run the requirements preflight without replaying — lets a caller (or the
          // UI) ask "would this investigation apply to the open log?".
          const tpl = getTemplate(body.name || body.slug || '');
          if (!tpl) return sendError(res, `No saved investigation named "${body.name || body.slug}"`);
          const requirements = evaluateRequirements(tpl.requirements, buildRequirementContext(ctx));
          sendJson(res, { success: true, name: tpl.name, manifest: tpl.requirements || null, requirements });
          return;
        }
        if (url === '/api/entities') {
          // Entity Registry read model: one catalog of every saved/reusable entity. index.ts
          // owns most stores (via ctx.listSavedEntities); investigations are appended here.
          const kind = body.kind || undefined;
          const entities: EntityDescriptor[] = ctx.listSavedEntities(kind);
          if (!kind || kind === 'investigation') {
            entities.push(...toDescriptors('investigation', listTemplates()));
          }
          if (!kind || kind === 'sequence') {
            entities.push(...toDescriptors('sequence', listSequences()));
          }
          sendJson(res, { success: true, count: entities.length, entities });
          return;
        }
        if (url === '/api/apply-entity') {
          // Apply a saved lens entity to the open view (agent parity for the human ▶ Apply).
          const result = ctx.applyEntityRef({ kind: body.kind, id: body.id, name: body.name });
          if (!result.success) return sendError(res, result.error || 'Could not apply');
          sendJson(res, result);
          return;
        }
        if (url === '/api/investigation-suggest-requirements') {
          // Suggest a starter manifest from the open file (adapter + filename glob).
          const fp = ctx.getCurrentFilePath();
          const suggested = suggestRequirements({ filePath: fp, adapterId: fp ? pickAdapter(fp).id : null });
          sendJson(res, { success: true, requirements: suggested });
          return;
        }
        if (url === '/api/investigation-set-requirements') {
          // Attach/replace the requirements manifest on an existing saved investigation
          // (edit path — does not touch the recorded steps). Pass requirements:null to clear.
          const tpl = getTemplate(body.name || body.slug || '');
          if (!tpl) return sendError(res, `No saved investigation named "${body.name || body.slug}"`);
          tpl.requirements = body.requirements || undefined;
          saveTemplate(tpl);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: tpl });
          return;
        }
        if (url === '/api/investigation-set-params') {
          // Curate a saved investigation's params so it becomes a REAL template:
          // retype a param variable/constant, set a description, set a new default value
          // ("Save" the tweaks in the hub), PROMOTE an arbitrary (stepIndex,key) body
          // value into a fill-in, or DEMOTE one back to pinned.
          const patchRes = setTemplateParams(body.name || body.slug || '', Array.isArray(body.patches) ? body.patches : []);
          if (!patchRes) return sendError(res, `No saved investigation named "${body.name || body.slug}"`);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('investigation-templates-changed');
          sendJson(res, { success: true, template: patchRes.tpl, applied: patchRes.applied, errors: patchRes.errors });
          return;
        }

        if (url === '/api/open-file') {
          if (!body.filePath) return sendError(res, 'filePath required');
          if (!fs.existsSync(body.filePath)) return sendError(res, 'File not found');
          const result = await ctx.openFile(body.filePath);
          sendJson(res, result);
          return;
        }

        if (url === '/api/open-folder') {
          if (!body.folderPath) return sendError(res, 'folderPath required');
          const result = await ctx.openFolder(body.folderPath);
          if (!result?.success) return sendError(res, result?.error || 'Failed to open folder');
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
          const result = await ctx.search({ ...options, scope: body.scope });
          // Add viewerLine (1-based) to each match so agents use the right number
          if (result?.matches) {
            result.matches = result.matches.map((m: any) => ({ ...m, viewerLine: m.lineNumber + 1 }));
          }
          sendJson(res, result);
          return;
        }

        if (url === '/api/analyze') {
          const result = await ctx.analyze(body.analyzerName, body.scope);
          sendJson(res, result);
          return;
        }

        if (url === '/api/summarize') {
          const result = await ctx.summarize(body.opts, body.scope);
          sendJson(res, result);
          return;
        }

        if (url === '/api/diff-runs') {
          if (!body.reference || typeof body.reference !== 'string') return sendError(res, 'reference (path to the good/reference run) required');
          const result = await ctx.diffRuns(body.reference, {
            scope: body.scope,
            maxTemplates: body.maxTemplates,
            maxExamples: body.maxExamples,
            minCount: body.minCount,
            changeFactor: body.changeFactor,
            topN: body.topN,
          });
          sendJson(res, result);
          return;
        }

        if (url === '/api/fold-regions') {
          const result = await ctx.foldRegions(body.opts);
          sendJson(res, result);
          return;
        }

        if (url === '/api/filter') {
          const config: any = {
            levels: body.levels || [],
            includePatterns: body.includePatterns || [],
            excludePatterns: body.excludePatterns || [],
            matchCase: body.matchCase ?? false,
          };
          // Parity for the human "filter rows by a column value": accept columnFilters and
          // translate them into the SAME advanced-filter `column` rule the UI builds, so both
          // operators hit one `compileAdvancedFilter` implementation.
          if (Array.isArray(body.columnFilters) && body.columnFilters.length) {
            config.advancedFilter = {
              enabled: true,
              delimiter: body.delimiter || ' ',
              groups: [{
                id: 'ai-colfilter',
                operator: 'AND',
                rules: body.columnFilters.map((c: any, i: number) => ({
                  id: `col_${i}`,
                  type: 'column',
                  columnIndex: c.columnIndex ?? c.column ?? 0,
                  columnOp: c.op || c.columnOp || 'contains',
                  value: String(c.value ?? ''),
                  caseSensitive: !!c.caseSensitive,
                })),
              }],
            };
          }
          const result = await ctx.applyFilter(config);
          sendJson(res, result);
          return;
        }

        if (url === '/api/clear-filter') {
          const result = ctx.clearFilter();
          sendJson(res, result);
          return;
        }

        // Constants ("tags") — parity with the human "🔤 Save as constant" + picker. Global,
        // shared constantsStore (one implementation, two operators). Metadata, not log content.
        if (url === '/api/constants-list') {
          sendJson(res, { success: true, entries: getConstants() });
          return;
        }
        if (url === '/api/constants-save') {
          const name = String(body.name || '').trim();
          const value = String(body.value ?? '');
          if (!name || !value) { sendJson(res, { success: false, error: 'name and value are required' }); return; }
          const description = typeof body.description === 'string' ? body.description : undefined;
          saveConstant(name, value, undefined, description);
          sendJson(res, { success: true, entries: getConstants() });
          return;
        }
        if (url === '/api/constants-delete') {
          const removed = deleteConstant(String(body.name || ''));
          sendJson(res, { success: true, removed, entries: getConstants() });
          return;
        }

        // Clue sequences — ordered "evidence trail" entities (the EVIDENCE twin of an
        // investigation; see docs/discovery/investigation-workflow-canvas.md). Agent
        // parity for collect + save; the human right-click gesture + clue tray is
        // Increment B. Shared store, both operators.
        if (url === '/api/sequences') {
          sendJson(res, { success: true, sequences: listSequences() });
          return;
        }
        if (url === '/api/sequence-save') {
          const seq = saveSequence({
            id: body.id, name: body.name, description: body.description, scope: body.scope,
            sourceFile: body.sourceFile ?? ctx.getCurrentFilePath() ?? undefined, clues: body.clues,
          });
          if (!seq) { sendJson(res, { success: false, error: 'a sequence name (or id) is required' }); return; }
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('sequences-changed');
          sendJson(res, { success: true, sequence: seq });
          return;
        }
        if (url === '/api/sequence-append-clue') {
          const seq = appendClue(String(body.name || body.id || ''), body.clue || body);
          if (!seq) { sendJson(res, { success: false, error: 'a valid clue (ref) and a sequence name are required' }); return; }
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('sequences-changed');
          sendJson(res, { success: true, sequence: seq });
          return;
        }
        if (url === '/api/sequence-delete') {
          const removed = deleteSequence(String(body.name || body.id || ''));
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('sequences-changed');
          sendJson(res, { success: true, removed });
          return;
        }

        // Column Layouts — parity with the human Columns window / Column Layouts builder.
        // list/save/delete of the shared layout store. (Applying a layout to the VIEWER is a
        // viewport concern — human-only by exemption; see docs/PARITY_CHECKLIST.md.)
        if (url === '/api/column-layout-list') {
          sendJson(res, { success: true, layouts: loadColumnLayouts() });
          return;
        }
        if (url === '/api/column-layout-save') {
          const layout = body.layout || body;
          if (!layout || !layout.id || !layout.name || !Array.isArray(layout.columns)) {
            sendJson(res, { success: false, error: 'Invalid column layout (need id, name, columns[])' });
            return;
          }
          sendJson(res, { success: true, layouts: upsertColumnLayout(layout) });
          return;
        }
        if (url === '/api/column-layout-delete') {
          sendJson(res, { success: true, layouts: deleteColumnLayout(String(body.id || '')) });
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
            ...(typeof body.description === 'string' ? { description: body.description } : {}),
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
            ...(typeof body.description === 'string' ? { description: body.description } : {}),
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
            description: body.description !== undefined ? body.description : existing.description,
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
            description: body.description !== undefined ? body.description : existing.description,
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

        // Batch findings handoff — import a whole investigation's findings in one call.
        // Each finding becomes an Annotation sharing one handoffId so the renderer shows
        // them as a titled, tick-off-able worklist. lineNumber is already 0-based here.
        if (url === '/api/import-findings') {
          if (!Array.isArray(body.findings) || body.findings.length === 0) {
            return sendError(res, 'findings[] required');
          }
          if (body.clearPrevious) ctx.clearAnnotations();
          const source: string = body.source || activeAgent?.name || 'Agent';
          const title: string = body.title || 'Agent handoff';
          const summary: string = body.summary || '';
          const handoffId = `ho-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const ts = Date.now();
          const anns: Annotation[] = body.findings.map((f: any, i: number) => ({
            id: `ann-${ts}-${i}-${Math.random().toString(36).substring(2, 6)}`,
            lineNumber: f.lineNumber ?? 0,
            ...(f.endLine !== undefined ? { endLine: f.endLine } : {}),
            text: f.title || f.text || '(finding)',
            agentName: source,
            timestamp: ts,
            severity: f.severity || 'info',
            handoffId,
            handoffTitle: title,
            handoffSummary: summary,
            ...(f.detail ? { detail: f.detail } : {}),
            ...(f.suggestedAction ? { suggestedAction: f.suggestedAction } : {}),
            done: false,
          }));
          ctx.addAnnotations(anns);
          // Land the viewer on the first finding so the handoff is immediately visible.
          if (anns.length && body.navigate !== false) ctx.navigateToLine(anns[0].lineNumber);
          // Also drop a summary line into the chat panel.
          if (!activeAgent) touchPollingAgent(source, ctx);
          const msgText = `**📥 Handoff — ${title}** (${anns.length} finding${anns.length === 1 ? '' : 's'})${summary ? `\n\n${summary}` : ''}`;
          const msg = addChatMessage('agent', msgText);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('agent-message', msg);
          sendJson(res, { success: true, handoffId, count: anns.length });
          return;
        }

        if (url === '/api/annotation-update') {
          if (!body.id) return sendError(res, 'id required');
          const result = ctx.updateAnnotation(body.id, body.patch || {});
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

        if (url === '/api/context-manifest') {
          if (!body.facts || typeof body.facts !== 'object' || Array.isArray(body.facts)) {
            return sendError(res, 'facts required (object of key→value strings)');
          }
          if (!ctx.getCurrentFilePath()) return sendError(res, 'No file open');
          const result = ctx.attachContextManifest(body.facts, {
            provenance: (body.provenance && typeof body.provenance === 'object' && !Array.isArray(body.provenance)) ? body.provenance : undefined,
            source: typeof body.source === 'string' ? body.source : undefined,
            replace: body.replace === true,
            agentName: activeAgent?.name,
          });
          if (!result.success) return sendError(res, 'Failed to attach context (could not write .logan/ sidecar)');
          sendJson(res, result);
          return;
        }

        if (url === '/api/context-manifest-clear') {
          sendJson(res, ctx.clearContextManifest());
          return;
        }

        if (url === '/api/agent-memory-clear') {
          ctx.clearAgentMemory();
          notifyMemoryChanged(ctx);
          sendJson(res, { success: true });
          return;
        }

        // Save the current investigation as a self-contained markdown DOC — LOGAN's
        // universal Log Analysis Report (see docs/LOGAN_REPORT_FORMAT.md), written to
        // the log's .logan/reports/. The agent supplies name/aim/reason (+ optional
        // ticket + narrative); we fold in its pinned findings — each with the REAL
        // related log-line SEQUENCE (match + context) pulled from the file — the
        // recorded steps, and (opt-in) the native root-cause verdict with its evidence
        // lines. Human parity: the saved doc lands in the chat panel (clickable path)
        // and is a plain .md the user opens, shares, or pastes into Jira.
        if (url === '/api/save-report') {
          if (!body.name || typeof body.name !== 'string') return sendError(res, 'name required');
          if (!ctx.getCurrentFilePath()) return sendError(res, 'No file open');

          const includeFindings = body.includeFindings !== false;
          const includeSteps = body.includeSteps !== false;
          const includeConclusion = body.includeConclusion === true; // opt-in (runs analysis)

          const readHandler = ctx.getReadHandler();
          const total = readHandler ? readHandler.getTotalLines() : 0;
          // Context lines shown around each finding's match line(s) (0 = match only).
          const ctxLines = Math.max(0, Math.min(20, body.context ?? 3));
          const MAX_SPAN = 60;            // cap a single finding's rendered match span
          const MAX_TOTAL_LOGLINES = 500; // safety cap on embedded lines across the doc

          // Steps = the recorded investigation journal (what the agent did).
          const steps: ReportStep[] = includeSteps
            ? agentJournal.map((e) => ({ label: e.label, ...(e.result ? { result: e.result } : {}) }))
            : [];

          let conclusion: ConclusionReport | null = null;
          if (includeConclusion) {
            const c = await buildConclusion(ctx, {});
            if (c.success && c.conclusion) conclusion = c.conclusion;
          }

          // Plan which raw lines to fetch: a context window per finding (deduped),
          // plus the verdict's first-anomaly / root-cause lines. One batched read.
          const wanted = new Set<number>();
          const rawFindings: { ann: Annotation; matchStart0: number; matchEnd0: number; win: [number, number] }[] = [];
          if (includeFindings) {
            let budget = MAX_TOTAL_LOGLINES;
            for (const a of ctx.getAnnotations().values()) {
              const ln0 = a.lineNumber;
              const end0 = a.endLine !== undefined ? a.endLine : ln0;
              const matchStart0 = Math.max(0, Math.min(ln0, end0));
              const spanLen = Math.max(ln0, end0) - matchStart0 + 1;
              const matchEnd0 = matchStart0 + Math.min(spanLen, MAX_SPAN) - 1; // rendered match end
              const winStart = Math.max(0, matchStart0 - ctxLines);
              const winEnd = Math.min(total - 1, matchEnd0 + ctxLines);
              const winSize = winEnd - winStart + 1;
              if (readHandler && total > 0 && winSize <= budget) {
                budget -= winSize;
                for (let n = winStart; n <= winEnd; n++) wanted.add(n);
                rawFindings.push({ ann: a, matchStart0, matchEnd0, win: [winStart, winEnd] });
              } else {
                // Over budget / no reader: keep the finding, skip its embedded lines.
                rawFindings.push({ ann: a, matchStart0, matchEnd0, win: [matchStart0, matchStart0 - 1] });
              }
            }
          }
          const eventViewerLines: number[] = [];
          for (const ev of [conclusion?.firstAnomaly, conclusion?.rootCause]) {
            if (!ev) continue;
            const vl = ev.viewerLine ?? ev.lineNumber + 1;
            eventViewerLines.push(vl);
            if (readHandler && vl - 1 >= 0 && vl - 1 < total) wanted.add(vl - 1);
          }

          // One batched read for every needed raw line (0-based → text).
          const lineText = new Map<number, string>();
          if (wanted.size && readHandler) {
            const nums = Array.from(wanted).sort((a, b) => a - b);
            const fetched = await readHandler.getLinesByNumbers(nums);
            for (const ld of fetched) lineText.set(ld.lineNumber, ld.text);
          }

          // Assemble findings with their related log-line sequences.
          const findings: ReportFinding[] = rawFindings.map((rf) => {
            const [winStart, winEnd] = rf.win;
            const logLines: ReportLogLine[] = [];
            for (let n = winStart; n <= winEnd; n++) {
              const text = lineText.get(n);
              if (text === undefined) continue;
              logLines.push({ viewerLine: n + 1, text, isMatch: n >= rf.matchStart0 && n <= rf.matchEnd0 });
            }
            return {
              viewerLine: rf.ann.lineNumber + 1,
              ...(rf.ann.endLine !== undefined ? { endLine: rf.ann.endLine + 1 } : {}),
              title: rf.ann.text,
              ...(rf.ann.detail ? { detail: rf.ann.detail } : {}),
              ...(rf.ann.severity ? { severity: rf.ann.severity } : {}),
              ...(logLines.length ? { logLines } : {}),
            };
          });

          // Verdict evidence lines: viewerLine (1-based) → raw text.
          const eventLines: Record<number, string> = {};
          for (const vl of eventViewerLines) {
            const text = lineText.get(vl - 1);
            if (text !== undefined) eventLines[vl] = text;
          }

          // Components potentially responsible: agent-supplied wins; otherwise
          // derive from the verdict's top failing components (sampleLine is
          // 0-based internally → +1 for the viewer). Agent-supplied sampleLine is
          // already a 1-based viewerLine, like everywhere else in the agent API.
          let components: ReportComponent[] = [];
          if (Array.isArray(body.components) && body.components.length) {
            components = body.components
              .map((c: any) => (typeof c === 'string'
                ? { name: c }
                : (c && c.name
                    ? {
                        name: String(c.name),
                        ...(c.reason ? { reason: String(c.reason) } : {}),
                        ...(typeof c.sampleLine === 'number' ? { sampleLine: c.sampleLine } : {}),
                      }
                    : null)))
              .filter(Boolean)
              .slice(0, 50) as ReportComponent[];
          } else if (conclusion && conclusion.topComponents?.length) {
            components = conclusion.topComponents.map((c) => {
              const bits: string[] = [];
              if (c.errorCount) bits.push(`${c.errorCount} error${c.errorCount === 1 ? '' : 's'}`);
              if (c.warningCount) bits.push(`${c.warningCount} warning${c.warningCount === 1 ? '' : 's'}`);
              return {
                name: c.name,
                ...(bits.length ? { reason: bits.join(' / ') } : {}),
                ...(typeof c.sampleLine === 'number' && c.sampleLine >= 0 ? { sampleLine: c.sampleLine + 1 } : {}),
              };
            });
          }

          // Open questions / follow-ups (agent-supplied).
          const questions: string[] = Array.isArray(body.questions)
            ? body.questions.filter((q: any) => typeof q === 'string' && q.trim()).map((q: string) => q.trim()).slice(0, 50)
            : [];

          // Environment the log was captured under (build/firmware/flags/config) — the
          // manifest's facts become an "Environment" section conditioning the findings.
          const cm = ctx.getContextManifest();
          const envContext = (cm && cm.facts)
            ? Object.entries(cm.facts).map(([key, f]: [string, any]) => ({
                key,
                value: String(f?.value ?? ''),
                ...(f?.source ? { source: String(f.source) } : {}),
              }))
            : [];

          const md = buildReportMarkdown({
            name: body.name,
            aim: body.aim || '',
            reason: body.reason || '',
            ticket: body.ticket,
            body: body.body,
            sourceFilePath: ctx.getCurrentFilePath(),
            totalLines: total || undefined,
            generatedAtIso: new Date().toISOString(),
            agentName: activeAgent?.name,
            findings,
            steps,
            conclusion,
            eventLines,
            components,
            questions,
            envContext,
          });

          const saved = await ctx.saveReport(reportFileName(body.name), md);
          if (!saved.success) return sendError(res, saved.error || 'Failed to save report');

          // Surface it to the human in the chat panel (no new IPC channel needed).
          const source = activeAgent?.name || 'Agent';
          if (!activeAgent) touchPollingAgent(source, ctx);
          const msg = addChatMessage('agent', `**📄 Saved report — ${body.name}**\n\n\`${saved.filePath}\``);
          const win = ctx.getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('agent-message', msg);

          sendJson(res, {
            success: true,
            filePath: saved.filePath,
            name: body.name,
            findings: findings.length,
            steps: steps.length,
            conclusion: !!conclusion,
            components: components.length,
            questions: questions.length,
          });
          return;
        }

        if (url === '/api/time-gaps') {
          const result = await ctx.detectTimeGaps({
            thresholdSeconds: body.thresholdSeconds ?? 30,
            scope: body.scope,
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
          const fp = buildFingerprint(filePath, analysisResult, handler, factsToPlain(ctx.getContextManifest()));
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
          const fp = buildFingerprint(filePath, analysisResult, handler, factsToPlain(ctx.getContextManifest()));
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

        // Build + open a "single session" composite from an ordered list of file paths.
        // Parity with the human 🔗 button (Time Sync panel) — one shared impl (buildComposite).
        if (url === '/api/composite-create') {
          if (!Array.isArray(body.files) || body.files.length < 2) {
            return sendError(res, 'files: an array of at least 2 absolute file paths is required');
          }
          // order:"wallclock" → materialize the time-interleaved merge + open it (parity
          // with the human "Merge to file" button). Default → the virtual sequential
          // concatenation composite (no file written).
          if (body.order === 'wallclock') {
            const merged = await ctx.mergeTimeline(body.files, body.label);
            sendJson(res, merged);
            return;
          }
          const result = await ctx.createComposite(body.files, body.label);
          sendJson(res, result);
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
            scope: body.scope,
          });
          if (!result.success) return sendError(res, result.error || 'No file open');
          sendJson(res, result);
          return;
        }

        // Extract the current active-filter subset to a NEW file — the AI
        // counterpart of the human "⬇ Extract to file" (EXTRACT_FILTERED_TO_FILE
        // IPC). Same instrument: both go through ctx.extractFilteredToFile →
        // runFilteredExtract. Requires an active filter (apply /api/filter first).
        if (url === '/api/extract') {
          const result = await ctx.extractFilteredToFile({
            includeLineNumbers: body.includeLineNumbers,
            columnConfig: body.columnConfig,
          });
          if (!result.success) return sendError(res, result.error || 'Extract failed');
          sendJson(res, result);
          return;
        }

        // Compile a pattern through the SAME controlled-pattern ladder the human
        // "Make pattern…" flow uses (plain/grok/paint/regex → validated, bounded
        // regex). Puts the AI on the ladder and records the compile into the
        // Pattern Log flight recorder, so pattern authoring is visible for BOTH
        // operators. Returns { ok, source, flags, mode, warnings, error } — the
        // live RegExp can't cross the boundary, so callers rebuild it locally.
        if (url === '/api/compile-pattern') {
          const input: CompileInput = {
            mode: body.mode,
            text: body.text,
            flags: body.flags,
            matchCase: body.matchCase,
            wholeWord: body.wholeWord,
            invert: body.invert,
            sample: body.sample,
            spans: body.spans,
          };
          const started = Date.now();
          const r = compilePattern(input);
          logPattern({
            operator: 'ai', mode: r.mode, source: r.source, scope: 'compile',
            scanned: 0, matched: 0, hid: 0, sampleHits: [], ms: Date.now() - started,
            capped: false, valid: r.ok, error: r.error,
          });
          sendJson(res, { success: r.ok, ok: r.ok, source: r.source, flags: r.flags, mode: r.mode, warnings: r.warnings, error: r.error });
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
