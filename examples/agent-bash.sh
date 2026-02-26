#!/usr/bin/env bash
# LOGAN Chat Agent — Bash
#
# A complete, runnable agent that chats with the user through LOGAN's Chat tab.
# Uses the HTTP API directly (no dependencies beyond bash, curl, jq).
#
# Usage:
#   bash examples/agent-bash.sh
#
# Prerequisites:
#   - LOGAN is running with a file open
#   - curl and jq are installed

set -euo pipefail

# --- Read LOGAN's port ---
PORT_FILE="$HOME/.logan/mcp-port"
if [[ ! -f "$PORT_FILE" ]]; then
  echo "ERROR: LOGAN is not running (no $PORT_FILE)" >&2
  exit 1
fi
PORT=$(cat "$PORT_FILE")
BASE="http://127.0.0.1:$PORT"

# --- Helpers ---

send_message() {
  local msg="$1"
  curl -sf -X POST "$BASE/api/agent-message" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg m "$msg" '{message: $m}')" \
    > /dev/null
  echo "[agent] $msg"
}

# Wait for a user message via SSE. Prints the message text to stdout.
# Returns 1 on timeout.
wait_for_message() {
  local timeout="${1:-120}"
  local msg

  # Use curl to connect to SSE and read until we get a user message
  msg=$(
    timeout "$timeout" curl -sf -N "$BASE/api/events" 2>/dev/null | \
    while IFS= read -r line; do
      # SSE lines look like: data: {"from":"user","text":"hello",...}
      if [[ "$line" == data:* ]]; then
        json="${line#data: }"
        from=$(echo "$json" | jq -r '.from // empty' 2>/dev/null)
        if [[ "$from" == "user" ]]; then
          echo "$json" | jq -r '.text'
          # Exit the subshell — curl gets killed by the pipe closing
          exit 0
        fi
      fi
    done
  ) || true

  if [[ -z "$msg" ]]; then
    return 1  # timeout or error
  fi
  echo "$msg"
}

is_stop_word() {
  local msg="$1"
  local lower
  lower=$(echo "$msg" | tr '[:upper:]' '[:lower:]' | xargs)
  case "$lower" in
    stop|bye|exit|quit) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Main loop ---

echo "=== LOGAN Chat Agent (bash) ==="
echo "Connecting to LOGAN on port $PORT..."

send_message "Hi! I'm a bash agent. Ask me anything about this log, or type 'stop' to end."

while true; do
  echo "[waiting for user message...]"
  USER_MSG=$(wait_for_message 300) || {
    send_message "Session timed out. Run me again when you're ready!"
    echo "Timed out. Exiting."
    break
  }

  echo "[user] $USER_MSG"

  # Check stop words
  if is_stop_word "$USER_MSG"; then
    send_message "Goodbye!"
    echo "User ended the session."
    break
  fi

  # --- Example: respond to simple commands ---
  # You can replace this section with your own logic (call logan API, run analysis, etc.)

  case "$(echo "$USER_MSG" | tr '[:upper:]' '[:lower:]')" in
    *status*)
      RESULT=$(curl -sf "$BASE/api/status" | jq -r '.status | "File: \(.filePath)\nLines: \(.totalLines)"')
      send_message "$RESULT"
      ;;
    *analyze*)
      send_message "Running analysis..."
      RESULT=$(curl -sf -X POST "$BASE/api/analyze" -H 'Content-Type: application/json' -d '{}')
      ERROR_COUNT=$(echo "$RESULT" | jq -r '.result.levelCounts.error // 0')
      WARN_COUNT=$(echo "$RESULT" | jq -r '.result.levelCounts.warning // 0')
      send_message "Analysis complete: $ERROR_COUNT errors, $WARN_COUNT warnings."
      ;;
    *search\ *)
      PATTERN="${USER_MSG#*search }"
      send_message "Searching for '$PATTERN'..."
      RESULT=$(curl -sf -X POST "$BASE/api/search" \
        -H 'Content-Type: application/json' \
        -d "$(jq -n --arg p "$PATTERN" '{pattern: $p, isRegex: false, matchCase: false}')")
      MATCH_COUNT=$(echo "$RESULT" | jq '.matches | length')
      send_message "Found $MATCH_COUNT matches for '$PATTERN'."
      ;;
    *)
      send_message "I understand these commands: status, analyze, search <pattern>. Or type 'stop' to end."
      ;;
  esac
done

echo "=== Agent exited ==="
