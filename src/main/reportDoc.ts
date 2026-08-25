// ─── Agent report doc: bundle an investigation into one self-contained .md ────
// Pure, deterministic markdown assembly used by /api/save-report →
// logan_save_report. No fs, no electron, no Date.now() — the caller supplies the
// timestamp and the main process resolves the sidecar path and writes the string
// this returns. Trivially unit-testable (see src/tests/reportDoc.test.ts).
//
// The doc gives the agent a durable, human-readable write-up of "what it has":
// a clear title, the AIM (what it set out to find/prove), the REASON (why — the
// trigger/context), an optional ticket, its narrative, and — folded in — the
// pinned findings, the recorded investigation steps, and (opt-in) the native
// root-cause verdict. Front-matter carries the same metadata for machine reuse.

import type { ConclusionReport } from './conclusion';

export interface ReportFinding {
  viewerLine: number;         // 1-based, as shown in the viewer
  endLine?: number;           // 1-based inclusive range end, if a span
  title: string;
  detail?: string;
  severity?: string;          // error | warning | info
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
}

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

// Assemble the full markdown document.
export function buildReportMarkdown(input: ReportDocInput): string {
  const {
    name, aim, reason, ticket, body,
    sourceFilePath, totalLines, generatedAtIso, agentName,
    findings = [], steps = [], conclusion = null,
  } = input;

  const author = agentName || 'LOGAN agent';
  const out: string[] = [];

  // --- YAML front-matter (metadata, machine-readable) ---
  out.push('---');
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

  // --- Findings (pinned annotations) ---
  if (findings.length) {
    out.push(`## Findings (${findings.length})`);
    out.push('');
    for (const f of findings) {
      out.push(`- **${severityTag(f.severity)}** ${f.title} — ${lineRef(f.viewerLine, f.endLine)}`);
      if (f.detail && f.detail.trim()) {
        out.push(`  ${f.detail.trim().replace(/\n/g, '\n  ')}`);
      }
    }
    out.push('');
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
