#!/usr/bin/env node
/**
 * logan-listen — CLI helper for AI agents to listen/send chat messages.
 *
 * Usage:
 *   node dist/mcp-server/logan-listen.js              # wait for next user message
 *   node dist/mcp-server/logan-listen.js --send "hi"  # send a message to the user
 *   node dist/mcp-server/logan-listen.js --timeout 60  # wait up to 60s
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';

const PORT_FILE = path.join(os.homedir(), '.logan', 'mcp-port');

function readPort(): number {
  try {
    return parseInt(fs.readFileSync(PORT_FILE, 'utf-8').trim(), 10);
  } catch {
    process.stderr.write('LOGAN is not running (no port file)\n');
    process.exit(1);
  }
}

function out(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// --- Parse args ---
const args = process.argv.slice(2);
let sendText: string | null = null;
let timeout = 120;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--send' && i + 1 < args.length) {
    sendText = args[++i];
  } else if (args[i] === '--timeout' && i + 1 < args.length) {
    timeout = parseInt(args[++i], 10);
  }
}

const port = readPort();

// --- Send mode ---
if (sendText !== null) {
  const payload = JSON.stringify({ message: sendText });
  const req = http.request(
    { hostname: '127.0.0.1', port, path: '/api/agent-message', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
    (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          out({ success: json.success ?? false });
        } catch {
          out({ success: false });
        }
      });
    },
  );
  req.on('error', () => { out({ success: false }); process.exit(1); });
  req.end(payload);
} else {
  // --- Listen mode (SSE) ---
  const timer = setTimeout(() => {
    out({ timeout: true });
    process.exit(0);
  }, timeout * 1000);

  const req = http.get(
    { hostname: '127.0.0.1', port, path: '/api/events', headers: { Accept: 'text/event-stream' } },
    (res) => {
      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        // Process complete SSE frames
        const frames = buf.split('\n\n');
        buf = frames.pop()!; // keep incomplete tail
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const msg = JSON.parse(dataLine.slice(6));
            if (msg.from === 'user') {
              clearTimeout(timer);
              out({ message: msg.text, timestamp: msg.timestamp });
              req.destroy();
              process.exit(0);
            }
          } catch { /* ignore malformed */ }
        }
      });
    },
  );
  req.on('error', () => {
    clearTimeout(timer);
    process.stderr.write('Could not connect to LOGAN\n');
    process.exit(1);
  });
}
