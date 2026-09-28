# LOGAN as a training-data flywheel — usage → local adaptive model

**Status:** Design only — awaiting P0 greenlight.
**Origin:** 2026-09-23 conversation with Özge. The vision: *make LOGAN an
infrastructure so that AI usage becomes input for training a **local** model, then
turn that into a continuously-adapting AI model "as easy as possible."* This doc is the
architecture for that, and the staged build order.

---

## The idea — a flywheel

LOGAN is already an *environment* (in the RL sense): an AI drives it through MCP tools,
produces findings, and a human judges them. Today that experience is spent and thrown
away. The flywheel keeps it:

```
   ┌────────────────────────────────────────────────────────────┐
   │                                                            ▼
 model drives LOGAN ──▶ trajectories + human verdicts ──▶ labeled corpus
   ▲                                                            │
   │                                                            ▼
 redeploy (local-llm) ◀── fine-tuned adapter ◀── local SFT / DPO train
```

Every investigation becomes a supervised example: *what the model saw → what tool it
called → what happened → whether the human kept the result.* Fine-tune a small **local**
model on that, serve it locally, let it drive LOGAN, and the loop spins. "Adaptive" =
the loop runs on a schedule with minimal friction; the model gets better at *your* logs.

The differentiator vs. generic agent-tuning: **LOGAN both generates AND labels the
experience, and it already owns a deterministic eval** (the requirements-manifest). Data,
labels, and evaluation live in one place.

---

## Why LOGAN is the right substrate (principle)

- **Model-agnostic already.** The agent is just an MCP client; a local model behind an
  MCP-capable runner gets the identical `logan_*` toolset. Swapping the driver is a
  config change, not a rebuild.
- **Logs are semi-self-labeling.** Severity, crashes, first-fatal line, time gaps are
  ground-truth signals LOGAN already computes — cheap objective reward alongside the
  human's subjective verdict.
- **The human is already in the loop.** Analysts pin, tick off, and dismiss findings
  today. That interaction *is* the label — it just isn't captured durably yet.
- **Deterministic-first culture.** LOGAN does the volume work natively and hands the
  model a distilled artifact (evidence-pack, trends). The trajectory is therefore short
  and structured — ideal to imitate — not 20 raw-text round-trips. (See
  `docs/GRANULARIZATION_DESIGN.md`.)

---

## What already exists vs. the gap

### Already captured (reuse — don't build)

| Stream | Where | What it holds |
|---|---|---|
| **Investigation journal** | `api-server.ts` (`INVESTIGATIVE_PATHS`, `agentJournal`) | Every investigative tool call as `{ path, body, ts, label, result }` — the **trajectory**: action (`path`+`body`) → observation (`result` summary), timestamped, plus `journalFiles` (which logs/types it ran on). Capped at 200, in-memory. |
| **Reusable procedures** | `logan_save_investigation` → `InvestigationTemplate` | A journal already condensable into a named, re-runnable recipe — an *expert demonstration*, essentially free SFT data. |
| **Activity / usage log** | `logActivity()` → `~/.logan/usage.json` (`ActivityEntry`) | A second telemetry stream (human + AI paths both feed it): `file_opened`, `search`, `analysis_run`, `summarize`, … with ISO timestamp + details. |
| **Human judgement** | `Annotation` (`types.ts`) | Findings pinned by the agent (`handoffId`, `severity`, `detail`, `suggestedAction`) with a `done` tick-off in the handoff worklist. This is *where* the label is produced. |
| **Deploy socket** | `AgentConfig.type: 'local-llm'` (`index.ts`), `llmEndpoint`/`llmModel` | LOGAN **already has a local-LLM agent type** in config + setup wizard. The deploy end of the loop is largely wired. |
| **Eval** | requirements-manifest + `logan_check_investigation` / `logan_run_investigation` | A held-out log + expected entities = a deterministic pass/fail gate for a tuned model. |

### The gap (what turns usage into training infra)

