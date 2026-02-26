#!/usr/bin/env node
/**
 * LOGAN Chat Agent — Node.js
 *
 * A complete, runnable agent that chats with the user through LOGAN's Chat tab.
 * Uses the HTTP API directly — no dependencies beyond Node.js (v18+).
 *
 * Usage:
 *   node examples/agent-node.mjs
 *
 * Prerequisites:
 *   - LOGAN is running with a file open
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import http from 'http';
import { matchIntent, isStopWord, HELP_TEXT } from './agent-intents.mjs';

// --- Config ---
const PORT_FILE = join(homedir(), '.logan', 'mcp-port');
const WAIT_TIMEOUT = 300; // seconds

// --- Read LOGAN port ---
let port;
try {
  port = parseInt(readFileSync(PORT_FILE, 'utf-8').trim(), 10);
} catch {
  console.error(`ERROR: LOGAN is not running (no ${PORT_FILE})`);
  process.exit(1);
}

const BASE = `http://127.0.0.1:${port}`;

// --- HTTP helpers ---

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function sendMessage(text) {
  await apiCall('POST', '/api/agent-message', { message: text });
  console.log(`[agent] ${text}`);
}

/**
 * Wait for a user message via SSE. Returns the message text,
 * or null on timeout.
 */
function waitForMessage(timeoutSec = 120) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      req.destroy();
      resolve(null);
    }, timeoutSec * 1000);

    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/events?name=LOGAN%20Built-in%20Agent',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const frames = buf.split('\n\n');
          buf = frames.pop(); // keep incomplete tail

          for (const frame of frames) {
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              const msg = JSON.parse(dataLine.slice(6));
              if (msg.from === 'user') {
                clearTimeout(timer);
                req.destroy();
                resolve(msg.text);
                return;
              }
            } catch { /* ignore */ }
          }
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve(null);
        });
      }
    );

    req.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

// --- Main loop ---

console.log('=== LOGAN Chat Agent (Node.js) ===');
console.log(`Connecting to LOGAN on port ${port}...`);

await sendMessage("Hi! I'm a LOGAN agent. " + HELP_TEXT.split('\n')[0]);

while (true) {
  console.log('[waiting for user message...]');
  const userMsg = await waitForMessage(WAIT_TIMEOUT);

  if (userMsg === null) {
    await sendMessage('Session timed out. Run me again when ready!');
    console.log('Timed out. Exiting.');
    break;
  }

  console.log(`[user] ${userMsg}`);

  if (isStopWord(userMsg)) {
    await sendMessage('Goodbye!');
    console.log('User ended the session.');
    break;
  }

  // Dispatch to intent engine
  const response = await matchIntent(userMsg, apiCall);
  await sendMessage(response);
}

console.log('=== Agent exited ===');
