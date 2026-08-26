# Multi-log correlation & logs+env — closing the AI coverage gaps

**Status:** P0 (wall-clock agent verb) implemented in this doc's commit. P1–P4 deferred.
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

## Deferred

- **P1 — virtual interleaved composite.** A time-ordered line-space (per-line global↔local
  permutation) so wall-clock single-session needs no on-disk file. Bigger: rework
  `CompositeLineSpace` + severity/search rebase for non-contiguous members.
- **P2 — run-vs-run diff verb.** Line/template-level agent diff of two logs (parity for the
  human split/diff), beyond fingerprint `baseline_compare`.
- **P3 — `ContextManifest` env entity.** Typed key-values + provenance in the `.logan/`
  sidecar, listed in `logan_entities`, attach/read verb pair, injected into `evidence_pack`
  (agent sees env up front), `save_report` (findings conditioned on env), and the baseline
  fingerprint (warn "env differs: build 4.1→4.2"). The requirements-manifest gate extends
  naturally ("template requires flag X on").
- **P4 — CRUD consolidation / de-dup.** Collapse the ~15 annotate/highlight/bookmark verbs
  to one-per-noun-with-action; retire the `baseline_compare` / `compare_baseline` overlap.
