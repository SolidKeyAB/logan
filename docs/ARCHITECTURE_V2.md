# LOGAN v2 — Modular, Reusable, High-Performance Architecture

A target architecture and a **safe, incremental** migration path. The goal: turn LOGAN
from a working-but-monolithic Electron app into a layered system whose **editor/viewer
core is reusable** (logs today, code/diff/nexum tomorrow, web later) without a risky
big-bang rewrite.

This is a proposal. Nothing here requires throwing away working code — every phase below
is shippable on its own with tests green.

---

## 1. Principles

1. **One core, many surfaces.** A log line, a code line, and a diff hunk are the same
   thing: *addressable text with decorations*. Build that once; specialize on top.
2. **Depend on ports, not platforms.** Features talk to interfaces (Host, Document,
   CommandBus), never directly to Electron IPC. The platform becomes swappable → web.
3. **One contract for UI and agent.** Anything the UI can do, the MCP agent can do,
   because both call the *same* command bus. No parallel code paths to drift.
4. **Performance is structural, not heroic.** Never load a whole file; virtualize
   rendering; compute heavy decorations off the main thread; cancel everything.
5. **Features are plugins.** Each feature is self-contained: it contributes panels,
   commands, decorations, and (optionally) MCP tools. Toggle on/off without surgery.

---

## 2. Where we are today (honest assessment)

| Area | Today | Pain |
|------|-------|------|
| Renderer | `src/renderer/renderer.ts`, ~7000 lines, one file, inline types, global `state`/`elements` | Hard to reuse, test, or port; features interleaved |
| Platform coupling | Renderer calls `window.api.*` (Electron IPC) everywhere | Blocks web; ties UI to Electron |
| Data paths | IPC (renderer↔main) **and** HTTP (`api-server.ts` for the agent) | Some duplicated handlers (e.g. trends exist in both) |
| Source model | `sourceAdapter.ts` normalizes (text/JSONL/protobuf/MF4) | Downstream still assumes "log lines", not a generic Document |
| Engines | `fileHandler` (line index), `analyzers`, `trendEngine`, `recipes` | Good! Already modular and mostly platform-agnostic |
| Bridge | `api-server.ts` (HTTP) + `mcp-server` (stdio) | Already a clean service seam — underused by the UI |

**Good news:** the *backend* is already fairly modular (FileHandler, analyzers, trendEngine,
recipes are clean). The debt is concentrated in the renderer monolith and the
platform/transport coupling. That's exactly what the phases below target.

---

## 3. Target architecture (layers)

```
┌──────────────────────────────────────────────────────────────┐
│  L4  WORKBENCH / SHELL  (UX)                                   │
│      activity bar · panels · tabs · command palette · status   │
│      composes feature contributions; owns layout + theming     │
├──────────────────────────────────────────────────────────────┤
│  L3  FEATURE MODULES  (plugins — each self-contained)          │
│      log: levels·filter·analysis·trends·time-gaps·baselines·   │
│           live·investigate(triage)                             │
│      code (future): syntax·symbols·git-diff·review             │
│      each contributes: panels + commands + decorations + tools │
├──────────────────────────────────────────────────────────────┤
│  L2  EDITOR / VIEWER CORE   ★ the reusable heart ★             │
│      virtualized text surface · gutter · minimap · selection   │
│      DECORATION API (highlights/annotations/findings/bookmarks │
│      are all "decorations") · commands · word-wrap · zoom       │
│      knows nothing about logs or code — just Document+Decoration│
├──────────────────────────────────────────────────────────────┤
│  L1  DOCUMENT MODEL                                            │
│      Document = line-addressable text + metadata (cols, level, │
│      timestamp, language). Built from SourceAdapter output.    │
│      O(1) random access; search index; chunked/lazy            │
├──────────────────────────────────────────────────────────────┤
│  L0  HOST PORT + COMMAND BUS  (the swappable platform seam)    │
│      Host: files, storage, processes, dialogs                  │
│      ElectronHost (IPC/Node)  |  WebHost (HTTP/fetch)          │
│      CommandBus: one typed contract; transports = IPC/HTTP/    │
│      in-proc; UI + MCP agent both call it                      │
└──────────────────────────────────────────────────────────────┘
```

### The key idea: one Command Bus for UI **and** agent

Today there are two ways to "search": the renderer's `window.api.search` (IPC) and the
agent's `POST /api/search` (HTTP). Define each operation **once** as a typed command:

```ts
// shared/commands.ts — the single source of truth
interface Commands {
  'doc.search':   (q: SearchQuery)  => SearchResult;
  'doc.getLines': (r: LineRange)    => Line[];
  'analyze.run':  (o: AnalyzeOpts)  => AnalysisResult;
  'triage.recipe':(o: RecipeOptions)=> RecipeResult;
  // …every capability, once
}
```

