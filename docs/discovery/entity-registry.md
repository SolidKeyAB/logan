# Entity Registry — a single browse/index layer over every saved entity

## Why
LOGAN saves ~13 kinds of reusable entity (searches, sessions, filters, highlight groups,
bookmark sets, column layouts, column patterns, constants, trend props, saved patterns,
context defs, baselines, investigations). We have a complete **write + link** story for
them — each SAVES, carries a `description`, has a scope, and can be referenced (investigation
requirements). What's missing is a **read/browse** layer: there is no single place — for a
human OR the agent — to enumerate "everything I've saved" and act on it. Each kind is buried
in its own panel / right-click menu.

The Entity Registry is that missing "index" noun in the tool grammar. Build the read model
once; every surface (a "Saved" panel, a Ctrl+P palette, the requirements-editor picker, the
`logan_entities` agent tool) becomes a thin, swappable view over it.

## Process (agreed 2026-08-14)
Primitive first, surfaces earned with usage:
- **0. Contract** — this doc: the descriptor shape + verbs.
- **1. Registry + agent parity** — `/api/entities` + `logan_entities`. Read-only. No UI risk.
- **2. Cheapest read-only surface** — a "Saved" panel that LISTS + apply/reveal (links out
  to each entity's existing edit menu). Instrumented via the Usage Monitor.
- **3. Earn the rest** — inline management and/or the palette, whichever gets reached for;
  fold the registry into the requirements editor as a picker (stop typing entity names).
- **4. Consolidate** — collapse the scattered per-entity panels into the Saved panel.

## The contract

```ts
type EntityKind =
  | 'search' | 'session' | 'filter' | 'highlightGroup' | 'bookmarkSet'
  | 'columnLayout' | 'columnPattern' | 'constant' | 'trendProperty'
  | 'pattern' | 'contextDef' | 'baseline' | 'investigation';

interface EntityDescriptor {
  kind: EntityKind;
  id: string;               // stable id (constants use name; investigations use slug)
  name: string;             // display label
  description?: string;     // the uniform optional description (PR #97)
  scope?: string;           // 'global' | 'file' | 'ticket' — normalized best-effort
  summary?: string;         // one-line human gist (the pattern / step count / value …)
  count?: number;           // members, for container kinds (session configs, group size…)
}
```

Verbs the registry is designed to grow (v1 ships **list** only):
`list(kind?) · apply(ref) · describe(ref, text) · delete(ref) · reveal(ref)`

## v1 scope (this build)
- **Read model only** — `list(kind?)`. Aggregates the GLOBAL / named-reusable entities (the
  "library"): global search configs & sessions, filter presets, highlight *groups*, bookmark
  *sets*, column layouts & patterns, constants, trend props, saved patterns, global context
  defs, baselines, investigations. Per-file individual highlights/bookmarks are working state,
  not library material — excluded from v1.
- **Pure mappers** in `entityRegistry.ts` (`toDescriptor(kind, raw)`) so the shape is unit-
  tested; the actual store reads are injected from `index.ts` (which owns the stores) via a
  new `ApiContext.listSavedEntities(kind?)`, mirroring the existing `resolveSavedEntity`.
- **Parity**: `/api/entities` + `logan_entities`. The human "Saved" panel is **step 2**.

## Layering
```
stores (index.ts + *Store.ts)
      │  loaders
      ▼
ApiContext.listSavedEntities(kind?)  →  toDescriptor(kind, raw)   [entityRegistry.ts, pure]
      │
      ▼
/api/entities  ──→  logan_entities (agent)   +   (step 2) "Saved" panel (human)
```
Investigations are appended by the `/api/entities` handler itself (api-server already imports
`listTemplates`), so `index.ts` need not depend on `investigationStore`.
