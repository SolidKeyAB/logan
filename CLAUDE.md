# LOGAN — Log Analyzer

LOGAN is an Electron-based log analysis tool with an integrated AI agent interface.

## Agent Communication

You can communicate with the LOGAN user through its built-in Chat panel. The MCP server is configured in `.mcp.json` at the project root.

### Chat Loop Pattern

Use this pattern for interactive conversations with the LOGAN user:

```
1. logan_send_message("Hello! How can I help?")
2. response = logan_wait_for_message(timeout=120)
3. Process response, reply with logan_send_message(...)
4. Repeat from step 2 until user says goodbye
```

### Session Memory — persist context across reconnects

LOGAN gives each open log a small **per-file agent-memory scratchpad** (stored at `.logan/<file>.agent-memory.json`, surfaced in the Chat panel's memory bar). It is **NOT** filled automatically — it stays empty until you write to it. Use it so you can resume naturally if the session drops and reconnects.

- **At the start** of a session (and after any reconnect), call `logan_memory_read` to recall what a prior session established.
- **After each significant finding or task**, call `logan_memory_write(content=...)` with a brief note of what the user asked and what you found. Each write **replaces** the previous note — write the full running summary, not just a delta.
- Memory is **per-file**: it's keyed to the currently open log, so a note written while one file is open won't appear when a different file is open. Writing with no file open is a no-op.

> If the memory bar "keeps empty," it's almost always because no agent ever called `logan_memory_write` — the plumbing round-trips fine, it just isn't automatic.

### Surfacing Findings — CRITICAL RULE

**Whenever you identify a specific critical point, anomaly, or root cause in the log, you MUST call `logan_report_finding` to pin it in the viewer.** Do NOT just describe findings in chat text — call `logan_report_finding` first, then follow up with explanation. This creates a visible annotation in the log viewer so the user can click to navigate directly to the issue.

```
# Every finding = one logan_report_finding call
# ALWAYS set clearPrevious=True on the FIRST finding of a new analysis
# Line numbers are 1-based (as displayed in viewer) — use viewerLine from search/get-lines
logan_report_finding(
  lineNumber=8047,          # 1-based viewer line (= viewerLine from search result)
  endLine=9252,             # optional: 1-based end line for ranges
  title="Auth abort race",  # short label shown in annotation bar
  detail="Full explanation sent to chat...",
  severity="error",         # error | warning | info
  clearPrevious=True        # set True on first finding to clear stale annotations
)
```

### Line Number Convention

**All line numbers in LOGAN tools are 1-based (same as displayed in the viewer).**

- `logan_search` and `logan_get_lines` return both `lineNumber` (0-based, internal) and `viewerLine` (1-based, as shown in viewer)
- **Always use `viewerLine`** when passing to `logan_report_finding`, `logan_annotate`, `logan_navigate`
- Example: if search returns `viewerLine: 8047`, pass `lineNumber: 8047` to the annotation tools

Use `logan_report_finding` for each distinct finding, then send a summary via `logan_send_message` if needed.

### Key MCP Tools

| Tool | Purpose |
|------|---------|
| `logan_status` | Check if file is open, get line count and state |
| `logan_single_session` | Combine 2+ files into one session and open it. `order:"sequential"` (default) = virtual read-only concatenation, nothing written (🔗 button). `order:"wallclock"` = **interleave by timestamp** into a materialized merged file and open it — for correlating across sources ("what did B log at the moment A errored?"); parity with the "⬇ Merge to file" button |
| `logan_evidence_pack` | **Fetch FIRST**: one compact briefing (severity, levels, grouped crashes, top components/gaps, discovered field vocabulary, filter hints, optional baseline delta, + any attached **env** context) as `viewerLine` refs + counts — not raw text. Drill down from it instead of many exploratory calls |
| `logan_context_attach` / `logan_context_read` | Attach / read the **static environment** the log was captured under — build id, firmware, device, feature flags, config — as typed key→value facts (with optional provenance). `attach` merges by default (`replace:true` overwrites; blank value deletes a key). Stored as a per-file sidecar and **auto-injected** into `logan_evidence_pack` (env up front), `logan_save_report` (an Environment section), and baseline fingerprints (a build/firmware change is reported as an info **env-diff**, not a false anomaly). The "logs + env" context — attach it once at the start when you know the build/firmware/flags |
| `logan_report_finding` | **Pin a finding**: annotate + navigate + chat message in one call |
| `logan_import_findings` | **Hand off a BATCH of findings in one call**: each becomes a clickable annotation grouped under a named "handoff" the user reviews + ticks off in the AI Annotations panel. Prefer over many `logan_report_finding` calls when transferring a whole investigation for the user to continue in LOGAN |
| `logan_send_message` | Send chat message to user (for summaries, questions, greetings) |
| `logan_wait_for_message` | Block until user replies (SSE-backed) |
| `logan_get_messages` | Fetch chat history |
| `logan_get_lines` | Read specific lines from the log |
| `logan_search` | Search for patterns in the log |
| `logan_analyze` | Run full log analysis (levels, timestamps, crashes) |
| `logan_navigate` | Jump to a specific line in the viewer |
| `logan_filter` / `logan_clear_filter` | Filter log lines |
| `logan_add_bookmark` / `logan_bookmarks` | Manage bookmarks |
| `logan_highlight` / `logan_highlights` | Manage highlights |
| `logan_time_gaps` | Find time gaps in log timestamps |
| `logan_triage` | AI-guided triage of the log file |
| `logan_investigate_crashes` | Deep-dive into crash patterns |
| `logan_annotate` | Add annotation to a line/range (use logan_report_finding instead when possible) |
| `logan_baseline_save` / `logan_baseline_compare` | Save and compare baselines |
| `logan_get_notes` / `logan_save_notes` | Read/write freeform notes |
| `logan_memory_read` / `logan_memory_write` | Read / **replace** the per-file **session-memory** scratchpad (survives reconnects; shown in the Chat memory bar). Read at session start; write a brief running summary after each significant finding. Stays empty until you write — it is not automatic |
| `logan_save_report` | Save the investigation as LOGAN's universal **Log Analysis Report** (`.md` in `.logan/reports/`, see `docs/LOGAN_REPORT_FORMAT.md`): clear name + AIM + REASON + optional ticket; **each finding shows its real related log-line sequence** (match + context) with a description; a **Components — potentially responsible** section (agent-supplied or derived from the verdict) and an **Open questions** checklist; plus recorded steps and (opt-in) the root-cause verdict + evidence lines. Self-contained, Jira-paste-ready. Pin findings first |
| `logan_trend_fields` | Statically discover log variables (key=value, key: value, JSON) with inferred type/frequency — start here |
| `logan_trend_series` | Trend one field over time (adaptive time buckets + sampled points). Accepts a `pattern` regex for unlabeled values |
| `logan_trend_transitions` | Detect every value change ("flip") of a field — any type; great for "what changed before the bug" |
| `logan_trend_correlate` | Cross-tab a field by event presence ("when X fires, what is v vs when it doesn't") |
| `logan_trend_show` | Like the trend tools, but ALSO renders the chart as a cell in the user's Trends panel — call it (not the bare trend tools) when you want the user to SEE the trend; call repeatedly to build a vertical sequence. Booleans render as a 0/1 step line |
| `logan_get_investigation_log` | Return the ordered list of investigative tool calls recorded this session — i.e. the logic you followed; use to show the user your steps for a ticket |
| `logan_save_investigation` | Save the recorded steps as a NAMED, re-runnable template ("investigate pattern"); component/field/pattern/event become fill-in params |
| `logan_list_investigations` / `logan_run_investigation` | List saved patterns, or replay one by name on the current log (with optional `params` overrides) |

**Discoverable fields are typed** (numeric/boolean/string/array). Booleans (e.g. `isTokenExpired=false`) chart in the Trends panel as a 0/1 step line. Numeric MF4/log signals overlay in the **Signals** panel (shares the trend engine).

**Interrupting the agent:** the user can press **⏹ Stop** in the Chat panel. It does not kill the session — your next tool call returns a STOP instruction; acknowledge briefly and call `logan_wait_for_message`.

### Agent Setup Wizard

LOGAN includes a setup wizard (gear icon in Chat tab) that:
- Auto-detects Claude Code CLI, existing config, and built-in agent
- Supports three agent types: Claude Code (AI), Built-in, Custom Script
- Saves config to `~/.logan/agent-config.json`
- Launches the agent immediately after setup

### Important

- Always call `logan_status` first to check if a file is open
- **Always call `logan_report_finding` for each specific issue found** — never just describe line numbers in chat
- The MCP server auto-connects via SSE for real-time message delivery
- Only one agent can be connected at a time
- See `docs/AGENT_CHAT_GUIDE.md` for detailed integration docs

## Architecture

- Electron app: main process (`src/main/`), renderer (`src/renderer/`), preload (`src/preload/`)
- MCP server: `src/mcp-server/index.ts` (standalone Node.js process, stdio transport)
- API server: `src/main/api-server.ts` (HTTP on localhost:19532, bridges to IPC)
- Config stored in `~/.logan/` (global) and `.logan/` (per-file sidecar)
