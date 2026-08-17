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

## North-star: entities as composable building blocks

The registry is the first move in a larger shift: **turn every saved artifact into a reusable
component the user picks up and combines** — the way you'd assemble a query from parts. Three
layers stack:

1. **Entities are the atoms.** Everything saveable — searches, filter presets, highlight
   groups, bookmark sets, column layouts, column patterns, constants, trend properties, saved
   patterns, context definitions, baselines, search sessions, investigations — is one uniform
   thing: `name + description + scope`. The registry makes them enumerable; the Saved panel's
   apply/reveal (PR #105) makes them *usable*, not just stored — ▶ apply/run, ↗ open where it
   lives, ⧉ copy.

2. **Investigations compose entities into a procedure.** A saved investigation is a re-runnable
   sequence of verbs (search → time-gaps → trend → …) plus a **Requirements Manifest** that
   *references* other entities by name (e.g. "expects the `auth-errors` highlight group") and
   gates on a file template (PR #100). Composition today is by-reference; the next surface is a
   **picker** that assembles that reference list by clicking registry rows instead of typing
   names.

3. **File profiles bind an entity bundle to a kind of log.** A **file template** recognizes a
   log — column-pattern match / decoder-adapter id / signature regex / filename glob (already
   the hard gate on investigations). The north-star extension: let a file template carry a
   **collection of entities + settings** so that *opening a log of type X auto-applies its
   bundle* — its highlight group(s), column pattern, default searches, trend props. Today that
   bundle only exists as an investigation's requirement refs; the "profile that applies on open"
   is not yet wired, but every primitive it needs exists (the file gate, the entity-by-reference
   resolver `resolveSavedEntity`, and one-click apply).

**End state:** the user builds a library of entities once, combines them into investigation
templates and file profiles, and LOGAN brings the right toolkit to each log automatically —
the *same instrument for both operators*: the human clicks, the agent references by name
(`scope` / `apply`). That is the whole design in one sentence.

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

## Status & remaining roadmap (updated 2026-08-16)

Shipped:
- **0–1  contract + registry + agent parity** — PR #102. Pure `entityRegistry.ts`
  (`EntityDescriptor` + `toDescriptor`, 13 kinds), `ApiContext.listSavedEntities`,
  `/api/entities`, MCP `logan_entities`.
- **2  read-only Saved panel** — PR #103. Searchable, grouped activity-bar side panel
  (`data-panel="saved"`).
- **3 (apply/reveal)** — PR #105. Saved rows are actionable: ▶ apply / ↗ open / ⧉ copy.
  Clean one-click apply for `investigation` (run), `highlightGroup` (apply/toggle) and
  `session` (select), reusing the existing per-kind functions; ↗ reveal opens each kind's
  home panel/tab (`SAVED_REVEAL_TARGET`); `filter`/`columnLayout`/`constant` live in
  modals/pickers → copy-only. Usage counters `saved:apply|reveal|copy:<kind>` drive what
  earns a dedicated apply next. Parity: written exemption (no new agent verb — reveal is
  viewport-only; apply reaches verbs the agent already has).
- **cross-entity by-reference links + file-template gate on investigations** — PR #100
  (`resolveSavedEntity`, the preflight ✓/✗ + "Run anyway").

Remaining, in build order:
- **3b — requirements-editor picker.** Assemble an investigation's expected-entity list by
  clicking registry rows (reuses the registry + `resolveSavedEntity`), replacing typed names.
- **3c — dedicated apply for the copy-only kinds** as their `saved:apply` demand shows up.
- **NEW — file profiles.** Promote the file-template gate into a first-class **profile** that
  carries an entity bundle + settings and *auto-applies on open* (with a preflight/confirm).
  This is the "file template with a collection of highlights etc." from the 2026-08-16 phone
  chat — the layer-3 north-star made concrete.
- **4 — consolidate** the scattered per-entity panels into the Saved panel.
