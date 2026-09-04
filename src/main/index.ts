import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { spawn, execSync, spawnSync } from 'child_process';
import { randomUUID, createHash } from 'crypto';
// marked v17 is ESM-only ("type":"module"), so a static `import`/`require('marked')`
// throws "require() of ES Module …" under our CommonJS main build. Load its UMD
// build (CommonJS-compatible) lazily by absolute file path instead — see getMarked().
// Lazy-loaded: node-pty causes SIGSEGV on Linux when bindings mismatch
let pty: typeof import('node-pty') | null = null;
if (process.platform !== 'linux') {
  try {
    pty = require('node-pty');
  } catch {
    console.warn('node-pty not available — terminal feature disabled');
  }
} else {
  console.warn('node-pty not available on Linux — using child_process fallback for terminal');
}
import { FileHandler, filterLineToVisibleColumns, splitLineIntoColumns, ColumnConfig } from './fileHandler';
import { detectDelimiter, findHeaderRow, isCommentOrBanner } from '../shared/columnDetect';
import { launchPathCandidates } from './launchArgs';
import { CompositeFileHandler, CompositeMemberHandler, CompositeBoundary } from './compositeFileHandler';
import { SegmentedFileHandler } from './segmentedFileHandler';
import { computeSegmentPlan, readSystemMemory } from './segmentPlan';
import { getRipgrepPath } from './ripgrepPath';
import { openWithAdapter, NormalizedSource, isTextPassthrough } from './sourceAdapter';
import { resolveFileHandlers, runFileHandler, FileHandlerQuery } from './fileHandlers';
import { scanFolderShallow } from './folderScan';
import { extractBodyLine, extractHeaderLine } from '../shared/extractFormat';
import { IPC, SearchOptions, Bookmark, Highlight, HighlightGroup, SearchConfig, SearchConfigSession, SingleSessionEntry, ActivityEntry, LocalFileData, ContextDefinition, ContextMatchGroup, Annotation, PatternProperty, SavedPattern, ScopeDescriptor, ResolvedScope, FileInfo } from '../shared/types';
import * as Diff from 'diff';
import { analyzerRegistry, AnalyzerOptions, AnalysisResult, AnalyzeProgress, LogAnalyzer } from './analyzers';
import { mergeAnalysisResults } from './compositeAnalysis';
import { loadDatadogConfig, saveDatadogConfig, clearDatadogConfig, fetchDatadogLogs, DatadogConfig, DatadogFetchParams } from './datadogClient';
import { startApiServer, stopApiServer, ApiContext, addChatMessage, getChatMessages, getSseClientCount, getAgentName, loadPersistedSession, broadcastInterrupt, disconnectActiveAgent, API_PORT, buildEvidencePack } from './api-server';
import { runRecipe, RecipeOptions } from '../mcp-server/recipes';
import { BaselineStore, buildFingerprint } from './baselineStore';
import { bumpUsage, getUsage, clearUsage, flushUsage, isAiContext } from './usageStore';
import { canonicalizeHumanVerb, aggregateUsageByFeature } from '../shared/verbRegistry';
import { saveConstant, getConstants, deleteConstant, flushConstants } from './constantsStore';
import { flushSequences, listSequences, saveSequence } from './sequenceStore';
import { listTemplates, saveTemplate } from './investigationStore';
import { loadColumnLayouts, upsertColumnLayout, deleteColumnLayout, saveColumnLayouts, ColumnLayoutSaved } from './columnLayoutsStore';
import {
  buildPack, serializePack, parsePack, verifyPack, planImport, mergeRecords,
  encryptPack, decryptPack, isEncryptedEnvelope, CATALOG_IDENTITY, CATALOG_KINDS,
  PACK_FILE_EXT, type ConflictPolicy, type CatalogPack, type ExportableKind, type IdentitySpec,
} from './catalogPack';
import { EntityDescriptor, EntityKind, toDescriptors } from './entityRegistry';
import { ContextManifest, mergeFacts, factsToPlain, factCount } from './contextManifest';
import { getPatternLog, clearPatternLog, logPattern, PatternLogEntry, flushPatternLog } from './patternLog';
import { compilePattern, CompileInput } from './compilePattern';
import { parseTimestampFast } from './timestampParse';
import { carryForwardTimestamps, buildOriginTags, formatWallClock, sortMergeEntries, type MergeEntry } from './mergeTimeline';
import { ColumnPatternSpec } from './columnPattern';
import { parseVtraceToFile } from './vtraceParse';
import { runTrendJob, runSummarizeJob, cancelSummarizeJob, canSummarizeOffThread, runFoldRegionsJob, runColumnPreviewJob, canColumnPreviewOffThread } from './trendWorkerClient';
import { computeColumnPreview } from './columnPreview';
import { resolveScope, isWholeFile, scopeInfo, forEachScopeLine, ScopeResolverContext } from './scope';
import { analyzeScope } from './analyzers/scopedAnalysis';
import { TemplateFolder, type TemplateSummary } from './logTemplates';
import { feedScope } from './summarizeScan';
import { diffRuns, type DiffOptions } from './runDiff';
import { detectLogFormat } from './analyzers/lineClassify';
import { GapDetector } from './timeGaps';
// Native-dependent modules — lazy-loaded to prevent SIGSEGV if bindings aren't built
let SerialHandler: any = null;
let LogcatHandler: any = null;
let SshHandler: any = null;
let SshClient: any = null;
if (process.platform !== 'linux') {
  try { SerialHandler = require('./serialHandler').SerialHandler; } catch { console.warn('serialport not available — serial feature disabled'); }
  try { SshHandler = require('./sshHandler').SshHandler; } catch { console.warn('ssh2 not available — SSH feature disabled'); }
  try { SshClient = require('ssh2').Client; } catch {}
} else {
  console.warn('serialport not available on Linux — serial feature disabled');
  // ssh2 bundles native .node addons (sshcrypto, cpu-features) that SIGSEGV on Linux
  // due to Electron ABI mismatch. Block .node loading so ssh2 uses pure JS fallbacks.
  const Module = require('module');
  const origNodeExt = Module._extensions['.node'];
  Module._extensions['.node'] = function(_mod: any, filename: string) {
    throw new Error(`Native module blocked on Linux: ${filename}`);
  };
  try { SshHandler = require('./sshHandler').SshHandler; } catch { console.warn('ssh2 not available — SSH feature disabled'); }
  try { SshClient = require('ssh2').Client; } catch {}
  Module._extensions['.node'] = origNodeExt;
  console.log('ssh2 loaded with pure JS crypto fallback');
}
try { LogcatHandler = require('./logcatHandler').LogcatHandler; } catch { console.warn('logcatHandler not available'); }
import { SshProfile, SavedConnection } from '../shared/types';

// Tell Electron + GTK that we're a dark-themed app so native dialogs match
nativeTheme.themeSource = 'dark';
if (process.platform === 'linux' && !process.env.GTK_THEME) {
  process.env.GTK_THEME = 'Adwaita:dark';
}

let mainWindow: BrowserWindow | null = null;
let searchSignal: { cancelled: boolean } = { cancelled: false };
let diffSignal: { cancelled: boolean } = { cancelled: false };
let summarizeSignal: { cancelled: boolean } = { cancelled: false };
let currentFilePath: string | null = null;

// "Single session" — N already-open files presented as ONE continuous read-only view
// (see compositeFileHandler.ts). Kept as a dedicated ref rather than in fileHandlerCache
// because CompositeFileHandler is NOT a FileHandler: it shares only the read+search
// method shapes. When active, currentFilePath is the synthetic activeCompositeId and the
// read/search paths route through getReadHandler(); FileHandler-only features (severity
// index, filter, split) see "no file" and stay disabled instead of crashing.
let activeComposite: CompositeFileHandler | null = null;
let activeCompositeId: string | null = null;
const COMPOSITE_ID = 'composite://single-session';

// Auto-composite large files (P2 of auto-composite-large-files). When enabled (default OFF,
// synced from the renderer Features toggle), opening an over-budget plain-text file wraps it
// in a SegmentedFileHandler instead of building the full whole-file line index — only the few
// hot segments near the viewport stay indexed (LRU), so a 50M-line file no longer costs its
// whole ~800MB offset index. Kept as a dedicated ref (like activeComposite) because a
// SegmentedFileHandler is NOT a FileHandler and must not live in fileHandlerCache; when active,
// currentFilePath is the real file path and reads route through getReadHandler().
let activeSegmented: SegmentedFileHandler | null = null;
let activeSegmentedPath: string | null = null;
// Opt-in flag (default OFF), kept in lockstep with the renderer's `auto-segment` Features
// toggle via IPC.SET_AUTO_SEGMENT. Main owns it so EVERY open path (renderer + agent) agrees.
let autoSegmentEnabled = false;

// Close + drop any active segmented handler (releases its resident segment fds/indexes). Call
// whenever we leave segmented mode (opening a real file / entering a composite).
function clearActiveSegmented(): void {
  if (activeSegmented) { try { activeSegmented.close(); } catch { /* ignore */ } }
  activeSegmented = null;
  activeSegmentedPath = null;
}

// Decide whether to auto-segment `filePath` and, if so, build the segmented handler. Returns
// null (→ normal full-index open) unless the feature is ON, the file is a plain-text
// passthrough, and the adaptive plan says its whole-file index would exceed the RAM budget.
async function maybeOpenSegmented(
  filePath: string,
  onProgress: (percent: number) => void,
): Promise<SegmentedFileHandler | null> {
  if (!autoSegmentEnabled) return null;
  if (!isTextPassthrough(filePath)) return null; // decoded formats index a derived temp file
  let size = 0;
  try { size = fs.statSync(filePath).size; } catch { return null; }
  const plan = computeSegmentPlan(size, readSystemMemory());
  if (!plan.shouldSegment) return null;
  return SegmentedFileHandler.open(filePath, { plan, onProgress });
}
// Set in app.whenReady(); reused by top-level IPC handlers that need the same
// in-process bridge the API server uses (e.g. the native "📋 Brief" evidence pack).
let apiContext: ApiContext | null = null;

// --- Portable catalogue (export/import) ------------------------------------
// One place that binds each importable/exportable entity kind to its store's load + write-all.
// The pack SHAPE, merge rules and identity live in the pure catalogPack module; this registry
// is the only part that touches the real ~/.logan stores. Secret stores (agent-config,
// ssh-profiles, connections) and per-file working state are deliberately absent — scope A is
// the reusable GLOBAL toolkit only. Built lazily (loaders are hoisted) so a fresh read hits disk.
interface CatalogStore { load: () => any[]; saveAll: (records: any[]) => void; }
// Return type is Record<ExportableKind, …>: tsc forces this to bind EXACTLY the kinds marked
// exportable in catalogPack's CATALOG_EXPORT_POLICY (a missing/extra kind fails to compile),
// so a newly-exportable entity can't be silently omitted from packs.
function buildCatalogRegistry(): Record<ExportableKind, CatalogStore> {
  return {
    search: {
      load: () => loadSearchConfigsStore()['_global'] || [],
      saveAll: (r) => { const s = loadSearchConfigsStore(); s['_global'] = r as any; saveSearchConfigsStore(s); },
    },
    session:        { load: () => loadGlobalSearchConfigSessions(), saveAll: (r) => saveGlobalSearchConfigSessions(r as any) },
    composite:      { load: () => loadGlobalSingleSessions(),       saveAll: (r) => saveGlobalSingleSessions(r as any) },
    filter:         { load: () => loadFilterPresets(),              saveAll: (r) => saveFilterPresets(r as any) },
    highlightGroup: { load: () => loadHighlightGroups(),            saveAll: (r) => saveHighlightGroups(r as any) },
    bookmarkSet:    { load: () => loadBookmarkSets(),               saveAll: (r) => saveBookmarkSets(r as any) },
    columnLayout:   { load: () => loadColumnLayouts(),              saveAll: (r) => saveColumnLayouts(r as any) },
    columnPattern:  { load: () => loadColumnPatternsStore(),        saveAll: (r) => saveColumnPatternsStore(r as any) },
    trendProperty:  { load: () => loadPatternPropertiesStore(),     saveAll: (r) => savePatternPropertiesStore(r as any) },
    pattern:        { load: () => loadPatternLibraryStore(),        saveAll: (r) => savePatternLibraryStore(r as any) },
    contextDef: {
      load: () => loadContextDefinitionsStore()[GLOBAL_CONTEXT_KEY] || [],
      saveAll: (r) => { const s = loadContextDefinitionsStore(); s[GLOBAL_CONTEXT_KEY] = r as any; saveContextDefinitionsStore(s); },
    },
    constant: {
      load: () => getConstants(),
      saveAll: (r) => { for (const c of r as any[]) { if (c && c.name) saveConstant(c.name, c.value ?? '', undefined, c.description); } flushConstants(); },
    },
    sequence: {
      load: () => listSequences(),
      saveAll: (r) => { for (const s of r as any[]) { if (s && (s.name || s.id)) saveSequence({ id: s.id, name: s.name, scope: s.scope, description: s.description, clues: s.clues }); } flushSequences(); },
    },
    investigation: {
      load: () => listTemplates(),
      saveAll: (r) => { for (const t of r as any[]) { if (t && t.slug) saveTemplate(t); } },
    },
    baseline: {
      load: () => baselineStore.allFull(),
      saveAll: (r) => { for (const b of r as any[]) baselineStore.importRecord(b); },
    },
  };
}

// Built-in agent child process
import type { ChildProcess } from 'child_process';
let agentProcess: ChildProcess | null = null;
// Claude Code session id pinned on a fresh launch so a restart-after-idle can
// --resume the SAME conversation (full history) instead of starting blank.
let agentSessionId: string | null = null;

// Live connection registry (replaces per-source singletons)
interface LiveConnection {
  id: string;
  source: 'serial' | 'logcat' | 'ssh';
  handler: any;
  tempFilePath: string;
  displayName: string;
  detail: string;
  config: any;
  connectedSince: number;
  connected: boolean;
  listeners: Array<{ event: string; fn: (...args: any[]) => void }>;
}

const liveConnections = new Map<string, LiveConnection>();
const MAX_LIVE_CONNECTIONS = 4;

// Keep one SshHandler for SFTP/profile operations (not for live connections)
const sshUtilHandler = SshHandler ? new SshHandler() : null;

// Baseline store (JSON file in ~/.logan/baselines.json)
const baselineStore = new BaselineStore();

// Cache last analysis result per file for baseline fingerprinting (capped)
const analysisResultCache = new Map<string, AnalysisResult>();

function cacheAnalysisResult(filePath: string, result: AnalysisResult): void {
  if (analysisResultCache.has(filePath)) {
    analysisResultCache.delete(filePath);
  }
  if (analysisResultCache.size >= MAX_CACHED_FILES) {
    const firstKey = analysisResultCache.keys().next().value;
    if (firstKey) analysisResultCache.delete(firstKey);
  }
  analysisResultCache.set(filePath, result);
}

// Analyze the current target. For a normal file this is just analyzer.analyze(path). For an
// active single-session composite, analyze reads a raw path so it can't route through
// getReadHandler like reads/search do — instead we fan out over each member file and merge
// the results into the composite's global line space (see compositeAnalysis.ts). Callers
// cache the merged result under the composite id, invalidated on a file-set change (buildComposite).
async function analyzeCurrentTarget(
  analyzer: LogAnalyzer,
  options: AnalyzerOptions,
  onProgress: (p: AnalyzeProgress) => void,
  signal: { cancelled: boolean },
): Promise<AnalysisResult> {
  if (activeComposite && currentFilePath === activeCompositeId) {
    const boundaries = activeComposite.boundaries();
    const parts: AnalysisResult[] = [];
    for (let i = 0; i < boundaries.length; i++) {
      if (signal.cancelled) break;
      const sub = await analyzer.analyze(
        boundaries[i].filePath,
        options,
        // Fold each member's 0..100% into an overall progress span.
        (p) => onProgress({ ...p, percent: Math.round(((i + (p.percent || 0) / 100) / boundaries.length) * 100) }),
        signal,
      );
      parts.push(sub);
    }
    return mergeAnalysisResults(parts, boundaries.map((b) => b.startLine), analyzer.name, Date.now());
  }
  return analyzer.analyze(currentFilePath as string, options, onProgress, signal);
}

// Filter state - maps file path to array of visible line indices
const filterState = new Map<string, number[] | null>();

function getFilteredLines(): number[] | null {
  if (!currentFilePath) return null;
  return filterState.get(currentFilePath) || null;
}

// Active scope — what the human/app currently has set, mirroring filterState.
// The human sets it via "Use … as scope" (renderer → SET_ACTIVE_SCOPE); the AI's
// scope:"active" then resolves against the very same cell (same instrument, two
// operators). The renderer pre-resolves search/selection to concrete `indices`
// descriptors at set-time, so main needs no renderer state to resolve them.
const activeScope = new Map<string, ScopeDescriptor | null>();

function getActiveScope(): ScopeDescriptor | null {
  if (!currentFilePath) return null;
  return activeScope.get(currentFilePath) ?? null;
}

function setActiveScope(desc: ScopeDescriptor | null): void {
  if (!currentFilePath) return;
  if (desc && desc.type !== 'all') activeScope.set(currentFilePath, desc);
  else activeScope.delete(currentFilePath);
}

// Build the resolver context for the CURRENT file. all/range/indices/filter are
// resolved directly; active reads the cell above; the renderer supplies concrete
// indices for search/selection, so those arrive as {type:'indices'}. time/
// component still fall back to whole-file + warning (need a scan — later PR).
function buildScopeContext(): ScopeResolverContext {
  // getReadHandler so scope (total-line count) resolves against an active single-session
  // composite too — otherwise scope-based tools (time-gaps, scoped search) see 0 lines.
  const handler = getReadHandler();
  return {
    getTotalLines: () => (handler ? handler.getTotalLines() : 0),
    getFilteredLines: () => getFilteredLines(),
    getActiveScope: () => getActiveScope(),
  };
}

function resolveCurrentScope(scope?: ScopeDescriptor | null): ResolvedScope {
  return resolveScope(buildScopeContext(), scope ?? undefined);
}

// Cache FileHandlers by path to avoid re-indexing when switching tabs
const fileHandlerCache = new Map<string, FileHandler>();

// Resolved source (normalized path, format capabilities, decode identity, cache
// cleanup) per opened file. Populated when a file is opened through the adapter
// layer; kept in lockstep with fileHandlerCache so cleanup() runs on
// eviction/close.
const sourceRegistry = new Map<string, NormalizedSource>();

// The decode identity of a file's current adapter, or undefined for plain-text
// passthrough (adapterId 'text' / no decode → marks are always 1:1). Stamped into
// the sidecar as `decodedBy` and compared on open to detect stale marks.
function decodeIdentity(filePath: string): { adapterId: string; decoderVersion: number } | undefined {
  const src = sourceRegistry.get(filePath);
  if (!src || !src.adapterId || src.adapterId === 'text') return undefined;
  return { adapterId: src.adapterId, decoderVersion: src.decoderVersion ?? 0 };
}

// True if the sidecar carries any user/agent marks that could be mispositioned by
// a decoder-layout change.
function hasPinnedMarks(data: LocalFileData): boolean {
  return !!((data.bookmarks && data.bookmarks.length) ||
            (data.annotations && data.annotations.length) ||
            (data.highlights && data.highlights.length));
}

function releaseSource(filePath: string): void {
  const source = sourceRegistry.get(filePath);
  if (source) {
    try { source.cleanup?.(); } catch { /* best-effort cache cleanup */ }
    sourceRegistry.delete(filePath);
  }
}

/** Capabilities of the format backing an open file (text fallback if unknown). */
export function getSourceCapabilities(filePath: string): NormalizedSource['capabilities'] | null {
  return sourceRegistry.get(filePath)?.capabilities ?? null;
}
const MAX_CACHED_FILES = 10; // Limit cache size to prevent memory issues

// File watchers — one per open file path, notifies renderer when content changes
const fileWatchers = new Map<string, fs.FSWatcher>();
const fileWatchDebounce = new Map<string, ReturnType<typeof setTimeout>>();

function startWatchingFile(filePath: string): void {
  if (fileWatchers.has(filePath)) return;
  try {
    const watcher = fs.watch(filePath, { persistent: false }, (event) => {
      if (event !== 'change') return;
      // Debounce — editors often write in multiple flushes
      const existing = fileWatchDebounce.get(filePath);
      if (existing) clearTimeout(existing);
      fileWatchDebounce.set(filePath, setTimeout(() => {
        fileWatchDebounce.delete(filePath);
        mainWindow?.webContents.send('file-changed', filePath);
      }, 300));
    });
    watcher.on('error', () => stopWatchingFile(filePath));
    fileWatchers.set(filePath, watcher);
  } catch { /* file may not exist or not watchable */ }
}

function stopWatchingFile(filePath: string): void {
  const t = fileWatchDebounce.get(filePath);
  if (t) { clearTimeout(t); fileWatchDebounce.delete(filePath); }
  const w = fileWatchers.get(filePath);
  if (w) { try { w.close(); } catch { /* ignore */ } fileWatchers.delete(filePath); }
}

function getFileHandler(): FileHandler | null {
  if (!currentFilePath) return null;
  const handler = fileHandlerCache.get(currentFilePath);
  if (handler) {
    // Move to end for LRU ordering
    fileHandlerCache.delete(currentFilePath);
    fileHandlerCache.set(currentFilePath, handler);
  }
  return handler || null;
}

// Read/search handler for the current view. Returns the active "single session"
// composite when one is open (it shares FileHandler's getLinesAsync/getLinesByNumbers/
// search/getTotalLines/getFileInfo/lastSearch* shape), otherwise the current file's real
// FileHandler. Only the read/search paths (GET_LINES, SEARCH, api getLines/search/status)
// use this; everything else keeps calling getFileHandler() and is a no-op in composite mode.
function getReadHandler(): FileHandler | CompositeFileHandler | SegmentedFileHandler | null {
  if (activeComposite && currentFilePath === activeCompositeId) return activeComposite;
  // A segmented big file shares FileHandler's read/search/severity method shape, so the same
  // GET_LINES/SEARCH/SEVERITY paths carry it. FileHandler-only features (filter, split) call
  // getFileHandler() instead and stay disabled in segmented mode, exactly like composite mode.
  if (activeSegmented && currentFilePath === activeSegmentedPath) return activeSegmented;
  return getFileHandler();
}

// Open each path (reusing the FileHandler cache) and wrap them in a CompositeFileHandler.
// The member handlers stay owned by fileHandlerCache — we deliberately do NOT close them
// when a composite is replaced (that would invalidate the cached, possibly still-open
// files). Only one composite is active at a time.
async function buildComposite(
  filePaths: string[],
  label?: string,
): Promise<{ id: string; info: FileInfo; boundaries: CompositeBoundary[] }> {
  clearActiveSegmented(); // entering composite mode exits any active segmented view
  const members: CompositeMemberHandler[] = [];
  for (const fp of filePaths) {
    let h = fileHandlerCache.get(fp);
    if (h && h.isStale()) { evictFromCache(fp); h = undefined; }
    if (!h) {
      h = new FileHandler();
      const opened = await openWithAdapter(h, fp, () => {});
      sourceRegistry.set(fp, opened.source);
      addToCache(fp, h);
    }
    members.push({ filePath: fp, handler: h });
  }
  // A rebuild with a DIFFERENT file-set must not reuse the previous session's analysis
  // (both cache under the constant composite id). Same-set rebuilds (switch-back) keep it.
  const oldFiles = activeComposite ? activeComposite.boundaries().map((b) => b.filePath) : [];
  const name = label || `Single session (${filePaths.length} files)`;
  activeComposite = new CompositeFileHandler(members, name);
  activeCompositeId = COMPOSITE_ID;
  if (JSON.stringify(oldFiles) !== JSON.stringify(filePaths)) {
    analysisResultCache.delete(COMPOSITE_ID);
  }
  return { id: activeCompositeId, info: activeComposite.getFileInfo(), boundaries: activeComposite.boundaries() };
}

// Get a readable FileHandler for an arbitrary path WITHOUT making it the active file.
// Reuses the cache if the path is already open; otherwise opens+indexes it on demand
// (the agent-verb pattern — buildComposite/mergeTimeline do the same) and caches it so a
// repeat call is cheap. Used by the run-vs-run diff to fold a reference log that isn't
// the active tab. Never mutates currentFilePath / the viewer.
async function getOrOpenHandlerForPath(filePath: string): Promise<FileHandler> {
  let h = fileHandlerCache.get(filePath);
  if (h && h.isStale()) { evictFromCache(filePath); h = undefined; }
  if (!h) {
    h = new FileHandler();
    const opened = await openWithAdapter(h, filePath, () => {});
    sourceRegistry.set(filePath, opened.source);
    addToCache(filePath, h);
  }
  return h;
}

// Fold ANY open handler into its message templates, reusing the SAME dispatch as
// ctx.summarize: off-thread in the trend worker when the handler carries a whole-file
// index, else a batched main-thread scan (segmented files). Shared by the run-vs-run
// diff so both sides fold with identical semantics and are strictly comparable.
async function foldHandlerTemplates(
  handler: FileHandler | CompositeFileHandler | SegmentedFileHandler,
  scopeArg: { kind: 'range'; startLine: number; endLine: number } | { kind: 'indices'; lines: number[] },
  folderOpts: { maxTemplates?: number; maxExamples?: number; detectSeverity?: boolean; detectTimestamp?: boolean },
): Promise<TemplateSummary> {
  if (canSummarizeOffThread(handler)) {
    return await runSummarizeJob(handler, folderOpts, scopeArg);
  }
  const folder = new TemplateFolder(folderOpts);
  feedScope(handler as any, scopeArg, folder);
  return folder.finish();
}

// Open a plain file, make it the active read target, load its sidecars, and tell the
// renderer to display it. Shared by the agent openFile verb and any main-side flow that
// needs to "open this path as the current file" — e.g. the merged wall-clock timeline
// produced by logan_single_session order:"wallclock". Returns the FileInfo.
async function openFileAsCurrent(filePath: string): Promise<FileInfo | null> {
  let fileHandler = fileHandlerCache.get(filePath);
  let info: FileInfo | null;
  // Re-index if the file changed on disk since it was cached (avoids stale content).
  if (fileHandler && fileHandler.isStale()) {
    evictFromCache(filePath);
    fileHandler = undefined;
  }
  if (fileHandler) {
    currentFilePath = filePath;
    info = fileHandler.getFileInfo();
  } else {
    fileHandler = new FileHandler();
    const opened = await openWithAdapter(fileHandler, filePath, () => {});
    info = opened.info;
    sourceRegistry.set(filePath, opened.source);
    addToCache(filePath, fileHandler);
    currentFilePath = filePath;
  }
  loadBookmarksForFile(filePath);
  loadHighlightsForFile(filePath);
  loadAnnotationsForFile(filePath);
  pushAnnotationsToRenderer();
  if (canWriteLocal(filePath)) {
    const localData = loadLocalFileData(filePath);
    localData.lastOpened = new Date().toISOString();
    saveLocalFileData(filePath, localData);
  }
  logActivity(filePath, 'file_opened', { filePath });
  // Notify renderer to load the file in the UI
  mainWindow?.webContents.send('open-file-from-cli', filePath);
  return info;
}

function addToCache(filePath: string, handler: FileHandler): void {
  if (fileHandlerCache.has(filePath)) {
    fileHandlerCache.delete(filePath);
  }
  if (fileHandlerCache.size >= MAX_CACHED_FILES) {
    const firstKey = fileHandlerCache.keys().next().value;
    if (firstKey) {
      const evicted = fileHandlerCache.get(firstKey);
      if (evicted) evicted.close();
      fileHandlerCache.delete(firstKey);
      releaseSource(firstKey);
      stopWatchingFile(firstKey);
    }
  }
  fileHandlerCache.set(filePath, handler);
  startWatchingFile(filePath);
}

function evictFromCache(filePath: string): void {
  const handler = fileHandlerCache.get(filePath);
  if (handler) { handler.close(); fileHandlerCache.delete(filePath); }
  releaseSource(filePath);
  stopWatchingFile(filePath);
}

// In-memory storage
const bookmarks = new Map<string, Bookmark>();
const highlights = new Map<string, Highlight>();
const annotations = new Map<string, Annotation>();

// Config folder path (~/.logan/)
const getConfigDir = () => path.join(os.homedir(), '.logan');
const getHighlightsPath = () => path.join(getConfigDir(), 'highlights.json');
const getHighlightGroupsPath = () => path.join(getConfigDir(), 'highlight-groups.json');
const getBookmarksPath = () => path.join(getConfigDir(), 'bookmarks.json');
const getBookmarkSetsPath = () => path.join(getConfigDir(), 'bookmark-sets.json');
const getAnnotationsStorePath = () => path.join(getConfigDir(), 'annotations.json');

// Ensure config directory exists
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

// === Local .logan/ Persistence ===

function getLocalLoganDir(filePath: string): string {
  return path.join(path.dirname(filePath), '.logan');
}

function getLocalFilePath(filePath: string): string {
  return path.join(getLocalLoganDir(filePath), `${path.basename(filePath)}.json`);
}

function canWriteLocal(filePath: string): boolean {
  try {
    const dir = path.dirname(filePath);
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureLocalLoganDir(filePath: string): boolean {
  if (!canWriteLocal(filePath)) return false;
  try {
    const loganDir = getLocalLoganDir(filePath);
    if (!fs.existsSync(loganDir)) {
      fs.mkdirSync(loganDir, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

function createDefaultLocalFileData(filePath: string): LocalFileData {
  return {
    version: 1,
    logFile: filePath,
    lastOpened: new Date().toISOString(),
    bookmarks: [],
    highlights: [],
    activityHistory: [],
  };
}

function loadLocalFileData(filePath: string): LocalFileData {
  try {
    const localPath = getLocalFilePath(filePath);
    if (fs.existsSync(localPath)) {
      const data = fs.readFileSync(localPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load local file data:', error);
  }
  return createDefaultLocalFileData(filePath);
}

function saveLocalFileData(filePath: string, data: LocalFileData): void {
  try {
    if (!ensureLocalLoganDir(filePath)) return;
    const localPath = getLocalFilePath(filePath);
    // Atomic write: write to temp then rename
    const tmpPath = localPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, localPath);
  } catch (error) {
    console.error('Failed to save local file data:', error);
  }
}

// Track whether current file uses local storage or fallback
let currentFileUsesLocalStorage = false;

// Recent files (global, for quick re-open)
const RECENT_FILES_CAP = 20;

function getRecentFilesPath(): string {
  return path.join(os.homedir(), '.logan', 'recent-files.json');
}

function loadRecentFiles(): Array<{ path: string; lastOpened: number }> {
  try {
    const data = fs.readFileSync(getRecentFilesPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* missing or invalid */ }
  return [];
}

function saveRecentFiles(list: Array<{ path: string; lastOpened: number }>): void {
  try {
    const dir = path.join(os.homedir(), '.logan');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getRecentFilesPath(), JSON.stringify(list, null, 2));
  } catch { /* ignore */ }
}

function addToRecentFiles(filePath: string): void {
  const list = loadRecentFiles().filter(e => e.path !== filePath);
  list.unshift({ path: filePath, lastOpened: Date.now() });
  if (list.length > RECENT_FILES_CAP) list.length = RECENT_FILES_CAP;
  saveRecentFiles(list);
}

// Recent folders
const RECENT_FOLDERS_CAP = 15;

function getRecentFoldersPath(): string {
  return path.join(os.homedir(), '.logan', 'recent-folders.json');
}

function loadRecentFolders(): Array<{ path: string; lastOpened: number }> {
  try {
    const data = fs.readFileSync(getRecentFoldersPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* missing or invalid */ }
  return [];
}

function saveRecentFolders(list: Array<{ path: string; lastOpened: number }>): void {
  try {
    const dir = path.join(os.homedir(), '.logan');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getRecentFoldersPath(), JSON.stringify(list, null, 2));
  } catch { /* ignore */ }
}

function addToRecentFolders(folderPath: string): void {
  const list = loadRecentFolders().filter(e => e.path !== folderPath);
  list.unshift({ path: folderPath, lastOpened: Date.now() });
  if (list.length > RECENT_FOLDERS_CAP) list.length = RECENT_FOLDERS_CAP;
  saveRecentFolders(list);
}

// Activity history logging
const ACTIVITY_HISTORY_CAP = 500;
const ACTIVITY_HISTORY_TRIM_TO = 400;

function logActivity(filePath: string, action: ActivityEntry['action'], details: Record<string, unknown>): void {
  // Count every recorded human action for the Usage Monitor (before the
  // canWriteLocal gate, so read-only-dir sessions still get counted; usage
  // stats live in the global ~/.logan/usage.json, not the per-file sidecar).
  // Suppress the human bump while an AI api-call is in flight — the same ctx
  // code paths serve the agent, and the AI verb is already counted by the
  // api-server 'ai' tap. Without this, an AI /api/search would double-count as
  // human::search, corrupting the human/AI split.
  if (!isAiContext()) bumpUsage(canonicalizeHumanVerb(action), 'human');
  if (!canWriteLocal(filePath)) return;
  try {
    const data = loadLocalFileData(filePath);
    const entry: ActivityEntry = {
      timestamp: new Date().toISOString(),
      action,
      details,
    };
    data.activityHistory.push(entry);
    // Cap at ACTIVITY_HISTORY_CAP, trim oldest to ACTIVITY_HISTORY_TRIM_TO
    if (data.activityHistory.length > ACTIVITY_HISTORY_CAP) {
      data.activityHistory = data.activityHistory.slice(-ACTIVITY_HISTORY_TRIM_TO);
    }
    saveLocalFileData(filePath, data);
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

// Record a real pattern APPLICATION (a search or filter run) into the Pattern Log
// flight recorder. operator is derived from the AI-context flag — the same gate
// logActivity() uses — so BOTH the human IPC paths and the AI /api paths feed the
// log through one choke point (before this, only "Make pattern…" fed it, so
// normal + all AI pattern use was invisible). Skips empty patterns (e.g. a
// level-only filter has nothing to record). Never throws (patternLog swallows).
function recordPatternApplication(a: {
  scope: string; source: string; mode?: string;
  scanned: number; matched: number; hid?: number;
  sampleHits?: number[]; ms?: number; capped?: boolean;
  valid?: boolean; error?: string;
}): void {
  if (!a.source) return;
  logPattern({
    operator: isAiContext() ? 'ai' : 'human',
    mode: a.mode ?? 'plain',
    source: a.source,
    scope: a.scope,
    scanned: a.scanned,
    matched: a.matched,
    hid: a.hid ?? 0,
    sampleHits: a.sampleHits ?? [],
    ms: a.ms ?? 0,
    capped: a.capped ?? false,
    valid: a.valid ?? true,
    error: a.error,
  });
}

// Collapse a filter config's include patterns into a single loggable source
// string. Level-only filters (no include patterns) return '' → not recorded.
function summarizeFilterPatterns(config: any): string {
  const inc = Array.isArray(config?.includePatterns) ? config.includePatterns : [];
  return inc
    .map((p: any) => (typeof p === 'string' ? p : (p && p.pattern) || ''))
    .filter(Boolean)
    .join(' | ');
}

// Bookmarks storage structure: { "/path/to/file.log": [bookmark1, bookmark2, ...] }
interface BookmarksStore {
  [filePath: string]: Bookmark[];
}

// Highlights storage structure: { "_global": [...], "/path/to/file.log": [...] }
// _global key stores highlights that apply to all files
const GLOBAL_HIGHLIGHTS_KEY = '_global';
interface HighlightsStore {
  [key: string]: Highlight[]; // key is either "_global" or file path
}

// Color palette for auto-assignment
const COLOR_PALETTE = [
  '#ffff00', // Yellow
  '#ff9900', // Orange
  '#00ff00', // Green
  '#00ffff', // Cyan
  '#ff00ff', // Magenta
  '#ff6b6b', // Coral
  '#4ecdc4', // Teal
  '#a55eea', // Purple
  '#26de81', // Mint
  '#fd79a8', // Pink
];

function getNextColor(): string {
  const usedColors = Array.from(highlights.values()).map(h => h.backgroundColor);
  for (const color of COLOR_PALETTE) {
    if (!usedColors.includes(color)) {
      return color;
    }
  }
  // If all colors used, return random from palette
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

// Load all highlights from config file
function loadHighlightsStore(): HighlightsStore {
  try {
    ensureConfigDir();
    const configPath = getHighlightsPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(data);
      // Handle migration from old format (array) to new format (object)
      if (Array.isArray(parsed)) {
        // Old format: treat all as global
        return { [GLOBAL_HIGHLIGHTS_KEY]: parsed };
      }
      return parsed;
    }
  } catch (error) {
    console.error('Failed to load highlights config:', error);
  }
  return {};
}

// Save all highlights to config file
function saveHighlightsStore(store: HighlightsStore): void {
  try {
    ensureConfigDir();
    const configPath = getHighlightsPath();
    // Clean up empty arrays
    const cleanStore: HighlightsStore = {};
    for (const [key, value] of Object.entries(store)) {
      if (value.length > 0) {
        cleanStore[key] = value;
      }
    }
    const data = JSON.stringify(cleanStore, null, 2);
    fs.writeFileSync(configPath, data, 'utf-8');
  } catch (error) {
    console.error('Failed to save highlights config:', error);
  }
}

// Load highlights for a specific file (combines global + file-specific)
function loadHighlightsForFile(filePath: string): void {
  highlights.clear();
  const store = loadHighlightsStore();

  // Load global highlights from ~/.logan/ (always)
  const globalHighlights = store[GLOBAL_HIGHLIGHTS_KEY] || [];
  for (const h of globalHighlights) {
    highlights.set(h.id, { ...h, isGlobal: true });
  }

  if (canWriteLocal(filePath)) {
    // Load file-specific highlights from local .logan/
    const localData = loadLocalFileData(filePath);

    if (localData.highlights.length > 0) {
      for (const h of localData.highlights) {
        highlights.set(h.id, { ...h, isGlobal: false });
      }
    } else {
      // Check global store for migration
      const fileHighlights = store[filePath] || [];
      if (fileHighlights.length > 0) {
        // Migrate: copy to local, remove from global
        for (const h of fileHighlights) {
          highlights.set(h.id, { ...h, isGlobal: false });
        }
        localData.highlights = fileHighlights;
        saveLocalFileData(filePath, localData);
        delete store[filePath];
        saveHighlightsStore(store);
      }
    }
  } else {
    // Fallback: load file-specific from global store
    const fileHighlights = store[filePath] || [];
    for (const h of fileHighlights) {
      highlights.set(h.id, { ...h, isGlobal: false });
    }
  }
}

// Save a highlight (to global or file-specific storage)
function saveHighlight(highlight: Highlight): void {
  if (!currentFilePath && !highlight.isGlobal) return;

  if (highlight.isGlobal) {
    // Global highlights always go to ~/.logan/highlights.json
    const store = loadHighlightsStore();
    // Remove old version from all keys in global store
    for (const k of Object.keys(store)) {
      store[k] = store[k].filter(h => h.id !== highlight.id);
    }
    if (!store[GLOBAL_HIGHLIGHTS_KEY]) {
      store[GLOBAL_HIGHLIGHTS_KEY] = [];
    }
    store[GLOBAL_HIGHLIGHTS_KEY].push(highlight);
    saveHighlightsStore(store);

    // Also remove from local if it was previously file-specific
    if (currentFilePath && currentFileUsesLocalStorage) {
      const localData = loadLocalFileData(currentFilePath);
      localData.highlights = localData.highlights.filter(h => h.id !== highlight.id);
      saveLocalFileData(currentFilePath, localData);
    }
  } else if (currentFilePath && currentFileUsesLocalStorage) {
    // File-specific → local .logan/
    const localData = loadLocalFileData(currentFilePath);
    localData.highlights = localData.highlights.filter(h => h.id !== highlight.id);
    localData.highlights.push(highlight);
    saveLocalFileData(currentFilePath, localData);

    // Remove from global store if it was previously global
    const store = loadHighlightsStore();
    let changed = false;
    for (const k of Object.keys(store)) {
      const before = store[k].length;
      store[k] = store[k].filter(h => h.id !== highlight.id);
      if (store[k].length !== before) changed = true;
    }
    if (changed) saveHighlightsStore(store);
  } else {
    // Fallback to global store (read-only directory)
    const store = loadHighlightsStore();
    for (const k of Object.keys(store)) {
      store[k] = store[k].filter(h => h.id !== highlight.id);
    }
    const key = currentFilePath!;
    if (!store[key]) store[key] = [];
    store[key].push(highlight);
    saveHighlightsStore(store);
  }
}

// Remove a highlight from storage
function removeHighlightFromStore(highlightId: string): void {
  // Remove from global store
  const store = loadHighlightsStore();
  let globalChanged = false;
  for (const key of Object.keys(store)) {
    const before = store[key].length;
    store[key] = store[key].filter(h => h.id !== highlightId);
    if (store[key].length !== before) globalChanged = true;
  }
  if (globalChanged) saveHighlightsStore(store);

  // Remove from local .logan/ if applicable
  if (currentFilePath && currentFileUsesLocalStorage) {
    const localData = loadLocalFileData(currentFilePath);
    const before = localData.highlights.length;
    localData.highlights = localData.highlights.filter(h => h.id !== highlightId);
    if (localData.highlights.length !== before) {
      saveLocalFileData(currentFilePath, localData);
    }
  }
}

// Load all bookmarks from config file
function loadBookmarksStore(): BookmarksStore {
  try {
    ensureConfigDir();
    const configPath = getBookmarksPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load bookmarks config:', error);
  }
  return {};
}

// Save all bookmarks to config file
function saveBookmarksStore(store: BookmarksStore): void {
  try {
    ensureConfigDir();
    const configPath = getBookmarksPath();
    const data = JSON.stringify(store, null, 2);
    fs.writeFileSync(configPath, data, 'utf-8');
  } catch (error) {
    console.error('Failed to save bookmarks config:', error);
  }
}

// Load bookmarks for a specific file into memory
function loadBookmarksForFile(filePath: string): void {
  bookmarks.clear();

  if (canWriteLocal(filePath)) {
    currentFileUsesLocalStorage = true;
    const localData = loadLocalFileData(filePath);

    if (localData.bookmarks.length > 0) {
      // Load from local .logan/
      for (const b of localData.bookmarks) {
        bookmarks.set(b.id, b);
      }
    } else {
      // Check global store for migration
      const store = loadBookmarksStore();
      const globalBookmarks = store[filePath] || [];
      if (globalBookmarks.length > 0) {
        // Migrate: copy to local, remove from global
        for (const b of globalBookmarks) {
          bookmarks.set(b.id, b);
        }
        localData.bookmarks = globalBookmarks;
        saveLocalFileData(filePath, localData);
        delete store[filePath];
        saveBookmarksStore(store);
      }
    }
  } else {
    // Fallback: read-only directory, use global store
    currentFileUsesLocalStorage = false;
    const store = loadBookmarksStore();
    const fileBookmarks = store[filePath] || [];
    for (const b of fileBookmarks) {
      bookmarks.set(b.id, b);
    }
  }

  currentFilePath = filePath;
}

// Save current bookmarks to the store for the current file
function saveBookmarksForCurrentFile(): void {
  if (!currentFilePath) return;

  const currentBookmarks = Array.from(bookmarks.values())
    .sort((a, b) => a.lineNumber - b.lineNumber);

  if (currentFileUsesLocalStorage) {
    // Save to local .logan/
    const localData = loadLocalFileData(currentFilePath);
    localData.bookmarks = currentBookmarks;
    saveLocalFileData(currentFilePath, localData);
  } else {
    // Fallback to global store
    const store = loadBookmarksStore();
    if (currentBookmarks.length > 0) {
      store[currentFilePath] = currentBookmarks;
    } else {
      delete store[currentFilePath];
    }
    saveBookmarksStore(store);
  }
}

// --- Agent Annotations ---

// Global fallback store for annotations, mirroring the bookmarks store: a per-file map
// in ~/.logan used when the log's OWN directory isn't writable — e.g. a virtual
// single-session/composite ("merged session"), whose synthetic path (COMPOSITE_ID) has
// no on-disk sidecar. Without this, composite annotations couldn't persist OR reload
// (loadAnnotationsForFile gated the whole load on canWriteLocal), so they vanished the
// moment you switched to another file and never came back.
interface AnnotationsStore { [filePath: string]: Annotation[]; }
function loadAnnotationsStore(): AnnotationsStore {
  try {
    ensureConfigDir();
    const p = getAnnotationsStorePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (error) {
    console.error('Failed to load annotations store:', error);
  }
  return {};
}
function saveAnnotationsStore(store: AnnotationsStore): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(getAnnotationsStorePath(), JSON.stringify(store, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save annotations store:', error);
  }
}

function loadAnnotationsForFile(filePath: string): void {
  annotations.clear();
  if (canWriteLocal(filePath)) {
    const localData = loadLocalFileData(filePath);
    const localAnns = localData.annotations || [];
    if (localAnns.length > 0) {
      for (const a of localAnns) annotations.set(a.id, a);
    } else {
      // Migrate any annotations parked in the global store (e.g. saved while this file
      // lived on a read-only mount) into the local sidecar — mirrors bookmarks.
      const store = loadAnnotationsStore();
      const globalAnns = store[filePath] || [];
      if (globalAnns.length > 0) {
        for (const a of globalAnns) annotations.set(a.id, a);
        localData.annotations = globalAnns;
        saveLocalFileData(filePath, localData);
        delete store[filePath];
        saveAnnotationsStore(store);
      }
    }
  } else {
    // Read-only / virtual path (e.g. a single-session composite) → global keyed store,
    // so annotations persist and reload across tab switches instead of disappearing.
    const store = loadAnnotationsStore();
    for (const a of (store[filePath] || [])) annotations.set(a.id, a);
  }
}

function saveAnnotationsForCurrentFile(): void {
  if (!currentFilePath) return;
  const list = Array.from(annotations.values()).sort((a, b) => a.lineNumber - b.lineNumber);
  if (currentFileUsesLocalStorage) {
    const localData = loadLocalFileData(currentFilePath);
    localData.annotations = list;
    saveLocalFileData(currentFilePath, localData);
  } else {
    // Read-only / virtual path → global keyed store (the same fallback bookmarks use).
    const store = loadAnnotationsStore();
    if (list.length > 0) store[currentFilePath] = list;
    else delete store[currentFilePath];
    saveAnnotationsStore(store);
  }
}

function pushAnnotationsToRenderer(): void {
  const list = Array.from(annotations.values()).sort((a, b) => a.lineNumber - b.lineNumber);
  mainWindow?.webContents.send('annotations-changed', list);
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    frame: false,
    ...(isMac ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 10, y: 6 },
    } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
    },
    title: 'LOGAN - Log Analyzer',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close all cached file handlers
    for (const handler of fileHandlerCache.values()) {
      handler.close();
    }
    fileHandlerCache.clear();
    for (const filePath of [...sourceRegistry.keys()]) releaseSource(filePath);
  });
}

// The folder LOGAN was launched pointing at (`logan ./logs/` / `--` arg / /api/open-folder).
// Becomes the AI agent's working directory + is injected into its bootstrap prompt so the
// agent starts working on that folder. Null when launched without a folder.
let contextFolder: string | null = null;

// --- Single-instance lock (skipped on Linux — can SIGSEGV on some setups) ---
if (process.platform !== 'linux') {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  }
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const target = extractPathFromArgv(argv);
    if (target && mainWindow) {
      if (target.isDirectory) contextFolder = target.path;
      mainWindow.webContents.send(target.isDirectory ? 'open-folder-from-cli' : 'open-file-from-cli', target.path);
    }
  });
}

// Resolve a launch argument to a file OR directory to open as initial context.
// e.g. `logan myfile.log` (file) or `logan ./logs/` (folder).
function extractPathFromArgv(argv: string[]): { path: string; isDirectory: boolean } | null {
  const classify = (p: string): { path: string; isDirectory: boolean } | null => {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) return { path: p, isDirectory: true };
      if (st.isFile()) return { path: p, isDirectory: false };
    } catch { /* not a real path */ }
    return null;
  };

  // launchPathCandidates() excludes Electron's own app-path argument (the "." in a dev
  // `electron .` launch) so `npm start` from inside the repo doesn't open the repo as a folder.
  let appPath: string | null = null;
  try { appPath = app.getAppPath(); } catch { /* app not ready — fine */ }
  for (const cand of launchPathCandidates(argv, appPath, !!process.defaultApp)) {
    const c = classify(cand);
    if (c) return c;
  }
  return null;
}

app.whenReady().then(() => {
  ensureConfigDir();
  createWindow();

  // On Linux, pre-warm the XDG desktop portal so the first file-open dialog
  // is responsive immediately. Without this, the portal's D-Bus service may
  // not be activated yet, causing the file chooser widget to appear but not
  // accept clicks until the service finishes initializing.
  if (process.platform === 'linux') {
    try {
      spawn('gdbus', [
        'introspect', '--session',
        '--dest', 'org.freedesktop.portal.Desktop',
        '--object-path', '/org/freedesktop/portal/desktop',
      ], { stdio: 'ignore' }).unref();
    } catch { /* non-critical — dialog still works on retry */ }
  }

  // Check if launched with a file OR folder argument
  // (e.g. `logan myfile.log` or `logan ./logs/`).
  const cliTarget = extractPathFromArgv(process.argv);
  if (cliTarget && mainWindow) {
    if (cliTarget.isDirectory) contextFolder = cliTarget.path;
    mainWindow.once('ready-to-show', () => {
      // Small delay to let renderer finish init
      setTimeout(() => {
        mainWindow?.webContents.send(
          cliTarget.isDirectory ? 'open-folder-from-cli' : 'open-file-from-cli',
          cliTarget.path,
        );
        // Launched pointing at a folder → also start the AI agent working on it, but
        // only if the user has actually configured an agent (agent-config.json exists).
        // No config → no surprise process spawn. Given a short beat so the renderer has
        // opened the folder and the API server is ready before the agent connects.
        if (cliTarget.isDirectory && !agentProcess && hasConfiguredAgent()) {
          setTimeout(() => { void launchAgentProcess(false); }, 800);
        }
      }, 300);
    });
  }

  // Start HTTP API server for MCP integration
  apiContext = {
    getMainWindow: () => mainWindow,
    getCurrentFilePath: () => currentFilePath,
    getFileHandler: () => getFileHandler(),
    getReadHandler: () => getReadHandler(),
    getFileHandlerForPath: (fp: string) => fileHandlerCache.get(fp) || null,
    getFilteredLines: () => getFilteredLines(),
    resolveScope: (scope?: ScopeDescriptor) => resolveCurrentScope(scope),
    extractFilteredToFile: (opts?: { includeLineNumbers?: boolean; columnConfig?: ColumnConfig }) => runFilteredExtract(opts),
    getBookmarks: () => bookmarks,
    getHighlights: () => highlights,
    openFile: async (filePath: string) => {
      // Reuse the same logic as the IPC.OPEN_FILE handler (shared openFileAsCurrent).
      const info = await openFileAsCurrent(filePath);
      return { success: true, info };
    },
    openFolder: async (folderPath: string) => {
      let st: fs.Stats | null = null;
      try { st = fs.statSync(folderPath); } catch { /* not a path */ }
      if (!st || !st.isDirectory()) return { success: false, error: 'Folder not found' };
      // Same context folder a `logan ./logs/` launch records — the next agent launch
      // uses it as cwd/prompt. The renderer roots the Folders panel on it.
      contextFolder = folderPath;
      mainWindow?.webContents.send('open-folder-from-cli', folderPath);
      return { success: true, folderPath };
    },
    getLines: (startLine: number, count: number) => {
      const handler = getReadHandler();
      if (!handler) return { success: false, error: 'No file open' };
      const filteredIndices = getFilteredLines();
      if (filteredIndices) {
        const endIdx = Math.min(startLine + count, filteredIndices.length);
        const lineNumbers = filteredIndices.slice(startLine, endIdx);
        const lines = [];
        for (const lineNum of lineNumbers) {
          const [line] = handler.getLines(lineNum, 1);
          if (line) lines.push(line);
        }
        return { success: true, lines };
      }
      const lines = handler.getLines(startLine, count);
      return { success: true, lines };
    },
    search: async (options: SearchOptions & { scope?: ScopeDescriptor }) => {
      const handler = getReadHandler();
      if (!handler) return { success: false, error: 'No file open' };
      searchSignal = { cancelled: false };
      const t0 = Date.now();
      try {
        let matches = await handler.search(options, () => {}, searchSignal);
        // Scope = "search within this subset": keep only matches whose line is in scope.
        let scopeMeta: ReturnType<typeof scopeInfo> | undefined;
        if (options.scope && options.scope.type !== 'all') {
          const resolved = resolveCurrentScope(options.scope);
          scopeMeta = scopeInfo(resolved);
          const inScope = resolved.kind === 'range'
            ? (ln: number) => ln >= resolved.startLine && ln <= resolved.endLine
            : ((set) => (ln: number) => set.has(ln))(new Set(resolved.lines));
          matches = matches.filter(m => inScope(m.lineNumber));
        }
        if (currentFilePath) logActivity(currentFilePath, 'search', { pattern: options.pattern, isRegex: options.isRegex, matchCount: matches.length });
        recordPatternApplication({
          scope: 'search', source: options.pattern || '', mode: options.isRegex ? 'regex' : 'plain',
          scanned: handler.getTotalLines(), matched: matches.length,
          sampleHits: matches.slice(0, 5).map(m => m.lineNumber + 1), ms: Date.now() - t0,
        });
        return { success: true, matches, ...(scopeMeta ? { scope: scopeMeta } : {}) };
      } catch (error) {
        recordPatternApplication({
          scope: 'search', source: options.pattern || '', mode: options.isRegex ? 'regex' : 'plain',
          scanned: 0, matched: 0, ms: Date.now() - t0, valid: false, error: String(error),
        });
        return { success: false, error: String(error) };
      }
    },
    analyze: async (analyzerName?: string, scope?: ScopeDescriptor) => {
      if (!currentFilePath) return { success: false, error: 'No file open' };
      const handler = getFileHandler();
      const resolved = resolveCurrentScope(scope);
      const total = handler ? handler.getTotalLines() : 0;

      // Scoped analysis: run the shared classifier over only the resolved subset.
      // Does NOT overwrite the whole-file analysis cache used for baselines.
      if (handler && scope && scope.type !== 'all' && !isWholeFile(resolved, total)) {
        const fmt = await detectLogFormat(currentFilePath).catch(() => ({ columns: [], logcat: false }));
        const result = analyzeScope(handler, resolved, fmt.columns, 'column-aware-scoped', fmt.logcat);
        logActivity(currentFilePath, 'analysis_run', { analyzerName: 'column-aware-scoped', scope: resolved.label });
        return { success: true, result, scope: scopeInfo(resolved) };
      }

      // Whole-file analysis (unchanged) — caches for the baseline step.
      const analyzer = analyzerName ? analyzerRegistry.get(analyzerName) : analyzerRegistry.getDefault();
      if (!analyzer) return { success: false, error: 'Analyzer not found' };
      analyzeSignal = { cancelled: false };
      try {
        const result = await analyzeCurrentTarget(analyzer, {}, () => {}, analyzeSignal);
        logActivity(currentFilePath, 'analysis_run', { analyzerName: analyzer.name });
        cacheAnalysisResult(currentFilePath, result);
        return { success: true, result, scope: scopeInfo(resolved) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    applyFilter: async (config: any) => {
      const handler = getFileHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      filterSignal = { cancelled: false };
      const tFilter0 = Date.now();
      try {
        const totalLines = handler.getTotalLines();
        const matchingLines: Set<number> = new Set();
        const batchSize = 10000;
        for (let start = 0; start < totalLines; start += batchSize) {
          if (filterSignal.cancelled) return { success: false, error: 'Cancelled' };
          const count = Math.min(batchSize, totalLines - start);
          const lines = handler.getLines(start, count);
          for (const line of lines) {
            let matches = true;
            const lineLevel = line.level || 'other';
            if (config.levels && config.levels.length > 0) {
              matches = config.levels.includes(lineLevel);
            }
            if (matches && config.includePatterns && config.includePatterns.length > 0) {
              matches = config.includePatterns.some((p: any) => {
                const pattern = typeof p === 'string' ? p : p.pattern;
                const cs = typeof p === 'string' ? (config.matchCase || false) : p.caseSensitive;
                try { return new RegExp(pattern, cs ? '' : 'i').test(line.text); }
                catch { return cs ? line.text.includes(pattern) : line.text.toLowerCase().includes(pattern.toLowerCase()); }
              });
            }
            if (matches && config.excludePatterns && config.excludePatterns.length > 0) {
              const excluded = config.excludePatterns.some((p: string) => {
                try { return new RegExp(p, config.matchCase ? '' : 'i').test(line.text); }
                catch { return line.text.toLowerCase().includes(p.toLowerCase()); }
              });
              if (excluded) matches = false;
            }
            if (matches) matchingLines.add(line.lineNumber);
          }
        }
        const sortedLines = Array.from(matchingLines).sort((a, b) => a - b);
        filterState.set(currentFilePath, sortedLines);
        logActivity(currentFilePath, 'filter_applied', { levels: config.levels, filteredLines: sortedLines.length });
        recordPatternApplication({
          scope: 'filter', source: summarizeFilterPatterns(config), mode: 'regex',
          scanned: totalLines, matched: sortedLines.length,
          hid: Math.max(0, totalLines - sortedLines.length), ms: Date.now() - tFilter0,
        });
        return { success: true, stats: { filteredLines: sortedLines.length } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    clearFilter: () => {
      if (currentFilePath) {
        filterState.delete(currentFilePath);
        logActivity(currentFilePath, 'filter_cleared', {});
      }
      return { success: true };
    },
    addBookmark: (bookmark: Bookmark) => {
      bookmarks.set(bookmark.id, bookmark);
      saveBookmarksForCurrentFile();
      if (currentFilePath) logActivity(currentFilePath, 'bookmark_added', { lineNumber: bookmark.lineNumber, label: bookmark.label });
      return { success: true };
    },
    removeBookmark: (id: string) => {
      bookmarks.delete(id);
      saveBookmarksForCurrentFile();
      if (currentFilePath) logActivity(currentFilePath, 'bookmark_removed', { bookmarkId: id });
      return { success: true };
    },
    updateBookmark: (bookmark: Bookmark) => {
      if (!bookmarks.has(bookmark.id)) return { success: false, error: 'Bookmark not found' };
      bookmarks.set(bookmark.id, bookmark);
      saveBookmarksForCurrentFile();
      return { success: true };
    },
    clearBookmarks: () => {
      const count = bookmarks.size;
      bookmarks.clear();
      saveBookmarksForCurrentFile();
      if (currentFilePath && count > 0) logActivity(currentFilePath, 'bookmark_cleared', { count });
      return { success: true };
    },
    addHighlight: (highlight: Highlight) => {
      highlights.set(highlight.id, highlight);
      saveHighlight(highlight);
      if (currentFilePath) logActivity(currentFilePath, 'highlight_added', { pattern: highlight.pattern, isGlobal: !!highlight.isGlobal });
      return { success: true };
    },
    removeHighlight: (id: string) => {
      highlights.delete(id);
      removeHighlightFromStore(id);
      if (currentFilePath) logActivity(currentFilePath, 'highlight_removed', { highlightId: id });
      return { success: true };
    },
    updateHighlight: (highlight: Highlight) => {
      if (!highlights.has(highlight.id)) return { success: false, error: 'Highlight not found' };
      highlights.set(highlight.id, highlight);
      saveHighlight(highlight);
      return { success: true };
    },
    clearHighlights: () => {
      highlights.clear();
      saveHighlightsStore({});
      if (currentFilePath && currentFileUsesLocalStorage) {
        const localData = loadLocalFileData(currentFilePath);
        localData.highlights = [];
        saveLocalFileData(currentFilePath, localData);
      }
      return { success: true };
    },
    getAnnotations: () => annotations,
    addAnnotation: (annotation: Annotation) => {
      annotations.set(annotation.id, annotation);
      saveAnnotationsForCurrentFile();
      if (currentFilePath) logActivity(currentFilePath, 'annotation_added', { lineNumber: annotation.lineNumber, agentName: annotation.agentName });
      pushAnnotationsToRenderer();
      return { success: true };
    },
    addAnnotations: (anns: Annotation[]) => {
      for (const a of anns) annotations.set(a.id, a);
      saveAnnotationsForCurrentFile();
      if (currentFilePath) logActivity(currentFilePath, 'annotation_added', { count: anns.length, agentName: anns[0]?.agentName });
      pushAnnotationsToRenderer();
      return { success: true, count: anns.length };
    },
    updateAnnotation: (id: string, patch: Partial<Annotation>) => {
      const a = annotations.get(id);
      if (!a) return { success: false, error: 'not found' };
      annotations.set(id, { ...a, ...patch, id: a.id });
      saveAnnotationsForCurrentFile();
      pushAnnotationsToRenderer();
      return { success: true };
    },
    clearHandoff: (handoffId: string) => {
      for (const [id, a] of annotations) if (a.handoffId === handoffId) annotations.delete(id);
      saveAnnotationsForCurrentFile();
      pushAnnotationsToRenderer();
      return { success: true };
    },
    removeAnnotation: (id: string) => {
      annotations.delete(id);
      saveAnnotationsForCurrentFile();
      pushAnnotationsToRenderer();
      return { success: true };
    },
    clearAnnotations: () => {
      annotations.clear();
      saveAnnotationsForCurrentFile();
      pushAnnotationsToRenderer();
      return { success: true };
    },
    loadNotes: async () => {
      if (!currentFilePath) return { success: false, error: 'No file open' };
      const notesPath = path.join(getLocalLoganDir(currentFilePath),
        path.basename(currentFilePath) + '.notes.txt');
      try {
        const content = fs.readFileSync(notesPath, 'utf-8');
        return { success: true, content };
      } catch {
        return { success: true, content: '' };
      }
    },
    getAgentMemory: () => getAgentMemory(currentFilePath),
    saveAgentMemory: (content: string, agentName?: string) =>
      saveAgentMemory(currentFilePath, content, agentName),
    clearAgentMemory: () => clearAgentMemory(currentFilePath),
    getContextManifest: () => getContextManifest(currentFilePath),
    attachContextManifest: (patch, opts) => {
      const existing = getContextManifest(currentFilePath);
      const merged = mergeFacts(existing, patch || {}, {
        provenance: opts?.provenance,
        source: opts?.source,
        replace: opts?.replace,
        agentName: opts?.agentName,
        now: Date.now(),
      });
      const ok = saveContextManifestFile(currentFilePath, merged);
      return { success: ok, manifest: ok ? merged : null, facts: ok ? factCount(merged) : 0 };
    },
    clearContextManifest: () => ({ success: clearContextManifestFile(currentFilePath) }),
    saveNotes: async (content: string) => {
      if (!currentFilePath) return { success: false, error: 'No file open' };
      if (!ensureLocalLoganDir(currentFilePath)) {
        return { success: false, error: 'Cannot write to local .logan/ directory' };
      }
      const notesPath = path.join(getLocalLoganDir(currentFilePath),
        path.basename(currentFilePath) + '.notes.txt');
      fs.writeFileSync(notesPath, content, 'utf-8');
      return { success: true };
    },
    saveReport: async (fileName: string, content: string) => {
      if (!currentFilePath) return { success: false, error: 'No file open' };
      // Prefer the file's sidecar .logan/reports/; if that dir isn't writable
      // (read-only mount), fall back to the global ~/.logan/reports/<basename>/.
      let reportsDir: string;
      if (ensureLocalLoganDir(currentFilePath)) {
        reportsDir = path.join(getLocalLoganDir(currentFilePath), 'reports');
      } else {
        reportsDir = path.join(os.homedir(), '.logan', 'reports', path.basename(currentFilePath));
      }
      try {
        fs.mkdirSync(reportsDir, { recursive: true });
        const reportPath = path.join(reportsDir, fileName);
        fs.writeFileSync(reportPath, content, 'utf-8');
        return { success: true, filePath: reportPath };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Failed to write report' };
      }
    },
    detectTimeGaps: async (options: any) => {
      const handler = getReadHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      timeGapSignal = { cancelled: false };
      try {
        const thresholdSeconds = options.thresholdSeconds || 30;
        const resolved = resolveCurrentScope(options.scope);
        const detector = new GapDetector(thresholdSeconds, 500);
        let cancelled = false;
        let scanned = 0;
        forEachScopeLine(handler, resolved, (text, lineNumber) => {
          if (timeGapSignal.cancelled) { cancelled = true; return false; }
          detector.feed(lineNumber, text);
          scanned++;
          return !detector.full; // stop once we've hit the gap cap
        });
        if (cancelled) return { success: false, error: 'Cancelled' };
        const gaps = detector.sorted();
        logActivity(currentFilePath, 'time_gap_analysis', { threshold: thresholdSeconds, gapsFound: gaps.length, scope: resolved.label });
        return { success: true, gaps, totalLines: scanned, scope: scopeInfo(resolved) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    // Summarize (semantic compression): fold the scanned lines into their distinct
    // message templates via the shared TemplateFolder. Scans the active scope
    // (whole file / filter / range / indices) resolved through getReadHandler.
    // The fold is CPU-bound and reads the whole file, so it runs OFF the main
    // thread in the trend worker (kind:'summarize') — the Electron UI never blocks
    // and ⏹ Cancel can terminate it. Auto-segmented files hold no whole-file index
    // to hand the worker, so they fall back to the (batched) main-thread scan.
    // viewerLine is 1-based (scan lineNumber is 0-based).
    summarize: async (opts?: any, scope?: ScopeDescriptor) => {
      const handler = getReadHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      summarizeSignal = { cancelled: false };
      try {
        const resolved = resolveCurrentScope(scope);
        const folderOpts = {
          maxTemplates: opts?.maxTemplates,
          maxExamples: opts?.maxExamples,
          detectSeverity: opts?.detectSeverity,
          detectTimestamp: opts?.detectTimestamp,
        };
        let summary: TemplateSummary;
        if (canSummarizeOffThread(handler)) {
          // Off-thread: hand the resolved scope (range or explicit index-set) to the worker.
          const scopeArg = resolved.kind === 'range'
            ? { kind: 'range' as const, startLine: resolved.startLine, endLine: resolved.endLine }
            : { kind: 'indices' as const, lines: resolved.lines };
          try {
            summary = await runSummarizeJob(handler, folderOpts, scopeArg);
          } catch (e) {
            if (String(e).includes('Cancelled')) return { success: false, error: 'Cancelled' };
            throw e;
          }
        } else {
          // Segmented fallback: batched scan on the main thread (rare path).
          const folder = new TemplateFolder(folderOpts);
          let cancelled = false;
          forEachScopeLine(handler, resolved, (text, lineNumber) => {
            if (summarizeSignal.cancelled) { cancelled = true; return false; }
            folder.feed(text, lineNumber + 1);
            return true;
          });
          if (cancelled) return { success: false, error: 'Cancelled' };
          summary = folder.finish();
        }
        // Optional post-filter view: keep only templates whose shape contains
        // `contains` (case-insensitive). A lens over the fold — the full-run
        // counts/coverage/«other» are unchanged; `matchedTemplates` reports the view.
        if (opts?.contains) {
          const needle = String(opts.contains).toLowerCase();
          const kept = summary.templates.filter((t) => t.shape.toLowerCase().includes(needle));
          summary = { ...summary, templates: kept, matchedTemplates: kept.length } as typeof summary & { matchedTemplates: number };
        }
        logActivity(currentFilePath, 'summarize', { templates: summary.templates.length, totalLines: summary.totalLines, capped: summary.capped, scope: resolved.label });
        return { success: true, summary, scope: scopeInfo(resolved) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    // Fold-region detection (in-place viewer folding): find contiguous repeating
    // blocks so the viewer can collapse each to its first block + a "×N" header.
    // Off-thread (whole-file fingerprint scan) — never blocks the UI.
    foldRegions: async (opts?: any) => {
      const handler = getReadHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      try {
        const result = await runFoldRegionsJob(handler, {
          maxPeriod: opts?.maxPeriod,
          minRepeats: opts?.minRepeats,
          tolerance: opts?.tolerance,
          minHidden: opts?.minHidden,
        });
        logActivity(currentFilePath, 'fold_regions', { regions: result.regions.length, foldableLines: result.foldableLines });
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    navigateToLine: (lineNumber: number) => {
      mainWindow?.webContents.send('navigate-to-line', lineNumber);
    },
    getBaselineStore: () => baselineStore,
    getAnalysisResult: () => {
      if (!currentFilePath) return null;
      return analysisResultCache.get(currentFilePath) || null;
    },
    getLinesRaw: (startLine: number, count: number) => {
      const handler = getReadHandler();
      if (!handler) return { success: false, error: 'No file open' };
      const lines = handler.getLines(startLine, count);
      return { success: true, lines };
    },
    resolveSavedEntity: (ref: { kind: string; id?: string; name?: string }) => {
      // Present if any saved item of this kind matches by id or by a name-ish field.
      const has = (arr: any[], nameFields: string[]): { present: boolean } => ({
        present: Array.isArray(arr) && arr.some((x: any) =>
          (ref.id != null && x && x.id === ref.id) ||
          (ref.name != null && x && nameFields.some(f => x[f] === ref.name))),
      });
      try {
        switch (ref.kind) {
          case 'search':        return has(Object.values(loadSearchConfigsStore()).flat() as any[], ['pattern', 'description']);
          case 'session':       return has(loadGlobalSearchConfigSessions(), ['name']);
          case 'filter':        return has(loadFilterPresets(), ['name']);
          case 'highlight':     return has(loadHighlightGroups(), ['name']);
          case 'bookmark':      return has(loadBookmarkSets(), ['name']);
          case 'columnLayout':  return has(loadColumnLayouts(), ['name']);
          case 'columnPattern': return has(loadColumnPatternsStore(), ['name']);
          case 'constant':      return has(getConstants(), ['name']);
          case 'trendProperty': return has(loadPatternPropertiesStore(), ['name']);
          case 'pattern':       return has(loadPatternLibraryStore(), ['label', 'id']);
          default:              return null;
        }
      } catch {
        return null;
      }
    },
    listSavedEntities: (kind?: string): EntityDescriptor[] => {
      // Aggregate every global/reusable saved entity this process owns into the uniform
      // registry shape. Investigations are appended by the /api/entities handler (api-server
      // owns that store). Per-file individual marks are working state — excluded by design.
      const out: EntityDescriptor[] = [];
      const add = (k: EntityKind, rows: any[]) => { if (!kind || kind === k) out.push(...toDescriptors(k, rows)); };
      try {
        add('search', loadSearchConfigsStore()['_global'] || []);
        add('session', loadGlobalSearchConfigSessions());
        add('composite', loadGlobalSingleSessions());
        add('filter', loadFilterPresets());
        add('highlightGroup', loadHighlightGroups());
        add('bookmarkSet', loadBookmarkSets());
        add('columnLayout', loadColumnLayouts());
        add('columnPattern', loadColumnPatternsStore());
        add('constant', getConstants());
        add('trendProperty', loadPatternPropertiesStore());
        add('pattern', loadPatternLibraryStore());
        add('contextDef', loadContextDefinitionsStore()[GLOBAL_CONTEXT_KEY] || []);
        add('baseline', baselineStore.list());
        // Context manifest is per-file (not a global store) — surface the open file's, if any.
        if (currentFilePath) {
          const cm = getContextManifest(currentFilePath);
          if (cm && factCount(cm) > 0) {
            add('contextManifest', [{ id: 'context-manifest', name: path.basename(currentFilePath), facts: cm.facts }]);
          }
        }
      } catch (e) {
        console.error('listSavedEntities failed:', e);
      }
      return out;
    },
    // Apply a saved LENS entity (filter / highlightGroup / columnLayout / session) to the
    // open view — the agent-parity write-half of listSavedEntities. Resolves the ref, then
    // pushes `entity-apply` to the renderer, whose handler runs the SAME applySavedEntity
    // the human ▶ Apply uses (one impl, two operators). Other applyable kinds have dedicated
    // verbs (investigation → logan_run_investigation, composite → logan_single_session).
    applyEntityRef: (ref: { kind: string; id?: string; name?: string }) => {
      const LENS: Record<string, () => any[]> = {
        filter: loadFilterPresets,
        highlightGroup: loadHighlightGroups,
        columnLayout: loadColumnLayouts,
        session: loadGlobalSearchConfigSessions,
      };
      if (!ref || !LENS[ref.kind]) {
        return { success: false, error: `apply supports lens entities only (filter, highlightGroup, columnLayout, session). Use logan_run_investigation for an investigation, logan_single_session for a composite.` };
      }
      if (!currentFilePath) return { success: false, error: 'No file open' };
      if (!ref.id && !ref.name) return { success: false, error: 'id or name required' };
      const rows = LENS[ref.kind]() || [];
      const match = rows.find((r: any) => (ref.id && String(r.id) === String(ref.id)) || (ref.name && r.name === ref.name));
      if (!match) return { success: false, error: `No ${ref.kind} named "${ref.name || ref.id}"` };
      const id = String(match.id ?? '');
      const name = String(match.name ?? '');
      // Push to the renderer's shared apply dispatcher (set-semantics — apply, never toggle off).
      mainWindow?.webContents.send('entity-apply', { kind: ref.kind, id, name });
      return { success: true, applied: true, entity: { kind: ref.kind, id, name } };
    },
    // Pack the reusable GLOBAL catalogue into a portable `.logan-pack` (a JSON container +
    // manifest with per-store checksums). Returns the serialized text (optionally encrypted)
    // for the caller to write to disk. Never touches per-file analysis or secret stores.
    exportCatalog: (opts?: { kinds?: string[]; passphrase?: string }) => {
      const reg: Record<string, CatalogStore> = buildCatalogRegistry();
      const wanted = (opts?.kinds && opts.kinds.length ? opts.kinds : CATALOG_KINDS).filter(k => reg[k]);
      const storesByKind: Record<string, any[]> = {};
      for (const k of wanted) { try { storesByKind[k] = reg[k].load() || []; } catch { storesByKind[k] = []; } }
      let version = ''; try { version = app.getVersion(); } catch { /* not ready */ }
      const pack = buildPack(storesByKind, { createdAt: new Date().toISOString(), generator: `logan ${version}`.trim() });
      let text = serializePack(pack);
      let encrypted = false;
      if (opts?.passphrase) { text = JSON.stringify(encryptPack(text, opts.passphrase), null, 2); encrypted = true; }
      const summary = pack.manifest.kinds.map((k) => ({ kind: k.kind, count: k.count }));
      return { text, encrypted, manifest: pack.manifest, summary };
    },
    // Import a `.logan-pack` into the global catalogue. Defaults to a DRY RUN (returns a plan
    // + integrity report, writes nothing); pass dryRun:false + a policy to actually merge.
    // Import only ADDS/overwrites by the chosen policy — it never deletes existing entities.
    importCatalog: (input: { text: string; passphrase?: string; dryRun?: boolean; policy?: ConflictPolicy; kinds?: string[] }) => {
      let obj: any;
      try { obj = JSON.parse(input.text); } catch { return { success: false, error: 'File is not valid JSON.' }; }
      if (isEncryptedEnvelope(obj)) {
        if (!input.passphrase) return { success: false, error: 'This pack is encrypted — a passphrase is required.', needsPassphrase: true };
        let dec: string;
        try { dec = decryptPack(obj, input.passphrase); } catch { return { success: false, error: 'Wrong passphrase or corrupt encrypted pack.' }; }
        try { obj = JSON.parse(dec); } catch { return { success: false, error: 'Decrypted content is not valid JSON.' }; }
      }
      let pack: CatalogPack;
      try { pack = parsePack(JSON.stringify(obj)); } catch (e: any) { return { success: false, error: `Not a LOGAN catalogue pack: ${e.message}` }; }
      const verify = verifyPack(pack);
      const reg: Record<string, CatalogStore> = buildCatalogRegistry();
      const identity = CATALOG_IDENTITY as Record<string, IdentitySpec>;
      const wantKinds = (input.kinds && input.kinds.length ? input.kinds : Object.keys(pack.stores)).filter(k => reg[k]);
      const existingByKind: Record<string, any[]> = {};
      for (const k of wantKinds) { try { existingByKind[k] = reg[k].load() || []; } catch { existingByKind[k] = []; } }
      const scoped: CatalogPack = { ...pack, stores: {} };
      for (const k of wantKinds) scoped.stores[k] = pack.stores[k] || [];
      const plan = planImport(existingByKind, scoped, CATALOG_IDENTITY);
      plan.unknownKinds = planImport({}, pack, CATALOG_IDENTITY).unknownKinds;
      const dryRun = input.dryRun !== false; // default true — safe preview
      if (dryRun) return { success: true, dryRun: true, plan, verify, manifest: pack.manifest };
      const policy: ConflictPolicy = input.policy || 'skip';
      const applied: any[] = [];
      for (const k of wantKinds) {
        const incoming = pack.stores[k] || [];
        if (!incoming.length) continue;
        const existing = reg[k].load() || [];
        const mr = mergeRecords(existing, incoming, identity[k], policy);
        try { reg[k].saveAll(mr.merged); applied.push({ kind: k, added: mr.added, overwritten: mr.overwritten, skipped: mr.skipped, keptBoth: mr.keptBoth }); }
        catch (e: any) { applied.push({ kind: k, error: String(e?.message || e) }); }
      }
      try { mainWindow?.webContents.send('catalog-imported', { applied }); } catch { /* renderer may be gone */ }
      return { success: true, dryRun: false, applied, verify, manifest: pack.manifest };
    },
    investigateCrashes: async (options) => {
      // getReadHandler so this runs over an active single-session composite too: analysis
      // fans out per-member (analyzeCurrentTarget) with crash lines already rebased into the
      // global space, and getLines/getTotalLines here read that same global space.
      const handler = getReadHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      const contextLines = options.contextLines ?? 10;
      const maxCrashes = options.maxCrashes ?? 20;

      // Get or run analysis
      let analysisResult = analysisResultCache.get(currentFilePath);
      if (!analysisResult) {
        const analyzer = analyzerRegistry.getDefault();
        if (!analyzer) return { success: false, error: 'No analyzer available' };
        analyzeSignal = { cancelled: false };
        analysisResult = await analyzeCurrentTarget(analyzer, {}, () => {}, analyzeSignal);
        cacheAnalysisResult(currentFilePath, analysisResult);
      }

      const crashes = analysisResult.insights.crashes.slice(0, maxCrashes);
      const totalLines = handler.getTotalLines();

      // Group by keyword
      const crashesByKeyword: Record<string, number> = {};
      for (const c of analysisResult.insights.crashes) {
        crashesByKeyword[c.keyword] = (crashesByKeyword[c.keyword] || 0) + 1;
      }

      // Collect context for each crash
      const crashDetails = crashes.map(c => {
        const startIdx = Math.max(0, c.lineNumber - contextLines);
        const endIdx = Math.min(totalLines - 1, c.lineNumber + contextLines);
        const rawLines = handler.getLines(startIdx, endIdx - startIdx + 1);

        const contextBefore: { lineNumber: number; text: string; level?: string }[] = [];
        const contextAfter: { lineNumber: number; text: string; level?: string }[] = [];
        let crashLine = '';

        for (const line of rawLines) {
          if (line.lineNumber < c.lineNumber) {
            contextBefore.push({ lineNumber: line.lineNumber, text: line.text, level: line.level });
          } else if (line.lineNumber === c.lineNumber) {
            crashLine = line.text;
          } else {
            contextAfter.push({ lineNumber: line.lineNumber, text: line.text, level: line.level });
          }
        }

        return {
          lineNumber: c.lineNumber,
          keyword: c.keyword,
          level: c.level || 'error',
          component: c.channel || null,
          crashLine,
          contextBefore,
          contextAfter,
        };
      });

      // Optionally bookmark crash sites
      let bookmarksAdded = 0;
      if (options.autoBookmark) {
        for (const c of crashDetails) {
          const id = `crash-${c.lineNumber}-${Date.now()}`;
          const bm: Bookmark = {
            id,
            lineNumber: c.lineNumber,
            label: `Crash: ${c.keyword}`,
            color: '#ff4444',
          };
          bookmarks.set(bm.id, bm);
          bookmarksAdded++;
        }
        saveBookmarksForCurrentFile();
      }

      // Optionally highlight crash keywords
      const highlightsAdded: string[] = [];
      if (options.autoHighlight) {
        const uniqueKeywords = [...new Set(crashes.map(c => c.keyword))];
        for (const kw of uniqueKeywords) {
          const existing = Array.from(highlights.values()).find(h => h.pattern === kw);
          if (!existing) {
            const hl: Highlight = {
              id: `hl-crash-${kw}-${Date.now()}`,
              pattern: kw,
              isRegex: false,
              matchCase: false,
              backgroundColor: '#ff4444',
              highlightAll: true,
              isGlobal: false,
              includeWhitespace: false,
            };
            highlights.set(hl.id, hl);
            highlightsAdded.push(kw);
          }
        }
        if (highlightsAdded.length > 0) {
          for (const hl of highlights.values()) {
            saveHighlight(hl);
          }
        }
      }

      return {
        success: true,
        totalCrashesFound: analysisResult.insights.crashes.length,
        crashesByKeyword,
        crashes: crashDetails,
        bookmarksAdded,
        highlightsAdded,
      };
    },
    investigateComponent: async (options) => {
      // getReadHandler so a single-session composite is searched across all members (global
      // line space); analyzeCurrentTarget below is already composite-aware.
      const handler = getReadHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      const component = options.component;
      const maxSamplesPerLevel = options.maxSamplesPerLevel ?? 5;
      const includeErrorContext = options.includeErrorContext ?? true;
      const contextLines = options.contextLines ?? 5;

      // Get or run analysis
      let analysisResult = analysisResultCache.get(currentFilePath);
      if (!analysisResult) {
        const analyzer = analyzerRegistry.getDefault();
        if (!analyzer) return { success: false, error: 'No analyzer available' };
        analyzeSignal = { cancelled: false };
        analysisResult = await analyzeCurrentTarget(analyzer, {}, () => {}, analyzeSignal);
        cacheAnalysisResult(currentFilePath, analysisResult);
      }

      // Search for component mentions
      const searchOpts: SearchOptions = {
        pattern: component,
        isRegex: false,
        isWildcard: false,
        matchCase: false,
        wholeWord: false,
      };
      searchSignal = { cancelled: false };
      const matches = await handler.search(searchOpts, () => {}, searchSignal);

      if (matches.length === 0) {
        return { success: true, component, found: false, totalMentions: 0 };
      }

      // Categorize by level
      const levelBuckets: Record<string, { lineNumber: number; text: string }[]> = {};
      const totalLines = handler.getTotalLines();
      for (const m of matches) {
        // Get the line to determine its level
        const [lineData] = handler.getLines(m.lineNumber, 1);
        const level = lineData?.level || 'other';
        if (!levelBuckets[level]) levelBuckets[level] = [];
        levelBuckets[level].push({ lineNumber: m.lineNumber, text: m.lineText });
      }

      // Pick evenly-spaced samples per level
      const samplesByLevel: Record<string, { lineNumber: number; text: string }[]> = {};
      const levelBreakdown: Record<string, number> = {};
      for (const [level, items] of Object.entries(levelBuckets)) {
        levelBreakdown[level] = items.length;
        if (items.length <= maxSamplesPerLevel) {
          samplesByLevel[level] = items;
        } else {
          const step = items.length / maxSamplesPerLevel;
          samplesByLevel[level] = [];
          for (let i = 0; i < maxSamplesPerLevel; i++) {
            samplesByLevel[level].push(items[Math.floor(i * step)]);
          }
        }
      }

      // Get error context sites
      const errorSites: any[] = [];
      if (includeErrorContext && levelBuckets['error']) {
        const errorLines = levelBuckets['error'];
        const maxErrorSites = Math.min(10, errorLines.length);
        const step = errorLines.length > maxErrorSites ? errorLines.length / maxErrorSites : 1;
        for (let i = 0; i < maxErrorSites; i++) {
          const errLine = errorLines[Math.floor(i * step)];
          const startIdx = Math.max(0, errLine.lineNumber - contextLines);
          const endIdx = Math.min(totalLines - 1, errLine.lineNumber + contextLines);
          const rawLines = handler.getLines(startIdx, endIdx - startIdx + 1);
          const contextBefore: { lineNumber: number; text: string }[] = [];
          const contextAfter: { lineNumber: number; text: string }[] = [];
          for (const line of rawLines) {
            if (line.lineNumber < errLine.lineNumber) {
              contextBefore.push({ lineNumber: line.lineNumber, text: line.text });
            } else if (line.lineNumber > errLine.lineNumber) {
              contextAfter.push({ lineNumber: line.lineNumber, text: line.text });
            }
          }
          errorSites.push({
            lineNumber: errLine.lineNumber,
            errorLine: errLine.text,
            contextBefore,
            contextAfter,
          });
        }
      }

      // Time range of component mentions
      let timeRange: { firstSeen: string; lastSeen: string } | null = null;
      const firstMatch = matches[0];
      const lastMatch = matches[matches.length - 1];
      const [firstLine] = handler.getLines(firstMatch.lineNumber, 1);
      const [lastLine] = handler.getLines(lastMatch.lineNumber, 1);
      if (firstLine && lastLine) {
        const firstTs = parseTimestampFast(firstLine.text);
        const lastTs = parseTimestampFast(lastLine.text);
        if (firstTs && lastTs) {
          timeRange = { firstSeen: firstTs.str, lastSeen: lastTs.str };
        }
      }

      // Check if this is a top failer
      const isTopFailer = analysisResult.insights.topFailingComponents.some(
        fc => fc.name.toLowerCase() === component.toLowerCase()
      );

      return {
        success: true,
        component,
        found: true,
        totalMentions: matches.length,
        levelBreakdown,
        timeRange,
        isTopFailer,
        samplesByLevel,
        errorSites,
      };
    },
    investigateTimerange: async (options) => {
      // getReadHandler so the time-window binary search runs over a single-session composite
      // too (global line space). Note: like any log with non-monotonic timestamps, a composite
      // whose members aren't in wall-clock order can bound the window imperfectly — inherent to
      // the timestamp search, not specific to composites.
      const handler = getReadHandler();
      if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
      const totalLines = handler.getTotalLines();
      const maxSamples = options.maxSamples ?? 20;

      // Parse requested start/end times
      const requestedStart = new Date(options.startTime);
      const requestedEnd = new Date(options.endTime);
      if (isNaN(requestedStart.getTime()) || isNaN(requestedEnd.getTime())) {
        return { success: false, error: 'Invalid startTime or endTime format' };
      }

      // Binary search to find the start line of the time window
      const h = handler; // capture for nested function
      function findTimeBoundary(targetTime: Date, findFirst: boolean): number {
        let lo = 0, hi = totalLines - 1;
        let result = findFirst ? totalLines : -1;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const [line] = h.getLines(mid, 1);
          if (!line) { lo = mid + 1; continue; }
          const parsed = parseTimestampFast(line.text);
          if (!parsed) {
            // No timestamp — scan forward a bit
            lo = mid + 1;
            continue;
          }
          if (findFirst) {
            if (parsed.date >= targetTime) {
              result = mid;
              hi = mid - 1;
            } else {
              lo = mid + 1;
            }
          } else {
            if (parsed.date <= targetTime) {
              result = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
        }
        return result;
      }

      const startLine = findTimeBoundary(requestedStart, true);
      const endLine = findTimeBoundary(requestedEnd, false);

      if (startLine >= totalLines || endLine < 0 || startLine > endLine) {
        return {
          success: true,
          timeRange: {
            requestedStart: options.startTime,
            requestedEnd: options.endTime,
            actualStart: null,
            actualEnd: null,
          },
          lineRange: { startLine: 0, endLine: 0, lineCount: 0 },
          levelCounts: {},
          crashes: [],
          activeComponents: [],
          timeGaps: [],
          samples: { errors: [], warnings: [], firstLines: [], lastLines: [] },
        };
      }

      const lineCount = endLine - startLine + 1;

      // Scan the range
      const levelCounts: Record<string, number> = {};
      const crashes: { lineNumber: number; keyword: string; text: string }[] = [];
      const CRASH_KEYWORDS = ['fatal', 'panic', 'crash', 'exception', 'segfault', 'abort', 'oom', 'killed', 'core dump'];
      const timeGaps: { lineNumber: number; gapSeconds: number; prevTimestamp: string; currTimestamp: string }[] = [];
      let prevTimestamp: Date | null = null;
      let prevTimestampStr = '';
      let actualStart: string | null = null;
      let actualEnd: string | null = null;

      // Collect samples
      const errorSamples: { lineNumber: number; text: string }[] = [];
      const warningSamples: { lineNumber: number; text: string }[] = [];
      const firstLines: { lineNumber: number; text: string }[] = [];
      const lastLines: { lineNumber: number; text: string }[] = [];

      const batchSize = 5000;
      for (let start = startLine; start <= endLine; start += batchSize) {
        const count = Math.min(batchSize, endLine - start + 1);
        const lines = handler.getLines(start, count);
        for (const line of lines) {
          // Level counting
          const level = line.level || 'other';
          levelCounts[level] = (levelCounts[level] || 0) + 1;

          // Crash keyword detection
          const textLower = line.text.toLowerCase();
          for (const kw of CRASH_KEYWORDS) {
            if (textLower.includes(kw)) {
              crashes.push({ lineNumber: line.lineNumber, keyword: kw, text: line.text });
              break;
            }
          }

          // Timestamp tracking
          const parsed = parseTimestampFast(line.text);
          if (parsed) {
            if (!actualStart) actualStart = parsed.str;
            actualEnd = parsed.str;
            if (prevTimestamp) {
              const diffSec = Math.abs((parsed.date.getTime() - prevTimestamp.getTime()) / 1000);
              if (diffSec >= 30) {
                timeGaps.push({
                  lineNumber: line.lineNumber,
                  gapSeconds: diffSec,
                  prevTimestamp: prevTimestampStr,
                  currTimestamp: parsed.str,
                });
              }
            }
            prevTimestamp = parsed.date;
            prevTimestampStr = parsed.str;
          }

          // Collect first/last lines
          if (line.lineNumber - startLine < 5) {
            firstLines.push({ lineNumber: line.lineNumber, text: line.text });
          }
          if (endLine - line.lineNumber < 5) {
            lastLines.push({ lineNumber: line.lineNumber, text: line.text });
          }

          // Collect error/warning samples (up to maxSamples each)
          if (level === 'error' && errorSamples.length < maxSamples) {
            errorSamples.push({ lineNumber: line.lineNumber, text: line.text });
          }
          if (level === 'warning' && warningSamples.length < maxSamples) {
            warningSamples.push({ lineNumber: line.lineNumber, text: line.text });
          }
        }
      }

      // Sort time gaps by duration descending, keep top 10
      timeGaps.sort((a, b) => b.gapSeconds - a.gapSeconds);
      const topTimeGaps = timeGaps.slice(0, 10);

      // Pick evenly-spaced error/warning samples
      function pickEvenlySpaced(arr: { lineNumber: number; text: string }[], max: number) {
        if (arr.length <= max) return arr;
        const step = arr.length / max;
        const result: typeof arr = [];
        for (let i = 0; i < max; i++) {
          result.push(arr[Math.floor(i * step)]);
        }
        return result;
      }

      return {
        success: true,
        timeRange: {
          requestedStart: options.startTime,
          requestedEnd: options.endTime,
          actualStart,
          actualEnd,
        },
        lineRange: { startLine, endLine, lineCount },
        levelCounts,
        crashes: crashes.slice(0, 50),
        activeComponents: [], // Would need component parsing which is analyzer-specific
        timeGaps: topTimeGaps,
        samples: {
          errors: pickEvenlySpaced(errorSamples, maxSamples),
          warnings: pickEvenlySpaced(warningSamples, maxSamples),
          firstLines,
          lastLines,
        },
      };
    },
    trendDiscoverFields: async (options) => {
      // getReadHandler so the agent's trend tools run over a single-session composite too
      // (parity with the renderer path); the worker reads the members' unified line space.
      const handler = getReadHandler();
      if (!handler) return { success: false, error: 'No file open' };
      try {
        const fields = await runTrendJob('discover', handler, {
          startLine: options?.startLine,
          endLine: options?.endLine,
          sampleSize: options?.sampleSize,
        });
        return { success: true, fields };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    trendSeries: async (options) => {
      const handler = getReadHandler();
      if (!handler) return { success: false, error: 'No file open' };
      if (!options?.field) return { success: false, error: 'field required' };
      try {
        const result = await runTrendJob('series', handler, {
          field: options.field,
          startLine: options.startLine,
          endLine: options.endLine,
          bucketCount: options.bucketCount,
          maxPoints: options.maxPoints,
          pattern: options.pattern,
          patternFlags: options.patternFlags,
        });
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    trendTransitions: async (options) => {
      const handler = getReadHandler();
      if (!handler) return { success: false, error: 'No file open' };
      if (!options?.field) return { success: false, error: 'field required' };
      try {
        const result = await runTrendJob('transitions', handler, {
          field: options.field,
          startLine: options.startLine,
          endLine: options.endLine,
          maxTransitions: options.maxTransitions,
          pattern: options.pattern,
          patternFlags: options.patternFlags,
        });
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    trendCorrelate: async (options) => {
      const handler = getReadHandler();
      if (!handler) return { success: false, error: 'No file open' };
      if (!options?.field || !options?.event) return { success: false, error: 'field and event required' };
      try {
        const result = await runTrendJob('correlate', handler, {
          field: options.field,
          event: options.event,
          startLine: options.startLine,
          endLine: options.endLine,
          pattern: options.pattern,
          patternFlags: options.patternFlags,
        });
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    // Agent parity for the human "🔗 Single session" button: build a composite from an
    // ordered file-set and open it. Reuses the SAME primitives as the CREATE_COMPOSITE IPC
    // (buildComposite + autoSaveSingleSession), then makes it the active read target and
    // pushes the display to the renderer (which reflects it via the shared display path).
    createComposite: async (filePaths, label) => {
      if (!Array.isArray(filePaths) || filePaths.length < 2) {
        return { success: false, error: 'Pick at least 2 files for a single session' };
      }
      const missing = filePaths.filter((fp) => !fs.existsSync(fp));
      if (missing.length) return { success: false, error: `File(s) not found: ${missing.join(', ')}` };
      try {
        const built = await buildComposite(filePaths, label);
        autoSaveSingleSession(filePaths, label);
        // Make the composite the active read target immediately, so a follow-up agent call
        // (search/analyze/…) operates on it even before the renderer finishes displaying it.
        currentFilePath = built.id;
        mainWindow?.webContents.send('agent-open-single-session', {
          id: built.id, files: filePaths, label, info: built.info, boundaries: built.boundaries,
        });
        return { success: true, id: built.id, info: built.info, boundaries: built.boundaries };
      } catch (error) {
        activeComposite = null;
        activeCompositeId = null;
        return { success: false, error: String(error) };
      }
    },
    // Agent parity for the human "⬇ Merge to file…" button (Time Sync): interleave N
    // files onto ONE wall-clock timeline, write the merged .log, and open it as the
    // active file so every downstream verb (search/analyze/trends/investigate/…) runs
    // on the correlated view. Reuses the SAME engine as the human button
    // (collectMergeTimeline + writeMergeEntriesToFile). This is logan_single_session's
    // order:"wallclock" path — materialize-and-open, unlike the sequential composite.
    mergeTimeline: async (filePaths, label) => {
      if (!Array.isArray(filePaths) || filePaths.length < 2) {
        return { success: false, error: 'Pick at least 2 files to merge onto a wall-clock timeline' };
      }
      const missing = filePaths.filter((fp) => !fs.existsSync(fp));
      if (missing.length) return { success: false, error: `File(s) not found: ${missing.join(', ')}` };
      try {
        const collected = await collectMergeTimeline(filePaths);
        if (!collected.ok) return { success: false, error: collected.error };
        const c = collected.data;

        // Write into a .logan/merged/ subdir next to the first file (so merged artifacts
        // don't clutter the log folder); fall back to the system temp dir if that isn't
        // writable. A stamped filename avoids clobbering across re-runs.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const safeLabel = (label || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
        const fileName = `${safeLabel ? safeLabel + '_' : ''}merged-timeline_${stamp}.log`;
        let outDir = path.join(path.dirname(filePaths[0]), '.logan', 'merged');
        try { fs.mkdirSync(outDir, { recursive: true }); } catch { outDir = os.tmpdir(); }
        const outPath = path.join(outDir, fileName);

        const written = writeMergeEntriesToFile(outPath, filePaths, c, { includeHeader: true });
        if (currentFilePath) logActivity(currentFilePath, 'files_merged', { files: c.contributed.size, lines: written, agent: true });

        // Open the merged file as the active read target + push it to the renderer, so a
        // follow-up agent call (search/analyze/…) and the human both land on the timeline.
        const info = await openFileAsCurrent(outPath);
        return {
          success: true,
          filePath: outPath,
          info,
          lineCount: written,
          fileCount: c.contributed.size,
          skipped: c.skipped,
          collectCapped: c.collectCapped,
          scanCapped: c.scanCapped,
          from: formatWallClock(c.minMs),
          to: formatWallClock(c.maxMs),
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    diffRuns: async (referencePath, opts) => {
      // Target = the active file (the run under investigation, honouring its scope, like
      // summarize). Reference = another log by path (the good/known run), opened on demand.
      const targetHandler = getReadHandler();
      if (!targetHandler || !currentFilePath) return { success: false, error: 'No file open (open the run to investigate first)' };
      if (!referencePath || typeof referencePath !== 'string') return { success: false, error: 'reference path required' };
      if (!fs.existsSync(referencePath)) return { success: false, error: `Reference file not found: ${referencePath}` };
      if (path.resolve(referencePath) === path.resolve(currentFilePath)) {
        return { success: false, error: 'Reference and target are the same file — open two different runs' };
      }
      const folderOpts = {
        maxTemplates: opts?.maxTemplates,
        maxExamples: opts?.maxExamples,
        detectSeverity: true,
        detectTimestamp: true,
      };
      try {
        // Target scope: resolve like summarize (whole file / filter / range / indices).
        const resolved = resolveCurrentScope(opts?.scope);
        const targetScopeArg = resolved.kind === 'range'
          ? { kind: 'range' as const, startLine: resolved.startLine, endLine: resolved.endLine }
          : { kind: 'indices' as const, lines: resolved.lines };

        const referenceHandler = await getOrOpenHandlerForPath(referencePath);
        const refTotal = referenceHandler.getTotalLines();
        const referenceScopeArg = { kind: 'range' as const, startLine: 0, endLine: Math.max(0, refTotal - 1) };

        // Fold both runs with the identical dispatch → strictly comparable summaries.
        const [referenceSummary, targetSummary] = await Promise.all([
          foldHandlerTemplates(referenceHandler, referenceScopeArg, folderOpts),
          foldHandlerTemplates(targetHandler, targetScopeArg, folderOpts),
        ]);

        const diffOpts: DiffOptions = { minCount: opts?.minCount, changeFactor: opts?.changeFactor, topN: opts?.topN };
        const diff = diffRuns(referenceSummary, targetSummary, diffOpts);
        logActivity(currentFilePath, 'diff_runs', {
          reference: path.basename(referencePath),
          onlyInTarget: diff.summary.onlyInTarget,
          changed: diff.summary.changed,
        });
        return {
          success: true,
          reference: { path: referencePath, name: path.basename(referencePath) },
          target: { path: currentFilePath, name: path.basename(currentFilePath), scope: scopeInfo(resolved) },
          diff,
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  };
  loadPersistedSession(); // restore last 24h of chat history
  startApiServer(apiContext);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  for (const conn of liveConnections.values()) {
    try {
      if (conn.connected) conn.handler.disconnect();
      conn.handler.cleanupTempFile();
    } catch { /* ignore cleanup errors */ }
  }
  liveConnections.clear();
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
  // Flush debounced store writes so an action taken immediately before quit
  // (e.g. "Save as constant") isn't lost with a pending timer.
  try { flushUsage(); } catch { /* non-critical */ }
  try { flushPatternLog(); } catch { /* non-critical */ }
  try { flushConstants(); } catch { /* non-critical */ }
  try { flushSequences(); } catch { /* non-critical */ }
  stopApiServer();
});

// === Window Controls ===

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow?.close();
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

// === Device Discovery (per-source) ===

ipcMain.handle(IPC.SERIAL_LIST_PORTS, async () => {
  try {
    const tmpHandler = new SerialHandler();
    const ports = await tmpHandler.listPorts();
    return { success: true, ports };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LOGCAT_LIST_DEVICES, async () => {
  try {
    const tmpHandler = new LogcatHandler();
    const devices = await tmpHandler.listDevices();
    return { success: true, devices };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Unified Live Connection Management ===

function wireConnectionEvents(conn: LiveConnection): void {
  const { handler, id } = conn;

  const onLinesAdded = (_count: number) => {
    const fh = fileHandlerCache.get(conn.tempFilePath);
    if (fh) {
      const newLines = fh.indexNewLines();
      if (newLines > 0) {
        mainWindow?.webContents.send(IPC.LIVE_LINES_ADDED, {
          connectionId: id,
          totalLines: fh.getTotalLines(),
          newLines,
        });
      }
    }
  };

  const onError = (message: string) => {
    mainWindow?.webContents.send(IPC.LIVE_ERROR, { connectionId: id, message });
  };

  const onDisconnected = () => {
    conn.connected = false;
    mainWindow?.webContents.send(IPC.LIVE_DISCONNECTED, { connectionId: id });
    removeConnectionListeners(conn);
  };

  conn.listeners = [
    { event: 'lines-added', fn: onLinesAdded },
    { event: 'error', fn: onError },
    { event: 'disconnected', fn: onDisconnected },
  ];

  for (const l of conn.listeners) {
    handler.on(l.event, l.fn);
  }
}

function removeConnectionListeners(conn: LiveConnection): void {
  for (const l of conn.listeners) {
    conn.handler.removeListener(l.event, l.fn);
  }
  conn.listeners = [];
}

ipcMain.handle(IPC.LIVE_CONNECT, async (_, source: 'serial' | 'logcat' | 'ssh', config: any, displayName: string, detail: string) => {
  try {
    if (liveConnections.size >= MAX_LIVE_CONNECTIONS) {
      return { success: false, error: `Maximum ${MAX_LIVE_CONNECTIONS} concurrent connections reached` };
    }

    const connectionId = 'lc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

    let handler: any;
    if (source === 'serial') {
      handler = new SerialHandler();
    } else if (source === 'logcat') {
      handler = new LogcatHandler();
    } else {
      handler = new SshHandler();
    }

    const tempFilePath = await handler.connect(config);

    // Open temp file with FileHandler
    const fileHandler = new FileHandler();
    const info = await fileHandler.open(tempFilePath, () => {});
    addToCache(tempFilePath, fileHandler);

    const conn: LiveConnection = {
      id: connectionId,
      source,
      handler,
      tempFilePath,
      displayName,
      detail,
      config,
      connectedSince: Date.now(),
      connected: true,
      listeners: [],
    };

    wireConnectionEvents(conn);
    liveConnections.set(connectionId, conn);

    return { success: true, connectionId, tempFilePath, info };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LIVE_DISCONNECT, async (_, connectionId: string) => {
  try {
    const conn = liveConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found' };
    if (conn.connected) {
      conn.handler.disconnect();
      conn.connected = false;
    }
    removeConnectionListeners(conn);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LIVE_RESTART, async (_, connectionId: string) => {
  try {
    const conn = liveConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found' };

    // Disconnect old handler if still connected
    if (conn.connected) {
      conn.handler.disconnect();
    }
    removeConnectionListeners(conn);

    // Create fresh handler
    let handler: any;
    if (conn.source === 'serial') {
      handler = new SerialHandler();
    } else if (conn.source === 'logcat') {
      handler = new LogcatHandler();
    } else {
      handler = new SshHandler();
    }

    const tempFilePath = await handler.connect(conn.config);

    // Open new temp file with FileHandler
    const fileHandler = new FileHandler();
    const info = await fileHandler.open(tempFilePath, () => {});
    addToCache(tempFilePath, fileHandler);

    // Update connection
    conn.handler = handler;
    conn.tempFilePath = tempFilePath;
    conn.connectedSince = Date.now();
    conn.connected = true;

    wireConnectionEvents(conn);

    return { success: true, tempFilePath, info };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LIVE_REMOVE, async (_, connectionId: string) => {
  try {
    const conn = liveConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found' };

    if (conn.connected) {
      conn.handler.disconnect();
    }
    removeConnectionListeners(conn);
    conn.handler.cleanupTempFile();
    liveConnections.delete(connectionId);

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.LIVE_SAVE_SESSION, async (_, connectionId: string) => {
  try {
    const conn = liveConnections.get(connectionId);
    if (!conn) return { success: false, error: 'Connection not found' };

    const tempPath = conn.tempFilePath;
    if (!tempPath || !fs.existsSync(tempPath)) {
      return { success: false, error: 'No session data' };
    }

    const result = await showSaveDialog({
      title: `Save ${conn.displayName} Session`,
      defaultPath: path.basename(tempPath),
      filters: [
        { name: 'Log Files', extensions: ['log', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' };
    }

    fs.copyFileSync(tempPath, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === SSH Profiles & SFTP ===

const getSshProfilesPath = () => path.join(getConfigDir(), 'ssh-profiles.json');

function loadSshProfiles(): SshProfile[] {
  try {
    const p = getSshProfilesPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch { /* */ }
  return [];
}

function saveSshProfiles(profiles: SshProfile[]): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(getSshProfilesPath(), JSON.stringify(profiles, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save SSH profiles:', error);
  }
}

ipcMain.handle(IPC.SSH_PARSE_CONFIG, async () => {
  try {
    const hosts = sshUtilHandler ? sshUtilHandler.parseSSHConfig() : [];
    return { success: true, hosts };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_LIST_PROFILES, async () => {
  try {
    return { success: true, profiles: loadSshProfiles() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_SAVE_PROFILE, async (_, profile: SshProfile) => {
  try {
    const profiles = loadSshProfiles();
    const idx = profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push(profile);
    }
    saveSshProfiles(profiles);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_DELETE_PROFILE, async (_, id: string) => {
  try {
    const profiles = loadSshProfiles().filter(p => p.id !== id);
    saveSshProfiles(profiles);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('ssh-test-connection', async (_, config: { host: string; port: number; username: string; identityFile?: string; password?: string }) => {
  try {
    if (!sshUtilHandler) return { success: false, error: 'SSH not available' };
    return await sshUtilHandler.testConnection(config);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Saved Connections ===

const getConnectionsPath = () => path.join(getConfigDir(), 'connections.json');

function loadSavedConnections(): SavedConnection[] {
  try {
    const p = getConnectionsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch { /* */ }
  return [];
}

function persistSavedConnections(connections: SavedConnection[]): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(getConnectionsPath(), JSON.stringify(connections, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save connections:', error);
  }
}

ipcMain.handle(IPC.CONNECTION_LIST, async () => {
  try {
    return { success: true, connections: loadSavedConnections() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.CONNECTION_SAVE, async (_, connection: SavedConnection) => {
  try {
    const connections = loadSavedConnections();
    const idx = connections.findIndex(c => c.id === connection.id);
    if (idx >= 0) {
      connections[idx] = connection;
    } else {
      connections.push(connection);
    }
    persistSavedConnections(connections);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.CONNECTION_DELETE, async (_, id: string) => {
  try {
    const connections = loadSavedConnections().filter(c => c.id !== id);
    persistSavedConnections(connections);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.CONNECTION_UPDATE, async (_, id: string, fields: Partial<SavedConnection>) => {
  try {
    const connections = loadSavedConnections();
    const conn = connections.find(c => c.id === id);
    if (!conn) return { success: false, error: 'Connection not found' };
    Object.assign(conn, fields);
    persistSavedConnections(connections);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_LIST_REMOTE_DIR, async (_, remotePath: string, connectionId?: string) => {
  try {
    let sshConn: LiveConnection | undefined;
    // Prefer the specific connection if given
    if (connectionId) {
      const c = liveConnections.get(connectionId);
      if (c && c.connected) sshConn = c;
    }
    // Fall back to any active SSH connection
    if (!sshConn) {
      for (const conn of liveConnections.values()) {
        if (conn.source === 'ssh' && conn.connected) { sshConn = conn; break; }
      }
    }
    if (!sshConn) {
      return { success: false, error: 'No active SSH connection. Reconnect via SSH Remote Browser.' };
    }
    const files = await (sshConn.handler as any).listRemoteDir(remotePath);
    return { success: true, files };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SSH_DOWNLOAD_FILE, async (_, remotePath: string) => {
  try {
    let sshConn: LiveConnection | undefined;
    for (const conn of liveConnections.values()) {
      if (conn.source === 'ssh' && conn.connected) {
        sshConn = conn;
        break;
      }
    }
    if (!sshConn) {
      return { success: false, error: 'No active SSH connection for download' };
    }
    const localPath = await (sshConn.handler as any).downloadRemoteFile(remotePath);
    return { success: true, localPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === File Operations ===

// On Linux, passing a parent BrowserWindow to dialog.show*Dialog causes the
// dialog to attach modally via XDG portal / GTK, which can deadlock and leave
// the window unresponsive. Calling the parentless overload avoids this entirely.
// A re-entrancy guard prevents stacking multiple native dialogs (which on Linux
// can leave a dialog visible but non-interactive until the earlier one resolves).
let _dialogOpen = false;
const _cancelledResult: Electron.OpenDialogReturnValue = { canceled: true, filePaths: [] };
const _cancelledSaveResult: Electron.SaveDialogReturnValue = { canceled: true, filePath: '' };

function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  if (_dialogOpen) return Promise.resolve(_cancelledResult);
  _dialogOpen = true;
  const p = process.platform === 'linux' || !mainWindow
    ? dialog.showOpenDialog(options)
    : dialog.showOpenDialog(mainWindow, options);
  return p.finally(() => { _dialogOpen = false; });
}

function showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  if (_dialogOpen) return Promise.resolve(_cancelledSaveResult);
  _dialogOpen = true;
  const p = process.platform === 'linux' || !mainWindow
    ? dialog.showSaveDialog(options)
    : dialog.showSaveDialog(mainWindow, options);
  return p.finally(() => { _dialogOpen = false; });
}

ipcMain.handle(IPC.OPEN_FILE_DIALOG, async () => {
  const result = await showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Log Files', extensions: ['log', 'txt', 'out', 'err'] },
      { name: 'Data Files', extensions: ['json', 'xml', 'yaml', 'yml', 'csv', 'tsv', 'toml', 'ndjson', 'jsonl'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Multi-select variant used by the Time Sync "Add files…" flow: returns every chosen
// path (empty array on cancel) so the renderer can add them all in one action.
ipcMain.handle(IPC.OPEN_FILES_DIALOG, async () => {
  const result = await showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Log Files', extensions: ['log', 'txt', 'out', 'err'] },
      { name: 'Data Files', extensions: ['json', 'xml', 'yaml', 'yml', 'csv', 'tsv', 'toml', 'ndjson', 'jsonl'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

// === Folder Operations ===

ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async () => {
  const result = await showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  addToRecentFolders(result.filePaths[0]);
  return result.filePaths[0];
});

// Text extensions used by folder search (ripgrep glob filters)
const TEXT_EXTENSIONS = new Set([
  '.log', '.out', '.err', '.txt', '.text', '.md', '.markdown', '.rst',
  '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.config',
  '.csv', '.tsv', '.ndjson', '.jsonl',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.properties', '.env', '.gitignore', '.dockerignore',
]);

// Folder-tree scanning (sniffFileType / scanFolderShallow / hasChildren peek) lives in
// ./folderScan so it can be unit-tested without importing electron. The tree is LAZY:
// READ_FOLDER returns ONE level; deeper levels load on expand via the same handler
// (the renderer calls readFolder(subdirPath) for a subfolder). No depth cap, no
// whole-tree scan on open — see folderScan.ts.

ipcMain.handle(IPC.READ_FOLDER, async (_, folderPath: string) => {
  try {
    const files = await scanFolderShallow(folderPath);
    return { success: true, files, folderPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Folder Search ===
let folderSearchSignal: { cancelled: boolean } = { cancelled: false };

ipcMain.handle(IPC.FOLDER_SEARCH, async (_, folderPaths: string[], pattern: string, options: { isRegex: boolean; matchCase: boolean }) => {
  folderSearchSignal = { cancelled: false };

  if (!folderPaths.length || !pattern) {
    return { success: false, error: 'No folders or pattern provided' };
  }

  const matches: Array<{ filePath: string; fileName: string; lineNumber: number; column: number; lineText: string }> = [];
  const MAX_MATCHES = 1000;

  try {
    // Build ripgrep arguments
    const args: string[] = [
      '--line-number',
      '--column',
      '--no-heading',
      '--with-filename',
      '--max-count', '100', // Limit matches per file
    ];

    if (!options.matchCase) {
      args.push('--ignore-case');
    }

    if (options.isRegex) {
      args.push('--regexp', pattern);
    } else {
      args.push('--fixed-strings', pattern);
    }

    // Add file type filters for text files
    for (const ext of TEXT_EXTENSIONS) {
      args.push('--glob', `*${ext}`);
    }
    args.push('--glob', '!.*'); // Exclude hidden files

    // Add folder paths
    args.push(...folderPaths);

    return new Promise((resolve) => {
      const proc = spawn(getRipgrepPath(), args);
      let buffer = '';
      let lastProgressUpdate = 0;

      proc.stdout.on('data', (data: Buffer) => {
        if (folderSearchSignal.cancelled) {
          proc.kill();
          return;
        }

        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) continue;

          // Parse ripgrep output: filename:line:column:text
          const colonIndex1 = line.indexOf(':');
          if (colonIndex1 === -1) continue;

          const colonIndex2 = line.indexOf(':', colonIndex1 + 1);
          if (colonIndex2 === -1) continue;

          const colonIndex3 = line.indexOf(':', colonIndex2 + 1);
          if (colonIndex3 === -1) continue;

          const filePath = line.substring(0, colonIndex1);
          const lineNum = parseInt(line.substring(colonIndex1 + 1, colonIndex2), 10);
          const column = parseInt(line.substring(colonIndex2 + 1, colonIndex3), 10);
          const lineText = line.substring(colonIndex3 + 1);

          if (isNaN(lineNum) || isNaN(column)) continue;

          matches.push({
            filePath,
            fileName: path.basename(filePath),
            lineNumber: lineNum,
            column: column - 1,
            lineText: lineText.length > 500 ? lineText.substring(0, 500) + '...' : lineText,
          });

          if (matches.length >= MAX_MATCHES) {
            proc.kill();
            break;
          }
        }

        // Send progress updates
        const now = Date.now();
        if (now - lastProgressUpdate > 100) {
          lastProgressUpdate = now;
          mainWindow?.webContents.send(IPC.FOLDER_SEARCH_PROGRESS, { matchCount: matches.length });
        }
      });

      proc.on('error', () => {
        resolve({ success: false, error: 'ripgrep not available. Install with: brew install ripgrep' });
      });

      proc.on('close', () => {
        if (folderSearchSignal.cancelled) {
          resolve({ success: true, matches, cancelled: true });
        } else {
          resolve({ success: true, matches });
        }
      });
    });
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.FOLDER_SEARCH_CANCEL, async () => {
  folderSearchSignal.cancelled = true;
  return { success: true };
});

// === Column Analysis ===

interface ColumnInfo {
  index: number;
  name?: string;
  sample: string[];  // Sample values from this column
  visible: boolean;
}

interface ColumnAnalysis {
  delimiter: string;
  delimiterName: string;
  columns: ColumnInfo[];
  sampleLines: string[];
  hasHeaderRow?: boolean;
  // True when the header row is CONFIDENTLY named (recognizable column keywords), so the
  // Columns window can proactively PROPOSE it as a ready-to-accept layout. Distinct from the
  // looser `hasHeaderRow` (positional guess) which only drives sample-row skipping.
  headerConfident?: boolean;
}

// detectDelimiter(), findHeaderRow(), isCommentOrBanner() and the header-keyword set now live
// in ../shared/columnDetect (pure + unit-tested). They understand whitespace-ALIGNED formats
// (\s{2,} columns) and locate the header among the first rows, not just row 0 — so a leading
// "#----- BEGIN:" banner no longer masquerades as the header (see esotrace 11-column exports).

ipcMain.handle('analyze-columns', async () => {
  // getReadHandler (not getFileHandler) so column detection works over an active single-session
  // composite / segmented big file too — they're kept out of fileHandlerCache, so getFileHandler
  // returns null there and the Columns modal's Detect used to report "No file open" (which meant
  // you couldn't set up — hence couldn't hide/mute — columns on a merged/virtual session). All
  // three handler types share the sync getLines(start,count) shape this uses.
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    // Get sample lines (first 100 non-empty lines)
    const sampleSize = 100;
    const lines = handler.getLines(1, sampleSize);
    const rawLines = lines.filter(l => l.text.trim().length > 0).map(l => l.text);

    if (rawLines.length === 0) {
      return { success: false, error: 'No content to analyze' };
    }

    // Drop banner/comment lines (e.g. the esotrace "#----- BEGIN:" header) so they don't skew
    // delimiter detection or pose as the header row. Fall back to the raw lines if stripping
    // would leave us with almost nothing to analyze.
    const stripped = rawLines.filter(l => !isCommentOrBanner(l));
    const analysisLines = stripped.length >= 2 ? stripped : rawLines;

    // Detect delimiter (handles whitespace-aligned / \s{2,} columns)
    const { delimiter, name: delimiterName } = detectDelimiter(analysisLines);

    // Split lines into columns (shared canonical splitter — must match the filter paths)
    const splitLines = analysisLines.map(line => splitLineIntoColumns(line, delimiter));

    // Find max column count
    const maxColumns = Math.max(...splitLines.map(cols => cols.length));

    // Locate the header row among the first rows (may be > 0) via type contrast + keywords
    const { headerIndex, names: headerNames, confident: headerConfident } = findHeaderRow(splitLines);
    const hasHeader = headerIndex >= 0;

    // Build column info with samples (skip everything up to & including the header row)
    const sampleStartIdx = hasHeader ? headerIndex + 1 : 0;
    const columns: ColumnInfo[] = [];
    for (let i = 0; i < maxColumns; i++) {
      const samples = splitLines
        .slice(sampleStartIdx)
        .map(cols => cols[i] || '')
        .filter(s => s.trim().length > 0)
        .slice(0, 5); // Keep 5 samples per column

      columns.push({
        index: i,
        name: hasHeader && i < headerNames.length ? headerNames[i] : undefined,
        sample: samples,
        visible: true, // All visible by default
      });
    }

    const result: ColumnAnalysis = {
      delimiter,
      delimiterName,
      columns,
      sampleLines: analysisLines.slice(0, 5), // First 5 non-banner lines as preview
      hasHeaderRow: hasHeader,
      headerConfident,
    };

    return { success: true, analysis: result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.OPEN_FILE, async (_, filePath: string) => {
  try {
    // "Single session" re-entry: the renderer opens the composite through this same path
    // (via its synthetic id) so it reuses all of loadFile()'s viewer setup. The composite
    // was already built by CREATE_COMPOSITE — just make it current and return its info.
    if (activeComposite && filePath === activeCompositeId) {
      currentFilePath = filePath;
      mainWindow?.webContents.send('indexing-progress', 100);
      return {
        success: true,
        info: activeComposite.getFileInfo(),
        compositeBoundaries: activeComposite.boundaries(),
      };
    }
    // Opening any real file exits composite / segmented mode.
    activeComposite = null;
    activeCompositeId = null;
    clearActiveSegmented();

    // Check if file is already cached
    let fileHandler = fileHandlerCache.get(filePath);
    let segmented: SegmentedFileHandler | null = null;
    let info;

    // Drop the cached handler if the file changed on disk since it was indexed,
    // so re-opening an edited file (e.g. a markdown doc) shows fresh content
    // instead of stale cached lines.
    if (fileHandler && fileHandler.isStale()) {
      evictFromCache(filePath);
      fileHandler = undefined;
    }

    if (fileHandler) {
      // File already indexed - just switch to it
      currentFilePath = filePath;
      info = fileHandler.getFileInfo();
      // Send 100% progress immediately since no indexing needed
      mainWindow?.webContents.send('indexing-progress', 100);
    } else {
      // Auto-composite a big plain-text file: index only the hot segments (bounded RAM)
      // instead of the whole-file offset index. No-op (returns null) unless the feature is
      // ON and the file's whole-file index would exceed the adaptive memory budget.
      segmented = await maybeOpenSegmented(filePath, (percent) => {
        mainWindow?.webContents.send('indexing-progress', percent);
      });
      if (segmented) {
        activeSegmented = segmented;
        activeSegmentedPath = filePath;
        currentFilePath = filePath;
        info = segmented.getFileInfo();
        mainWindow?.webContents.send('indexing-progress', 100);
        const p = segmented.plan;
        console.log(
          `[auto-segment] ${filePath}: ${p?.totalSegments} segments, resident cap ` +
          `${p?.maxResidentSegments}; est whole-file index ` +
          `${Math.round((p?.estWholeIndexBytes ?? 0) / 1e6)}MB → resident ` +
          `${Math.round((p?.estResidentIndexBytes ?? 0) / 1e6)}MB (budget ` +
          `${Math.round((p?.budgetBytes ?? 0) / 1e6)}MB)`
        );
      } else {
        // New file - pick a format adapter, normalize, then index.
        // Text is a zero-overhead passthrough (original path, no copy/decode).
        fileHandler = new FileHandler();
        const opened = await openWithAdapter(fileHandler, filePath, (percent) => {
          mainWindow?.webContents.send('indexing-progress', percent);
        });
        info = opened.info;
        sourceRegistry.set(filePath, opened.source);
        addToCache(filePath, fileHandler);
        currentFilePath = filePath;
      }
    }

    // The active read target for this open — either the real FileHandler or the segmented
    // wrapper. Both expose getMaxLineLength(); split lineage is FileHandler-only (segmented
    // targets un-split big logs), so it's read only when we have a real FileHandler.
    const readHandler: FileHandler | SegmentedFileHandler = fileHandler ?? segmented!;

    // Detect long lines for warning
    const LONG_LINE_THRESHOLD = 5000; // chars
    const maxLineLength = readHandler.getMaxLineLength();
    const hasLongLines = maxLineLength > LONG_LINE_THRESHOLD && !filePath.includes('.formatted.');

    // Load bookmarks and highlights for this file
    const persistPath = filePath;
    loadBookmarksForFile(persistPath);
    loadHighlightsForFile(persistPath);
    loadAnnotationsForFile(persistPath);
    pushAnnotationsToRenderer();

    // Update lastOpened in local sidecar + stamp/verify the decode identity.
    if (canWriteLocal(persistPath)) {
      const localData = loadLocalFileData(persistPath);
      const decode = decodeIdentity(persistPath);
      // Stale-marks check: this decoded file already carries marks stamped by a
      // DIFFERENT adapter/decoderVersion → a formatting change may have shifted
      // line numbers, so pinned lines could now point at the wrong place. Warn
      // once (the stamp is then refreshed below so we don't nag every open).
      if (decode && localData.decodedBy &&
          (localData.decodedBy.adapterId !== decode.adapterId ||
           localData.decodedBy.decoderVersion !== decode.decoderVersion) &&
          hasPinnedMarks(localData)) {
        console.warn(`[stale-marks] ${persistPath}: marks pinned by ${localData.decodedBy.adapterId} v${localData.decodedBy.decoderVersion}, now decoded by ${decode.adapterId} v${decode.decoderVersion}`);
        mainWindow?.webContents.send('stale-marks-warning', {
          filePath: persistPath,
          storedBy: localData.decodedBy,
          currentBy: decode,
        });
      }
      localData.lastOpened = new Date().toISOString();
      if (decode) localData.decodedBy = decode; // (re)stamp with the current decode
      saveLocalFileData(persistPath, localData);
    }
    logActivity(persistPath, 'file_opened', { filePath: persistPath });
    addToRecentFiles(persistPath);

    // Check for split metadata in file header (preferred). Segmented mode has no real
    // FileHandler and targets un-split big logs, so there's no split lineage to read.
    const splitMeta = fileHandler ? fileHandler.getSplitMetadata() : null;
    let splitInfo: { files: string[]; currentIndex: number } | undefined;

    if (splitMeta) {
      // Build file list from header metadata
      const dir = path.dirname(filePath);
      const files: string[] = [];
      let currentIndex = splitMeta.part - 1;

      // We need to find all parts - scan directory for matching files
      const baseMatch = path.basename(filePath).match(/^(.+)_part\d+(\.[^.]+)?$/);
      if (baseMatch) {
        const baseName = baseMatch[1];
        const ext = baseMatch[2] || '';
        const dirFiles = fs.readdirSync(dir);

        for (let i = 1; i <= splitMeta.total; i++) {
          const partNum = String(i).padStart(String(splitMeta.total).length, '0');
          const expectedName = `${baseName}_part${partNum}${ext}`;
          if (dirFiles.includes(expectedName)) {
            files.push(path.join(dir, expectedName));
          }
        }

        if (files.length > 0) {
          splitInfo = { files, currentIndex };
        }
      }
    } else {
      // Fall back to filename-based detection
      const splitFiles = detectSplitFiles(filePath);
      if (splitFiles) {
        splitInfo = {
          files: splitFiles,
          currentIndex: splitFiles.indexOf(filePath)
        };
      }
    }

    return {
      success: true,
      info,
      splitFiles: splitInfo?.files,
      splitIndex: splitInfo?.currentIndex,
      bookmarks: Array.from(bookmarks.values()),
      highlights: Array.from(highlights.values()),
      hasLongLines,
      maxLineLength,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Sync the renderer's `auto-segment` Features toggle into main. Main owns the flag so every
// open path (renderer OPEN_FILE + agent open) agrees on whether to auto-segment a big file.
ipcMain.handle(IPC.SET_AUTO_SEGMENT, (_e, enabled: boolean) => {
  autoSegmentEnabled = !!enabled;
  return { success: true };
});

// Live segment-plan readout for the currently-open file — drives the legible RAM readout in
// the Features modal (est whole-file index vs adaptive budget, and, if active, the plan +
// how many segment indexes are resident right now).
ipcMain.handle(IPC.SEGMENT_PLAN_PREVIEW, () => {
  try {
    const mem = readSystemMemory();
    const active = !!(activeSegmented && currentFilePath === activeSegmentedPath);
    let fileSize = 0;
    let passthrough = false;
    let plan = null as ReturnType<typeof computeSegmentPlan> | null;
    // Skip the synthetic composite id (not a real path) — statSync would throw.
    if (currentFilePath && currentFilePath !== activeCompositeId) {
      passthrough = isTextPassthrough(currentFilePath);
      try { fileSize = fs.statSync(currentFilePath).size; } catch { fileSize = 0; }
      if (fileSize > 0) plan = computeSegmentPlan(fileSize, mem);
    }
    return {
      success: true,
      enabled: autoSegmentEnabled,
      active,
      passthrough,
      fileSize,
      residentSegments: active ? activeSegmented!.residentSegmentCount() : 0,
      mem: { freeBytes: mem.freeBytes, heapLimitBytes: mem.heapLimitBytes, heapUsedBytes: mem.heapUsedBytes },
      plan,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Build a "single session" composite from an ordered list of files. The renderer then
// opens the returned synthetic id through the normal OPEN_FILE path.
ipcMain.handle(IPC.CREATE_COMPOSITE, async (_, filePaths: string[], label?: string) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length < 2) {
      return { success: false, error: 'Pick at least 2 files for a single session' };
    }
    const built = await buildComposite(filePaths, label);
    // Auto-save this file-set so the exact same single session can be re-run later
    // (surfaces in the Saved panel + logan_entities; deduped by ordered file-set).
    autoSaveSingleSession(filePaths, label);
    // Count the human "🔗 Single session" verb for the Usage Monitor (joins with the AI
    // 'composite-create' slug via verbRegistry). The synthetic composite id isn't a writable
    // path, so logActivity bumps usage but writes no sidecar — exactly what we want here.
    logActivity(built.id, 'composite_created', { fileCount: filePaths.length });
    return { success: true, id: built.id, info: built.info, boundaries: built.boundaries };
  } catch (error) {
    activeComposite = null;
    activeCompositeId = null;
    return { success: false, error: String(error) };
  }
});

// Detect if a file is part of a split set and find all related parts
function detectSplitFiles(filePath: string): string[] | undefined {
  const fileName = path.basename(filePath);
  const dir = path.dirname(filePath);

  // Match pattern: name_part01.ext, name_part1.ext, etc.
  const partMatch = fileName.match(/^(.+)_part(\d+)(\.[^.]+)?$/);
  if (!partMatch) return undefined;

  const baseName = partMatch[1];
  const ext = partMatch[3] || '';

  // Find all files matching the pattern in the same directory
  try {
    const files = fs.readdirSync(dir);
    const partFiles: { path: string; num: number }[] = [];

    for (const file of files) {
      const match = file.match(new RegExp(`^${escapeRegex(baseName)}_part(\\d+)${escapeRegex(ext)}$`));
      if (match) {
        partFiles.push({
          path: path.join(dir, file),
          num: parseInt(match[1], 10)
        });
      }
    }

    // Sort by part number and return paths
    if (partFiles.length > 1) {
      partFiles.sort((a, b) => a.num - b.num);
      return partFiles.map(p => p.path);
    }
  } catch {
    // Ignore errors reading directory
  }

  return undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

ipcMain.handle(IPC.GET_LINES, async (_, startLine: number, count: number) => {
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const filteredIndices = getFilteredLines();

  if (filteredIndices) {
    // Filter is active - startLine/count refer to positions in filtered list
    const endIdx = Math.min(startLine + count, filteredIndices.length);
    const lineNumbers = filteredIndices.slice(startLine, endIdx);

    // Fetch by real line numbers, coalescing physically-consecutive runs into
    // single reads (one syscall per run, not per line — see getLinesByNumbers).
    const lines = await handler.getLinesByNumbers(lineNumbers);
    return { success: true, lines };
  }

  // No filter - normal operation (async so rendering doesn't starve a search)
  const lines = await handler.getLinesAsync(startLine, count);
  return { success: true, lines };
});

// === Severity index (background jump-to-problem) ===

ipcMain.handle(IPC.SEVERITY_INFO, async (_, buckets: number) => {
  // getReadHandler so F8/Shift+F8 jump-to-problem works on an active single-session composite
  // too — it builds a combined severity index by rebasing each member's index into global lines.
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };
  try {
    const info = await handler.getSeverityInfo(typeof buckets === 'number' ? buckets : 0);
    return { success: true, ...info };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle(IPC.SEVERITY_NEXT, async (_, fromLine: number, dir: 1 | -1, levels: string[]) => {
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };
  const allowed = (Array.isArray(levels) ? levels : [])
    .filter((l): l is 'fatal' | 'error' | 'warning' => l === 'fatal' || l === 'error' || l === 'warning');
  const wanted = allowed.length ? allowed : (['fatal', 'error', 'warning'] as const).slice();
  try {
    const line = await handler.getNextSeverityLine(fromLine, dir === -1 ? -1 : 1, wanted);
    return { success: true, line };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// === Search ===

ipcMain.handle(IPC.SEARCH, async (_, options: SearchOptions) => {
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };

  // Silent searches (e.g. the Make-pattern live match-count preview) must not
  // pollute real state/telemetry: use a SEPARATE cancel signal so they don't
  // cancel the user's in-flight search, skip the progress UI, and skip
  // logActivity (which would fabricate history + human::search on every keystroke).
  const silent = !!options.silent;
  // A new non-silent search supersedes any in-flight one: cancel the previous signal
  // BEFORE replacing it, so we never have two rg processes streaming into the same
  // renderer. Silent (preview) searches use a private signal and neither cancel nor
  // are cancelled by the user's search.
  if (!silent) searchSignal.cancelled = true;
  const signal = silent ? { cancelled: false } : (searchSignal = { cancelled: false });
  const searchId = options.searchId;

  // Compute the active filter set up front so streamed deltas can be filter-aware:
  // forward only matches on visible lines, tagged with their displayIndex, so streamed
  // rows are identical to the final filteredMatches. Fixes the transient over-count and
  // clicking a streamed match that sits on a filtered-out line.
  const streamFilterIndices = silent ? null : getFilteredLines();
  const streamFilterSet = streamFilterIndices && streamFilterIndices.length > 0 ? new Set(streamFilterIndices) : null;
  const streamDisplayIndex = new Map<number, number>();
  if (streamFilterSet) streamFilterIndices!.forEach((ln, idx) => streamDisplayIndex.set(ln, idx));

  const t0 = Date.now();
  try {
    const matches = await handler.search(
      options,
      (percent, matchCount, deltaMatches) => {
        // Forward the running % + count AND the new matches since the last tick, so the
        // renderer can populate the results panel live. searchId lets the renderer drop
        // late events from a search that a newer one has superseded.
        if (silent) return;
        let outMatches = deltaMatches;
        if (streamFilterSet && deltaMatches) {
          outMatches = deltaMatches
            .filter(m => streamFilterSet.has(m.lineNumber))
            .map(m => ({ ...m, displayIndex: streamDisplayIndex.get(m.lineNumber) }));
        }
        mainWindow?.webContents.send(IPC.SEARCH_PROGRESS, { percent, matchCount, matches: outMatches, searchId });
      },
      signal
    );

    if (!silent && currentFilePath) logActivity(currentFilePath, 'search', { pattern: options.pattern, isRegex: options.isRegex, matchCount: matches.length });
    // Feed the Pattern Log flight recorder for real (non-silent) searches. Silent
    // searches are the Make-pattern live preview and must not flood the log.
    if (!silent) recordPatternApplication({
      scope: 'search', source: options.pattern || '', mode: options.isRegex ? 'regex' : 'plain',
      scanned: handler.getTotalLines(), matched: matches.length,
      sampleHits: matches.slice(0, 5).map(m => m.lineNumber + 1), ms: Date.now() - t0,
    });

    // Engine + elapsed for the in-app search readout (ripgrep = fast native scan;
    // stream = the slow JS fallback, e.g. for \r-line-ending files). See fileHandler.search().
    const searchMeta = { engine: handler.lastSearchEngine ?? undefined, searchReason: handler.lastSearchReason ?? undefined, searchMs: Date.now() - t0 };

    // Check if filter is active for current file
    const filteredIndices = getFilteredLines();

    // If filter is active, separate matches into visible and hidden
    if (filteredIndices && filteredIndices.length > 0) {
      const filteredSet = new Set(filteredIndices);
      const lineToFilteredIndex = new Map<number, number>();
      filteredIndices.forEach((lineNum, idx) => {
        lineToFilteredIndex.set(lineNum, idx);
      });

      const filteredMatches: any[] = [];
      const hiddenMatches: any[] = [];

      for (const m of matches) {
        if (filteredSet.has(m.lineNumber)) {
          filteredMatches.push({
            ...m,
            displayIndex: lineToFilteredIndex.get(m.lineNumber),
          });
        } else {
          hiddenMatches.push({
            lineNumber: m.lineNumber,
            column: m.column,
            length: m.length,
            lineText: m.lineText,
          });
        }
      }

      return { success: true, matches: filteredMatches, hiddenMatches, ...searchMeta };
    }

    // Check for hidden column matches (matches in columns that are filtered out)
    if (options.columnConfig) {
      const hiddenCols = options.columnConfig.columns.filter(c => !c.visible).map(c => c.index);
      if (hiddenCols.length > 0) {
        // Do a full-text search (without column config) to find matches in hidden columns
        const fullOptions = { ...options, columnConfig: undefined };
        const fullMatches = await handler.search(fullOptions, () => {}, signal);
        // Find matches that are NOT in the visible column results
        const visibleMatchSet = new Set(matches.map(m => `${m.lineNumber}:${m.column}`));
        const hiddenColumnMatches = fullMatches
          .filter(m => !visibleMatchSet.has(`${m.lineNumber}:${m.column}`))
          .map(m => ({
            lineNumber: m.lineNumber,
            column: m.column,
            length: m.length,
            lineText: m.lineText,
          }));
        if (hiddenColumnMatches.length > 0) {
          return { success: true, matches, hiddenColumnMatches, ...searchMeta };
        }
      }
    }

    return { success: true, matches, ...searchMeta };
  } catch (error) {
    // Record the FAILED pattern too — a silently-broken regex is exactly what the
    // flight recorder exists to surface.
    if (!silent) recordPatternApplication({
      scope: 'search', source: options.pattern || '', mode: options.isRegex ? 'regex' : 'plain',
      scanned: 0, matched: 0, ms: Date.now() - t0, valid: false, error: String(error),
    });
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SEARCH_CANCEL, async () => {
  searchSignal.cancelled = true;
  return { success: true };
});

// === Get Lines For File (used by secondary viewer in split/diff mode) ===

ipcMain.handle(IPC.GET_LINES_FOR_FILE, async (_, filePath: string, startLine: number, count: number) => {
  const handler = fileHandlerCache.get(filePath);
  if (!handler) return { success: false, error: 'File not in cache' };

  const filteredIndices = filterState.get(filePath) || null;

  if (filteredIndices) {
    const endIdx = Math.min(startLine + count, filteredIndices.length);
    const lineNumbers = filteredIndices.slice(startLine, endIdx);
    const lines = await handler.getLinesByNumbers(lineNumbers);
    return { success: true, lines };
  }

  const lines = await handler.getLinesAsync(startLine, count);
  return { success: true, lines };
});

// === Diff Compute ===

const DIFF_MAX_LINES = 100000;

ipcMain.handle(IPC.DIFF_COMPUTE, async (_, leftFilePath: string, rightFilePath: string) => {
  const leftHandler = fileHandlerCache.get(leftFilePath);
  const rightHandler = fileHandlerCache.get(rightFilePath);

  if (!leftHandler || !rightHandler) {
    return { success: false, error: 'Both files must be open in tabs' };
  }

  const leftTotal = leftHandler.getTotalLines();
  const rightTotal = rightHandler.getTotalLines();

  if (leftTotal > DIFF_MAX_LINES || rightTotal > DIFF_MAX_LINES) {
    return { success: false, error: `Files too large for diff (limit: ${DIFF_MAX_LINES.toLocaleString()} lines). Left: ${leftTotal.toLocaleString()}, Right: ${rightTotal.toLocaleString()}` };
  }

  diffSignal = { cancelled: false };

  try {
    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 10, phase: 'Reading files...' });

    // Read all lines from both files
    const leftLines: string[] = [];
    const rightLines: string[] = [];

    const CHUNK = 10000;
    for (let i = 0; i < leftTotal; i += CHUNK) {
      if (diffSignal.cancelled) return { success: false, error: 'Cancelled' };
      const lines = leftHandler.getLines(i, Math.min(CHUNK, leftTotal - i));
      for (const l of lines) leftLines.push(l.text);
    }

    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 30, phase: 'Reading files...' });

    for (let i = 0; i < rightTotal; i += CHUNK) {
      if (diffSignal.cancelled) return { success: false, error: 'Cancelled' };
      const lines = rightHandler.getLines(i, Math.min(CHUNK, rightTotal - i));
      for (const l of lines) rightLines.push(l.text);
    }

    if (diffSignal.cancelled) return { success: false, error: 'Cancelled' };

    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 50, phase: 'Computing diff...' });

    // Compute line-level diff
    const changes = Diff.diffArrays(leftLines, rightLines);

    if (diffSignal.cancelled) return { success: false, error: 'Cancelled' };

    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 80, phase: 'Building hunks...' });

    // Build hunks from changes, merging adjacent removed+added into modified
    interface DiffHunk {
      type: 'equal' | 'added' | 'removed' | 'modified';
      leftStart: number;
      leftCount: number;
      rightStart: number;
      rightCount: number;
    }

    const hunks: DiffHunk[] = [];
    let leftIdx = 0;
    let rightIdx = 0;
    let stats = { additions: 0, deletions: 0, modifications: 0 };

    for (let c = 0; c < changes.length; c++) {
      const change = changes[c];
      const count = change.count || 0;

      if (!change.added && !change.removed) {
        // Equal
        hunks.push({ type: 'equal', leftStart: leftIdx, leftCount: count, rightStart: rightIdx, rightCount: count });
        leftIdx += count;
        rightIdx += count;
      } else if (change.removed && c + 1 < changes.length && changes[c + 1].added) {
        // Removed followed by added → modified
        const nextChange = changes[c + 1];
        const nextCount = nextChange.count || 0;
        hunks.push({ type: 'modified', leftStart: leftIdx, leftCount: count, rightStart: rightIdx, rightCount: nextCount });
        stats.modifications += Math.max(count, nextCount);
        leftIdx += count;
        rightIdx += nextCount;
        c++; // skip the added part
      } else if (change.removed) {
        hunks.push({ type: 'removed', leftStart: leftIdx, leftCount: count, rightStart: rightIdx, rightCount: 0 });
        stats.deletions += count;
        leftIdx += count;
      } else if (change.added) {
        hunks.push({ type: 'added', leftStart: leftIdx, leftCount: 0, rightStart: rightIdx, rightCount: count });
        stats.additions += count;
        rightIdx += count;
      }
    }

    mainWindow?.webContents.send(IPC.DIFF_PROGRESS, { percent: 100, phase: 'Done' });

    if (currentFilePath) logActivity(currentFilePath, 'diff_compared', { leftFile: leftFilePath, rightFile: rightFilePath });

    return {
      success: true,
      result: {
        hunks,
        stats,
        leftTotalLines: leftTotal,
        rightTotalLines: rightTotal,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.DIFF_CANCEL, async () => {
  diffSignal.cancelled = true;
  return { success: true };
});

// === Bookmarks ===

ipcMain.handle('bookmark-add', async (_, bookmark: Bookmark) => {
  bookmarks.set(bookmark.id, bookmark);
  saveBookmarksForCurrentFile();
  if (currentFilePath) logActivity(currentFilePath, 'bookmark_added', { lineNumber: bookmark.lineNumber, label: bookmark.label });
  return { success: true };
});

ipcMain.handle('bookmark-remove', async (_, id: string) => {
  bookmarks.delete(id);
  saveBookmarksForCurrentFile();
  if (currentFilePath) logActivity(currentFilePath, 'bookmark_removed', { bookmarkId: id });
  return { success: true };
});

ipcMain.handle('bookmark-list', async () => {
  return { success: true, bookmarks: Array.from(bookmarks.values()).sort((a, b) => a.lineNumber - b.lineNumber) };
});

ipcMain.handle('bookmark-clear', async () => {
  const count = bookmarks.size;
  bookmarks.clear();
  saveBookmarksForCurrentFile();
  if (currentFilePath && count > 0) logActivity(currentFilePath, 'bookmark_cleared', { count });
  return { success: true };
});

// Update bookmark (for editing comments)
ipcMain.handle('bookmark-update', async (_, bookmark: Bookmark) => {
  if (bookmarks.has(bookmark.id)) {
    bookmarks.set(bookmark.id, bookmark);
    saveBookmarksForCurrentFile();
    return { success: true };
  }
  return { success: false, error: 'Bookmark not found' };
});

// Export bookmarks to file
ipcMain.handle('export-bookmarks', async () => {
  if (!currentFilePath || bookmarks.size === 0) {
    return { success: false, error: 'No bookmarks to export' };
  }

  try {
    const handler = getFileHandler();
    const fileInfo = handler?.getFileInfo();
    if (!fileInfo) {
      return { success: false, error: 'No file info available' };
    }

    // Generate export filename
    const currentDir = path.dirname(fileInfo.path);
    const baseName = path.basename(fileInfo.path, path.extname(fileInfo.path));
    const timestamp = new Date().toISOString().substring(0, 10).replace(/-/g, '');
    const exportPath = path.join(currentDir, `${baseName}_bookmarks_${timestamp}.md`);

    // Build markdown content with clickable links
    const lines: string[] = [
      `# Bookmarks`,
      ``,
      `**Source:** \`${fileInfo.path}\``,
      `**Exported:** ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`,
      `**Total Bookmarks:** ${bookmarks.size}`,
      ``,
      `---`,
      ``,
    ];

    // Sort bookmarks by line number
    const sortedBookmarks = Array.from(bookmarks.values())
      .sort((a, b) => a.lineNumber - b.lineNumber);

    for (const bookmark of sortedBookmarks) {
      // Use stored lineText if available, otherwise fetch from file
      const lineText = bookmark.lineText || (handler?.getLines(bookmark.lineNumber, 1)?.[0]?.text) || '';

      lines.push(`## Line ${bookmark.lineNumber + 1}`);
      lines.push(``);
      if (bookmark.label) {
        lines.push(`**Note:** ${bookmark.label}`);
        lines.push(``);
      }
      // File link in format that some editors/tools can open (VSCode, etc)
      lines.push(`**Link:** \`${fileInfo.path}:${bookmark.lineNumber + 1}\``);
      lines.push(``);
      lines.push(`\`\`\``);
      lines.push(lineText);
      lines.push(`\`\`\``);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }

    fs.writeFileSync(exportPath, lines.join('\n'), 'utf-8');

    return { success: true, filePath: exportPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Bookmark Sets ===

interface BookmarkSet {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bookmarks: Bookmark[];
}

function loadBookmarkSets(): BookmarkSet[] {
  try {
    const setsPath = getBookmarkSetsPath();
    if (fs.existsSync(setsPath)) {
      const data = JSON.parse(fs.readFileSync(setsPath, 'utf-8'));
      return data.sets || [];
    }
  } catch {}
  return [];
}

function saveBookmarkSets(sets: BookmarkSet[]): void {
  ensureConfigDir();
  fs.writeFileSync(getBookmarkSetsPath(), JSON.stringify({ sets }, null, 2), 'utf-8');
}

ipcMain.handle('bookmark-set-list', async () => {
  return { success: true, sets: loadBookmarkSets() };
});

ipcMain.handle('bookmark-set-save', async (_, set: BookmarkSet) => {
  const sets = loadBookmarkSets();
  sets.push(set);
  saveBookmarkSets(sets);
  return { success: true };
});

ipcMain.handle('bookmark-set-update', async (_, set: BookmarkSet) => {
  const sets = loadBookmarkSets();
  const idx = sets.findIndex(s => s.id === set.id);
  if (idx >= 0) {
    sets[idx] = set;
    saveBookmarkSets(sets);
    return { success: true };
  }
  return { success: false, error: 'Set not found' };
});

ipcMain.handle('bookmark-set-delete', async (_, setId: string) => {
  const sets = loadBookmarkSets();
  const filtered = sets.filter(s => s.id !== setId);
  saveBookmarkSets(filtered);
  return { success: true };
});

ipcMain.handle('bookmark-set-load', async (_, setId: string) => {
  const sets = loadBookmarkSets();
  const set = sets.find(s => s.id === setId);
  if (set) {
    return { success: true, bookmarks: set.bookmarks };
  }
  return { success: false, error: 'Set not found' };
});

// === Highlights ===

ipcMain.handle('highlight-add', async (_, highlight: Highlight) => {
  highlights.set(highlight.id, highlight);
  saveHighlight(highlight);
  if (currentFilePath) logActivity(currentFilePath, 'highlight_added', { pattern: highlight.pattern, isGlobal: !!highlight.isGlobal });
  return { success: true };
});

ipcMain.handle('highlight-remove', async (_, id: string) => {
  highlights.delete(id);
  removeHighlightFromStore(id);
  if (currentFilePath) logActivity(currentFilePath, 'highlight_removed', { highlightId: id });
  return { success: true };
});

ipcMain.handle('highlight-update', async (_, highlight: Highlight) => {
  if (highlights.has(highlight.id)) {
    highlights.set(highlight.id, highlight);
    saveHighlight(highlight);
    return { success: true };
  }
  return { success: false, error: 'Highlight not found' };
});

ipcMain.handle('highlight-list', async () => {
  return { success: true, highlights: Array.from(highlights.values()) };
});

ipcMain.handle('highlight-clear', async () => {
  // Only clear file-specific highlights for current file, not global ones
  if (currentFilePath && currentFileUsesLocalStorage) {
    // Clear local .logan/ file-specific highlights
    const localData = loadLocalFileData(currentFilePath);
    const clearedCount = localData.highlights.length;
    localData.highlights = [];
    saveLocalFileData(currentFilePath, localData);
    if (clearedCount > 0) {
      logActivity(currentFilePath, 'highlight_cleared', { count: clearedCount });
    }
  }
  // Also clear from global store for this file (migration leftovers)
  const store = loadHighlightsStore();
  if (currentFilePath && store[currentFilePath]) {
    delete store[currentFilePath];
    saveHighlightsStore(store);
  }
  // Reload to keep global highlights
  if (currentFilePath) {
    loadHighlightsForFile(currentFilePath);
  }
  return { success: true, highlights: Array.from(highlights.values()) };
});

ipcMain.handle('highlight-clear-all', async () => {
  // Clear all highlights including global
  highlights.clear();
  saveHighlightsStore({});
  // Also clear local file-specific highlights
  if (currentFilePath && currentFileUsesLocalStorage) {
    const localData = loadLocalFileData(currentFilePath);
    localData.highlights = [];
    saveLocalFileData(currentFilePath, localData);
  }
  return { success: true };
});

ipcMain.handle('highlight-get-next-color', async () => {
  return { success: true, color: getNextColor() };
});

// === Agent Annotations IPC ===

ipcMain.handle('annotation-add', async (_, annotation: Annotation) => {
  annotations.set(annotation.id, annotation);
  saveAnnotationsForCurrentFile();
  if (currentFilePath) logActivity(currentFilePath, 'annotation_added', { lineNumber: annotation.lineNumber, agentName: annotation.agentName });
  pushAnnotationsToRenderer();
  return { success: true };
});

ipcMain.handle('annotation-remove', async (_, id: string) => {
  annotations.delete(id);
  saveAnnotationsForCurrentFile();
  pushAnnotationsToRenderer();
  return { success: true };
});

ipcMain.handle('annotation-list', async () => {
  return { success: true, annotations: Array.from(annotations.values()).sort((a, b) => a.lineNumber - b.lineNumber) };
});

ipcMain.handle('annotation-clear', async () => {
  annotations.clear();
  saveAnnotationsForCurrentFile();
  pushAnnotationsToRenderer();
  return { success: true };
});

// Update one annotation in place (e.g. the user ticks a handoff finding done).
ipcMain.handle('annotation-update', async (_, id: string, patch: Partial<Annotation>) => {
  const a = annotations.get(id);
  if (!a) return { success: false, error: 'not found' };
  annotations.set(id, { ...a, ...patch, id: a.id });
  saveAnnotationsForCurrentFile();
  pushAnnotationsToRenderer();
  return { success: true };
});

// Clear one whole handoff group (all findings sharing a handoffId).
ipcMain.handle('annotation-clear-handoff', async (_, handoffId: string) => {
  for (const [id, a] of annotations) if (a.handoffId === handoffId) annotations.delete(id);
  saveAnnotationsForCurrentFile();
  pushAnnotationsToRenderer();
  return { success: true };
});

// === Highlight Groups ===

function loadHighlightGroups(): HighlightGroup[] {
  try {
    const filePath = getHighlightGroupsPath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveHighlightGroups(groups: HighlightGroup[]): void {
  ensureConfigDir();
  fs.writeFileSync(getHighlightGroupsPath(), JSON.stringify(groups, null, 2), 'utf-8');
}

ipcMain.handle('highlight-group-list', async () => {
  return { success: true, groups: loadHighlightGroups() };
});

ipcMain.handle('highlight-group-save', async (_, group: HighlightGroup) => {
  const groups = loadHighlightGroups();
  const existingIdx = groups.findIndex(g => g.id === group.id);
  if (existingIdx >= 0) {
    groups[existingIdx] = group;
  } else {
    groups.push(group);
  }
  saveHighlightGroups(groups);
  return { success: true };
});

ipcMain.handle('highlight-group-delete', async (_, groupId: string) => {
  const groups = loadHighlightGroups().filter(g => g.id !== groupId);
  saveHighlightGroups(groups);
  return { success: true };
});

// === Search Configs ===

const getSearchConfigsPath = () => path.join(getConfigDir(), 'search-configs.json');
const GLOBAL_SEARCH_CONFIGS_KEY = '_global';

interface SearchConfigsStore {
  [key: string]: SearchConfig[];
}

function loadSearchConfigsStore(): SearchConfigsStore {
  try {
    ensureConfigDir();
    const configPath = getSearchConfigsPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load search configs:', error);
  }
  return {};
}

function saveSearchConfigsStore(store: SearchConfigsStore): void {
  try {
    ensureConfigDir();
    const configPath = getSearchConfigsPath();
    const cleanStore: SearchConfigsStore = {};
    for (const [key, value] of Object.entries(store)) {
      if (value.length > 0) {
        cleanStore[key] = value;
      }
    }
    fs.writeFileSync(configPath, JSON.stringify(cleanStore, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save search configs:', error);
  }
}

function loadSearchConfigsForFile(filePath: string): SearchConfig[] {
  const store = loadSearchConfigsStore();
  const configs: SearchConfig[] = [];

  // Load global configs
  const globalConfigs = store[GLOBAL_SEARCH_CONFIGS_KEY] || [];
  for (const c of globalConfigs) {
    configs.push({ ...c, isGlobal: true });
  }

  // Load file-specific configs
  if (filePath) {
    const fileConfigs = store[filePath] || [];
    for (const c of fileConfigs) {
      configs.push({ ...c, isGlobal: false });
    }
  }

  return configs;
}

function saveSearchConfig(config: SearchConfig): void {
  const store = loadSearchConfigsStore();

  // Remove from all keys first
  for (const k of Object.keys(store)) {
    store[k] = store[k].filter(c => c.id !== config.id);
  }

  const key = config.isGlobal ? GLOBAL_SEARCH_CONFIGS_KEY : (currentFilePath || GLOBAL_SEARCH_CONFIGS_KEY);
  if (!store[key]) store[key] = [];
  store[key].push(config);
  saveSearchConfigsStore(store);
}

function removeSearchConfigFromStore(id: string): void {
  const store = loadSearchConfigsStore();
  let changed = false;
  for (const k of Object.keys(store)) {
    const before = store[k].length;
    store[k] = store[k].filter(c => c.id !== id);
    if (store[k].length !== before) changed = true;
  }
  if (changed) saveSearchConfigsStore(store);
}

ipcMain.handle(IPC.SEARCH_CONFIG_SAVE, async (_, config: SearchConfig) => {
  saveSearchConfig(config);
  return { success: true };
});

ipcMain.handle(IPC.SEARCH_CONFIG_LOAD, async () => {
  const configs = loadSearchConfigsForFile(currentFilePath || '');
  return { success: true, configs };
});

ipcMain.handle(IPC.SEARCH_CONFIG_DELETE, async (_, id: string) => {
  removeSearchConfigFromStore(id);
  return { success: true };
});

ipcMain.handle(IPC.SEARCH_CONFIG_BATCH, async (_, configs: Array<{ id: string; pattern: string; isRegex: boolean; matchCase: boolean; wholeWord: boolean }>) => {
  // getReadHandler so multi-pattern Search Configs run over an active single-session
  // composite too (fans out per member, hits merged into global line space) — otherwise
  // the synthetic composite id isn't in fileHandlerCache and this returns "No file open".
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const results: Record<string, Array<{ lineNumber: number; column: number; length: number; lineText: string; displayIndex?: number }>> = {};

  // Build filter lookup once (shared across all configs)
  const filteredIndices = getFilteredLines();
  let filteredSet: Set<number> | null = null;
  let lineToFilteredIndex: Map<number, number> | null = null;
  if (filteredIndices && filteredIndices.length > 0) {
    filteredSet = new Set(filteredIndices);
    lineToFilteredIndex = new Map<number, number>();
    filteredIndices.forEach((lineNum, idx) => lineToFilteredIndex!.set(lineNum, idx));
  }

  // ONE combined ripgrep pass over the union of all config patterns instead of N
  // concurrent full-file scans. Spawning a rg process per config looks parallel but a
  // single rg already saturates disk + cores, so N of them just contend and re-read the
  // file N times. searchMulti unions the patterns (multiple `-e` branches), reads the
  // file once, and attributes each matching line back to the individual configs — a
  // roughly N× win on big files. It streams per-config running counts for the live chip
  // tickers, and falls back to the per-config path for CR-only files / no ripgrep.
  // Progressive streaming: as ripgrep finds matches, push each config's matched line
  // numbers to the renderer so it can paint the overview/counts live instead of waiting
  // for the whole file. Only line numbers are streamed (the overview needs positions,
  // not text) and capped per config — the authoritative full results (with text) still
  // arrive in the return payload. Filter-hidden lines are dropped to match the final set.
  const STREAM_CAP_PER_CONFIG = 50000;
  const streamedCount: Record<string, number> = {};
  const streamMatches = (deltaByConfig: Record<string, Array<{ lineNumber: number; column: number; length: number; lineText: string }>>) => {
    for (const [configId, matches] of Object.entries(deltaByConfig)) {
      let lines = filteredSet
        ? matches.filter(m => filteredSet!.has(m.lineNumber)).map(m => m.lineNumber)
        : matches.map(m => m.lineNumber);
      const already = streamedCount[configId] || 0;
      if (already >= STREAM_CAP_PER_CONFIG) continue;
      if (already + lines.length > STREAM_CAP_PER_CONFIG) lines = lines.slice(0, STREAM_CAP_PER_CONFIG - already);
      if (lines.length === 0) continue;
      streamedCount[configId] = already + lines.length;
      mainWindow?.webContents.send(IPC.SEARCH_CONFIG_BATCH_CHUNK, { configId, lines });
    }
  };

  let raw: Record<string, Array<{ lineNumber: number; column: number; length: number; lineText: string }>>;
  try {
    raw = await handler.searchMulti(configs, (counts, overallPercent) => {
      const percent = Math.round(overallPercent);
      for (const [configId, matchCount] of Object.entries(counts)) {
        mainWindow?.webContents.send(IPC.SEARCH_CONFIG_BATCH_PROGRESS, { percent, configId, matchCount });
      }
    }, { cancelled: false }, streamMatches);
  } catch (error) {
    console.error('Search config batch error:', error);
    return { success: false, error: String(error) };
  }

  // Keep original lineNumber, add displayIndex when a filter is active
  // (matches the same pattern as the regular SEARCH handler).
  for (const cfg of configs) {
    const matches = raw[cfg.id] || [];
    if (filteredSet && lineToFilteredIndex) {
      results[cfg.id] = matches
        .filter(m => filteredSet!.has(m.lineNumber))
        .map(m => ({
          lineNumber: m.lineNumber,
          column: m.column,
          length: m.length,
          lineText: m.lineText,
          displayIndex: lineToFilteredIndex!.get(m.lineNumber),
        }));
    } else {
      results[cfg.id] = matches.map(m => ({
        lineNumber: m.lineNumber,
        column: m.column,
        length: m.length,
        lineText: m.lineText,
      }));
    }
    mainWindow?.webContents.send(IPC.SEARCH_CONFIG_BATCH_PROGRESS, { percent: 100, configId: cfg.id, matchCount: results[cfg.id].length });
  }

  return { success: true, results };
});

ipcMain.handle(IPC.SEARCH_CONFIG_EXPORT, async (_, configId: string, lines: string[]) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };

  try {
    const baseName = path.basename(currentFilePath, path.extname(currentFilePath));
    const date = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const exportName = `${baseName}_search_${configId.substring(0, 8)}_${date}.txt`;
    const exportPath = path.join(path.dirname(currentFilePath), exportName);
    fs.writeFileSync(exportPath, lines.join('\n'), 'utf-8');
    return { success: true, filePath: exportPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SEARCH_CONFIG_EXPORT_ALL, async (_, content: string) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };

  try {
    const baseName = path.basename(currentFilePath, path.extname(currentFilePath));
    const date = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const exportName = `${baseName}_multi-search_${date}.txt`;
    const exportPath = path.join(path.dirname(currentFilePath), exportName);
    fs.writeFileSync(exportPath, content, 'utf-8');
    return { success: true, filePath: exportPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Save a rendered PNG (base64, no data-URL prefix) next to the current log file.
ipcMain.handle(IPC.SEARCH_CONFIG_EXPORT_IMAGE, async (_, base64Png: string, label?: string) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };

  try {
    const baseName = path.basename(currentFilePath, path.extname(currentFilePath));
    const date = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const suffix = (label || 'timeline').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'timeline';
    const exportName = `${baseName}_${suffix}_${date}.png`;
    const exportPath = path.join(path.dirname(currentFilePath), exportName);
    fs.writeFileSync(exportPath, Buffer.from(base64Png, 'base64'));
    return { success: true, filePath: exportPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Pattern Properties (reusable named regex → tracked value, for Trends) ===

const getPatternPropertiesPath = () => path.join(getConfigDir(), 'pattern-properties.json');

function loadPatternPropertiesStore(): PatternProperty[] {
  try {
    ensureConfigDir();
    const p = getPatternPropertiesPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    console.error('Failed to load pattern properties:', error);
  }
  return [];
}

function savePatternPropertiesStore(props: PatternProperty[]): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(getPatternPropertiesPath(), JSON.stringify(props, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save pattern properties:', error);
  }
}

ipcMain.handle(IPC.PATTERN_PROP_LIST, async () => {
  return { success: true, properties: loadPatternPropertiesStore() };
});

ipcMain.handle(IPC.PATTERN_PROP_SAVE, async (_, prop: PatternProperty) => {
  if (!prop || !prop.id || !prop.name || !prop.pattern) {
    return { success: false, error: 'Invalid pattern property' };
  }
  // Validate the regex compiles before persisting.
  try {
    new RegExp(prop.pattern, prop.patternFlags || '');
  } catch (e) {
    return { success: false, error: `Invalid regex: ${String(e)}` };
  }
  const props = loadPatternPropertiesStore();
  const idx = props.findIndex(p => p.id === prop.id);
  if (idx >= 0) props[idx] = prop; else props.push(prop);
  savePatternPropertiesStore(props);
  return { success: true, properties: props };
});

ipcMain.handle(IPC.PATTERN_PROP_DELETE, async (_, id: string) => {
  const props = loadPatternPropertiesStore().filter(p => p.id !== id);
  savePatternPropertiesStore(props);
  return { success: true, properties: props };
});

// === Pattern Library (reusable named search/regex patterns, global store) ===

const getPatternLibraryPath = () => path.join(getConfigDir(), 'patterns.json');

function loadPatternLibraryStore(): SavedPattern[] {
  try {
    ensureConfigDir();
    const p = getPatternLibraryPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    console.error('Failed to load pattern library:', error);
  }
  return [];
}

function savePatternLibraryStore(patterns: SavedPattern[]): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(getPatternLibraryPath(), JSON.stringify(patterns, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save pattern library:', error);
  }
}

ipcMain.handle(IPC.PATTERN_LIB_LIST, async () => {
  return { success: true, patterns: loadPatternLibraryStore() };
});

ipcMain.handle(IPC.PATTERN_LIB_SAVE, async (_, pattern: SavedPattern) => {
  if (!pattern || !pattern.id || !pattern.label || !pattern.regex) {
    return { success: false, error: 'Invalid pattern' };
  }
  // Only validate compilation when it's meant to be a regex — a literal pattern
  // is allowed to contain characters that wouldn't parse as a regex.
  if (pattern.isRegex) {
    try {
      new RegExp(pattern.regex, pattern.matchCase ? '' : 'i');
    } catch (e) {
      return { success: false, error: `Invalid regex: ${String(e)}` };
    }
  }
  const patterns = loadPatternLibraryStore();
  const idx = patterns.findIndex(p => p.id === pattern.id);
  if (idx >= 0) patterns[idx] = pattern; else patterns.push(pattern);
  savePatternLibraryStore(patterns);
  return { success: true, patterns };
});

ipcMain.handle(IPC.PATTERN_LIB_DELETE, async (_, id: string) => {
  const patterns = loadPatternLibraryStore().filter(p => p.id !== id);
  savePatternLibraryStore(patterns);
  return { success: true, patterns };
});

// === Pattern Columns (paint / grok / regex → named columns) ===
// Compile a pattern spec to a named-capture regex and preview the extracted
// columns over the current file's first lines; plus a small global store so
// authored patterns are reusable across sessions (mirrors pattern-properties).

interface ColumnPatternSaved {
  id: string;
  name: string;
  spec: ColumnPatternSpec; // how it was authored, so it can reload into the editor
  regex: string;
  flags: string;
  fields: string[];
}

const getColumnPatternsPath = () => path.join(getConfigDir(), 'column-patterns.json');

function loadColumnPatternsStore(): ColumnPatternSaved[] {
  try {
    ensureConfigDir();
    const p = getColumnPatternsPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    console.error('Failed to load column patterns:', error);
  }
  return [];
}

function saveColumnPatternsStore(items: ColumnPatternSaved[]): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(getColumnPatternsPath(), JSON.stringify(items, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save column patterns:', error);
  }
}

ipcMain.handle('column-pattern-preview', async (_, spec: ColumnPatternSpec, opts?: { sampleLines?: number; scan?: boolean }) => {
  try {
    const N = Math.max(1, Math.min(500, opts?.sampleLines ?? 200));
    // scan=false is the LIVE painting path: preview the single sample line only — no file
    // read, no refine — so interactive painting never touches the file or stalls the main
    // thread (which also serves the viewer). scan=true (default) is the deliberate "Test
    // over file" / commit step where match-rate + refine-from-data actually belong.
    const doScan = opts?.scan !== false;
    const handler = doScan ? getFileHandler() : null;

    // The heavy validate + refine over the file head goes OFF the main thread (the same
    // thread that serves the viewer) into the trend worker — with a watchdog so a
    // catastrophic-backtracking column regex can never freeze the UI. Only the cheap
    // single-line live-painting path (and the rare segmented-file case, which holds no
    // whole-file index to hand a worker) run inline via the shared core.
    if (doScan && handler && canColumnPreviewOffThread(handler)) {
      try {
        const result = await runColumnPreviewJob(handler, spec, { sampleLines: N });
        return { success: true, ...result };
      } catch (e) {
        return { success: false, error: String(e instanceof Error ? e.message : e) };
      }
    }

    // Gather the candidate lines once (the user's sample first, then the file head) and
    // run the SAME pure core the worker uses.
    const sampleLines: string[] = [];
    if (spec.sample && spec.sample.trim()) sampleLines.push(spec.sample);
    if (handler) {
      const scanTo = Math.min(handler.getTotalLines(), N * 4);
      for (const line of handler.getLines(0, scanTo)) {
        if (line.text.trim()) sampleLines.push(line.text);
      }
    }
    const result = computeColumnPreview(sampleLines, spec, { maxRows: N, doScan });
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: String(e instanceof Error ? e.message : e) };
  }
});

ipcMain.handle('column-pattern-list', async () => {
  return { success: true, patterns: loadColumnPatternsStore() };
});

ipcMain.handle('column-pattern-save', async (_, pattern: ColumnPatternSaved) => {
  if (!pattern || !pattern.id || !pattern.name || !pattern.regex) {
    return { success: false, error: 'Invalid column pattern' };
  }
  try {
    new RegExp(pattern.regex, (pattern.flags || '').replace(/[gy]/g, ''));
  } catch (e) {
    return { success: false, error: `Invalid regex: ${String(e)}` };
  }
  const items = loadColumnPatternsStore();
  const idx = items.findIndex(p => p.id === pattern.id);
  if (idx >= 0) items[idx] = pattern; else items.push(pattern);
  saveColumnPatternsStore(items);
  return { success: true, patterns: items };
});

ipcMain.handle('column-pattern-delete', async (_, id: string) => {
  const items = loadColumnPatternsStore().filter(p => p.id !== id);
  saveColumnPatternsStore(items);
  return { success: true, patterns: items };
});

// ── Column Layouts (delimiter + pattern) ──────────────────────────────────────
// Store lives in ./columnLayoutsStore, SHARED with the AI /api path (parity — one impl).
ipcMain.handle('column-layout-list', async () => {
  return { success: true, layouts: loadColumnLayouts() };
});

ipcMain.handle('column-layout-save', async (_, layout: ColumnLayoutSaved) => {
  if (!layout || !layout.id || !layout.name || !Array.isArray(layout.columns)) {
    return { success: false, error: 'Invalid column layout' };
  }
  return { success: true, layouts: upsertColumnLayout(layout) };
});

ipcMain.handle('column-layout-delete', async (_, id: string) => {
  return { success: true, layouts: deleteColumnLayout(id) };
});

// === Search Config Sessions ===

const getSearchConfigSessionsPath = () => path.join(getConfigDir(), 'search-config-sessions.json');

function loadGlobalSearchConfigSessions(): SearchConfigSession[] {
  try {
    const filePath = getSearchConfigSessionsPath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveGlobalSearchConfigSessions(sessions: SearchConfigSession[]): void {
  ensureConfigDir();
  fs.writeFileSync(getSearchConfigSessionsPath(), JSON.stringify(sessions, null, 2), 'utf-8');
}

function loadLocalSearchConfigSessions(filePath: string): SearchConfigSession[] {
  try {
    const data = loadLocalFileData(filePath);
    return (data as any).searchConfigSessions || [];
  } catch { /* ignore */ }
  return [];
}

function saveLocalSearchConfigSessions(filePath: string, sessions: SearchConfigSession[]): void {
  const data = loadLocalFileData(filePath);
  (data as any).searchConfigSessions = sessions;
  saveLocalFileData(filePath, data);
}

ipcMain.handle(IPC.SEARCH_CONFIG_SESSION_LIST, async () => {
  const globalSessions = loadGlobalSearchConfigSessions().map(s => ({ ...s, isGlobal: true }));
  const localSessions = currentFilePath
    ? loadLocalSearchConfigSessions(currentFilePath).map(s => ({ ...s, isGlobal: false }))
    : [];
  return { success: true, sessions: [...globalSessions, ...localSessions] };
});

ipcMain.handle(IPC.SEARCH_CONFIG_SESSION_SAVE, async (_, session: SearchConfigSession) => {
  if (session.isGlobal) {
    const sessions = loadGlobalSearchConfigSessions();
    const existingIdx = sessions.findIndex(s => s.id === session.id);
    if (existingIdx >= 0) {
      sessions[existingIdx] = session;
    } else {
      sessions.push(session);
    }
    saveGlobalSearchConfigSessions(sessions);
  } else {
    if (!currentFilePath) return { success: false, error: 'No file open' };
    const sessions = loadLocalSearchConfigSessions(currentFilePath);
    const existingIdx = sessions.findIndex(s => s.id === session.id);
    if (existingIdx >= 0) {
      sessions[existingIdx] = session;
    } else {
      sessions.push(session);
    }
    saveLocalSearchConfigSessions(currentFilePath, sessions);
  }
  return { success: true };
});

ipcMain.handle(IPC.SEARCH_CONFIG_SESSION_DELETE, async (_, sessionId: string, isGlobal: boolean) => {
  if (isGlobal) {
    const sessions = loadGlobalSearchConfigSessions().filter(s => s.id !== sessionId);
    saveGlobalSearchConfigSessions(sessions);
  } else {
    if (!currentFilePath) return { success: false, error: 'No file open' };
    const sessions = loadLocalSearchConfigSessions(currentFilePath).filter(s => s.id !== sessionId);
    saveLocalSearchConfigSessions(currentFilePath, sessions);
  }
  return { success: true };
});

// === Single sessions (saved composite file-sets) ===
// A "single session" is an ordered list of files concatenated into one continuous
// read-only view. We auto-save each newly built composite so the same file combination
// can be re-run in a later session (surfaced in the Saved panel + logan_entities). Scope
// mirrors search sessions: global (reusable everywhere) or file-local (.logan/ sidecar).
const getSingleSessionsPath = () => path.join(getConfigDir(), 'single-sessions.json');

function loadGlobalSingleSessions(): SingleSessionEntry[] {
  try {
    const filePath = getSingleSessionsPath();
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { /* ignore */ }
  return [];
}

function saveGlobalSingleSessions(sessions: SingleSessionEntry[]): void {
  ensureConfigDir();
  fs.writeFileSync(getSingleSessionsPath(), JSON.stringify(sessions, null, 2), 'utf-8');
}

function loadLocalSingleSessions(filePath: string): SingleSessionEntry[] {
  try {
    const data = loadLocalFileData(filePath);
    return (data as any).singleSessions || [];
  } catch { /* ignore */ }
  return [];
}

function saveLocalSingleSessions(filePath: string, sessions: SingleSessionEntry[]): void {
  const data = loadLocalFileData(filePath);
  (data as any).singleSessions = sessions;
  saveLocalFileData(filePath, data);
}

// Derive a readable default name from the member basenames, e.g. "a.log + b.log (+2 more)".
function defaultSingleSessionName(files: string[]): string {
  const names = files.map(f => path.basename(f));
  if (names.length <= 2) return names.join(' + ');
  return `${names[0]} + ${names[1]} (+${names.length - 2} more)`;
}

// Auto-persist a just-built composite as a global single-session entity, deduped by the
// exact ordered file-set (re-running the same combination updates in place, never piles up).
function autoSaveSingleSession(files: string[], label?: string): void {
  try {
    if (!Array.isArray(files) || files.length < 2) return;
    const key = JSON.stringify(files);
    const sessions = loadGlobalSingleSessions();
    const existing = sessions.find(s => JSON.stringify(s.files) === key);
    if (existing) {
      existing.createdAt = Date.now();
      if (label) existing.name = label;
    } else {
      sessions.push({
        id: `sss-${Date.now()}`,
        name: label || defaultSingleSessionName(files),
        files: files.slice(),
        isGlobal: true,
        createdAt: Date.now(),
      });
    }
    // Hygiene cap: this store auto-grows (one entry per distinct file-set), so keep only
    // the most-recent 100 so ad-hoc sessions can't pile up unbounded.
    const capped = sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 100);
    saveGlobalSingleSessions(capped);
  } catch (e) {
    console.error('autoSaveSingleSession failed:', e);
  }
}

// List saved single sessions: global ones + any file-local ones for the open file.
ipcMain.handle(IPC.SINGLE_SESSION_LIST, async () => {
  const globalSessions = loadGlobalSingleSessions().map(s => ({ ...s, isGlobal: true }));
  const localSessions = currentFilePath
    ? loadLocalSingleSessions(currentFilePath).map(s => ({ ...s, isGlobal: false }))
    : [];
  return { success: true, sessions: [...globalSessions, ...localSessions] };
});

ipcMain.handle(IPC.SINGLE_SESSION_DELETE, async (_, sessionId: string, isGlobal: boolean) => {
  if (isGlobal) {
    saveGlobalSingleSessions(loadGlobalSingleSessions().filter(s => s.id !== sessionId));
  } else {
    if (!currentFilePath) return { success: false, error: 'No file open' };
    saveLocalSingleSessions(currentFilePath, loadLocalSingleSessions(currentFilePath).filter(s => s.id !== sessionId));
  }
  return { success: true };
});

ipcMain.handle(IPC.SINGLE_SESSION_RENAME, async (_, sessionId: string, isGlobal: boolean, name: string) => {
  const apply = (arr: SingleSessionEntry[]) => { const s = arr.find(x => x.id === sessionId); if (s) s.name = name; return arr; };
  if (isGlobal) {
    saveGlobalSingleSessions(apply(loadGlobalSingleSessions()));
  } else {
    if (!currentFilePath) return { success: false, error: 'No file open' };
    saveLocalSingleSessions(currentFilePath, apply(loadLocalSingleSessions(currentFilePath)));
  }
  return { success: true };
});

// === Context Search ===

const getContextDefinitionsPath = () => path.join(getConfigDir(), 'context-definitions.json');
const GLOBAL_CONTEXT_KEY = '_global';

interface ContextDefinitionsStore {
  [key: string]: ContextDefinition[];
}

function loadContextDefinitionsStore(): ContextDefinitionsStore {
  try {
    ensureConfigDir();
    const configPath = getContextDefinitionsPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load context definitions:', error);
  }
  return {};
}

function saveContextDefinitionsStore(store: ContextDefinitionsStore): void {
  try {
    ensureConfigDir();
    const configPath = getContextDefinitionsPath();
    const cleanStore: ContextDefinitionsStore = {};
    for (const [key, value] of Object.entries(store)) {
      if (value.length > 0) {
        cleanStore[key] = value;
      }
    }
    fs.writeFileSync(configPath, JSON.stringify(cleanStore, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save context definitions:', error);
  }
}

function loadContextDefinitionsForFile(filePath: string): ContextDefinition[] {
  const store = loadContextDefinitionsStore();
  const defs: ContextDefinition[] = [];
  const globalDefs = store[GLOBAL_CONTEXT_KEY] || [];
  for (const d of globalDefs) defs.push({ ...d, isGlobal: true });
  if (filePath) {
    const fileDefs = store[filePath] || [];
    for (const d of fileDefs) defs.push({ ...d, isGlobal: false });
  }
  return defs;
}

function saveContextDefinition(def: ContextDefinition): void {
  const store = loadContextDefinitionsStore();
  // Remove from all keys first
  for (const k of Object.keys(store)) {
    store[k] = store[k].filter(d => d.id !== def.id);
  }
  const key = def.isGlobal ? GLOBAL_CONTEXT_KEY : (currentFilePath || GLOBAL_CONTEXT_KEY);
  if (!store[key]) store[key] = [];
  store[key].push(def);
  saveContextDefinitionsStore(store);
}

function removeContextDefinition(id: string): void {
  const store = loadContextDefinitionsStore();
  let changed = false;
  for (const k of Object.keys(store)) {
    const before = store[k].length;
    store[k] = store[k].filter(d => d.id !== id);
    if (store[k].length !== before) changed = true;
  }
  if (changed) saveContextDefinitionsStore(store);
}

ipcMain.handle(IPC.CONTEXT_DEFINITIONS_LOAD, async () => {
  const definitions = loadContextDefinitionsForFile(currentFilePath || '');
  return { success: true, definitions };
});

ipcMain.handle(IPC.CONTEXT_DEFINITIONS_SAVE, async (_, def: ContextDefinition) => {
  saveContextDefinition(def);
  return { success: true };
});

ipcMain.handle('context-definition-delete', async (_, id: string) => {
  removeContextDefinition(id);
  return { success: true };
});

ipcMain.handle(IPC.CONTEXT_SEARCH, async (_, contextIds: string[]) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const allDefs = loadContextDefinitionsForFile(currentFilePath || '');
  const enabledDefs = allDefs.filter(d => d.enabled && (contextIds.length === 0 || contextIds.includes(d.id)));

  if (enabledDefs.length === 0) return { success: true, results: [] };

  const filteredIndices = getFilteredLines();
  const fileInfo = handler.getFileInfo();
  const totalLines = fileInfo ? fileInfo.totalLines : 0;
  const results: Array<{ contextId: string; groups: ContextMatchGroup[] }> = [];

  for (let ci = 0; ci < enabledDefs.length; ci++) {
    const ctx = enabledDefs[ci];
    const mustPatterns = ctx.patterns.filter(p => p.role === 'must');
    const cluePatterns = ctx.patterns.filter(p => p.role === 'clue');

    if (mustPatterns.length === 0) continue;

    const groups: ContextMatchGroup[] = [];

    // Find all must-pattern matches
    for (const mustPat of mustPatterns) {
      const searchOpts: SearchOptions = {
        pattern: mustPat.pattern,
        isRegex: mustPat.isRegex,
        isWildcard: false,
        matchCase: mustPat.matchCase,
        wholeWord: false,
      };
      if (filteredIndices) searchOpts.filteredLineIndices = filteredIndices;

      let mustMatches: Array<{ lineNumber: number; lineText: string }>;
      try {
        mustMatches = await handler.search(searchOpts, () => {}, { cancelled: false });
      } catch { continue; }

      // For each must match, search for clues in proximity
      for (const mm of mustMatches) {
        const mustLineNum = mm.lineNumber;
        const distance = ctx.defaultDistance || 10;
        const windowStart = Math.max(0, mustLineNum - distance);
        const windowEnd = Math.min(totalLines - 1, mustLineNum + distance);
        const windowSize = windowEnd - windowStart + 1;

        // Read window lines
        let windowLines: Array<{ lineNumber: number; text: string }>;
        try {
          const res = await handler.getLines(windowStart, windowSize);
          windowLines = res.map((l: any) => ({ lineNumber: l.lineNumber, text: l.text }));
        } catch { continue; }

        const clues: ContextMatchGroup['clues'] = [];

        for (const cluePat of cluePatterns) {
          const clueDistance = cluePat.distance ?? distance;
          let regex: RegExp;
          try {
            regex = cluePat.isRegex
              ? new RegExp(cluePat.pattern, cluePat.matchCase ? '' : 'i')
              : new RegExp(cluePat.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cluePat.matchCase ? '' : 'i');
          } catch { continue; }

          for (const wl of windowLines) {
            if (wl.lineNumber === mustLineNum) continue;
            const lineDist = Math.abs(wl.lineNumber - mustLineNum);
            if (lineDist > clueDistance) continue;
            if (regex.test(wl.text)) {
              clues.push({
                lineNumber: wl.lineNumber,
                text: wl.text,
                patternId: cluePat.id,
                distance: lineDist,
              });
            }
          }
        }

        // Fulfillment: distinct clue patterns satisfied vs. defined.
        const matchedPatternIds = new Set(clues.map(c => c.patternId));
        const missingPatternIds = cluePatterns
          .map(p => p.id)
          .filter(id => !matchedPatternIds.has(id));
        const complete = missingPatternIds.length === 0; // true for must-only contexts

        // Emit EVERY must-anchor — including partially/unfulfilled ones — so the
        // renderer can highlight incomplete matches. It filters/styles by `complete`.
        groups.push({
          contextId: ctx.id,
          mustLine: mustLineNum,
          mustText: mm.lineText,
          mustPatternId: mustPat.id,
          clues,
          score: cluePatterns.length === 0 ? 1 : clues.length,
          matchedPatternCount: matchedPatternIds.size,
          totalCluePatterns: cluePatterns.length,
          missingPatternIds,
          complete,
        });
      }
    }

    // Sort by line number
    groups.sort((a, b) => a.mustLine - b.mustLine);
    results.push({ contextId: ctx.id, groups });

    // Report progress
    const percent = Math.round(((ci + 1) / enabledDefs.length) * 100);
    mainWindow?.webContents.send(IPC.CONTEXT_SEARCH_PROGRESS, { percent, contextId: ctx.id });
  }

  return { success: true, results };
});

// === Traceback ===

function extractComponent(text: string): string | null {
  const sample = text.length > 120 ? text.substring(0, 120) : text;
  const match = sample.match(/\[([A-Za-z][A-Za-z0-9_.\-/]{1,40})\]/);
  return match ? match[1] : null;
}

ipcMain.handle(IPC.TRACEBACK, async (_, request: { targetLine: number; windowLines?: number; windowSeconds?: number; maxResults?: number }) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const { targetLine, windowLines = 200, windowSeconds = 60, maxResults = 50 } = request;

  // Read target line
  const [targetLineData] = handler.getLines(targetLine, 1);
  if (!targetLineData) return { success: false, error: 'Target line not found' };

  const targetText = targetLineData.text;
  const targetComponent = extractComponent(targetText);
  const targetTimestamp = parseTimestampFast(targetText);

  // Determine scan window
  let windowStart = Math.max(0, targetLine - windowLines);

  // Read all lines in window
  const count = targetLine - windowStart;
  if (count <= 0) return { success: true, targetLine, targetText, targetComponent, windowStart, lines: [], summary: { total: 0, errors: 0, warnings: 0, stateChanges: 0, related: 0, context: 0 } };

  const windowLineData = handler.getLines(windowStart, count);

  // Narrow by time window if timestamps available
  if (targetTimestamp && windowSeconds < Infinity) {
    const cutoff = targetTimestamp.date.getTime() - windowSeconds * 1000;
    const firstValid = windowLineData.findIndex(l => {
      const ts = parseTimestampFast(l.text);
      return ts && ts.date.getTime() >= cutoff;
    });
    if (firstValid > 0) {
      windowLineData.splice(0, firstValid);
      windowStart = windowLineData.length > 0 ? windowLineData[0].lineNumber : targetLine;
    }
  }

  // Extract significant words from target line (3+ chars, alphanumeric)
  const targetWords = new Set(
    targetText.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(w => !['the', 'and', 'for', 'not', 'was', 'are', 'this', 'that', 'with', 'from', 'have', 'has'].includes(w)) || []
  );

  const windowSize = windowLineData.length;

  // Track level escalation per component
  const componentLastLevel = new Map<string, string>();
  const escalationLines = new Set<number>();

  // First pass: detect escalations
  for (const line of windowLineData) {
    const comp = extractComponent(line.text);
    const level = line.level;
    if (comp && level) {
      const prev = componentLastLevel.get(comp);
      if ((prev === 'info' && (level === 'warning' || level === 'error')) ||
          (prev === 'warning' && level === 'error')) {
        escalationLines.add(line.lineNumber);
      }
      componentLastLevel.set(comp, level);
    }
  }

  // Score each line
  const scored: Array<{
    lineNumber: number;
    text: string;
    score: number;
    component: string | null;
    level?: string;
  }> = [];

  const crashRegex = /\b(fatal|crash|exception|panic|oom|segfault|abort|sigsegv|sigabrt|unhandled|stack\s*trace)\b/i;

  for (let i = 0; i < windowLineData.length; i++) {
    const line = windowLineData[i];
    let score = 0;

    const lineComponent = extractComponent(line.text);

    // Same component: +30
    if (targetComponent && lineComponent === targetComponent) {
      score += 30;
    }

    // Level severity: +25
    if (line.level === 'error') score += 25;
    else if (line.level === 'warning') score += 15;
    else if (line.level === 'info') score += 5;

    // Level escalation: +15
    if (escalationLines.has(line.lineNumber)) {
      score += 15;
    }

    // Crash keyword: +20
    if (crashRegex.test(line.text)) {
      score += 20;
    }

    // Temporal proximity: +10
    const distance = windowSize - i - 1; // distance from target (end of window)
    score += Math.round(10 * (1 - distance / Math.max(windowSize, 1)));

    // Keyword overlap: +10
    if (targetWords.size > 0) {
      const lineWords = line.text.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
      let overlap = 0;
      for (const w of lineWords) {
        if (targetWords.has(w)) { overlap++; break; }
      }
      if (overlap > 0) {
        const overlapRatio = Math.min(1, lineWords.filter(w => targetWords.has(w)).length / targetWords.size);
        score += Math.round(10 * overlapRatio);
      }
    }

    if (score > 5) {
      scored.push({
        lineNumber: line.lineNumber,
        text: line.text,
        score,
        component: lineComponent,
        level: line.level,
      });
    }
  }

  // Take top maxResults by score
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxResults);

  // Re-sort chronologically
  top.sort((a, b) => a.lineNumber - b.lineNumber);

  // Assign categories
  const results = top.map(line => {
    let category: 'error' | 'warning' | 'state-change' | 'related' | 'context';
    if (line.level === 'error' || crashRegex.test(line.text)) {
      category = 'error';
    } else if (line.level === 'warning') {
      category = 'warning';
    } else if (escalationLines.has(line.lineNumber)) {
      category = 'state-change';
    } else if (targetComponent && line.component === targetComponent) {
      category = 'related';
    } else {
      category = 'context';
    }
    return { ...line, category };
  });

  // Build summary
  const summary = {
    total: results.length,
    errors: results.filter(r => r.category === 'error').length,
    warnings: results.filter(r => r.category === 'warning').length,
    stateChanges: results.filter(r => r.category === 'state-change').length,
    related: results.filter(r => r.category === 'related').length,
    context: results.filter(r => r.category === 'context').length,
  };

  return { success: true, targetLine, targetText, targetComponent, windowStart, lines: results, summary };
});

// === Utility ===

ipcMain.handle('get-file-info', async () => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };
  return { success: true, info: handler.getFileInfo() };
});

// Check if ripgrep is available
ipcMain.handle('check-search-engine', async () => {
  return new Promise((resolve) => {
    const proc = spawn(getRipgrepPath(), ['--version']);
    let version = '';

    proc.stdout.on('data', (data: Buffer) => {
      version += data.toString();
    });

    proc.on('error', () => {
      resolve({ engine: 'stream', version: null });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const match = version.match(/ripgrep\s+([\d.]+)/);
        resolve({ engine: 'ripgrep', version: match ? match[1] : 'unknown' });
      } else {
        resolve({ engine: 'stream', version: null });
      }
    });
  });
});

// Open external URL in default browser
ipcMain.handle('open-external-url', async (_, url: string) => {
  // Only allow https URLs for security
  if (url.startsWith('https://')) {
    await shell.openExternal(url);
  }
});

// Show file in OS file manager
ipcMain.handle('show-item-in-folder', async (_, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// Read entire file content (for Copy All)
ipcMain.handle('read-file-content', async (_, filePath: string) => {
  try {
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > 50) {
      return { success: false, error: 'File too large to copy (>50MB)' };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, sizeMB };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Streams a (possibly huge) line range to an already-open file descriptor in bounded
// batches, so we never build one giant string — V8 caps strings at ~512MB and a large
// "save range" would otherwise throw `RangeError: Invalid string length`. When a filter
// is active, `filteredRange` holds the visible line numbers to emit; otherwise the
// contiguous [startLine..endLine] range is read via getLines. Each line is written
// followed by '\n'. Returns the number of lines written.
const SAVE_RANGE_READ_BATCH = 20000;
const SAVE_RANGE_FLUSH_CHARS = 8 * 1024 * 1024; // flush the buffer well before any string-size limits
function streamLineBodiesToFd(
  fd: number,
  handler: NonNullable<ReturnType<typeof getFileHandler>>,
  startLine: number,
  endLine: number,
  filteredRange: number[] | null,
  columnConfig?: ColumnConfig,
): number {
  let count = 0;
  let buf = '';
  const flush = () => { if (buf) { fs.writeSync(fd, buf); buf = ''; } };
  const emit = (text: string) => {
    buf += text + '\n';
    count++;
    if (buf.length >= SAVE_RANGE_FLUSH_CHARS) flush();
  };
  if (filteredRange) {
    for (let i = 0; i < filteredRange.length; i++) {
      const [line] = handler.getLines(filteredRange[i], 1);
      if (line) emit(filterLineToVisibleColumns(line.text, columnConfig));
      if ((i & 1023) === 1023) flush();
    }
  } else {
    const total = endLine - startLine + 1;
    for (let off = 0; off < total; off += SAVE_RANGE_READ_BATCH) {
      const batch = handler.getLines(startLine + off, Math.min(SAVE_RANGE_READ_BATCH, total - off));
      for (const line of batch) emit(filterLineToVisibleColumns(line.text, columnConfig));
      flush();
    }
  }
  flush();
  return count;
}

// === Save Selected Lines ===

ipcMain.handle('save-selected-lines', async (_, startLine: number, endLine: number, columnConfig?: ColumnConfig) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    // Plan which source line numbers to emit, respecting an active filter. The lines are
    // streamed to disk in bounded batches (streamLineBodiesToFd) rather than materialized
    // into one big array/string, so a huge range can't overflow V8's ~512MB string cap.
    const filteredIndices = getFilteredLines();
    const filteredRange: number[] | null = filteredIndices
      ? filteredIndices.filter(ln => ln >= startLine && ln <= endLine)
      : null;
    const plannedCount = filteredRange ? filteredRange.length : Math.max(0, endLine - startLine + 1);

    if (plannedCount === 0) {
      return { success: false, error: 'No lines to save' };
    }

    // Get current file's directory
    const fileInfo = handler.getFileInfo();
    if (!fileInfo) return { success: false, error: 'No file info' };

    const currentDir = path.dirname(fileInfo.path);
    const selectedDir = path.join(currentDir, 'selected');

    // Create 'selected' folder if it doesn't exist
    if (!fs.existsSync(selectedDir)) {
      fs.mkdirSync(selectedDir, { recursive: true });
    }

    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}.log`;
    const filePath = path.join(selectedDir, filename);

    // Stream the range to disk in bounded batches (huge ranges would overflow the ~512MB
    // string cap if joined into one string), respecting column visibility.
    const fd = fs.openSync(filePath, 'w');
    let lineCount: number;
    try {
      lineCount = streamLineBodiesToFd(fd, handler, startLine, endLine, filteredRange, columnConfig);
    } finally {
      fs.closeSync(fd);
    }

    if (currentFilePath) logActivity(currentFilePath, 'lines_saved', { startLine, endLine });

    return { success: true, filePath, lineCount };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Stream the FULL active-filter subset to an fd, one line per matched source line,
// each optionally prefixed with its 1-based ORIGINAL line number (tab-separated)
// so an extracted line maps back to the source. Bounded batches (like the
// save-range writer) so a huge subset can't overflow V8's ~512MB string cap.
function streamFilteredExtractToFd(
  fd: number,
  handler: NonNullable<ReturnType<typeof getFileHandler>>,
  filteredLineNumbers: number[],
  columnConfig: ColumnConfig | undefined,
  includeLineNumbers: boolean,
): number {
  let count = 0;
  let buf = '';
  const flush = () => { if (buf) { fs.writeSync(fd, buf); buf = ''; } };
  for (let i = 0; i < filteredLineNumbers.length; i++) {
    const ln = filteredLineNumbers[i];
    const [line] = handler.getLines(ln, 1);
    if (line) {
      const body = filterLineToVisibleColumns(line.text, columnConfig);
      buf += extractBodyLine(ln, body, includeLineNumbers) + '\n';
      count++;
      if (buf.length >= SAVE_RANGE_FLUSH_CHARS) flush();
    }
    if ((i & 1023) === 1023) flush();
  }
  flush();
  return count;
}

// "Extract filter → file": materialize the current filter's matching lines into a
// NEW small file and hand back its path (the renderer opens it). This sidesteps
// virtualizing a filtered view over a huge file — the extract opens on the normal
// fast path with a small line count (no scroll-height limits, no heavy re-render).
// Shared impl behind BOTH the human "⬇ Extract to file" (EXTRACT_FILTERED_TO_FILE
// IPC) and the AI /api/extract endpoint (via ApiContext.extractFilteredToFile) —
// same instrument, two operators. Materializes the active-filter subset to a NEW
// small file and returns its path.
async function runFilteredExtract(opts?: { includeLineNumbers?: boolean; columnConfig?: ColumnConfig }): Promise<{ success: boolean; filePath?: string; lineCount?: number; error?: string }> {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };
  const filtered = getFilteredLines();
  if (!filtered || filtered.length === 0) {
    return { success: false, error: 'No active filter — apply a filter first, then Extract.' };
  }
  try {
    const fileInfo = handler.getFileInfo();
    if (!fileInfo) return { success: false, error: 'No file info' };
    const dir = path.dirname(fileInfo.path);
    const base = path.basename(fileInfo.path).replace(/\.[^.]+$/, '');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dir, `${base}.filtered_${stamp}.log`);
    const includeLineNumbers = opts?.includeLineNumbers !== false; // default true
    const total = handler.getTotalLines();

    const fd = fs.openSync(filePath, 'w');
    let lineCount: number;
    try {
      // Self-describing header (a plain comment line; not a #SPLIT header).
      fs.writeSync(fd, extractHeaderLine(filtered.length, total, path.basename(fileInfo.path), includeLineNumbers) + '\n');
      lineCount = streamFilteredExtractToFd(fd, handler, filtered, opts?.columnConfig, includeLineNumbers);
    } finally {
      fs.closeSync(fd);
    }
    if (currentFilePath) logActivity(currentFilePath, 'filter_extracted', { lines: lineCount });
    return { success: true, filePath, lineCount };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

ipcMain.handle(IPC.EXTRACT_FILTERED_TO_FILE, async (_, opts?: { includeLineNumbers?: boolean; columnConfig?: ColumnConfig }) => {
  return runFilteredExtract(opts);
});

// === Agent Memory ===
// Per-file persistent memory for AI agents. Stored alongside the log file so
// agents can resume analysis across sessions.

interface AgentMemoryData {
  content: string;
  agentName: string;
  updatedAt: number;
}

function agentMemoryPath(filePath: string | null): string | null {
  if (!filePath) return null;
  return path.join(getLocalLoganDir(filePath), path.basename(filePath) + '.agent-memory.json');
}

function getAgentMemory(filePath: string | null): AgentMemoryData | null {
  const p = agentMemoryPath(filePath);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function saveAgentMemory(filePath: string | null, content: string, agentName?: string): boolean {
  if (!filePath) return false;
  if (!ensureLocalLoganDir(filePath)) return false;
  const p = agentMemoryPath(filePath)!;
  const data: AgentMemoryData = {
    content,
    agentName: agentName || 'Agent',
    updatedAt: Date.now(),
  };
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); return true; } catch { return false; }
}

function clearAgentMemory(filePath: string | null): boolean {
  const p = agentMemoryPath(filePath);
  if (!p) return false;
  try { if (fs.existsSync(p)) fs.unlinkSync(p); return true; } catch { return false; }
}

// === Context Manifest (static-env sidecar) ===
// Per-file store of the static environment a log was captured under (build id, firmware,
// device, feature flags, config). Mirrors the agent-memory sidecar pattern; the merge/diff
// semantics live in the pure ./contextManifest module.

function contextManifestPath(filePath: string | null): string | null {
  if (!filePath) return null;
  return path.join(getLocalLoganDir(filePath), path.basename(filePath) + '.context-manifest.json');
}

function getContextManifest(filePath: string | null): ContextManifest | null {
  const p = contextManifestPath(filePath);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function saveContextManifestFile(filePath: string | null, manifest: ContextManifest): boolean {
  if (!filePath) return false;
  if (!ensureLocalLoganDir(filePath)) return false;
  const p = contextManifestPath(filePath)!;
  try { fs.writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf-8'); return true; } catch { return false; }
}

function clearContextManifestFile(filePath: string | null): boolean {
  const p = contextManifestPath(filePath);
  if (!p) return false;
  try { if (fs.existsSync(p)) fs.unlinkSync(p); return true; } catch { return false; }
}

ipcMain.handle('context-manifest-get', () => {
  return getContextManifest(currentFilePath) || null;
});

ipcMain.handle('agent-memory-get', () => {
  const mem = getAgentMemory(currentFilePath);
  return mem || null;
});

ipcMain.handle('agent-memory-save', (_e, content: string, agentName?: string) => {
  const ok = saveAgentMemory(currentFilePath, content, agentName);
  return { success: ok };
});

ipcMain.handle('agent-memory-clear', () => {
  return { success: clearAgentMemory(currentFilePath) };
});

// === Save to Notes ===

// Helper: Read notes file header to get source log path
function getNotesFileSource(notesFilePath: string): string | null {
  try {
    const content = fs.readFileSync(notesFilePath, 'utf-8');
    const lines = content.split('\n').slice(0, 10); // Read first 10 lines
    for (const line of lines) {
      if (line.startsWith('Source: ')) {
        return line.substring(8).trim();
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}

// Find existing notes files for the current log file
ipcMain.handle('find-notes-files', async () => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  const fileInfo = handler.getFileInfo();
  if (!fileInfo) return { success: false, error: 'No file info' };

  const currentDir = path.dirname(fileInfo.path);
  const logFilePath = fileInfo.path;

  try {
    const files = fs.readdirSync(currentDir);
    const notesFiles: Array<{ name: string; path: string; created: string }> = [];

    for (const file of files) {
      if (file.endsWith('.notes.txt')) {
        const fullPath = path.join(currentDir, file);
        const source = getNotesFileSource(fullPath);

        // Check if this notes file belongs to the current log file
        if (source === logFilePath) {
          // Get created date from header
          const content = fs.readFileSync(fullPath, 'utf-8');
          const createdMatch = content.match(/Created: (.+)/);
          notesFiles.push({
            name: file,
            path: fullPath,
            created: createdMatch ? createdMatch[1].trim() : 'Unknown',
          });
        }
      }
    }

    return { success: true, files: notesFiles, logFilePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Save to notes - creates new file or appends to existing
ipcMain.handle('save-to-notes', async (
  _,
  startLine: number,
  endLine: number,
  note?: string,
  targetFilePath?: string, // If provided, append to this file; otherwise create new
  columnConfig?: ColumnConfig
) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    // Plan which source line numbers to emit, respecting an active filter. The lines are
    // streamed to disk in bounded batches (streamLineBodiesToFd) rather than materialized
    // into one big array/string, so a huge range can't overflow V8's ~512MB string cap.
    const filteredIndices = getFilteredLines();
    const filteredRange: number[] | null = filteredIndices
      ? filteredIndices.filter(ln => ln >= startLine && ln <= endLine)
      : null;
    const plannedCount = filteredRange ? filteredRange.length : Math.max(0, endLine - startLine + 1);

    if (plannedCount === 0) {
      return { success: false, error: 'No lines to save' };
    }

    // Get current file info
    const fileInfo = handler.getFileInfo();
    if (!fileInfo) return { success: false, error: 'No file info' };

    const currentDir = path.dirname(fileInfo.path);
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const separator = '='.repeat(80);

    let notesFilePath: string;
    let isNewFile = false;

    if (targetFilePath && fs.existsSync(targetFilePath)) {
      // Append to existing file
      notesFilePath = targetFilePath;
    } else {
      // Create new file with unique name
      const originalFileName = path.basename(fileInfo.path, path.extname(fileInfo.path));
      const dateStr = new Date().toISOString().substring(0, 10).replace(/-/g, '');
      let counter = 1;
      let notesFileName = `${originalFileName}_${dateStr}.notes.txt`;
      notesFilePath = path.join(currentDir, notesFileName);

      // Find unique filename if exists
      while (fs.existsSync(notesFilePath)) {
        counter++;
        notesFileName = `${originalFileName}_${dateStr}_${counter}.notes.txt`;
        notesFilePath = path.join(currentDir, notesFileName);
      }
      isNewFile = true;
    }

    // Header block (new file only) and the per-entry header line.
    const header = isNewFile
      ? [separator, 'LOGAN Notes', `Source: ${fileInfo.path}`, `Created: ${timestamp}`, separator, ''].join('\n')
      : '';
    const noteDesc = note ? ` | ${note}` : '';
    const entryHeader = `--- [${timestamp}] Lines ${startLine + 1}-${endLine + 1}${noteDesc} ---`;

    // Stream the entry to disk. Reproduces exactly what
    // `['', entryHeader, ...lines, ''].join('\n')` built — a leading blank line, the
    // header, every line, and a trailing newline — but the line bodies go out in bounded
    // batches so a million-line range no longer throws "Invalid string length".
    let emitted = 0;
    const writeEntry = (fd: number) => {
      fs.writeSync(fd, `\n${entryHeader}\n`);
      emitted = streamLineBodiesToFd(fd, handler, startLine, endLine, filteredRange, columnConfig);
    };

    if (isNewFile) {
      const fd = fs.openSync(notesFilePath, 'w');
      try {
        if (header) fs.writeSync(fd, header);
        writeEntry(fd);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      // Insert in line-number order among existing snippets.
      const existing = fs.readFileSync(notesFilePath, 'utf-8');
      const entryPattern = /\n--- \[.*?\] Lines (\d+)-/g;
      const entries: { pos: number; line: number }[] = [];
      let match;
      while ((match = entryPattern.exec(existing)) !== null) {
        entries.push({ pos: match.index, line: parseInt(match[1], 10) });
      }

      // Insert before the first existing entry whose start line is larger than ours.
      const newStartLine1 = startLine + 1; // 1-indexed as in the header
      let insertPos = -1;
      for (const e of entries) {
        if (e.line > newStartLine1) { insertPos = e.pos; break; }
      }

      if (insertPos === -1) {
        // All existing entries have smaller line numbers — stream straight onto the end.
        const fd = fs.openSync(notesFilePath, 'a');
        try { writeEntry(fd); } finally { fs.closeSync(fd); }
      } else {
        // Insert mid-file — stream before + new entry + after into a temp file, then
        // atomically replace, so the new entry is still written in bounded chunks.
        const before = existing.substring(0, insertPos);
        const after = existing.substring(insertPos);
        const tmpPath = `${notesFilePath}.tmp-${process.pid}`;
        const fd = fs.openSync(tmpPath, 'w');
        try {
          if (before) fs.writeSync(fd, before);
          writeEntry(fd);
          if (after) fs.writeSync(fd, after);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(tmpPath, notesFilePath);
      }
    }

    // Invalidate cache for this file so it gets re-indexed with new content
    fileHandlerCache.delete(notesFilePath);

    if (currentFilePath) logActivity(currentFilePath, 'notes_saved', { startLine, endLine });

    return {
      success: true,
      filePath: notesFilePath,
      lineCount: emitted,
      isNewFile,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Analysis ===

let analyzeSignal: { cancelled: boolean } = { cancelled: false };

// List available analyzers
ipcMain.handle('list-analyzers', async () => {
  const analyzers = await analyzerRegistry.getAvailable();
  return {
    success: true,
    analyzers: analyzers.map(a => ({ name: a.name, description: a.description }))
  };
});

// Run analysis
ipcMain.handle('analyze-file', async (_, analyzerName?: string, options?: AnalyzerOptions) => {
  if (!currentFilePath) {
    return { success: false, error: 'No file open' };
  }

  // Get analyzer (default to first available if not specified)
  const analyzer = analyzerName
    ? analyzerRegistry.get(analyzerName)
    : analyzerRegistry.getDefault();

  if (!analyzer) {
    return { success: false, error: 'Analyzer not found' };
  }

  analyzeSignal = { cancelled: false };

  try {
    const result = await analyzeCurrentTarget(
      analyzer,
      options || {},
      (progress) => {
        mainWindow?.webContents.send('analyze-progress', progress);
      },
      analyzeSignal
    );

    logActivity(currentFilePath, 'analysis_run', { analyzerName: analyzer.name });
    cacheAnalysisResult(currentFilePath, result);

    return { success: true, result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Run analysis on a specific file path (used by compare feature)
ipcMain.handle('analyze-file-path', async (_, filePath: string) => {
  if (!filePath) {
    return { success: false, error: 'No file path provided' };
  }

  // Return cached result immediately if available — no re-analysis needed
  const cached = analysisResultCache.get(filePath);
  if (cached) {
    mainWindow?.webContents.send('compare-analyze-progress', { phase: 'done', percent: 100, message: 'Using cached analysis' });
    return { success: true, result: cached };
  }

  const analyzer = analyzerRegistry.getDefault();
  if (!analyzer) {
    return { success: false, error: 'Analyzer not found' };
  }

  const compareSignal = { cancelled: false };
  try {
    const result = await analyzer.analyze(
      filePath,
      {},
      (progress) => mainWindow?.webContents.send('compare-analyze-progress', progress),
      compareSignal
    );
    cacheAnalysisResult(filePath, result);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// ── Trends notebook (renderer path; mirrors the ApiContext trend* methods) ──
// All five trend scans run in a worker thread (src/main/trendWorker.ts) so a big
// file never blocks the main/UI event loop — the panel stays responsive instead of
// appearing stuck. The worker returns the exact same engine result shape.
ipcMain.handle(IPC.TREND_DISCOVER_FIELDS, async (_, options) => {
  // getReadHandler so Trends run over an active single-session composite too — the worker
  // presents the members' unified line space, so field/series/… come back in global lines.
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };
  try {
    const fields = await runTrendJob('discover', handler, {
      startLine: options?.startLine,
      endLine: options?.endLine,
      sampleSize: options?.sampleSize,
    });
    return { success: true, fields };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.TREND_DISCOVER_AXES, async (_, options) => {
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };
  try {
    const axes = await runTrendJob('axes', handler, {
      startLine: options?.startLine,
      endLine: options?.endLine,
      sampleSize: options?.sampleSize,
    });
    return { success: true, axes };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.TREND_SERIES, async (_, options) => {
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };
  if (!options?.field) return { success: false, error: 'field required' };
  try {
    const result = await runTrendJob('series', handler, {
      field: options.field,
      startLine: options.startLine,
      endLine: options.endLine,
      bucketCount: options.bucketCount,
      maxPoints: options.maxPoints,
      pattern: options.pattern,
      patternFlags: options.patternFlags,
      xAxis: options.xAxis,
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.TREND_SIGNAL_SERIES, async (_, options) => {
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };
  if (!options?.fields?.length) return { success: false, error: 'fields required' };
  try {
    const result = await runTrendJob('signal', handler, {
      fields: options.fields,
      startLine: options.startLine,
      endLine: options.endLine,
      xField: options.xField,
      maxPoints: options.maxPoints,
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.TREND_TRANSITIONS, async (_, options) => {
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };
  if (!options?.field) return { success: false, error: 'field required' };
  try {
    const result = await runTrendJob('transitions', handler, {
      field: options.field,
      startLine: options.startLine,
      endLine: options.endLine,
      maxTransitions: options.maxTransitions,
      pattern: options.pattern,
      patternFlags: options.patternFlags,
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.TREND_CORRELATE, async (_, options) => {
  const handler = getReadHandler();
  if (!handler) return { success: false, error: 'No file open' };
  if (!options?.field || !options?.event) return { success: false, error: 'field and event required' };
  try {
    const result = await runTrendJob('correlate', handler, {
      field: options.field,
      event: options.event,
      startLine: options.startLine,
      endLine: options.endLine,
      pattern: options.pattern,
      patternFlags: options.patternFlags,
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Guided triage recipe ===
// Runs the shared recipe engine (src/mcp-server/recipes.ts) so the UI panel and the
// MCP agent use the EXACT same code path. The engine speaks the /api/* HTTP contract,
// so we let it call our own already-running api-server (localhost) — no logic is
// duplicated and responses carry the same viewerLine augmentation the agent sees.
function selfApiCall(method: string, urlPath: string, body?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 60000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
          catch { resolve({ success: false }); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('triage recipe timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

ipcMain.handle(IPC.TRIAGE_RECIPE, async (_, options: RecipeOptions) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };
  if (!options?.symptom) return { success: false, error: 'symptom required' };
  try {
    const result = await runRecipe(selfApiCall, options);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Semantic summary — human twin of logan_summarize. Reuses the exact same
// ApiContext.summarize the agent's /api/summarize route calls (streaming
// TemplateFolder over forEachScopeLine), so the panel and the AI agree.
ipcMain.handle(IPC.SUMMARIZE, async (_, opts?: any, scope?: ScopeDescriptor) => {
  if (!apiContext) return { success: false, error: 'Not ready' };
  try {
    return await apiContext.summarize(opts, scope || undefined);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Cancel an in-flight summary (the ⏹/Cancel button on the Summarize panel).
// Flips the main-thread scan's flag AND terminates the off-thread worker.
ipcMain.handle(IPC.SUMMARIZE_CANCEL, async () => {
  summarizeSignal.cancelled = true;
  cancelSummarizeJob();
  return { success: true };
});

// In-place viewer folding — detect the repeating blocks (off-thread).
ipcMain.handle(IPC.DETECT_FOLD_REGIONS, async (_, opts?: any) => {
  if (!apiContext) return { success: false, error: 'Not ready' };
  try {
    return await apiContext.foldRegions(opts);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Component/text health — human twin of logan_investigate_component. Reuses the
// EXACT ApiContext.investigateComponent the agent calls (term → level breakdown +
// per-level samples + isTopFailer), so the panel and the AI agree.
ipcMain.handle(IPC.INVESTIGATE_COMPONENT, async (_, opts: { component: string; maxSamplesPerLevel?: number; includeErrorContext?: boolean; contextLines?: number }) => {
  if (!apiContext) return { success: false, error: 'Not ready' };
  try {
    return await apiContext.investigateComponent(opts);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Apply the folded VIEW as an explicit line-set filter: the renderer computes the
// visible lines (all lines minus each collapsed region's interior) and hands them
// here, so the existing filtered read path maps display↔file with no new plumbing.
// An empty set means "unfold everything" → clear the filter.
ipcMain.handle(IPC.SET_FOLD_FILTER, async (_, lines: number[]) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  if (!lines || lines.length === 0) {
    filterState.delete(currentFilePath);
    return { success: true, filteredLines: 0, filteredLineNumbers: null };
  }
  const sorted = Array.from(new Set(lines)).sort((a, b) => a - b);
  filterState.set(currentFilePath, sorted);
  return { success: true, filteredLines: sorted.length, filteredLineNumbers: sorted };
});

// Evidence pack (native "📋 Brief") — reuses the SAME buildEvidencePack the AI's
// /api/evidence-pack path uses. Sensible defaults match the MCP tool; redaction
// is off (this is the local human view).
ipcMain.handle(IPC.EVIDENCE_PACK, async (_, options) => {
  if (!apiContext) return { success: false, error: 'Not ready' };
  try {
    return await buildEvidencePack(apiContext, {
      thresholdSeconds: options?.thresholdSeconds ?? 60,
      topFields: options?.topFields ?? 25,
      topGaps: options?.topGaps ?? 8,
      topComponents: options?.topComponents,
      fieldSampleSize: options?.fieldSampleSize,
      analyzerName: options?.analyzerName,
      baselineId: options?.baselineId,
    });
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Cancel analysis
ipcMain.handle('cancel-analysis', async () => {
  analyzeSignal.cancelled = true;
  return { success: true };
});

// === Baselines ===

ipcMain.handle(IPC.BASELINE_LIST, async () => {
  try {
    return { success: true, baselines: baselineStore.list() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_SAVE, async (_, name: string, description: string, tags: string[]) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file handler' };
  const analysisResult = analysisResultCache.get(currentFilePath);
  if (!analysisResult) return { success: false, error: 'Run analysis first' };
  try {
    const env = factsToPlain(getContextManifest(currentFilePath));
    const fingerprint = buildFingerprint(currentFilePath, analysisResult, handler, env);
    const id = baselineStore.save(name, description, tags, fingerprint);
    return { success: true, id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_GET, async (_, id: string) => {
  try {
    const baseline = baselineStore.get(id);
    if (!baseline) return { success: false, error: 'Baseline not found' };
    return { success: true, baseline };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_UPDATE, async (_, id: string, fields: { name?: string; description?: string; tags?: string[] }) => {
  try {
    const ok = baselineStore.update(id, fields);
    return { success: ok, error: ok ? undefined : 'Baseline not found' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_DELETE, async (_, id: string) => {
  try {
    const ok = baselineStore.delete(id);
    return { success: ok, error: ok ? undefined : 'Baseline not found' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.BASELINE_COMPARE, async (_, baselineId: string) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file handler' };
  const analysisResult = analysisResultCache.get(currentFilePath);
  if (!analysisResult) return { success: false, error: 'Run analysis first' };
  try {
    const env = factsToPlain(getContextManifest(currentFilePath));
    const currentFp = buildFingerprint(currentFilePath, analysisResult, handler, env);
    const report = baselineStore.compare(currentFp, baselineId);
    if (!report) return { success: false, error: 'Baseline not found' };
    return { success: true, report };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Filter ===

// Advanced Filter Types
type FilterRuleType = 'contains' | 'not_contains' | 'level' | 'not_level' | 'regex' | 'not_regex' | 'column';

interface FilterRule {
  id: string;
  type: FilterRuleType;
  value: string;
  caseSensitive?: boolean;
  columnIndex?: number;                         // for type 'column': which column to test
  columnOp?: 'equals' | 'contains' | 'regex';   // for type 'column': how to compare the cell
}

interface FilterGroup {
  id: string;
  operator: 'AND' | 'OR';
  rules: FilterRule[];
}

interface AdvancedFilterConfig {
  enabled: boolean;
  groups: FilterGroup[];
  contextLines?: number;
  delimiter?: string;                           // column delimiter, so 'column' rules can split the line
}

interface FilterConfig {
  levels: string[];
  includePatterns: string[];
  excludePatterns: string[];
  matchCase?: boolean;
  exactMatch?: boolean;
  contextLines?: number;
  advancedFilter?: AdvancedFilterConfig;
}

// Compile advanced filter for performance - pre-compile regex and prepare matchers
type CompiledMatcher = (text: string, level: string) => boolean;

function compileAdvancedFilter(config: AdvancedFilterConfig): CompiledMatcher {
  const compiledGroups = config.groups.map(group => {
    const compiledRules = group.rules.map(rule => {
      // Pre-compile regex if needed
      if (rule.type === 'regex' || rule.type === 'not_regex') {
        try {
          const regex = new RegExp(rule.value, rule.caseSensitive ? '' : 'i');
          return rule.type === 'regex'
            ? (text: string, _level: string) => regex.test(text)
            : (text: string, _level: string) => !regex.test(text);
        } catch {
          // Invalid regex - return matcher that always fails/passes
          return rule.type === 'regex'
            ? (_text: string, _level: string) => false
            : (_text: string, _level: string) => true;
        }
      }

      // Pre-lowercase for contains
      const pattern = rule.caseSensitive ? rule.value : rule.value.toLowerCase();

      switch (rule.type) {
        case 'contains':
          return (text: string, _level: string) =>
            (rule.caseSensitive ? text : text.toLowerCase()).includes(pattern);
        case 'not_contains':
          return (text: string, _level: string) =>
            !(rule.caseSensitive ? text : text.toLowerCase()).includes(pattern);
        case 'level':
          return (_text: string, level: string) => level.toLowerCase() === rule.value.toLowerCase();
        case 'not_level':
          return (_text: string, level: string) => level.toLowerCase() !== rule.value.toLowerCase();
        case 'column': {
          // Filter ROWS by a single column's value: split the line with the same
          // canonical splitter the viewer uses, take column[columnIndex], compare.
          const delim = config.delimiter ?? ' ';
          const colIdx = rule.columnIndex ?? 0;
          const op = rule.columnOp ?? 'contains';
          if (op === 'regex') {
            let re: RegExp | null = null;
            try { re = new RegExp(rule.value, rule.caseSensitive ? '' : 'i'); } catch { re = null; }
            return (text: string, _level: string) =>
              re ? re.test(splitLineIntoColumns(text, delim)[colIdx] ?? '') : false;
          }
          const target = rule.caseSensitive ? rule.value : rule.value.toLowerCase();
          return (text: string, _level: string) => {
            const cell = splitLineIntoColumns(text, delim)[colIdx] ?? '';
            const c = rule.caseSensitive ? cell : cell.toLowerCase();
            return op === 'equals' ? c === target : c.includes(target);
          };
        }
        default:
          return (_text: string, _level: string) => true;
      }
    });

    // Return group evaluator
    return group.operator === 'AND'
      ? (text: string, level: string) => compiledRules.every(fn => fn(text, level))
      : (text: string, level: string) => compiledRules.some(fn => fn(text, level));
  });

  // Groups are AND'd together
  return (text: string, level: string) => compiledGroups.every(fn => fn(text, level));
}

// Cancellation signal for filter
let filterSignal = { cancelled: false };

ipcMain.handle('apply-filter', async (_, config: FilterConfig) => {
  // getReadHandler so Filter runs over an active single-session composite too; matching
  // lines are stored as GLOBAL line numbers, which GET_LINES already resolves per-member
  // via getLinesByNumbers.
  const handler = getReadHandler();
  if (!handler || !currentFilePath) {
    return { success: false, error: 'No file open' };
  }

  filterSignal = { cancelled: false };
  const tFilterH0 = Date.now();

  try {
    const totalLines = handler.getTotalLines();
    const matchingLines: Set<number> = new Set();

    // Check if advanced filter is enabled
    const useAdvancedFilter = config.advancedFilter?.enabled && config.advancedFilter.groups.length > 0;
    const contextLines = useAdvancedFilter
      ? (config.advancedFilter?.contextLines || 0)
      : (config.contextLines || 0);

    // Compile advanced filter if enabled
    const advancedMatcher = useAdvancedFilter
      ? compileAdvancedFilter(config.advancedFilter!)
      : null;

    // For basic filter: separate include and exclude passes
    // Include matches get context window, exclude removes exact lines only
    const hasBasicExclude = !useAdvancedFilter && config.excludePatterns.length > 0;
    const excludeLines: Set<number> = new Set();

    // Pattern matching helper respecting matchCase and exactMatch options
    const caseSensitive = config.matchCase || false;
    const exactMatch = config.exactMatch || false;

    // Pre-compile regex patterns once for performance (avoid re-creating RegExp per line)
    type CompiledPattern = { regex: RegExp } | { literal: string; lowerLiteral: string; patternCaseSensitive: boolean };

    // Compile exclude patterns (use global caseSensitive)
    const compileExcludePattern = (pattern: string): CompiledPattern => {
      if (exactMatch) {
        return { literal: pattern, lowerLiteral: pattern.toLowerCase(), patternCaseSensitive: caseSensitive };
      }
      try {
        return { regex: new RegExp(pattern, caseSensitive ? '' : 'i') };
      } catch {
        return { literal: pattern, lowerLiteral: pattern.toLowerCase(), patternCaseSensitive: caseSensitive };
      }
    };

    // Normalize include patterns: support both old string[] and new {pattern,caseSensitive}[]
    const normalizedIncludes: Array<{ pattern: string; caseSensitive: boolean }> =
      config.includePatterns.map((p: any) =>
        typeof p === 'string'
          ? { pattern: p, caseSensitive: caseSensitive }
          : { pattern: p.pattern, caseSensitive: p.caseSensitive }
      );

    // Compile include patterns with per-pattern case sensitivity
    const compileIncludePattern = (ip: { pattern: string; caseSensitive: boolean }): CompiledPattern => {
      if (exactMatch) {
        return { literal: ip.pattern, lowerLiteral: ip.pattern.toLowerCase(), patternCaseSensitive: ip.caseSensitive };
      }
      try {
        return { regex: new RegExp(ip.pattern, ip.caseSensitive ? '' : 'i') };
      } catch {
        return { literal: ip.pattern, lowerLiteral: ip.pattern.toLowerCase(), patternCaseSensitive: ip.caseSensitive };
      }
    };

    const compiledIncludePatterns = normalizedIncludes.map(compileIncludePattern);
    const compiledExcludePatterns = config.excludePatterns.map(compileExcludePattern);

    const matchCompiled = (text: string, compiled: CompiledPattern): boolean => {
      if ('regex' in compiled) {
        return compiled.regex.test(text);
      }
      return compiled.patternCaseSensitive
        ? text.includes(compiled.literal)
        : text.toLowerCase().includes(compiled.lowerLiteral);
    };

    // Process in batches for performance
    const batchSize = 10000;
    let processedLines = 0;
    let lastProgressUpdate = Date.now();

    for (let start = 0; start < totalLines; start += batchSize) {
      // Check for cancellation
      if (filterSignal.cancelled) {
        return { success: false, error: 'Cancelled' };
      }

      const count = Math.min(batchSize, totalLines - start);
      const lines = handler.getLines(start, count);

      for (const line of lines) {
        let matches = true;
        const lineLevel = line.level || 'other';

        if (useAdvancedFilter && advancedMatcher) {
          // Use advanced filter
          matches = advancedMatcher(line.text, lineLevel);
        } else {
          // Use basic filter

          // Level filter
          if (config.levels.length > 0) {
            matches = config.levels.includes(lineLevel);
          }

          // Include patterns (OR logic)
          if (matches && compiledIncludePatterns.length > 0) {
            matches = compiledIncludePatterns.some(cp => matchCompiled(line.text, cp));
          }

          // Track exclude matches separately (exact lines only)
          if (hasBasicExclude) {
            const excluded = compiledExcludePatterns.some(cp => matchCompiled(line.text, cp));
            if (excluded) {
              excludeLines.add(line.lineNumber);
            }
          }
        }

        if (matches) {
          matchingLines.add(line.lineNumber);
        }
      }

      processedLines += count;

      // Yield to event loop and send progress every 50ms to keep UI responsive
      const now = Date.now();
      if (now - lastProgressUpdate > 50) {
        await yieldToEventLoop();
        const progress = Math.round((processedLines / totalLines) * 100);
        mainWindow?.webContents.send('filter-progress', { percent: Math.min(progress, 99) });
        lastProgressUpdate = Date.now();
      }
    }

    // Add context lines around include matches (before exclude removal)
    if (contextLines > 0) {
      const matchArray = Array.from(matchingLines);
      for (const lineNum of matchArray) {
        for (let i = 1; i <= contextLines; i++) {
          if (lineNum - i >= 0) matchingLines.add(lineNum - i);
          if (lineNum + i < totalLines) matchingLines.add(lineNum + i);
        }
      }
    }

    // Remove exact exclude lines after context expansion
    if (hasBasicExclude) {
      for (const lineNum of excludeLines) {
        matchingLines.delete(lineNum);
      }
    }

    // Sort and store
    const sortedLines = Array.from(matchingLines).sort((a, b) => a - b);
    filterState.set(currentFilePath, sortedLines);

    logActivity(currentFilePath, 'filter_applied', { levels: config.levels, filteredLines: sortedLines.length });
    recordPatternApplication({
      scope: 'filter', source: summarizeFilterPatterns(config), mode: 'regex',
      scanned: totalLines, matched: sortedLines.length,
      hid: Math.max(0, totalLines - sortedLines.length), ms: Date.now() - tFilterH0,
    });

    return {
      success: true,
      stats: {
        filteredLines: sortedLines.length,
      },
      filteredLineNumbers: sortedLines,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('get-filtered-line-numbers', () => {
  return getFilteredLines();
});

ipcMain.handle('cancel-filter', async () => {
  filterSignal.cancelled = true;
  return { success: true };
});

ipcMain.handle('clear-filter', async () => {
  if (currentFilePath) {
    filterState.delete(currentFilePath);
    logActivity(currentFilePath, 'filter_cleared', {});
  }
  return { success: true };
});

// === Time Gap Detection ===

interface TimeGap {
  lineNumber: number;
  prevLineNumber: number;
  gapSeconds: number;
  prevTimestamp: string;
  currTimestamp: string;
  linePreview: string;
}

interface TimeGapOptions {
  thresholdSeconds: number;
  startLine?: number;
  endLine?: number;
  startPattern?: string;
  endPattern?: string;
}

// Cancellation signal for time gap detection
let timeGapSignal = { cancelled: false };

// Helper to yield to event loop - use setTimeout for better yielding
const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

// parseTimestampFast now lives in ./timestampParse (shared with the trend worker).

// Get timestamp from a specific line
ipcMain.handle(IPC.GET_LINE_TIMESTAMP, async (_, lineNumber: number) => {
  const handler = getFileHandler();
  if (!handler) {
    return { epochMs: null, timestampStr: null };
  }
  try {
    const lines = handler.getLines(lineNumber, 1);
    if (lines.length === 0) {
      return { epochMs: null, timestampStr: null };
    }
    const parsed = parseTimestampFast(lines[0].text);
    if (!parsed) {
      return { epochMs: null, timestampStr: null };
    }
    return { epochMs: parsed.date.getTime(), timestampStr: parsed.str };
  } catch {
    return { epochMs: null, timestampStr: null };
  }
});

// ─── Video transcode (AVI/MKV/etc → MP4 for Chromium's <video>) ──────────────
// Chromium can only decode MP4/H.264, WebM and Ogg. To support other containers
// we transcode them to H.264/AAC MP4 on demand (cached by source size+mtime).
let ffmpegPathCache: string | null | undefined; // undefined=unresolved, null=not found
function resolveFfmpeg(): string | null {
  if (ffmpegPathCache !== undefined) return ffmpegPathCache;
  // 1) bundled ffmpeg-static, if the dependency is installed
  try {
    const ffStatic = require('ffmpeg-static');
    const p = typeof ffStatic === 'string' ? ffStatic : (ffStatic && ffStatic.path);
    if (p && fs.existsSync(p)) { ffmpegPathCache = p; return p; }
  } catch { /* not installed — fall through to system */ }
  // 2) common system locations (GUI apps on macOS often miss /opt/homebrew/bin in PATH)
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/bin/ffmpeg'];
  for (const c of candidates) { if (fs.existsSync(c)) { ffmpegPathCache = c; return c; } }
  // 3) bare name — relies on PATH (works in dev launched from a shell)
  try {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim()) { ffmpegPathCache = 'ffmpeg'; return 'ffmpeg'; }
  } catch { /* ignore */ }
  ffmpegPathCache = null;
  return null;
}

let activeTranscode: ChildProcess | null = null;

ipcMain.handle(IPC.VIDEO_TRANSCODE_CANCEL, async () => {
  if (activeTranscode) { try { activeTranscode.kill('SIGKILL'); } catch { /* ignore */ } activeTranscode = null; }
  return { success: true };
});

ipcMain.handle(IPC.VIDEO_TRANSCODE, async (_, srcPath: string) => {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    return { success: false, error: 'ffmpeg not found. Install it (macOS: `brew install ffmpeg`) or we can bundle it into LOGAN.' };
  }
  let stat: fs.Stats;
  try { stat = fs.statSync(srcPath); } catch { return { success: false, error: 'Source video not found: ' + srcPath }; }

  const cacheDir = path.join(os.tmpdir(), 'logan-video-cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch { /* ignore */ }
  const key = createHash('sha1').update(srcPath + ':' + stat.size + ':' + Math.round(stat.mtimeMs)).digest('hex').slice(0, 16);
  const outPath = path.join(cacheDir, key + '.mp4');

  // Cache hit — reuse the previously transcoded file.
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    return { success: true, outputPath: outPath, cached: true };
  }

  // Cancel any in-flight transcode before starting a new one.
  if (activeTranscode) { try { activeTranscode.kill('SIGKILL'); } catch { /* ignore */ } activeTranscode = null; }

  const partPath = outPath + '.part';
  const args = [
    '-y', '-i', srcPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-f', 'mp4', partPath,
  ];

  return await new Promise((resolve) => {
    let durationMs = 0;
    let stderrTail = '';
    let settled = false;
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    activeTranscode = proc;

    proc.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      if (durationMs === 0) {
        const dm = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        if (dm) durationMs = (+dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3])) * 1000;
      }
      const tm = text.match(/time=\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (tm && durationMs > 0) {
        const curMs = (+tm[1] * 3600 + +tm[2] * 60 + parseFloat(tm[3])) * 1000;
        const percent = Math.max(0, Math.min(99, Math.round((curMs / durationMs) * 100)));
        mainWindow?.webContents.send(IPC.VIDEO_TRANSCODE_PROGRESS, { percent });
      }
    });

    proc.on('error', (err) => {
      if (settled) return; settled = true; activeTranscode = null;
      resolve({ success: false, error: 'Failed to launch ffmpeg: ' + err.message });
    });

    proc.on('close', (code, signal) => {
      if (settled) return; settled = true;
      const wasActive = activeTranscode === proc;
      activeTranscode = null;
      if (signal === 'SIGKILL') {
        try { fs.unlinkSync(partPath); } catch { /* ignore */ }
        resolve({ success: false, error: 'cancelled', cancelled: true });
        return;
      }
      if (code === 0) {
        try {
          fs.renameSync(partPath, outPath);
          mainWindow?.webContents.send(IPC.VIDEO_TRANSCODE_PROGRESS, { percent: 100 });
          resolve({ success: true, outputPath: outPath });
        } catch (e: any) {
          resolve({ success: false, error: 'Transcode finished but output could not be saved: ' + e.message });
        }
      } else {
        try { fs.unlinkSync(partPath); } catch { /* ignore */ }
        const reason = stderrTail.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || ('ffmpeg exited with code ' + code);
        resolve({ success: false, error: wasActive ? reason : 'cancelled', cancelled: !wasActive });
      }
    });
  });
});

// Batch timestamp fetch for Time Align
ipcMain.handle(IPC.GET_LINE_TIMESTAMPS, async (_, lineNumbers: number[]) => {
  const handler = getFileHandler();
  if (!handler) return [];
  const results: Array<{ lineNumber: number; epochMs: number }> = [];
  try {
    for (const ln of lineNumbers) {
      const lines = handler.getLines(ln, 1);
      if (lines.length === 0) continue;
      const parsed = parseTimestampFast(lines[0].text);
      if (parsed) {
        results.push({ lineNumber: ln, epochMs: parsed.date.getTime() });
      }
    }
  } catch { /* ignore */ }
  return results;
});

// File-handler registry: resolve the plugin actions that apply to a clicked
// file/folder, and run one. Same entry points a future MCP tool would call.
ipcMain.handle(IPC.FILE_HANDLERS_RESOLVE, async (_, query: FileHandlerQuery) => {
  return resolveFileHandlers(query);
});
ipcMain.handle(IPC.FILE_HANDLER_RUN, async (_, id: string, query: FileHandlerQuery) => {
  return runFileHandler(id, query);
});

ipcMain.handle('detect-time-gaps', async (_, options: TimeGapOptions) => {
  const handler = getFileHandler();
  if (!handler || !currentFilePath) {
    return { success: false, error: 'No file open' };
  }

  // Reset cancellation signal
  timeGapSignal = { cancelled: false };

  try {
    const totalLines = handler.getTotalLines();
    const gaps: TimeGap[] = [];
    const MAX_GAPS = 500; // Lower limit for faster response

    const thresholdSeconds = options.thresholdSeconds || 30;

    // Determine the line range to scan
    let scanStartLine = 0;
    let scanEndLine = totalLines - 1;
    let inRange = !options.startPattern;
    let foundStartPattern = false;
    let foundEndPattern = false;

    if (options.startLine && options.startLine > 0) {
      scanStartLine = options.startLine - 1;
      inRange = !options.startPattern;
    }
    if (options.endLine && options.endLine > 0) {
      scanEndLine = Math.min(options.endLine - 1, totalLines - 1);
    }

    let prevTimestamp: Date | null = null;
    let prevTimestampStr: string | null = null;
    let prevLineNumber = 0;

    // Adaptive batch size based on file size
    const linesToScan = scanEndLine - scanStartLine + 1;
    const batchSize = linesToScan > 100000 ? 2000 : 5000;
    let processedLines = 0;
    let lastProgressUpdate = Date.now();

    for (let start = scanStartLine; start <= scanEndLine && gaps.length < MAX_GAPS; start += batchSize) {
      // Check for cancellation
      if (timeGapSignal.cancelled) {
        return { success: false, error: 'Cancelled' };
      }

      const count = Math.min(batchSize, scanEndLine - start + 1);
      const lines = handler.getLines(start, count);

      for (const line of lines) {
        if (options.startPattern && !foundStartPattern) {
          if (line.text.includes(options.startPattern)) {
            foundStartPattern = true;
            inRange = true;
          }
        }

        if (options.endPattern && inRange && !foundEndPattern) {
          if (line.text.includes(options.endPattern)) {
            foundEndPattern = true;
          }
        }

        if (!inRange) continue;

        const parsed = parseTimestampFast(line.text);

        if (parsed && prevTimestamp) {
          const diffSeconds = (parsed.date.getTime() - prevTimestamp.getTime()) / 1000;

          if (Math.abs(diffSeconds) >= thresholdSeconds) {
            gaps.push({
              lineNumber: line.lineNumber,
              prevLineNumber: prevLineNumber,
              gapSeconds: Math.abs(diffSeconds),
              prevTimestamp: prevTimestampStr || '',
              currTimestamp: parsed.str,
              linePreview: line.text.length > 80 ? line.text.substring(0, 80) + '...' : line.text,
            });

            if (gaps.length >= MAX_GAPS) break;
          }
        }

        if (parsed) {
          prevTimestamp = parsed.date;
          prevTimestampStr = parsed.str;
          prevLineNumber = line.lineNumber;
        }

        if (foundEndPattern) break;
      }

      if (foundEndPattern || gaps.length >= MAX_GAPS) break;

      processedLines += count;

      // Yield and send progress every 50ms to keep UI responsive
      const now = Date.now();
      if (now - lastProgressUpdate > 50) {
        await yieldToEventLoop();
        const progress = Math.round((processedLines / linesToScan) * 100);
        mainWindow?.webContents.send('time-gap-progress', { percent: progress });
        lastProgressUpdate = now;
      }
    }

    gaps.sort((a, b) => b.gapSeconds - a.gapSeconds);

    if (currentFilePath) logActivity(currentFilePath, 'time_gap_analysis', { threshold: thresholdSeconds, gapsFound: gaps.length });

    return { success: true, gaps, totalLines };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('cancel-time-gaps', async () => {
  timeGapSignal.cancelled = true;
  return { success: true };
});

// === Cadence / Missing-Sequence Detection ===
// The "negative-space" instrument: given a repeating event (a pattern), read the
// timestamps of every match, AUTO-DETECT the period, then flag every SKIPPED
// occurrence and any drift in the rhythm. It surfaces the events that DID NOT
// happen. Purely native — no AI. Modelled on the time-gap scanner above.

interface CadenceOptions {
  pattern: string;
  isRegex?: boolean;
  matchCase?: boolean;
  toleranceFactor?: number; // gap >= factor * period -> flagged as a skip (default 1.5)
  startLine?: number;
  endLine?: number;
}

interface CadenceMiss {
  afterLineNumber: number;   // 0-based; last occurrence before the gap
  beforeLineNumber: number;  // 0-based; next occurrence after the gap
  afterTs: string;
  beforeTs: string;
  afterEpochMs: number;
  beforeEpochMs: number;
  gapMs: number;
  missingCount: number;      // estimated number of skipped occurrences
}

let cadenceSignal = { cancelled: false };

function cadenceMedian(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Normalize a line to a stable "template" by masking variable tokens (numbers,
// hex, UUIDs). Used only for the auto-suggest of recurring events.
function cadenceTemplate(text: string): string {
  let t = text;
  const parsed = parseTimestampFast(t);
  if (parsed && parsed.str && t.startsWith(parsed.str)) t = t.slice(parsed.str.length);
  return t
    .replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '#')
    .replace(/0x[0-9a-fA-F]+/g, '#')
    .replace(/\b[0-9a-fA-F]{6,}\b/g, '#')
    .replace(/\d+/g, '#')
    .replace(/#[#\s.:,_\-/]*#/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// Derive a literal search string from a template: the contiguous run with the
// most letters (a distinctive, stable substring to match the event on).
function cadenceLiteral(tmpl: string): string {
  let best = '';
  let bestLetters = 0;
  for (const seg of tmpl.split('#')) {
    const trimmed = seg.trim();
    const letters = (trimmed.match(/[A-Za-z]/g) || []).length;
    if (letters > bestLetters) { best = trimmed; bestLetters = letters; }
  }
  return best;
}

ipcMain.handle('detect-cadence', async (_, options: CadenceOptions) => {
  const handler = getFileHandler();
  if (!handler || !currentFilePath) {
    return { success: false, error: 'No file open' };
  }
  if (!options || !options.pattern || !options.pattern.trim()) {
    return { success: false, error: 'Enter a repeating-event pattern' };
  }

  cadenceSignal = { cancelled: false };

  try {
    const totalLines = handler.getTotalLines();
    const toleranceFactor = options.toleranceFactor && options.toleranceFactor > 1 ? options.toleranceFactor : 1.5;

    // Build the matcher (regex or case-aware substring).
    let regex: RegExp | null = null;
    if (options.isRegex) {
      try {
        regex = new RegExp(options.pattern, options.matchCase ? '' : 'i');
      } catch (e) {
        return { success: false, error: 'Invalid regex: ' + String(e) };
      }
    }
    const needle = options.matchCase ? options.pattern : options.pattern.toLowerCase();
    const matches = (text: string): boolean => {
      if (regex) return regex.test(text);
      return (options.matchCase ? text : text.toLowerCase()).includes(needle);
    };

    let scanStartLine = 0;
    let scanEndLine = totalLines - 1;
    if (options.startLine && options.startLine > 0) scanStartLine = options.startLine - 1;
    if (options.endLine && options.endLine > 0) scanEndLine = Math.min(options.endLine - 1, totalLines - 1);

    const MAX_OCC = 300000;
    const occLines: number[] = [];
    const occEpoch: number[] = [];
    const occStr: string[] = [];
    let untimedMatches = 0;
    let totalMatches = 0;
    let occCapped = false;

    const linesToScan = Math.max(1, scanEndLine - scanStartLine + 1);
    const batchSize = linesToScan > 100000 ? 2000 : 5000;
    let processedLines = 0;
    let lastProgressUpdate = Date.now();

    for (let start = scanStartLine; start <= scanEndLine; start += batchSize) {
      if (cadenceSignal.cancelled) return { success: false, error: 'Cancelled' };
      const count = Math.min(batchSize, scanEndLine - start + 1);
      const lines = handler.getLines(start, count);
      for (const line of lines) {
        if (!matches(line.text)) continue;
        totalMatches++;
        const parsed = parseTimestampFast(line.text);
        if (parsed) {
          if (occLines.length < MAX_OCC) {
            occLines.push(line.lineNumber);
            occEpoch.push(parsed.date.getTime());
            occStr.push(parsed.str);
          } else {
            occCapped = true;
          }
        } else {
          untimedMatches++;
        }
      }
      processedLines += count;
      const now = Date.now();
      if (now - lastProgressUpdate > 50) {
        await yieldToEventLoop();
        const progress = Math.round((processedLines / linesToScan) * 100);
        mainWindow?.webContents.send('cadence-progress', { percent: progress });
        lastProgressUpdate = now;
      }
    }

    const timedMatches = occLines.length;
    if (timedMatches < 3) {
      return {
        success: true,
        pattern: options.pattern, isRegex: !!options.isRegex,
        totalMatches, timedMatches, untimedMatches,
        periodMs: null, misses: [], missingTotal: 0, drift: null,
        occurrences: [], totalLines,
        note: timedMatches === 0
          ? 'No timestamped lines matched — cadence needs matches that carry a timestamp.'
          : `Only ${timedMatches} timestamped match${timedMatches === 1 ? '' : 'es'} — need at least 3 to establish a cadence.`,
      };
    }

    // Inter-arrival intervals (positive only, for a robust median period).
    const deltas: number[] = [];
    for (let i = 1; i < occEpoch.length; i++) {
      const d = occEpoch[i] - occEpoch[i - 1];
      if (d > 0) deltas.push(d);
    }
    const periodMs = cadenceMedian(deltas) || 0;
    const minIntervalMs = deltas.length ? Math.min(...deltas) : 0;
    const maxIntervalMs = deltas.length ? Math.max(...deltas) : 0;

    // Misses: consecutive pairs whose gap >= toleranceFactor * period.
    const misses: CadenceMiss[] = [];
    let missingTotal = 0;
    const MAX_MISSES = 2000;
    let missTruncated = false;
    if (periodMs > 0) {
      const threshold = toleranceFactor * periodMs;
      for (let i = 1; i < occEpoch.length; i++) {
        const d = occEpoch[i] - occEpoch[i - 1];
        if (d >= threshold) {
          const missingCount = Math.max(1, Math.round(d / periodMs) - 1);
          missingTotal += missingCount;
          if (misses.length < MAX_MISSES) {
            misses.push({
              afterLineNumber: occLines[i - 1],
              beforeLineNumber: occLines[i],
              afterTs: occStr[i - 1],
              beforeTs: occStr[i],
              afterEpochMs: occEpoch[i - 1],
              beforeEpochMs: occEpoch[i],
              gapMs: d,
              missingCount,
            });
          } else {
            missTruncated = true;
          }
        }
      }
    }

    // Drift: compare early-third vs late-third median interval.
    let drift: { earlyPeriodMs: number; latePeriodMs: number; driftPct: number } | null = null;
    if (deltas.length >= 6) {
      const third = Math.max(1, Math.floor(deltas.length / 3));
      const early = cadenceMedian(deltas.slice(0, third));
      const late = cadenceMedian(deltas.slice(deltas.length - third));
      if (early > 0) drift = { earlyPeriodMs: early, latePeriodMs: late, driftPct: ((late - early) / early) * 100 };
    }

    // Sampled occurrences for the strip visualization.
    const MAX_STRIP = 4000;
    const occurrences: { lineNumber: number; epochMs: number }[] = [];
    let occurrencesSampled = false;
    if (timedMatches <= MAX_STRIP) {
      for (let i = 0; i < timedMatches; i++) occurrences.push({ lineNumber: occLines[i], epochMs: occEpoch[i] });
    } else {
      occurrencesSampled = true;
      const step = timedMatches / MAX_STRIP;
      for (let k = 0; k < MAX_STRIP; k++) {
        const i = Math.floor(k * step);
        occurrences.push({ lineNumber: occLines[i], epochMs: occEpoch[i] });
      }
    }

    const firstEpochMs = occEpoch[0];
    const lastEpochMs = occEpoch[occEpoch.length - 1];
    const spanMs = Math.max(0, lastEpochMs - firstEpochMs);
    const expectedCount = periodMs > 0 && spanMs > 0 ? Math.round(spanMs / periodMs) + 1 : timedMatches;

    if (currentFilePath) logActivity(currentFilePath, 'cadence_analysis', { pattern: options.pattern, timedMatches, missing: missingTotal });

    return {
      success: true,
      pattern: options.pattern, isRegex: !!options.isRegex, toleranceFactor,
      totalMatches, timedMatches, untimedMatches, occCapped,
      periodMs, minIntervalMs, maxIntervalMs,
      firstLineNumber: occLines[0], lastLineNumber: occLines[occLines.length - 1],
      firstTs: occStr[0], lastTs: occStr[occStr.length - 1],
      firstEpochMs, lastEpochMs, spanMs,
      expectedCount, missingTotal,
      misses, missTruncated,
      drift,
      occurrences, occurrencesSampled,
      totalLines,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('cancel-cadence', async () => {
  cadenceSignal.cancelled = true;
  return { success: true };
});

// Auto-suggest: scan the file for frequently-recurring line "templates" and
// return the strongest candidates as clickable patterns for cadence detection.
ipcMain.handle('suggest-cadence-events', async () => {
  const handler = getFileHandler();
  if (!handler || !currentFilePath) return { success: false, error: 'No file open' };
  try {
    const totalLines = handler.getTotalLines();
    // Sample evenly across the file to keep this cheap on huge logs.
    const SAMPLE = 40000;
    const step = totalLines > SAMPLE ? Math.floor(totalLines / SAMPLE) : 1;
    const counts = new Map<string, { count: number; sample: string; timed: number }>();
    const batchSize = 5000;
    let lastYield = Date.now();
    for (let start = 0; start < totalLines; start += batchSize) {
      const count = Math.min(batchSize, totalLines - start);
      const lines = handler.getLines(start, count);
      for (const line of lines) {
        if (step > 1 && (line.lineNumber % step) !== 0) continue;
        const tmpl = cadenceTemplate(line.text);
        if (!tmpl || tmpl.length < 4) continue;
        const hasTs = parseTimestampFast(line.text) ? 1 : 0;
        const e = counts.get(tmpl);
        if (e) { e.count++; e.timed += hasTs; }
        else counts.set(tmpl, { count: 1, sample: line.text.slice(0, 160), timed: hasTs });
      }
      const now = Date.now();
      if (now - lastYield > 50) { await yieldToEventLoop(); lastYield = now; }
    }
    const suggestions = [...counts.entries()]
      .filter(([, v]) => v.count >= 5 && v.timed > 0)
      .map(([tmpl, v]) => ({ template: tmpl, count: v.count, sample: v.sample, pattern: cadenceLiteral(tmpl) }))
      .filter(s => s.pattern && s.pattern.length >= 4)
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    return { success: true, suggestions, sampledStep: step, totalLines };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// === Split File ===

interface SplitOptions {
  mode: 'lines' | 'parts';
  value: number; // lines per file or number of parts
}

ipcMain.handle('split-file', async (_, options: SplitOptions) => {
  const handler = getFileHandler();
  if (!handler) return { success: false, error: 'No file open' };

  try {
    const fileInfo = handler.getFileInfo();
    if (!fileInfo) return { success: false, error: 'No file info' };

    const totalLines = handler.getTotalLines();
    const currentDir = path.dirname(fileInfo.path);
    const baseName = path.basename(fileInfo.path, path.extname(fileInfo.path));
    const ext = path.extname(fileInfo.path);
    const splitDir = path.join(currentDir, `${baseName}_split`);

    // Create split folder
    if (!fs.existsSync(splitDir)) {
      fs.mkdirSync(splitDir, { recursive: true });
    }

    let linesPerFile: number;
    if (options.mode === 'lines') {
      linesPerFile = options.value;
    } else {
      linesPerFile = Math.ceil(totalLines / options.value);
    }

    const numParts = Math.ceil(totalLines / linesPerFile);
    const createdFiles: string[] = [];
    const BATCH_SIZE = 10000;

    // First, generate all filenames
    const partFileNames: string[] = [];
    for (let i = 0; i < numParts; i++) {
      const partNum = String(i + 1).padStart(String(numParts).length, '0');
      partFileNames.push(`${baseName}_part${partNum}${ext}`);
    }

    for (let part = 0; part < numParts; part++) {
      const startLine = part * linesPerFile;
      const endLine = Math.min(startLine + linesPerFile, totalLines);
      const partFileName = partFileNames[part];
      const partFilePath = path.join(splitDir, partFileName);

      // Build hidden header with navigation info (viewer will skip this line)
      const prevFile = part > 0 ? partFileNames[part - 1] : '';
      const nextFile = part < numParts - 1 ? partFileNames[part + 1] : '';
      const header = `#SPLIT:part=${part + 1},total=${numParts},prev=${prevFile},next=${nextFile}\n`;

      // Write in batches to handle large parts
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(partFilePath, { encoding: 'utf-8' });

        writeStream.on('finish', resolve);
        writeStream.on('error', reject);

        // Write header first (will be hidden by viewer)
        writeStream.write(header);

        for (let batchStart = startLine; batchStart < endLine; batchStart += BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE, endLine);
          const lines = handler.getLines(batchStart, batchEnd - batchStart);
          const content = lines.map(l => l.text).join('\n');
          writeStream.write(batchStart > startLine ? '\n' + content : content);
        }

        writeStream.end();
      });

      createdFiles.push(partFilePath);

      // Report progress
      const progress = Math.round(((part + 1) / numParts) * 100);
      mainWindow?.webContents.send('split-progress', { percent: progress, currentPart: part + 1, totalParts: numParts });
    }

    return { success: true, outputDir: splitDir, files: createdFiles, partCount: numParts };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Format JSON File (streaming - handles any file size) ===

function streamFormatJson(inputPath: string, outputPath: string, onProgress?: (percent: number) => void): Promise<void> {
  const isJsonl = /\.jsonl$|\.ndjson$/i.test(inputPath);

  return new Promise((resolve, reject) => {
    const stats = fs.statSync(inputPath);
    const fileSize = stats.size;

    const readStream = fs.createReadStream(inputPath, { encoding: 'utf-8', highWaterMark: 1024 * 1024 });
    const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

    let bytesRead = 0;
    let lastProgressPercent = 0;
    let outputBuffer = '';
    const FLUSH_SIZE = 256 * 1024;

    const flush = () => {
      if (outputBuffer.length > 0) {
        writeStream.write(outputBuffer);
        outputBuffer = '';
      }
    };

    const write = (s: string) => {
      outputBuffer += s;
      if (outputBuffer.length >= FLUSH_SIZE) flush();
    };

    const reportProgress = (bytes: number) => {
      bytesRead += bytes;
      const percent = Math.min(99, Math.round((bytesRead / fileSize) * 100));
      if (percent > lastProgressPercent) {
        lastProgressPercent = percent;
        if (onProgress) onProgress(percent);
      }
    };

    // Shallow JSON formatter: expands only top-level keys to one line each,
    // keeping nested values compact. Limits line explosion for large JSONL files.
    const shallowFormat = (obj: any): string => {
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        return JSON.stringify(obj);
      }
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';
      const lines = ['{'];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const val = JSON.stringify(obj[k]);
        const comma = i < keys.length - 1 ? ',' : '';
        lines.push(`  ${JSON.stringify(k)}: ${val}${comma}`);
      }
      lines.push('}');
      return lines.join('\n');
    };

    if (isJsonl) {
      // JSONL: format each line with shallow expansion (top-level keys only)
      let lineBuffer = '';

      readStream.on('data', (rawChunk: string | Buffer) => {
        const chunk = typeof rawChunk === 'string' ? rawChunk : rawChunk.toString('utf-8');
        reportProgress(Buffer.byteLength(chunk, 'utf-8'));

        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { write('\n'); continue; }
          try {
            const obj = JSON.parse(trimmed);
            write(shallowFormat(obj) + '\n');
          } catch {
            write(trimmed + '\n');
          }
        }
      });

      readStream.on('end', () => {
        const trimmed = lineBuffer.trim();
        if (trimmed) {
          try {
            const obj = JSON.parse(trimmed);
            write(shallowFormat(obj) + '\n');
          } catch {
            write(trimmed + '\n');
          }
        }
        flush();
        writeStream.end(() => {
          if (onProgress) onProgress(100);
          resolve();
        });
      });
    } else {
      // Single JSON document — streaming character-by-character formatter
      let inString = false;
      let escaped = false;
      let depth = 0;
      let afterOpenOrComma = false;

      const indent = (d: number) => '  '.repeat(d);

      readStream.on('data', (rawChunk: string | Buffer) => {
        const chunk = typeof rawChunk === 'string' ? rawChunk : rawChunk.toString('utf-8');
        reportProgress(Buffer.byteLength(chunk, 'utf-8'));

        for (let i = 0; i < chunk.length; i++) {
          const char = chunk[i];

          if (escaped) {
            write(char);
            escaped = false;
            continue;
          }

          if (inString) {
            if (char === '\\') { escaped = true; }
            else if (char === '"') { inString = false; }
            write(char);
            continue;
          }

          if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue;

          if (char === '"') {
            if (afterOpenOrComma) { write('\n' + indent(depth)); afterOpenOrComma = false; }
            write(char);
            inString = true;
            continue;
          }

          if (char === '{' || char === '[') {
            if (afterOpenOrComma) { write('\n' + indent(depth)); afterOpenOrComma = false; }
            write(char);
            depth++;
            afterOpenOrComma = true;
            continue;
          }

          if (char === '}' || char === ']') {
            afterOpenOrComma = false;
            depth = Math.max(0, depth - 1);
            write('\n' + indent(depth) + char);
            continue;
          }

          if (char === ',') {
            write(char);
            afterOpenOrComma = true;
            continue;
          }

          if (char === ':') {
            write(': ');
            continue;
          }

          if (afterOpenOrComma) { write('\n' + indent(depth)); afterOpenOrComma = false; }
          write(char);
        }
      });

      readStream.on('end', () => {
        write('\n');
        flush();
        writeStream.end(() => {
          if (onProgress) onProgress(100);
          resolve();
        });
      });
    }

    readStream.on('error', (err) => {
      writeStream.destroy();
      reject(err);
    });

    writeStream.on('error', (err) => {
      readStream.destroy();
      reject(err);
    });
  });
}

ipcMain.handle('format-json-file', async (_, filePath: string) => {
  try {
    const stats = fs.statSync(filePath);
    console.log(`[JSON Format] File size: ${stats.size} bytes`);

    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath);
    const formattedPath = path.join(dir, `${baseName}.formatted${ext}`);

    // For very large files, warn about size limits
    const MAX_FORMATTED_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB

    await streamFormatJson(filePath, formattedPath, (percent) => {
      mainWindow?.webContents.send('json-format-progress', { percent });
    });

    const writtenStats = fs.statSync(formattedPath);

    if (writtenStats.size > MAX_FORMATTED_SIZE) {
      // Clean up - file too large to index efficiently
      try { fs.unlinkSync(formattedPath); } catch { /* ignore */ }
      return { success: false, error: `Formatted output is too large (${(writtenStats.size / 1024 / 1024 / 1024).toFixed(1)} GB). The file has too many nested elements to reformat in-app. Try using the integrated terminal: jq . "${path.basename(filePath)}" > formatted.json` };
    }

    return { success: true, formattedPath };
  } catch (error) {
    console.error(`[JSON Format] Error:`, error);
    return { success: false, error: String(error) };
  }
});

// Manually decode a binary esotrace/vtrace file to normalized text, on demand.
// This is the explicit counterpart to the auto-detecting VtraceAdapter, which only
// fires when a file BOTH ends in `.esotrace` AND carries the `traceserverIVI` magic
// in its first 4 KB. The button force-runs the SAME decoder (parseVtraceToFile) on
// the current file regardless of extension, so a renamed capture — or a file whose
// magic sits past the detection head — still decodes. parseVtraceToFile throws when
// the file has no traceserverIVI record anywhere, which surfaces as a clean error.
ipcMain.handle('decode-esotrace-file', async (_, filePath: string) => {
  try {
    const baseName = path.basename(filePath, path.extname(filePath));
    // Write to a temp `.txt` so it indexes as plain text and does NOT re-trigger the
    // vtrace adapter (which needs a `.esotrace` extension). The `.decoded.` marker in
    // the name tells the renderer to keep the "decoded" toggle active across reload.
    const decodedPath = path.join(
      os.tmpdir(),
      `${baseName}.decoded.${process.pid}-${Date.now().toString(36)}.txt`
    );
    await parseVtraceToFile(filePath, decodedPath, (percent) => {
      mainWindow?.webContents.send('esotrace-decode-progress', { percent });
    });
    return { success: true, decodedPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Batch-decode every esotrace/vtrace file in a folder (right-click → "Decode
// esotrace files here"). Non-recursive: the folder's direct files only. Detection
// is extension-agnostic like the single-file button — a file qualifies if it ends
// in `.esotrace` OR carries the `traceserverIVI` magic in its head — so renamed
// captures are caught too. Each decode is written next to the original as
// `<name>.decoded.txt` (persistent, unlike the single-file temp). Prior outputs
// (name contains `.decoded.`) are skipped so re-runs are idempotent.
ipcMain.handle('decode-esotrace-folder', async (_, folderPath: string) => {
  try {
    const IDENTITY = Buffer.from('traceserverIVI', 'latin1');
    const names = await fs.promises.readdir(folderPath);

    // Find candidate esotrace files (by extension or magic bytes).
    const candidates: string[] = [];
    for (const name of names) {
      if (name.startsWith('.')) continue;
      if (name.includes('.decoded.')) continue; // don't re-decode our own output
      const full = path.join(folderPath, name);
      let st: fs.Stats;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      let isEso = /\.esotrace$/i.test(name);
      if (!isEso && st.size > 0) {
        // Sniff the head for the identity marker so non-.esotrace captures qualify.
        let fd: number | null = null;
        try {
          fd = fs.openSync(full, 'r');
          const len = Math.min(4096, st.size);
          const head = Buffer.alloc(len);
          fs.readSync(fd, head, 0, len, 0);
          isEso = head.includes(IDENTITY);
        } catch { isEso = false; } finally { if (fd !== null) fs.closeSync(fd); }
      }
      if (isEso) candidates.push(full);
    }

    const decoded: Array<{ original: string; decoded: string }> = [];
    const errors: Array<{ file: string; error: string }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const src = candidates[i];
      // Keep the original extension in the output name so `a.esotrace` and `a.bin`
      // can't collide on the same `.decoded.txt`.
      const outPath = path.join(folderPath, `${path.basename(src)}.decoded.txt`);
      mainWindow?.webContents.send('esotrace-decode-folder-progress', {
        current: i, total: candidates.length, name: path.basename(src),
      });
      try {
        await parseVtraceToFile(src, outPath);
        decoded.push({ original: src, decoded: outPath });
      } catch (e) {
        errors.push({ file: src, error: String(e) });
      }
      // Let the event loop breathe between files so progress paints and the UI
      // stays responsive (each decode itself runs on the main thread).
      await new Promise<void>((r) => setImmediate(r));
    }
    mainWindow?.webContents.send('esotrace-decode-folder-progress', {
      current: candidates.length, total: candidates.length, name: '',
    });

    return { success: true, folderPath, scanned: names.length, candidates: candidates.length, decoded, errors };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// ── Multi-file time-sync (merge N logs onto one wall-clock timeline) ──────────
// Deterministic, no AI: read each file's per-line timestamp with the SAME
// parseTimestampFast the rest of LOGAN uses, keep only lines that carry a
// wall-clock timestamp (the sync key), and merge-sort every file's lines by epoch
// ms. Binary companions (.esotrace/.mf4) are opened through openWithAdapter so they
// decode to timestamped text first. Returns per-file coverage stats + a bounded,
// time-ordered (or evenly time-sampled) row set the renderer paints as one stream.
ipcMain.handle('time-sync-merge', async (_, filePaths: string[], opts?: { maxRows?: number }) => {
  try {
    const maxRows = Math.max(100, Math.min(20000, opts?.maxRows ?? 4000));
    const SCAN_CAP = 1_000_000;   // max lines scanned per file
    const COLLECT_CAP = 800_000;  // max timestamped entries held before sort
    const BATCH = 4000;

    // Resolve a FileHandler per path: reuse the cache, else open through the adapter
    // layer (so binary formats normalize to text) and cache it for click-through.
    const handlers: (FileHandler | null)[] = [];
    for (const fp of filePaths) {
      let h = fileHandlerCache.get(fp);
      if (h && h.isStale()) { evictFromCache(fp); h = undefined; }
      if (!h) {
        try {
          const nh = new FileHandler();
          const opened = await openWithAdapter(nh, fp, () => {});
          sourceRegistry.set(fp, opened.source);
          addToCache(fp, nh);
          h = nh;
        } catch {
          handlers.push(null);
          continue;
        }
      }
      handlers.push(h);
    }

    const fileStats = filePaths.map((p, i) => ({
      path: p, index: i, totalLines: 0, timestamped: 0,
      firstMs: null as number | null, lastMs: null as number | null, scanCapped: false,
    }));

    // Lightweight collection (no text yet) so millions of lines stay cheap.
    const entries: { f: number; ln: number; ms: number }[] = [];
    let collectCapped = false;

    for (let fi = 0; fi < handlers.length; fi++) {
      const h = handlers[fi];
      if (!h) continue;
      const total = h.getTotalLines();
      fileStats[fi].totalLines = total;
      const scanTo = Math.min(total, SCAN_CAP);
      if (total > SCAN_CAP) fileStats[fi].scanCapped = true;
      for (let start = 0; start < scanTo && !collectCapped; start += BATCH) {
        const batch = h.getLines(start, Math.min(BATCH, scanTo - start));
        for (const line of batch) {
          const parsed = parseTimestampFast(line.text);
          if (!parsed) continue;
          const ms = parsed.date.getTime();
          fileStats[fi].timestamped++;
          if (fileStats[fi].firstMs === null) fileStats[fi].firstMs = ms;
          fileStats[fi].lastMs = ms;
          if (entries.length < COLLECT_CAP) entries.push({ f: fi, ln: line.lineNumber, ms });
          else { collectCapped = true; break; }
        }
      }
    }

    // Merge by time; deterministic tie-break by file then line.
    entries.sort((a, b) => a.ms - b.ms || a.f - b.f || a.ln - b.ln);

    const totalSynced = entries.length;
    let selected = entries;
    let sampled = false;
    if (entries.length > maxRows) {
      sampled = true;
      const step = entries.length / maxRows;
      selected = [];
      for (let k = 0; k < maxRows; k++) selected.push(entries[Math.floor(k * step)]);
    }

    // Fetch text only for the rows we actually return.
    const rows = selected.map((e) => {
      const h = handlers[e.f];
      let text = '';
      if (h) { const ls = h.getLines(e.ln, 1); if (ls.length) text = ls[0].text; }
      return { f: e.f, ln: e.ln, ms: e.ms, text };
    });

    const withTs = fileStats.filter(s => s.firstMs !== null);
    const minMs = withTs.length ? Math.min(...withTs.map(s => s.firstMs as number)) : null;
    const maxMs = withTs.length ? Math.max(...withTs.map(s => s.lastMs as number)) : null;

    return {
      success: true,
      files: fileStats,
      overall: { minMs, maxMs, totalSynced, returned: rows.length, sampled, collectCapped },
      rows,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Merge multiple files → one new, time-ordered file with an origin column ===
// The write-to-disk counterpart of time-sync-merge: instead of a sampled preview,
// it interleaves EVERY line of every file in wall-clock order and streams the
// result to a user-chosen file. Each emitted line is:
//     <normalized timestamp> | <origin> | <original line>
// Untimestamped lines inherit the previous timestamp (carry-forward) so multi-line
// entries (stack traces, wrapped messages) stay intact and adjacent to their anchor.
// The collected + time-sorted result of interleaving N files onto one wall-clock
// timeline. `handlers`/`tags` are parallel to the input paths; `entries` is the
// global order. Shared by the human "Merge to file" IPC and the agent
// logan_single_session order:"wallclock" path — one engine, two callers.
interface CollectedTimeline {
  handlers: (FileHandler | null)[];
  tags: string[];
  entries: MergeEntry[];        // interleaved, time-sorted (sortMergeEntries)
  contributed: Set<number>;     // file indices that actually placed lines
  skipped: string[];            // human-readable reasons per skipped file
  minMs: number;
  maxMs: number;
  collectCapped: boolean;       // hit the 3M-line collect ceiling
  scanCapped: boolean;          // a file exceeded the 3M-line scan ceiling
}

// Open each file, collect every line with an effective (carry-forward) wall-clock
// timestamp, and interleave them into one time-sorted order. No file is written.
// Returns an error when nothing is placeable (e.g. no timestamps anywhere).
async function collectMergeTimeline(
  filePaths: string[],
): Promise<{ ok: true; data: CollectedTimeline } | { ok: false; error: string }> {
  const SCAN_CAP = 3_000_000;    // max lines scanned per file
  const COLLECT_CAP = 3_000_000; // max lines held before the sort
  const BATCH = 8000;

  // Resolve a FileHandler per path: reuse the cache, else open through the
  // adapter layer (so binary formats normalize to text) and cache it.
  const handlers: (FileHandler | null)[] = [];
  for (const fp of filePaths) {
    let h = fileHandlerCache.get(fp);
    if (h && h.isStale()) { evictFromCache(fp); h = undefined; }
    if (!h) {
      try {
        const nh = new FileHandler();
        const opened = await openWithAdapter(nh, fp, () => {});
        sourceRegistry.set(fp, opened.source);
        addToCache(fp, nh);
        h = nh;
      } catch { handlers.push(null); continue; }
    }
    handlers.push(h);
  }

  const tags = buildOriginTags(filePaths);
  const entries: MergeEntry[] = [];
  const skipped: string[] = [];
  const contributed = new Set<number>();
  let collectCapped = false;
  let scanCapped = false;

  for (let fi = 0; fi < handlers.length; fi++) {
    const h = handlers[fi];
    if (!h) { skipped.push(`${tags[fi]} (couldn't open)`); continue; }
    const total = h.getTotalLines();
    const scanTo = Math.min(total, SCAN_CAP);
    if (total > SCAN_CAP) scanCapped = true;

    // Collect the file's lines with their raw (possibly-null) timestamps.
    const lns: number[] = [];
    const msRaw: (number | null)[] = [];
    let tsCount = 0;
    for (let start = 0; start < scanTo && !collectCapped; start += BATCH) {
      const batch = h.getLines(start, Math.min(BATCH, scanTo - start));
      for (const line of batch) {
        const parsed = parseTimestampFast(line.text);
        const ms = parsed ? parsed.date.getTime() : null;
        if (ms !== null) tsCount++;
        lns.push(line.lineNumber);
        msRaw.push(ms);
      }
    }
    if (tsCount === 0) { skipped.push(`${tags[fi]} (no timestamps)`); continue; }

    // Fill untimestamped lines by carry-forward, then queue every line.
    const eff = carryForwardTimestamps(msRaw);
    for (let i = 0; i < eff.length; i++) {
      const ms = eff[i];
      if (ms === null) continue;
      if (entries.length >= COLLECT_CAP) { collectCapped = true; break; }
      entries.push({ f: fi, ln: lns[i], ms });
      contributed.add(fi);
    }
    if (collectCapped) break;
  }

  if (entries.length === 0) {
    return { ok: false, error: 'No timestamped lines to merge' + (skipped.length ? ` — skipped: ${skipped.join(', ')}` : '') };
  }

  // Stable merge by time; tie-break by file then line keeps each file's own
  // order (and carried-forward continuation lines) intact.
  sortMergeEntries(entries);
  return {
    ok: true,
    data: { handlers, tags, entries, contributed, skipped, minMs: entries[0].ms, maxMs: entries[entries.length - 1].ms, collectCapped, scanCapped },
  };
}

// Stream a collected timeline to `outPath` as `<timestamp>SEP<origin>SEP<line>`,
// with an optional provenance header. Returns the number of lines written.
function writeMergeEntriesToFile(
  outPath: string,
  filePaths: string[],
  c: CollectedTimeline,
  opts?: { includeHeader?: boolean; separator?: string },
): number {
  const SEP = typeof opts?.separator === 'string' ? opts.separator : ' | ';
  const includeHeader = opts?.includeHeader !== false;
  const { handlers, tags, entries, contributed, skipped, minMs, maxMs } = c;
  const padWidth = tags.reduce((m, t, i) => (contributed.has(i) ? Math.max(m, t.length) : m), 0);
  const fd = fs.openSync(outPath, 'w');
  let written = 0;
  try {
    let buf = '';
    const flush = () => { if (buf) { fs.writeSync(fd, buf); buf = ''; } };
    const emit = (s: string) => { buf += s + '\n'; if (buf.length >= SAVE_RANGE_FLUSH_CHARS) flush(); };

    if (includeHeader) {
      emit(`# LOGAN merged timeline · ${contributed.size} files · ${entries.length.toLocaleString('en-US')} lines · ${formatWallClock(minMs)} → ${formatWallClock(maxMs)}`);
      for (let i = 0; i < filePaths.length; i++) {
        if (contributed.has(i)) emit(`#   ${tags[i]} ⟵ ${filePaths[i]}`);
      }
      if (skipped.length) emit(`#   skipped: ${skipped.join(', ')}`);
      emit(`# format: <timestamp>${SEP}<origin>${SEP}<original line>`);
    }

    for (const e of entries) {
      const h = handlers[e.f];
      let text = '';
      if (h) { const ls = h.getLines(e.ln, 1); if (ls.length) text = ls[0].text; }
      emit(`${formatWallClock(e.ms)}${SEP}${tags[e.f].padEnd(padWidth)}${SEP}${text}`);
      written++;
    }
    flush();
  } finally {
    fs.closeSync(fd);
  }
  return written;
}

ipcMain.handle('merge-files-to-file', async (_, filePaths: string[], opts?: { includeHeader?: boolean; separator?: string }) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length < 1) {
      return { success: false, error: 'Add at least one file to merge' };
    }
    const collected = await collectMergeTimeline(filePaths);
    if (!collected.ok) return { success: false, error: collected.error };
    const c = collected.data;

    // Ask where to write; default next to the first file.
    const firstDir = path.dirname(filePaths[0]);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const dialogRes = await showSaveDialog({
      title: 'Save merged timeline',
      defaultPath: path.join(firstDir, `merged-timeline_${stamp}.log`),
      filters: [{ name: 'Log', extensions: ['log', 'txt'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (dialogRes.canceled || !dialogRes.filePath) return { success: false, error: 'Cancelled' };
    const outPath = dialogRes.filePath;

    const written = writeMergeEntriesToFile(outPath, filePaths, c, opts);
    if (currentFilePath) logActivity(currentFilePath, 'files_merged', { files: c.contributed.size, lines: written });

    return {
      success: true,
      filePath: outPath,
      lineCount: written,
      fileCount: c.contributed.size,
      minMs: c.minMs,
      maxMs: c.maxMs,
      skipped: c.skipped,
      collectCapped: c.collectCapped,
      scanCapped: c.scanCapped,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// === Terminal (tabbed, multi-session) ===

interface TerminalSession {
  id: string;
  type: 'local' | 'ssh';
  label: string;
  ptyProcess?: any;
  sshStream?: any;
  borrowedClient?: boolean; // true = live connection's client, don't close
  ownedClient?: any;     // standalone SSH, close on kill
  cols: number;
  rows: number;
}

const terminalSessions = new Map<string, TerminalSession>();

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

ipcMain.handle(IPC.TERMINAL_CREATE_LOCAL, async (_, sessionId: string, options?: { cwd?: string; cols?: number; rows?: number }) => {
  try {
    const shellPath = getDefaultShell();
    const cwd = options?.cwd || os.homedir();
    const cols = options?.cols || 80;
    const rows = options?.rows || 24;

    if (pty) {
      // Full PTY via node-pty (macOS/Windows)
      const proc = pty.spawn(shellPath, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as { [key: string]: string },
      });

      const session: TerminalSession = {
        id: sessionId,
        type: 'local',
        label: 'Local',
        ptyProcess: proc,
        cols,
        rows,
      };
      terminalSessions.set(sessionId, session);

      proc.onData((data: string) => {
        mainWindow?.webContents.send(IPC.TERMINAL_DATA, sessionId, data);
      });

      proc.onExit(({ exitCode }) => {
        mainWindow?.webContents.send(IPC.TERMINAL_EXIT, sessionId, exitCode);
        terminalSessions.delete(sessionId);
      });

      return { success: true, label: 'Local' };
    }

    // Fallback (no node-pty): spawn the shell directly as a child process.
    // On Linux, wrap with `script` for PTY emulation when available.
    // On Windows, cmd.exe / powershell work fine without PTY wrapping.
    const env = { ...process.env, TERM: 'xterm-256color', COLUMNS: String(cols), LINES: String(rows) };
    let scriptCmd: string;
    let scriptArgs: string[];
    if (process.platform === 'win32') {
      scriptCmd = shellPath;
      scriptArgs = [];
    } else {
      try {
        execSync('which script', { timeout: 1000 });
        scriptCmd = 'script';
        scriptArgs = ['-qfc', shellPath, '/dev/null'];
      } catch {
        scriptCmd = shellPath;
        scriptArgs = ['-i'];
      }
    }
    const child = spawn(scriptCmd, scriptArgs, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });

    // Wrap child process to match pty interface used by session handlers
    const procShim = {
      write: (data: string) => child.stdin?.write(data),
      resize: (_c: number, _r: number) => { /* no-op for pipe-based shell */ },
      kill: () => child.kill(),
    };

    const session: TerminalSession = {
      id: sessionId,
      type: 'local',
      label: 'Local',
      ptyProcess: procShim,
      cols,
      rows,
    };
    terminalSessions.set(sessionId, session);

    child.stdout?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send(IPC.TERMINAL_DATA, sessionId, data.toString());
    });
    child.stderr?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send(IPC.TERMINAL_DATA, sessionId, data.toString());
    });
    child.on('exit', (exitCode) => {
      mainWindow?.webContents.send(IPC.TERMINAL_EXIT, sessionId, exitCode ?? 0);
      terminalSessions.delete(sessionId);
    });

    return { success: true, label: 'Local' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.TERMINAL_CREATE_SSH, async (_, sessionId: string, options: {
  liveConnectionId?: string;
  savedConnectionId?: string;
  sshConfig?: { host: string; port: number; username: string; identityFile?: string; passphrase?: string };
  cols?: number;
  rows?: number;
}) => {
  try {
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    let stream: any;
    let label: string;
    let borrowedClient = false;
    let ownedClient: any;

    if (options.liveConnectionId) {
      // Borrow client from live connection
      const conn = liveConnections.get(options.liveConnectionId);
      if (!conn || conn.source !== 'ssh' || !conn.connected) {
        return { success: false, error: 'SSH live connection not found or not connected' };
      }
      const handler = conn.handler as any;
      if (!handler.isClientConnected()) {
        return { success: false, error: 'SSH client not connected' };
      }
      stream = await handler.openShell(cols, rows);
      label = conn.displayName || 'SSH';
      borrowedClient = true;
    } else if (options.savedConnectionId) {
      // Load saved connection config
      const saved = loadSavedConnections().find(c => c.id === options.savedConnectionId);
      if (!saved || saved.source !== 'ssh') {
        return { success: false, error: 'Saved SSH connection not found' };
      }
      const cfg = saved.config;
      const result = await createStandaloneSshShell(cfg, cols, rows);
      stream = result.stream;
      ownedClient = result.client;
      label = saved.name || cfg.host || 'SSH';
      // Update lastUsedAt
      saved.lastUsedAt = Date.now();
      persistSavedConnections(loadSavedConnections().map(c => c.id === saved.id ? saved : c));
    } else if (options.sshConfig) {
      const result = await createStandaloneSshShell(options.sshConfig, cols, rows);
      stream = result.stream;
      ownedClient = result.client;
      label = `${options.sshConfig.username}@${options.sshConfig.host}`;
    } else {
      return { success: false, error: 'No SSH connection source specified' };
    }

    const session: TerminalSession = {
      id: sessionId,
      type: 'ssh',
      label,
      sshStream: stream,
      borrowedClient,
      ownedClient,
      cols,
      rows,
    };
    terminalSessions.set(sessionId, session);

    stream.on('data', (chunk: Buffer) => {
      mainWindow?.webContents.send(IPC.TERMINAL_DATA, sessionId, chunk.toString('utf-8'));
    });

    stream.on('close', () => {
      mainWindow?.webContents.send(IPC.TERMINAL_EXIT, sessionId, 0);
      if (session.ownedClient) {
        try { session.ownedClient.end(); } catch { /* */ }
      }
      terminalSessions.delete(sessionId);
    });

    return { success: true, label };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

async function createStandaloneSshShell(
  config: { host: string; port: number; username: string; identityFile?: string; passphrase?: string },
  cols: number,
  rows: number
): Promise<{ client: any; stream: any }> {
  if (!SshClient) throw new Error('SSH not available (ssh2 not installed)');
  const client = new SshClient();

  const connectConfig: any = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    readyTimeout: 10000,
  };

  if (process.env.SSH_AUTH_SOCK) {
    connectConfig.agent = process.env.SSH_AUTH_SOCK;
  }

  const keyPaths: string[] = [];
  if (config.identityFile && fs.existsSync(config.identityFile)) {
    keyPaths.push(config.identityFile);
  }
  const defaultKeys = [
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    path.join(os.homedir(), '.ssh', 'id_rsa'),
  ];
  for (const k of defaultKeys) {
    if (fs.existsSync(k) && !keyPaths.includes(k)) keyPaths.push(k);
  }
  if (keyPaths.length > 0) {
    try {
      connectConfig.privateKey = fs.readFileSync(keyPaths[0]);
      if (config.passphrase) connectConfig.passphrase = config.passphrase;
    } catch { /* fall through to agent auth */ }
  }

  return new Promise((resolve, reject) => {
    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err: Error | undefined, stream: any) => {
        if (err) { client.end(); return reject(err); }
        resolve({ client, stream });
      });
    });
    client.on('error', (err: any) => {
      reject(err);
    });
    client.connect(connectConfig);
  });
}

ipcMain.handle(IPC.TERMINAL_WRITE, async (_, sessionId: string, data: string) => {
  const session = terminalSessions.get(sessionId);
  if (!session) return { success: false, error: 'Session not found' };
  if (session.ptyProcess) {
    session.ptyProcess.write(data);
    return { success: true };
  }
  if (session.sshStream) {
    session.sshStream.write(data);
    return { success: true };
  }
  return { success: false, error: 'No process/stream' };
});

ipcMain.handle(IPC.TERMINAL_RESIZE, async (_, sessionId: string, cols: number, rows: number) => {
  const session = terminalSessions.get(sessionId);
  if (!session) return { success: false, error: 'Session not found' };
  session.cols = cols;
  session.rows = rows;
  if (session.ptyProcess) {
    session.ptyProcess.resize(cols, rows);
    return { success: true };
  }
  if (session.sshStream) {
    try { session.sshStream.setWindow(rows, cols, 0, 0); } catch { /* some ssh2 versions */ }
    return { success: true };
  }
  return { success: false, error: 'No process/stream' };
});

ipcMain.handle(IPC.TERMINAL_KILL, async (_, sessionId: string) => {
  const session = terminalSessions.get(sessionId);
  if (!session) return { success: false, error: 'Session not found' };
  if (session.ptyProcess) {
    session.ptyProcess.kill();
  }
  if (session.sshStream) {
    try { session.sshStream.close(); } catch { /* */ }
  }
  if (session.ownedClient) {
    try { session.ownedClient.end(); } catch { /* */ }
  }
  terminalSessions.delete(sessionId);
  return { success: true };
});

// === Datadog Integration ===

let datadogFetchSignal: { cancelled: boolean } = { cancelled: false };

ipcMain.handle(IPC.DATADOG_LOAD_CONFIG, async () => {
  const config = loadDatadogConfig();
  if (config) {
    // Return config but mask the keys for display
    return { success: true, config: { site: config.site, hasApiKey: !!config.apiKey, hasAppKey: !!config.appKey } };
  }
  return { success: true, config: null };
});

ipcMain.handle(IPC.DATADOG_SAVE_CONFIG, async (_, config: DatadogConfig | null) => {
  try {
    if (config === null) {
      clearDatadogConfig();
    } else {
      saveDatadogConfig(config);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.DATADOG_FETCH_LOGS, async (_, params: DatadogFetchParams) => {
  const config = loadDatadogConfig();
  if (!config || !config.apiKey || !config.appKey) {
    return { success: false, error: 'Datadog not configured. Add credentials in Settings.' };
  }

  datadogFetchSignal = { cancelled: false };

  const result = await fetchDatadogLogs(
    config,
    params,
    (message, count) => {
      mainWindow?.webContents.send(IPC.DATADOG_FETCH_PROGRESS, { message, count });
    },
    datadogFetchSignal
  );

  return result;
});

ipcMain.handle(IPC.DATADOG_CANCEL_FETCH, async () => {
  datadogFetchSignal.cancelled = true;
  return { success: true };
});

// === Local File Status & Activity History ===

ipcMain.handle(IPC.GET_LOCAL_FILE_STATUS, async () => {
  if (!currentFilePath) return { exists: false, writable: false, localPath: null };
  const writable = canWriteLocal(currentFilePath);
  const localPath = getLocalFilePath(currentFilePath);
  const exists = writable && fs.existsSync(localPath);
  return { exists, writable, localPath };
});

ipcMain.handle(IPC.LOAD_ACTIVITY_HISTORY, async () => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const data = loadLocalFileData(currentFilePath);
  return { success: true, history: data.activityHistory };
});

ipcMain.handle(IPC.CLEAR_ACTIVITY_HISTORY, async () => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const data = loadLocalFileData(currentFilePath);
  data.activityHistory = [];
  saveLocalFileData(currentFilePath, data);
  return { success: true };
});

// Notes drawer — load/save freeform notes from .logan/<filename>.notes.txt
ipcMain.handle('load-notes', async () => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  const notesPath = path.join(getLocalLoganDir(currentFilePath),
    path.basename(currentFilePath) + '.notes.txt');
  try {
    const content = fs.readFileSync(notesPath, 'utf-8');
    return { success: true, content };
  } catch {
    return { success: true, content: '' };
  }
});

ipcMain.handle('save-notes', async (_e: any, content: string) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  if (!ensureLocalLoganDir(currentFilePath)) {
    return { success: false, error: 'Cannot write to local .logan/ directory' };
  }
  const notesPath = path.join(getLocalLoganDir(currentFilePath),
    path.basename(currentFilePath) + '.notes.txt');
  fs.writeFileSync(notesPath, content, 'utf-8');
  return { success: true };
});

ipcMain.handle('save-notes-as', async (_e: any, content: string) => {
  if (!mainWindow) return { success: false, error: 'No window' };
  const result = await showSaveDialog({
    title: 'Save Notes As',
    defaultPath: currentFilePath
      ? path.basename(currentFilePath) + '.notes.txt'
      : 'notes.txt',
    filters: [
      { name: 'Text Files', extensions: ['txt', 'md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return { success: false, error: 'Cancelled' };
  }
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return { success: true, filePath: result.filePath };
});

// Lazily load marked (ESM-only in v17) via a genuine dynamic import(). A static
// `import`/`require('marked')` compiles to require() under our CommonJS main build
// and throws "require() of ES Module …". The `new Function` wrapper preserves a
// real import() through TypeScript's CommonJS downleveling (which would otherwise
// rewrite import() → require()). Cached as a promise so it loads at most once.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
let markedPromise: Promise<{ parse: (md: string, opts?: any) => string }> | null = null;
function getMarked(): Promise<{ parse: (md: string, opts?: any) => string }> {
  if (!markedPromise) markedPromise = dynamicImport('marked');
  return markedPromise;
}

// Wrap the notes (treated as Markdown) in a print-styled HTML document.
async function notesToHtml(md: string, title: string): Promise<string> {
  const marked = await getMarked();
  const bodyHtml = marked.parse(md && md.trim() ? md : '_(empty notes)_', { async: false }) as string;
  const safeTitle = String(title).replace(/[<>&]/g, '');
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 1.6cm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px; line-height: 1.5; color: #1a1a1a; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.1em 0 0.5em; }
  h1 { font-size: 20px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h2 { font-size: 16px; } h3 { font-size: 14px; }
  p, li { font-size: 12px; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; background: #f2f2f4; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f2f2f4; padding: 10px 12px; border-radius: 5px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0.6em 0; padding: 2px 12px; border-left: 3px solid #ccc; color: #555; }
  table { border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 4px 8px; font-size: 11px; }
  a { color: #2a6ad6; }
  img { max-width: 100%; }
  .notes-doc-header { color: #888; font-size: 10px; margin-bottom: 14px; }
</style></head>
<body>
  <div class="notes-doc-header">${safeTitle} · exported from LOGAN</div>
  ${bodyHtml}
</body></html>`;
}

// Render an HTML string to a PDF Buffer via a hidden window + printToPDF. Uses a
// temp file (not a data URL) so arbitrarily large notes don't hit URL limits.
async function renderNotesPdf(html: string): Promise<Buffer> {
  const tmpPath = path.join(os.tmpdir(), `logan-notes-${Date.now()}-${Math.floor(Math.random() * 1e6)}.html`);
  fs.writeFileSync(tmpPath, html, 'utf-8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await win.loadFile(tmpPath);
    await new Promise((r) => setTimeout(r, 150)); // let layout/fonts settle
    return await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// Export notes as Markdown (verbatim) or PDF (rendered), via a native save dialog.
ipcMain.handle('notes-export', async (_e: any, content: string, format: 'md' | 'pdf') => {
  if (!mainWindow) return { success: false, error: 'No window' };
  if (!content || !content.trim()) return { success: false, error: 'Notes are empty' };

  const base = currentFilePath ? path.basename(currentFilePath) : 'notes';
  const ext = format === 'pdf' ? 'pdf' : 'md';
  const result = await showSaveDialog({
    title: `Export Notes as ${ext.toUpperCase()}`,
    defaultPath: `${base}.notes.${ext}`,
    filters: format === 'pdf'
      ? [{ name: 'PDF', extensions: ['pdf'] }]
      : [{ name: 'Markdown', extensions: ['md'] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };

  try {
    if (format === 'pdf') {
      const pdf = await renderNotesPdf(await notesToHtml(content, base));
      fs.writeFileSync(result.filePath, pdf);
    } else {
      fs.writeFileSync(result.filePath, content, 'utf-8');
    }
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Agent chat — user sends message from renderer
ipcMain.handle('agent-send-message', async (_e: any, text: string) => {
  const msg = addChatMessage('user', text);
  return { success: true, message: msg };
});

// Agent chat — get chat history
ipcMain.handle('agent-get-messages', async () => {
  return { success: true, messages: getChatMessages() };
});

// Agent connection status
ipcMain.handle('agent-get-status', async () => {
  return { connected: getSseClientCount() > 0, count: getSseClientCount(), name: getAgentName() };
});

// --- Built-in agent launch/stop ---

interface AgentConfig {
  type?: 'claude-code' | 'builtin' | 'custom' | 'local-llm';
  scriptPath?: string;
  model?: string;
  llmEndpoint?: string;
  llmModel?: string;
  agentName?: string;
}

function getAgentConfig(): AgentConfig {
  const configPath = path.join(os.homedir(), '.logan', 'agent-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Backwards compatibility: old configs only have scriptPath
    if (!config.type && config.scriptPath) config.type = 'custom';
    return config;
  } catch { /* no config */ }
  return { type: 'builtin' };
}

// True only when the user has explicitly set up an agent (via the setup wizard).
// Gate for auto-launching the agent on a `logan ./folder/` start — no config file
// means the user hasn't opted into an agent, so we don't spawn one behind their back.
function hasConfiguredAgent(): boolean {
  return fs.existsSync(path.join(os.homedir(), '.logan', 'agent-config.json'));
}

function getBuiltinScriptPath(): string {
  const devPath = path.join(app.getAppPath(), 'examples', 'agent-node.mjs');
  if (fs.existsSync(devPath)) return devPath;
  const pkgPath = path.join(path.dirname(app.getAppPath()), 'examples', 'agent-node.mjs');
  if (fs.existsSync(pkgPath)) return pkgPath;
  return devPath;
}

function findClaudeCli(): string | null {
  const whichCmd = process.platform === 'win32' ? 'where claude' : 'which claude';
  try {
    const result = execSync(whichCmd, { timeout: 3000, encoding: 'utf-8' }).trim().split('\n')[0];
    if (result) return result;
  } catch { /* not in PATH */ }
  const candidates = process.platform === 'win32'
    ? [
        path.join(os.homedir(), '.claude', 'bin', 'claude.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
      ]
    : [
        path.join(os.homedir(), '.claude', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
      ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function archiveAgentMemory(filePath: string | null): void {
  if (!filePath) return;
  try {
    const mem = getAgentMemory(filePath);
    if (!mem?.content) return;
    const dir = getLocalLoganDir(filePath);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(dir, `${path.basename(filePath)}.agent-memory.${ts}.archived.json`);
    fs.writeFileSync(archivePath, JSON.stringify({ ...mem, archivedAt: Date.now() }, null, 2));
    clearAgentMemory(filePath);
  } catch { /* ignore */ }
}

function buildAgentPrompt(): string {
  // When LOGAN was launched pointing at a folder, tell the agent to start working on it
  // (its cwd is set to that folder too — see launchAgentProcess) instead of just idling.
  const folderSection = contextFolder
    ? `\n\nLOGAN was launched pointing at this folder, which is also your working directory:
  ${contextFolder}
Start by surveying the log files in that folder (your own file tools — ls/glob — and
logan_status for anything already open). Then greet the user with logan_send_message,
briefly noting the folder and the notable logs you see, and either open the most relevant
one with logan_open_file and run logan_triage / logan_analyze, or ask which file to open.`
    : '';
  return `You are connected to LOGAN, a log analysis tool, via MCP.
Use logan_status to check the current state, then greet the user with logan_send_message.
Then enter a chat loop: call logan_wait_for_message to receive user messages, process them
using LOGAN's MCP tools (logan_search, logan_analyze, logan_filter, logan_get_lines, etc.),
and reply with logan_send_message. Continue until the user says goodbye or stop.

After completing each significant task, call logan_memory_write with a brief note of
what you found and what the user asked — this lets you resume naturally if you reconnect.${folderSection}`;
}

async function launchAgentProcess(isReconnect = false): Promise<{ success: boolean; agentName?: string; error?: string; resumed?: boolean }> {
  if (agentProcess) {
    return { success: false, error: 'Agent is already running' };
  }

  const config = getAgentConfig();
  const prompt = buildAgentPrompt();
  let resumed = false;

  if (!isReconnect) {
    // Fresh session: archive any existing memory so old notes don't bleed in
    archiveAgentMemory(currentFilePath);
  }

  try {
    if (config.type === 'claude-code') {
      const claudePath = findClaudeCli();
      if (!claudePath) {
        return { success: false, error: 'Claude Code CLI not found. Please install it or reconfigure.' };
      }
      const mcpConfig = {
        mcpServers: {
          logan: {
            command: 'node',
            args: [path.join(app.getAppPath(), 'dist', 'mcp-server', 'index.js')],
            cwd: app.getAppPath(),
          },
        },
      };
      const tmpMcpPath = path.join(os.tmpdir(), 'logan-claude-mcp.json');
      fs.writeFileSync(tmpMcpPath, JSON.stringify(mcpConfig));
      const args = ['--print', '--mcp-config', tmpMcpPath, '--permission-mode', 'bypassPermissions', '--strict-mcp-config'];
      if (config.model) args.push('--model', config.model);

      // Session continuity: on a fresh launch pin a session id; on a restart after
      // an idle disconnect, --resume that same id so Claude rehydrates the full
      // prior conversation instead of starting from a blank context.
      if (isReconnect && agentSessionId) {
        args.push('--resume', agentSessionId);
        resumed = true;
      } else {
        agentSessionId = randomUUID();
        args.push('--session-id', agentSessionId);
      }

      // On resume the conversation is restored, so we only nudge the agent to
      // re-read memory and re-enter the chat loop; on a fresh start, the full
      // bootstrap prompt sets everything up.
      const launchPrompt = resumed
        ? 'You have just reconnected to LOGAN after an idle disconnect — your previous conversation has been restored. Call logan_memory_read to refresh context if needed, briefly tell the user you are back and what you were working on, then resume the chat loop with logan_wait_for_message.'
        : prompt;
      args.push(launchPrompt);
      // If LOGAN was launched on a folder, run the agent IN that folder so its own
      // file tools (ls/glob/read) operate on the user's logs, not LOGAN's app dir.
      agentProcess = spawn(claudePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        cwd: contextFolder || undefined,
      });
    } else if (config.type === 'local-llm') {
      const llmScriptPath = path.join(app.getAppPath(), 'examples', 'agent-local-llm.mjs');
      if (!fs.existsSync(llmScriptPath)) return { success: false, error: `Local LLM agent script not found: ${llmScriptPath}` };
      agentProcess = spawn(process.execPath, [llmScriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LLM_ENDPOINT: config.llmEndpoint || 'http://localhost:11434/v1', LLM_MODEL: config.llmModel || 'llama3', AGENT_NAME: config.agentName || 'wolvie' },
      });
    } else if (config.type === 'custom' && config.scriptPath) {
      if (!fs.existsSync(config.scriptPath)) return { success: false, error: `Agent script not found: ${config.scriptPath}` };
      agentProcess = spawn(process.execPath, [config.scriptPath], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    } else {
      const scriptPath = getBuiltinScriptPath();
      if (!fs.existsSync(scriptPath)) return { success: false, error: `Built-in agent script not found: ${scriptPath}` };
      agentProcess = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    }

    agentProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.log(`[agent-stdout] ${text}`);
    });
    agentProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error(`[agent-stderr] ${text}`);
    });
    agentProcess.on('exit', (code) => {
      console.log(`[agent] exited with code ${code}`);
      agentProcess = null;
      mainWindow?.webContents.send('agent-connection-changed', { connected: false, count: 0 });
    });

    const baseName = config.agentName || 'wolvie';
    const agentName = config.type === 'claude-code' ? `${baseName} (Claude${config.model ? ' ' + config.model : ''})`
      : config.type === 'local-llm' ? `${baseName} (${config.llmModel || 'local'})`
      : baseName;

    return { success: true, agentName, resumed };
  } catch (err: any) {
    agentProcess = null;
    return { success: false, error: err.message || String(err) };
  }
}

ipcMain.handle('agent-launch', async () => {
  return launchAgentProcess(false);
});

// Reconnect: if process still alive, just restore the connected state.
// If dead, relaunch as a fresh session and send a system message asking
// the agent to check its saved memory so it can resume naturally.
ipcMain.handle('agent-reconnect', async () => {
  if (agentProcess) {
    // Process still alive (SSE timeout only) — push connected event
    const name = getAgentName() || 'agent';
    mainWindow?.webContents.send('agent-connection-changed', { connected: true, count: 1, name });
    return { success: true, agentName: name, resumed: true };
  }

  // Process died — relaunch. For Claude Code this --resume's the prior session
  // (full history restored) and the launch prompt already nudges it, so we skip
  // the chat nudge. For agents that can't resume, fall back to a memory nudge.
  const result = await launchAgentProcess(true);
  if (result.success && !result.resumed) {
    const mem = getAgentMemory(currentFilePath);
    const nudge = mem?.content
      ? 'You have just reconnected to LOGAN after an interruption. You have saved memory for this session — call logan_memory_read to recall context and then briefly let the user know you are back and what you were working on.'
      : 'You have just reconnected to LOGAN after an interruption. Briefly let the user know you are back and ready to continue.';
    // Small delay so the agent's MCP tools are ready before receiving the nudge
    setTimeout(() => addChatMessage('user', nudge), 2000);
  }
  return result;
});

ipcMain.handle('agent-stop', async () => {
  // Explicit stop ends the session — drop the id so the next launch is fresh,
  // not a --resume of the conversation the user just stopped.
  agentSessionId = null;

  // Ask whatever agent is listening to leave its loop. Delivered over the MCP
  // server's SSE stream, so this reaches even an agent LOGAN never spawned (one
  // started externally, or orphaned across a restart and re-attached) — letting
  // it exit gracefully, which is the only way to end an orphan we hold no handle to.
  if (getAgentName()) addChatMessage('user', 'stop');

  if (!agentProcess) {
    // No child process to kill (external / orphaned agent). Give the "stop" a beat
    // to flush over SSE, then free the connection slot so the bulb clears and the
    // button settles to "Launch Agent" instead of falsely showing a live agent.
    await new Promise((resolve) => setTimeout(resolve, 400));
    disconnectActiveAgent();
    return { success: true };
  }

  // LOGAN-spawned agent: give it a moment to exit on the "stop", then force kill.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (agentProcess) {
        agentProcess.kill();
        agentProcess = null;
      }
      resolve();
    }, 3000);
    if (agentProcess) {
      agentProcess.on('exit', () => {
        clearTimeout(timer);
        agentProcess = null;
        resolve();
      });
    } else {
      clearTimeout(timer);
      resolve();
    }
  });
  // Clear any lingering connection slot (its heartbeat can otherwise keep the bulb
  // green for up to 5 min after the process is gone).
  disconnectActiveAgent();
  return { success: true };
});

ipcMain.handle('agent-get-running', async () => {
  return { running: agentProcess !== null };
});

// Interrupt: cooperatively stop the agent's CURRENT task without ending the
// session. Pushes an interrupt signal over SSE; the MCP server surfaces a STOP
// instruction on the agent's next tool call so it aborts and returns to waiting.
ipcMain.handle('agent-interrupt', async () => {
  if (!agentProcess && !getAgentName()) {
    return { success: false, error: 'No agent connected' };
  }
  const delivered = broadcastInterrupt();
  return { success: delivered, error: delivered ? undefined : 'Agent is not listening' };
});

// --- Investigation templates ---
// Route through the local api-server so the journal + replay engine (which live
// there) are the single source of truth for both the agent and the panel UI.
function callApiServer(apiPath: string, body: any): Promise<any> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const req = http.request({
      hostname: '127.0.0.1', port: API_PORT, path: apiPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); } catch { resolve({ success: false, error: 'bad response' }); } });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.write(payload); req.end();
  });
}

ipcMain.handle(IPC.INVESTIGATION_LIST, async () => callApiServer('/api/investigations', {}));
ipcMain.handle(IPC.INVESTIGATION_SAVE, async (_e, name: string, description?: string, requirements?: any, autoDetect?: boolean, aim?: string) => callApiServer('/api/investigation-save', { name, description, requirements, autoDetect, aim }));
ipcMain.handle(IPC.INVESTIGATION_SET_AIM, async (_e, name: string, aim: string) => callApiServer('/api/investigation-set-aim', { name, aim }));
ipcMain.handle(IPC.INVESTIGATION_SET_TIER, async (_e, name: string, tier: string) => callApiServer('/api/investigation-set-tier', { name, tier }));
ipcMain.handle(IPC.INVESTIGATION_SET_ANSWER, async (_e, name: string, stepIndex: number) => callApiServer('/api/investigation-set-answer', { name, stepIndex }));
ipcMain.handle(IPC.INVESTIGATION_RUN, async (_e, name: string, params?: Record<string, any>, force?: boolean) => callApiServer('/api/investigation-run', { name, params: params || {}, force: force || false }));
ipcMain.handle(IPC.INVESTIGATION_DELETE, async (_e, name: string) => callApiServer('/api/investigation-delete', { name }));
ipcMain.handle(IPC.INVESTIGATION_FORK, async (_e, name: string, newName: string, params?: Record<string, any>, description?: string) => callApiServer('/api/investigation-fork', { name, newName, params: params || {}, description }));
ipcMain.handle(IPC.INVESTIGATION_CHECK, async (_e, name: string) => callApiServer('/api/investigation-check', { name }));
ipcMain.handle(IPC.INVESTIGATION_SET_REQS, async (_e, name: string, requirements: any) => callApiServer('/api/investigation-set-requirements', { name, requirements }));
ipcMain.handle(IPC.INVESTIGATION_SET_PARAMS, async (_e, name: string, patches: any[]) => callApiServer('/api/investigation-set-params', { name, patches: patches || [] }));
ipcMain.handle(IPC.INVESTIGATION_SUGGEST_REQS, async () => callApiServer('/api/investigation-suggest-requirements', {}));
ipcMain.handle(IPC.INVESTIGATION_COMPOSE, async (_e, input: any) => callApiServer('/api/investigation-compose', input || {}));
ipcMain.handle(IPC.WORKFLOW_SHOW, async (_e, investigation?: string) => callApiServer('/api/workflow-show', { investigation }));
ipcMain.handle(IPC.ENTITIES_LIST, async (_e, kind?: string) => callApiServer('/api/entities', { kind }));

// Portable catalogue — human ⤓ Export / ⤒ Import. The full flow (file picker + conflict
// prompt) runs here via native dialogs so the renderer stays thin; both paths call the SAME
// apiContext.exportCatalog/importCatalog the agent verbs use (one impl, two operators).
ipcMain.handle(IPC.CATALOG_EXPORT, async () => {
  if (!apiContext) return { success: false, error: 'Not ready yet' };
  const packExt = PACK_FILE_EXT.replace(/^\./, '');
  const res = await showSaveDialog({
    title: 'Export LOGAN catalogue',
    defaultPath: `logan-catalogue${PACK_FILE_EXT}`,
    filters: [{ name: 'LOGAN catalogue pack', extensions: [packExt] }, { name: 'All files', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePath) return { success: false, canceled: true };
  try {
    const out = apiContext.exportCatalog();
    fs.writeFileSync(res.filePath, out.text, 'utf-8');
    const counts = out.summary.filter(s => s.count > 0).map(s => `${s.count} ${s.kind}`).join(', ') || 'nothing saved yet';
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, { type: 'info', title: 'Catalogue exported', message: 'Your LOGAN catalogue was exported.', detail: `${counts}\n\n${res.filePath}` });
    }
    return { success: true, path: res.filePath, summary: out.summary };
  } catch (e: any) {
    return { success: false, error: String(e?.message || e) };
  }
});

ipcMain.handle(IPC.CATALOG_IMPORT, async () => {
  if (!apiContext) return { success: false, error: 'Not ready yet' };
  const packExt = PACK_FILE_EXT.replace(/^\./, '');
  const res = await showOpenDialog({
    title: 'Import LOGAN catalogue',
    properties: ['openFile'],
    filters: [{ name: 'LOGAN catalogue pack', extensions: [packExt, 'json'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePaths?.[0]) return { success: false, canceled: true };
  const file = res.filePaths[0];
  let text: string;
  try { text = fs.readFileSync(file, 'utf-8'); } catch (e: any) { return { success: false, error: `Could not read file: ${e?.message || e}` }; }
  // Encrypted packs need a passphrase; native message boxes can't take text input, so an
  // encrypted pack is imported via the agent verb (logan_import_catalog) for now.
  try {
    const probe = JSON.parse(text);
    if (probe && probe.logan_pack_encrypted === true) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, { type: 'info', title: 'Encrypted pack', message: 'This catalogue pack is encrypted.', detail: 'Import an encrypted pack via the AI agent (logan_import_catalog) with its passphrase — passphrase entry isn’t available in this dialog yet.' });
      }
      return { success: false, error: 'encrypted — import via agent with passphrase' };
    }
  } catch { /* not JSON — importCatalog reports it below */ }
  const dry = apiContext.importCatalog({ text, dryRun: true });
  if (!dry.success) {
    if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, { type: 'error', title: 'Import failed', message: 'This file isn’t a valid LOGAN catalogue pack.', detail: dry.error || '' });
    return { success: false, error: dry.error };
  }
  const p = dry.plan || {};
  const perKind = (p.stores || []).filter((s: any) => s.incoming > 0).map((s: any) => `• ${s.incoming} ${s.kind} (${s.add} new, ${s.conflict} already exist)`).join('\n') || 'nothing to import';
  const unknown = (p.unknownKinds || []).length ? `\n\nSkipped (unknown to this LOGAN): ${p.unknownKinds.join(', ')}` : '';
  const integrity = (dry.verify && !dry.verify.ok) ? `\n\n⚠ Integrity warnings:\n${(dry.verify.problems || []).map((x: any) => x.message).join('\n')}` : '';
  let policy: ConflictPolicy | null = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Import catalogue',
      message: `Import ${p.totalAdd || 0} new entities? (${p.totalConflict || 0} already exist)`,
      detail: `${perKind}${unknown}${integrity}\n\nFor entities that already exist, choose how to resolve them:`,
      buttons: ['Cancel', 'Skip existing', 'Overwrite existing', 'Keep both'],
      cancelId: 0, defaultId: 1,
    });
    policy = ({ 1: 'skip', 2: 'overwrite', 3: 'keepBoth' } as Record<number, ConflictPolicy>)[choice.response] || null;
  }
  if (!policy) return { success: false, canceled: true };
  const applied = apiContext.importCatalog({ text, dryRun: false, policy });
  if (!applied.success) {
    if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, { type: 'error', title: 'Import failed', message: 'Import failed.', detail: applied.error || '' });
    return { success: false, error: applied.error };
  }
  const total = (applied.applied || []).reduce((n: number, a: any) => n + (a.added || 0) + (a.overwritten || 0) + (a.keptBoth || 0), 0);
  if (mainWindow && !mainWindow.isDestroyed()) {
    await dialog.showMessageBox(mainWindow, { type: 'info', title: 'Catalogue imported', message: `Imported ${total} entities.`, detail: (applied.applied || []).map((a: any) => `• ${a.kind}: +${a.added || 0} new, ${a.overwritten || 0} overwritten, ${a.keptBoth || 0} kept-both, ${a.skipped || 0} skipped`).join('\n') });
  }
  return { success: true, applied: applied.applied };
});
// Clue sequences (ordered evidence trails) — human side proxies to the same /api/sequence-*
// endpoints the agent uses (one store, two operators).
ipcMain.handle(IPC.SEQUENCE_LIST, async () => callApiServer('/api/sequences', {}));
ipcMain.handle(IPC.SEQUENCE_SAVE, async (_e, input: any) => callApiServer('/api/sequence-save', input || {}));
ipcMain.handle(IPC.SEQUENCE_APPEND_CLUE, async (_e, nameOrId: string, clue: any) => callApiServer('/api/sequence-append-clue', { name: nameOrId, clue }));
ipcMain.handle(IPC.SEQUENCE_DELETE, async (_e, nameOrId: string) => callApiServer('/api/sequence-delete', { name: nameOrId }));

// --- Agent Setup Wizard ---

ipcMain.handle('agent-detect-environment', async () => {
  const configPath = path.join(os.homedir(), '.logan', 'agent-config.json');
  let hasConfig = false;
  let existingConfig: any = null;
  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    hasConfig = true;
  } catch { /* no config */ }

  // Detect AI CLI tools. GUI apps on macOS/Linux don't inherit the user's shell
  // PATH, so we spawn a login shell to load ~/.bashrc / ~/.zshrc / nvm etc.
  function detectCli(bin: string): { found: boolean; version: string } {
    // 1. Try via login shell (loads user PATH — handles nvm, homebrew, pyenv…)
    const shells = process.platform === 'win32'
      ? []
      : ['/bin/bash', '/bin/zsh', '/bin/sh'].filter(s => { try { return fs.existsSync(s); } catch { return false; } });
    for (const sh of shells) {
      const r = spawnSync(sh, ['-lc', `${bin} --version`], { timeout: 4000, encoding: 'utf-8' });
      if (r.status === 0 && r.stdout) return { found: true, version: r.stdout.trim().split('\n')[0] };
    }
    // 2. Windows fallback
    if (process.platform === 'win32') {
      const r = spawnSync('cmd', ['/c', `${bin} --version`], { timeout: 4000, encoding: 'utf-8' });
      if (r.status === 0 && r.stdout) return { found: true, version: r.stdout.trim().split('\n')[0] };
    }
    // 3. Common install paths as last resort
    const extra: string[] = {
      claude: [
        path.join(os.homedir(), '.claude', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        path.join(os.homedir(), '.nvm', 'versions', 'node', 'current', 'bin', 'claude'),
      ],
      aider: process.platform === 'win32'
        ? [path.join(os.homedir(), '.local', 'bin', 'aider.exe')]
        : ['/usr/local/bin/aider', path.join(os.homedir(), '.local', 'bin', 'aider')],
    }[bin] ?? [];
    for (const p of extra) {
      if (!fs.existsSync(p)) continue;
      const r = spawnSync(p, ['--version'], { timeout: 4000, encoding: 'utf-8' });
      if (r.status === 0 && r.stdout) return { found: true, version: r.stdout.trim().split('\n')[0] };
    }
    return { found: false, version: '' };
  }

  const claudeResult  = detectCli('claude');
  const aiderResult   = detectCli('aider');
  const geminiResult  = detectCli('gemini');

  // Backward-compat fields used by the existing wizard UI
  const hasClaudeCli  = claudeResult.found;
  const claudeVersion = claudeResult.version;

  const builtinPath = path.join(app.getAppPath(), 'examples', 'agent-node.mjs');
  const hasBuiltin = fs.existsSync(builtinPath);

  // Detect local LLM services (use Node http instead of curl for cross-platform)
  let hasOllama = false;
  let ollamaModels: string[] = [];
  let hasLmStudio = false;

  const httpGet = (url: string, timeoutMs: number): Promise<string> => new Promise((resolve, reject) => {
    const req = require('http').get(url, { timeout: timeoutMs }, (res: any) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });

  // Check Ollama (port 11434)
  try {
    const ollamaResp = await httpGet('http://localhost:11434/api/tags', 3000);
    const data = JSON.parse(ollamaResp);
    if (data.models?.length > 0) {
      hasOllama = true;
      ollamaModels = data.models.map((m: any) => m.name);
    }
  } catch { /* not running */ }

  // Check LM Studio (port 1234)
  try {
    const lmsResp = await httpGet('http://localhost:1234/v1/models', 3000);
    const data = JSON.parse(lmsResp);
    if (data.data?.length > 0) {
      hasLmStudio = true;
    }
  } catch { /* not running */ }

  return {
    hasClaudeCli, claudeVersion,
    hasAider: aiderResult.found, aiderVersion: aiderResult.version,
    hasGemini: geminiResult.found, geminiVersion: geminiResult.version,
    hasConfig, existingConfig, hasBuiltin, builtinPath,
    hasOllama, ollamaModels, hasLmStudio,
  };
});

ipcMain.handle('agent-save-config', async (_event, config: any) => {
  const configDir = path.join(os.homedir(), '.logan');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'agent-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { success: true };
});

// === Recent Files ===

ipcMain.handle('recent-files-list', async () => {
  // Filter out files that no longer exist
  const list = loadRecentFiles().filter(e => {
    try { return fs.existsSync(e.path); } catch { return false; }
  });
  return { success: true, files: list };
});

ipcMain.handle('recent-files-clear', async () => {
  saveRecentFiles([]);
  return { success: true };
});

// === Recent Folders ===

ipcMain.handle('recent-folders-list', async () => {
  const list = loadRecentFolders().filter(e => {
    try { return fs.existsSync(e.path); } catch { return false; }
  });
  return { success: true, folders: list };
});

ipcMain.handle('recent-folders-clear', async () => {
  saveRecentFolders([]);
  return { success: true };
});

// === File Reload ===
// Evict a file from cache so the next openFile call re-indexes from disk.
ipcMain.handle('reload-file', async (_, filePath: string) => {
  evictFromCache(filePath);
  return { success: true };
});

// === Filter Presets ===
interface FilterPreset {
  id: string;
  name: string;
  levels: string[];
  includePatterns: Array<{ pattern: string; caseSensitive: boolean }>;
  excludePatterns: string[];
  matchCase: boolean;
  exactMatch: boolean;
  contextLines: number;
}

const FILTER_PRESETS_PATH = () => path.join(os.homedir(), '.logan', 'filter-presets.json');

function loadFilterPresets(): FilterPreset[] {
  try {
    const p = FILTER_PRESETS_PATH();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* */ }
  return [];
}

function saveFilterPresets(presets: FilterPreset[]): void {
  try {
    const dir = path.join(os.homedir(), '.logan');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILTER_PRESETS_PATH(), JSON.stringify(presets, null, 2));
  } catch { /* */ }
}

ipcMain.handle('filter-presets-list', () => ({ success: true, presets: loadFilterPresets() }));

ipcMain.handle('filter-presets-save', (_, preset: FilterPreset) => {
  const presets = loadFilterPresets().filter(p => p.id !== preset.id);
  presets.unshift(preset);
  saveFilterPresets(presets);
  return { success: true };
});

ipcMain.handle('filter-presets-delete', (_, id: string) => {
  saveFilterPresets(loadFilterPresets().filter(p => p.id !== id));
  return { success: true };
});

// ── Usage Monitor IPC ─────────────────────────────────────────────────
// Renderer records human PANEL OPENS here (fire-and-forget). Human ACTIONS are
// counted inside logActivity(); AI tool calls are counted in api-server.ts.
ipcMain.handle(IPC.USAGE_BUMP, (_, verb: string) => {
  bumpUsage(verb, 'human');
});

ipcMain.handle(IPC.USAGE_GET, () => {
  const entries = getUsage();
  // Join human + AI counts per canonical feature so the panel's operator split
  // lines up (raw human action names and AI api slugs otherwise never match).
  return { success: true, entries, features: aggregateUsageByFeature(entries) };
});

ipcMain.handle(IPC.USAGE_CLEAR, () => {
  clearUsage();
  return { success: true };
});

// ── Pattern log IPC ("flight recorder" of pattern applications) ────────
// Read-only exposure of the rolling pattern-application log for the renderer.
// Entries are recorded server-side (search/filter bricks land later); this
// brick only surfaces get/clear.
ipcMain.handle(IPC.PATTERN_LOG_GET, () => {
  return { success: true, entries: getPatternLog() };
});

ipcMain.handle(IPC.PATTERN_LOG_CLEAR, () => {
  clearPatternLog();
  return { success: true };
});

// Record a human-driven pattern application (from "Make pattern… from selection"
// applying to Search / Filter / Highlight). operator is forced to 'human' here —
// AI applications are logged server-side. Never throws (patternLog swallows).
ipcMain.handle(IPC.PATTERN_LOG_ADD, (_, entry: Partial<PatternLogEntry> & { at?: number }) => {
  logPattern({
    operator: 'human',
    mode: entry.mode ?? '',
    source: entry.source ?? '',
    scope: entry.scope ?? '',
    scanned: entry.scanned ?? 0,
    matched: entry.matched ?? 0,
    hid: entry.hid ?? 0,
    sampleHits: entry.sampleHits ?? [],
    ms: entry.ms ?? 0,
    capped: entry.capped ?? false,
    valid: entry.valid ?? true,
    error: entry.error,
    at: entry.at,
  });
  return { success: true };
});

// ── Controlled-pattern compiler IPC ("Make pattern… from selection") ────
// The renderer is a non-module script and can't import main modules, so it calls
// compilePattern() over IPC. A live RegExp can't cross the IPC boundary, so we
// strip it and return only { ok, source, flags, error, warnings, mode }; the
// renderer rebuilds `new RegExp(source, flags)` locally for match counting.
ipcMain.handle(IPC.COMPILE_PATTERN, (_, input: CompileInput) => {
  try {
    const r = compilePattern(input);
    return { ok: r.ok, source: r.source, flags: r.flags, error: r.error, warnings: r.warnings, mode: r.mode };
  } catch (e) {
    return { ok: false, source: '', flags: '', error: e instanceof Error ? e.message : String(e), warnings: [], mode: input?.mode ?? 'paint' };
  }
});

// ── Named constants IPC ────────────────────────────────────────────────
// Captured from a selection via the log viewer's "Save as constant…" gesture.
// Persistence-only this brick; a viewer/consumer brick lands later.
ipcMain.handle(IPC.CONSTANTS_SAVE, (_, name: string, value: string, description?: string) => {
  saveConstant(name, value, undefined, description);
  return { success: true };
});

ipcMain.handle(IPC.CONSTANTS_GET, () => {
  return { success: true, entries: getConstants() };
});

ipcMain.handle(IPC.CONSTANTS_DELETE, (_, name: string) => {
  return { success: true, removed: deleteConstant(name) };
});

// ── Active scope IPC ("Use … as scope" / breadcrumb) ─────────────────
ipcMain.handle(IPC.SET_ACTIVE_SCOPE, (_, desc: ScopeDescriptor | null) => {
  if (!currentFilePath) return { success: false, error: 'No file open' };
  setActiveScope(desc);
  const resolved = resolveCurrentScope(getActiveScope());
  return { success: true, scope: getActiveScope(), info: scopeInfo(resolved) };
});

ipcMain.handle(IPC.GET_ACTIVE_SCOPE, () => {
  const scope = getActiveScope();
  return { success: true, scope, info: scope ? scopeInfo(resolveCurrentScope(scope)) : null };
});


// ── Read file text IPC ───────────────────────────────────────────────
ipcMain.handle(IPC.READ_FILE_TEXT, async (_event, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, fileName: path.basename(filePath) };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('agent-browse-script', async () => {
  const result = await showOpenDialog({
    title: 'Select Agent Script',
    filters: [
      { name: 'Scripts', extensions: ['mjs', 'js', 'ts', 'sh', 'py'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});
