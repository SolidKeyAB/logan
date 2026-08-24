# LOGAN — Investigation Workflow Canvas (north-star, "final phase")

> Özge's dream for the final phase (2026-08-19, phone):
> *"The AI uses our tools to ease its work on logs AND visualizes the process it took to
> find things — as reusable entities or compositions like templates. The user should see
> those templates like a workflow, visually linked together, and reuse them by
> changing/tweaking the nouns or config of any node and save as another instance."*

This is not a new feature bolted on — it's the **convergence** of three things LOGAN already
has, plus one missing surface (the canvas). Framed in our own idiom below.

---

## ⭐ Refined north-star (2026-08-20, phone) — lead with REPLAY, build bottom-up

Özge narrowed the goal to the killer job (this matches Fable's plan-adjustment #4 below):

> **"User to be able to easily rerun a past root-cause hunt on a new incident."**

Steering decisions this session:
- **Build bottom-to-up.** Start from the replay *primitive* and earn each surface upward. The 2D canvas / DAG is the top; the replay ergonomics are the bottom — do the bottom first.
- **Drop the last phase (P4 — compose / DAG).** Agreed it's not worth the effort now.
- **Don't hard-gate on the Usage Monitor counters.** They live on the MacBook but Özge mostly works on the work laptop, so today's numbers under-count real use — a low `run_investigation` count likely means the human *can't yet* tweak-and-replay easily, not that nobody wants to. Ship the replay ergonomics; measure after. (Counts can still be shared, but they don't gate P0.)

### The one real gap (grounded in live code, 2026-08-20)

The replay engine is **already built and already param-overridable** — what's missing is a pure human/agent **parity** gap:

| Layer | Can tweak nouns (time / component) then rerun? |
|-------|-----------------------------------------------|
| Engine `/api/investigation-run` | ✅ `resolveSteps(tpl, body.params \|\| {})` — accepts overrides — `api-server.ts:842` |
| Agent `logan_run_investigation` | ✅ exposes a `params` fill-in |
| Requirements preflight (hard gate) | ✅ blocks a mismatched log + "Run anyway" — `api-server.ts:834`, `renderer.ts:7092` |
| Per-step results view (human) | ✅ ✓/✗ + summary rows — `runInvestigationTemplate()` `renderer.ts:7099` |
| **Human replay call** | ❌ `renderer.ts:7089` passes `undefined` for params — the human ALWAYS replays with the *captured* values; there is **no UI to tweak the nouns** before rerun |

So today the human can only re-run a hunt **verbatim**; only the AI can adapt it to a new incident. That single gap is exactly what blocks "easily rerun on a *new* incident."

### Do we need to upgrade the entity arch? — a little, in ONE place

Mostly no: `investigation` is already a Tier-1 registry entity with a requirements manifest, and the replay engine already takes param overrides. The big canvas/composition arch stays deferred. But the refined goal *does* justify one small, bottom-up entity improvement:

- **Promote the fill-in nouns to a declared parameter schema on the `investigation` entity.** Today the params (component / field / pattern / event) are *implicitly extracted* at save time. To make "tweak the time window / component and rerun" reliable, the entity should carry a first-class `params[]` sub-doc: `{ name, kind: time-window|component|field|pattern|event, captured (default) value, label }`. Then Build 1's inline tweak-form renders *from the schema* (deterministic, not guessed) and the AI `params` override reads the same contract. This is the "noun" half of the tool-grammar made explicit — a natural extension of the requirements manifest (a peer sub-doc), not a new store.
- Everything else in the entity arch already suffices for easy replay. No Tier-1/Tier-2 reshuffle needed for this goal.

### Bottom-up sequence (revised)

