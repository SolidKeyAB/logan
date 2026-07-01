# Trends redesign — one panel, an explicit X-axis, always charts

**Status:** Approved, in implementation · **Owner:** (Özge) · **Created:** 2026-07-01

## 0. Why

Two problems, one root cause.

1. **The Trends panel shows tables, not trends.** A series cell only draws a chart
   when every line has a *parseable timestamp*. The parser (`timestampParse.ts`)
   knows only 3 full-date formats, so logs with time-only, epoch, or relative-second
   stamps (e.g. the decoded `.esotrace` prefix `296.004`) get **no time axis** and
   each cell silently degrades to a table of value rows. That is the "tables instead
   of charts" symptom.
2. **Trends and Signals look redundant.** Both chart values over time. Users ask
   "why two panels?". The honest answer: they overlap on time-charting and differ
   only in (a) Signals overlays *many numeric* signals on one axis, (b) Trends
   discovers *all* field types + does transitions/correlation, and (c) Signals
   always charts (it falls back to record index; Trends doesn't).

Both dissolve if the panel has **one explicit thing the user controls: the X axis.**

## 1. The core idea — an X-axis selector

Everything plots against a chosen X axis. A dropdown lists **detected candidates**,
ranked, with a guaranteed fallback:

| X-axis choice | Meaning | When |
|---|---|---|
| **Auto — detected time** | best-ranked real timestamp | default when a good one exists |
| **A specific time field** | e.g. `timestamp` (epoch ms), `monotonicTimestamp` (ns) | a line has several times; user disambiguates |
| **A numeric field** | X = `rpm`, Y = `speed` → **XY / scatter** | comparing two signals |
| **Line number / record order** | monotonic record index | **always available; auto-selected when no time is detected** |

This one control resolves every open question:

- **Detection isn't guaranteed** → "Auto" uses hardened detection, but you can always
  override, and **Line number** guarantees a chart. No more tables.
- **Multiple times per line** → each is a distinct, named candidate (see §3).
- **Compare two signals (XY)** → set X to a field instead of time.
- **Signals vs Trends redundancy** → Signals is just the preset "X = best time, Y =
  several numerics." Folded in; no separate panel needed (§5).

## 2. Always chart — the line-number fallback

`extractSeries` gains what `extractSignalSeries` already has: when the chosen X axis
is unavailable for a line, fall back to **record/line order**. Concretely,
`SeriesResult` gains an `xKind: 'time' | 'line'` (and the buckets are built over the
line-index range when `xKind==='line'`). The renderer then *always* has buckets to
draw; the table becomes an optional detail, not the fallback.

The sample-point table stays available (it's useful, and it powers click-to-line),
but as a collapsible detail under the chart — never *instead* of it.

## 3. Detecting time — find them all, rank, never guess blindly

A single log line can carry several time-ish values that mean different things. Real
example from a decoded `.esotrace` line:

```
296.004313 ERROR [4532:5990:1310123] ... timestamp: 1782366781500, monotonicTimestamp: 295999947593 ...
```

- `296.004313` — the **line-prefix** trace clock (the log's own time),
- `timestamp: 1782366781500` — an epoch-ms GPS fix time (a *data value*),
- `monotonicTimestamp: 295999947593` — a device ns clock.

Detection therefore must **not** return "the timestamp of the line." It:

1. **Enumerates candidates** — the line-prefix time (if any) **plus** every discovered
   field whose value parses as a time or whose *name* looks temporal
   (`*time*`, `*timestamp*`, `*_ts`, `date`, …).
2. **Ranks** each by "does it behave like a clock across the file?" — present on most
   lines, spans the log, roughly monotonic. A duration/rate that merely looks
   temporal (`presentationDeadlineNanos=16666666`, `appVsyncOffsetNanos`, `frameRateHz`)
   fails the monotonic/spread test and is **not** offered as time.
3. **Defaults** to the top candidate (usually the line-prefix clock); **lists them
   all** in the menu so the user overrides a wrong guess.

### Hardened `parseTimestampFast`
Broaden beyond the 3 current full-date regexes to also recognize, with the field/
offset it matched so callers know *which* candidate it is:
- ISO **with sub-second** (`…:SS.mmm`) — currently truncated,
- **time-only** `HH:MM:SS[.mmm]` (no date; anchor on today or leave date-less),
- **epoch** seconds / millis / micros / nanos (by magnitude),
- **leading relative seconds** (`^\d+\.\d+` — the `.esotrace` prefix),
- keep European / syslog.

Detection stays best-effort by nature — which is exactly why the **Line-number
fallback + manual override are the real guarantee**, not the parser.

## 4. Overlay & XY (the visualization)

- **Overlay (time mode):** multi-select fields → one shared-axis chart, reusing the
  Signals draw path (`drawSignalsOverlay`): auto colors, optional 0–1 normalize,
  hover crosshair with per-field readout, click→line. This is the "several fields'
  trends in one diagram" ask.
- **XY mode:** X = a numeric field, Y = one or more numeric fields → scatter/phase
  plot (e.g. `latitude` vs `longitude`). **Pairing caveat:** two fields are often on
  *different* log lines, so a point needs A and B joined — default to **nearest
  preceding line** (carry-forward), and label the mode so it can't silently mislead.
  For MF4 (every signal on every record) the join is exact.

## 5. Merging Signals

Signals becomes a **preset of the unified panel**, not a separate implementation:
its overlay/stacked draw code is reused (§4), and the "Signals" affordance opens the
panel with `X = best time candidate` and the numeric fields pre-listed. MF4 users
lose nothing; everyone else gains overlay + XY on ordinary logs. The separate tab can
stay as that preset entry point or be retired once the unified panel ships.

Name: keep **"Trends"** for now (least churn); revisit "Explore/Charts" later.

## 6. Phased plan

- **P1 — Always charts (this step).** Harden `parseTimestampFast`; add the
  line-number x-axis fallback to `extractSeries` (`xKind`); renderer charts every
  cell (time or line axis), table demoted to a collapsible detail. Unit tests. *This
  alone fixes the tables bug.*
- **P2 — X-axis selector.** Candidate detection + ranking (§3); the dropdown; per-cell
  and panel-level axis choice.
- **P3 — Overlay.** Multi-select → shared-axis chart (reuse Signals draw), normalize,
  crosshair, click→line.
- **P4 — XY mode.** X = field; nearest-line pairing; scatter draw.
- **P5 — Fold in Signals + polish.** Signals as preset; live search filter on the
  field list (port `renderSignalsList`); group fields by type; empty-state help.

## 7. Anchors (from the code map)

| Concern | Symbol | Location |
|---|---|---|
| Timestamp parser | `parseTimestampFast` | `src/main/timestampParse.ts:15` |
| Series + bucketing | `extractSeries` / `SeriesResult` | `src/main/trendEngine.ts:267` / `255` |
| Index-fallback precedent | `extractSignalSeries` | `src/main/trendEngine.ts:387` (x = idx at 431) |
| Cell render (table-vs-chart branch) | `renderSeriesCell` | `src/renderer/renderer.ts:6221` (chart 6236 / table 6256) |
| Cell chart draw | `drawTrendChart` | `src/renderer/renderer.ts:6277` |
| Field list (weak search) | `renderTrendFieldsBar` / `initTrendsPanel` | `src/renderer/renderer.ts:6076` / `6004` |
| Good search to port | `renderSignalsList` | `src/renderer/renderer.ts:6467` |
| Overlay draw to reuse | `drawSignalsOverlay` | `src/renderer/renderer.ts:6764` |

## 8. Open questions

1. Retire the Signals **tab** entirely once merged, or keep it as the numeric preset?
2. XY pairing default — nearest-preceding-line (carry-forward) vs same-line-only?
   (Doc assumes carry-forward.)
3. Rename "Trends" → "Explore/Charts", or keep the name? (Doc keeps it.)
