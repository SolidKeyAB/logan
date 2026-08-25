import { describe, it, expect } from 'vitest';
import {
  parseLogcatLine,
  looksLikeLogcat,
  AnalysisAccumulator,
} from '../main/analyzers/lineClassify';

// Real-world shape: esotrace-wrapped Android logcat (a "[host-time]" capture
// stamp prepended to each standard threadtime line). The tag ("AndroidRuntime")
// is the component that component-scoped views must be able to see.
const FATAL = '[21:10:44.413] 02-16 22:01:14.968  7637  7637 E AndroidRuntime: FATAL EXCEPTION: main';
const PROCESS = '[21:10:44.413] 02-16 22:01:14.968  7637  7637 E AndroidRuntime: Process: com.solidkey.screenpass, PID: 7637';
const INFO = '[21:10:44.171] 02-16 21:26:06.646   344   344 I odrefresh: Compiling service-x.jar';
const WARN = '[21:10:44.171] 02-16 21:26:07.100   512   512 W ActivityManager: Slow operation';
const SEPARATOR = '[21:10:44.171] --------- beginning of system';

describe('parseLogcatLine', () => {
  it('extracts level/component(tag)/message from a threadtime line with a host stamp', () => {
    expect(parseLogcatLine(FATAL)).toEqual({
      level: 'error', // logcat priority letter E — the crash text is captured separately
      component: 'AndroidRuntime',
      message: 'FATAL EXCEPTION: main',
    });
  });

  it('works without the esotrace host stamp', () => {
    expect(parseLogcatLine('02-16 22:01:14.968  7637  7637 E AndroidRuntime: FATAL EXCEPTION: main'))
      .toMatchObject({ level: 'error', component: 'AndroidRuntime' });
  });

  it('parses the brief "L/Tag( pid):" variant', () => {
    expect(parseLogcatLine('02-16 22:01:14.968 E/AndroidRuntime( 7637): FATAL EXCEPTION: main'))
      .toEqual({ level: 'error', component: 'AndroidRuntime', message: 'FATAL EXCEPTION: main' });
  });

  it('maps priority letters to levels', () => {
    expect(parseLogcatLine(INFO)).toMatchObject({ level: 'info', component: 'odrefresh' });
    expect(parseLogcatLine(WARN)).toMatchObject({ level: 'warning', component: 'ActivityManager' });
  });

  it('returns null for separators and non-logcat/columnar lines', () => {
    expect(parseLogcatLine(SEPARATOR)).toBeNull();
    expect(parseLogcatLine('2024-01-01 10:00:01 ERROR Connection failed')).toBeNull();
    expect(parseLogcatLine('[21:10:44.171] SomeChannel INFO a message')).toBeNull();
  });
});

describe('looksLikeLogcat', () => {
  it('is true when a majority of sample lines parse as logcat', () => {
    expect(looksLikeLogcat([SEPARATOR, FATAL, PROCESS, INFO, WARN, INFO])).toBe(true);
  });

  it('is false for a columnar/timestamped log', () => {
    expect(looksLikeLogcat([
      '2024-01-01 10:00:00 INFO Server started',
      '2024-01-01 10:00:01 ERROR Connection failed',
      '2024-01-01 10:00:02 WARN Low disk space',
      '2024-01-01 10:00:03 FATAL panic in module',
      '2024-01-01 10:00:04 INFO Recovered',
      '2024-01-01 10:00:05 ERROR Timeout waiting',
    ])).toBe(false);
  });
});

describe('AnalysisAccumulator — logcat component attribution', () => {
  it('attributes the AndroidRuntime FATAL EXCEPTION crash to its tag when logcat=true', () => {
    const acc = new AnalysisAccumulator([], true);
    [INFO, WARN, FATAL, PROCESS].forEach((l, i) => acc.feed(l, i + 1));

    const insights = acc.buildInsights(4);
    // The crash is now carried by its component instead of having channel=undefined.
    const crash = insights.crashes.find(c => /FATAL EXCEPTION/.test(c.text));
    expect(crash?.channel).toBe('AndroidRuntime');
    // ...and AndroidRuntime surfaces as a top failing component so component
    // filters / the health box / the triage card can reach it.
    expect(insights.topFailingComponents.map(c => c.name)).toContain('AndroidRuntime');
  });

  it('REGRESSION: without logcat mode the same crash is attributed to no component', () => {
    const acc = new AnalysisAccumulator([], false); // header-less file, no columns
    [INFO, WARN, FATAL, PROCESS].forEach((l, i) => acc.feed(l, i + 1));

    const insights = acc.buildInsights(4);
    // The crash is still counted (text matches CRASH_REGEX) but orphaned...
    expect(insights.crashes.some(c => /FATAL EXCEPTION/.test(c.text))).toBe(true);
    // ...and no component is ever surfaced — this is the bug the flag fixes.
    expect(insights.topFailingComponents).toHaveLength(0);
  });
});
