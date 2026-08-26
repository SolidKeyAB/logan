# Multi-log correlation & logs+env — closing the AI coverage gaps

**Status:** P0 (wall-clock agent verb) + P3 (ContextManifest env entity) + P2 (run-vs-run
template diff) implemented. P1, P4 deferred.
**Origin:** 2026-08-26 tool-coverage assessment (mine + Fable). LOGAN exposes ~68 MCP
tools. Verdict: for a **single log** the toolkit is complete/over-complete; the real
gaps are in **multiple logs** and **logs + env**. This doc is the design for closing them.

---

## The gaps (assessment recap)

1. **Multiple logs — correlation.** `logan_single_session` only *concatenates* files
   (linear line-space, file after file — see `compositeLineSpace.ts`). The canonical
   multi-log question is *"what did component B log at the moment A errored?"* — that
   needs a **wall-clock interleave**, which existed only in the human-only Time Sync UI
   + the **"⬇ Merge to file…"** button (`merge-files-to-file` IPC in `index.ts`). Classic
   parity rule-5 debt: engine built, agent verb absent. The AI cannot hand-interleave two
   10M-line files, so it genuinely could not do this at all.

2. **Multiple logs — differential.** Line/template-level *run-vs-run* diff is human-only
   (split/diff view); `baseline_compare` only diffs at fingerprint granularity (level
   counts, crash sets, components).

3. **Logs + env.** Time-varying env (CAN/MF4/telemetry) already rides the trend/Signals
   engine. **Static env** (build id, firmware, device model, feature flags, config dump)
   has *nothing* — no entity to hold it, and nothing conditions on it (e.g.
   `baseline_compare` will diff a build-4.2 log against a 4.1 baseline and call the deltas
   anomalies).

**Meta:** the risk at 68 tools is *too many / poor orchestration*, not too few. Resist
new single-log verbs. (There is even an overlapping pair — `logan_baseline_compare` vs
`logan_compare_baseline` — a collapse candidate.)

---

## P0 — wall-clock agent verb (this commit)

**Highest leverage** (Fable's pick, concurred): the AI cannot compensate for a missing
wall-clock interleave, and the engine already exists. Ship agent parity for the human
"Merge to file" button.

### Design

Add `order?: 'sequential' | 'wallclock'` to **`logan_single_session`**
(`/api/composite-create`):

- `order: 'sequential'` (default) — unchanged: the virtual, RAM-cheap `CompositeFileHandler`
  concatenation. No file written.
- `order: 'wallclock'` — **materialize + open**. Interleave every timestamped line of the
  N files onto one wall-clock timeline, write a real merged `.log`, and open it as the
  active file. Because the result is an ordinary file, **all 68 tools work on it
  immediately** (search / get_lines / analyze / trends / investigate / findings).

**Why materialize instead of a virtual interleaved composite?** The virtual path would
break `CompositeLineSpace`'s contiguous-per-file block invariant (binary search, severity
index concatenation, search rebase all assume each member owns a contiguous global range).
Materializing reuses the **already-tested** merge engine (`carryForwardTimestamps` +
stable time-sort + `buildOriginTags` + `formatWallClock` from `mergeTimeline.ts`), is
low-risk, and is exact parity with what the human button produces. The virtual
interleaved line-space is a real but much larger build — deferred to P1.

### Implementation

- Extract the dialog-free merge core into `writeMergedTimeline(filePaths, outPath, opts)`
  in `index.ts` (shared collect → time-sort → write with a `<ts> | <origin> | <line>`
  format + header). The existing `merge-files-to-file` IPC handler keeps the
  `showSaveDialog`, then delegates to it — one engine, two callers.
- Pure ordering logic (`sortMergeEntries` — stable time sort, tie-break file→line) lifted
  into `mergeTimeline.ts` and unit-tested, so the interleave semantics are verifiable
  headlessly.
- `ApiContext.mergeTimeline(filePaths, { label })`: validate ≥2 existing files, derive a
  deterministic out-path (`.logan/merged/merged-timeline_<stamp>.log` next to the first
  file, temp-dir fallback if unwritable), call `writeMergedTimeline`, then open the result
  through the same path `openFile` uses (pushes `open-file-from-cli` so the human sees it).
- `/api/composite-create` branches on `body.order`; MCP `logan_single_session` gains the
  `order` enum param.

