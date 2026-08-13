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

Uniform entity `description` (2026-08-13) — every saveable "basic entity" gained an
optional `description?: string` so both operators can record an entity's purpose/why
(naming matches the existing `BaselineRecord.description` / `InvestigationTemplate.description`;
findings already carry `detail`). Agent side is wired for the entities that already have an
MCP create/save tool; the human *editing* UI (uniform tooltip + right-click "Edit description")
is the immediate follow-up (PR-2) — tracked, not exempted.

| Entity | Human sets it | AI sets it | Status |
|--------|---------------|-----------|--------|
| Constant / tag | Edit description (PR-2) | `logan_constants` `description` (`/api/constants-save`) | ✅ AI done · human UI next |
| Bookmark | Edit description (PR-2) | `logan_add_bookmark` `description` (`/api/bookmark`, `-update`) | ✅ AI done · human UI next |
| Highlight | Edit description (PR-2) | `logan_highlight` `description` (`/api/highlight`, `-update`) | ✅ AI done · human UI next |
| Column Layout | Edit description (PR-2) | `logan_column_layouts` layout.`description` (`/api/column-layout-save`) | ✅ AI done · human UI next |
| Search config / session / pattern-property | Edit description (PR-2) | — (no MCP create tool today) | field carried; creation stays human-only (pre-existing exemption) |

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
