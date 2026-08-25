// ─── LOGAN Log Analysis Report: the canonical, shareable .md format ──────────
// Pure, deterministic markdown assembly used by /api/save-report →
// logan_save_report. No fs, no electron, no Date.now() — the caller supplies the
// timestamp AND the raw log-line text (fetched from the file handler), so this
// module stays trivially unit-testable (see src/tests/reportDoc.test.ts).
//
// This is LOGAN's universal report shape (see docs/LOGAN_REPORT_FORMAT.md):
//   front-matter → title → aim/reason → metadata → summary → verdict →
//   FINDINGS (each with the actual related log-line SEQUENCE + description) →
//   timeline → steps taken.
// Every finding embeds its real log lines (the match + surrounding context) in a
// fenced code block so the doc is self-contained and pastes cleanly into Jira.

import type { ConclusionReport } from './conclusion';

export const LOGAN_REPORT_FORMAT_VERSION = 1;

// A single raw log line in a finding's related sequence.
export interface ReportLogLine {
  viewerLine: number;         // 1-based, as shown in the viewer
  text: string;               // the raw log line
  isMatch?: boolean;          // true for the finding line(s), false for context
}

export interface ReportFinding {
  viewerLine: number;         // 1-based
  endLine?: number;           // 1-based inclusive range end, if a span
  title: string;
  detail?: string;
  severity?: string;          // error | warning | info
  logLines?: ReportLogLine[]; // the related log sequence (match + context)
}

export interface ReportStep {
  label: string;              // human-readable step label (journal entry)
  result?: string;            // compact result summary, if captured
}

export interface ReportDocInput {
  name: string;               // report title (also the basis for the filename)
  aim: string;                // what the investigation set out to find/prove
  reason: string;             // why it was run — the trigger / symptom / context
  ticket?: string;            // optional ticket id/name
  body?: string;              // agent's freeform narrative (markdown allowed)
  sourceFilePath?: string | null;
  totalLines?: number;
  generatedAtIso: string;     // caller supplies (keeps this module pure)
  agentName?: string;
  findings?: ReportFinding[];
  steps?: ReportStep[];
  conclusion?: ConclusionReport | null;
  // viewerLine (1-based) → raw log text, for the verdict's key evidence lines.
  eventLines?: Record<number, string>;
}

// Longest single log line we embed verbatim before eliding the tail.
const MAX_LINE_CHARS = 4000;

