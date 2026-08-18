// Canonical verb registry — the SINGLE source of truth that joins LOGAN's two
// operator vocabularies onto one feature.
//
// LOGAN records usage from two recorders that speak different vocabularies:
//   • HUMAN actions go through logActivity() using ActivityEntry['action'] names
//     (e.g. 'filter_applied', 'analysis_run', 'bookmark_added').
//   • AI tool calls are counted by the api-server tap using api slugs — the POST
//     path minus '/api/' (e.g. 'filter', 'analyze', 'bookmark').
//
// Because the two vocabularies were never aligned, the Usage Monitor could never
// line up a human count with its AI count for the SAME feature except where the
// two strings happened to be identical ('search'). This table maps BOTH
// vocabularies onto one canonical feature id plus a human-readable display name,
// so per-feature human-vs-AI counts join correctly.
//
// It is imported by the main process (index.ts logActivity, api-server.ts AI
// tap) to canonicalize verbs at WRITE time, and by aggregateUsageByFeature() to
// produce display-ready, operator-split rows for the renderer's Usage panel. The
// renderer stays a pure consumer of those rows — no mirror of this table lives in
// renderer.ts, so there is exactly one source of truth (constitution rule 4).

export interface VerbFeature {
  /** Stable canonical id. Also the `verb` stored after canonicalization. */
  feature: string;
  /** Human-readable label shown in the Usage panel. */
  display: string;
  /** ActivityEntry['action'] names that map onto this feature (human operator). */
  humanActions: string[];
  /** api slugs (POST path minus '/api/') that map onto this feature (AI operator). */
  aiSlugs: string[];
}

// One row per logical feature. Where a feature exists for both operators, its
// `feature` id is chosen to equal the AI slug so canonicalization is idempotent
// (canonicalizing an already-canonical value returns it unchanged). Some
// aiSlugs ('extract', 'compile-pattern') are parity endpoints added by later
// work; listing them here now keeps this the single canonical table.
export const VERB_REGISTRY: VerbFeature[] = [
  { feature: 'open-file',            display: 'Open file',            humanActions: ['file_opened'],      aiSlugs: ['open-file'] },
  { feature: 'get-lines',            display: 'Read lines',           humanActions: [],                   aiSlugs: ['get-lines'] },
  { feature: 'search',               display: 'Search',               humanActions: ['search'],           aiSlugs: ['search'] },
  { feature: 'analyze',              display: 'Analyze',              humanActions: ['analysis_run'],     aiSlugs: ['analyze'] },
  { feature: 'filter',               display: 'Filter',               humanActions: ['filter_applied'],   aiSlugs: ['filter'] },
  { feature: 'clear-filter',         display: 'Clear filter',         humanActions: ['filter_cleared'],   aiSlugs: ['clear-filter'] },
  { feature: 'bookmark',             display: 'Add bookmark',         humanActions: ['bookmark_added'],   aiSlugs: ['bookmark'] },
  { feature: 'bookmark-remove',      display: 'Remove bookmark',      humanActions: ['bookmark_removed'], aiSlugs: ['bookmark-remove'] },
  { feature: 'bookmark-update',      display: 'Update bookmark',      humanActions: [],                   aiSlugs: ['bookmark-update'] },
  { feature: 'bookmark-clear',       display: 'Clear bookmarks',      humanActions: ['bookmark_cleared'], aiSlugs: ['bookmark-clear'] },
  { feature: 'highlight',            display: 'Add highlight',        humanActions: ['highlight_added'],   aiSlugs: ['highlight'] },
  { feature: 'highlight-remove',     display: 'Remove highlight',     humanActions: ['highlight_removed'], aiSlugs: ['highlight-remove'] },
  { feature: 'highlight-update',     display: 'Update highlight',     humanActions: [],                    aiSlugs: ['highlight-update'] },
  { feature: 'highlight-clear',      display: 'Clear highlights',     humanActions: ['highlight_cleared'], aiSlugs: ['highlight-clear'] },
  { feature: 'annotate',             display: 'Annotate',             humanActions: ['annotation_added'], aiSlugs: ['annotate'] },
  { feature: 'annotation-remove',    display: 'Remove annotation',    humanActions: [],                   aiSlugs: ['annotation-remove'] },
  { feature: 'annotation-clear',     display: 'Clear annotations',    humanActions: [],                   aiSlugs: ['annotation-clear'] },
  { feature: 'time-gaps',            display: 'Time-gap analysis',    humanActions: ['time_gap_analysis'], aiSlugs: ['time-gaps'] },
  { feature: 'navigate',             display: 'Navigate',             humanActions: [],                   aiSlugs: ['navigate'] },
  { feature: 'diff',                 display: 'Diff compare',         humanActions: ['diff_compared'],    aiSlugs: [] },
  { feature: 'notes',                display: 'Save notes',           humanActions: ['notes_saved'],      aiSlugs: ['notes'] },
  { feature: 'lines-saved',          display: 'Save snippet',         humanActions: ['lines_saved'],      aiSlugs: [] },
  { feature: 'filter-extract',       display: 'Extract filter → file', humanActions: ['filter_extracted'], aiSlugs: ['extract'] },
  { feature: 'files-merged',         display: 'Merge to file',        humanActions: ['files_merged'],     aiSlugs: [] },
  { feature: 'composite-create',     display: 'Single session',       humanActions: ['composite_created'], aiSlugs: ['composite-create'] },
  { feature: 'cadence',              display: 'Cadence analysis',     humanActions: ['cadence_analysis'], aiSlugs: [] },
  { feature: 'compile-pattern',      display: 'Compile pattern',      humanActions: [],                   aiSlugs: ['compile-pattern'] },
  { feature: 'baseline-save',        display: 'Save baseline',        humanActions: [],                   aiSlugs: ['baseline-save'] },
  { feature: 'baseline-compare',     display: 'Compare baseline',     humanActions: [],                   aiSlugs: ['baseline-compare'] },
  { feature: 'baseline-delete',      display: 'Delete baseline',      humanActions: [],                   aiSlugs: ['baseline-delete'] },
  { feature: 'investigate-crashes',   display: 'Investigate crashes',   humanActions: [], aiSlugs: ['investigate-crashes'] },
  { feature: 'investigate-component', display: 'Investigate component', humanActions: [], aiSlugs: ['investigate-component'] },
  { feature: 'investigate-timerange', display: 'Investigate timerange', humanActions: [], aiSlugs: ['investigate-timerange'] },
  { feature: 'trend-fields',         display: 'Discover fields',      humanActions: [], aiSlugs: ['trend-fields'] },
  { feature: 'trend-series',         display: 'Trend series',         humanActions: [], aiSlugs: ['trend-series'] },
  { feature: 'trend-transitions',    display: 'Trend transitions',    humanActions: [], aiSlugs: ['trend-transitions'] },
  { feature: 'trend-correlate',      display: 'Trend correlate',      humanActions: [], aiSlugs: ['trend-correlate'] },
  { feature: 'trend-show',           display: 'Show trend',           humanActions: [], aiSlugs: ['trend-show'] },
  { feature: 'build-conclusion',     display: 'Build conclusion',     humanActions: [], aiSlugs: ['build-conclusion'] },
  { feature: 'evidence-pack',        display: 'Evidence pack / Brief', humanActions: [], aiSlugs: ['evidence-pack'] },
];

