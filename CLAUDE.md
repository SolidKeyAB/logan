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
| `logan_report_finding` | **Pin a finding**: annotate + navigate + chat message in one call |
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
