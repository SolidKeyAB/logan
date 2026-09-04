// Entity Registry — the read/browse layer over every saved entity in LOGAN.
//
// One catalog, one shape (EntityDescriptor), so a single view can list "everything I've
// saved" for BOTH operators (a human "Saved" panel + the agent's logan_entities tool) and
// so the requirements editor can offer entity pickers. See docs/discovery/entity-registry.md.
//
// This module is pure (no Electron / fs) — it only maps a raw stored entity to a descriptor,
// so the shape stays unit-testable. The actual store reads are injected from index.ts (which
// owns the stores) via ApiContext.listSavedEntities, mirroring resolveSavedEntity.

// ADDING A KIND HERE? You must also classify it for portable export in
// catalogPack.ts → CATALOG_EXPORT_POLICY (tsc + a test will fail until you do): either
// export:true (then add it to CATALOG_IDENTITY + buildCatalogRegistry in index.ts) or
// export:false with a reason. This keeps the .logan-pack export/import in lockstep.
export type EntityKind =
  | 'search'          // SearchConfig (global)
  | 'session'         // SearchConfigSession (global)
  | 'composite'       // SingleSessionEntry (ordered file-set concatenated into one view)
  | 'filter'          // FilterPreset
  | 'highlightGroup'  // HighlightGroup
  | 'bookmarkSet'     // BookmarkSet
  | 'columnLayout'    // ColumnLayoutSaved
  | 'columnPattern'   // ColumnPatternSaved
  | 'constant'        // ConstantEntry
  | 'trendProperty'   // PatternProperty
  | 'pattern'         // SavedPattern (pattern library)
  | 'contextDef'      // ContextDefinition (global)
  | 'baseline'        // BaselineRecord
  | 'investigation'   // InvestigationTemplate
  | 'sequence'        // ClueSequence (ordered evidence trail — the evidence twin of an investigation)
  | 'contextManifest'; // ContextManifest (per-file static-env facts: build/firmware/flags/config)

export const ENTITY_KINDS: EntityKind[] = [
  'search', 'session', 'composite', 'filter', 'highlightGroup', 'bookmarkSet', 'columnLayout',
  'columnPattern', 'constant', 'trendProperty', 'pattern', 'contextDef', 'baseline', 'investigation', 'sequence',
  'contextManifest',
];

// Human labels for each kind (for grouping headers in a UI / agent readout).
export const ENTITY_KIND_LABELS: Record<EntityKind, string> = {
  search: 'Searches',
  session: 'Search sessions',
  composite: 'Single sessions',
  filter: 'Filter presets',
  highlightGroup: 'Highlight groups',
  bookmarkSet: 'Bookmark sets',
  columnLayout: 'Column layouts',
  columnPattern: 'Column patterns',
  constant: 'Constants',
  trendProperty: 'Trend properties',
  pattern: 'Saved patterns',
  contextDef: 'Context definitions',
  baseline: 'Baselines',
  investigation: 'Investigations',
  sequence: 'Clue sequences',
  contextManifest: 'Environment context',
};

export interface EntityDescriptor {
  kind: EntityKind;
  id: string;
  name: string;
  description?: string;
  scope?: string;      // 'global' | 'file' | 'ticket' — normalized best-effort
  summary?: string;    // one-line human gist
  count?: number;      // member count for container kinds
}

