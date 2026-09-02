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
296.004473 L2 [4532:4532:1310123] [valhalla]: Using simple cache
296.005975 L1 [4532:4532:1310123] Coordinator Animate camera ...
```

`<uptime-seconds> L<level> <message>` — the **raw** monotonic device-uptime in
seconds, the **raw numeric level** as `L<n>`, then the decoded message (which
already starts with `[pid:tid:uid]`). The decoder emits only what it reads directly
from the record bytes: it does **not** synthesize a wall-clock date and does **not**
assign severity names (see §4). Everything downstream — virtual scroll, search,
filter, Trends, time-gaps, the MCP agent — works unchanged because it only ever sees
normalized text.

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
| Tests | `src/tests/vtraceAdapter.test.ts` | fixture builder + cases for detect, decode, raw uint64-ns verbatim emission (no repair/clamp), UTF-8 handling, newline folding, and normalize output |

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
T-18 .. T-16 : uint16 level          raw numeric level (emitted as "L<n>"; see §4)
T-16         : uint8  marker         0x20                      ← invariant #3
T-16 .. T-4  : packed pid/tid/uid (also present inline in the text)
T-4  .. T    : uint32 strlen
T    .. T+L  : message text, e.g. "[pid:tid:uid] message …"
```

**Validation / robustness.** A candidate offset is accepted only when all four
invariants hold *and* the text is ≥90 % printable (TAB/CR/LF allowed). That makes
false positives effectively impossible, so the scanner can **resync** by stepping
forward one byte after any miss — interleaved non-message records never desync it.

**Timestamp is the raw uint64 ns uptime, emitted verbatim.** The full 8-byte value
at `T-39` is read as `hi·2^32 + lo` and passed straight through (`rawTs / 1e9`, 6 dp).
There is **no repair, clamp or monotonicity fix-up**: whatever ns value the bytes
carry is what the line shows, in file order. (History: earlier revisions ran a
`repairTs`/`TsRepairState` sequence-repair pass — a 40-bit "overflow" ceiling, then a
`max()`-clamp, then a sequence-based self-healing floor — to force the stream
monotonic. Every variant was an *unverified reconstruction* of what the value "should"
be, so all of it was removed in favour of the honest raw read.)

---

## 4. Timestamps & levels — raw only, no derived ground truth

This decoder deliberately emits **only values it reads directly from the record
bytes**. It does **not** manufacture a wall-clock date and does **not** name the
severity level:

- **Time** is the raw monotonic device-uptime in seconds (e.g. `296.004473`), not a
  calendar date. The real wall-clock time — **`LOGGER_TIME`** — is a genuine field
  that lives in the `.idx` / `.esotrace` packet layout; it is **not yet decoded here**.
  Once that packet layout is known, `LOGGER_TIME` (and the rest of the real column set)
  can be read and exported directly, instead of being reconstructed from a guessed anchor.
- **Level** is the raw numeric value emitted as `L<n>` (e.g. `L2`). No
  `CRITICAL/ERROR/WARNING/INFO/DEBUG` name is assigned, because that mapping was never
  confirmed against a vendor spec.

> **Removed as unverified reconstructions:** an in-message
> `timestamp=`/`monotonicTimestamp=` anchor, a `loggertime` two-point sidecar map with
> plausibility/agreement guards, and a best-guess level-name table (`VTRACE_LEVELS`).
> These synthesized a wall-clock date and severity names that could not be verified
> without real capture bytes. The path forward is to read the **real** `LOGGER_TIME`
> field from the packet layout — see §5 for the authoritative source of that layout.

The capture *bundle* also carries `session.json` / `segments.json` (session boundaries
+ 1-second segments) and `de.esolutions.fw.tools.trace.versioninfo/` (per-app
versions) — not yet consumed.

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

It shares the exact record logic with `vtraceParse.ts`. It is also the
**authoritative source of the packet layout** — the real `LOGGER_TIME` field offset
and the full column set (§4). Reconciling `vtraceParse.ts` against it (or a real
sample bundle) is what will let LOGAN export those real columns instead of the raw
uptime/`L<n>` fallback it emits today.

---

## 6. Try it

```bash
npm run build && npm test -- vtraceAdapter      # 10 tests
# then in the app: File ▸ Open ▸ log_0000.esotrace  (auto-detected)
```
