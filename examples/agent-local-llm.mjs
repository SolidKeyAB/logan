#!/usr/bin/env node
/**
 * LOGAN Chat Agent — Local LLM Bridge
 *
 * Connects a local LLM (Ollama, LM Studio, or any OpenAI-compatible API)
 * to LOGAN's Chat tab. The LLM gets context about the open log file and
 * can use LOGAN's analysis tools via function-calling-style prompts.
 *
 * Usage:
 *   LLM_ENDPOINT=http://localhost:11434/v1 LLM_MODEL=llama3 node examples/agent-local-llm.mjs
 *
 * Environment variables:
 *   LLM_ENDPOINT  — Base URL (default: http://localhost:11434/v1)
 *   LLM_MODEL     — Model name (default: llama3)
 *
 * Prerequisites:
 *   - LOGAN is running with a file open
 *   - Ollama/LM Studio running locally
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import http from 'http';
import https from 'https';

// --- Config ---
const PORT_FILE = join(homedir(), '.logan', 'mcp-port');
const WAIT_TIMEOUT = 300; // seconds
const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:11434/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'llama3';
const AGENT_NAME = process.env.AGENT_NAME || 'wolvie';

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

function loganApi(method, path, body) {
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

function llmChat(messages) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${LLM_ENDPOINT}/chat/completions`);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const payload = JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    });

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const content = data.choices?.[0]?.message?.content || '';
            resolve(content.trim());
          } catch (e) {
            reject(new Error(`LLM response parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM request timeout')); });
    req.write(payload);
    req.end();
  });
}

async function sendMessage(text) {
  await loganApi('POST', '/api/agent-message', { message: text });
  console.log(`[agent] ${text}`);
}

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
        path: `/api/events?name=${encodeURIComponent(AGENT_NAME)}`,
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const frames = buf.split('\n\n');
          buf = frames.pop();

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

// --- Build context from LOGAN ---

async function getLogContext() {
  try {
    const status = await loganApi('GET', '/api/status');
    if (!status.isFileOpen) return 'No file is currently open in LOGAN.';

    const parts = [`File: ${status.filePath}`, `Lines: ${status.totalLines}`];
    if (status.isFiltered) parts.push(`Filtered: ${status.filteredLineCount} visible`);

    // Get first few lines as sample
    try {
      const sample = await loganApi('POST', '/api/get-lines', { startLine: 0, count: 20 });
      if (sample.success && sample.lines?.length > 0) {
        parts.push('\nSample (first 20 lines):');
        parts.push(sample.lines.map(l => l.text).join('\n'));
      }
    } catch { /* skip sample */ }

    return parts.join('\n');
  } catch {
    return 'Unable to fetch LOGAN status.';
  }
}

// --- Command detection & LOGAN tool calls ---

