// Jira ticket downloader plugin — engine.
//
// LOGAN doesn't talk to Jira itself. Instead it drives an *external* download
// command the user already owns (e.g. a Python script with saved API keys, no
// login needed) and then opens whatever that command drops into a known folder.
//
// Contract with the user's script (all configurable in the UI / jira-plugin.json):
//   • command      — the executable to run (e.g. "python3", or the script itself)
//   • argsTemplate — space-separated args; {ticket} and {downloadDir} are substituted
//   • downloadDir  — where the script writes; LOGAN diffs this dir to find the result
//
// Detection is script-agnostic: we snapshot downloadDir before the run, run the
// command, then pick the file(s) that appeared or changed. No stdout-format
// coupling required (with an absolute-path-in-stdout fallback when no dir is set).
//
// This module is Electron-free and side-effect-light so the pure helpers
// (tokenizeArgs / substituteVars / isValidTicket / diffSnapshot) are unit-tested.
// The opening of the resulting file is done by the caller (index.ts / api-server),
// which owns openFileAsCurrent.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JiraPluginConfig, JiraFetchResult } from '../shared/types';

const getConfigDir = () => path.join(os.homedir(), '.logan');
const getJiraConfigPath = () => path.join(getConfigDir(), 'jira-plugin.json');

export const DEFAULT_JIRA_CONFIG: JiraPluginConfig = {
  command: '',
  argsTemplate: '{ticket}',
  downloadDir: '',
  timeoutSec: 120,
  autoOpen: true,
  openWhich: 'newest',
};

/** Read the saved plugin config, merged over defaults (missing file → defaults). */
export function loadJiraConfig(): JiraPluginConfig {
  try {
    const p = getJiraConfigPath();
    if (fs.existsSync(p)) {
      const saved = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { ...DEFAULT_JIRA_CONFIG, ...saved };
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_JIRA_CONFIG };
}

/** Persist the plugin config (creates ~/.logan/ if needed). */
export function saveJiraConfig(config: Partial<JiraPluginConfig>): { success: boolean; config?: JiraPluginConfig; error?: string } {
  try {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const merged: JiraPluginConfig = { ...loadJiraConfig(), ...config };
    fs.writeFileSync(getJiraConfigPath(), JSON.stringify(merged, null, 2), 'utf-8');
    return { success: true, config: merged };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// A ticket key is passed straight to an external process argument. We run via
// execFile (no shell), so classic injection isn't possible, but we still keep the
// value to a conservative safe charset to block path traversal / flag smuggling.
const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidTicket(ticket: string): boolean {
  return typeof ticket === 'string' && TICKET_RE.test(ticket.trim());
}

// Split an argsTemplate into argv tokens, honouring simple double-quotes so a
// path with spaces can be written as "/a b/c.py". Placeholders are substituted
// per-token AFTER splitting, so a substituted value is always exactly one arg.
export function tokenizeArgs(template: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuote = false;
  let has = false; // did we start a token (so "" yields an empty arg)
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch === '"') { inQuote = !inQuote; has = true; continue; }
    if (!inQuote && /\s/.test(ch)) {
      if (has) { tokens.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += ch; has = true;
  }
  if (has) tokens.push(cur);
  return tokens;
}

/** Replace {ticket} and {downloadDir} placeholders inside a single token. */
export function substituteVars(token: string, vars: { ticket: string; downloadDir: string }): string {
  return token
    .replace(/\{ticket\}/g, vars.ticket)
    .replace(/\{downloadDir\}/g, vars.downloadDir);
}

/** Build the final argv from a template + vars (tokenize, then substitute). */
export function buildArgs(argsTemplate: string, vars: { ticket: string; downloadDir: string }): string[] {
  return tokenizeArgs(argsTemplate).map(t => substituteVars(t, vars));
}

export type DirSnapshot = Map<string, number>; // absolute path -> mtimeMs

// Bounded recursive listing of files (not dirs) under root with their mtimes.
// Capped so a mistakenly-huge downloadDir can't stall the scan.
export function snapshotDir(root: string, maxFiles = 5000, maxDepth = 5): DirSnapshot {
  const snap: DirSnapshot = new Map();
  if (!root) return snap;
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || snap.size >= maxFiles) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (snap.size >= maxFiles) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile()) {
        try { snap.set(full, fs.statSync(full).mtimeMs); } catch { /* skip */ }
      }
    }
  };
  walk(root, 0);
  return snap;
}

