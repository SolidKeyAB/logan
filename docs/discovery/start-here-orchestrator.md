# Start-Here Orchestrator + Real Parameterized Templates

**Status:** Design — captured, awaiting greenlight for P0. No code yet.
**Date:** 2026-08-25
**Owner:** Özge (@ozgesolidkey)
**Consulted:** Fable (architecture)
**Related:** `docs/discovery/investigation-workflow-canvas.md` (this screen is the entry point into that canvas), `docs/discovery/entity-registry.md`, `docs/PARITY_CHECKLIST.md`, `docs/LOGAN_REPORT_FORMAT.md`

---

## 1. The problem

The floating "Start here" card (`showTriageCard()`, `src/renderer/renderer.ts`) is **template-blind and terminal**: it shows the same generic evidence-pack briefing for every log and every bug, offers ~5 jump links, then dies. It does not answer the analyst's real first question — *"is this the auth-expiry bug again, or something new? what have we recorded that applies here?"*

The ambition (owner, 2026-08-25): make LOGAN the **orchestrator** of log-analysis tools for **all three operators — the human (UI), the AI agent (MCP), and LOGAN itself (auto)** — landing on a real **"Start here" screen** that shows **hints + statistics per recorded template (or a default)**, switchable by the bug being chased.

## 2. The reframe

The orchestrator machinery already exists — `buildEvidencePack` (`src/main/api-server.ts`), the recipe engine (`src/mcp-server/recipes.ts`), saved investigations with requirements preflight (`src/main/investigationStore.ts` + `src/main/investigationRequirements.ts`), the entity registry (`src/main/entityRegistry.ts`) — all reachable identically by human and agent.

What's missing is the **dispatch layer** that answers: *"given THIS log + everything LOGAN has recorded, which recorded hunt applies, what does it see here, and what's next?"*

**One function `buildStartHere()` = three operators:**
- the **screen** (human),
- `logan_start_here` (AI, MCP + `/api/start-here`),
- on-open auto-run (LOGAN itself, `prefetchStartHere()`).

This is the exact "one impl, three operators" pattern already proven by the evidence pack (shared by the human Brief and the MCP tool). The card shows facts; the screen proposes a course of action.

## 3. Foundation: real parameterized templates (variable vs constant)

**This is prerequisite to the orchestrator having value**, and is the owner's explicit near-term ask:

> "investigation template should be a real template. it should label values which are variable or constant so that next time in another bug log, the user can change the variables and run."

### Current state (what exists)

`InvestigationTemplate` (`src/main/investigationStore.ts`) already captures ordered `steps[]` (api path + body + label + result) and auto-promotes fill-ins into `params: ParamDef[]`:

- Promotion is driven by a **hardcoded key allowlist** `PARAM_KEYS` = `startTime, endTime, startLine, endLine, component, field, pattern, event, expect, analyzerName, thresholdSeconds`.
- Each promoted param gets a `kind: ParamKind` (`time | range | component | field | pattern | event | other`) — this classifies the **noun type** (drives tweak-form ordering/typing), **not** whether the value is variable or constant.
- `normalizeTemplate()` back-fills `kind` for old templates at read time (added 2026-08-20).
- Replay tweak-form: `renderer.ts` (~7777) lets the user edit promoted params before running.

### The gap

There is **no user-controlled variable-vs-constant distinction**. Consequences:
- Any body value NOT in the allowlist can never be made a fill-in, even when it's the incident-specific value that must change next time (e.g. a request-id, a device serial, a session token embedded in a `pattern`).
- Any allowlisted value is always offered for editing, even when it's a fixed part of the recipe the user wants pinned (a constant `component` that defines the hunt).
- The user cannot curate the template: mark *this* value "you'll change this per bug" (variable) and *that* value "this is the fixed shape of the hunt" (constant).

### The design: add an explicit `role`

Add a per-param **role** the user controls, orthogonal to `kind`:

```ts
export type ParamRole = 'variable' | 'constant';

export interface ParamDef {
  key: string;
  stepIndex: number;
  label: string;
  default: any;
  kind?: ParamKind;            // noun TYPE (existing)
  role?: ParamRole;            // NEW: user-curated. 'variable' = prompt on replay; 'constant' = pinned
  description?: string;        // NEW (optional): "device serial for this incident"
}
```