**Caps (inherited from the human merge):** ≤3M lines scanned/collected per file; files
with zero timestamps are skipped (can't be placed on a shared timeline). Reported back to
the agent as `skipped` + `capped`.

**Parity:** human = "⬇ Merge to file…" (Time Sync); agent = `logan_single_session`
`order:"wallclock"`. Both run `writeMergedTimeline`. Logged in `PARITY_CHECKLIST.md`.

---

## P3 — `ContextManifest` env entity (implemented)

The **logs + env** gap. Static environment (build id, firmware, device, feature flags,
config) had *nothing* to hold it, and nothing conditioned on it — so `baseline_compare`
would diff a build-4.2 log against a 4.1 baseline and call the deltas anomalies.

### Design

- **The entity.** A per-file sidecar `.logan/<file>.context-manifest.json` — a typed
  `Record<key, {value, source}>` (facts + provenance) + `updatedAt`/`agentName`. Pure
  merge/diff semantics live in `src/main/contextManifest.ts` (`mergeFacts`, `factsToPlain`,
  `diffEnv`) so they're unit-tested headlessly; the fs read/write sits in `index.ts` beside
  the agent-memory scratchpad (`getContextManifest` / `saveContextManifestFile`). Listed in
  the entity registry as kind `contextManifest` (scope `file`), so it shows in
  `logan_entities` and the human Saved panel when its file is open.

- **The verbs (parity).** Agent: `logan_context_attach` (merge a key→value patch, or
  `replace`; blank value deletes; optional `provenance`/`source`) + `logan_context_read`,
  over `/api/context-manifest` (POST/GET) → `ApiContext.attachContextManifest` /
  `getContextManifest`. Human: no dedicated compose UI ships — **written exemption** in
  `PARITY_CHECKLIST.md` (the manifest is agent-authored env capture; the human consumes it
  via the Saved panel + the report's Environment section + the baseline env-diff finding).

- **The injections (why it earns its place).** The same facts thread into three existing
  surfaces automatically, so attaching once conditions the whole investigation:
  1. **`evidence_pack`** — an `env` block near the top, so the agent sees "what was this
     system" before drilling in.
  2. **`save_report`** — an **Environment** section (each fact + provenance) after the
     metadata table, ahead of the narrative; findings are read against it.
  3. **baseline fingerprint** — `buildFingerprint` records an `env` snapshot; `compare`
     emits an **info `env-diff`** finding ("Environment differs: build 4.1 → 4.2") whenever
     the baseline recorded env and it changed — so drift is surfaced for weighting, not
     mis-counted as a regression. Legacy baselines (no env) are never drift-checked.

**Deferred within P3:** wiring the env manifest into the requirements-manifest gate
("template requires flag X on") — the resolver already exists; only a new requirement kind
is needed. Human authoring UI, if the Saved-panel readout proves insufficient.

---

## P2 — run-vs-run template diff (implemented)

The multi-log **differential**: "what does the failing run contain that the good run
doesn't?" A raw line diff of two multi-million-line runs is noise (every timestamp / pid /
counter differs), and `baseline_compare` only diffs at fingerprint granularity (level
counts, crash sets, components). The meaningful diff is at the **message-template** level.

### Design

- **Fold, then set-diff.** Fold each run into its distinct message templates with the
  **existing** `TemplateFolder` / `normalizeShape` engine (the summarize engine — masks
  `<TS>`/`<NUM>`/… so near-duplicate lines collapse to one shape, and the shape hash is
  stable across runs). Then set-diff the two shape populations:
  `onlyInTarget` (shapes the failing run introduced — the headline), `onlyInReference`
  (shapes the good run had, now gone), `changed` (shapes in both whose frequency shifted
  past `changeFactor`, default 3×). Each delta carries both counts, the ratio, worst
  severity, and example viewerLines on each side. Pure diff in `src/main/runDiff.ts`
  (`diffRuns`), unit-tested headlessly.
- **Verb.** `logan_diff_runs({ reference, scope?, maxTemplates?, minCount?, changeFactor?,
  topN? })` → `/api/diff-runs` → `ApiContext.diffRuns`. Target = the active file (honours
  its scope, like summarize); **reference = another log by path, opened ON DEMAND** (via the
  shared `getOrOpenHandlerForPath`, without disturbing the active view) — the agent-verb
  pattern (`buildComposite`/`mergeTimeline` open on demand too), vs the human split/diff
  which needs both files in open tabs. Both sides fold through one shared
  `foldHandlerTemplates` helper (off-thread worker when indexed, else main-thread scan) so
  the two summaries are strictly comparable. Registered as investigative logic (journal +
  `logan_get_investigation_log` + saveable as a template step). Response defaults
  `redact:true` (shapes can carry log-derived tokens).
- **Parity: written exemption.** The human already has the two human-form ways to compare
  runs — the **split/diff** view (raw visual line diff, ≤100k lines) and **baseline_compare**
  (fingerprint deltas). A template-level structural diff is the *agent-form* (the agent can't
  eyeball a scrolling visual diff); its results reach the human the same way `evidence_pack`
  does — the agent pins notable deltas with `logan_report_finding` (each delta has target
  viewerLines). A dedicated human "diff two summaries" panel is a natural extension of the
  Summarize panel, earnable with usage. Logged in `PARITY_CHECKLIST.md`.

---

## Deferred

- **P1 — virtual interleaved composite.** A time-ordered line-space (per-line global↔local
  permutation) so wall-clock single-session needs no on-disk file. Bigger: rework
  `CompositeLineSpace` + severity/search rebase for non-contiguous members.
- **P4 — CRUD consolidation / de-dup.** Collapse the ~15 annotate/highlight/bookmark verbs
  to one-per-noun-with-action; retire the `baseline_compare` / `compare_baseline` overlap.
