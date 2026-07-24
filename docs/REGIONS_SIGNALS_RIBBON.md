# Regions & Signals Ribbon — Draw-to-Label + Auto-Found, in One Strip

## Vision

One horizontal strip under the viewer that shows the whole log at a glance and lets a
user **draw a span and label it** in a single gesture — sitting right beside the spans
LOGAN finds automatically. Dead-simple surface, one learning curve, no modes to memorise.

The point isn't the drawing. Drawing is the delightful, easy 20%. The strip earns its
place through two power moves — **compare two regions** and **promote a region to a
repeatable rule** — which turn a pretty highlighter into an actual analyst tool and a
CI gate.

## The naming decision (important)

LOGAN already ships a **Signals** panel meaning *numeric time-series channels* (RPM,
latency, a 0/1 flag). Do **not** overload "signal" to also mean a hand-drawn window — it
will confuse every analyst. So:

- **Region** = a labeled *window of interest* — a line/time range. What you draw. What
  auto-detection proposes (a crash cluster, an error storm, a gap).
- **Signal** = a *measurable series* over time. Unchanged meaning.

The ribbon carries **both, in separate rows, with honest names**. A Region can *spawn* a
Signal (chart a field over its window), but they are not the same object.

---

## Anatomy

```
 ┌─ Ribbon ─────────────────────────────────────────────────────────────┐
 │ Auto   ▓▓crash▓▓ⓘ      ░░error-storm░░ⓘ            ▒gap 8m▒ⓘ          │  ← proposed
 │ Yours          [ boot ]          [ retry loop ]        [ … ]          │  ← you drew
 │ Signals  ╱╲__╱‾‾╲__ latency_ms          ▁▂▅▇▅▂ rpm                    │  ← numeric
 └───────────────────────────────────────────────────────────────────────┘
    09:01              09:14                  09:22              09:40      ← time axis
```

- **X-axis = the whole file, by wall-clock time** (falls back to line order when a file
  has no timestamps). Reuses the Signals time axis that already maps line → time.
- **Auto row** — LOGAN's proposed regions. Each is a *suggestion* with a **ⓘ provenance
  chip** ("error-rate 6× baseline", "gap 8m12s", "12 FATAL in 40s"). Accept, adjust, or
  ignore. Never a blind colored block.
- **Yours row** — the regions you create and label.
- **Signals row** — numeric series overlaid (the existing Signals feature, shown inline
  for context; optional).

---

## Interaction — kept deliberately small

### Creating a region — two paths, precise-first

Drawing directly on a strip where **1px ≈ thousands of lines** cannot produce an
accurate boundary. So creation is precise-first:

1. **Precise (primary): select lines in the viewer → "Mark region".** Reuses the
   existing line-range selection. Keyboard-navigable, exact, accessible. The ribbon
   mirrors the new region immediately.
2. **Rough (secondary): draw on the ribbon → snap.** Enter **✏️ Mark mode** (explicit
   toggle — see below), click-drag a rough span, then it **snaps to the nearest
   event/gap/timestamp** and exposes numeric start/end for fine-tuning.

Either way: a small inline box appears → type a label (or quick-pick from recent labels,
or leave it color-only) → Enter. Done.

### Draw vs navigate — never overloaded

The ribbon doubles as a navigation minimap, and everywhere else a bare drag means
*scroll/seek*. So **a bare drag on the ribbon navigates**; **drawing requires explicit
Mark mode** (the ✏️ toggle, or hold a modifier). This is the single most important
interaction rule — overloading drag would make the strip feel broken.

### What every region does (auto or manual, identical)

1. **Click → viewer jumps** to that range (reuses range-annotation jump).
2. **Hover → shows** range, duration, line count, and rename / recolor / delete handles.
   Resize via edge handles + numeric fields (not fiddly pixel-dragging).
3. **"Chart this" →** the region's line range feeds `trend_show` (Trends) or overlays a
   numeric field in Signals — a Region *spawns* a Signal over its window.