Plus, so that **any** value — not just allowlisted keys — can be promoted:
- Allow promoting an arbitrary `(stepIndex, key)` (or a matched substring within a `pattern`/string body value) to a variable, via the tweak/edit form and via the agent.
- Replay prompts for **`role: 'variable'`** params only; **`constant`** params are pinned and rendered read-only (still visible, so the recipe's shape is legible).
- Derivation default (zero migration, matches `normalizeTemplate` style): auto-promoted allowlist params default to `role: 'variable'` when they look incident-specific and `role: 'constant'` when they look structural — reuse the literal/high-cardinality heuristic from `paramKind`/value-shape (e.g. a `component` name → constant by default; a `startTime`/`endTime` window → variable by default). The user overrides freely.

### Parity

- Human: the replay tweak-form gains a per-row **🔒 constant / ✎ variable** toggle + "promote this value to a variable" affordance; template save/edit persists `role`.
- Agent: `logan_save_investigation` / a new `logan_set_investigation_params` (or extend the requirements setter pattern `logan_set_investigation_requirements`) accepts `params: [{stepIndex, key, role, description}]`.
- This makes a template a **real, portable template**: a fixed recipe shape (constants) with named blanks (variables) you fill for the next bug log — which is precisely what each Start-here **lens** consumes.

## 4. Template data model for the screen (the `lens`)

**Do not invent a new entity.** Reuse `InvestigationTemplate` — it already has recipe `steps[]` and `requirements?: RequirementsManifest` (the fit gate: column-pattern / adapter / signature / filename-glob + expected entities, evaluated by `evaluateRequirements()`). Add ONE optional peer sub-doc `lens?: StartHereLens` = *what to count/show through this template's eyes*:

```ts
export interface StartHereLens {
  signals?: Array<{
    label: string;                                   // "token expired"
    kind: 'pattern' | 'component' | 'field' | 'gap';
    pattern?: string;            // kind=pattern → count-probe via search
    component?: string;          // kind=component → read from pack.topComponents
    field?: string;              // kind=field → presence/occurrences from pack.fields
    thresholdSeconds?: number;   // kind=gap → count from pack.timeGaps
    expect?: 'zero' | 'nonzero'; // healthy baseline → drives hint severity
  }>;
  hints?: string[];                     // author prose
  packOptions?: EvidencePackOptions;    // template-tuned brief
}
```

**Key move — derive, don't demand.** Derive a default lens **at read time** from what every template already has (each search step's `pattern` → signal, each `component` param → signal, each trend field → signal, each time-gaps threshold → gap signal), skipping high-cardinality literals (reuse `paramKind`/value-shape). So **every already-saved template gets a working lens with zero migration**; a declared `lens` only curates/overrides (later stage). This composes directly with §3: variable values are the natural signal probes; constant values define the lens's fixed shape.

**Ranking** per template: `rank = w1·requirementsFit + w2·signalActivity + w3·recency` (recency informational only — usage must NOT gate, per 2026-08-20 steering). Blocked-by-requirements templates sink to the bottom, greyed, never hidden.

**Default** = a virtual built-in `@default` "General triage" (never on disk, always fits). Its lens IS the evidence pack; its actions are the existing symptom recipes. Solves cold start structurally.

## 5. The Start-here screen (UX)

Overlay in the viewer container, sibling of `#welcome-message` (`src/renderer/index.html`), gated by the existing `triage-on-open` feature id (keep the id so prefs persist). Lite mode above `TRIAGE_AUTO_MAX_LINES` (chips + cheap fit + file stats, no pack).

```
+------------------------------------------------------------------------------+
| START HERE     device-0812.log · 1.2M lines · 09:14:02–11:47:55   [Open log >]|
|------------------------------------------------------------------------------|
| Lens:  (o) Auth token-expiry  FIT   ( ) CAN bus drop  FIT                    |
|        ( ) Boot loop  BLOCKED(adapter)   ( ) General triage  (default)       |
|------------------------------------------------------------------------------|
| CRITICAL — 3,412 errors (2.8%) · 3 crashes · 7 time gaps          [Full brief]|
|                                                                              |
| Hints (Auth token-expiry)                 | Stats for this lens              |
|  1. "token expired"  x17        -> L48112 |  error 3,412   warn 12,001       |
|  2. auth component 214 err      -> L47990 |  signals:                        |
|  3. 41s gap after token refresh -> L51220 |   token expired   17   BAD       |
|  note: check refresh-loop cadence         |   refresh_ok       0   (expect>0)|
|                                           |   gap>30s          3             |
|------------------------------------------------------------------------------|
| Requirements: [ok] adapter=text [ok] col-pattern 94% [ok] filter "auth" saved |
| [> Run this hunt]  [Tweak & fork]  [Pin hints as findings]  [Trends] [Report] |
+------------------------------------------------------------------------------+
```

