# LOGAN Agent Chat Integration Guide

LOGAN supports real-time bidirectional chat between AI agents and the user through its built-in Chat panel. This guide covers three integration methods.

## See Also

- `AGENTS.md` — Quick-start overview with full API reference
- `CLAUDE.md` — Claude Code specific instructions
- `.cursorrules` — Cursor agent instructions
- `.github/copilot-instructions.md` — GitHub Copilot instructions
- `scripts/agent-chat-poll.py` — Ready-to-run polling chat script
- `scripts/agent-chat-sse.py` — Ready-to-run SSE chat script

## Prerequisites

- LOGAN must be running with a file open
- API server listens on `127.0.0.1:19532` (port written to `~/.logan/mcp-port`)

---

## Method 1: MCP Tools (Recommended)

For agents that support [Model Context Protocol](https://modelcontextprotocol.io) (Claude Code, Cursor, Windsurf, etc.).

### Setup

Add to your project's `.mcp.json`:
```json
{
  "mcpServers": {
    "logan": {
      "command": "node",
      "args": ["dist/mcp-server/index.js"],
      "cwd": "/path/to/log-analyzer"
    }
  }
}
```

### Chat Tools

| Tool | Description |
|------|-------------|
| `logan_send_message` | Send a message to the user (appears in LOGAN's Chat panel) |
| `logan_wait_for_message` | Block until the user replies (up to 300s timeout) |
| `logan_get_messages` | Get full chat history (optional `since` timestamp filter) |

### Chat Loop Example (agent pseudocode)

```
logan_send_message("Hello! How can I help with this log file?")
loop:
  response = logan_wait_for_message(timeout=120)
  if response.timeout:
    logan_send_message("Still here if you need me!")
    continue
  if response.message contains "goodbye":
    logan_send_message("Goodbye!")
    break
  # Process user message and reply
  logan_send_message(generate_reply(response.message))
```

The MCP server automatically maintains an SSE connection to LOGAN for real-time message delivery. It reconnects automatically if LOGAN restarts.

---

## Method 2: HTTP Polling (Copilot, Codex, custom agents)

For agents that can make HTTP calls but don't support MCP.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/agent-message` | Send a message: `{"message": "text"}` |
| `GET` | `/api/messages` | Get all messages |
| `GET` | `/api/messages?since=<timestamp_ms>` | Get messages after timestamp |
| `GET` | `/api/status` | Check if LOGAN is running and file is open |

### Polling Chat Loop (Python)

```python
import urllib.request, json, time

API = "http://127.0.0.1:19532"
last_ts = int(time.time() * 1000)

def send(text):
    data = json.dumps({"message": text}).encode()
    req = urllib.request.Request(
        f"{API}/api/agent-message",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    urllib.request.urlopen(req)

def poll(since):
    req = urllib.request.Request(f"{API}/api/messages?since={since}")
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read().decode())
    return [m for m in data.get("messages", []) if m["from"] == "user"]

# Chat loop
send("Hello from the agent!")
while True:
    time.sleep(2)  # Poll every 2 seconds
    new_msgs = poll(last_ts)
    for msg in new_msgs:
        last_ts = msg["timestamp"]
        print(f"User: {msg['text']}")
        if "goodbye" in msg["text"].lower():
            send("Goodbye!")
            exit()
        # Generate and send reply
        send(f"You said: {msg['text']}")
```

### Polling Chat Loop (Node.js)

```javascript
const API = "http://127.0.0.1:19532";
let lastTs = Date.now();

async function send(text) {
  await fetch(`${API}/api/agent-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });
}

async function poll(since) {
  const res = await fetch(`${API}/api/messages?since=${since}`);
  const data = await res.json();
  return data.messages.filter((m) => m.from === "user");
}

// Chat loop
await send("Hello from the agent!");
setInterval(async () => {
  const msgs = await poll(lastTs);
  for (const msg of msgs) {
    lastTs = msg.timestamp;
    console.log(`User: ${msg.text}`);
    await send(`You said: ${msg.text}`);
  }
}, 2000);
```

---

## Method 3: SSE (Server-Sent Events) — Real-time

For agents or scripts that can hold a persistent HTTP connection.

### Connect

```
GET http://127.0.0.1:19532/api/events?name=MyAgent
```

Returns `text/event-stream`. LOGAN pushes events as they happen:
- `event: connected` — connection established
- `event: message` — chat message (`data: {"from":"user","text":"...","timestamp":...}`)

**Note:** Only one agent can be connected via SSE at a time.

### SSE Chat Loop (Python)

```python
import urllib.request, json, sys, threading, time

API = "http://127.0.0.1:19532"

def send(text):
    data = json.dumps({"message": text}).encode()
    req = urllib.request.Request(
        f"{API}/api/agent-message",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    urllib.request.urlopen(req)

def listen():
    req = urllib.request.Request(f"{API}/api/events?name=MyAgent")
    resp = urllib.request.urlopen(req, timeout=300)
    buffer = ""
    for chunk in iter(lambda: resp.read(1).decode("utf-8", errors="replace"), ""):
        buffer += chunk
        if buffer.endswith("\n\n"):
            for line in buffer.strip().split("\n"):
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        if data.get("from") == "user":
                            print(f"User: {data['text']}")
                            # Reply
                            send(f"You said: {data['text']}")
                    except:
                        pass
            buffer = ""

send("Hello! Listening for your messages...")
listen()
```

### SSE Chat Loop (Node.js)

```javascript
import http from "http";

const API_PORT = 19532;

function send(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ message: text });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: API_PORT,
        path: "/api/agent-message",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", resolve);
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function listen() {
  http.get(
    `http://127.0.0.1:${API_PORT}/api/events?name=MyAgent`,
    (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let data = "";
          for (const line of lines) {
            if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (data) {
            try {
              const msg = JSON.parse(data);
              if (msg.from === "user") {
                console.log(`User: ${msg.text}`);
                send(`You said: ${msg.text}`);
              }
            } catch {}
          }
        }
      });
    }
  );
}

await send("Hello! Listening for your messages...");
listen();
```

---

## Agent System Prompt Template

Give this to non-MCP agents (Copilot, Codex) so they know how to interact:

```
You have access to LOGAN, a log analysis tool running locally.
To communicate with the user through LOGAN's chat panel:

- Send a message: POST http://127.0.0.1:19532/api/agent-message
  Body: {"message": "your text here"}

- Check for new messages: GET http://127.0.0.1:19532/api/messages?since=<timestamp_ms>
  Returns: {"messages": [{"from": "user", "text": "...", "timestamp": ...}]}

- Check status: GET http://127.0.0.1:19532/api/status

Other useful endpoints:
- POST /api/search {"pattern": "...", "maxResults": 50}
- POST /api/navigate {"line": 123}
- GET /api/lines?start=0&count=10
- POST /api/analyze
- POST /api/filter {"pattern": "ERROR"}
- POST /api/clear-filter

Always check status first. Poll /api/messages every 2-3 seconds during conversation.
```
