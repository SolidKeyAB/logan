# MF4 Signal Visualization — Stage 2 Design

**Status:** Draft for review · **Owner:** (Özge) · **Created:** 2026-06-30

Stage 1 (done, on `main`) made MF4/MDF4 files open: the adapter decodes channels
into normalized `t=<master> <name>=<value> …` text lines, parsed off-thread in a
worker. You can already chart *one* signal at a time via the Trends panel.

Stage 2 is the **flexible visualization**: browse all signals and overlay several
on a shared time axis, with LOGAN's click-to-line tie-back to the raw records.

---

## 1. Goals

- See **many signals at once**, overlaid on a shared **time (`t`) axis**.
- **Browse/pick** signals from a searchable list (a file can have hundreds).
- Keep LOGAN's signature: **click a point → jump to that line** in the viewer.
- Handle different scales gracefully (e.g. `rpm` 0–8000 vs `throttle` 0–1).
- Reuse the existing Trends discovery + series engine; minimal new surface.

### Non-goals (this stage)
- Channel-conversion (`##CC`) application, units/engineering scaling.
- Math channels / derived signals, FFT, XY (signal-vs-signal) plots.
- Multi-file / baseline overlay.
- Export of the plot (PNG/CSV) — fast follow, not core.

---

## 2. Current state (what we reuse)

| Piece | Where | Reuse |
|-------|-------|-------|
| Field discovery | `trendDiscoverFields()` → `TrendFieldSpec[]` (`name,type,occurrences,distinct`) | populate the signal list |
| Single series | `trendSeries({field})` → `TrendSeriesResult` (`points[]` = `{viewerLine, epochMs, num, raw}`) | per-signal samples + click-to-line |
| Canvas chart | `drawTrendChart()` (single series) | generalize to multi-series |
| Click→line | `jumpToTrendLine()` / `goToLine()` | unchanged |
| Bottom panel tabs | `data-bottom-tab="…"` system | host the new view |

**Key nuance — the X axis is `t`, not wall-clock.** MF4's master is a *relative*
float (seconds from start), so `TrendPoint.epochMs` is `null` for these files.
The overlay must plot against the **`t` value** (or record index when `t` is
absent), not the timestamp buckets Trends uses for normal logs. This is the main
reason we need a small new data path rather than just looping `trendSeries`.

---

## 3. UX

A new **"Signals"** tab in the bottom panel (shown for files that expose numeric
fields; surfaced prominently for MF4). Two regions:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Signals  [search ▢ "rpm"          ]   [▣ shared Y] [⊟ fit] [⛶ zoom]   │
├───────────────┬──────────────────────────────────────────────────────┤
│ ▣ ● rpm       │            ╱╲      ╱╲                                  │
│ ▣ ● throttle  │      ╱╲   ╱   ╲   ╱   ╲      ← overlay plot, x = t     │
│ ▢ ● speed     │   ╱╲╱  ╲╱      ╲╱      ╲                               │
│ ▢ ● coolantT  │ ╱                        ╲                            │
│ … (filterable)│  t=0           t=12.4s         cursor: t=6.2 rpm=4100 │
└───────────────┴──────────────────────────────────────────────────────┘
```

- **Left — signal browser:** searchable, scrollable checkbox list. Each row: a
  color swatch (auto-assigned, editable later), name, and a sparkline/count hint.
  Check to add to the plot, uncheck to remove. "Numeric only" by default.
- **Right — overlay plot:** all checked signals on one canvas, shared `t` axis.
  - **Shared Y** (normalized 0–1 per signal) by default so differently-scaled
    signals are comparable; toggle to **real Y** with a left axis (and optionally
    a second right axis for one selected signal).
  - **Cursor readout:** hovering shows `t` and each visible signal's value at the
    nearest sample.
  - **Zoom/pan:** drag-select to zoom X; double-click to reset; wheel to zoom.
  - **Click a point → jump** to that record's line in the viewer (via `viewerLine`).

---

## 4. Data model & backend

Add one main-process method + IPC: **`signalSeries`** — given selected field
names, read the normalized file once and return **aligned** samples:

```ts
// request
{ fields: string[], xField?: string /* default 't' */, maxPoints?: number,
  startLine?: number, endLine?: number }

// response
{
  x: { field: string; values: number[] },          // the t (or index) axis
  series: Array<{
    field: string;
    values: (number | null)[];                      // aligned 1:1 with x (null = absent)
    viewerLines: number[];                          // for click→line
    min: number; max: number;                       // for autoscale / normalize
  }>,
  totalRecords: number; truncated: boolean;
}
```

Why a dedicated call instead of N × `trendSeries`:
- **Alignment by `t`:** every record line carries `t=` + the signals; reading once
  yields a single shared X with each signal aligned, no cross-join guesswork.
- **One pass, downsampled:** decimate to `maxPoints` (e.g. ~2–4k per signal,
  min/max-preserving) so the canvas stays fast on million-record files.
- The line is `t=… name=value …`; parsing is the same regex Trends already uses.

`trendDiscoverFields` is reused as-is for the browser list (it already returns
type so we can default to numeric).

**Surfacing MF4-ness to the renderer:** extend the `OPEN_FILE` result with the
resolved adapter id / capabilities (already tracked in `sourceRegistry` via
`getSourceCapabilities`) so the renderer can auto-open/feature the Signals tab for
MF4. Generic numeric logs can opt in manually.

---

## 5. Phased plan

**P1 — Minimal overlay (the core ask).**
- "Signals" tab + searchable checkbox list (`trendDiscoverFields`).
- `signalSeries` backend (aligned, downsampled).
- Multi-series canvas (generalized `drawTrendChart`), shared-Y normalize, legend,
  click→line. Auto colors.

**P2 — Comfort.**
- Zoom/pan + double-click reset, cursor readout/crosshair.
- Real-Y mode with left axis + optional second (right) axis for one signal.
- Per-signal color edit + show/hide without unchecking.

**P3 — Nice-to-have.**
- Stacked **lanes** (separate plots sharing the X cursor) for unrelated scales.
- Export PNG/CSV; persist the chosen signal set per file in `.logan/` sidecar.

Ship P1 first, get it in front of real MF4 files, iterate.

---

## 6. Open questions (need decisions)

1. **Placement** — bottom-panel **"Signals" tab** (consistent with Trends), or a
   larger dedicated view? Default: tab.
2. **Default Y mode** — start in **shared/normalized** (compare shapes) or real
   units? Default: normalized, with a one-click toggle.
3. **Second axis** — is a single right-hand axis enough for P2, or do you want
   full per-signal axis assignment (→ pushes toward P3 lanes)?
4. **Auto-open for MF4** — when an MF4 file opens, should the Signals tab pop
   automatically, or stay opt-in like other panels?
5. **Scale limits** — biggest real file (record count) we must stay smooth on?
   Drives the downsample budget.

---

## 7. Risks

- **Performance** on huge recordings → mitigated by one-pass min/max decimation
  and a hard `maxPoints` cap; never feed raw points to canvas.
- **No timestamp** → X is relative `t`; if a file lacks a master, fall back to
  record index and label it clearly.
- **Sparse signals** (different channel groups sampled at different rates) → P1
  reads the first channel group only (Stage-1 limitation); multi-group alignment
  is a later item, called out so results aren't silently partial.
