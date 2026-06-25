// LOGAN guided-triage recipe engine.
//
// A "recipe" maps a user-reported SYMPTOM onto an ordered set of LOGAN primitive
// calls (search / time-gaps / analyze / trends), pins the results as findings, and
// returns a COMPACT, structured result the connected agent can use to guide the user
// — clear inputs (symptom + a few narrowing options) and clear outputs (capped
// findings + the next questions to ask + drill-down moves) for token economy.
//
// See docs/TRIAGE_GUIDE.md for the design. This is "step 2: the recipe engine".

export type ApiCall = (method: string, path: string, body?: any) => Promise<any>;

export const RECIPE_SYMPTOMS = [
  'crash',        // It crashed / died
  'hang',         // It froze / hung
  'slow',         // It's slow
  'error-storm',  // Sudden burst of errors
  'wont-start',   // Won't start / init failure
  'conn-drops',   // Connection drops
  'flaky',        // Intermittent / flaky
  'wrong-value',  // Wrong / odd value
] as const;
export type Symptom = (typeof RECIPE_SYMPTOMS)[number];

export const DOMAIN_IDS = ['generic', 'android', 'embedded', 'web', 'automotive'] as const;
export type DomainId = (typeof DOMAIN_IDS)[number];

export interface RecipeOptions {
  symptom: Symptom;
  domain?: DomainId | 'auto';
  component?: string;     // narrow every search to this component/module substring
  sinceLine?: number;     // 1-based viewer line — only look at/after this line
  field?: string;         // field name for slow / flaky / wrong-value recipes
  baselineId?: string;    // if set, recipes that support it diff against a known-good run
  maxFindings?: number;   // cap on findings returned & pinned (default 10)
  pin?: boolean;          // annotate findings + send one summary message (default true)
}

export interface Finding {
  lineNumber: number;     // 1-based viewer line
  endLine?: number;       // 1-based, inclusive
  title: string;
  severity: 'info' | 'warning' | 'error';
  sample?: string;
}

export interface NextQuestion {
  id: string;
  ask: string;
  hint?: string;
}

export interface DrillDown {
  label: string;
  tool: string;
  args: Record<string, any>;
}

export interface RecipeResult {
  symptom: Symptom;
  domain: DomainId;
  summary: string;
  findings: Finding[];
  steps: string[];
  pinnedCount: number;
  nextQuestions: NextQuestion[];
  drillDown: DrillDown[];
}

// --- Domain packs: same recipes, different vocabulary --------------------------

interface DomainPack {
  id: DomainId;
  crash: string;        // regex alternation
  hang: string;
  startupError: string;
  connDrop: string;
  slowFieldHints: string[];   // candidate latency/duration field-name fragments
  detect: RegExp;             // content signature for auto-detection
}

