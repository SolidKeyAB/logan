# Granularization — Preparing Logs for the LLM (Evidence Pack)

## Goal

Before an AI agent ever reasons about a log, LOGAN should have already done the heavy
work **natively and deterministically**: chop the raw file into typed, addressable
units, roll them up into layered summaries, and hand the agent a small structured
**briefing** instead of a haystack of raw text.

Two audiences, one artifact:

- **The user** gets a navigable, granular view (units, components, rollups) they can
  click into — not a wall of lines.
- **The LLM/agent** gets a compact *evidence pack* and then works **by reference**
  (unit IDs, field names, line ranges) — spending tokens on judgement, not on ingesting
  the file.

## Design principle: deterministic first, tokens last

> LOGAN chews through millions of lines for free with search / regex / trends /
> time-gaps. The LLM should only ever see the **distilled artifact** — then it proposes,
> and a deterministic pass verifies before anything is shown as a finding.

The trap this avoids is **naive delegation**: an agent that does 20 round-trips
(search → read lines → search again…), each dragging raw log text into its context.
That is slow and token-hungry. Pre-computing a briefing collapses those round-trips.

```
Raw log ──▶ [1. Granularize natively] ──▶ typed units + structured index + summaries
                                                     │
                                                     ▼
                                          [2. Evidence pack] ── one compact briefing
                                                     │
                                                     ▼
                               Agent reads pack ─▶ works BY REFERENCE (ids/ranges)
                                                     │
                                                     ▼
                               proposes ─▶ [deterministic verify] ─▶ pin as finding
```

---

## Part 1 — Granularization layer (native, pre-LLM)

Turn the flat file into typed, addressable units so both a human and an LLM consume
small relevant slices, never the whole file.

### 1.1 Record stitching (line → record → event)

- Multi-line units — stack traces, JSON blobs, wrapped messages — collapse into **one
  record**. LOGAN already parses timestamps + levels; extend that pass to emit records.
- Each record gets a stable **`unit_id`**, plus `component`, `session`, `level`, and a
  `time_bucket`. IDs are stable across re-scans of the same file so the agent and user
  can reference "unit #8047" instead of pasting text.

### 1.2 Structured index (mostly built)

- `logan_trend_fields` already discovers `key=value`, `key: value`, and JSON fields with
  inferred **type** (numeric / boolean / string / array) and frequency. That is the
  file's *vocabulary*.
- Persist it as a per-file **structured index** so the agent starts with the real field
  names instead of guessing keywords. This is the agent's dictionary.

### 1.3 Layered summaries (map-reduce)

Roll units up so the reader can **zoom** instead of scroll:

| Layer | Contents |
|-------|----------|
| **Whole-file** | level counts, time span, components, crash count, top time-gaps, baseline deltas |
| **Per-component** | that component's level mix, first/last activity, notable events |
| **Per-chunk (time bucket)** | dominant events, error rate, anomaly flags |
| **Unit** | the stitched record itself, addressable by `unit_id` / `viewerLine` |

The LLM (or user) descends layer by layer — overview → component → chunk → exact line —
pulling detail **only where it matters**.

### 1.4 Addressability

Every unit, rollup, and finding is referenced by **`unit_id` + `viewerLine`** (1-based,
as displayed). Click-to-line already exists — reuse it so every artifact is navigable.

---

## Part 2 — The evidence pack (what the agent gets first)

Before the agent is woken, LOGAN assembles **one compact briefing** and exposes it as a
single MCP call. The agent fetches this *first*, instead of blindly searching.

Contents (all cheap, all native):

- **Discovered fields** (from the structured index) — the agent's vocabulary.
- **Level / component counts** and the whole-file rollup.
- **Crashes / fatal markers** with their `viewerLine`s.
- **Top time-gaps** (the silences worth explaining).
- **Baseline deltas** if a known-good baseline exists (new crash / level shift /
  error-rate spike).
- **Candidate anomalies** — deterministic flags for the agent to confirm or reject.

The pack is small (structured counts + references, not raw text), so it fits in a single
turn and replaces dozens of exploratory round-trips.

---

## Part 3 — Cost-efficient agent tool use

Conventions layered onto the **existing** MCP tools so the agent stays cheap:

- **Work by reference, drill on demand.** Search/analysis tools return counts +
  `viewerLine` snippets first; the agent pulls `logan_get_lines` only for the ranges it
  actually needs.
- **Payload caps.** Every tool bounds what it returns (top-N + total count), so nothing
  accidentally dumps the file into context. When a cap truncates, say so — never let a
  silent top-N read as "that's everything."
- **Proposer–verifier.** The agent *proposes* candidate findings; a deterministic
  rule/regex/trend pass *confirms* before it is pinned via `logan_report_finding`. Keeps
  hallucinated findings out of the viewer.
- **Deterministic does the volume, LLM does the judgement.** Native scanning handles the
  millions of lines; the LLM only reasons over the distilled pack.

---

## What already exists vs. what's new

| Capability | Status |
|------------|--------|
| Field discovery with inferred type/frequency (`trend_fields`) | ✅ built |
| Trends / transitions / correlate / time-gaps / crashes | ✅ built |
| Baseline compare (level shift / new crash / error-rate spike) | ✅ built |
| Click-to-line finding system (`logan_report_finding`) | ✅ built |
| **Record stitching → stable `unit_id`s** | 🔨 new |
| **Persisted per-file structured index** | 🔨 new (persist what `trend_fields` computes) |
| **Layered map-reduce summaries** | 🔨 new |
| **Evidence-pack assembler + single MCP fetch call** | 🔨 new |
| **Payload caps + by-reference conventions across tools** | 🔨 wiring |

The new pieces are mostly *composition and persistence* of primitives LOGAN already has
— not a new analysis engine.

---

## Build order (recommended)

1. **This spec** (done).
2. **Structured index + record stitching** — extend the existing timestamp/level pass to
   emit stitched records with stable `unit_id`s; persist the `trend_fields` output as a
   per-file index sidecar.
3. **Layered summaries** — whole-file / per-component / per-chunk rollups over the units.
4. **Evidence-pack assembler** — one function that gathers fields + rollups + crashes +
   gaps + baseline deltas + anomaly flags, exposed as a single MCP tool the agent calls
   first (e.g. `logan_evidence_pack`).
5. **Payload caps + by-reference drill-down** conventions across the existing MCP tools.

Net: same analytical power, a fraction of the tokens — LOGAN hands the LLM a **briefing,
not a haystack**.

---

## Relationship to the AI logging-framework idea

This is the *analysis-time* half of the same principle discussed for an AI-driven
logging framework:

- **Emit time** — stable log **IDs + classification** baked into the code's log calls.
- **Analysis time** — stable **units + structured index + rollups** derived from the raw
  stream.

Granular identity from both ends. If logs already ship with stable IDs, Part 1 gets
nearly free (stitching and classification are already done at the source); until then,
LOGAN reconstructs that granularity natively.
