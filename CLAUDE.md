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

### Key MCP Tools

| Tool | Purpose |
|------|---------|
| `logan_status` | Check if file is open, get line count and state |
| `logan_send_message` | Send chat message to user |
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
| `logan_baseline_save` / `logan_baseline_compare` | Save and compare baselines |
| `logan_get_notes` / `logan_save_notes` | Read/write freeform notes |

### Important

- Always call `logan_status` first to check if a file is open
- The MCP server auto-connects via SSE for real-time message delivery
- Only one agent can be connected at a time
- See `docs/AGENT_CHAT_GUIDE.md` for detailed integration docs

## Architecture

- Electron app: main process (`src/main/`), renderer (`src/renderer/`), preload (`src/preload/`)
- MCP server: `src/mcp-server/index.ts` (standalone Node.js process, stdio transport)
- API server: `src/main/api-server.ts` (HTTP on localhost:19532, bridges to IPC)
- Config stored in `~/.logan/` (global) and `.logan/` (per-file sidecar)
