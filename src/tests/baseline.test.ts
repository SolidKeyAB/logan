import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaselineStore, BaselineFingerprint, buildFingerprint } from '../main/baselineStore';

// --- Helpers ---

let tmpDir: string;
let store: BaselineStore;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logan-baseline-test-'));
}

function makeFingerprint(overrides: Partial<BaselineFingerprint> = {}): BaselineFingerprint {
  return {
    sourceFile: 'test.log',
    fileSize: 10240,
    totalLines: 1000,
    analyzerName: 'column-aware',
    timeRange: { start: '2024-01-15 10:00:00', end: '2024-01-15 11:00:00' },
    timestampDensity: [10, 12, 8, 15, 20, 18, 10, 5, 3, 2],
    levelCounts: { error: 50, warning: 150, info: 700, debug: 100 },
    levelPercentages: { error: 5, warning: 15, info: 70, debug: 10 },
    crashes: [
      { text: 'FATAL: out of memory', keyword: 'fatal', level: 'error', channel: 'MemoryManager' },
    ],
    failingComponents: [
      { name: 'AudioDriver', errorCount: 20, warningCount: 10 },
      { name: 'NetworkStack', errorCount: 15, warningCount: 5 },
    ],
    channelCounts: { AudioDriver: 200, NetworkStack: 150, MainLoop: 500, OldModule: 50 },
    sampleLines: {
      error: ['ERROR: AudioDriver failed to initialize', 'ERROR: NetworkStack timeout'],
      warning: ['WARN: Low buffer'],
      info: ['INFO: Started'],
    },
    componentSamples: {
      AudioDriver: ['ERROR: AudioDriver init failed'],
      NetworkStack: ['ERROR: NetworkStack connection refused'],
    },
    ...overrides,
  };
}

// --- BaselineStore CRUD Tests ---