1. **Durable labels.** The human verdict is UI-only and weak (`done` = "worked through
   it," not "this was correct"). We have no stored *kept / dismissed / edited(+correction)
   / confirmed-critical* verdict, and no link from a finding back to the **journal slice
   that produced it**. Without that provenance + verdict, there is no reward signal.
2. **Corpus export.** No command folds journal + evidence state + finding + verdict into
   standard training examples. The journal is also ephemeral (in-memory, capped, cleared).
3. **Train harness.** No bundled local fine-tune recipe over the corpus.
4. **The loop.** No scheduled re-train / redeploy; the local-llm path exists but the
   "train on my usage → serve → repeat" cycle isn't closed.

---

## What one training example looks like

A single example = one investigation trajectory rendered as a tool-calling trace with an
outcome label. JSONL, OpenAI-style `messages` (the format nearly every local SFT/LoRA
trainer ingests):

```jsonc
{
  "log_fingerprint": { "levels": {"error": 812}, "firstFatal": 40213, "env": {"build":"4.2.1"} },
  "messages": [
    { "role": "system", "content": "You are a log-analysis agent. Tools: logan_search, logan_evidence_pack, ..." },
    { "role": "user", "content": "Why did playback abort around 14:22?" },
    { "role": "assistant", "tool_calls": [{ "name": "logan_evidence_pack", "arguments": {} }] },
    { "role": "tool", "content": "<compact evidence summary: top components, crash groups, gaps>" },
    { "role": "assistant", "tool_calls": [{ "name": "logan_search", "arguments": {"pattern":"GW_TIMEOUT"} }] },
    { "role": "tool", "content": "17 matches; first viewerLine 8047" },
    { "role": "assistant", "tool_calls": [{ "name": "logan_report_finding",
        "arguments": {"lineNumber":8047,"title":"Gateway timeout aborts payment","severity":"error"} }] }
  ],
  "label": { "verdict": "kept", "human": true, "requirements_pass": true, "reached_first_fatal": true },
  "reward": 1.0
}
```

- **State** = `log_fingerprint` + the evidence/observation messages (what the model saw).
- **Action** = the `assistant` tool_calls (straight from the journal `path`+`body`).
- **Observation** = the `tool` messages (journal `result` summaries).
- **Label** = human verdict (kept/dismissed/edited) + objective signals (requirements
  pass, reached the known first-fatal). Preference pairs (for DPO) = the *kept* trajectory
  vs. a *dismissed* one on the same log.

---

## Architecture — four stages

**1. Capture** (≈70% done). Persist the journal per session to an append-only
`~/.logan/traces/<session>.jsonl` (today it's in-memory, capped, reset on clear). Stamp
each pinned finding with the journal index range that produced it (trajectory → finding
provenance). The activity log and annotations already persist.

**2. Curate + label.** A corpus builder folds a journal slice + evidence state + finding +
verdict into the JSONL above. A human review surface (reuse the handoff / Saved panel) sets
the verdict per finding. Curation = only export sessions with a verdict, dedupe by
trajectory shape, and a **mandatory redaction pass** (logs are sensitive; the corpus must
be scrubbed and stay local).

**3. Train.** LOGAN produces the dataset + an opinionated `train.sh` + config; the actual
fine-tune runs in an off-the-shelf trainer (LoRA/QLoRA on a small code/instruct base).
Start with **imitation** (SFT on human-approved traces) — cheapest, and demonstrations are
plentiful via `save_investigation`. Add **DPO** from kept-vs-dismissed pairs once labels
accumulate.

**4. Deploy + close the loop.** Serve the tuned adapter locally (ollama / vLLM), point
`AgentConfig` `type:'local-llm'` + `llmEndpoint` at it (wiring already exists), and it
drives LOGAN — generating fresh traces. A scheduled re-train + redeploy makes it adaptive.
"As easy as possible" = one **Training** panel (review verdicts → Export corpus → Train →
Use this model) + one script.

---

## Evaluation (the gate — reuse, don't invent)

A tuned model must **earn** deployment. Reuse the requirements-manifest as a deterministic
eval: a held-out set of logs, each with a saved investigation + expected findings. The
candidate model runs the task; it passes if it reproduces the known-good findings and
satisfies the manifests (`logan_check_investigation`). This guards against reward-hacking
and self-training drift — the model can't "improve" by inventing findings the eval rejects.

---

## Build order

**P0 — make the corpus real (this greenlight).** No training yet; prove the data is good.
- Persist the journal → `~/.logan/traces/<session>.jsonl`, with finding→trajectory provenance.
- Add a durable finding **verdict** (`kept | dismissed | edited | critical`) + correction text — agent verb **and** human control (parity).
- `logan_export_training_trace` (+ human "Export corpus" button) → the JSONL example format above.
- Mandatory redaction/scrub pass before anything is written out.
- *Deliverable:* a JSONL corpus you can open and read. Low-risk, additive — reads streams LOGAN already keeps.

**P1 — train + eval.** The SFT/LoRA recipe (dataset → `train.sh` → adapter) + the
requirements-manifest eval harness + a small reference corpus. *Deliverable:* one tuned
adapter that beats the base model on the eval.

**P2 — deploy path.** Setup-wizard "use my trained model," end-to-end `local-llm` wiring
verified, measured on held-out logs. *Deliverable:* the local model drives a real
investigation in LOGAN.

**P3 — autonomous flywheel.** DPO from kept/dismissed pairs + scheduled re-train + redeploy.
*Deliverable:* the loop runs itself; the model tracks your logs over time.

---

## Risks & open questions

- **Privacy is the hard constraint.** Logs carry sensitive data. Redaction before export is
  mandatory, and the whole pipeline stays local — which is exactly aligned with "local
  model," so the goal and the constraint pull the same way.
- **Cold start / volume.** One analyst's usage is thin. Mitigate with (a) `save_investigation`
  templates as expert demonstrations, (b) synthetic replay (run recipes across many logs to
  generate traces), (c) pooling scrubbed team traces.
- **Label noise.** `done` ≠ "correct." Treat tick-off as a weak signal; rely on the explicit
  verdict + objective signals for reward.
- **Distribution shift / self-training drift.** A model trained on its own traces can spiral.
  The human-verdict gate + the requirements eval are the guardrails; never deploy on eval
  regression.
- **Small-model tool-calling.** Weak local models may need heavier scaffolding to call tools
  reliably — this composes with the earlier *adaptive tool-surface / capability-tier* idea
  (curate the toolset + guidance to the driver). The two designs reinforce each other.
- **Scope.** This is a multi-increment arc; only **P0** is a commitment now. Everything after
  is gated on P0 producing a corpus that visibly looks trainable.
