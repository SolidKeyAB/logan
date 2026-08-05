// ─── Conclusion: native root-cause synthesis (no AI) ─────────────────────────
// Pure, deterministic synthesis used by the AI agent via main's
// /api/build-conclusion → logan_build_conclusion tool.
//
// It turns everything LOGAN already computes — analysis (crashes, levels,
// failing components), time gaps, and pinned findings/annotations — into a plain
// verdict: the FIRST anomaly (the trigger), the likely root cause, a chronological
// timeline of key events, and the supporting evidence. No DOM, no window, no Node
// APIs — so it is trivially unit-testable and could bundle into the renderer.
//
// TODO: unify with renderer synthesizeConclusion (src/renderer/renderer.ts).
//   This is a VERBATIM extraction of that function's logic (identical wording,
//   thresholds, and ordering), kept as a separate pure module because the
//   renderer is a single non-module script: adding an `import` to renderer.ts
//   flips it into an ES module, which stops its local interfaces from
//   declaration-merging with the ambient globals in src/renderer/types.d.ts
//   (SearchResult, Bookmark, HighlightConfig, AnalysisResult, …) and surfaces
//   ~30 pre-existing dual-definition + noUnusedLocals errors. Reconciling all of
//   those is out of scope here, so the renderer keeps its inline copy for now and
//   this module is the single source of truth for the AI path. When the renderer
//   is modularized, delete its inline copy and import from here.

// Structurally-minimal inputs. Both the renderer's `AnalysisResult` and main's
// `AnalysisResult` (src/main/analyzers/types.ts) satisfy these shapes, so this
// module never collides with either AnalysisResult *name*.
export interface ConclusionCrash {
  text: string;
  lineNumber: number;
  level?: string;
  channel?: string;
  keyword: string;
}

export interface ConclusionComponent {
  name: string;
  errorCount: number;
  warningCount: number;
  sampleLine: number;
}

export interface ConclusionAnalysis {
  stats?: { totalLines?: number; analyzedLines?: number };
  levelCounts?: Record<string, number>;
  insights?: {
    crashes?: ConclusionCrash[];
    topFailingComponents?: ConclusionComponent[];
  };
}

export interface ConclusionGap {
  lineNumber: number;
  gapSeconds: number;
  prevTimestamp?: string;
  currTimestamp?: string;
  linePreview?: string;
}

export interface ConclusionAnnotation {
  lineNumber?: number;
  severity?: string;
  text?: string;
  title?: string;
}

export interface ConclusionEvent {
  lineNumber: number;                                   // 0-based internal (viewer shows +1)
  viewerLine?: number;                                  // 1-based (= lineNumber + 1); set on the API payload so agents pin correctly
  kind: 'crash' | 'error' | 'gap' | 'warning' | 'finding';
  label: string;
  detail?: string;
  severity: 'error' | 'warning' | 'info';
  timestampStr?: string;                                // wall-clock, resolved lazily
  gapSeconds?: number;
}

export interface ConclusionReport {
  generatedAt: number;
  sourceFilePath: string | null;
  fileName: string;
  totalLines: number;
  levelCounts: Record<string, number>;
  errorRate: number;
  verdict: { kind: string; headline: string; detail: string; severity: 'error' | 'warning' | 'info' };
  firstAnomaly: ConclusionEvent | null;
  rootCause: ConclusionEvent | null;
  timeline: ConclusionEvent[];
  topComponents: ConclusionComponent[];
}

export interface SynthesizeOptions {
  // Absolute path of the analyzed file (null when unknown). Drives fileName.
  sourceFilePath: string | null;
  // Fallback line count used only when analysis lacks stats.totalLines.
  totalLinesFallback?: number;
}

