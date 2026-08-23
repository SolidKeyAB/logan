# Auto-composite large files (background virtual segmenting)

**Status:** P1 shipped (PR #123 — range-scoped index primitive). P2 increment 1 built
(`SegmentedFileHandler` lazy+LRU read path + `segmentPlan` adaptive budget, headless).
Next: P2 increment 2 = wire into the open path + Features toggle + search/severity fan-out.
**Date:** 2026-08-22 (phone, Özge)
**One-liner:** For any single file above a *resource-bearing size*, automatically wrap it
in the existing **virtual-file (composite) entity** in the background — split into N
line-segments — so the memory-heavy index is paged/evicted per segment instead of held
as one monster index.

---

## The idea (Özge's words)

> "maybe we can commonize the virtual file entity in the background for all files bigger
> than a resource-bearing size?"

Take the "single session" composite — which already presents N files as one continuous
read-only log — and turn it inward: apply the same abstraction to **one** big file by
segmenting it, transparently, whenever the file is large enough to be a resource problem.

---

## What "resource-bearing size" actually is (concrete)

The cost that scales with file size is **the line index**, not the file bytes. `FileHandler`
holds two resident `Float64Array`s for the whole file lifetime:

- `offsets: Float64Array` — byte offset of each physical line
- `lengths: Float64Array` — byte length of each physical line

= **16 bytes per physical line, resident**. So:

| Lines | Index RAM (resident) |
|------:|---------------------:|
| 1M    | ~16 MB   |
| 12.5M | ~200 MB  |
| 50M   | ~800 MB  |

That 16 B/line resident index **is** the resource-bearing size.
(ripgrep-backed *search* does not need our index to scan — it uses the index only to map a
byte-offset back to a line number.)

### Proactive, system-relative threshold (don't hardcode)

LOGAN runs *on* the machine, so it should compute the budget from the live system at open
time, not use a fixed number. `os` is already imported in `src/main/index.ts`.

Inputs available with zero new deps:
- `os.totalmem()` / `os.freemem()` — physical RAM (total & free right now).
- `v8.getHeapStatistics().heap_size_limit` and `.used_heap_size` — **the actual ceiling this
  process can grow to**. This is the real binding constraint, not system RAM: the index is a
  typed array counted against the process, and V8's default heap ceiling is ~2–4 GB unless
  `--max-old-space-size` was raised. A 50M-line file's 800 MB index can OOM the process even
  on a 64 GB machine.
- Electron extras if wanted: `process.getSystemMemoryInfo()`, `app.getAppMetrics()`.

Estimate before indexing (cheap — just `fs.stat` the file):
```
estLines   ≈ fileSizeBytes / avgBytesPerLine     // indexScan already assumes ~80 B/line
estIndexMB ≈ estLines * 16 / 1e6
budgetMB   = FRACTION * min( os.freemem(), heap_size_limit - used_heap_size )   // e.g. FRACTION ≈ 0.4
if (estIndexMB > budgetMB)  → auto-segment
```

The same budget also **sizes the segments**: pick segment line-count so one segment's index
is a small slice of the budget, and cap resident segments ≈ `budgetMB / perSegmentIndexMB`.
So a 2 GB laptop and a 64 GB workstation both stay safe — the machine picks its own limit.
Show the computed numbers in the Features-modal readout so the choice is legible.

---

## What's already built (~70%)

The composite path is real, merged, and proven to carry every tool:

- **`CompositeLineSpace`** (`src/main/compositeLineSpace.ts`) — pure, unit-tested line-space
  math: global↔(fileIndex, localLine), `split(start,count)` into per-member sub-ranges,
  `boundaries()`. **This is already exactly "one file made of N segments."**
- **`CompositeFileHandler`** (`src/main/compositeFileHandler.ts`) — wraps N child handlers,
  re-bases every read/search/severity result into the global line space. Same method shapes
  as `FileHandler`.
- **`getReadHandler()`** (`src/main/index.ts`) — the whole viewer/search/analyze/time-gap/
  trend/agent stack already routes reads through this and transparently gets the active
  composite. Composites already work end-to-end (PRs #109–#116: viewer, Search, Search
  Configs, Filter, Time-gaps, scope, Trends/Signals, agent reads).
- **Split-file awareness already exists**: `indexScan.ts` parses a `#SPLIT: part/total`
  header + `headerLineCount` (the "Merge to file" / split lineage). LOGAN can already
  physically split and header-index parts.

## What's missing (~30% — the part that actually saves RAM)

Wrapping a big file in a composite **alone saves nothing** — if all N segment indexes stay
resident, total index RAM is unchanged (still 16 B/line). The real win needs two new pieces:

1. **Range-scoped index** — `scanFileIndex` / `FileHandler` must index a `[startByte,endByte)`
   window and return offsets + the starting global line. `scanFileIndex` already chunk-reads
   the file, so range-scoping is a modest change. Add a byte-parity test vs the whole-file
   scan (the project's parity-test convention).
2. **Lazy build + LRU eviction of cold segments** — the composite starts with only per-segment
   line-count/boundary metadata (one cheap full pass, or reuse an existing split header),
   indexes a segment on first touch, and drops the index of segments far from the viewport.
   Then a 50M-line file costs ~the index of the few *hot* segments, not 800 MB.

This is the same target as the abandoned **block-index spike** (branch `feat/big-log-engines`
is gone → never merged; `docs/discovery/engine-selection.md` no longer present). Block-index
was "byte-identical to scanFileIndex, ~1000× smaller." Segmenting + eviction is the
composite-shaped way to bank that win with infra that already exists.

---

## Staged path (primitive-first, same as entity-registry / workflow-canvas)

- **P0 — decide policy** (this doc): threshold = **adaptive budget computed from live system
  memory** (`min(os.freemem(), v8 heap headroom) × fraction`, see above), not a hardcoded
  number; segment size & resident-segment cap derived from that same budget; eviction = keep
  viewport ± k segments; opt-in via Features modal first.
- **P1 — range-scoped index primitive**: `scanFileIndex(path, {startByte,endByte})` +
  `FileHandler.openSegment(...)`; byte-parity test vs whole-file. *No behavior change yet.*
- **P2 — auto-segmenting composite**: on open of an over-threshold file, build a
  `CompositeFileHandler` whose members are N **virtual segments of the one file** (share
  fd/path, differ by line window) with lazy index + LRU eviction. `getReadHandler()` already
  returns it → viewer/search/analyze/trends "just work." Gate behind a Features toggle;
  show the RAM readout (like the block-index A/B toggle did).
- **P3 — proactive engine selection**: profile file on open → policy auto-picks whole-file
  vs segmented; persist per-file choice in the sidecar.

### Cheaper v1 alternative (reuses 100%, cruder)

Auto-**split to N part-files on disk** in the background (the existing Merge/split +
`#SPLIT:` header path), then auto-open them as a single-session composite. Zero new engine
code, but writes disk + needs cleanup. Use as a spike to validate the UX before building
virtual segments.

---

## Honest caveats

- **Full-file search / F8 severity / evidence-pack** touch every line, so they'd force-index
  every segment once (transiently) — resident RAM still bounded, but the *first* whole-file
  operation pays the full scan. Mitigate by caching per-segment severity/index to the sidecar
  (ties back to block-index-to-disk).
- The composite currently keeps all member handlers resident (known ">10-file LRU-evict
  risk"). Eviction must be added for this to pay off — it's the crux, not a nice-to-have.
- Parity rule: no new agent verb needed (segmenting is an internal read-path engine choice,
  invisible to tools); document as a parity exemption like the block-index toggle.