- **Build 0 — entity noun-schema (optional but enabling).** Add the declared `params[]` sub-doc above; back-fill from the existing implicit extraction so nothing breaks.
- **Build 1 — the bottom, do first.** Expose the existing param-override to the human. On ▶ Apply / Replay of an investigation that has fill-in nouns, prefill the captured values in a small **inline** form (time window first, component second, then field / pattern / event), let the user edit → `runInvestigation(name, params, force)`. Engine + results + preflight already exist, so this is a contained renderer change that closes the parity gap and *by itself* delivers the refined goal. UX per Fable #7: inline editable chips, no modal, no JSON.
- **Build 2 — trustable steps.** Each step shows its RESULT (hit counts / what it found), not just the verb — already half-there via the per-step `summary`; enrich it.
- **Build 3 — see the hunt (was P2).** Read-only **vertical step-list** (commit-log style, entity chips reusing `SAVED_REVEAL_TARGET`) — "see what the hunt does." NOT a 2D canvas.
- **Later / maybe.** Tweak-a-step-then-save-as-new-instance (fork) on that step-list. The 2D canvas + compose (old P4) are **dropped** for now.

---

## The dream, decomposed

1. **AI works with our tools** — ✅ already true (62 MCP tools = "same instrument, two operators").
2. **AI visualizes the *process* it took** — the ordered path search→filter→analyze→trend→investigate becomes a *thing you can see*, not just chat text.
3. **That process is a reusable entity / composition** — a template, and templates can chain other templates + entities (composition).
4. **User sees them visually linked** — a workflow graph: nodes = steps/entities, edges = sequence / dataflow / reference.
5. **User tweaks a node's nouns/config and "saves as another instance"** — fork-with-edits, producing a new derived template/entity.

---

## What already exists (the substrate — ~70% of the primitives)