4. **It is a saved artifact** — persisted as a range annotation tagged `kind:'region'`,
   so it survives reopen and the agent can read/pin/compare it too.

### Clarity guards (so the strip never gets noisy)

- Auto regions are **capped + ranked**; low-value ones collapse into a "3 ▾" badge.
- At low zoom, nearby regions **cluster**; the lane grows on hover.
- **Undo/redo** on every create/edit/delete (Ctrl+Z).
- First-run coach mark + empty-state hint (the drawing affordance is otherwise invisible).

---

## The two power moves (why this is worth building)

### 1. Compare two regions

The canonical analyst gesture is *known-good window vs bad window*. Select two regions →
**Compare** → reuse the **baseline/diff engine** to show what differs (level mix, error
rate, new events, field distributions). Marking a window is setup; the *comparison* is
the insight.

### 2. Promote a region to a repeatable rule — the manual→repeatable bridge

A hand-drawn region is bound to absolute line ranges in **one file**; it does **not**
transfer to the next build's log, so on its own it's useless for a test↔build **gate**.

Fix: when a region is labeled, LOGAN infers **what characterizes it** (the dominant
field / pattern / event in that window) and offers **"Make this a rule"** — saving it via
the existing **investigation-template engine** as a parameterised, re-runnable pattern.

That is the bridge: *manual exploration → repeatable gate*. Draw "retry loop" once →
promote it → every future build is auto-checked for that pattern. This closes the loop
back to the AI-logging-framework idea (stable IDs / classification) from the analysis
side: the analyst *teaches* the gate by drawing.

---

## Reuse map — thin surface over existing parts

| Need | Reused from |
|------|-------------|
| Ribbon backdrop (density) | the existing **minimap density canvas** |
| X-axis (line → wall-clock) | the **Signals time axis** |
| Region storage + click-to-jump | the **range-annotation / finding model** (`kind:'region'`) |
| Auto regions (crashes / gaps / storms) | **`logan_evidence_pack`** output (already ranges) |
| "Chart this" | **`logan_trend_show`** / Signals overlay |
| Compare two regions | the **baseline / diff engine** |
| Promote to rule | the **investigation-template engine** |
| Numeric Signals row | the existing **Signals** panel |

No new chart engine, no new persistence layer, no new scan path (all the worker-thread /
sampling / SharedArrayBuffer work already done stays reused). It is a drawing + wiring
layer on top.

---

## Accessibility

- Region *creation* via viewer line-selection is fully keyboard-navigable — the drag path
  is an accelerator, not the only way in.
- Resize/edit via numeric fields, not pixel-precision dragging only.
- Provenance chips + labels are text, screen-reader friendly.

---

## Build order (recommended)

1. **This spec** (done).
2. **Ribbon + select-to-mark + click-to-jump.** Render the strip over the minimap;
   viewer line-selection → "Mark region" → save as a `kind:'region'` annotation; click a
   region → `goToLine(range)`. Smallest slice that makes the dream tangible.
3. **Draw-on-ribbon (Mark mode) + snap-to-event + numeric fine-tune.** The rough path.
4. **Auto row** populated from `logan_evidence_pack` (crashes + gaps first — already
   ranges), each with a provenance chip; accept/adjust/ignore.
5. **Compare two regions** → baseline/diff reuse.
6. **Promote region → rule** → investigation-template reuse (the CI-gate bridge).
7. **Signals row** inline (optional; the panel already exists).

Ship 2 alone first — it's the tangible core. 5 and 6 are what make it an analyst tool
rather than a highlighter, so they should not be dropped from the roadmap.

---

## Relationship to the other design docs

- **`GRANULARIZATION_DESIGN.md`** — the Auto row is the *visual* surface for the evidence
  pack; a promoted rule is a granular unit the analyst defined by hand. Manual + auto
  regions are the same "labeled region" object from two origins.
- **AI logging-framework thread** — "promote region → rule" is how an analyst teaches the
  test↔build gate from the analysis side, mirroring stable IDs taught from the emit side.