const TOOL_PATTERNS = [
  { pattern: /\b(?:search|find|grep)\s+(?:for\s+)?["']?(.+?)["']?\s*$/i, action: 'search' },
  { pattern: /\b(?:analyze|analysis|triage|overview)\b/i, action: 'analyze' },
  { pattern: /\b(?:crash|crashes|fatal|panic)\b/i, action: 'crashes' },
  { pattern: /\b(?:filter)\s+(.+)/i, action: 'filter' },
  { pattern: /\b(?:clear filter|remove filter|unfilter)\b/i, action: 'clear-filter' },
  { pattern: /\b(?:time.?gaps?|gaps?)\b/i, action: 'time-gaps' },
  { pattern: /\b(?:go to|goto|jump to|navigate to)\s+(?:line\s+)?(\d+)/i, action: 'navigate' },
  { pattern: /\b(?:show|get|read)\s+lines?\s+(\d+)\s*[-–to]+\s*(\d+)/i, action: 'get-lines' },
];

async function executeToolIfDetected(userMsg) {
  for (const { pattern, action } of TOOL_PATTERNS) {
    const match = userMsg.match(pattern);
    if (!match) continue;

    try {
      switch (action) {
        case 'search': {
          const result = await loganApi('POST', '/api/search', { pattern: match[1], maxResults: 20 });
          if (result.success && result.matches?.length > 0) {
            return `Found ${result.matches.length} matches for "${match[1]}":\n` +
              result.matches.slice(0, 10).map(m => `  Line ${m.lineNumber + 1}: ${m.lineText?.substring(0, 120)}`).join('\n');
          }
          return `No matches found for "${match[1]}"`;
        }
        case 'analyze': {
          const result = await loganApi('POST', '/api/analyze');
          if (result.success && result.analysis) {
            const a = result.analysis;
            const parts = ['Log Analysis:'];
            if (a.levelCounts) parts.push('Levels: ' + Object.entries(a.levelCounts).map(([k, v]) => `${k}:${v}`).join(', '));
            if (a.crashes?.length) parts.push(`Crashes: ${a.crashes.length} found`);
            if (a.components?.length) parts.push(`Components: ${a.components.length} detected`);
            return parts.join('\n');
          }
          return 'Analysis completed but returned no data.';
        }
        case 'crashes': {
          const result = await loganApi('POST', '/api/investigate-crashes');
          if (result.success) return JSON.stringify(result, null, 2).substring(0, 1000);
          return 'No crash data found.';
        }
        case 'filter': {
          await loganApi('POST', '/api/filter', { includePatterns: [match[1]] });
          return `Filter applied: "${match[1]}"`;
        }
        case 'clear-filter': {
          await loganApi('POST', '/api/clear-filter');
          return 'Filter cleared.';
        }
        case 'time-gaps': {
          const result = await loganApi('POST', '/api/time-gaps');
          if (result.success && result.gaps?.length > 0) {
            return `Found ${result.gaps.length} time gaps:\n` +
              result.gaps.slice(0, 5).map(g => `  ${g.duration} gap at line ${g.lineNumber}`).join('\n');
          }
          return 'No significant time gaps found.';
        }
        case 'navigate': {
          await loganApi('POST', '/api/navigate', { line: parseInt(match[1]) - 1 });
          return `Navigated to line ${match[1]}.`;
        }
        case 'get-lines': {
          const start = parseInt(match[1]) - 1;
          const count = parseInt(match[2]) - start;
          const result = await loganApi('POST', '/api/get-lines', { startLine: start, count });
          if (result.success && result.lines?.length > 0) {
            return result.lines.map(l => `${l.lineNumber + 1}: ${l.text}`).join('\n');
          }
          return 'Could not fetch lines.';
        }
      }
    } catch (e) {
      return `Tool error: ${e.message}`;
    }
  }
  return null; // no tool matched
}

// --- Conversation state ---
const conversationHistory = [];

const SYSTEM_PROMPT = `You are ${AGENT_NAME}, a helpful log analysis assistant connected to LOGAN, a log viewer tool.
The user may call you "${AGENT_NAME}". Always respond in character.
You help the user analyze and understand log files. You can:
- Search for patterns (user says "search for X")
- Analyze the log (user says "analyze" or "triage")
- Investigate crashes (user says "crashes")
- Filter lines (user says "filter X")
- Find time gaps (user says "time gaps")
- Navigate to lines (user says "go to line N")
- Read specific lines (user says "show lines N to M")

When tool results are provided in [TOOL RESULT], use them to give a clear, concise answer.
Keep responses focused and practical. Don't repeat the raw data — summarize and explain what matters.`;

// --- Main loop ---

console.log('=== LOGAN Local LLM Agent ===');
console.log(`LLM: ${LLM_ENDPOINT} (model: ${LLM_MODEL})`);
console.log(`Connecting to LOGAN on port ${port}...`);

// Get initial context
const logContext = await getLogContext();
conversationHistory.push({ role: 'system', content: SYSTEM_PROMPT + '\n\nCurrent log file context:\n' + logContext });

await sendMessage(`Hey! I'm ${AGENT_NAME}, powered by ${LLM_MODEL}. Ask me about the log file — I can search, analyze, filter, and more.`);

while (true) {
  console.log('[waiting for user message...]');
  const userMsg = await waitForMessage(WAIT_TIMEOUT);

  if (userMsg === null) {
    await sendMessage('Session timed out. Run me again when ready!');
    break;
  }

  console.log(`[user] ${userMsg}`);

  if (/^(stop|quit|exit|bye|goodbye)$/i.test(userMsg.trim())) {
    await sendMessage('Goodbye!');
    break;
  }

  // Check if user message triggers a LOGAN tool
  const toolResult = await executeToolIfDetected(userMsg);

  // Build the user message for the LLM
  let llmUserMsg = userMsg;
  if (toolResult) {
    llmUserMsg = `${userMsg}\n\n[TOOL RESULT]\n${toolResult}`;
  }

  conversationHistory.push({ role: 'user', content: llmUserMsg });

  // Keep conversation history manageable (last 20 messages)
  const messages = conversationHistory.length > 21
    ? [conversationHistory[0], ...conversationHistory.slice(-20)]
    : conversationHistory;

  try {
    await sendMessage('Thinking...');
    const reply = await llmChat(messages);
    conversationHistory.push({ role: 'assistant', content: reply });

    // Send reply (split if very long)
    if (reply.length > 2000) {
      const chunks = reply.match(/.{1,2000}/gs) || [reply];
      for (const chunk of chunks) {
        await sendMessage(chunk);
      }
    } else {
      await sendMessage(reply || 'I couldn\'t generate a response. Could you rephrase?');
    }
  } catch (e) {
    console.error(`[LLM error] ${e.message}`);
    // If LLM fails but we have a tool result, send that directly
    if (toolResult) {
      await sendMessage(toolResult);
    } else {
      await sendMessage(`LLM error: ${e.message}. Is ${LLM_ENDPOINT} running?`);
    }
  }
}

console.log('=== Agent exited ===');
