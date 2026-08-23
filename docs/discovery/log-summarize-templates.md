# Summarize — semantic compression of a log into message templates

**Status:** design-only draft (no code). Awaiting greenlight for P0.
**Date:** 2026-08-23
**Author:** Claude (for Özge)
**One line:** collapse a huge log into the few thousand *distinct message shapes* (templates) it's actually made of — each with a count, a time span, a severity, and clickable examples — so you understand a 50M-line file in seconds and can then work on the *summary* instead of the raw bytes.

---

## 1. Why (the idea, and why it beats the alternatives)

Özge's framing: *"can we compress but still keep the meaning and work on it faster?"*

The trap to avoid: **raw compression (gzip)** keeps 100% of the meaning but makes work *slower* — you must inflate before you can search/scroll. That's the wrong kind of "compress."

The useful kind is reducing the **working set** while preserving meaning. Two flavours:

| Flavour | What it keeps | Status |
|---|---|---|
| **(a) Selective** — filter + drop columns → extract a slim copy | the lines/columns you chose | **shipped** (`extractFilteredToFile` / `runFilteredExtract` + `columnConfig`) |
| **(b) Semantic** — templating/summarization | the distinct event *shapes* + their frequency/time/severity | **not built here** → this doc |

This doc specs **(b)**. It's the highest-value big-file lever because the "meaning" of a giant log is overwhelmingly **which distinct things happened, how often, when, and how bad** — not the 49.99M near-duplicate lines. A log with 50M lines typically has only a few hundred to a few thousand *distinct templates*. Summarizing to those is a ~10,000× reduction with almost no loss of meaning.

