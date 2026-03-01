#!/usr/bin/env python3
"""
LOGAN Agent Chat — SSE (Server-Sent Events) Mode
Connects to LOGAN's SSE endpoint for real-time message delivery.
Only one SSE agent can be connected at a time.

Usage:
  python3 scripts/agent-chat-sse.py
  python3 scripts/agent-chat-sse.py --name "My Agent"
"""

import urllib.request
import json
import sys
import argparse


API = "http://127.0.0.1:19532"


def api_get(path):
    try:
        req = urllib.request.Request(f"{API}{path}")
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read().decode())
    except Exception as e:
        return {"success": False, "error": str(e)}


def api_post(path, body):
    try:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            f"{API}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read().decode())
    except Exception as e:
        return {"success": False, "error": str(e)}


def send_message(text):
    result = api_post("/api/agent-message", {"message": text})
    if result.get("success"):
        print(f"  [agent] {text}")
    else:
        print(f"  [error] Failed to send: {result.get('error')}")
    return result


def check_status():
    result = api_get("/api/status")
    if not result.get("success"):
        print(f"Cannot connect to LOGAN: {result.get('error')}")
        return False
    status = result["status"]
    if not status.get("filePath"):
        print("LOGAN is running but no file is open.")
        return False
    print(f"Connected to LOGAN")
    print(f"  File: {status['filePath']}")
    print(f"  Lines: {status['totalLines']}")
    return True


def handle_message(msg_text):
    """Replace this with your agent logic."""
    if "goodbye" in msg_text.lower() or "bye" in msg_text.lower():
        send_message("Goodbye! Disconnecting.")
        sys.exit(0)
    else:
        send_message(f"Received: {msg_text}")


def listen_sse(agent_name):
    """Connect to SSE and listen for messages."""
    encoded_name = urllib.request.quote(agent_name)
    req = urllib.request.Request(f"{API}/api/events?name={encoded_name}")

    try:
        resp = urllib.request.urlopen(req, timeout=600)
    except Exception as e:
        print(f"Failed to connect SSE: {e}")
        sys.exit(1)

    print("SSE connected. Listening for messages...\n")

    buffer = ""
    try:
        while True:
            chunk = resp.read(1)
            if not chunk:
                break
            buffer += chunk.decode("utf-8", errors="replace")

            if buffer.endswith("\n\n"):
                for line in buffer.strip().split("\n"):
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            if isinstance(data, dict) and data.get("from") == "user":
                                print(f"  [user] {data['text']}")
                                handle_message(data["text"])
                            elif isinstance(data, dict) and "name" in data:
                                print(f"  [connected as: {data['name']}]")
                        except json.JSONDecodeError:
                            pass
                buffer = ""

    except KeyboardInterrupt:
        print("\nDisconnecting...")
        send_message("Agent disconnected.")


def main():
    parser = argparse.ArgumentParser(description="LOGAN Agent Chat (SSE)")
    parser.add_argument("--name", default="Python Agent", help="Agent name")
    args = parser.parse_args()

    print(f"=== LOGAN Agent Chat — {args.name} (SSE Mode) ===\n")

    if not check_status():
        sys.exit(1)

    send_message(f"Hello! {args.name} connected via SSE.")
    listen_sse(args.name)


if __name__ == "__main__":
    main()
