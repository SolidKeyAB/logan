import { describe, it, expect } from 'vitest';
import {
  buildReportMarkdown,
  slugifyReportName,
  reportFileName,
  type ReportDocInput,
} from '../main/reportDoc';
import type { ConclusionReport } from '../main/conclusion';

const BASE: ReportDocInput = {
  name: 'Auth token-expiry root cause',
  aim: 'Prove the 401 storm is driven by early token expiry',
  reason: 'SUS-1234 — users logged out mid-session after deploy',
  ticket: 'SUS-1234',
  sourceFilePath: '/tmp/logs/app.log',
  totalLines: 12345,
  generatedAtIso: '2026-08-25T10:00:00.000Z',
  agentName: 'Claude Code',
};

describe('slugifyReportName', () => {
  it('lowercases, dashes, and trims', () => {
    expect(slugifyReportName('Auth token-expiry root cause')).toBe('auth-token-expiry-root-cause');
  });
  it('strips punctuation and collapses runs', () => {
    expect(slugifyReportName('  Hello, World!!  ')).toBe('hello-world');
  });
  it('falls back to "report" when empty after cleaning', () => {
    expect(slugifyReportName('')).toBe('report');
    expect(slugifyReportName('!!!')).toBe('report');
  });
  it('caps length and has no trailing dash', () => {
    const s = slugifyReportName('a'.repeat(80) + ' end');
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('reportFileName', () => {
  it('appends the .report.md suffix', () => {
    expect(reportFileName('My Report')).toBe('my-report.report.md');
  });
});

describe('buildReportMarkdown', () => {
  it('emits YAML front-matter with name/aim/reason/ticket', () => {
    const md = buildReportMarkdown(BASE);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "Auth token-expiry root cause"');
    expect(md).toContain('aim: "Prove the 401 storm is driven by early token expiry"');
    expect(md).toContain('reason: "SUS-1234 — users logged out mid-session after deploy"');
    expect(md).toContain('ticket: "SUS-1234"');
    expect(md).toContain('author: "Claude Code"');
  });

  it('renders the title heading and aim/reason callout', () => {
    const md = buildReportMarkdown(BASE);
    expect(md).toContain('# Auth token-expiry root cause');
    expect(md).toContain('> **Aim** — Prove the 401 storm is driven by early token expiry');
    expect(md).toContain('> **Reason** — SUS-1234 — users logged out mid-session after deploy');
  });

  it('shows the source basename and total lines in the metadata table', () => {
    const md = buildReportMarkdown(BASE);
    expect(md).toContain('| Source log | `app.log` |');
    expect(md).toContain('| Total lines | 12,345 |');
    expect(md).toContain('| Ticket | SUS-1234 |');
  });

  it('omits the ticket front-matter line and shows an em dash when no ticket', () => {
    const md = buildReportMarkdown({ ...BASE, ticket: undefined });
    expect(md).not.toContain('ticket:');
    expect(md).toContain('| Ticket | — |');
  });

  it('includes the narrative body under a Summary heading', () => {
    const md = buildReportMarkdown({ ...BASE, body: 'The refresh call fired 5m early.' });
    expect(md).toContain('## Summary');
    expect(md).toContain('The refresh call fired 5m early.');
  });

  it('renders findings as sub-sections with severity, location, and description', () => {
    const md = buildReportMarkdown({
      ...BASE,
      findings: [
        { viewerLine: 8047, title: 'Token expired', detail: 'exp < now', severity: 'error' },
        { viewerLine: 100, endLine: 120, title: 'Retry loop', severity: 'warning' },
      ],
    });
    expect(md).toContain('## Findings (2)');
    expect(md).toContain('### 1. [error] Token expired');
    expect(md).toContain('**Location** — line 8047');
    expect(md).toContain('exp < now');
    expect(md).toContain('### 2. [warning] Retry loop');
    expect(md).toContain('**Location** — lines 100–120');
  });

  it('embeds the related log-line sequence with a gutter and ► match marker', () => {
    const md = buildReportMarkdown({
      ...BASE,
      findings: [
        {
          viewerLine: 8047,
          title: 'Token expired',
          severity: 'error',
          logLines: [
            { viewerLine: 8046, text: 'INFO refresh scheduled' },
            { viewerLine: 8047, text: 'ERROR token expired exp<now', isMatch: true },
            { viewerLine: 8048, text: 'WARN retrying auth' },
          ],
        },
      ],
    });
    expect(md).toContain('```text');
    // context lines get a leading space; the match line gets a ► marker
    expect(md).toContain('  8046 | INFO refresh scheduled');
    expect(md).toContain('► 8047 | ERROR token expired exp<now');
    expect(md).toContain('  8048 | WARN retrying auth');
  });

  it('clips a pathologically long log line', () => {
    const long = 'x'.repeat(5000);
    const md = buildReportMarkdown({
      ...BASE,
      findings: [
        { viewerLine: 5, title: 'huge', logLines: [{ viewerLine: 5, text: long, isMatch: true }] },
      ],
    });
    expect(md).toContain('…[+1000 chars]');
    expect(md).not.toContain('x'.repeat(4001));
  });

  it('renders steps as a numbered list with results', () => {
    const md = buildReportMarkdown({
      ...BASE,
      steps: [
        { label: "search 'token expired'", result: '42 matches' },
        { label: 'analyze' },
      ],
    });
    expect(md).toContain('## Steps taken (2)');
    expect(md).toContain("1. search 'token expired' → 42 matches");
    expect(md).toContain('2. analyze');
  });

  it('embeds the verdict + timeline when a conclusion is supplied', () => {
    const conclusion: ConclusionReport = {
      generatedAt: 0,
      sourceFilePath: '/tmp/logs/app.log',
      fileName: 'app.log',
      totalLines: 12345,
      levelCounts: { error: 200 },
      errorRate: 0.02,
      verdict: { kind: 'error-storm', headline: 'Token expiry storm', detail: '200 auth errors', severity: 'error' },
      firstAnomaly: { lineNumber: 4046, viewerLine: 4047, kind: 'error', label: 'first 401', severity: 'error' },
      rootCause: { lineNumber: 8046, viewerLine: 8047, kind: 'error', label: 'token exp', severity: 'error' },
      timeline: [
        { lineNumber: 4046, viewerLine: 4047, kind: 'error', label: 'first 401', severity: 'error' },
      ],
      topComponents: [],
    };
    const md = buildReportMarkdown({
      ...BASE,
      conclusion,
      eventLines: { 4047: 'ERROR 401 unauthorized', 8047: 'ERROR token exp<now' },
    });
    expect(md).toContain('## Verdict');
    expect(md).toContain('**Token expiry storm**');
    expect(md).toContain('**First anomaly** — first 401 (line 4047)');
    expect(md).toContain('**Likely root cause** — token exp (line 8047)');
    expect(md).toContain('**Evidence lines**');
    expect(md).toContain('► 4047 | ERROR 401 unauthorized');
    expect(md).toContain('► 8047 | ERROR token exp<now');
    expect(md).toContain('### Timeline');
    expect(md).toContain('- line 4047 · first 401');
  });

  it('renders a Components — potentially responsible section', () => {
    const md = buildReportMarkdown({
      ...BASE,
      components: [
        { name: 'auth', reason: '38 errors / 4 warnings', sampleLine: 8047 },
        { name: 'session', reason: '12 errors' },
        { name: 'gateway' },
      ],
    });
    expect(md).toContain('## Components — potentially responsible');
    expect(md).toContain('- **auth** — 38 errors / 4 warnings (e.g. line 8047)');
    expect(md).toContain('- **session** — 12 errors');
    expect(md).toContain('- **gateway**');
  });

  it('renders an Open questions checklist', () => {
    const md = buildReportMarkdown({
      ...BASE,
      questions: [
        'Did the 2.14 deploy change the refresh TTL?',
        'Are other services using the same expiry calc affected?',
      ],
    });
    expect(md).toContain('## Open questions');
    expect(md).toContain('- [ ] Did the 2.14 deploy change the refresh TTL?');
    expect(md).toContain('- [ ] Are other services using the same expiry calc affected?');
  });

  it('omits optional sections when empty', () => {
    const md = buildReportMarkdown(BASE);
    expect(md).not.toContain('## Summary');
    expect(md).not.toContain('## Findings');
    expect(md).not.toContain('## Steps taken');
    expect(md).not.toContain('## Verdict');
    expect(md).not.toContain('## Components');
    expect(md).not.toContain('## Open questions');
  });

  it('keeps front-matter single-line for multi-line reasons', () => {
    const md = buildReportMarkdown({ ...BASE, reason: 'line one\nline two' });
    expect(md).toContain('reason: "line one line two"');
  });
});
