/**
 * LOGAN Agent Intent Engine — shared by built-in agent and standalone scripts.
 *
 * Maps user messages to LOGAN API calls via regex patterns and formats
 * the API responses as human-readable text.
 *
 * Usage:
 *   import { matchIntent, HELP_TEXT } from './agent-intents.mjs';
 *   const response = await matchIntent(userMessage, apiCall);
 */

// --- Intent definitions ---

const intents = [
  {
    name: 'triage',
    patterns: [/\btriage\b/i, /what'?s wrong/i, /\bsummary\b/i, /\boverview\b/i],
    async handler(msg, api) {
      const [analysis, gaps] = await Promise.all([
        api('POST', '/api/analyze', {}),
        api('POST', '/api/time-gaps', { thresholdSeconds: 30 }),
      ]);
      const lines = [];
      if (analysis.success && analysis.result) {
        const r = analysis.result;
        const lc = r.levelCounts || {};
        const total = Object.values(lc).reduce((a, b) => a + b, 0);
        lines.push('=== Triage Summary ===');
        lines.push(`Total categorized lines: ${total}`);
        for (const [level, count] of Object.entries(lc)) {
          lines.push(`  ${level}: ${count}`);
        }
        if (r.crashes && r.crashes.length > 0) {
          lines.push(`\nCrashes found: ${r.crashes.length}`);
          for (const c of r.crashes.slice(0, 3)) {
            lines.push(`  Line ${c.lineNumber}: ${c.text?.slice(0, 80) || 'crash'}`);
          }
        }
        if (r.topComponents && r.topComponents.length > 0) {
          lines.push('\nTop components:');
          for (const c of r.topComponents.slice(0, 5)) {
            lines.push(`  ${c.name}: ${c.count} entries`);
          }
        }
      } else {
        lines.push('Analysis did not return results. Is a file open?');
      }
      if (gaps.success && gaps.gaps && gaps.gaps.length > 0) {
        lines.push(`\nTime gaps (>30s): ${gaps.gaps.length}`);
        for (const g of gaps.gaps.slice(0, 3)) {
          lines.push(`  ${g.duration}s gap at line ${g.lineNumber}`);
        }
      }
      return lines.join('\n');
    },
  },

  {
    name: 'analyze',
    patterns: [/\banalyze\b/i, /\berrors?\b/i, /\bwarnings?\b/i, /\blevels?\b/i],
    async handler(msg, api) {
      const res = await api('POST', '/api/analyze', {});
      if (!res.success || !res.result) return 'Analysis failed. Is a file open?';
      const lc = res.result.levelCounts || {};
      const lines = ['=== Analysis ==='];
      for (const [level, count] of Object.entries(lc)) {
        lines.push(`  ${level}: ${count}`);
      }
      if (res.result.topComponents && res.result.topComponents.length > 0) {
        lines.push('\nTop components:');
        for (const c of res.result.topComponents.slice(0, 5)) {
          lines.push(`  ${c.name}: ${c.count}`);
        }
      }
      return lines.join('\n');
    },
  },

  {
    name: 'crashes',
    patterns: [/\bcrash(es)?\b/i, /\bfatal\b/i, /\bpanic\b/i],
    async handler(msg, api) {
      const res = await api('POST', '/api/investigate-crashes', { contextLines: 5, maxCrashes: 10 });
      if (!res.success) return 'Crash investigation failed.';
      if (!res.result?.crashes || res.result.crashes.length === 0) return 'No crashes found.';
      const lines = [`=== ${res.result.crashes.length} Crash Site(s) ===`];
      for (const c of res.result.crashes) {
        lines.push(`\nLine ${c.lineNumber}: ${c.text?.slice(0, 100) || 'crash'}`);
        if (c.context) {
          for (const cl of c.context.slice(0, 3)) {
            lines.push(`  ${cl.lineNumber}: ${cl.text?.slice(0, 80)}`);
          }
        }
      }
      return lines.join('\n');
    },
  },

  {
    name: 'component',
    patterns: [/\bcomponent\s+(\S+)/i],
    async handler(msg, api) {
      const m = msg.match(/\bcomponent\s+(\S+)/i);
      const component = m ? m[1] : '';
      if (!component) return 'Please specify a component name, e.g. "component AuthModule"';
      const res = await api('POST', '/api/investigate-component', { component });
      if (!res.success) return `Could not investigate component "${component}".`;
      const r = res.result || {};
      const lines = [`=== Component: ${component} ===`];
      if (r.levelCounts) {
        for (const [level, count] of Object.entries(r.levelCounts)) {
          lines.push(`  ${level}: ${count}`);
        }
      }
      if (r.samples && r.samples.length > 0) {
        lines.push('\nSample lines:');
        for (const s of r.samples.slice(0, 5)) {
          lines.push(`  ${s.lineNumber}: ${s.text?.slice(0, 80)}`);
        }
      }
      return lines.join('\n');
    },
  },

  {
    name: 'search',
    patterns: [/^(?:search|find|grep)\s+(.+)/i],
    async handler(msg, api) {
      const m = msg.match(/^(?:search|find|grep)\s+(.+)/i);
      const pattern = m ? m[1].trim() : '';
      if (!pattern) return 'Please provide a search pattern, e.g. "search timeout"';
      const res = await api('POST', '/api/search', {
        pattern,
        isRegex: false,
        matchCase: false,
        wholeWord: false,
      });
      if (!res.success) return 'Search failed.';
      const matches = res.matches || [];
      const lines = [`Found ${matches.length} match(es) for "${pattern}"`];
      for (const match of matches.slice(0, 5)) {
        lines.push(`  Line ${match.lineNumber}: ${match.text?.slice(0, 80)}`);
      }
      if (matches.length > 5) lines.push(`  ... and ${matches.length - 5} more`);
      return lines.join('\n');
    },
  },

  {
    name: 'status',
    patterns: [/\bstatus\b/i, /\binfo\b/i],
    async handler(msg, api) {
      const res = await api('GET', '/api/status');
      if (!res.status) return 'Could not get status. Is LOGAN running?';
      const s = res.status;
      const lines = ['=== Status ==='];
      lines.push(`File: ${s.filePath || 'none'}`);
      lines.push(`Total lines: ${s.totalLines || 0}`);
      if (s.filteredLines != null) lines.push(`Filtered lines: ${s.filteredLines}`);
      if (s.filterActive) lines.push('Filter: active');
      if (s.bookmarkCount) lines.push(`Bookmarks: ${s.bookmarkCount}`);
      return lines.join('\n');
    },
  },

  {
    name: 'time-gaps',
    patterns: [/\btime\s*gaps?\b/i, /\bpauses?\b/i, /\bgaps?\b/i],
    async handler(msg, api) {
      const res = await api('POST', '/api/time-gaps', { thresholdSeconds: 30 });
      if (!res.success) return 'Time gap detection failed.';
      const gaps = res.gaps || [];
      if (gaps.length === 0) return 'No significant time gaps found (threshold: 30s).';
      const lines = [`=== ${gaps.length} Time Gap(s) ===`];
      for (const g of gaps.slice(0, 10)) {
        lines.push(`  ${g.duration}s gap at line ${g.lineNumber}`);
      }
      if (gaps.length > 10) lines.push(`  ... and ${gaps.length - 10} more`);
      return lines.join('\n');
    },
  },

  {
    name: 'filter-errors',
    patterns: [/\bfilter\s+(errors?|warnings?|info|debug|verbose)\b/i, /\bshow\s+only\s+(\S+)/i],
    async handler(msg, api) {
      const m = msg.match(/\b(?:filter|show\s+only)\s+(\S+)/i);
      let level = m ? m[1].toLowerCase() : 'error';
      // Normalize plural
      if (level.endsWith('s')) level = level.slice(0, -1);
      const res = await api('POST', '/api/filter', { levels: [level] });
      if (!res.success) return `Filter failed.`;
      return `Filter applied: showing only "${level}" lines. ${res.filteredLines != null ? res.filteredLines + ' lines visible.' : ''} Type "clear filter" to reset.`;
    },
  },

  {
    name: 'clear-filter',
    patterns: [/\bclear\s*filter\b/i, /\bshow\s*all\b/i, /\breset\s*filter\b/i, /\bremove\s*filter\b/i],
    async handler(msg, api) {
      const res = await api('POST', '/api/clear-filter', {});
      if (!res.success) return 'Failed to clear filter.';
      return 'Filter cleared — showing all lines.';
    },
  },

  {
    name: 'goto',
    patterns: [/\b(?:go\s*to|goto|jump\s*to|line)\s+(\d+)/i],
    async handler(msg, api) {
      const m = msg.match(/\b(?:go\s*to|goto|jump\s*to|line)\s+(\d+)/i);
      const lineNum = m ? parseInt(m[1], 10) : 0;
      if (!lineNum) return 'Please specify a line number, e.g. "go to 500"';
      await api('POST', '/api/navigate', { lineNumber: lineNum });
      const res = await api('POST', '/api/get-lines', { startLine: Math.max(0, lineNum - 3), count: 7 });
      const lines = [`Navigated to line ${lineNum}:`];
      if (res.success && res.lines) {
        for (const l of res.lines) {
          const marker = l.lineNumber === lineNum ? '>>>' : '   ';
          lines.push(`${marker} ${l.lineNumber}: ${l.text?.slice(0, 80)}`);
        }
      }
      return lines.join('\n');
    },
  },

  {
    name: 'bookmark',
    patterns: [/\bbookmark\s+(\d+)/i],
    async handler(msg, api) {
      const m = msg.match(/\bbookmark\s+(\d+)/i);
      const lineNum = m ? parseInt(m[1], 10) : 0;
      if (!lineNum) return 'Please specify a line number, e.g. "bookmark 42"';
      const res = await api('POST', '/api/bookmark', { lineNumber: lineNum, label: `Agent bookmark @ ${lineNum}` });
      if (!res.success) return `Failed to bookmark line ${lineNum}.`;
      return `Bookmarked line ${lineNum}.`;
    },
  },

  {
    name: 'highlight',
    patterns: [/\bhighlight\s+(.+)/i],
    async handler(msg, api) {
      const m = msg.match(/\bhighlight\s+(.+)/i);
      const pattern = m ? m[1].trim() : '';
      if (!pattern) return 'Please specify a pattern, e.g. "highlight timeout"';
      const res = await api('POST', '/api/highlight', { pattern, backgroundColor: '#ffff0044', isRegex: false });
      if (!res.success) return `Failed to highlight "${pattern}".`;
      return `Highlighted "${pattern}".`;
    },
  },

  {
    name: 'timerange',
    patterns: [/\bbetween\s+(.+?)\s+and\s+(.+)/i],
    async handler(msg, api) {
      const m = msg.match(/\bbetween\s+(.+?)\s+and\s+(.+)/i);
      if (!m) return 'Usage: between <startTime> and <endTime>';
      const res = await api('POST', '/api/investigate-timerange', {
        startTime: m[1].trim(),
        endTime: m[2].trim(),
      });
      if (!res.success) return 'Time range investigation failed.';
      const r = res.result || {};
      const lines = ['=== Time Range Analysis ==='];
      if (r.levelCounts) {
        for (const [level, count] of Object.entries(r.levelCounts)) {
          lines.push(`  ${level}: ${count}`);
        }
      }
      if (r.totalLines != null) lines.push(`Total lines in range: ${r.totalLines}`);
      return lines.join('\n');
    },
  },

  {
    name: 'notes',
    patterns: [/\bnotes?\b/i],
    async handler(msg, api) {
      const res = await api('GET', '/api/notes');
      if (!res.success) return 'Could not load notes.';
      const content = res.content || res.notes || '';
      if (!content.trim()) return 'Notes are empty for this file.';
      return `=== Notes ===\n${content.slice(0, 500)}${content.length > 500 ? '\n... (truncated)' : ''}`;
    },
  },
];

// --- Public API ---

export const HELP_TEXT = `I can help you analyze this log file. Try:
  triage       — Quick severity assessment
  analyze      — Error/warning counts + top components
  crashes      — Find crash sites with context
  component X  — Investigate a specific component
  search X     — Search for a pattern
  status       — File info and filter state
  time gaps    — Find pauses in the log
  filter errors — Show only error lines
  clear filter — Show all lines again
  go to 500    — Navigate to a line number
  bookmark 42  — Bookmark a line
  highlight X  — Highlight a pattern
  between T1 and T2 — Analyze a time window
  notes        — View notes for this file
  help         — Show this message
  stop         — End the session`;

/**
 * Match a user message against known intents and execute the handler.
 * @param {string} message - User's chat message
 * @param {function} apiCall - async (method, path, body?) => responseJson
 * @returns {Promise<string>} Human-readable response text
 */
export async function matchIntent(message, apiCall) {
  const trimmed = message.trim();

  // Help
  if (/^help$/i.test(trimmed)) {
    return HELP_TEXT;
  }

  // Try each intent
  for (const intent of intents) {
    for (const pattern of intent.patterns) {
      if (pattern.test(trimmed)) {
        try {
          return await intent.handler(trimmed, apiCall);
        } catch (err) {
          return `Error running "${intent.name}": ${err.message || err}`;
        }
      }
    }
  }

  // No match
  return `I didn't understand that. Type "help" to see what I can do.`;
}

export function isStopWord(msg) {
  return /^(stop|bye|exit|quit)$/i.test(msg.trim());
}
