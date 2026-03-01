#!/usr/bin/env python3
"""
LOGAN Agent Chat — Polling Mode
Connects to LOGAN's HTTP API and polls for new messages every 2 seconds.
Works with any agent that can run Python scripts.

Usage:
  python3 scripts/agent-chat-poll.py
  python3 scripts/agent-chat-poll.py --name "My Agent"
"""

import urllib.request
import json
import time
import sys
import argparse


API = "http://127.0.0.1:19532"
POLL_INTERVAL = 2  # seconds


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


def register(name):
    result = api_post("/api/agent-register", {"name": name})
    if result.get("success"):
        print(f"  Registered as: {name}")
    return result


def send_message(text, name="Python Agent"):
    result = api_post("/api/agent-message", {"message": text, "name": name})
    if result.get("success"):
        print(f"  [agent] {text}")
    else:
        print(f"  [error] Failed to send: {result.get('error')}")
    return result


def poll_messages(since):
    result = api_get(f"/api/messages?since={since}")
    if not result.get("success"):
        return []
    return [m for m in result.get("messages", []) if m["from"] == "user"]


def check_status():
    result = api_get("/api/status")
    if not result.get("success"):
        print(f"Cannot connect to LOGAN: {result.get('error')}")
        print("Make sure LOGAN is running.")
        return False
    status = result["status"]
    if not status.get("filePath"):
        print("LOGAN is running but no file is open.")
        print("Open a log file in LOGAN first.")
        return False
    print(f"Connected to LOGAN")
    print(f"  File: {status['filePath']}")
    print(f"  Lines: {status['totalLines']}")
    return True


def main():
    parser = argparse.ArgumentParser(description="LOGAN Agent Chat (Polling)")
    parser.add_argument("--name", default="Python Agent", help="Agent name")
    args = parser.parse_args()

    print(f"=== LOGAN Agent Chat — {args.name} (Polling Mode) ===\n")

    if not check_status():
        sys.exit(1)

    last_ts = int(time.time() * 1000)

    register(args.name)
    send_message(f"Hello! {args.name} connected via polling.", args.name)

    print("\nListening for messages (Ctrl+C to stop)...\n")

    try:
        while True:
            time.sleep(POLL_INTERVAL)
            new_msgs = poll_messages(last_ts)
            for msg in new_msgs:
                last_ts = msg["timestamp"]
                print(f"  [user] {msg['text']}")

                # Echo reply — replace this with your agent logic
                if "goodbye" in msg["text"].lower() or "bye" in msg["text"].lower():
                    send_message("Goodbye! Disconnecting.", args.name)
                    return
                else:
                    send_message(f"Received: {msg['text']}", args.name)

    except KeyboardInterrupt:
        print("\nDisconnecting...")
        send_message("Agent disconnected.", args.name)


if __name__ == "__main__":
    main()
