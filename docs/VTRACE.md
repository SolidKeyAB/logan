# vtrace — automotive IVI binary trace (`.esotrace`) support

**Status:** Implemented (adapter + worker + tests) · **Owner:** (Özge) · **Created:** 2026-06-30

`vtrace` is a neutral codename for the binary trace format emitted by the trace
server on some automotive IVI head units. On disk the files use the `.esotrace`
extension and open with a length-prefixed `traceserverIVI` identity record — both
are intrinsic markers of the *input* and are matched only by the detector; none of
our own symbols, file names, or labels carry a vendor name.

This doc explains the format, the decoder, and exactly how it plugs into LOGAN.

---

## 1. What lands in LOGAN

Opening a `log_NNNN.esotrace` file produces normalized text lines, one per trace
record:

```
296.004473 WARNING [4532:4532:1310123] [valhalla]: Using simple cache
296.005975 ERROR   [4532:4532:1310123] Coordinator Animate camera ...
```

`<seconds> <LEVEL> <message>` — relative monotonic device-uptime seconds, a level
token (so LOGAN's level detection / filtering works), then the decoded message
(which already starts with `[pid:tid:uid]`). Everything downstream — virtual
scroll, search, filter, Trends, time-gaps, the MCP agent — works unchanged because
it only ever sees normalized text.

A single 10 MB file decodes to ~33–35 k records in ~1 s. A full 78-file capture is
~3.2 M records.

---

## 2. How the integration works (adapter layer)

LOGAN's `SourceAdapter` layer (`src/main/sourceAdapter.ts`) sits in front of the
format-agnostic `FileHandler` indexer. An adapter's only job is to turn its bytes
into UTF-8, newline-delimited text; indexing/search/random-access are never
reimplemented. `vtrace` follows the exact shape of the existing **MF4** adapter:

| Piece | File | Role |
|-------|------|------|
| `VtraceAdapter` | `src/main/sourceAdapter.ts` | `detect()` by extension + identity magic; `normalize()` spawns the worker, returns the temp `.norm` path + `cleanup()` |
| Worker entry | `src/main/vtraceWorker.ts` | runs the decode off the Electron main/UI thread; relays `progress`/`done`/`error` |
| Decoder core | `src/main/vtraceParse.ts` | `decodeVtrace(buf, emit)` and `parseVtraceToFile(in, out, onProgress)` |
| Tests | `src/tests/vtraceAdapter.test.ts` | fixture builder + cases for detect, decode, sequence-based timestamp repair (spike-under-ceiling + self-heal), newline folding, normalize output, in-message + loggertime-sidecar wall-clock anchors |

Registration (most-specific first, text fallback last):

```ts
export const adapterRegistry: SourceAdapter[] = [
  jsonlAdapter, protobufAdapter, mf4Adapter, vtraceAdapter, textAdapter,
];
```

Because everything routes through the registry, there is **no UI work**: the
"Open as…" override menu, progress bar, and capabilities (binary / no-append /
no-schema) are all driven by the adapter interface. `tsc` compiles
`vtraceWorker.ts` → `dist/main/vtraceWorker.js`, which the adapter loads by path
(same as `mf4Worker.js`); no build-config change is needed.

### Why a worker thread
The decode is a CPU-bound byte scan over the whole file. Running it inline would
block the UI for ~1 s/file. The worker keeps the main loop responsive and streams
progress, identical to MF4.

---

## 3. The binary format (reverse-engineered)

A file is a record stream. The opening section defines an entity model (channel
names) and identity; after it come the trace-message records. Every message record
ends with a fixed 39-byte tail, measured back from the start of its UTF-8 text `T`
(all multi-byte fields big-endian):

```
T-39 .. T-31 : uint64 timestamp      ns monotonic uptime (full 64-bit, big-endian)
T-31 .. T-27 : uint32 payload_length == strlen + 35            ← invariant #2
T-27         : uint8  type           0x04 = trace message      ← invariant #1
T-26 .. T-18 : uint64 message id / sequence number
T-18 .. T-16 : uint16 level          0=CRITICAL … 4=DEBUG
T-16         : uint8  marker         0x20                      ← invariant #3
T-16 .. T-4  : packed pid/tid/uid (also present inline in the text)
T-4  .. T    : uint32 strlen
T    .. T+L  : message text, e.g. "[pid:tid:uid] message …"
```

**Validation / robustness.** A candidate offset is accepted only when all four
invariants hold *and* the text is ≥90 % printable (TAB/CR/LF allowed). That makes
false positives effectively impossible, so the scanner can **resync** by stepping
forward one byte after any miss — interleaved non-message records never desync it.

**Timestamp is a full uint64 ns uptime, repaired against the SEQUENCE — not a cap.**
Two earlier revisions failed by validating each read against an absolute magnitude and
then forcing monotonicity with a `max()`-clamp:

1. A 40-bit ceiling (`rawTs > 0xFF_FFFF_FFFF` = "overflow") — but 2^40 ns is only
   **~18.3 minutes**, so on any longer capture every genuine timestamp was rejected and
   the stream **froze on the last sub-18-min value**. Raising the ceiling fixed this
   case but not the mechanism.
2. The `max()`-clamp itself (`ts < lastTs ? lastTs : ts`). It trusts *every* read as an
   upper bound, so a single garbage-high read that slips **under** the ceiling becomes
   `lastTs` and floors every following record to it — a **permanent freeze** no ceiling
   can prevent.

The fix is **sequence-based repair** (`repairTs` over a `TsRepairState`). The only
absolute bound left is a representability guard (finite, ≥ 0, ≤ `Number.MAX_SAFE_INTEGER`
≈ 104 days of ns); which reads to *trust* is decided by the recent sequence:

- a read within one step (`MAX_STEP`, 1 h) of the floor is accepted;
- a lone outlier — a spike above, or a backward read below — is held at the last trusted
  value (one carried line) and never becomes the floor;
- a **sustained** shift (`RESYNC_RUN` = 3 consecutive consistent reads) is confirmed and
  adopted, whether higher (a real long gap) or lower (recovery from a floor a bad read
  poisoned). So the floor **self-heals** — no single read can latch it. See the
  `repairTs (sequence-based)` tests, incl. the spike-under-ceiling and self-heal cases.

---

## 4. Timestamps & absolute wall-clock

The record timestamp is the device `CLOCK_MONOTONIC` in ns — the same value that
appears inline in messages as `monotonicTimestamp=…`. On its own that's device
uptime, not a calendar date.

**In-message anchor (implemented).** Some messages carry BOTH an absolute
`timestamp=<epoch-ms>` and a `monotonicTimestamp=<ns>`. One such pair pins
uptime-0 to epoch:

```
epoch0_ms = timestamp_ms − monotonicTimestamp_ns / 1e6
line_time = epoch0_ms + record_uptime_ns / 1e6   →  "YYYY-MM-DD HH:MM:SS.mmm"
```

`findEpochAnchorMs(buf)` (`vtraceParse.ts`) scans for the first such pair —
early-exiting at the usual boot/session banner near the file head — with a
plausibility window (2001–2096) that rejects unit mismatches. When it resolves,
every emitted line is prefixed with a real date, so LOGAN's timestamp parser,
time-gaps and the ⏱ timeline all operate on wall-clock time. When it doesn't
(no anchor message in that file), the decoder falls back to the relative
device-uptime seconds it has always emitted — nothing breaks.

**Sidecar anchor (implemented).** The capture *bundle* also carries a `loggertime`
sidecar — a small JSON holding a **two-point linear map** `{x1,y1,x2,y2}` from the
record timebase to epoch-ms, which is what the **official exporter** uses to date its
output. It lives in the **same folder as the `.esotrace` files** (the exporter's
layout; a `loggertime/` subfolder is accepted as a fallback). Because it has *two*
calibration points it recovers both the origin and the slope, so it also corrects
clock **drift** (a slope that isn't exactly the nominal `1 ns = 1e-6 ms`):

```
slopeMsPerNs = (y2 − y1) / (x2 − x1)          // epoch-ms per record nanosecond
epoch0_ms    = y1 − x1 · slopeMsPerNs         // wall-clock at record uptime 0
line_time    = epoch0_ms + record_ns · slopeMsPerNs
```

`findSidecarAnchor(filePath)` (`vtraceParse.ts`) discovers + parses it; `parseVtraceToFile`
calls it automatically, so **all three decode paths** (open-file adapter, the single-file
decode button, and the folder batch-decode) get sidecar dates with no per-caller wiring.
Resolution precedence (`resolveWallClockAnchor`): an explicit `opts.epochMsAnchor`
override → the **sidecar** (cross-checked against any in-message pair — if they disagree
by more than a few seconds the sidecar's x-axis is a different clock, so the provably-
correct in-message anchor wins) → the in-message `timestamp`/`monotonicTimestamp` pair →
relative seconds. Two guards make a mis-shaped or wrong-unit sidecar a safe no-op (it
falls back, never a wrong date): the derived `epoch0` must land in the plausible epoch-ms
window, and the slope must sit within a few percent of the nominal `1e-6`.

> **Assumption to confirm against a real bundle:** the sidecar's `x` axis is treated as
> the record `CLOCK_MONOTONIC` ns timebase. If a real `loggertime_*.json` uses a different
> unit or a distinct logger clock, the slope/agreement guards make it fall back safely,
> and the exact schema/units can be locked from the sample.

The bundle also carries `session.json` / `segments.json` (session boundaries + 1-second
segments) and `de.esolutions.fw.tools.trace.versioninfo/` (per-app versions) — not yet
consumed.

### Level mapping caveat
`level` (uint16) is a 0–4 enum; the names `CRITICAL/ERROR/WARNING/INFO/DEBUG` are a
**best guess** that fits the observed frequency distribution but has not been
confirmed against a vendor spec. Adjust `VTRACE_LEVELS` in `vtraceParse.ts` if the
canonical mapping is established. The numeric value is preserved either way.

---

## 5. Standalone parser

`vtrace_parse.py` (kept alongside the captures, not in this repo) decodes the same
format without LOGAN — useful for grep/CI pipelines:

```bash
python3 vtrace_parse.py log_0000.esotrace                 # one file -> stdout
python3 vtrace_parse.py *.esotrace -o session.log         # merge, time-ordered
python3 vtrace_parse.py *.esotrace --ndjson -o out.ndjson
python3 vtrace_parse.py *.esotrace --level ERROR          # min-level filter
```

It shares the exact record logic with `vtraceParse.ts`, so output matches the
adapter line-for-line.

---

## 6. Try it

```bash
npm run build && npm test -- vtraceAdapter      # 38 tests
# then in the app: File ▸ Open ▸ log_0000.esotrace  (auto-detected)
```
