# Scope — Query the log AND any derived view with the same tools

> **North-star (Özge, 2026-08-06):** *"I should be able to query the log file and also
> filtered output like search results … with some similar or more granular tools."*

This is the spec for that. The answer is **not** 20 new tools — it's one new idea applied
across the tools we already have.

---

## 1. The concept — `VERB × SCOPE`

Every tool decomposes into two independent knobs:

- **VERB** — *what it does*: `analyze`, `trend`, `time-gaps`, `cadence`, `evidence-pack`,
  `search`, `count`, `investigate`, …
- **SCOPE** — *what it runs over*: whole file · the active **filter** · the current
  **search results** · a **line range** · a **time window** · a **component** · an explicit
  **line-set** (selection / findings).

"More granular tools" = the **cartesian product**: *any verb over any scope*. Today almost
every verb is hard-wired to "whole file." The unlock is to make **scope a first-class
parameter** that every verb honors.

### 1.1 Composability is the real win

The **output** of one query becomes the **scope** of the next:

```
search "timeout"  ─▶  use hits as scope  ─▶  trend retryCount WITHIN them  ─▶  time-gaps WITHIN them
```

That's Unix pipes / SQL views / Photoshop selections. A visible **scope breadcrumb** shows
what you are currently looking *through*:

```
file › filter:ERROR › search:"timeout"      (2,431 → 388 → 47 lines)
```

### 1.2 Same instrument, two operators

