import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests for Context Search logic — pattern correlation with proximity matching.
 * Tests the core algorithm without requiring Electron.
 */

// --- Types (mirrored from shared/types.ts) ---

interface ContextPattern {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  role: 'must' | 'clue';
  distance?: number;
  timeWindow?: number;
}

interface ContextDefinition {
  id: string;
  name: string;
  color: string;
  patterns: ContextPattern[];
  proximityMode: 'lines' | 'time' | 'both';
  defaultDistance: number;
  defaultTimeWindow?: number;
  enabled: boolean;
  isGlobal: boolean;
  createdAt: number;
}

interface ContextMatchGroup {
  contextId: string;
  mustLine: number;
  mustText: string;
  mustPatternId: string;
  clues: Array<{
    lineNumber: number;
    text: string;
    patternId: string;
    distance: number;
  }>;
  score: number;
}

// --- Standalone context search engine (mirrors main process logic) ---

function runContextSearch(
  lines: string[],
  definitions: ContextDefinition[],
): Array<{ contextId: string; groups: ContextMatchGroup[] }> {
  const results: Array<{ contextId: string; groups: ContextMatchGroup[] }> = [];

  for (const ctx of definitions) {
    if (!ctx.enabled) continue;
    const mustPatterns = ctx.patterns.filter(p => p.role === 'must');
    const cluePatterns = ctx.patterns.filter(p => p.role === 'clue');
    if (mustPatterns.length === 0) continue;

    const groups: ContextMatchGroup[] = [];

    for (const mustPat of mustPatterns) {
      let mustRegex: RegExp;
      try {
        mustRegex = mustPat.isRegex
          ? new RegExp(mustPat.pattern, mustPat.matchCase ? '' : 'i')
          : new RegExp(mustPat.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), mustPat.matchCase ? '' : 'i');
      } catch { continue; }

      // Find all must matches
      for (let i = 0; i < lines.length; i++) {
        if (!mustRegex.test(lines[i])) continue;

        const distance = ctx.defaultDistance || 10;
        const windowStart = Math.max(0, i - distance);
        const windowEnd = Math.min(lines.length - 1, i + distance);

        const clues: ContextMatchGroup['clues'] = [];

        for (const cluePat of cluePatterns) {
          const clueDistance = cluePat.distance ?? distance;
          let clueRegex: RegExp;
          try {
            clueRegex = cluePat.isRegex
              ? new RegExp(cluePat.pattern, cluePat.matchCase ? '' : 'i')
              : new RegExp(cluePat.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cluePat.matchCase ? '' : 'i');
          } catch { continue; }

          for (let j = windowStart; j <= windowEnd; j++) {
            if (j === i) continue; // skip must-match line itself
            const lineDist = Math.abs(j - i);
            if (lineDist > clueDistance) continue;
            if (clueRegex.test(lines[j])) {
              clues.push({
                lineNumber: j,
                text: lines[j],
                patternId: cluePat.id,
                distance: lineDist,
              });
            }
          }
        }

        if (clues.length > 0) {
          groups.push({
            contextId: ctx.id,
            mustLine: i,
            mustText: lines[i],
            mustPatternId: mustPat.id,
            clues,
            score: clues.length,
          });
        }
      }
    }

    results.push({ contextId: ctx.id, groups });
  }

  return results;
}

// --- Context definitions persistence ---