// Derived lookup maps (built once at module load).
const humanActionToFeature = new Map<string, string>();
const aiSlugToFeature = new Map<string, string>();
const featureToDisplay = new Map<string, string>();
for (const f of VERB_REGISTRY) {
  featureToDisplay.set(f.feature, f.display);
  for (const a of f.humanActions) humanActionToFeature.set(a, f.feature);
  for (const s of f.aiSlugs) aiSlugToFeature.set(s, f.feature);
}

/** Map a HUMAN ActivityEntry action name to its canonical feature id (identity if unknown). */
export function canonicalizeHumanVerb(verb: string): string {
  return humanActionToFeature.get(verb) ?? verb;
}

/** Map an AI api slug to its canonical feature id (identity if unknown). */
export function canonicalizeAiVerb(verb: string): string {
  return aiSlugToFeature.get(verb) ?? verb;
}

/** Canonicalize by operator. Idempotent: a value already canonical is returned unchanged. */
export function canonicalizeVerb(verb: string, operator: 'human' | 'ai'): string {
  return operator === 'ai' ? canonicalizeAiVerb(verb) : canonicalizeHumanVerb(verb);
}

/** Turn a raw verb/feature id into a readable label (e.g. 'panel:usage' → 'Panel: Usage'). */
function prettifyVerb(v: string): string {
  const colon = v.indexOf(':');
  if (colon >= 0) {
    const ns = v.slice(0, colon).replace(/[-_]/g, ' ').trim();
    const rest = v.slice(colon + 1).replace(/[-_]/g, ' ').trim();
    const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    return `${cap(ns)}: ${cap(rest)}`.trim();
  }
  const label = v.replace(/[-_]/g, ' ').trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : v;
}

/** Human-readable label for a canonical feature id (falls back to a prettified verb). */
export function featureDisplayName(feature: string): string {
  return featureToDisplay.get(feature) ?? prettifyVerb(feature);
}

// --- Feature-level aggregation for the Usage panel ---------------------------

/** One feature's usage, with the human and AI counts joined. */
export interface FeatureUsageRow {
  feature: string;
  display: string;
  human: number;
  ai: number;
  total: number;
  lastUsed: string; // ISO 8601, most-recent across the contributing entries
}

// Minimal structural shape of a stored usage entry — declared locally so this
// shared module needn't import the main-process UsageStore types.
interface UsageEntryLike {
  verb: string;
  operator: 'human' | 'ai';
  count: number;
  lastUsed?: string;
}

/**
 * Collapse raw per-(verb,operator) usage entries into one row per canonical
 * feature, joining the human and AI counts. Robust to both canonicalized and
 * legacy (pre-registry) stored verbs. Sorted by total desc, ties by lastUsed.
 */
export function aggregateUsageByFeature(entries: UsageEntryLike[]): FeatureUsageRow[] {
  const byFeature = new Map<string, FeatureUsageRow>();
  for (const e of entries) {
    if (!e || typeof e.verb !== 'string') continue;
    const op: 'human' | 'ai' = e.operator === 'ai' ? 'ai' : 'human';
    const count = typeof e.count === 'number' && isFinite(e.count) ? e.count : 0;
    const feature = canonicalizeVerb(e.verb, op);
    let row = byFeature.get(feature);
    if (!row) {
      row = { feature, display: featureDisplayName(feature), human: 0, ai: 0, total: 0, lastUsed: '' };
      byFeature.set(feature, row);
    }
    if (op === 'ai') row.ai += count; else row.human += count;
    row.total += count;
    const lu = typeof e.lastUsed === 'string' ? e.lastUsed : '';
    if (lu > row.lastUsed) row.lastUsed = lu;
  }
  return Array.from(byFeature.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return b.lastUsed.localeCompare(a.lastUsed);
  });
}