**Explicitly NOT in scope** (deliberately, from prior decisions this week):
- No parallel-per-segment executor (skipped — complexity > value until proven).
- No gzip/byte compression.
- v1 is a **single whole-file worker pass**, not a map-reduce over segments. (It *composes* with segments later — see §10 — but we don't build that now.)

---

## 1b. The agreed FIRST STEP — detect & fold repeating VERTICAL blocks

Özge's framing (2026-08-23): before global templating, do the smaller, higher-value thing first — **cut the spam** — and do it by looking at the log as a 2D **image**, catching the repetition that runs **vertically, down the page**, NOT by matching individual lines horizontally. Reduce each line to a small **fingerprint**, stack the fingerprints into a vertical strip, and detect the **repeating block/motif** in that strip. One model covers all three spam shapes at once:
- a single spammy line = a vertical stripe of **period 1** (classic back-to-back spam)
- an interleaved heartbeat (other components logging in between) = a regular stripe at **period N**
- a repeating **multi-line block** (request cycle, boot sequence) = a repeating vertical motif of length k
- a **variable-length** block delimited by a recurring *anchor line* (Android `--------- beginning of …`, boot cycles) — the same block, a different length each time

Then **fold** each repeat into one marker, keeping the first copy + all interleaved unrelated lines visible.

### Why this is the right first step
- **Simpler than global templating.** One O(n) streaming pass with **bounded memory** — it only tracks fingerprints inside a rolling window of the max period we look for, not a global map of every template in the file. No K-cap, no «other» bucket. It's local/contiguous (repeating *bands*), whereas the global templater (§2) counts every shape file-wide.
- **Immediately useful.** Vertical spam (heartbeats, poll loops, retry storms, repeating transaction blocks, a stuck component emitting 500k near-identical lines) is exactly what makes a big log unreadable *and* bloats the index. Folding those bands is the biggest single readability win.
- **Not a detour.** The per-line fingerprint it needs is the SAME `normalizeShape()` the global templater will reuse; the vertical block-detector just sits on top. It's P0 of the same engine.

### The fingerprint (the horizontal part — just the INPUT)
"Image pattern instead of understanding the content" is the idea you half-remembered; we prototyped a piece of it as **`repeatDetect.ts`** (`normalizeLogLine` + 8 tests). Reduce each line to a **fingerprint** = a hash of its structural shape/skeleton: mask the variable bits (numbers, hex, quoted strings, timestamps → placeholders; or letter→`a`, digit→`9`). Lines differing only by a counter/id/timestamp get the **same fingerprint**. That's the per-line ("horizontal") reduction — but it is only the *input*. The pattern we detect is **vertical** (next).

> `repeatDetect.ts` lives on the lost `feat/big-log-engines` branch (not in this clone). Small; we rebuild `normalizeShape()` fresh and it feeds both this and the global templater.

### The detection is VERTICAL — repeating blocks in the fingerprint sequence
Turn the file into `S = [fp(line₀), fp(line₁), …]` — one fingerprint per line, read **top-to-bottom**. A "vertical repeat" is a **period p** and a contiguous region where `S[j] == S[j−p]` holds (with a small mismatch tolerance). The repeating unit is the block `S[start … start+p−1]`; it repeats `regionLength / p` times.

```
line  fp   (read top→bottom)
 1    H    hb ping <NUM>   ┐  period p = 3, block = [H] (length 1)
 2    X    [Auth] …        │  H recurs every 3rd line; the X,Y
 3    Y    [Net]  …        │  lines BETWEEN are other content and
 4    H    hb ping <NUM>   │  stay visible — only the H copies fold
 5    X    [Auth] …        │
 6    Y    [Net]  …        │
 7    H    hb ping <NUM>   ┘  → fold: "hb ping <NUM> ×3 · period 3 · L1–7"
 8    Z    something else     ← breaks the region → emit
```

This single notion subsumes everything we discussed:
- **p = 1** → same fingerprint every line = classic back-to-back spam.
- **p = N, block length 1** → one line recurring every N lines = the interleaved heartbeat (your point) — the N−1 lines between stay visible.
- **block length k, p = k** → a k-line block repeating contiguously (request cycle, boot loop).
- **block length k, p > k** → a k-line block repeating with p−k other lines between copies.

### Variable-length blocks need an ANCHOR, not just a fixed period (Özge, 2026-08-23)
Real structured repeats aren't rigidly periodic. Android boots each emit `--------- beginning of main` / `… of system` / `… of kernel`, then a boot sequence — but boot A might log 200 lines and boot B 250 (extra warnings/retries), so a fixed `S[j]==S[j−p]` period check breaks. What IS stable is a recurring **anchor line** whose *fingerprint* repeats (its timestamp/pid differ, but `normalizeShape` masks that).

So the more robust detector: **a recurring fingerprint delimits blocks** — fold the span from one occurrence of the anchor **until its next occurrence** into one block. Consecutive inter-anchor segments that match (fingerprint-sequence equal within tolerance) are "the same block repeating" → fold copies 2…N. This handles variable length and boot-to-boot inner variation that pure period detection can't. (Fixed-period is then just the special case where the anchor recurs at a constant p.)

Two ways to pick the anchor:
- **Manual (simplest, deterministic):** user right-clicks a recurring line → "Fold each block until this line repeats." Perfect for `--- beginning of …`, section headers, "Boot completed", etc.
- **Auto-suggest:** surface fingerprints that recur ≥N times and look like delimiters (distinctive, low line-cardinality) as candidate anchors.

"At least the timestamp column will be different" across copies is expected and already handled — the fingerprint masks `<TS>`/`<NUM>`/… before comparison.

### Detecting it (P0 algorithm — streaming, bounded)
"Anchor & extend":
1. Keep a rolling map `lastSeen: fingerprint → most-recent line`, evicting entries older than `maxPeriod` lines (this bounds memory to one window).
2. At line `i` (fingerprint `f`): if `lastSeen[f] = i − p` for some `p ≤ maxPeriod`, that's a **candidate period**. Verify it's real by checking the run holds backward — `S[i−1]==S[i−1−p]`, `S[i−2]==S[i−2−p]`, … — i.e. we're inside a period-`p` repeat, not a coincidence.
3. If verified, open/extend a **repeat region** for period `p`; keep consuming while `S[j]==S[j−p]` (allow a few mismatches = tolerance). When it breaks, **emit** `{ blockFingerprints: S[start…start+p−1], period p, start, end, repeatCount }` and evict.
4. Prefer the **smallest** verified `p` (so a 2-line block isn't mis-read as period 4).

Alternative if anchor&extend is flaky on messy logs: **autocorrelation per window** (for each candidate `p`, score how many `j` satisfy `S[j]==S[j+p]`; peaks = dominant periods) — more robust, heavier (O(window·maxPeriod)). Decide in P0 against real logs.

### Fold
For each emitted region with `repeatCount ≥ minRepeats` (default ≥3):
- **Fold** the 2nd…Nth copies into one marker on the first copy: `▸ ⟨5-line block⟩ ×240 · period 5 · lines 1000–2200` (click to expand). The first copy + every interleaved unrelated line stay visible.
- or **Mute / drop** the folded copies (reuse MUTE dim-in-place / EXTRACT-to-file).

**Knobs:** `maxPeriod` (largest block/period to look for — bounds the window & memory), `minRepeats` (copies before folding), `tolerance` (allowed mismatches inside a region), `similarity` (per-line fingerprint strictness — below).

### Memory (bounded)
Resident = `lastSeen` for fingerprints within the last `maxPeriod` lines + the currently-open repeat regions. Independent of file size. One streaming pass, cancellable. (Larger `maxPeriod` finds bigger/rarer blocks at more memory — a dial, not free.)

### Per-line fingerprint strength (decide in P0)
1. **Exact shape equality** (hash the normalized shape) — fast, predictable. Ship first.
2. **Near-shape** = equality *after* masking (tolerates number/id/timestamp churn — usually enough for "small changes").
3. **Edit-distance fallback** (bounded Levenshtein on the shape) for un-maskable drift — only if 1+2 miss real cases; costs more.

---

## 2. What "a template" is

A **template** is a log line with its *variable* parts masked to placeholders, so near-duplicate lines collapse to one shape.

```
raw:   2026-08-23 10:14:07.882  wifi  connect failed for ssid="Home-5G" after 3200ms (err=0x1f)
tmpl:  <TS>  wifi  connect failed for ssid=<STR> after <NUM>ms (err=<HEX>)
```

All lines producing the same masked shape are one template. The template carries:

```ts
interface LogTemplate {
  id: number;              // stable within a run (hash of the masked shape)
  shape: string;           // the masked template string (what the user reads)
  count: number;           // how many raw lines matched
  firstLine: number;       // viewerLine (1-based) of first occurrence
  lastLine: number;        // viewerLine of last occurrence
  firstTs?: string;        // timestamp of first occurrence (if the file has timestamps)
  lastTs?: string;
  severity?: 'fatal'|'error'|'warning'|null;  // from severityIndex (worst seen)
  examples: number[];      // a few viewerLines (e.g. up to 5) to drill into
}
```

### Masking rules (the tokenizer)
Order matters (mask most-specific first). Start conservative; tune with real logs.
- timestamps (reuse the existing timestamp detector) → `<TS>`
- UUIDs → `<UUID>`; hex/0x runs & long hex keys → `<HEX>`; IP/MAC → `<IP>`/`<MAC>`
- quoted strings `"..."` / `'...'` → `<STR>`
- integers/decimals (incl. units suffixes handled by keeping the unit) → `<NUM>`
- file paths / URLs → `<PATH>`/`<URL>`
- long base64/token-ish runs → `<TOK>`

**Tuning dial = aggressiveness.** Under-mask → too many templates (variables leak in). Over-mask → distinct events merge. Ship one sensible default; expose a coarse "granularity" slider later if needed. This is the one genuinely fiddly bit and where we spend the P0 test budget.

> Note: this is a *lightweight tokenize-and-mask* templater, not full Drain. Drain (a parse-tree by token-count + first-tokens) can come later if masking proves too coarse; the data model above doesn't change.

---

## 3. Memory strategy (bounded — this is the whole point)

We must never build a structure proportional to the *file*. The output is proportional to the *number of distinct templates*, which we **cap**.

- One streaming pass; maintain `Map<shapeHash, LogTemplate>`.
- **Cap distinct templates at K** (e.g. 5,000). When full, evict the smallest-count template into an `"<other>"` bucket (count-only). This is a HeavyHitters/lossy-counting approximation — we keep the top-K shapes exactly enough for a summary and never blow memory on a pathological all-unique file.
- `examples[]` capped at ~5 per template (reservoir: keep first few + last).
- Peak memory ≈ K × (short string + a few numbers) ≈ a few MB regardless of a 50M-line input.

If K is hit and `<other>` is large, the UI must SAY SO ("5,000 shapes shown · 1.2M lines in 41k rarer shapes collapsed to «other»") — **no silent truncation** (per the LOGAN "no silent caps" convention).

---

## 4. Where it runs (reuse, don't reinvent)

- **Scan:** a worker, mirroring `trendWorker` / `indexWorker` (keeps the main thread free; big files already scan in workers). The worker streams lines via the existing read path and emits the capped template map.
- **Severity per line:** reuse `severityIndex.ts` (`SEVERITY_RG_PATTERN`, `rankToLevel`, `buildSeverityIndexFromMap`) to stamp each template's worst severity.
- **Timestamps:** reuse the existing timestamp detector for `<TS>` masking AND for firstTs/lastTs.
- **Click-to-line:** examples/first/last are `viewerLine` refs → reuse `navigate-to-line` / `goToLine()` (same as crash-item/component-item clicks in the Analysis panel).
- **Scope:** reuse `resolveScope` + `forEachScopeLine` so Summarize honours the **active filter / range / search-results** scope (VERB × SCOPE north-star), not just the whole file.
- **Extract-selected → slim copy:** tick templates → feed their line set to the existing `extractFilteredToFile` path = bridge from semantic (b) back to selective (a).

---

## 5. UI (human operator)

A new **bottom tab "Summarize"** next to Analysis/Trends (`data-bottom-tab="summarize"`), same pattern as Cadence/Trends.

- **Run Summarize** button → runs the worker over the current scope. Progress via the standard `showProgress`/status-bar path.
- **Templates table**, sortable, one row per template:
  `severity dot · count · %bar · shape (monospace, placeholders dimmed) · first→last time · [⤢ examples]`
- **Row click** → expands example lines (click any → jump to that raw line in the viewer).
- **Sort**: by count (default), severity, first-seen, last-seen.
- **Filter box**: substring/regex over shapes ("show only templates containing timeout").
- **Header readout**: `N templates · M lines summarized · coverage% · «other» bucket size`.
- **Actions on selection** (checkboxes):
  - **Extract selected → file** (slim copy of just those templates' lines).
  - **Filter viewer to selected** (reuse applyFilter with the line set).
  - **Save as entity** (later — a "template set" becomes a saveable/reusable entity in the Saved panel, consistent with the entity-registry).

Optional later: a tiny per-template **sparkline** (occurrences over time) reusing the density/trend rendering.

---

## 6. Agent parity (rule 5 — MANDATORY)

Every verb ships human **and** agent, or a written exemption. Summarize ships both:

- **API:** `POST /api/summarize` → `{ templates: LogTemplate[], other: {count, lines}, coverage, scope }` (viewerLine refs + counts, not raw text — same philosophy as `logan_evidence_pack`). Add to the allowlist in `api-server.ts`.
- **MCP tool:** `logan_summarize` (register in `mcp-server/index.ts`, mirror `logan_analyze`). Params: `{ scope?, maxTemplates?, granularity?, contains? }`. Returns the compact template list so an agent can triage a huge log in one call and then `logan_report_finding` on interesting templates.
- Shared impl in the worker/main so UI and agent are the same engine (no diverged logic).

This makes Summarize a first-class LOGAN verb usable by both operators, and it slots straight into the existing agent triage flow (evidence-pack → summarize → drill → pin findings).

---

## 7. Staged build plan (primitive-first, each stage independently shippable)

- **P0 — vertical repeat-block fold (the agreed first step, §1b).** Pure `normalizeShape(line)` (per-line fingerprint) + two folders over the fingerprint sequence:
  - `foldByAnchor(fingerprints, anchorFp, {similarity, minRepeats})` — recurring-line-delimited, **VARIABLE-length** blocks (the Android-boot case); manual anchor + auto-suggest candidates.
  - `detectRepeatBlocks(fingerprints, {maxPeriod, minRepeats, tolerance})` — **fixed-period** rhythmic spam (heartbeats).
  Both → `{blockFingerprints, start, end, repeatCount}`. No global map, no cap, no I/O, no UI. Golden tests: timestamp-tolerant shape masking; anchor-delimited variable-length fold; period-1 / period-N-interleaved / multi-line-block; smallest-period; tolerance; determinism. *Tune masking + anchor/period dials against real logs (incl. an Android logcat with `--- beginning of …`).* ← greenlight target.
- **P0.5 — global templater (extends P0).** `foldTemplates(lines, opts)`: the capped *whole-file* fold reusing the SAME `normalizeShape()`, with the K-cap + `<other>` bucket (§3). Adds the global summary on top of the neighbour-only collapse.
- **P1 — worker + API + MCP.** Wire the pure fns into a worker; add `/api/summarize` (+ optional `/api/collapse-repeats`) + `logan_summarize`. Headless parity, no UI yet. Verifiable from the agent alone.
- **P2 — Summarize panel.** The bottom tab + table + click-to-line drill. GUI eyeball.
- **P3 — actions + scope + polish.** Extract-selected (slim-copy bridge), filter-to-selected, scope integration, severity dots, sparklines, `<other>` readout. Save-as-entity.
- **P4 (optional, only if proven needed).** Drain-style parser if masking is too coarse; segment map-reduce for the scan (the parallel path we deferred) *only if* summarize latency on real files is the pain.

---

## 8. Performance

- One O(n) streaming pass; output is O(distinct templates) ≤ K.
- No per-line resident structure → memory is a few MB regardless of file size.
- On a 50M-line file the cost is dominated by the byte read (same as any full scan); the fold itself is cheap (hash a masked string per line).
- Cancellable (reuse the analyze/search cancel-signal pattern).

## 9. Edge cases
- **No timestamps** → firstTs/lastTs omitted; everything else works.
- **Mostly-unique lines** (e.g. every line has a distinct payload) → template count hits K → `<other>` dominates; UI says so. That's the honest signal "this log doesn't compress semantically."
- **Multiline stack traces** → v1 treats each physical line separately (a stack becomes a cluster of related templates). Grouping multi-line events is a P4 nicety.
- **CRLF / encoding** → reuse the existing line-read path so it's consistent with the viewer.

## 10. How it composes later (not now)
Because templates fold associatively (two partial `Map<shape,count>` merge by summing counts and unioning example/first/last), Summarize is a clean **map-reduce** target. IF we ever revive the segment-parallel executor, each segment folds independently and the merge is exact — but v1 is a single worker pass and we do **not** build the parallel path now (deferred decision).

## 11. Open questions (decide during P0)
1. Default `K` (distinct-template cap) — 5,000? Make it a param.
2. Masking aggressiveness default — one profile, or expose a granularity dial in v1?
3. Should `<NUM>` keep the unit (`<NUM>ms`) — yes by default (more readable, still folds)?
4. Is severity per template "worst-seen" or "most-common"? (worst-seen proposed.)
5. Does Summarize get its own entity kind now, or reuse a generic "template set" later?

---

### TL;DR
Build a lightweight **mask-and-fold templater** (P0, pure + tested), expose it as `logan_summarize` + a **Summarize** bottom tab, capped-memory and scope-aware, with click-to-raw drill and a bridge to the existing slim-copy extract. It's the semantic-compression answer to "compress but keep the meaning and work faster," self-contained, and it reuses the worker/severity/scope/click-to-line/extract infra we already have.