Then transports just *carry* commands: Electron IPC, localhost HTTP (agent), and direct
in-process calls all implement the same `CommandBus`. The MCP server becomes a thin
adapter over the bus. Result: **the agent can do exactly what the UI can, automatically**,
and the duplicated trend/recipe handlers collapse into one. (The triage recipe engine
already previews this — it's written against an abstract `ApiCall`, so the UI runs it via
localhost and the agent runs it via MCP, *same engine*.)

### The Decoration model unifies the visual language

Highlights, annotations, agent findings, bookmarks, search hits, filter dimming — today
each is bespoke. In L2 they're all **decorations** on a line/range with a style + gutter
marker + minimap marker + optional click action. One model →
consistent UX, one render path, and new feature markers are free.

---

## 4. Performance strategy

- **Keep the line-offset index** (`fileHandler`) — never read the whole file. This is
  already LOGAN's superpower (1M-line random access); formalize it in L1.
- **Virtualized viewport** (already in the renderer) becomes the L2 core; only visible
  lines + a small overscan are in the DOM.
- **Off-main-thread decorations**: syntax tokenizing and large highlight/finding sets
  computed in a Web Worker (renderer) / worker thread (main), streamed in as ranges.
- **Cancellation everywhere**: the existing `*Signal = {cancelled}` pattern becomes a
  standard `AbortSignal` threaded through every command.
- **Web path**: `WebHost` uses HTTP range requests against a server that holds the index;
  the viewer code doesn't change — it just asks the Document for line ranges.

---

## 5. UX strategy (architect + UX hats)

- **Command palette** (Ctrl/Cmd-P) as the universal entry point. Every feature command is
  discoverable and keyboard-driven — the single best anti-YAGNI move (features stop
  hiding in panels nobody opens). The Investigate symptoms, Trends cells, baselines, etc.
  all register here.
- **One pinning model.** Agent findings and user annotations are the same decoration, so
  "the agent pinned this / I pinned this" look and behave identically (already converging
  via `logan_report_finding` + the Investigate panel).
- **Feature toggle = plugin manager.** The existing Features gear becomes enable/disable
  for L3 modules — the app you see is the features you turned on.
- **Surfaces, not modes.** Logs, code, and diff are just different Document types in the
  same shell; switching is opening a different document, not a different app.

---

## 6. Migration path — incremental, each phase shippable

No big-bang. Order chosen so the highest-value, lowest-risk work comes first and nothing
breaks between phases.

| Phase | What | Risk | Payoff |
|-------|------|------|--------|
| **0. Modularize the renderer** | Carve `renderer.ts` into ES modules **by feature** (viewer, search, filter, analysis, trends, investigate, live…), sharing today's `state`/`elements` via explicit imports. Behavior-preserving. | Low (mechanical) | Huge readability/testability win; makes every later phase tractable |
| **1. Host port** | Wrap `window.api` behind a `Host` interface; renderer depends on `Host`, not Electron. | Low–med | Unlocks web; isolates platform |
| **2. Editor/Viewer core + Decoration API** | Extract the virtualized viewer as a standalone module; migrate highlights/annotations/findings/bookmarks to one decoration model. | Med | The reusable heart; consistent UX |
| **3. Unify the Command Bus** | Define typed commands once; route IPC + HTTP + MCP through them; delete duplicated handlers. | Med | Agent = UI parity; kills drift/dup |
| **4. Document model** | Formalize L1 around `sourceAdapter`; features become Document-based, not log-line-based. | Med | Code/diff become "just another Document" |
| **5. Package the core** | Ship L0–L2 as a reusable lib consumed by LOGAN (logs) **and** a nexum code-view surface (and a future web LOGAN). | Med | The original goal: reuse across nexum |

**Recommended first step: Phase 0**, and within it a *thin vertical slice* as proof —
e.g. extract the Investigate feature (it's new, self-contained, and already engine-backed)
into its own module + a `Host`-routed call. That validates the module boundaries and the
Host seam on one feature before touching the rest. Small PR, tests green, reversible.

---

## 7. What this buys nexum

- The **editor/viewer core + decoration + command bus** (L0–L2) is the "annotate-anything"
  package the code-viewing infra needs. LOGAN's logs become *one consumer* of it; a nexum
  code-review surface becomes another, sharing the agent-pins-findings loop verbatim.
- The **web port** (separate, larger effort) reduces to writing a `WebHost` + serving the
  same L2–L4 — because by Phase 3 nothing in the UI talks to Electron directly.

---

## 8. Risk & recommendation

This is **weeks of work across phases, not one PR** — and a working app is being
refactored, so discipline matters. Recommendation:

1. Approve the layering + the Command Bus idea as the north star.
2. Start with **Phase 0 modularization** + the Investigate vertical slice as proof.
3. Re-evaluate after Phase 0: the readability win alone may reorder priorities.

Do **not** attempt L2/L3 extraction before Phase 0 — moving features out of the monolith
is only safe once the monolith has seams.
