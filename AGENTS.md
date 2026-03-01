# LOGAN Agent Integration

LOGAN supports AI agent integration through its local HTTP API and MCP server. Any agent can connect to analyze logs and chat with the user.

## Quick Start

| Your Agent Supports | What to Use | Setup |
|---------------------|-------------|-------|
| MCP (Claude Code, Cursor, Windsurf) | MCP tools | `.mcp.json` already configured — tools auto-discovered |
| HTTP calls (Copilot, Codex, custom) | REST API polling | Read endpoints below, poll every 2-3s |
| Persistent connections (scripts) | SSE stream | Connect to `/api/events` for real-time |

## Agent-Specific Files

| File | Agent | Description |
|------|-------|-------------|
| `.mcp.json` | MCP-compatible agents | MCP server config (auto-discovered) |
| `CLAUDE.md` | Claude Code | Project instructions + MCP tool reference |
| `.cursorrules` | Cursor | Agent instructions + MCP/HTTP reference |
| `.github/copilot-instructions.md` | GitHub Copilot | HTTP polling instructions + endpoints |
| `docs/AGENT_CHAT_GUIDE.md` | All agents | Full integration guide with code examples |
| `scripts/agent-chat-poll.py` | Any Python agent | Ready-to-run polling chat script |
| `scripts/agent-chat-sse.py` | Any Python agent | Ready-to-run SSE chat script |

## API Reference (http://127.0.0.1:19532)

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/agent-message | Send message: `{"message": "text"}` |
| GET | /api/messages?since=TS | Get messages after timestamp (ms) |
| GET | /api/events?name=Name | SSE stream (real-time, 1 agent max) |
| GET | /api/agent-status | Check if an agent is connected |

### Log Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/status | File info, line count, filter state |
| POST | /api/open-file | Open file: `{"filePath": "..."}` |
| GET | /api/lines?start=N&count=M | Read lines |
| POST | /api/search | Search: `{"pattern": "...", "maxResults": 50}` |
| POST | /api/analyze | Full analysis (levels, crashes, components) |
| POST | /api/navigate | Jump to line: `{"line": 123}` |
| POST | /api/filter | Filter: `{"pattern": "ERROR"}` |
| POST | /api/clear-filter | Remove filter |

### Bookmarks & Highlights

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/bookmarks | List bookmarks |
| POST | /api/add-bookmark | Add: `{"line": 123, "label": "..."}` |
| GET | /api/highlights | List highlights |
| POST | /api/add-highlight | Add: `{"pattern": "...", "color": "#ff0000"}` |

### Baselines

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/baselines | List saved baselines |
| POST | /api/baseline-save | Save: `{"name": "..."}` |
| POST | /api/baseline-compare | Compare: `{"baselineId": "..."}` |
| POST | /api/baseline-delete | Delete: `{"baselineId": "..."}` |

### Investigation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/investigate-crashes | Crash analysis with context |
| POST | /api/investigate-component | Component-specific investigation |
| POST | /api/triage | AI-guided triage |

## MCP Tools (33 tools)

When connected via MCP, these tools are auto-discovered:

**Core:** `logan_status`, `logan_open_file`, `logan_get_lines`, `logan_search`, `logan_analyze`, `logan_filter`, `logan_clear_filter`, `logan_navigate`

**Bookmarks:** `logan_add_bookmark`, `logan_remove_bookmark`, `logan_update_bookmark`, `logan_clear_bookmarks`, `logan_bookmarks`

**Highlights:** `logan_highlight`, `logan_remove_highlight`, `logan_update_highlight`, `logan_clear_highlights`, `logan_highlights`

**Analysis:** `logan_time_gaps`, `logan_triage`, `logan_investigate_crashes`, `logan_investigate_component`, `logan_investigate_timerange`

**Baselines:** `logan_baseline_save`, `logan_baseline_list`, `logan_baseline_compare`, `logan_baseline_delete`, `logan_compare_baseline`

**Notes:** `logan_get_notes`, `logan_save_notes`

**Chat:** `logan_send_message`, `logan_wait_for_message`, `logan_get_messages`