// Human-friendly duration (kept verbatim from the renderer's formatDuration so
// the timeline/verdict wording is byte-identical for the human panel).
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Pure, deterministic synthesis from LOGAN's existing native signals.
export function synthesizeConclusion(
  analysis: ConclusionAnalysis | null,
  gaps: ConclusionGap[],
  annotations: ConclusionAnnotation[],
  opts: SynthesizeOptions,
): ConclusionReport {
  const events: ConclusionEvent[] = [];
  const levelCounts: Record<string, number> = (analysis && analysis.levelCounts) || {};
  const totalLines = (analysis && analysis.stats && analysis.stats.totalLines) || opts.totalLinesFallback || 0;
  const analyzed = (analysis && analysis.stats && analysis.stats.analyzedLines) || totalLines || 1;
  const fatal = levelCounts['fatal'] || 0;
  const errors = levelCounts['error'] || 0;
  const warnings = levelCounts['warning'] || 0;
  const errorRate = (fatal + errors) / Math.max(1, analyzed);

  // Crashes → error events
  const crashes: ConclusionCrash[] = (analysis && analysis.insights && analysis.insights.crashes) || [];
  for (const c of crashes) {
    events.push({
      lineNumber: c.lineNumber,
      kind: 'crash',
      label: `Crash: “${c.keyword}”${c.channel ? ' in ' + c.channel : ''}`,
      detail: c.text,
      severity: 'error',
    });
  }
  // First error per failing component
  const comps: ConclusionComponent[] = (analysis && analysis.insights && analysis.insights.topFailingComponents) || [];
  for (const comp of comps) {
    if (comp.errorCount > 0 && comp.sampleLine >= 0) {
      events.push({
        lineNumber: comp.sampleLine,
        kind: 'error',
        label: `First error in ${comp.name} (${comp.errorCount} error${comp.errorCount === 1 ? '' : 's'})`,
        severity: 'error',
      });
    }
  }
  // Biggest stalls
  const sortedGaps = [...gaps].sort((a, b) => b.gapSeconds - a.gapSeconds).slice(0, 5);
  for (const g of sortedGaps) {
    events.push({
      lineNumber: g.lineNumber,
      kind: 'gap',
      label: `${formatDuration(g.gapSeconds)} stall (no events logged)`,
      detail: g.linePreview,
      severity: g.gapSeconds >= 60 ? 'warning' : 'info',
      timestampStr: g.currTimestamp,
      gapSeconds: g.gapSeconds,
    });
  }
  // Pinned findings
  for (const a of annotations) {
    if (typeof a.lineNumber !== 'number') continue;
    const sev: ConclusionEvent['severity'] = (a.severity === 'error' || a.severity === 'warning') ? a.severity : 'info';
    events.push({
      lineNumber: a.lineNumber,
      kind: 'finding',
      label: `Pinned: ${a.text || a.title || 'finding'}`,
      severity: sev,
    });
  }

  // Chronological order (line number is monotonic with time within one log).
  events.sort((a, b) => a.lineNumber - b.lineNumber);

  // First anomaly = earliest error/warning event (the trigger).
  const firstAnomaly = events.find(e => e.severity === 'error' || e.severity === 'warning') || events[0] || null;

  const firstCrash = events.filter(e => e.kind === 'crash')[0] || null;
  const firstError = events.filter(e => e.kind === 'error')[0] || null;
  const biggestGap = sortedGaps[0] || null;

  let rootCause: ConclusionEvent | null = null;
  let verdict: ConclusionReport['verdict'];
  if (firstCrash) {
    rootCause = firstCrash;
    const earlierTrigger = firstAnomaly && firstAnomaly.lineNumber < firstCrash.lineNumber
      ? ` An earlier anomaly at line ${firstAnomaly.lineNumber + 1} may be the trigger.` : '';
    verdict = {
      kind: 'crash', severity: 'error',
      headline: `Crash detected — likely root cause at line ${firstCrash.lineNumber + 1}`,
      detail: `First crash: ${firstCrash.label}.${earlierTrigger}`,
    };
  } else if (errorRate >= 0.05 || (comps[0] && comps[0].errorCount >= 5)) {
    rootCause = firstError;
    const worst = comps[0];
    verdict = {
      kind: 'error-storm', severity: 'error',
      headline: worst ? `Error storm — ${worst.name} is the top failing component` : `Elevated error rate (${(errorRate * 100).toFixed(1)}%)`,
      detail: worst
        ? `${worst.name}: ${worst.errorCount} errors, first at line ${worst.sampleLine + 1}. Overall error rate ${(errorRate * 100).toFixed(1)}%.`
        : `${errors} errors across ${analyzed.toLocaleString()} lines.`,
    };
  } else if (biggestGap && biggestGap.gapSeconds >= 30) {
    rootCause = events.find(e => e.kind === 'gap' && e.lineNumber === biggestGap.lineNumber) || null;
    verdict = {
      kind: 'stall', severity: 'warning',
      headline: `Possible hang — ${formatDuration(biggestGap.gapSeconds)} with no events`,
      detail: `Largest stall before line ${biggestGap.lineNumber + 1} (${biggestGap.prevTimestamp} → ${biggestGap.currTimestamp}).`,
    };
  } else if (warnings > 0 || errors > 0) {
    verdict = {
      kind: 'warnings', severity: 'warning',
      headline: `No crashes — ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} to review`,
      detail: `No fatal/crash keywords found, and no major stalls. Review the events below.`,
    };
  } else {
    verdict = {
      kind: 'clean', severity: 'info',
      headline: `No critical anomalies detected`,
      detail: `${totalLines.toLocaleString()} lines scanned. No crashes, no error storm, no major stalls.`,
    };
  }

  return {
    generatedAt: Date.now(),
    sourceFilePath: opts.sourceFilePath,
    fileName: opts.sourceFilePath ? (opts.sourceFilePath.split(/[\\/]/).pop() || 'log') : 'log',
    totalLines,
    levelCounts,
    errorRate,
    verdict,
    firstAnomaly,
    rootCause,
    timeline: events.slice(0, 40),
    topComponents: comps.slice(0, 5),
  };
}
