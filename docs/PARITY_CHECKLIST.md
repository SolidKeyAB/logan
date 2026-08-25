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
- [ ] **OR** written exemption: _"Human-only because …"_ (e.g. it's a pure viewport/UI concern, or a security-gated capability the AI must not have).

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