// Files that are new, or whose mtime advanced, between two snapshots — sorted
// newest first. `sinceMs` (the run start) guards against clock-equal rewrites.
export function diffSnapshot(before: DirSnapshot, after: DirSnapshot, sinceMs = 0): string[] {
  const changed: Array<{ path: string; mtime: number }> = [];
  for (const [p, mtime] of after) {
    const prev = before.get(p);
    if ((prev === undefined || mtime > prev) && mtime >= sinceMs - 1) {
      changed.push({ path: p, mtime });
    }
  }
  changed.sort((a, b) => b.mtime - a.mtime);
  return changed.map(c => c.path);
}

// Last resort when no downloadDir is configured: scan stdout bottom-up for a line
// that is (or contains) an absolute path to an existing file.
function pathFromStdout(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).reverse();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const candidates = [line, ...(line.match(/(\/[^\s"']+)/g) || [])];
    for (const c of candidates) {
      try { if (path.isAbsolute(c) && fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch { /* skip */ }
    }
  }
  return null;
}

const MAX_OUT = 8000; // chars of stdout/stderr echoed back to the UI/agent
function clip(s: string): string {
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + `\n…[${s.length - MAX_OUT} more chars]` : s;
}

/**
 * Run the configured download command for `ticket` and report which file(s)
 * landed in downloadDir. Does NOT open anything — the caller decides that from
 * the returned `newestFile` / `files`.
 */
export function runJiraFetch(ticket: string, cfg?: JiraPluginConfig): Promise<JiraFetchResult> {
  const config = cfg || loadJiraConfig();
  const t = (ticket || '').trim();

  if (!config.command || !config.command.trim()) {
    return Promise.resolve({ success: false, ticket: t, files: [], error: 'No Jira download command configured. Open the Jira settings (🎫 ⚙) and set the command + download folder first.' });
  }
  if (!isValidTicket(t)) {
    return Promise.resolve({ success: false, ticket: t, files: [], error: `Invalid ticket key "${t}". Use letters, digits, ".", "_" or "-" (e.g. SUS-1234).` });
  }

  const downloadDir = (config.downloadDir || '').trim();
  if (downloadDir) {
    try { if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true }); } catch { /* reported below if it truly fails */ }
  }

  const args = buildArgs(config.argsTemplate || '{ticket}', { ticket: t, downloadDir });
  const before = snapshotDir(downloadDir);
  const startedAt = Date.now();
  const timeout = Math.max(1, config.timeoutSec || 120) * 1000;

  return new Promise<JiraFetchResult>((resolve) => {
    execFile(config.command, args, {
      cwd: downloadDir || undefined,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const durationMs = Date.now() - startedAt;
      const out = String(stdout || '');
      const errOut = String(stderr || '');
      const after = snapshotDir(downloadDir);
      let files = downloadDir ? diffSnapshot(before, after, startedAt) : [];
      if (files.length === 0 && !downloadDir) {
        const p = pathFromStdout(out);
        if (p) files = [p];
      }
      const newestFile = files[0];

      // execFile err covers non-zero exit, ENOENT (command not found), and timeout.
      if (err) {
        const anyErr = err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
        let error: string;
        if (anyErr.code === 'ENOENT') error = `Command not found: "${config.command}". Check the Jira settings.`;
        else if ((anyErr as any).killed) error = `Download timed out after ${config.timeoutSec}s.`;
        else error = `Download command failed (exit ${anyErr.code}). ${errOut.trim().slice(0, 400) || out.trim().slice(-400)}`;
        resolve({ success: false, ticket: t, files, newestFile, stdout: clip(out), stderr: clip(errOut), exitCode: typeof anyErr.code === 'number' ? anyErr.code : undefined, durationMs, error });
        return;
      }

      if (files.length === 0) {
        resolve({ success: false, ticket: t, files, stdout: clip(out), stderr: clip(errOut), exitCode: 0, durationMs, error: downloadDir ? `Command succeeded but no new file appeared in ${downloadDir}. Check the ticket key and the download folder.` : 'Command succeeded but no downloadDir is set, so LOGAN could not locate the result. Set a download folder in the Jira settings.' });
        return;
      }

      resolve({ success: true, ticket: t, files, newestFile, folder: downloadDir || (newestFile ? path.dirname(newestFile) : undefined), stdout: clip(out), stderr: clip(errOut), exitCode: 0, durationMs });
    });
  });
}
