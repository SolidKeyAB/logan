# Parity Checklist — "same instrument, two operators"

LOGAN's north star is **AI-oriented, not AI-based**: every action a human can
trigger by clicking is the *same* action the AI triggers over the API. The AI has
no private powers; turn it off and every feature still works by hand. This is
constitution **rule 5 (parity)**.

Parity debt accrues silently — a new human-only verb (an IPC handler + a button)
ships, and the AI simply can't do it. This checklist makes parity a deliberate,
reviewable decision instead of an accident.

## The rule (binding)

> **Every new user-facing verb** — a new IPC handler wired to a panel/menu action
> that *does* something to the log, a selection, a filter, or a file — **must ship
> with either (a) an `/api/*` endpoint + MCP tool counterpart, or (b) a written
> exemption in the PR description** saying why the AI should not have it.

A "verb" is an action, not a query for internal plumbing. Pure UI state
(scroll position, which panel is open, theme) needs no counterpart. Anything that
searches, filters, compiles a pattern, annotates, extracts, merges, investigates,
or otherwise *transforms a noun on the canvas* does.

## PR checklist

Copy this into the PR when you add or change a verb:

- [ ] Does this add/modify a user-facing verb (IPC handler behind a panel/menu action)?
- [ ] If yes: is there an `/api/*` endpoint that reaches the **same** implementation (shared function or `ApiContext` method — not a re-implementation)?
- [ ] Is there an MCP tool in `src/mcp-server/index.ts` calling that endpoint?
- [ ] Is the verb counted in the Usage Monitor for **both** operators, and mapped in `src/shared/verbRegistry.ts` so the human/AI counts join?
- [ ] Redaction: does the MCP tool default `redact: true` for any response that can contain log content? (Metadata-only responses — e.g. a compiled pattern the AI itself supplied — may default `redact: false`.)
- [ ] **One effect layer?** Does the verb declare a single primary effect — View / Scope / Read / Produce / Mark (see [Effect layers](#effect-layers--the-second-axis))? If it needs two, split it.
- [ ] **OR** written exemption: _"Human-only because …"_ (e.g. it's a pure viewport/UI concern, or a security-gated capability the AI must not have).

## Effect layers — the second axis

Parity asks *"can both operators do it?"*. This axis asks *"what does the verb
**touch**?"* — and the two are orthogonal, so every verb carries **two coordinates**:

- **Altitude** (the existing 3-layer pyramid — L0 primitives → L1 composites → L2
  synthesis): *how much* a call does.
- **Effect layer** (this axis): *what* a verb changes. Every verb declares **one**
  primary effect:

  | Layer | "Does it change what other verbs see?" | Verbs |
  |-------|-----------------------------------------|-------|
  | **View** | Presentation only. Reversible; changes nothing another verb reads. | line/column mute, highlight, fold, navigate, muted-size |
  | **Scope** | Sets the working set later verbs operate on. | filter, active-scope, hide-columns, single-session concat, folder-mute |
  | **Read** | Returns information. No mutation, no artifact. | search, get-lines, analyze, trends, time-gaps, evidence-pack, diff-runs, investigate-* |
  | **Produce** | Writes a new derived artifact / file / entity. | extract, merge-to-file, wall-clock materialize, save-report, save-investigation |
  | **Mark** | Attaches a durable record to the log. | bookmark, report-finding / annotate / import-findings, add-clue / save-sequence, baseline-save, context-attach |

### The rule (one verb = one effect layer)

> **A verb declares exactly one primary effect layer. If it needs two, split it.**

This is a **design-review gate checked at PR time**, not a runtime field on every
tool. It catches the overlapping-verb trap *before* it ships:

- **Motivating case — mute (#155 → #162 → #163).** Column/line mute churned because
  it straddled **View** (dim in place) and **Scope** (drop from search / analyze /
  extract). The rule forces the split: mute is **View** → visual-only; *shrinking
  the working set* belongs to **Scope** (Hide columns / Filter rows) or **Produce**
  (Extract). Applying the rule retroactively is exactly what #163 did.

### Where it earns its keep (and where it would be bureaucracy)

It earns its keep in exactly two places — both of which **consume** the tag, so it
drives behavior instead of decorating:

1. **This review gate.** One-verb-one-layer is a yes/no question a reviewer can
   actually answer, and it would have flagged mute before the churn.
2. **AI verb-selection.** Put the layer word in the MCP description of the
   *confusable cluster only* (mute / filter / extract / hide / highlight). Then the
   agent reasons "to shrink what I analyze I reach for a **Scope** verb, not a
   **View** one" — a real constraint on tool choice.

What we deliberately **do not** build: an `effectLayer` field on all ~68 tools + a
registry + badges everywhere. Nothing would read it → bureaucracy. Materialize the
tag only where something consumes it (a description string, a palette grouping) —
the same "earn the surface with usage" discipline as the entity registry. Beyond
these two, the axis stays a **design axis** used when classifying a new verb; it may
later be surfaced (badges / grouping) once a consumer earns it.

## How to wire a counterpart (reference)

The cleanest shape shares ONE implementation between the human and AI paths:

1. Factor the handler body into a named function (or an `ApiContext` method) so
   the IPC handler and the API endpoint both call it — see `runFilteredExtract`
   in `src/main/index.ts`, used by both `IPC.EXTRACT_FILTERED_TO_FILE` and
   `ApiContext.extractFilteredToFile` (`/api/extract`).
2. Add the `if (url === '/api/<verb>')` block in `src/main/api-server.ts`
   (inside the `enterAiContext()` dispatch); convert internal 0-based line numbers
   to 1-based `viewerLine` at the API boundary.
3. Register the MCP tool in `src/mcp-server/index.ts` (`server.tool(...)`) calling
   `apiCall('POST', '/api/<verb>', body)` and `maybeRedact()` the result.
4. Add the verb to `src/shared/verbRegistry.ts` so the Usage Monitor joins the
   human action name and the api slug onto one feature.

## Current parity ledger

Closed by the tool-grammar parity work:

| Verb | Human | AI | Status |
|------|-------|----|--------|
| Evidence pack / Brief | 📋 Brief button | `logan_evidence_pack` | ✅ shared `buildEvidencePack` |
| Build conclusion | Conclusion panel | `logan_build_conclusion` | ✅ shared `synthesizeConclusion` |
| Extract filter → file | ⬇ Extract to file | `logan_extract` (`/api/extract`) | ✅ shared `runFilteredExtract` |
| Compile pattern | Make pattern… | `logan_compile_pattern` (`/api/compile-pattern`) | ✅ shared `compilePattern` + Pattern Log |

Closed by the `feat/columns-panel` parity work (2026-08-13):

| Verb | Human | AI | Status |
|------|-------|----|--------|
| Filter rows by column value | Columns window row-filter | `logan_filter` `columnFilters` (`/api/filter`) | ✅ shared `compileAdvancedFilter` |
| Constants / tags (save/list/delete) | 🔤 Save as constant + picker | `logan_constants` (`/api/constants-*`) | ✅ shared `constantsStore` |
| Column Layouts (save/list/delete) | Column Layouts builder / Columns window | `logan_column_layouts` (`/api/column-layout-*`) | ✅ shared `columnLayoutsStore` |

Closed by the single-session composite parity work (2026-08-18):

| Verb | Human | AI | Status |
|------|-------|----|--------|
| Create single session (composite) | 🔗 button (Time Sync panel) | `logan_single_session` (`/api/composite-create`) | ✅ shared `buildComposite` + `autoSaveSingleSession`; agent path pushes `agent-open-single-session` → shared renderer `displaySingleSession` |

Closed by the multi-log wall-clock correlation work (P0, 2026-08-26):

| Verb | Human | AI | Status |
|------|-------|----|--------|
| Merge N files onto one wall-clock timeline | ⬇ "Merge to file…" (Time Sync panel) | `logan_single_session` `order:"wallclock"` (`/api/composite-create`) | ✅ shared engine `collectMergeTimeline` + `writeMergeEntriesToFile` (`sortMergeEntries` core, unit-tested); agent path writes to `.logan/merged/` + opens via shared `openFileAsCurrent` |

(Both operators interleave via the SAME `collectMergeTimeline`/`writeMergeEntriesToFile` in `index.ts`
— the human picks the destination via a save dialog, the agent writes a stamped file under
`.logan/merged/` next to the first source and opens it as the active file. Because the result is an
ordinary `.log`, every downstream verb works on the correlated view with no composite-invariant
special-casing. A *virtual* time-interleaved composite — no on-disk file — is deferred, P1.)

Closed by the real-parameterized-templates work (P0a, 2026-08-25):

| Verb | Human | AI | Status |
|------|-------|----|--------|
| Curate template params (variable/constant role) | Replay tweak-form: 🔒 pin / ✎ make-variable per row (constants shown read-only) | `logan_set_investigation_params` (`/api/investigation-set-params`) | ✅ shared `setTemplateParams`/`applyParamPatches`; `resolveSteps` pins constants for both operators |

**Partial (agent-only for now):** *promoting an ARBITRARY step value* (a body key auto-promotion never surfaced) into a fill-in ships on the agent side (`logan_set_investigation_params` accepts a `(stepIndex,key)` not yet in `params`). The human tweak-form currently only re-roles the auto-promoted params (🔒/✎); a human "promote this raw value" affordance (needs a step-body picker) is a scoped follow-up, not a written exemption.

(The AI path builds the composite in main — making it the active read target — and pushes the
display to the renderer, which reflects it through the SAME `displaySingleSession` helper the
human 🔗 flow uses. Usage joins human `composite_created` ↔ AI `composite-create` via
`verbRegistry`. Investigate-crashes/-component/-timerange already run on a composite as of the
prior follow-up; Trends-on-a-composite is the remaining single-session gap.)

Uniform entity `description` (2026-08-13) — every saveable "basic entity" gained an
optional `description?: string` so both operators can record an entity's purpose/why
(naming matches the existing `BaselineRecord.description` / `InvestigationTemplate.description`;
findings already carry `detail`). Human editing = a shared `editEntityDescription()` helper
(prefilled modal; blank clears) reached by right-click on the entity's chip/row, plus a `📝`
marker + the note in the hover tooltip. Agent editing = a `description` param on the entities
that have an MCP create/save tool. ONE field name, both operators (rule 5).

| Entity | Human sets it | AI sets it | Status |
|--------|---------------|-----------|--------|
| Constant / tag | Right-click in the constants picker | `logan_constants` `description` (`/api/constants-save`) | ✅ both |
| Bookmark | Right-click a bookmark row | `logan_add_bookmark` `description` (`/api/bookmark`, `-update`) | ✅ both |
| Highlight | Right-click a highlight row | `logan_highlight` `description` (`/api/highlight`, `-update`) | ✅ both |
| Column Layout | Right-click a layout chip | `logan_column_layouts` layout.`description` (`/api/column-layout-save`) | ✅ both |
| Search config | Chip context menu → "Edit description" | — (no MCP create tool) | ✅ human · field carried for AI |
| Search config session | Chip context menu → "Edit description" | — (no MCP create tool) | ✅ human · field carried for AI |
| Pattern property (trend) | Right-click a property chip | — (no MCP create tool) | ✅ human · field carried for AI |

(Search configs / sessions / pattern-properties have no MCP *create* tool today — a
pre-existing human-only exemption — so their `description` is human-set; the field is
carried on the type so an AI tool added later inherits it for free.)

Still human-only — deliberate backlog (add a counterpart or a written exemption
when each is next touched):

- **MUTE** (dim rows in place) — renderer-only viewport effect.
- **Column Layouts — APPLY / show-hide to the viewer** — the layout CRUD (save/list/delete)
  and filter-rows-by-column are now at parity (see the closed table above). *Applying* a
  layout to the human's viewer (render columns + CSS-hide a column) is a **viewport concern
  → human-only by written exemption**: the AI reads raw lines via `logan_get_lines` and
  doesn't need to change what the human sees. Column *visibility* is likewise viewport-only.
- **Cadence** (missing-sequence) analysis — native panel; no MCP tool yet.
- **Time Sync** and **merge-to-file** — the latter *is* the L2 "merge-timeline"
  verb and should get an `/api/merge-timeline` + MCP tool.
- **Esotrace manual / folder decode** — IPC-only; part of the file-handler
  Phase-2 work, which must land behind a written security gate (see
  `docs/FILE_HANDLER_SECURITY.md`) before its verbs are exposed to the AI.
- **Saved panel — APPLY / REVEAL a saved entity** (Entity Registry step 3) — the Saved
  panel rows now dispatch to each entity's *existing* per-kind apply function
  (`runInvestigationTemplate`, `applyHighlightGroup`, `selectSearchConfigSession`) and to
  `openPanel`/`openBottomTab` for reveal. **Written exemption: no new agent verb.** *Reveal*
  is a pure viewport action (jump the human to a panel) — human-only like MUTE / column
  visibility. *Apply* reaches verbs the agent already has at parity: investigations via
  `logan_run_investigation`, highlights via `logan_highlight`, searches/filters via
  `logan_search`/`logan_filter`. The remaining kinds are copy-only for now and stay on the
  pre-existing human-only backlog above; the `saved:apply|reveal|copy:<kind>` usage counters
  decide which of them earns a dedicated apply next.

- **Agent findings handoff — `logan_import_findings`** (batch findings → tick-off-able
  worklist). **At parity, with a written create-side exemption.** Agent surface: MCP
  `logan_import_findings` + `/api/import-findings` (builds N annotations sharing one
  `handoffId`, reusing `addAnnotations` → the same annotation store/persistence/push as
  `logan_report_finding`). Human surface: the **AI Annotations panel** now renders each
  handoff as a titled card (summary + N/M-done progress) whose findings the human can
  click-to-jump, **tick off** (`annotation-update` IPC + `/api/annotation-update`), and
  **clear** (`annotation-clear-handoff` IPC). *Creating* a handoff is agent-only by nature
  (a human doesn't batch-import an external agent's findings) — **written exemption**; the
  human already creates single findings by hand, and fully operates the review/consume
  surface. Done-toggle + clear have both IPC (human) and an api route (agent) for symmetry.

- **Agent save report — `logan_save_report`** (bundle the current investigation into one
  self-contained `.md` doc — LOGAN's universal Log Analysis Report, see
  `docs/LOGAN_REPORT_FORMAT.md`: clear name + AIM + REASON + optional ticket, each pinned
  finding rendered with its **real related log-line sequence** — matched line(s) + context,
  fetched from the file via `getLinesByNumbers` — plus a description, a **Components —
  potentially responsible** section (agent-supplied or derived from the verdict's top failing
  components), an **Open questions** checklist, the recorded steps, and — opt-in — the native
  root-cause verdict with its evidence lines + timeline). Agent surface:
  MCP `logan_save_report` + `/api/save-report` (gathers annotations + journal + optional
  conclusion, batches ONE raw-line read for all finding windows) → pure `reportDoc.ts` builder →
  `ctx.saveReport` writes to the log's `.logan/reports/<slug>.report.md` (read-only fallback to
  `~/.logan/reports/<basename>/`). Human surface: the saved doc is announced in the **chat
  panel** with its clickable path, and is a plain markdown file (fenced log blocks paste
  verbatim into Jira) the user opens (markdown handler), shares, or attaches to a ticket.
  **Written create-side exemption:** the report is the *agent's* work product — it captures the
  agent's session journal + pinned findings, which a human doesn't author. The human's own
  authoring surfaces already exist at parity (Conclusion panel `.md`/`.pdf` export, Notes
  drawer), so no separate human "compose report" UI ships here; the human fully *consumes* the
  doc (open/read/share/paste). Re-running with the same name overwrites, so the agent owns naming.

- **Agent context manifest — `logan_context_attach` / `logan_context_read`** (attach the
  STATIC environment a log was captured under — build id, firmware, device, feature flags,
  config — as typed key→value facts with provenance; the "logs + env" half of coverage, P3 of
  `docs/discovery/multi-log-correlation.md`). Agent surface: MCP `logan_context_attach` /
  `logan_context_read` + `/api/context-manifest` (POST merges/replaces, GET reads) →
  `ApiContext.attachContextManifest` / `getContextManifest` → pure merge in
  `contextManifest.ts` → per-file sidecar `.logan/<file>.context-manifest.json`. The facts are
  **auto-injected** into three surfaces both operators already share: the evidence pack (`env`
  block up front), the saved report (an **Environment** section), and the baseline fingerprint
  (an info **`env-diff`** finding, "build 4.1 → 4.2", so env drift isn't misread as a
  regression). Human surface: the manifest appears in the entity registry (kind
  `contextManifest`) → the **Saved panel** when its file is open, and its facts surface in the
  report's Environment section + the baseline compare view. **Written create-side exemption:**
  static-env capture is the *agent's* job (it reads the build/firmware/flags out of the log
  header or is told them); a human doesn't hand-key an env manifest through a form. The human
  fully *consumes* the manifest (Saved panel + report + baseline env-diff). If real use shows a
  human needs to author/correct facts by hand, a small "Edit environment" form earns its way in
  then — tracked as deferred in the P3 design.

- **Agent run-vs-run diff — `logan_diff_runs`** (template-level differential of two runs —
  "what does the failing run contain that the good run doesn't", P2 of
  `docs/discovery/multi-log-correlation.md`). Agent surface: MCP `logan_diff_runs` +
  `/api/diff-runs` → `ApiContext.diffRuns` → folds the active file (target) and a reference
  log (by path, opened on demand via `getOrOpenHandlerForPath`) through the shared
  `foldHandlerTemplates` (same TemplateFolder engine as `logan_summarize`, so the two folds
  are comparable), then the pure `runDiff.ts#diffRuns` set-diffs the shapes into
  onlyInTarget / onlyInReference / changed. Registered as investigative logic (journal +
  saveable template step). Human surface: the two human-form ways to compare runs already
  exist — the **split/diff** view (`viewMode:'diff'`, raw visual line diff via the `diff`
  package, ≤100k lines) and **baseline_compare** (fingerprint deltas in the analysis panel).
  **Written parity exemption:** a template-level *structural* diff is the agent-form — the
  agent cannot eyeball a scrolling visual diff, and the human cannot hand-fold two
  million-line logs into comparable template sets; each operator gets the diff shape that
  fits it. The agent's results reach the human the same way `evidence_pack`'s do — the agent
  pins notable deltas with `logan_report_finding` (every delta carries target viewerLines). A
  dedicated human "compare two summaries" view is a natural extension of the Summarize panel,
  earnable with usage.

- **Column mute — right-click "Mute column" / Columns-window toggle** (dim a column IN PLACE —
  a **View-layer**, visualization-only de-emphasis; it does NOT change what tools see). Human
  surface: right-click a column in the viewer → Mute/Unmute (+ "Unmute all"), or the 🔇 toggle
  per row in the Columns window; rendered dim via one instant CSS rule
  (`updateColumnMuteStyle`, twin of the column-hide rule), persisted in the saved column layout
  (`muted?` on `ColumnLayoutSaved.columns`). **Written exemption (View-layer, human-viewport):**
  mute is a read-aid — which columns the human greys out while reading. It's deliberately
  visual-only (2026-08-27 decision — see below): removing a column from tool actions is what
  **Hide** (columns → gone from view + tools) and **Filter/Extract** (rows) already do, so mute
  doesn't overlap. The AI has no viewport and reads column values directly; it needs no
  "mute a column" verb.
  NB — this is the motivating case for the **effect-layer** axis (see [Effect layers](#effect-layers--the-second-axis),
  established 2026-08-27): **mute is View → visual-only**, so the earlier slice that discarded
  muted columns/lines from search/extract was reverted (#163). "Discard / shrink the working
  set" is Scope's job (Hide/Filter) + Produce's (Extract), never View's.

- **Apply a saved lens entity — `logan_apply_entity`** (the write-half of `logan_entities`,
  which only lists). CLOSES a real parity debt: the agent previously had **no** way to apply a
  saved highlightGroup / filter preset / column layout / search session (zero `/api` routes;
  column-layout even carried a written "human-only" exemption — now retired). Agent surface:
  MCP `logan_apply_entity` (kind ∈ filter | highlightGroup | columnLayout | session, by
  id/name) → `/api/apply-entity` → `ApiContext.applyEntityRef` resolves the ref and pushes an
  `entity-apply` IPC. Human surface: the renderer's `entity-apply` handler runs the **same
  `applySavedEntity`** the Saved-panel ▶ Apply / Ctrl+P palette already call — **one impl, two
  operators** (so an agent apply visibly changes the human's view too). **Idempotent set-
  semantics:** a re-apply is a no-op, never a toggle-off (`applyHighlightGroup(id, forceOn)`
  gained a `forceOn` so the agent/outfit path can't silently un-highlight). Scope: the 4
  **lens** kinds only — idempotent view-state setters. Other applyable kinds keep their
  dedicated verbs (investigation → `logan_run_investigation`, composite → `logan_single_session`);
  copy-only / modal-home kinds (constant, columnPattern, bookmarkSet, …) are out by design.
  This is Fable-reviewed **P0** of the "outfit" idea: build the apply-engine + close the debt
  first; a bundle/"outfit" then falls out of the reserved `EntityRef.autoApply` on the
  requirements manifest (P1) with no new entity kind.

- **The "outfit" — `EntityRef.autoApply` honored on recipe run (P1).** A recipe (saved
  investigation) whose requirements list lens refs marked `autoApply` now **dresses the log in
  those lenses before its steps run**: `/api/investigation-run`, after the preflight, calls the
  P0 `applyEntityRef` for each autoApply lens (filter / highlight / columnLayout / session;
  non-lens refs skipped), then runs the steps against the dressed view. The run response
  carries `applied[]`, surfaced in the recipe hub Output as "🧥 Applied …". Because it routes
  through the same apply-engine → `entity-apply` IPC → human `applySavedEntity`, the human's
  view visibly dresses up too. No new entity kind — an "outfit" IS a recipe with autoApply
  lens refs. **Agent authoring** is at parity (the `autoApply` flag on
  `logan_save_investigation` / `logan_set_investigation_requirements` entity refs).
  **Human authoring — now at parity:** the recipe hub has a **🧥 Lenses** composer — a
  `+ lens` picker (lists every saved filter / highlightGroup / columnLayout / session via
  `listEntities`) adds a lens as an autoApply ref; each lens chip toggles autoApply on/off or
  removes it, persisted through `setInvestigationRequirements`. So both operators author the
  outfit (agent via the `autoApply` flag at save, human via the hub composer), and both
  consume it (the lenses apply to the view + the "Applied" readout).
