import { describe, it, expect } from 'vitest';
import { runRecipe, RECIPE_SYMPTOMS, type ApiCall } from '../mcp-server/recipes';

// A scriptable fake of the LOGAN HTTP API. Each test supplies the responses it needs;
// every call is recorded so we can assert the recipe wired the right primitives.
function makeApi(responses: Record<string, any>): { api: ApiCall; calls: Array<{ method: string; path: string; body?: any }> } {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const api: ApiCall = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path in responses) {
      const r = responses[path];
      return typeof r === 'function' ? r(body) : r;
    }
    return { success: true };
  };
  return { api, calls };
}

describe('triage recipe engine', () => {
  it('exposes the eight symptoms', () => {
    expect(RECIPE_SYMPTOMS).toHaveLength(8);
    expect(RECIPE_SYMPTOMS).toContain('crash');
    expect(RECIPE_SYMPTOMS).toContain('wrong-value');
  });

  it('crash recipe maps analyzer crashes to 1-based findings and flags the last one', async () => {
    const { api, calls } = makeApi({
      '/api/get-lines': { lines: [] },
      '/api/analyze': {
        result: {
          insights: {
            crashes: [
              { keyword: 'FATAL', lineNumber: 41, text: 'boom one' },   // 0-based
              { keyword: 'NPE', lineNumber: 9, text: 'null deref' },
              { keyword: 'FATAL', lineNumber: 80, text: 'boom last' },
            ],
          },
        },
      },
    });
    const res = await runRecipe(api, { symptom: 'crash', pin: false, domain: 'generic' });

    // First finding is the death point (last crash by line), 1-based.
    expect(res.findings[0].lineNumber).toBe(81);
    expect(res.findings[0].title).toMatch(/Last line before death/);
    // Unique keywords surfaced afterwards.
    expect(res.findings.some((f) => f.title === 'Crash: NPE' && f.lineNumber === 10)).toBe(true);
    expect(res.symptom).toBe('crash');
    // No annotate calls when pin:false.
    expect(calls.some((c) => c.path === '/api/annotate')).toBe(false);
  });

  it('hang recipe converts time gaps to warnings with seconds in the title', async () => {
    const { api } = makeApi({
      '/api/get-lines': { lines: [] },
      '/api/time-gaps': { success: true, gaps: [{ lineNumber: 199, gapSeconds: 123.7, linePreview: 'resumed' }] },
    });
    const res = await runRecipe(api, { symptom: 'hang', pin: false, domain: 'generic' });
    expect(res.findings[0]).toMatchObject({ lineNumber: 200, severity: 'warning' });
    expect(res.findings[0].title).toMatch(/124s silence/);
  });

  it('caps findings to maxFindings (token economy)', async () => {
    const gaps = Array.from({ length: 50 }, (_, i) => ({ lineNumber: i, gapSeconds: 60 + i, linePreview: 'x' }));
    const { api } = makeApi({ '/api/get-lines': { lines: [] }, '/api/time-gaps': { success: true, gaps } });
    const res = await runRecipe(api, { symptom: 'hang', pin: false, domain: 'generic', maxFindings: 3 });
    expect(res.findings).toHaveLength(3);
  });

  it('pins findings: clears stale annotations, annotates 0-based, sends ONE summary message', async () => {
    const { api, calls } = makeApi({
      '/api/get-lines': { lines: [] },
      '/api/time-gaps': { success: true, gaps: [{ lineNumber: 9, gapSeconds: 99, linePreview: 'p' }] },
    });
    const res = await runRecipe(api, { symptom: 'hang', pin: true, domain: 'generic' });
    expect(res.pinnedCount).toBe(1);
    expect(calls.some((c) => c.path === '/api/annotation-clear')).toBe(true);
    const annotate = calls.find((c) => c.path === '/api/annotate');
    expect(annotate?.body.lineNumber).toBe(9); // 0-based (finding was 1-based 10)
    const messages = calls.filter((c) => c.path === '/api/agent-message');
    expect(messages).toHaveLength(1); // consolidated, not one per finding
  });

  it('flaky recipe asks for a field when none given, and trends transitions when given', async () => {
    const noField = await runRecipe(makeApi({ '/api/get-lines': { lines: [] } }).api, { symptom: 'flaky', pin: false, domain: 'generic' });
    expect(noField.findings).toHaveLength(0);
    expect(noField.nextQuestions.some((q) => q.id === 'field')).toBe(true);

    const { api } = makeApi({
      '/api/get-lines': { lines: [] },
      '/api/trend-transitions': { success: true, transitions: [{ fromValue: 'A', toValue: 'B', viewerLine: 55 }] },
    });
    const withField = await runRecipe(api, { symptom: 'flaky', field: 'state', pin: false, domain: 'generic' });
    expect(withField.findings[0]).toMatchObject({ lineNumber: 55, severity: 'warning' });
    expect(withField.findings[0].title).toMatch(/A → B/);
  });

  it('auto-detects domain from content', async () => {
    const androidText = Array(5).fill('AndroidRuntime FATAL EXCEPTION Choreographer ActivityManager').join('\n');
    const { api } = makeApi({
      '/api/get-lines': { lines: [{ text: androidText }] },
      '/api/analyze': { result: { insights: { crashes: [] } } },
      '/api/search': { matches: [] },
    });
    const res = await runRecipe(api, { symptom: 'crash', pin: false, domain: 'auto' });
    expect(res.domain).toBe('android');
  });

  it('every result carries the 5-Whys drill-down when there are findings', async () => {
    const { api } = makeApi({
      '/api/get-lines': { lines: [] },
      '/api/time-gaps': { success: true, gaps: [{ lineNumber: 5, gapSeconds: 70, linePreview: 'p' }] },
    });
    const res = await runRecipe(api, { symptom: 'hang', pin: false, domain: 'generic' });
    expect(res.drillDown).toHaveLength(3);
    expect(res.drillDown[0].label).toMatch(/right BEFORE/);
  });
});
