# Investigation Templates (Re-runnable Patterns)

Capture the sequence of investigative steps taken for a ticket — by you or the AI
agent — and replay it on a new log in one click.

## What gets captured

Every investigative tool call the agent makes flows through LOGAN's local API
server, which records an ordered **journal**:

- `search`, `filter` / `clear-filter`
- `analyze`, `time-gaps`
- `trend-fields` / `trend-series` / `trend-transitions` / `trend-correlate` / `trend-show`
- `investigate-crashes` / `investigate-component` / `investigate-timerange`
- `triage`, `navigate`

Pure chat/status calls are not recorded. Replays are tagged so they don't
re-pollute the journal.

## Saving a pattern

A pattern is the journal serialised to disk at
`~/.logan/investigate-templates/<slug>.json`, with values like `component`,
`field`, `pattern`, `event`, `analyzerName`, and `thresholdSeconds` promoted to
**fill-in parameters** (their captured value becomes the default).

Two ways to save:

- **Investigate panel** → **💾 Save current** → name it.
- **Ask the agent**: "save these steps as a template called *Auth token-expiry*"
  → the agent calls `logan_save_investigation`.

## Replaying

- **Investigate panel** → click **▶ <name>** under *Saved patterns*. Each step
  re-runs on the current log; a per-step result summary is shown.
- **Ask the agent**: "run the *Auth token-expiry* pattern here, component=auth"
  → `logan_run_investigation` with `params` overrides.

## Agent (MCP) tools

| Tool | Purpose |
|------|---------|
| `logan_get_investigation_log` | Show the ordered steps recorded this session (the logic followed) |
| `logan_save_investigation` | Save the recorded steps as a named, parameterised template |
| `logan_list_investigations` | List saved patterns with their steps + params |
| `logan_run_investigation` | Replay a pattern by name on the current log (optional `params`) |

## How replay works

`runInvestigation` re-issues each recorded step as an internal HTTP call to the
same api-server, so all existing endpoint logic (including finding-pinning in the
viewer) is reused. Param overrides are applied to the matching step bodies before
replay.

## Architecture

- Journal + endpoints: `src/main/api-server.ts`
- Template model + disk CRUD + param resolution: `src/main/investigationStore.ts`
- Panel UI: Investigate tab in `src/renderer/renderer.ts` (`loadInvestigationTemplates`, `runInvestigationTemplate`, `saveCurrentInvestigation`)
- IPC: `INVESTIGATION_LIST` / `_SAVE` / `_RUN` / `_DELETE` (+ `investigation-templates-changed` push)
