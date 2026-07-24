# Pattern Distance — how far do two patterns travel together?

**Status:** Shipped · **Owner:** (Özge) · **Created:** 2026-07-24

## 0. Why

When triaging, a recurring question is *"whenever X happens, is Y nearby?"* — e.g. does
`abort` almost always sit within a few lines of `auth`? If two events cluster, you can
narrow a query to the regions where they co-occur; if they're consistently far apart,
they're probably unrelated. LOGAN already finds the lines each pattern hits; Pattern
Distance turns those two hit-lists into a **distance distribution** you can read and click.

## 1. The core idea — nearest-neighbour line gaps

Given pattern **A**'s hit lines and pattern **B**'s hit lines, for each A we find the
relevant B and record the **gap in line numbers**. Direction chooses which B:

| Direction | B chosen for each A | Use |
|---|---|---|
| **nearest** (either side) | closest B before or after | "are they generally close?" |
| **next after** (A→B) | smallest B ≥ A | "what follows A?" (cause→effect) |
| **previous before** (B←A) | largest B ≤ A | "what precedes A?" (effect→cause) |

An A with no qualifying B on the requested side is dropped (there is genuinely no "next B").
From the gap list we report **min / median / mean / max**, **within ≤5/≤20/≤100 lines %**
(the narrow-down signal), a **gap-range histogram**, and the **closest co-occurrences**.

The maths is `to`-sorted + binary search per A — O(Nₐ·log N_b), instant even at the 100k
match cap.

## 2. Two surfaces

1. **Search Configs panel — config↔config.** With ≥2 enabled configs that have matches, a
   **📏 Distance** button appears; pick A and B from dropdowns. Computed from results
   **already in memory** — no re-search. Output: stats + histogram + top-20 clickable pairs.
2. **Right-click explorer — any two patterns.** Select text → right-click → **Distance
   from "..."**. The selection seeds the **anchor (A)**; type any **compare (B)** pattern
   (both take regex/case), pick a direction, **Measure**. Because the patterns are arbitrary
   it runs two real searches (parallel; `handler.search` is reentrant so they don't
   interfere), then the same maths. Adds a **diagram over the whole file**:

   - anchor hits as ticks on the **top lane**, compare hits on the **bottom lane**;
   - a **log-scaled distance curve** between them (*far* at top, *near* at bottom);
   - **click any point** to jump to that anchor line.

   Both instance lanes and the curve are sampled to ≤2,000 marks for rendering; stats use the
   full set.

## 3. What exists vs. what was added

- **Reused:** the search engine (`window.api.search` / ripgrep), search-config results in
  memory, `goToLine` navigation, the standard `.modal` shell (auto-wired close/backdrop).
- **New:** `src/shared/patternDistance.ts` — the pure, unit-tested gap maths
  (`nearestLineGaps`, `directionalLineGaps`, `summarizeGaps`, `pctWithin`; tests in
  `src/tests/patternDistance.test.ts`). The renderer holds an inline mirror of these until it
  becomes an ES module (see `docs/TECH_DEBT.md` → *Inline Mirror*). Plus the config-panel
  Distance UI and the right-click explorer modal + canvas diagram in `renderer.ts`.

## 4. Follow-ups (not built)

- **Time-gap distance** — measure the gap by timestamp (seconds), not just line count, for
  logs where line spacing ≠ time spacing.
- **Multiple compare patterns** — B as several colour-coded series in one diagram.