function loadContextDefinitions(filePath: string): Record<string, ContextDefinition[]> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveContextDefinitions(filePath: string, store: Record<string, ContextDefinition[]>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

// --- Tests ---

describe('Context Search — Core Algorithm', () => {
  const sampleLines = [
    '2024-01-15 10:00:00 INFO  Application started',         // 0
    '2024-01-15 10:00:01 INFO  Loading config',               // 1
    '2024-01-15 10:00:02 ERROR Login failed for user admin',  // 2
    '2024-01-15 10:00:03 WARN  Account locked after 3 tries', // 3
    '2024-01-15 10:00:04 INFO  Retry attempt scheduled',      // 4
    '2024-01-15 10:00:05 INFO  Processing queue',             // 5
    '2024-01-15 10:00:06 INFO  Request completed',            // 6
    '2024-01-15 10:00:07 ERROR Login failed for user bob',    // 7
    '2024-01-15 10:00:08 INFO  Sending notification',         // 8
    '2024-01-15 10:00:09 WARN  Account locked after 5 tries', // 9
    '2024-01-15 10:00:10 INFO  Retry attempt scheduled',      // 10
    '2024-01-15 10:00:11 INFO  Cleanup started',              // 11
  ];

  function makeContext(overrides: Partial<ContextDefinition> = {}): ContextDefinition {
    return {
      id: 'ctx-test',
      name: 'Test Context',
      color: '#e74c3c',
      patterns: [],
      proximityMode: 'lines',
      defaultDistance: 5,
      enabled: true,
      isGlobal: false,
      createdAt: Date.now(),
      ...overrides,
    };
  }

  it('should find must+clue matches within proximity', () => {
    const ctx = makeContext({
      patterns: [
        { id: 'must-1', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'Account locked', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    expect(results).toHaveLength(1);
    expect(results[0].groups.length).toBe(2); // Two "Login failed" lines

    // First group at line 2
    const g1 = results[0].groups[0];
    expect(g1.mustLine).toBe(2);
    expect(g1.clues.length).toBe(1);
    expect(g1.clues[0].lineNumber).toBe(3); // "Account locked" at line 3
    expect(g1.clues[0].distance).toBe(1);

    // Second group at line 7
    const g2 = results[0].groups[1];
    expect(g2.mustLine).toBe(7);
    // "Account locked" at line 3 (dist 4) AND line 9 (dist 2) — both within defaultDistance 5
    expect(g2.clues.length).toBe(2);
    expect(g2.clues.some(c => c.lineNumber === 3)).toBe(true);
    expect(g2.clues.some(c => c.lineNumber === 9)).toBe(true);
  });

  it('should respect defaultDistance', () => {
    const ctx = makeContext({
      defaultDistance: 1, // Very tight window
      patterns: [
        { id: 'must-1', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'Account locked', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    // Line 2 → "Account locked" at line 3 (distance 1, within range)
    // Line 7 → "Account locked" at line 9 (distance 2, OUT of range)
    expect(results[0].groups.length).toBe(1);
    expect(results[0].groups[0].mustLine).toBe(2);
  });

  it('should respect per-clue distance override', () => {
    const ctx = makeContext({
      defaultDistance: 10,
      patterns: [
        { id: 'must-1', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'Account locked', isRegex: false, matchCase: false, role: 'clue', distance: 1 },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    // Only line 2 has "Account locked" within distance 1
    expect(results[0].groups.length).toBe(1);
    expect(results[0].groups[0].mustLine).toBe(2);
  });

  it('should support regex patterns', () => {
    const ctx = makeContext({
      patterns: [
        { id: 'must-1', pattern: 'Login failed.*user (\\w+)', isRegex: true, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'Retry attempt', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    expect(results[0].groups.length).toBe(2);
  });

  it('should respect matchCase flag', () => {
    const ctx = makeContext({
      patterns: [
        { id: 'must-1', pattern: 'login failed', isRegex: false, matchCase: true, role: 'must' },
        { id: 'clue-1', pattern: 'Account locked', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    // "Login failed" won't match case-sensitive "login failed"
    expect(results[0].groups.length).toBe(0);
  });

  it('should handle multiple clue patterns', () => {
    const ctx = makeContext({
      defaultDistance: 5,
      patterns: [
        { id: 'must-1', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'Account locked', isRegex: false, matchCase: false, role: 'clue' },
        { id: 'clue-2', pattern: 'Retry attempt', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    // Line 2: Account locked (line 3, dist 1) + Retry attempt (line 4, dist 2) = 2 clues
    expect(results[0].groups[0].score).toBe(2);
    expect(results[0].groups[0].clues.length).toBe(2);
  });

  it('should skip disabled contexts', () => {
    const ctx = makeContext({
      enabled: false,
      patterns: [
        { id: 'must-1', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'Account locked', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    expect(results).toHaveLength(0);
  });

  it('should skip contexts with no must patterns', () => {
    const ctx = makeContext({
      patterns: [
        { id: 'clue-1', pattern: 'Account locked', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    // Context with only clues and no must patterns produces no results entry
    expect(results).toHaveLength(0);
  });

  it('should return empty groups when must matches but no clues nearby', () => {
    const ctx = makeContext({
      defaultDistance: 1,
      patterns: [
        { id: 'must-1', pattern: 'Application started', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx]);
    // "Application started" is at line 0, "Login failed" at line 2 — distance 2 > 1
    expect(results[0].groups.length).toBe(0);
  });

  it('should not include must-match line as its own clue', () => {
    // Pattern that matches same line as both must and clue
    const lines = ['ERROR Login failed ERROR'];
    const ctx = makeContext({
      patterns: [
        { id: 'must-1', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'ERROR', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(lines, [ctx]);
    // Must-match at line 0, but clue should NOT include line 0 itself
    expect(results[0].groups.length).toBe(0);
  });

  it('should handle multiple contexts independently', () => {
    const ctx1 = makeContext({
      id: 'ctx-auth',
      patterns: [
        { id: 'must-auth', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-auth', pattern: 'Account locked', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });
    const ctx2 = makeContext({
      id: 'ctx-perf',
      patterns: [
        { id: 'must-perf', pattern: 'Processing queue', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-perf', pattern: 'Request completed', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(sampleLines, [ctx1, ctx2]);
    expect(results).toHaveLength(2);
    expect(results[0].contextId).toBe('ctx-auth');
    expect(results[1].contextId).toBe('ctx-perf');
    expect(results[0].groups.length).toBe(2); // Two login failures
    expect(results[1].groups.length).toBe(1); // One processing queue
  });

  it('should handle invalid regex gracefully', () => {
    const ctx = makeContext({
      patterns: [
        { id: 'must-1', pattern: '[invalid regex', isRegex: true, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'whatever', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    // Should not throw
    const results = runContextSearch(sampleLines, [ctx]);
    expect(results[0].groups.length).toBe(0);
  });

  it('should handle empty lines array', () => {
    const ctx = makeContext({
      patterns: [
        { id: 'must-1', pattern: 'test', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'clue', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch([], [ctx]);
    expect(results[0].groups.length).toBe(0);
  });

  it('should handle empty definitions array', () => {
    const results = runContextSearch(sampleLines, []);
    expect(results).toHaveLength(0);
  });

  it('should compute correct score as clue count', () => {
    const lines = [
      'ERROR crash detected',   // 0 - must
      'stack trace line 1',     // 1 - clue
      'stack trace line 2',     // 2 - clue
      'heap dump available',    // 3 - clue
    ];
    const ctx = makeContext({
      defaultDistance: 5,
      patterns: [
        { id: 'must-1', pattern: 'crash detected', isRegex: false, matchCase: false, role: 'must' },
        { id: 'clue-1', pattern: 'stack trace', isRegex: false, matchCase: false, role: 'clue' },
        { id: 'clue-2', pattern: 'heap dump', isRegex: false, matchCase: false, role: 'clue' },
      ],
    });

    const results = runContextSearch(lines, [ctx]);
    expect(results[0].groups[0].score).toBe(3); // 2 stack traces + 1 heap dump
  });
});

describe('Context Definitions — Persistence', () => {
  const tmpDir = path.join(os.tmpdir(), `logan-ctx-test-${Date.now()}`);
  const defsFile = path.join(tmpDir, 'context-definitions.json');

  it('should return empty object for missing file', () => {
    const store = loadContextDefinitions('/nonexistent/file.json');
    expect(store).toEqual({});
  });

  it('should save and load definitions', () => {
    const defs: Record<string, ContextDefinition[]> = {
      '/tmp/test.log': [
        {
          id: 'ctx-1',
          name: 'Auth Failure',
          color: '#e74c3c',
          patterns: [
            { id: 'must-1', pattern: 'Login failed', isRegex: false, matchCase: false, role: 'must' },
          ],
          proximityMode: 'lines',
          defaultDistance: 10,
          enabled: true,
          isGlobal: false,
          createdAt: Date.now(),
        },
      ],
    };

    saveContextDefinitions(defsFile, defs);
    const loaded = loadContextDefinitions(defsFile);
    expect(loaded['/tmp/test.log']).toHaveLength(1);
    expect(loaded['/tmp/test.log'][0].name).toBe('Auth Failure');
  });

  it('should support multiple files in same store', () => {
    const defs: Record<string, ContextDefinition[]> = {
      '/tmp/a.log': [
        { id: 'ctx-a', name: 'A', color: '#000', patterns: [], proximityMode: 'lines', defaultDistance: 5, enabled: true, isGlobal: false, createdAt: 1 },
      ],
      '/tmp/b.log': [
        { id: 'ctx-b', name: 'B', color: '#fff', patterns: [], proximityMode: 'lines', defaultDistance: 5, enabled: true, isGlobal: false, createdAt: 2 },
      ],
    };

    saveContextDefinitions(defsFile, defs);
    const loaded = loadContextDefinitions(defsFile);
    expect(Object.keys(loaded)).toHaveLength(2);
    expect(loaded['/tmp/a.log'][0].id).toBe('ctx-a');
    expect(loaded['/tmp/b.log'][0].id).toBe('ctx-b');
  });

  it('should handle corrupt JSON file gracefully', () => {
    fs.writeFileSync(defsFile, 'not json!!!', 'utf-8');
    const store = loadContextDefinitions(defsFile);
    expect(store).toEqual({});
  });

  // Cleanup
  it('cleanup', () => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
  });
});
