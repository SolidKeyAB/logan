# Guided Triage — Root-Cause Finding in LOGAN

## Goal

Give a user who is *not* a log expert a fast path from **symptom** to **root cause**.
Instead of staring at a raw file, they answer a few templated questions and LOGAN runs
a *recipe* — a fixed combination of the primitives it already has (search, filter,
highlight, time-gaps, trends, baseline, pin-as-finding) — and pins clickable findings.

## Design principle: symptom-first, domain second

Users reliably know the **symptom** ("it crashed", "it's slow"). They do *not* always
know the **domain** (Android vs. embedded vs. backend). So:

- **Symptom is the front door** — a small menu of universal failure modes.
- **Domain is a *pack*** that sits underneath and only swaps the keyword/field
  dictionaries each recipe uses (e.g. what "crash" looks like in logcat vs. serial).
- Domain is **auto-detected** from log content, with a manual override.

```
User → [Symptom menu] → recipe runs → findings pinned → [drill-down: 3 next moves]
                ↑
          [Domain pack] supplies the keywords/fields the recipe searches for
```

This beats a pure domain menu because symptoms generalize and domains don't, and it
beats a flat search box because the user doesn't have to know *what* to search for.

---

## The symptom menu (8 recipes)

Each recipe is a one-tap action. "Primitives" lists the existing LOGAN/MCP tools it
chains. Every recipe ends by pinning results via `logan_report_finding` so they are
clickable in the viewer.

| # | Symptom (button)        | What the recipe does                                                                 | Primitives used |
|---|-------------------------|--------------------------------------------------------------------------------------|-----------------|
| 1 | **It crashed / died**   | Find fatal/exception/stack-trace markers; jump to the **last line before death**; pin the 50 lines before it as context. | `logan_investigate_crashes`, `logan_search`, `logan_get_lines`, `logan_report_finding` |
| 2 | **It froze / hung**     | Rank **time gaps**; surface the last log line before the silence; flag stuck/repeating loops. | `logan_time_gaps`, `logan_get_lines`, `logan_search` |
| 3 | **It's slow**           | Trend duration/latency fields over time; list slowest operations; flag timeout/GC spikes. | `logan_trend_fields`, `logan_trend_series`, `logan_search` |
| 4 | **Error storm**         | Plot error-rate over time and find the **spike**; show the **first occurrence** of each unique error; group by component. | `logan_analyze`, `logan_trend_series`, `logan_search` |
| 5 | **Won't start**         | Walk the startup sequence; surface config / port-bind / permission / missing-dependency errors. | `logan_search`, `logan_get_lines`, `logan_analyze` |
| 6 | **Connection drops**    | Find disconnect/reconnect/retry/timeout events; correlate by endpoint/peer.          | `logan_search`, `logan_trend_correlate`, `logan_trend_transitions` |
| 7 | **Intermittent / flaky**| Detect what **flipped** (`transitions`); correlate event-presence vs. a state field. | `logan_trend_transitions`, `logan_trend_correlate` |
| 8 | **Wrong / odd value**   | Trend the suspect field; find **where it changed**; correlate with surrounding events. | `logan_trend_series`, `logan_trend_transitions`, `logan_trend_correlate` |

---

## Templated guiding questions (narrowing)

After a symptom is picked, LOGAN asks at most 2–3 of these to narrow the recipe.
All are optional — an unanswered question falls back to an auto-detect default.

| Question                          | Options / input                       | Effect on the recipe                                          |
|-----------------------------------|---------------------------------------|--------------------------------------------------------------|
| **When did you first notice it?** | timestamp · "around line N" · *don't know* | Sets the focus window. *Don't know* → auto-jump to first error. |
| **Which component / module?**     | dropdown auto-filled from discovered components | Filters every search to that component.                 |
| **Got a known-good run?**         | pick a saved baseline · no            | Switches the recipe to a **baseline compare** (diff vs. good). |
| **One-off or repeating?**         | once · keeps happening                 | Repeating → prefer `transitions`/`correlate` over single-hit search. |

---

## The drill-down (5-Whys)

After the first finding, *always* offer the same three next moves. This is what turns a
single hit into a root cause:

1. **What happened right BEFORE this?** → pin the preceding N lines / last state change.
2. **What else fired at the SAME time?** → correlate events in the same time bucket.
3. **Has this happened before in the file?** → all earlier occurrences + first one.

Each move re-pins findings and pushes a breadcrumb so the user can step back.

---

## Domain packs

A pack is just a dictionary swapped in behind the recipes — same recipes, different
vocabulary. Detected from log content; user-overridable.

| Pack            | "Crash" markers (ex.)                  | Latency field (ex.) | Notes |
|-----------------|----------------------------------------|---------------------|-------|
| **Generic**     | `FATAL`, `exception`, `panic`, `core dumped`, stack frames | `duration`, `elapsed`, `ms` | default fallback |
| **Android/logcat** | `FATAL EXCEPTION`, `ANR`, `signal 11`, `tombstone` | `Displayed`, `Choreographer` skipped frames | level column, tags |
| **Embedded/serial** | `HardFault`, `assert`, `watchdog`, `reset` | tick counters | no timestamps common → use line order |
| **Web/backend** | `5xx`, `traceback`, `OOMKilled`, `segfault` | `latency_ms`, `rt`, `took` | request-id correlation |
| **Automotive/MF4** | signal threshold breaches             | numeric signal channels | routes through the Trends/signal engine |

---

## UX surface

- **Entry point:** an "Investigate / Guide me" panel in the activity bar (or extend the
  existing `logan_triage` flow).
- **Breadcrumb:** the investigation path with a **Back** button.
- **Findings:** every recipe step pins a clickable annotation (existing finding system).
- **Free-text box:** a plain-English question that the AI agent maps onto a recipe — the
  escape hatch for anything the 8 buttons don't cover.

---

## Build order (recommended)

1. **This spec** — symptom → recipe table (done).
2. Recipe engine: a small map of `symptom → ordered list of primitive calls`, reusing
   the existing MCP tools; output always pinned as findings.
3. The panel UI (symptom buttons + guiding questions + breadcrumb).
4. Domain-pack dictionaries + auto-detection.
5. NL→recipe box on top of the agent.

Recipes are pure composition of primitives that already exist, so step 2 needs no new
analysis engine — only wiring + a keyword/field dictionary per pack.
