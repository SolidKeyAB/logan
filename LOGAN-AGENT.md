# LOGAN Agent Integration

LOGAN exposes a chat interface and a full log-analysis API that AI agents can use. There are three ways to integrate:

| Audience | How it works |
|---|---|
| **MCP clients** (Claude Code, Cursor, etc.) | Tools auto-discovered via `.mcp.json` — just open the project |
| **Custom scripts** (bash, Node, Python) | Hit the HTTP API directly or use the `logan-listen` CLI helper |
| **Single-shot CLI** | One-off commands via `logan-listen.js --send` |

## Prerequisites

1. LOGAN is running with a file open
2. LOGAN writes its port to `~/.logan/mcp-port` on startup (default `19532`)

---

## A. MCP Clients (Claude Code, Cursor, etc.)

If you open the LOGAN project in an MCP-aware editor, the tools are automatically available via `.mcp.json`. No setup needed.

### Chat Loop Pattern

The key tools for interactive chat are:

| Tool | Purpose |
|---|---|
| `logan_send_message` | Send a message to the user (appears in LOGAN's Chat tab) |
| `logan_wait_for_message` | Block until the user replies (or timeout) |

A typical agent conversation looks like this:

```
1. logan_send_message("Hi! I can analyze this log. What would you like to know?")
2. logan_wait_for_message(timeout=120)
3. If response contains "stop"/"bye"/"exit"/"quit" → send goodbye, stop
4. Process the user's request using other logan_* tools
5. logan_send_message("Here's what I found: ...")
6. Go to step 2
```

### Example MCP Tool Call Sequence

```jsonc
// Step 1: Greet
{"tool": "logan_send_message", "arguments": {"message": "Hi! Ask me anything about this log."}}

// Step 2: Wait for user input
{"tool": "logan_wait_for_message", "arguments": {"timeout": 120}}
// Returns: {"message": "what errors are there?", "timestamp": 1708900000000}
// Or:      {"timeout": true}

// Step 3: Do the work
{"tool": "logan_triage", "arguments": {"redact": true}}

// Step 4: Send results back
{"tool": "logan_send_message", "arguments": {"message": "Found 42 errors, mostly in AuthModule. ..."}}

// Step 5: Wait again
{"tool": "logan_wait_for_message", "arguments": {"timeout": 120}}
```

### All Available MCP Tools

**Chat:**
`logan_send_message`, `logan_wait_for_message`, `logan_get_messages`

**Core:**
`logan_status`, `logan_open_file`, `logan_get_lines`, `logan_search`, `logan_navigate`

**Analysis:**
`logan_analyze`, `logan_triage`, `logan_investigate_crashes`, `logan_investigate_component`, `logan_investigate_timerange`, `logan_time_gaps`

**Annotations:**
`logan_add_bookmark`, `logan_bookmarks`, `logan_remove_bookmark`, `logan_update_bookmark`, `logan_clear_bookmarks`,
`logan_highlight`, `logan_highlights`, `logan_remove_highlight`, `logan_update_highlight`, `logan_clear_highlights`

**Notes:**
`logan_get_notes`, `logan_save_notes`

**Baselines:**
`logan_baseline_save`, `logan_baseline_list`, `logan_baseline_compare`, `logan_baseline_delete`, `logan_compare_baseline`

**Filter:**
`logan_filter`, `logan_clear_filter`

---

## B. Custom Scripts (Bash, Node, Python)

For agents that aren't MCP clients, you can use the HTTP API directly or the `logan-listen` CLI helper.

### Option 1: CLI Helper (`logan-listen.js`)

Build first: `npm run build` (produces `dist/mcp-server/logan-listen.js`)

```bash
# Send a message to the user
node dist/mcp-server/logan-listen.js --send "Hello from my agent!"

# Wait for the user to reply (blocks up to 120s by default)
node dist/mcp-server/logan-listen.js

# Wait with custom timeout
node dist/mcp-server/logan-listen.js --timeout 300
```

Output is always a single JSON line:
- Send: `{"success": true}`
- Listen: `{"message": "user's text", "timestamp": 1708900000000}`
- Timeout: `{"timeout": true}`

### Option 2: HTTP API Directly

All endpoints are on `http://127.0.0.1:<port>` where `<port>` is read from `~/.logan/mcp-port`.

See ready-to-run examples:
- **Bash**: [`examples/agent-bash.sh`](examples/agent-bash.sh)
- **Node.js**: [`examples/agent-node.mjs`](examples/agent-node.mjs)

---

## C. API Reference

### Chat Endpoints

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/agent-message` | POST | `{"message": "..."}` | Send a message as the agent |
| `/api/events` | GET | — | SSE stream — receives `event: message` with `{"from":"user","text":"..."}` |
| `/api/messages` | GET | — | Chat history (optional `?since=<timestamp>`) |
| `/api/user-message` | POST | `{"message": "..."}` | Send a message as the user (for testing) |
| `/api/agent-status` | GET | — | `{"connected": true/false, "count": N}` |

### Log Analysis Endpoints

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/status` | GET | — | Current file, line count, filter/bookmark state |
| `/api/open-file` | POST | `{"filePath": "..."}` | Open a log file |
| `/api/get-lines` | POST | `{"startLine": 0, "count": 100}` | Read lines from current file |
| `/api/search` | POST | `{"pattern": "...", "isRegex": false, ...}` | Search current file |
| `/api/analyze` | POST | `{"analyzerName": "..."}` | Run analysis |
| `/api/filter` | POST | `{"levels": [...], "includePatterns": [...]}` | Apply filter |
| `/api/clear-filter` | POST | — | Remove filter |
| `/api/navigate` | POST | `{"lineNumber": 0}` | Scroll LOGAN to a line |
| `/api/time-gaps` | POST | `{"thresholdSeconds": 30}` | Find timestamp gaps |
| `/api/investigate-crashes` | POST | `{"contextLines": 10, ...}` | Crash deep-dive |
| `/api/investigate-component` | POST | `{"component": "..."}` | Component health |
| `/api/investigate-timerange` | POST | `{"startTime": "...", "endTime": "..."}` | Time window analysis |

### Bookmark & Highlight Endpoints

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/bookmark` | POST | `{"lineNumber": 0, "label": "...", "color": "#ffff00"}` | Add bookmark |
| `/api/bookmarks` | GET | — | List bookmarks |
| `/api/bookmark-remove` | POST | `{"id": "..."}` | Remove bookmark |
| `/api/bookmark-update` | POST | `{"id": "...", "label": "...", "color": "..."}` | Update bookmark |
| `/api/bookmark-clear` | POST | — | Clear all bookmarks |
| `/api/highlight` | POST | `{"pattern": "...", "backgroundColor": "#ffff00", ...}` | Add highlight |
| `/api/highlights` | GET | — | List highlights |
| `/api/highlight-remove` | POST | `{"id": "..."}` | Remove highlight |
| `/api/highlight-update` | POST | `{"id": "...", ...}` | Update highlight |
| `/api/highlight-clear` | POST | — | Clear all highlights |

### Notes Endpoints

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/notes` | GET | — | Read notes for current file |
| `/api/notes` | POST | `{"content": "..."}` | Save notes for current file |

### Baseline Endpoints

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/baselines` | GET | — | List saved baselines |
| `/api/baseline-save` | POST | `{"name": "...", "description": "...", "tags": [...]}` | Save baseline |
| `/api/baseline-compare` | POST | `{"baselineId": "..."}` | Compare against baseline |
| `/api/baseline-delete` | POST | `{"baselineId": "..."}` | Delete baseline |

---

## Stop Convention

There is no forced kill mechanism. The convention is:

- The user types **"stop"**, **"bye"**, **"exit"**, or **"quit"** in the Chat tab
- The agent checks the message and exits the loop gracefully
- LOGAN's Chat tab shows a hint: *"Type 'stop' to end the session"*

## Connection Indicator

When an agent connects via SSE (`/api/events`), LOGAN's Chat tab shows a green dot with "Agent connected". When the agent disconnects, it returns to a grey dot.