Scope is set two ways over the **same** underlying primitive (see
[LOGAN tool grammar](#) / the "same instrument, two operators" principle):

- **Human** clicks — *"use these search results as scope"*, *"use the filter as scope"* —
  which sets an **`activeScope`** in the app.
- **AI** passes a `scope` argument on any tool call. It can say `scope:"active"` to run
  inside *exactly what the human is looking at*, or pass its own descriptor.

Turn the AI off and every scoped query still works by hand.

---

## 2. Scope model

### 2.1 Descriptor (what the caller supplies)

```ts
// src/shared/types.ts
type ScopeDescriptor =
  | { type: 'all' }                                   // whole file (default — current behaviour)
  | { type: 'active' }                                // whatever the human/app currently has set
  | { type: 'filter' }                                // the active filter's line-set
  | { type: 'search' }                                // current search results' line-set
  | { type: 'range';     start: number; end: number } // contiguous, 1-based viewer lines
  | { type: 'time';      from: string;  to: string }  // wall-clock window
  | { type: 'component'; name: string }               // lines belonging to a component
  | { type: 'indices';   lines: number[]; label?: string } // explicit line-set (selection, findings, AI hits)
```

### 2.2 Resolved form (what engines consume)

Every descriptor resolves to **one of two canonical shapes**, and *both seams already exist
in the codebase*:

```ts
type ResolvedScope =
  | { kind: 'range';   startLine: number; endLine: number; label: string; count: number }
  | { kind: 'indices'; lines: number[];                    label: string; count: number }
```

- **`range`** → consumed by the trend engine's existing `ScanRange` (`src/main/trendEngine.ts:215`,
  `scanLines()` respects `startLine`/`endLine` at `:223`). **Proven end-to-end today.**
- **`indices`** → consumed by the EXTRACT primitive
  `streamFilteredExtractToFd(fd, handler, filteredLineNumbers, …)` (`src/main/index.ts:4352`),
  which already iterates a `number[]` of line indices → `handler.getLines(ln, 1)`. **This is
  the reusable seam** for running *any* verb over a discontiguous line-set.

So the entire feature is: **resolve a descriptor → a range or an index-array → feed the seam
the engine already has.**

---

## 3. Grounded reality — how far along we already are (~30%)

| Fact | Location |
|---|---|
| Active filter **is** a `number[]` of 0-based line indices | `filterState: Map<file, number[]\|null>` — `src/main/index.ts:129`; `getFilteredLines()` `:131` |
| Trend tools already accept `startLine`/`endLine` end-to-end | schema `src/mcp-server/index.ts:461`; endpoint `src/main/api-server.ts:1090`; engine `ScanRange` `src/main/trendEngine.ts:215` |
| EXTRACT already runs over an index-set → file | `streamFilteredExtractToFd` `src/main/index.ts:4352` |
| `ApiContext` already exposes everything a resolver needs | `getCurrentFilePath / getFileHandler / getFilteredLines / getAnalysisResult` — `src/main/api-server.ts:281–325` |
| Search results held in renderer | `state.searchResults: SearchResult[]` (has `lineNumber`) `src/renderer/renderer.ts:210` |
| Selection held in renderer | `state.selectionStart / selectionEnd` `:208` |
| Verb palette (right-click) to hang "use as scope" on | `handleContextMenu()` `src/renderer/renderer.ts:4455–4799` |
| Status-bar filter chip to grow into a breadcrumb | `#status-filtered` badge `:825`, label render `:19275` |

**The gaps:**
- `logan_analyze`, `logan_time_gaps`, `logan_evidence_pack`, `logan_investigate_*` read the
  **whole file only** (`columnAwareAnalyzer` does `fs.openSync` over everything,
  `src/main/analyzers/columnAwareAnalyzer.ts:95`).
- **Filters are display-only** — analysis never consults `getFilteredLines()` (used only for
  the status count, `api-server.ts:587`).
- **No `activeScope`**, no "use as scope" verb, no breadcrumb. Filter is a single flat state
  (replace/suspend, never composed).

---

## 4. Architecture

```
 HUMAN click "use as scope"                    AI tool call: {scope:{…}}
        │                                              │
        ▼                                              ▼
 renderer sets activeScope ──IPC──▶  MAIN: activeScope: Map<file, ScopeDescriptor|null>
        │                                              │
        ▼                                              ▼
   breadcrumb UI  ◀──────────────────────  resolveScope(ctx, descriptor) : ResolvedScope
   (#status-filtered)                                  │  (uses getFilteredLines / getAnalysisResult / handler)
                                                       ▼
                                    engine seam:  ScanRange (range)  |  index-loop (indices)
```

- **`resolveScope(ctx, descriptor)`** lives in the **main process** next to `ApiContext`
  (it needs `getFilteredLines()`, `getAnalysisResult()`, the file handler). One resolver,
  used by every endpoint.
- **`activeScope`** mirrors `filterState` exactly (a `Map<file, ScopeDescriptor|null>`), so
  `scope:"active"` and the human's clicks read/write the same cell — *same instrument, two
  operators*.
- **MCP**: every scopeable tool gains an optional `scope` param; omit it → `{type:'all'}` →
  today's behaviour (100% back-compat). The existing `startLine`/`endLine` on trend tools stay
  as sugar for `scope:{type:'range'}`.

---

## 5. PR-plan (each PR independently shippable + green: `tsc 0`, full suite, bundles)

### PR 1 — Scope core (main-process plumbing, no user-facing change)
- Add `ScopeDescriptor` + `ResolvedScope` to `src/shared/types.ts`.
- Add `resolveScope(ctx, descriptor): ResolvedScope` in main. Cases: `all` → whole range;
  `filter` → `getFilteredLines()`; `range`/`time`/`component` → range or indices via
  `getAnalysisResult()`; `indices` → passthrough. (`search`/`selection`/`active` need PR 3's
  state — until then they resolve to `all` with a warning.)
- Extend the analysis read path to accept a line-set: add `lineIndices?: number[]` (or a
  `{startLine,endLine}`) to `AnalyzerOptions` (`src/main/analyzers/types.ts`);
  `columnAwareAnalyzer` iterates the subset using the **EXTRACT index→`getLines(ln,1)`
  pattern** instead of the whole-file `fs` scan.
- **Tests:** pure `resolveScope` unit tests (all / filter / range / indices / component /
  empty) + analyzer-over-index-set returns subset counts. *(Mirror the `overviewSpread.ts`
  tested-helper pattern.)*

### PR 2 — `scope` on the read-only analysis tools + endpoints
- Add optional `scope` to: `logan_analyze`, `logan_time_gaps`, `logan_evidence_pack`,
  `logan_search` (search-within), `logan_investigate_component / _timerange / _crashes`.
  Fold trend tools' `startLine`/`endLine` under the same `scope` (keep the old params as sugar).
- `api-server`: parse `scope` → `resolveScope` once → hand the engine a range or an index
  array via the PR-1 seam. Trend path is already wired; analyze/time-gaps/evidence-pack now
  route through the same resolver.
- **Tests:** `analyze` over a filtered index-set; `time-gaps` over a range; `evidence_pack`
  reports "scoped to N lines".

### PR 3 — `activeScope` state + human "use as scope" verbs + breadcrumb
- **Main:** `activeScope: Map<file, ScopeDescriptor|null>` mirroring `filterState`; IPC + `/api`
  set/get (edit **both** `shared/types.ts` and the preload IPC object — per the dual-definition
  rule); MCP `scope:"active"` resolves against it; `search`/`selection` descriptors now
  resolve (renderer pushes the line-set to main on set).
- **Renderer verb palette** (`handleContextMenu`, after the Distance item ~`:4699`):
  *Use search results as scope · Use filter as scope · Use selection as scope · Use component
  as scope.* Each builds a `ScopeDescriptor` and sets `activeScope`.
- **Breadcrumb** in the `#status-filtered` region (reuse `.status-filter-label` styling):
  render the scope as chips `file › filter:ERROR › search:"timeout"` with live line counts;
  click a crumb → pop back to it; ✕ → `{type:'all'}`.
- Now human-set scope and AI `scope:"active"` are the same cell.

### PR 4 — Composition + polish (optional / later)
- **True pipe:** the breadcrumb becomes a *scope stack* whose resolution **intersects** the
  sets (`filter ∩ search ∩ range`), not just "top wins".
- Every panel (Trends / Analysis / Time-Gaps / Cadence) shows a "scoped to N lines" ribbon.
- Persist `activeScope` to the `.logan/<file>.json` sidecar so it survives reload.

---

## 6. Back-compat & guarantees
- `scope` is **optional everywhere**; absent ⇒ `{type:'all'}` ⇒ byte-identical to today.
- Existing `startLine`/`endLine` remain valid (map to `scope:{type:'range'}`).
- An **empty scope** (filter matched 0 lines) returns an explicit "0 lines in scope" — never
  a silent fall-through to the whole file.

---

## 7. Secondary ask — "should the AI write reports of what it did / how it concluded?"

Good instinct, but that's **downstream of scope**, and it **already half-exists** — no new
concept needed here, tracked separately:

- `logan_get_investigation_log` — the ordered tool calls = *the logic the agent followed*.
- `logan_save_investigation` — turn that path into a **named, re-runnable recipe**
  (see [INVESTIGATION_TEMPLATES.md](INVESTIGATION_TEMPLATES.md)).
- Conclusion panel / `logan_build_conclusion` — *how it concluded*: verdict + timeline +
  evidence + `.md`/`.pdf` export.

The only gap is making the agent **narrate its scope-path as it goes** (each step records the
scope it ran under) and surfacing those two artifacts human-readably. Scope makes the
investigation log strictly better: every recorded step now carries *what it was looking
through*, which is exactly the "how did you get here" a bug ticket needs.

---

## 8. Relationship to existing design
- **[GRANULARIZATION_DESIGN.md](GRANULARIZATION_DESIGN.md)** defines the *units* axis (what is
  addressable: records, components, time-buckets, `unit_id`s). **Scope is the orthogonal
  *where* axis** — it runs any verb over any one of those addressable sets. They compose:
  granularization *names* the sets; scope *runs verbs over* them. A `component` / `time` scope
  is literally a granularization unit used as a selection.
- Extends the **LOGAN tool grammar** (`nouns/verbs/3-layers`): `scope` is the missing
  first-class *noun* that the verbs bind to.

---

## 9. One-line spec to build against

> `verb(scope, params)` where `scope ∈ {all, active, filter, search, range(a,b),
> time(t0,t1), component(c), indices[…]}` — and **any tool's output can BE the next tool's
> scope.**