const PACKS: Record<DomainId, DomainPack> = {
  generic: {
    id: 'generic',
    crash: 'FATAL|exception|panic|stack ?trace|segfault|core dumped|uncaught|abort',
    hang: 'deadlock|hang|stuck|not responding|watchdog|timed? ?out',
    startupError: 'failed to (start|load|init)|cannot find|missing|permission denied|EADDRINUSE|bind|config(uration)? error',
    connDrop: 'disconnect|reconnect|connection (refused|reset|lost|closed)|timeout|retry|broken pipe',
    slowFieldHints: ['duration', 'elapsed', 'latency', 'took', 'ms', 'time_ms', 'responsetime'],
    detect: /.^/,  // never auto-wins; pure fallback
  },
  android: {
    id: 'android',
    crash: 'FATAL EXCEPTION|ANR |signal 11|tombstone|AndroidRuntime|Force ?Closing',
    hang: 'ANR |Skipped \\d+ frames|Choreographer|watchdog|not responding',
    startupError: 'Unable to start|ClassNotFoundException|InflateException|permission denied|SecurityException',
    connDrop: 'NetworkOnMainThread|UnknownHostException|SocketTimeout|ConnectException|disconnected',
    slowFieldHints: ['Displayed', 'duration', 'ms', 'frames'],
    detect: /\b(ActivityManager|AndroidRuntime|logcat|\bI\/|\bE\/|Choreographer)\b/i,
  },
  embedded: {
    id: 'embedded',
    crash: 'HardFault|assert(ion)? failed|panic|stack overflow|BusFault|UsageFault',
    hang: 'watchdog|WDT|reset|hang|stuck|spin',
    startupError: 'boot fail|init fail|no (memory|heap)|flash error|peripheral .* fail',
    connDrop: 'link down|bus off|CAN error|timeout|NACK|no ack|reset',
    slowFieldHints: ['tick', 'cycles', 'us', 'ms'],
    detect: /\b(HardFault|watchdog|WDT|bootloader|firmware|0x[0-9a-f]{8})\b/i,
  },
  web: {
    id: 'web',
    crash: 'traceback|unhandled (rejection|exception)|segfault|OOMKilled|fatal error|5\\d\\d ',
    hang: 'timeout|deadlock|pool exhausted|event loop blocked|slow query',
    startupError: 'EADDRINUSE|cannot bind|ECONNREFUSED|env(ironment)? .* missing|migration failed|listen',
    connDrop: 'ECONNRESET|ETIMEDOUT|socket hang up|connection (refused|closed)|upstream',
    slowFieldHints: ['latency_ms', 'latency', 'rt', 'took', 'duration', 'response_time', 'ms'],
    detect: /\b(GET|POST|PUT|DELETE)\b .*\b[1-5]\d\d\b|\b(req_id|request_id|trace_id|upstream)\b/i,
  },
  automotive: {
    id: 'automotive',
    crash: 'DTC|fault code|error frame|limp|MIL on',
    hang: 'no signal|stale|timeout|bus off',
    startupError: 'ecu .* fail|calibration|no comm|init fail',
    connDrop: 'bus off|CAN error|lost frame|timeout|no response',
    slowFieldHints: ['rpm', 'speed', 'temp', 'voltage'],
    detect: /\b(CAN|DTC|ECU|signal|MDF|channel group)\b/i,
  },
};

// --- helpers -------------------------------------------------------------------