// Filesystem-safe, human-readable slug for the report filename.
export function slugifyReportName(name: string): string {
  const slug = (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'report';
}

export function reportFileName(name: string): string {
  return `${slugifyReportName(name)}.report.md`;
}

// Base last path segment of a file path, without pulling in node's `path`.
function baseName(p?: string | null): string {
  if (!p) return '(no file)';
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

// Single-line, quote-safe value for YAML front-matter.
function yamlValue(v: string): string {
  const clean = v.replace(/[\r\n]+/g, ' ').replace(/"/g, '\\"').trim();
  return `"${clean}"`;
}

function severityTag(sev?: string): string {
  const s = (sev || 'info').toLowerCase();
  return `[${s}]`;
}

function lineRef(viewerLine: number, endLine?: number): string {
  return endLine && endLine !== viewerLine ? `lines ${viewerLine}–${endLine}` : `line ${viewerLine}`;
}

// One log line, trimmed of a trailing CR and capped so a pathological 100k-char
// line can't blow up the doc.
function clipText(text: string): string {
  const t = (text ?? '').replace(/\r$/, '');
  if (t.length <= MAX_LINE_CHARS) return t;
  return `${t.slice(0, MAX_LINE_CHARS)} …[+${t.length - MAX_LINE_CHARS} chars]`;
}

// Render a sequence of raw log lines as a fenced block with a line-number gutter.
// The finding line(s) are flagged with a ► marker; context lines get a space.
// Pastes verbatim into Jira / GitHub code blocks.
function renderLogSequence(lines: ReportLogLine[]): string[] {
  const width = Math.max(...lines.map((l) => String(l.viewerLine).length));
  const out: string[] = ['```text'];
  for (const l of lines) {
    const marker = l.isMatch ? '►' : ' ';
    out.push(`${marker} ${String(l.viewerLine).padStart(width)} | ${clipText(l.text)}`);
  }
  out.push('```');
  return out;
}

// Assemble the full markdown document.
export function buildReportMarkdown(input: ReportDocInput): string {
  const {
    name, aim, reason, ticket, body,
    sourceFilePath, totalLines, generatedAtIso, agentName,
    findings = [], steps = [], conclusion = null, eventLines = {},
  } = input;

  const author = agentName || 'LOGAN agent';
  const out: string[] = [];

  // --- YAML front-matter (metadata, machine-readable) ---
  out.push('---');
  out.push(`logan_report: ${LOGAN_REPORT_FORMAT_VERSION}`);
  out.push(`title: ${yamlValue(name)}`);
  out.push(`aim: ${yamlValue(aim)}`);
  out.push(`reason: ${yamlValue(reason)}`);
  if (ticket) out.push(`ticket: ${yamlValue(ticket)}`);
  out.push(`source: ${yamlValue(sourceFilePath || '')}`);
  out.push(`generated: ${yamlValue(generatedAtIso)}`);
  out.push(`author: ${yamlValue(author)}`);
  out.push('---');
  out.push('');

  // --- Title + aim/reason callout ---
  out.push(`# ${name}`);
  out.push('');
  out.push('*LOGAN Log Analysis Report*');
  out.push('');
  out.push(`> **Aim** — ${aim || '_(not stated)_'}`);
  out.push(`>`);
  out.push(`> **Reason** — ${reason || '_(not stated)_'}`);
  out.push('');

  // --- Metadata table ---
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Ticket | ${ticket ? ticket : '—'} |`);
  out.push(`| Source log | \`${baseName(sourceFilePath)}\` |`);
  if (typeof totalLines === 'number') out.push(`| Total lines | ${totalLines.toLocaleString('en-US')} |`);
  out.push(`| Generated | ${generatedAtIso} |`);
  out.push(`| Author | ${author} |`);
  out.push('');

  // --- Narrative ---
  if (body && body.trim()) {
    out.push('## Summary');
    out.push('');
    out.push(body.trim());
    out.push('');
  }

  // --- Verdict (opt-in conclusion) ---
  if (conclusion) {
    out.push('## Verdict');
    out.push('');
    out.push(`**${conclusion.verdict.headline}**`);
    if (conclusion.verdict.detail) {
      out.push('');
      out.push(conclusion.verdict.detail);
    }
    out.push('');
    if (conclusion.firstAnomaly) {
      const fa = conclusion.firstAnomaly;
      out.push(`- **First anomaly** — ${fa.label} (line ${fa.viewerLine ?? fa.lineNumber + 1})`);
    }
    if (conclusion.rootCause) {
      const rc = conclusion.rootCause;
      out.push(`- **Likely root cause** — ${rc.label} (line ${rc.viewerLine ?? rc.lineNumber + 1})`);
    }
    out.push('');

    // The actual log lines behind the verdict, if the caller resolved them.
    const keyLines: ReportLogLine[] = [];
    const seen = new Set<number>();
    for (const ev of [conclusion.firstAnomaly, conclusion.rootCause]) {
      if (!ev) continue;
      const vl = ev.viewerLine ?? ev.lineNumber + 1;
      const text = eventLines[vl];
      if (text !== undefined && !seen.has(vl)) {
        seen.add(vl);
        keyLines.push({ viewerLine: vl, text, isMatch: true });
      }
    }
    if (keyLines.length) {
      out.push('**Evidence lines**');
      out.push('');
      keyLines.sort((a, b) => a.viewerLine - b.viewerLine);
      out.push(...renderLogSequence(keyLines));
      out.push('');
    }

    if (conclusion.timeline && conclusion.timeline.length) {
      out.push('### Timeline');
      out.push('');
      for (const e of conclusion.timeline) {
        const vl = e.viewerLine ?? e.lineNumber + 1;
        const detail = e.detail ? ` — ${e.detail}` : '';
        out.push(`- line ${vl} · ${e.label}${detail}`);
      }
      out.push('');
    }
  }

  // --- Findings — each with its related log-line SEQUENCE + description ---
  if (findings.length) {
    out.push(`## Findings (${findings.length})`);
    out.push('');
    findings.forEach((f, i) => {
      out.push(`### ${i + 1}. ${severityTag(f.severity)} ${f.title}`);
      out.push('');
      out.push(`**Location** — ${lineRef(f.viewerLine, f.endLine)}`);
      out.push('');
      if (f.detail && f.detail.trim()) {
        out.push(f.detail.trim());
        out.push('');
      }
      if (f.logLines && f.logLines.length) {
        out.push(...renderLogSequence(f.logLines));
        out.push('');
      }
    });
  }

  // --- Steps taken (recorded investigation journal) ---
  if (steps.length) {
    out.push(`## Steps taken (${steps.length})`);
    out.push('');
    steps.forEach((s, i) => {
      const result = s.result ? ` → ${s.result}` : '';
      out.push(`${i + 1}. ${s.label}${result}`);
    });
    out.push('');
  }

  out.push('---');
  out.push(`*Generated by LOGAN — ${generatedAtIso}*`);
  out.push('');

  return out.join('\n');
}