function clip(s: any, n = 80): string {
  const str = (s == null ? '' : String(s));
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

const boolScope = (isGlobal: any): string => (isGlobal ? 'global' : 'file');

/**
 * Map one raw stored entity to a uniform descriptor. Unknown/empty inputs still produce a
 * safe descriptor (never throws) so a single corrupt record can't break the whole catalog.
 */
export function toDescriptor(kind: EntityKind, raw: any): EntityDescriptor {
  const r = raw || {};
  switch (kind) {
    case 'search':
      return { kind, id: String(r.id ?? ''), name: r.pattern || '(empty)', description: r.description,
        scope: boolScope(r.isGlobal), summary: clip(`${r.isRegex ? 'regex' : 'text'}${r.matchCase ? ' · case' : ''}${r.wholeWord ? ' · word' : ''}${r.enabled === false ? ' · off' : ''}`) };
    case 'session':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description,
        scope: boolScope(r.isGlobal), summary: `${(r.configs || []).length} searches`, count: (r.configs || []).length };
    case 'composite': {
      const files = (r.files || []) as string[];
      const names = files.map((f) => String(f).split(/[\\/]/).pop() || f);
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description,
        scope: boolScope(r.isGlobal), summary: clip(`${files.length} files · ${names.join(' + ')}`), count: files.length };
    }
    case 'filter':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: clip(`${(r.levels || []).length ? `levels [${(r.levels || []).join(',')}]` : ''}${(r.includePatterns || []).length ? ` · ${(r.includePatterns || []).length} include` : ''}${(r.excludePatterns || []).length ? ` · ${(r.excludePatterns || []).length} exclude` : ''}`.trim().replace(/^·\s*/, '')) };
    case 'highlightGroup':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: `${(r.highlights || []).length} highlights`, count: (r.highlights || []).length };
    case 'bookmarkSet':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: `${(r.bookmarks || []).length} bookmarks`, count: (r.bookmarks || []).length };
    case 'columnLayout':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: clip(`${r.method || 'columns'} · ${(r.columns || []).length} cols`), count: (r.columns || []).length };
    case 'columnPattern':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: clip((r.fields || []).join(', ')), count: (r.fields || []).length };
    case 'constant':
      return { kind, id: String(r.name ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: clip(r.value) };
    case 'trendProperty':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: clip(`${r.pattern || ''}${r.unit ? ` (${r.unit})` : ''}`) };
    case 'pattern':
      return { kind, id: String(r.id ?? ''), name: r.label || '(unnamed)', description: r.description,
        scope: r.scope || 'global', summary: clip(r.regex) };
    case 'contextDef':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description,
        scope: boolScope(r.isGlobal), summary: `${(r.patterns || []).length} patterns`, count: (r.patterns || []).length };
    case 'baseline':
      return { kind, id: String(r.id ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: clip(`${r.sourceFile ? r.sourceFile.split(/[\\/]/).pop() : ''}${r.totalLines ? ` · ${r.totalLines} lines` : ''}`.replace(/^ · /, '')) };
    case 'investigation':
      return { kind, id: String(r.slug ?? r.name ?? ''), name: r.name || '(unnamed)', description: r.description, scope: 'global',
        summary: `${(r.steps || []).length} steps${r.requirements ? ' · has requirements' : ''}`, count: (r.steps || []).length };
    case 'sequence':
      return { kind, id: String(r.id ?? r.name ?? ''), name: r.name || '(unnamed)', description: r.description, scope: r.scope || 'global',
        summary: `${(r.clues || []).length} clues`, count: (r.clues || []).length };
    case 'contextManifest': {
      const keys = Object.keys(r.facts || {});
      const preview = keys.slice(0, 4).join(', ');
      return { kind, id: String(r.id ?? 'context-manifest'), name: r.name || '(environment)', description: r.description, scope: 'file',
        summary: clip(`${keys.length} env fact${keys.length === 1 ? '' : 's'}${preview ? ` · ${preview}` : ''}`), count: keys.length };
    }
    default:
      return { kind, id: String(r.id ?? ''), name: r.name || r.label || '(unknown)', description: r.description, scope: 'global' };
  }
}

/** Map a whole list of one kind, skipping any record that fails to map. */
export function toDescriptors(kind: EntityKind, rows: any[]): EntityDescriptor[] {
  const out: EntityDescriptor[] = [];
  for (const raw of rows || []) {
    try { out.push(toDescriptor(kind, raw)); } catch { /* skip corrupt record */ }
  }
  return out;
}