function truncate(s: string, n = 120): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function detectDomain(api: ApiCall, want: DomainId | 'auto' | undefined): Promise<DomainId> {
  if (want && want !== 'auto') return want;
  try {
    const res = await api('POST', '/api/get-lines', { startLine: 0, count: 600 });
    const text: string = (res?.lines || []).map((l: any) => l.text || '').join('\n');
    let best: DomainId = 'generic';
    let bestScore = 0;
    for (const id of DOMAIN_IDS) {
      if (id === 'generic') continue;
      const m = text.match(new RegExp(PACKS[id].detect.source, 'gi'));
      const score = m ? m.length : 0;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return bestScore >= 2 ? best : 'generic';
  } catch {
    return 'generic';
  }
}

async function searchMarkers(
  api: ApiCall,
  pattern: string,
  component: string | undefined,
  sinceLine: number | undefined,
  limit: number,
): Promise<Finding[]> {
  const res = await api('POST', '/api/search', { pattern, isRegex: true, matchCase: false, wholeWord: false });
  let matches: any[] = res?.matches || [];
  if (component) {
    const c = component.toLowerCase();
    matches = matches.filter((m) => (m.lineText || '').toLowerCase().includes(c));
  }
  if (sinceLine) matches = matches.filter((m) => (m.viewerLine || 0) >= sinceLine);
  return matches.slice(0, limit).map((m) => ({
    lineNumber: m.viewerLine,
    title: '',
    severity: 'error' as const,
    sample: truncate(m.lineText || ''),
  }));
}

async function pinFindings(api: ApiCall, symptom: Symptom, findings: Finding[]): Promise<number> {
  if (findings.length === 0) return 0;
  // Clear stale annotations from a previous recipe run, then annotate each finding.
  await api('POST', '/api/annotation-clear').catch(() => null);
  let pinned = 0;
  for (const f of findings) {
    const body: Record<string, any> = {
      lineNumber: Math.max(0, f.lineNumber - 1),
      text: f.title,
      severity: f.severity,
    };
    if (f.endLine) body.endLine = Math.max(0, f.endLine - 1);
    const ok = await api('POST', '/api/annotate', body).then(() => true).catch(() => false);
    if (ok) pinned++;
  }
  // Navigate to the first finding so the viewer lands on it.
  await api('POST', '/api/navigate', { lineNumber: Math.max(0, findings[0].lineNumber - 1) }).catch(() => null);
  // ONE consolidated chat message (token economy) rather than one per finding.
  const lines = findings.slice(0, 12).map((f, i) =>
    `${i + 1}. [${f.severity}] line ${f.lineNumber}${f.endLine ? `–${f.endLine}` : ''}: ${f.title}`);
  const msg = `**Triage (${symptom}) — ${findings.length} finding${findings.length === 1 ? '' : 's'} pinned**\n\n${lines.join('\n')}\n\nClick any annotation in the viewer to jump to it.`;
  await api('POST', '/api/agent-message', { message: msg }).catch(() => null);
  return pinned;
}

const FIVE_WHYS = (line: number): DrillDown[] => [
  { label: 'What happened right BEFORE this?', tool: 'logan_get_lines', args: { startLine: Math.max(1, line - 20), count: 20 } },
  { label: 'What else fired at the SAME time?', tool: 'logan_get_lines', args: { startLine: line, count: 15 } },
  { label: 'Has this happened before in the file?', tool: 'logan_search', args: { pattern: '(re-use the marker that matched)', isRegex: true } },
];

const ASK_COMPONENT: NextQuestion = { id: 'component', ask: 'Which component/module is involved?', hint: 'Run logan_analyze → insights.topFailingComponents to populate options.' };
const ASK_SINCE: NextQuestion = { id: 'sinceLine', ask: 'When did you first notice it? Give a timestamp or line.', hint: 'Pass sinceLine (1-based) to focus the recipe.' };
const ASK_FIELD: NextQuestion = { id: 'field', ask: 'Which field/value looks wrong?', hint: 'Run logan_trend_fields to list candidate fields, then pass field.' };
const ASK_BASELINE: NextQuestion = { id: 'baselineId', ask: 'Do you have a known-good run to compare against?', hint: 'Pass baselineId to diff via logan_baseline_compare.' };

// --- recipes -------------------------------------------------------------------

async function recipeCrash(api: ApiCall, pack: DomainPack, o: RecipeOptions, steps: string[]): Promise<Finding[]> {
  steps.push('analyze() for crash insights');
  const analysis = await api('POST', '/api/analyze', {}).catch(() => null);
  const crashes: any[] = analysis?.result?.insights?.crashes || [];
  const findings: Finding[] = [];
  if (crashes.length > 0) {
    // First occurrence of each unique crash keyword, plus flag the LAST crash (death point).
    const seen = new Set<string>();
    const ordered = [...crashes].sort((a, b) => a.lineNumber - b.lineNumber);
    for (const c of ordered) {
      if (seen.has(c.keyword)) continue;
      seen.add(c.keyword);
      findings.push({ lineNumber: c.lineNumber + 1, title: `Crash: ${c.keyword}`, severity: 'error', sample: truncate(c.text) });
    }
    const last = ordered[ordered.length - 1];
    findings.unshift({ lineNumber: last.lineNumber + 1, title: `Last line before death (${last.keyword})`, severity: 'error', sample: truncate(last.text) });
  } else {
    steps.push('no analyzer crashes → search crash markers');
    const f = await searchMarkers(api, pack.crash, o.component, o.sinceLine, o.maxFindings || 10);
    f.forEach((x) => { x.title = 'Crash marker'; });
    findings.push(...f);
  }
  return findings;
}

async function recipeHang(api: ApiCall, _pack: DomainPack, o: RecipeOptions, steps: string[]): Promise<Finding[]> {
  steps.push('time-gaps(threshold 30s) → biggest silences');
  const res = await api('POST', '/api/time-gaps', { thresholdSeconds: 30 }).catch(() => null);
  let gaps: any[] = res?.gaps || [];
  if (o.sinceLine) gaps = gaps.filter((g) => (g.lineNumber + 1) >= o.sinceLine!);
  return gaps.slice(0, o.maxFindings || 10).map((g) => ({
    lineNumber: g.lineNumber + 1,
    title: `${Math.round(g.gapSeconds)}s silence before this line`,
    severity: 'warning' as const,
    sample: truncate(g.linePreview || ''),
  }));
}

async function pickLatencyField(api: ApiCall, pack: DomainPack, given: string | undefined, steps: string[]): Promise<string | null> {
  if (given) return given;
  steps.push('trend-fields → pick a numeric latency field');
  const res = await api('POST', '/api/trend-fields', {}).catch(() => null);
  const fields: any[] = res?.fields || [];
  const numeric = fields.filter((f) => f.type === 'numeric');
  for (const hint of pack.slowFieldHints) {
    const hit = numeric.find((f) => (f.name || '').toLowerCase().includes(hint.toLowerCase()));
    if (hit) return hit.name;
  }
  return numeric[0]?.name || null;
}

async function recipeSlow(api: ApiCall, pack: DomainPack, o: RecipeOptions, steps: string[]): Promise<Finding[]> {
  const field = await pickLatencyField(api, pack, o.field, steps);
  if (!field) {
    steps.push('no numeric field found → fall back to slow markers');
    const f = await searchMarkers(api, 'slow|timeout|timed out|GC pause|throttl', o.component, o.sinceLine, o.maxFindings || 10);
    f.forEach((x) => { x.title = 'Slowness marker'; x.severity = 'warning'; });
    return f;
  }
  steps.push(`trend-series("${field}") → find the spike`);
  const res = await api('POST', '/api/trend-series', { field, bucketCount: 200 }).catch(() => null);
  const points: any[] = res?.points || [];
  const valued = points.filter((p) => typeof p.value === 'number' && p.viewerLine);
  valued.sort((a, b) => b.value - a.value);
  if (valued.length === 0) return [];
  return valued.slice(0, o.maxFindings || 10).map((p) => ({
    lineNumber: p.viewerLine,
    title: `High ${field} = ${p.value}`,
    severity: 'warning' as const,
    sample: truncate(p.lineText || ''),
  }));
}

async function recipeErrorStorm(api: ApiCall, pack: DomainPack, o: RecipeOptions, steps: string[]): Promise<Finding[]> {
  steps.push('analyze() → error rate + top failing components');
  const analysis = await api('POST', '/api/analyze', {}).catch(() => null);
  const findings: Finding[] = [];
  const comps: any[] = analysis?.result?.insights?.topFailingComponents || [];
  // First occurrence of each top failing component's error.
  for (const comp of comps.slice(0, o.maxFindings || 10)) {
    const name = typeof comp === 'string' ? comp : (comp.component || comp.name);
    if (!name) continue;
    const res = await api('POST', '/api/search', { pattern: name, isRegex: false, matchCase: false }).catch(() => null);
    const matches: any[] = res?.matches || [];
    const errMatch = matches.find((m) => /error|fatal|fail/i.test(m.lineText || '')) || matches[0];
    if (errMatch) findings.push({ lineNumber: errMatch.viewerLine, title: `Failing component: ${name}`, severity: 'warning', sample: truncate(errMatch.lineText || '') });
  }
  if (findings.length === 0) {
    steps.push('no components → first error markers');
    const f = await searchMarkers(api, 'error|fatal|' + pack.crash, o.component, o.sinceLine, o.maxFindings || 10);
    f.forEach((x) => { x.title = 'Error'; });
    findings.push(...f);
  }
  return findings;
}

async function recipeWontStart(api: ApiCall, pack: DomainPack, o: RecipeOptions, steps: string[]): Promise<Finding[]> {
  steps.push('search startup/init error markers');
  const f = await searchMarkers(api, pack.startupError, o.component, o.sinceLine, o.maxFindings || 10);
  f.forEach((x) => { x.title = 'Startup/init failure'; });
  // Always anchor the startup sequence itself.
  f.unshift({ lineNumber: o.sinceLine || 1, title: 'Startup sequence begins here', severity: 'info' });
  return f;
}

async function recipeConnDrops(api: ApiCall, pack: DomainPack, o: RecipeOptions, steps: string[]): Promise<Finding[]> {
  steps.push('search connection disconnect/retry/timeout markers');
  const f = await searchMarkers(api, pack.connDrop, o.component, o.sinceLine, o.maxFindings || 10);
  f.forEach((x) => { x.title = 'Connection event'; x.severity = 'warning'; });
  return f;
}

async function recipeTransitions(api: ApiCall, o: RecipeOptions, steps: string[], label: string): Promise<Finding[]> {
  if (!o.field) return [];
  steps.push(`trend-transitions("${o.field}") → value flips`);
  const res = await api('POST', '/api/trend-transitions', { field: o.field }).catch(() => null);
  const trans: any[] = res?.transitions || [];
  return trans.slice(0, o.maxFindings || 10).map((t) => ({
    lineNumber: t.viewerLine,
    title: `${label}: ${o.field} ${truncate(String(t.fromValue), 24)} → ${truncate(String(t.toValue), 24)}`,
    severity: 'warning' as const,
  }));
}

// --- public entry --------------------------------------------------------------

export async function runRecipe(api: ApiCall, opts: RecipeOptions): Promise<RecipeResult> {
  const o: RecipeOptions = { maxFindings: 10, pin: true, ...opts };
  const domain = await detectDomain(api, o.domain);
  const pack = PACKS[domain];
  const steps: string[] = [`domain = ${domain}`];

  let findings: Finding[] = [];
  const nextQuestions: NextQuestion[] = [];

  switch (o.symptom) {
    case 'crash':
      findings = await recipeCrash(api, pack, o, steps);
      if (!o.component) nextQuestions.push(ASK_COMPONENT);
      break;
    case 'hang':
      findings = await recipeHang(api, pack, o, steps);
      if (!o.sinceLine) nextQuestions.push(ASK_SINCE);
      break;
    case 'slow':
      findings = await recipeSlow(api, pack, o, steps);
      if (!o.field) nextQuestions.push(ASK_FIELD);
      break;
    case 'error-storm':
      findings = await recipeErrorStorm(api, pack, o, steps);
      if (!o.baselineId) nextQuestions.push(ASK_BASELINE);
      break;
    case 'wont-start':
      findings = await recipeWontStart(api, pack, o, steps);
      break;
    case 'conn-drops':
      findings = await recipeConnDrops(api, pack, o, steps);
      break;
    case 'flaky':
      findings = await recipeTransitions(api, o, steps, 'Flip');
      if (!o.field) nextQuestions.push(ASK_FIELD);
      break;
    case 'wrong-value':
      findings = await recipeTransitions(api, o, steps, 'Changed');
      if (!o.field) nextQuestions.push(ASK_FIELD);
      break;
  }

  findings = findings.slice(0, o.maxFindings || 10);
  const pinnedCount = o.pin ? await pinFindings(api, o.symptom, findings) : 0;

  const summary = findings.length === 0
    ? `No ${o.symptom} findings${o.component ? ` for component "${o.component}"` : ''} — try a different symptom or answer the next question.`
    : `${findings.length} ${o.symptom} finding${findings.length === 1 ? '' : 's'} (domain: ${domain})${pinnedCount ? `, ${pinnedCount} pinned in the viewer` : ''}.`;

  return {
    symptom: o.symptom,
    domain,
    summary,
    findings,
    steps,
    pinnedCount,
    nextQuestions,
    drillDown: findings.length ? FIVE_WHYS(findings[0].lineNumber) : [],
  };
}