- **Switching** is instant client-side (all per-template hints arrive in one response).
- **Rule: no dead numbers** — every stat carries a viewerLine or a button.
- **Routing into existing verbs:** Run this hunt → `runInvestigationTemplate` (with the §3 variable-fill tweak-form); Tweak & fork → `/api/investigation-fork`; Pin hints → `/api/import-findings`; Full brief → Analysis brief; Trends → Trends tab prefilled; Report → `/api/save-report`.
- The screen **replaces** the floating card.

## 6. Three-operator parity

New verb **`logan_start_here`**. Engine `buildStartHere(ctx, opts)` in `api-server.ts` beside `buildEvidencePack`: build pack once → hoist `buildRequirementContext` once & reuse across templates → per template evaluate reqs + derive lens + count signals (component/field/gap answered from the pack for free; only pattern signals need a capped count-probe search) → rank → `{ pack, templates[], selected }`. Wire `/api/start-here` (redact:true default) + MCP tool (`src/mcp-server/index.ts`) + `START_HERE` IPC (`src/shared/types.ts` + preload mirror + `window.api.getStartHere()`), same tri-wire as `EVIDENCE_PACK`. Exclude from `RECORDED_PATHS` (it's dispatch, not a step) but count in usage; add a `verbRegistry.ts` row. LOGAN-itself: `prefetchTriage()` → `prefetchStartHere()` on open.

## 7. Staged path (primitive-first)

- **P0a — Real templates (variable/constant).** Add `ParamRole` + `role`/`description` to `ParamDef`; derivation defaults; replay tweak-form 🔒/✎ toggle + promote-arbitrary-value; agent param setter. Ships standalone value: recorded hunts become genuinely re-runnable on a new bug log. *(Owner's explicit ask — do first.)*
- **P0b — Dispatch engine + verb.** `buildStartHere()` + `/api/start-here` + `logan_start_here` MCP + IPC + types; human surface = the existing card gains a template-chips row. **Validate first: do derived lenses give differentiated, actionable hints on the real `~/.logan/investigate-templates/`, or noise?** Test before any screen chrome.
- **P1 — The screen.** Overlay next to `#welcome-message`; chips + hints/stats/requirements panes; lite mode.
- **P2 — Actions.** Wire the action bar into the six existing verbs + symptom buttons on the default lens (all reuse).
- **P3 — Declared lens + curation.** Persist `lens` on save; setter endpoint + `logan_set_investigation_lens`; ranking gains recency; remember per-file lens choice.
- **P4 — Consolidate.** Retire the floating card; update `triage-on-open` description + `docs/PARITY_CHECKLIST.md` + docs. The screen becomes the documented entry point the Workflow Canvas plugs into.

## 8. Honest risks

1. **Templates nobody records** → the pivot delivers a nicer card, not an orchestrator. Mitigate: in-screen "record your next hunt → it becomes a lens" nudge; agent saves investigations proactively. (P0a directly raises the value of recording, so it also de-risks this.)
2. **Derived-lens noise** from incident-specific literals (a dead request-id → "0 hits" everywhere, erodes trust). Mitigate: validate derivation on real templates first; literal-skip heuristic; the §3 variable/constant labeling is the human backstop.
3. **Open-latency** probing N templates on a 5M-line file. Mitigate: pack answers most signals; pattern probes after first paint; lite mode above the size gate.
4. **Confidently-wrong auto-selected template** is worse than none. Mitigate: fit checks always visible (the *why*); blocked greyed not hidden; default one click away.
5. **Screen fatigue** from a takeover on every open. Mitigate: Esc + the feature toggle + never re-show mid-session (mandatory, not polish).