| Dream piece | Already built |
|-------------|---------------|
| Process capture | **Investigation journal** — every agent tool call flows through api-server and is auto-recorded in order (`logan_get_investigation_log`). |
| Process → reusable | **Save as template** with fill-in **nouns** = params (component / field / pattern / event) → `logan_save_investigation`; replay via `logan_run_investigation` (params override). |
| Uniform, forkable, scoped | **Entity Registry** — 14 kinds, all `name + description + scope`, listed via `logan_entities` / `/api/entities`; **investigation** is one kind. |
| See + use | **Saved panel** (`data-panel="saved"`) with per-row ▶ Apply / ↗ Reveal / ⧉ Copy (PR #105) + a `SAVED_REVEAL_TARGET` map (entity → its home panel). |
| First cross-entity **link** | **Requirements manifest** (PR #100) — a template references other saved entities *by reference*. This is the seed of "composition." |
| Agent draws, user sees | **`logan_trend_show`** already renders an agent-computed chart as a *cell* in the Trends panel. The exact pattern the canvas needs. |

## The gap (what the dream still needs — ~30%)

| Missing | Detail |
|---------|--------|
| **Graph model** | Journal is a *flat ordered list*; a canvas needs each step as a typed **node** (verb + nouns/config + optional ref to an entity) with **edges** (sequence \| dataflow \| reference). Need a lossless projection: journal + requirements manifest → `WorkflowGraph`. |
| **Composition** | A template that *contains/chains* other templates + entities as nodes (extend the by-reference link into a real DAG). |
| **The canvas** | A Workflow/Recipe panel that draws the graph — nodes linked, click-to-jump. Does not exist; templates today render as a text step-list / a Saved row. |
| **Tweak + fork** | Click a node → edit its noun/config inline → **"Save as new instance"** (derive a new template/entity). Today params are fill-in *at run time* + whole-entity Copy exists, but there's no *edit-a-step-then-save-as-derived* on a visual surface. |
| **Agent authorship of the visual** | A `logan_show_workflow` verb (mirroring `logan_trend_show`) so the agent *renders its process graph* for the user to manipulate — closes parity (agent BUILDS, human TWEAKS). |

---

## Proposed path (primitive-first, surfaces earned — same process as Entity Registry)

**Phase 0 — Model (pure primitive, no UI). ✅ BUILT 2026-08-24.**
Define `WorkflowGraph` = `nodes[]` (`{id, kind: step|entity, verb, nouns/config, entityRef?}`) + `edges[]` (`sequence | dataflow | reference`). Write a **pure projection** `investigationToGraph(journal, requirements)`. Parity contract only. Zero visual.
> Shipped as `src/main/workflowGraph.ts` (+ `src/tests/workflowGraph.test.ts`, 8 golden tests). Pure, Electron-free (mirrors `columnPattern.ts`). Projects a journal (or a template's steps) into typed nodes+edges: meaningful steps only (noise paths — get-lines/navigate/chat — dropped, counted in `meta.dropped`), `sequence` spine, `dataflow` edge when a step consumes `scope:'active'`, and requirements-referenced entities as `entity` nodes with a `reference` edge from any step that names them. Nouns share `PARAM_KEYS`/`paramKind` with the investigation template (one source of truth), so the graph's tweakable nouns == the replay tweak-form's params. **Build 0 (declared `params[]` noun-schema) was already shipped** — confirmed live in `investigationStore.ts` (`ParamDef.kind` + `paramKind` + back-fill). No UI / agent verb / store yet — those are Phase 1+ (tools & UI), deferred per steering.

**Phase 1 — Agent + registry. ✅ BUILT 2026-08-24.**
`logan_show_workflow` (agent renders its journal as a graph, like `trend_show`) + `/api/workflow-show`. Workflows are either a new entity kind or a **graph projection of the existing `investigation` kind** (prefer projection — no new store). Agent verb + registry list.
> Shipped: `/api/workflow-show` in `api-server.ts` (projects the current session `agentJournal` by default, or a named saved investigation's steps+requirements, via `investigationToGraph`) + MCP tool `logan_show_workflow` (`investigation?` param). **Chose projection, no new store** — a Workflow IS the `investigation` entity viewed as a graph, so the "registry list" is the existing investigation list (`logan_entities` / `logan_list_investigations`); nothing new to persist. Read-only introspection (added to `USAGE_SKIP_PATHS`, not journaled). No UI yet — Phase 2 (read-only step-list) renders this graph.

**Phase 2 — Read-only canvas. ✅ BUILT 2026-08-24 (as a step-list overlay).**
A **Workflow panel** that draws the graph (nodes linked by edges). Click a node → jump to the step's line / **reveal** the entity it references (reuse the `SAVED_REVEAL_TARGET` map). See-only. This is the "user sees the process visually linked" moment.
> Shipped as a **non-modal floating panel** (not a bottom-panel tab — Özge flagged the bottom strip is too short for a vertical list; and not a modal — she wanted it to stay open WHILE working the log). The full-screen layer is `pointer-events:none` so clicks pass through to the app; only the panel is interactive. It floats top-right, is **draggable** by its header and **resizable** (CSS `resize`), closed by its **×** (no Esc hijack, no click-outside-to-close — it's non-modal). Also honors Fable #2 "step-list, not 2D canvas" + "don't add bottom-tab #12". A **⋔** button on each saved-investigation chip opens it. Renders the `WorkflowGraph` (via the same `/api/workflow-show` as the agent, through `IPC.WORKFLOW_SHOW`) as a **commit-log spine**: one node per step with its verb + tweakable **nouns** (time/component tinted — the "money" tweaks), a `↳ prev result` tag where a step consumes the active scope (dataflow edge), reference-entity chips inline, and a footer of expected (unlinked) entities. Entity chips **reveal** where the entity lives (`revealSavedEntity`, with a small EntityKind→reveal-key bridge). Click-to-jump per step is deferred (a saved template has no live lines until run; natural once we render a just-run journal).

**Phase 3 — Tweak + fork.**
Click a node → edit its noun/config inline → **"Save as new instance"** → new derived template/entity (reuse `runInvestigationTemplate` param-override + entity Copy). Run the forked workflow. This is "tweak the nouns and save as another instance."

**Phase 4 — Compose.**
Drag one saved template/entity onto the canvas as a node → chained workflows (DAG). Consolidate: requirements-manifest references + composition edges become one **links** model. This is "compositions like templates, visually linked together."

---

## Why this is low-risk

- Reuses existing engines: journal, template param-override, entity registry, reveal map, `trend_show` render pattern. **Mostly a projection + a canvas**, not a new analysis engine.
- Each phase ships standalone and is independently useful (Phase 2 alone = "finally *see* what the AI did").
- Honors the constitution: primitive-first, both operators (agent `logan_show_workflow` + human canvas), scope, and the "same instrument" rule.

## Naming note

Keep **"entity"** = the reusable, registry-listed thing. Call the graph a **"Workflow"** (or "Recipe") and its steps **"nodes."** A Workflow is itself an entity (composition of entities), so it slots into the registry uniformly.

---

## Fable review — 3 lenses (product / UX / analyst), 2026-08-19

Three independent Fable verdicts. They converged on the same picture and it **revises the plan**:

**Verdict: qualified YES, but ship only through a rethought P2 first.** Strongest reason (product): it converts LOGAN's real differentiator — recorded, replayable AI investigations — from invisible chat text into something you can see, trust, and reuse. Compounding value on shipped primitives, not a new engine.

**Unanimous #1 risk: another authored-but-unvisited panel** — "a beautiful graph of nothing" / "chat scrollback with boxes." Exactly the failure mode of the surfaces we're triaging for removal (Trends/Conclusion/Contexts).

**Plan adjustments (all three lenses):**
1. **Gate before P0 — pull the Usage Monitor counters for `save_investigation` / `run_investigation`.** If nobody saves/replays investigations today, a canvas over them visualizes nothing. Validate the substrate is used *before* investing.
2. **P2 is a vertical STEP-LIST, not a 2D node-graph canvas.** A free-form canvas fights LOGAN's grain (lists / tabs / click-to-line) and adds bottom-tab #12 to a strip we're pruning. A commit-log-style vertical list with indent-for-branch + entity chips (reusing `SAVED_REVEAL_TARGET`) fully delivers "see what the AI did." **Defer real 2D to P4** — only build it if composition genuinely needs 2D.
3. **Nodes must show RESULTS, not just verbs.** `search→filter→analyze` as bare boxes = chat with boxes. Each node needs its outcome (hit counts / what the step found) or it earns only a single glance.
4. **Lead the value story on deterministic REPLAY, not compose.** The killer job (analyst): rerun a past root-cause hunt on a new incident. The #1 noun to tweak-and-rerun is the **time window** (daily), **component** second — not the DAG. Prioritize param-override on time/component over P4 composition.
5. **Drop journal noise.** Filter `get_lines`/navigation fetches out of the graph — only meaningful investigative steps become nodes.
6. **Requirements preflight must HARD-block** a replay on a mismatched log format (already built, PR #100 — keep it strict; a silent success on the wrong format kills trust).
7. **Fork interaction (UX):** click a step → its noun chips become inline-editable fields → dirty state shows a sticky "Save as new…" button. No modal, no right-click, no JSON editing.

**Net:** the vision holds; the *shape* changes — a results-annotated step-list with inline tweak+save, gated on real usage numbers, with the 2D canvas deferred until composition earns it.

---

## Clue trail — the EVIDENCE twin of the process journal (2026-08-20, phone)

Özge's addition to the replay aim: during an investigation the agent (mostly) — and the human too — picks out log lines / signal values / ranges **in a sequence** that shows what went wrong across the bug's time frame. That ordered set of clues is itself a first-class **entity** (an ordered collection of entity-refs), and it should be **natural to collect and save** — including from a *known-good* ("totally working") run.

Two different things, now both entities:
- **Process** = the ordered tool calls (HOW you investigated) → the `investigation` template. Already built (Build 0+1).
- **Evidence** = the ordered clues (WHAT points to the bug) → a **clue trail** / evidence sequence. NOT yet a first-class ordered entity — today it's scattered across bookmarks (unordered set), findings/annotations, highlights, notes, and the transient Conclusion timeline.

### It's a new entity KIND: `sequence` (ordered clue trail)
An ordered list of heterogeneous **clue refs** — each `{ ref: line | range | signalValueAtTime | searchHit | finding, at (line/time), note }` — saved with a name + description + scope, listed in the Saved panel / Entity Registry like every other entity. **Order = the bug's timeline.** It is the linear-evidence twin of the workflow graph's node sequence.

### The natural collect-and-save flow (the "how")
Reuse the interaction we already have — **selection is the noun, right-click is the verb palette**:
1. Select a line / range / signal value at a time / search hit.
2. Right-click → **"Add to sequence"** → appends to an active **clue tray** (a light bottom strip / side list); each clue keeps its line/time + an optional note. Drag to reorder.
3. **"Save sequence as…"** → a new `sequence` entity in the Saved panel.
Zero modals; one gesture per clue. **Agent parity:** an MCP append verb (`logan_add_clue` / append-to-sequence) + save — the agent builds the trail as it investigates, exactly as it already pins findings via `logan_report_finding`.

### Seeds already in the code (≈70% again)
- **Findings-handoff** (`logan_import_findings`, PR #118) — a NAMED, ORDERED batch of clues the user ticks off. Closest existing shape; the clue trail generalizes it to mixed refs + explicit order + reorder + save-as-entity.
- **bookmarkSet** — a saved set of line bookmarks (add order + notes → a trail).
- **Right-click verb palette** + selection granularities (text / line / range) — the collect gesture already exists.
- **Signals/Trends** click-to-line — a signal value at a time is already a navigable ref.
- **Conclusion panel** already assembles timeline + evidence, but transiently (md/pdf export). The clue trail promotes that to a saved, reusable, BOTH-operator entity — and likely **supersedes Conclusion**.

### The positive / "working sequence" framing
Because it's just an ordered clue collection, you can save a **known-good** run's sequence too — the healthy baseline of what each checkpoint should look like. On a new incident you re-verify each clue (does it still hold?) — not only chase the bug trail. This composes with replay: the `investigation` template GENERATES the clues, the `sequence` CAPTURES them, the requirements preflight GATES the log. **Process + Evidence + Gate = guided replay end-to-end.**

### Staged plan (primitive-first — the NEXT increment)
Same earn-the-surface process as the Entity Registry / replay builds:
- **A — the entity + agent collect/save (SHIPPED 2026-08-20).** New `sequence` kind + store (`src/main/sequenceStore.ts`): an ordered `SequenceClue[]` where each clue = `{ ref: 'line'|'range'|'signalValue'|'searchHit'|'finding', line?, endLine?, at?, field?, value?, note? }`, saved with name + description + scope. Surfaced in the Entity Registry (`toDescriptor('sequence')` + `/api/entities` + `logan_entities`). Agent operator can already collect + save: `logan_add_clue` (append one clue, creates the trail if missing — the "collect as you investigate" gesture, parity with `logan_report_finding`) and `logan_save_sequence` (write a whole trail). HTTP: `/api/sequences`, `/api/sequence-save`, `/api/sequence-append-clue`, `/api/sequence-delete` (emits `sequences-changed` for B to listen on).
- **B — the HUMAN gesture + visible surface (next).** Right-click a selection (line / range / signal value / search hit) → **"Add to sequence"** → a live **clue tray** (light strip) + **"Save sequence as…"**; a read-only "Clue sequences" group in the Saved panel (listen on `sequences-changed`). This closes parity (agent side landed in A) and makes the trail visible.
- **C — apply / re-verify.** Saved-panel ▶ Apply on a `sequence` = step through its clues in order (guided tour, reusing click-to-line). On a NEW incident, re-verify each clue still resolves (line/value present?) → pass/fail per clue.
- **D — known-good baseline + supersede Conclusion.** Save a healthy run's sequence; compare a bug run clue-by-clue. Fold the transient Conclusion timeline into this saved entity (Conclusion becomes an EXPORT of a `sequence`, not its own store).

Reuses: entity registry + Saved panel (A's surfacing), the report_finding/annotation pipeline (B's agent side), click-to-line + Signals refs (C), baseline-compare idiom (D). ~70% substrate; net-new = the `sequence` store + the tray gesture + the append verb.
