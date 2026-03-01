# LOGAN — Copilot Agent Instructions

LOGAN is an Electron log analysis tool running locally with an HTTP API for agent communication.

## Connecting to LOGAN

API base: `http://127.0.0.1:19532`

Check if LOGAN is running and a file is open:
```
GET /api/status
→ {"success": true, "status": {"filePath": "...", "totalLines": 14957, ...}}
```

## Chat with the User

LOGAN has a Chat panel where the user can see your messages and reply.

**Register as connected** (shows green dot in LOGAN, call once on start):
```
POST /api/agent-register
Content-Type: application/json
{"name": "Copilot"}
```

**Send a message** (also refreshes your connected status):
```
POST /api/agent-message
Content-Type: application/json
{"message": "Hello from Copilot!", "name": "Copilot"}
```

**Poll for user replies** (every 2-3 seconds):
```
GET /api/messages?since=<timestamp_ms>
→ {"messages": [{"from": "user", "text": "hi!", "timestamp": 1234567890}]}
```

Filter for `"from": "user"` messages only (ignore your own `"from": "agent"` messages).

### Chat Loop (Python)

```python
import urllib.request, json, time

API = "http://127.0.0.1:19532"
last_ts = int(time.time() * 1000)

def send(text):
    data = json.dumps({"message": text}).encode()
    req = urllib.request.Request(f"{API}/api/agent-message", data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req)

def poll(since):
    req = urllib.request.Request(f"{API}/api/messages?since={since}")
    resp = urllib.request.urlopen(req)
    return [m for m in json.loads(resp.read()).get("messages", []) if m["from"] == "user"]

send("Hello! I'm connected to LOGAN.")
while True:
    time.sleep(2)
    for msg in poll(last_ts):
        last_ts = msg["timestamp"]
        if "goodbye" in msg["text"].lower():
            send("Goodbye!")
            exit()
        send(f"Got it: {msg['text']}")
```

## Log Analysis Endpoints

| Action | Method | Endpoint | Body |
|--------|--------|----------|------|
| Register agent | POST | /api/agent-register | `{"name": "Copilot"}` |
| Get status | GET | /api/status | — |
| Open file | POST | /api/open-file | `{"filePath": "/path/to/file"}` |
| Get lines | GET | /api/lines?start=0&count=10 | — |
| Search | POST | /api/search | `{"pattern": "ERROR", "maxResults": 50}` |
| Analyze | POST | /api/analyze | — |
| Navigate | POST | /api/navigate | `{"line": 123}` |
| Filter | POST | /api/filter | `{"pattern": "ERROR"}` |
| Clear filter | POST | /api/clear-filter | — |
| Bookmarks | GET | /api/bookmarks | — |
| Add bookmark | POST | /api/add-bookmark | `{"line": 123, "label": "crash"}` |
| Highlights | GET | /api/highlights | — |
| Add highlight | POST | /api/add-highlight | `{"pattern": "ERROR", "color": "#ff0000"}` |
| Time gaps | POST | /api/time-gaps | — |
| Baselines | GET | /api/baselines | — |

## Important Notes

- Always check `/api/status` first — returns `filePath: null` if no file is open
- Only one agent can use SSE (`/api/events`) at a time; use polling if SSE is taken
- See `docs/AGENT_CHAT_GUIDE.md` for full integration details