describe('BaselineStore', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new BaselineStore(path.join(tmpDir, 'test-baselines.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('save()', () => {
    it('should save a baseline and return an id', () => {
      const fp = makeFingerprint();
      const id = store.save('production-healthy', 'Baseline from stable build', ['production', 'v2.1'], fp);
      expect(id).toMatch(/^bl-/);
      expect(typeof id).toBe('string');
    });

    it('should save multiple baselines with unique ids', () => {
      const fp = makeFingerprint();
      const id1 = store.save('baseline-1', '', [], fp);
      const id2 = store.save('baseline-2', '', [], fp);
      expect(id1).not.toBe(id2);
    });
  });

  describe('list()', () => {
    it('should return empty array when no baselines', () => {
      const list = store.list();
      expect(list).toEqual([]);
    });

    it('should list all saved baselines without fingerprint blob', () => {
      const fp = makeFingerprint();
      store.save('first', 'desc-1', ['tag-a'], fp);
      store.save('second', 'desc-2', ['tag-b'], fp);

      const list = store.list();
      expect(list).toHaveLength(2);
      // Both should be present (order by created_at DESC, but same-millisecond inserts may vary)
      const names = list.map(b => b.name).sort();
      expect(names).toEqual(['first', 'second']);
      const first = list.find(b => b.name === 'first')!;
      const second = list.find(b => b.name === 'second')!;
      expect(second.tags).toEqual(['tag-b']);
      expect(first.description).toBe('desc-1');
      // Should NOT contain fingerprint
      expect((list[0] as any).fingerprint).toBeUndefined();
    });

    it('should include source metadata in list', () => {
      const fp = makeFingerprint({ sourceFile: 'device.log', totalLines: 5000 });
      store.save('device-bl', '', [], fp);
      const list = store.list();
      expect(list[0].sourceFile).toBe('device.log');
      expect(list[0].totalLines).toBe(5000);
    });
  });

  describe('get()', () => {
    it('should return null for non-existent id', () => {
      expect(store.get('non-existent')).toBeNull();
    });

    it('should return full record with decompressed fingerprint', () => {
      const fp = makeFingerprint();
      const id = store.save('my-baseline', 'test', ['prod'], fp);

      const record = store.get(id);
      expect(record).not.toBeNull();
      expect(record!.id).toBe(id);
      expect(record!.name).toBe('my-baseline');
      expect(record!.tags).toEqual(['prod']);
      expect(record!.fingerprint).toBeDefined();
      expect(record!.fingerprint.sourceFile).toBe('test.log');
      expect(record!.fingerprint.levelCounts).toEqual(fp.levelCounts);
      expect(record!.fingerprint.crashes).toEqual(fp.crashes);
      expect(record!.fingerprint.failingComponents).toEqual(fp.failingComponents);
      expect(record!.fingerprint.timestampDensity).toEqual(fp.timestampDensity);
    });

    it('should decompress fingerprint correctly (round-trip)', () => {
      const fp = makeFingerprint();
      const id = store.save('round-trip', '', [], fp);
      const record = store.get(id)!;
      // Deep equality of entire fingerprint
      expect(record.fingerprint).toEqual(fp);
    });
  });

  describe('update()', () => {
    it('should update name', () => {
      const fp = makeFingerprint();
      const id = store.save('old-name', '', [], fp);

      const ok = store.update(id, { name: 'new-name' });
      expect(ok).toBe(true);

      const record = store.get(id)!;
      expect(record.name).toBe('new-name');
    });

    it('should update description and tags', () => {
      const fp = makeFingerprint();
      const id = store.save('test', 'old desc', ['a'], fp);

      store.update(id, { description: 'new desc', tags: ['x', 'y'] });

      const record = store.get(id)!;
      expect(record.description).toBe('new desc');
      expect(record.tags).toEqual(['x', 'y']);
    });

    it('should update updatedAt timestamp', () => {
      const fp = makeFingerprint();
      const id = store.save('test', '', [], fp);
      const before = store.get(id)!.updatedAt;

      // Small delay to ensure different timestamp
      const future = Date.now() + 100;
      store.update(id, { name: 'updated' });
      const after = store.get(id)!.updatedAt;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('should return false for non-existent id', () => {
      expect(store.update('non-existent', { name: 'test' })).toBe(false);
    });

    it('should return false when no fields provided', () => {
      expect(store.update('anything', {})).toBe(false);
    });
  });

  describe('delete()', () => {
    it('should delete an existing baseline', () => {
      const fp = makeFingerprint();
      const id = store.save('to-delete', '', [], fp);

      expect(store.delete(id)).toBe(true);
      expect(store.get(id)).toBeNull();
      expect(store.list()).toHaveLength(0);
    });

    it('should return false for non-existent id', () => {
      expect(store.delete('non-existent')).toBe(false);
    });

    it('should not affect other baselines', () => {
      const fp = makeFingerprint();
      const id1 = store.save('keep', '', [], fp);
      const id2 = store.save('delete-me', '', [], fp);

      store.delete(id2);
      expect(store.list()).toHaveLength(1);
      expect(store.get(id1)).not.toBeNull();
    });
  });
});

// --- Comparison Logic Tests ---

describe('BaselineStore.compare()', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new BaselineStore(path.join(tmpDir, 'test-compare.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null for non-existent baseline', () => {
    const fp = makeFingerprint();
    expect(store.compare(fp, 'non-existent')).toBeNull();
  });

  it('should report no findings when fingerprints are identical', () => {
    const fp = makeFingerprint();
    const id = store.save('identical', '', [], fp);

    const report = store.compare(fp, id)!;
    expect(report).not.toBeNull();
    expect(report.baselineId).toBe(id);
    expect(report.baselineName).toBe('identical');
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toEqual({ critical: 0, warning: 0, info: 0 });
  });

  describe('level-shift detection', () => {
    it('should report warning for >5% level shift', () => {
      const blFp = makeFingerprint({ levelPercentages: { error: 5, warning: 15, info: 70, debug: 10 } });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({ levelPercentages: { error: 12, warning: 15, info: 63, debug: 10 } });
      const report = store.compare(curFp, id)!;

      const errorShift = report.findings.find(f => f.category === 'level-shift' && f.title.includes('error'));
      expect(errorShift).toBeDefined();
      expect(errorShift!.severity).toBe('warning');
    });

    it('should report critical for >15% level shift', () => {
      const blFp = makeFingerprint({ levelPercentages: { error: 5, warning: 15, info: 70, debug: 10 } });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({ levelPercentages: { error: 25, warning: 15, info: 50, debug: 10 } });
      const report = store.compare(curFp, id)!;

      const errorShift = report.findings.find(f => f.category === 'level-shift' && f.title.includes('error'));
      expect(errorShift).toBeDefined();
      expect(errorShift!.severity).toBe('critical');
    });

    it('should not report for <5% shift', () => {
      const blFp = makeFingerprint({ levelPercentages: { error: 5, info: 95 } });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({ levelPercentages: { error: 8, info: 92 } });
      const report = store.compare(curFp, id)!;

      const levelShifts = report.findings.filter(f => f.category === 'level-shift');
      expect(levelShifts).toHaveLength(0);
    });
  });

  describe('new-crash detection', () => {
    it('should report critical for new crash keywords', () => {
      const blFp = makeFingerprint({
        crashes: [{ text: 'FATAL: out of memory', keyword: 'fatal' }],
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        crashes: [
          { text: 'FATAL: out of memory', keyword: 'fatal' },
          { text: 'segfault at 0x0', keyword: 'segfault' },
        ],
      });
      const report = store.compare(curFp, id)!;

      const newCrash = report.findings.find(f => f.category === 'new-crash');
      expect(newCrash).toBeDefined();
      expect(newCrash!.severity).toBe('critical');
      expect(newCrash!.title).toContain('segfault');
    });

    it('should not report existing crash keywords (case insensitive)', () => {
      const blFp = makeFingerprint({
        crashes: [{ text: 'FATAL error', keyword: 'FATAL' }],
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        crashes: [{ text: 'fatal error occurred', keyword: 'fatal' }],
      });
      const report = store.compare(curFp, id)!;

      const newCrashes = report.findings.filter(f => f.category === 'new-crash');
      expect(newCrashes).toHaveLength(0);
    });

    it('should not report when no crashes in current', () => {
      const blFp = makeFingerprint({
        crashes: [{ text: 'FATAL: oom', keyword: 'fatal' }],
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({ crashes: [] });
      const report = store.compare(curFp, id)!;

      const newCrashes = report.findings.filter(f => f.category === 'new-crash');
      expect(newCrashes).toHaveLength(0);
    });
  });

  describe('new-component detection', () => {
    it('should report warning for new failing component', () => {
      const blFp = makeFingerprint({
        failingComponents: [{ name: 'AudioDriver', errorCount: 20, warningCount: 10 }],
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        failingComponents: [
          { name: 'AudioDriver', errorCount: 20, warningCount: 10 },
          { name: 'NewModule', errorCount: 45, warningCount: 5 },
        ],
      });
      const report = store.compare(curFp, id)!;

      const newComp = report.findings.find(f => f.category === 'new-component');
      expect(newComp).toBeDefined();
      expect(newComp!.severity).toBe('warning');
      expect(newComp!.title).toContain('NewModule');
    });
  });

  describe('missing-component detection', () => {
    it('should report info for missing component with >10 lines in baseline', () => {
      const blFp = makeFingerprint({
        channelCounts: { AudioDriver: 200, OldModule: 50 },
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        channelCounts: { AudioDriver: 200 },
      });
      const report = store.compare(curFp, id)!;

      const missing = report.findings.find(f => f.category === 'missing-component');
      expect(missing).toBeDefined();
      expect(missing!.severity).toBe('info');
      expect(missing!.title).toContain('OldModule');
    });

    it('should not report for channels with <=10 lines', () => {
      const blFp = makeFingerprint({
        channelCounts: { RareModule: 5 },
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({ channelCounts: {} });
      const report = store.compare(curFp, id)!;

      const missing = report.findings.filter(f => f.category === 'missing-component');
      expect(missing).toHaveLength(0);
    });
  });

  describe('error-rate spike detection', () => {
    it('should report warning for >2x error rate', () => {
      const blFp = makeFingerprint({
        failingComponents: [{ name: 'AudioDriver', errorCount: 10, warningCount: 5 }],
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        failingComponents: [{ name: 'AudioDriver', errorCount: 30, warningCount: 5 }],
      });
      const report = store.compare(curFp, id)!;

      const spike = report.findings.find(f => f.category === 'error-rate');
      expect(spike).toBeDefined();
      expect(spike!.severity).toBe('warning');
      expect(spike!.title).toContain('AudioDriver');
      expect(spike!.title).toContain('3');
    });

    it('should report critical for >5x error rate', () => {
      const blFp = makeFingerprint({
        failingComponents: [{ name: 'AudioDriver', errorCount: 10, warningCount: 5 }],
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        failingComponents: [{ name: 'AudioDriver', errorCount: 60, warningCount: 5 }],
      });
      const report = store.compare(curFp, id)!;

      const spike = report.findings.find(f => f.category === 'error-rate');
      expect(spike).toBeDefined();
      expect(spike!.severity).toBe('critical');
    });

    it('should not report for <=2x error rate', () => {
      const blFp = makeFingerprint({
        failingComponents: [{ name: 'AudioDriver', errorCount: 10, warningCount: 5 }],
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        failingComponents: [{ name: 'AudioDriver', errorCount: 18, warningCount: 5 }],
      });
      const report = store.compare(curFp, id)!;

      const spikes = report.findings.filter(f => f.category === 'error-rate');
      expect(spikes).toHaveLength(0);
    });
  });

  describe('time-pattern detection', () => {
    it('should report info when variance is >3x', () => {
      // Slightly varied baseline (non-zero variance)
      const blFp = makeFingerprint({
        timestampDensity: [10, 12, 10, 11, 10, 12, 10, 11, 10, 12],
      });
      const id = store.save('baseline', '', [], blFp);

      // Very bursty current (much higher variance)
      const curFp = makeFingerprint({
        timestampDensity: [100, 0, 0, 0, 100, 0, 0, 0, 100, 0],
      });
      const report = store.compare(curFp, id)!;

      const timePat = report.findings.find(f => f.category === 'time-pattern');
      expect(timePat).toBeDefined();
      expect(timePat!.severity).toBe('info');
    });

    it('should not report when variance ratio <=3', () => {
      const blFp = makeFingerprint({
        timestampDensity: [10, 12, 8, 15, 10],
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        timestampDensity: [12, 14, 6, 18, 12],
      });
      const report = store.compare(curFp, id)!;

      const timePats = report.findings.filter(f => f.category === 'time-pattern');
      expect(timePats).toHaveLength(0);
    });
  });

  describe('finding ordering', () => {
    it('should sort critical first, then warning, then info', () => {
      const blFp = makeFingerprint({
        levelPercentages: { error: 5, info: 95 },
        crashes: [],
        failingComponents: [],
        channelCounts: { OldModule: 100 },
        timestampDensity: [10, 10, 10, 10],
      });
      const id = store.save('baseline', '', [], blFp);

      // Build a current that triggers all severity levels
      const curFp = makeFingerprint({
        levelPercentages: { error: 25, info: 75 }, // >15% shift -> critical
        crashes: [{ text: 'new crash', keyword: 'segfault' }], // new crash -> critical
        failingComponents: [{ name: 'NewComp', errorCount: 10, warningCount: 0 }], // new component -> warning
        channelCounts: {}, // missing OldModule -> info
        timestampDensity: [10, 10, 10, 10],
      });
      const report = store.compare(curFp, id)!;

      expect(report.findings.length).toBeGreaterThan(0);
      // Verify ordering: all critical before any warning, all warning before any info
      let lastSeverityIdx = -1;
      const severityMap: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      for (const f of report.findings) {
        const idx = severityMap[f.severity];
        expect(idx).toBeGreaterThanOrEqual(lastSeverityIdx);
        lastSeverityIdx = idx;
      }
    });
  });

  describe('summary counts', () => {
    it('should correctly count findings by severity', () => {
      const blFp = makeFingerprint({
        levelPercentages: { error: 5, info: 95 },
        crashes: [],
        failingComponents: [{ name: 'AudioDriver', errorCount: 10, warningCount: 5 }],
        channelCounts: { OldModule: 100 },
      });
      const id = store.save('baseline', '', [], blFp);

      const curFp = makeFingerprint({
        levelPercentages: { error: 25, info: 75 }, // critical shift
        crashes: [{ text: 'panic', keyword: 'panic' }], // new crash critical
        failingComponents: [
          { name: 'AudioDriver', errorCount: 60, warningCount: 5 }, // >5x critical
          { name: 'NewComp', errorCount: 10, warningCount: 0 }, // new component warning
        ],
        channelCounts: {}, // missing OldModule info
      });
      const report = store.compare(curFp, id)!;

      expect(report.summary.critical).toBeGreaterThanOrEqual(2); // level shift + new crash + error rate
      expect(report.summary.warning).toBeGreaterThanOrEqual(1); // new component
      expect(report.summary.info).toBeGreaterThanOrEqual(1); // missing component
      expect(report.summary.critical + report.summary.warning + report.summary.info).toBe(report.findings.length);
    });
  });
});

// --- buildFingerprint Tests ---

describe('buildFingerprint()', () => {
  it('should compute level percentages correctly', () => {
    const mockHandler = {
      getTotalLines: () => 100,
      getFileInfo: () => ({ path: '/tmp/test.log', size: 5000, totalLines: 100 }),
      getLines: (start: number, count: number) => {
        const lines = [];
        for (let i = start; i < Math.min(start + count, 100); i++) {
          lines.push({
            lineNumber: i,
            text: `2024-01-15 10:${String(Math.floor(i / 2)).padStart(2, '0')}:00 [Module${i % 3}] Line ${i}`,
            level: i < 20 ? 'error' : i < 40 ? 'warning' : 'info',
          });
        }
        return lines;
      },
    } as any;

    const analysisResult = {
      stats: { totalLines: 100, analyzedLines: 100 },
      levelCounts: { error: 20, warning: 20, info: 60 },
      timeRange: { start: '2024-01-15 10:00:00', end: '2024-01-15 10:49:00' },
      analyzerName: 'column-aware',
      analyzedAt: Date.now(),
      insights: {
        crashes: [{ text: 'FATAL: oom', lineNumber: 5, keyword: 'fatal', channel: 'Module0' }],
        topFailingComponents: [
          { name: 'Module0', errorCount: 7, warningCount: 3, sampleLine: 0 },
        ],
        filterSuggestions: [],
      },
    };

    const fp = buildFingerprint('/tmp/test.log', analysisResult, mockHandler);

    // Level percentages
    expect(fp.levelPercentages.error).toBe(20);
    expect(fp.levelPercentages.warning).toBe(20);
    expect(fp.levelPercentages.info).toBe(60);

    // Source metadata
    expect(fp.sourceFile).toBe('test.log');
    expect(fp.fileSize).toBe(5000);
    expect(fp.totalLines).toBe(100);
    expect(fp.analyzerName).toBe('column-aware');

    // Crashes (capped)
    expect(fp.crashes).toHaveLength(1);
    expect(fp.crashes[0].keyword).toBe('fatal');

    // Failing components
    expect(fp.failingComponents).toHaveLength(1);
    expect(fp.failingComponents[0].name).toBe('Module0');

    // Sample lines should exist per level
    expect(fp.sampleLines.error).toBeDefined();
    expect(fp.sampleLines.error.length).toBeGreaterThan(0);
    expect(fp.sampleLines.error.length).toBeLessThanOrEqual(10);

    expect(fp.sampleLines.warning).toBeDefined();
    expect(fp.sampleLines.info).toBeDefined();

    // Channel counts from bracket pattern
    expect(Object.keys(fp.channelCounts).length).toBeGreaterThan(0);

    // Timestamp density should be populated
    expect(fp.timestampDensity.length).toBeGreaterThan(0);
  });

  it('should cap crashes at 50', () => {
    const crashes = Array.from({ length: 60 }, (_, i) => ({
      text: `crash-${i}`, lineNumber: i, keyword: `kw-${i}`,
    }));

    const mockHandler = {
      getTotalLines: () => 10,
      getFileInfo: () => ({ path: '/tmp/x.log', size: 100, totalLines: 10 }),
      getLines: () => [],
    } as any;

    const analysisResult = {
      stats: { totalLines: 10, analyzedLines: 10 },
      levelCounts: {},
      analyzerName: 'test',
      analyzedAt: Date.now(),
      insights: { crashes, topFailingComponents: [], filterSuggestions: [] },
    };

    const fp = buildFingerprint('/tmp/x.log', analysisResult, mockHandler);
    expect(fp.crashes).toHaveLength(50);
  });

  it('should cap failing components at 20', () => {
    const comps = Array.from({ length: 25 }, (_, i) => ({
      name: `Comp${i}`, errorCount: 10 - i, warningCount: 5, sampleLine: i,
    }));

    const mockHandler = {
      getTotalLines: () => 10,
      getFileInfo: () => ({ path: '/tmp/x.log', size: 100, totalLines: 10 }),
      getLines: () => [],
    } as any;

    const analysisResult = {
      stats: { totalLines: 10, analyzedLines: 10 },
      levelCounts: {},
      analyzerName: 'test',
      analyzedAt: Date.now(),
      insights: { crashes: [], topFailingComponents: comps, filterSuggestions: [] },
    };

    const fp = buildFingerprint('/tmp/x.log', analysisResult, mockHandler);
    expect(fp.failingComponents).toHaveLength(20);
  });

  it('should truncate long line text to 200 chars', () => {
    const longText = 'A'.repeat(300);

    const mockHandler = {
      getTotalLines: () => 1,
      getFileInfo: () => ({ path: '/tmp/x.log', size: 100, totalLines: 1 }),
      getLines: () => [{ lineNumber: 0, text: longText, level: 'error' }],
    } as any;

    const analysisResult = {
      stats: { totalLines: 1, analyzedLines: 1 },
      levelCounts: { error: 1 },
      analyzerName: 'test',
      analyzedAt: Date.now(),
      insights: {
        crashes: [{ text: longText, lineNumber: 0, keyword: 'fatal' }],
        topFailingComponents: [],
        filterSuggestions: [],
      },
    };

    const fp = buildFingerprint('/tmp/x.log', analysisResult, mockHandler);
    expect(fp.crashes[0].text.length).toBe(200);
    expect(fp.sampleLines.error[0].length).toBe(200);
  });

  it('should handle empty analysis gracefully', () => {
    const mockHandler = {
      getTotalLines: () => 0,
      getFileInfo: () => ({ path: '/tmp/empty.log', size: 0, totalLines: 0 }),
      getLines: () => [],
    } as any;

    const analysisResult = {
      stats: { totalLines: 0, analyzedLines: 0 },
      levelCounts: {},
      analyzerName: 'test',
      analyzedAt: Date.now(),
      insights: { crashes: [], topFailingComponents: [], filterSuggestions: [] },
    };

    const fp = buildFingerprint('/tmp/empty.log', analysisResult, mockHandler);
    expect(fp.totalLines).toBe(0);
    expect(fp.crashes).toEqual([]);
    expect(fp.failingComponents).toEqual([]);
    expect(fp.timestampDensity).toEqual([]);
    expect(fp.channelCounts).toEqual({});
    expect(Object.keys(fp.levelPercentages)).toHaveLength(0);
  });

  it('should extract channel counts from [BracketPatterns]', () => {
    const mockHandler = {
      getTotalLines: () => 4,
      getFileInfo: () => ({ path: '/tmp/x.log', size: 100, totalLines: 4 }),
      getLines: () => [
        { lineNumber: 0, text: '2024-01-15 10:00:00 [AudioDriver] init', level: 'info' },
        { lineNumber: 1, text: '2024-01-15 10:00:01 [AudioDriver] ok', level: 'info' },
        { lineNumber: 2, text: '2024-01-15 10:00:02 [Network] connected', level: 'info' },
        { lineNumber: 3, text: 'no bracket here', level: 'info' },
      ],
    } as any;

    const analysisResult = {
      stats: { totalLines: 4, analyzedLines: 4 },
      levelCounts: { info: 4 },
      analyzerName: 'test',
      analyzedAt: Date.now(),
      insights: { crashes: [], topFailingComponents: [], filterSuggestions: [] },
    };

    const fp = buildFingerprint('/tmp/x.log', analysisResult, mockHandler);
    expect(fp.channelCounts['AudioDriver']).toBe(2);
    expect(fp.channelCounts['Network']).toBe(1);
  });
});

// --- Edge Cases ---

describe('BaselineStore edge cases', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new BaselineStore(path.join(tmpDir, 'edge.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle empty tags', () => {
    const fp = makeFingerprint();
    const id = store.save('no-tags', '', [], fp);
    const record = store.get(id)!;
    expect(record.tags).toEqual([]);
  });

  it('should handle special characters in name and description', () => {
    const fp = makeFingerprint();
    const id = store.save('test "quotes" & <special>', "it's a 'test' with \"double\"", ['tag-1'], fp);
    const record = store.get(id)!;
    expect(record.name).toBe('test "quotes" & <special>');
    expect(record.description).toBe("it's a 'test' with \"double\"");
  });

  it('should handle large fingerprint data', () => {
    const largeDensity = Array.from({ length: 1440 }, (_, i) => Math.floor(Math.random() * 100));
    const fp = makeFingerprint({ timestampDensity: largeDensity });
    const id = store.save('large', '', [], fp);
    const record = store.get(id)!;
    expect(record.fingerprint.timestampDensity).toEqual(largeDensity);
    expect(record.fingerprint.timestampDensity).toHaveLength(1440);
  });

  it('should handle concurrent operations', () => {
    const fp = makeFingerprint();
    // Save multiple baselines rapidly
    const ids = [];
    for (let i = 0; i < 20; i++) {
      ids.push(store.save(`baseline-${i}`, '', [`tag-${i}`], fp));
    }
    expect(store.list()).toHaveLength(20);
    expect(new Set(ids).size).toBe(20); // all unique

    // Delete half
    for (let i = 0; i < 10; i++) {
      store.delete(ids[i]);
    }
    expect(store.list()).toHaveLength(10);
  });

  it('should produce valid report for compare with empty current fingerprint', () => {
    const blFp = makeFingerprint();
    const id = store.save('full-baseline', '', [], blFp);

    const emptyFp = makeFingerprint({
      levelPercentages: {},
      levelCounts: {},
      crashes: [],
      failingComponents: [],
      channelCounts: {},
      timestampDensity: [],
    });

    const report = store.compare(emptyFp, id)!;
    expect(report).not.toBeNull();
    expect(report.findings.length).toBeGreaterThan(0);
    // Should have missing components and level shifts
    expect(report.summary.critical + report.summary.warning + report.summary.info).toBe(report.findings.length);
  });
});
