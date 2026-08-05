import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// --- Usage Monitor store -----------------------------------------------------
// Per-feature usage COUNTS (not content), split by operator (human vs AI),
// persisted to a single global JSON file (~/.logan/usage.json). Aggregates over
// LOGAN's two existing event recorders (human actions via logActivity, AI tool
// calls via the api-server tap). Local-only, no network.

export type Operator = 'human' | 'ai';

export interface UsageEntry {
  verb: string;
  operator: Operator;
  count: number;
  firstUsed: string; // ISO 8601
  lastUsed: string; // ISO 8601
  daily: Record<string, number>; // key = 'YYYY-MM-DD'
}

export interface UsageStore {
  version: 1;
  updatedAt: string; // ISO 8601
  entries: Record<string, UsageEntry>; // key = `${operator}::${verb}`
}

const DEFAULT_PATH = () => path.join(os.homedir(), '.logan', 'usage.json');
const DAILY_CAP = 90; // keep at most ~90 daily buckets per entry
const WRITE_DEBOUNCE_MS = 500;

function emptyStore(): UsageStore {
  return { version: 1, updatedAt: new Date().toISOString(), entries: {} };
}

function keyFor(operator: Operator, verb: string): string {
  return `${operator}::${verb}`;
}

function dayKey(at: number): string {
  // Local-date 'YYYY-MM-DD' bucket.
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Trim an entry's daily buckets to the most recent DAILY_CAP days (by date key).
function capDaily(daily: Record<string, number>): Record<string, number> {
  const keys = Object.keys(daily);
  if (keys.length <= DAILY_CAP) return daily;
  keys.sort(); // 'YYYY-MM-DD' sorts chronologically as strings
  const keep = keys.slice(-DAILY_CAP);
  const trimmed: Record<string, number> = {};
  for (const k of keep) trimmed[k] = daily[k];
  return trimmed;
}

/**
 * Usage counter store. A single default instance is exported for the app; the
 * class is exported so tests can point at a temp path and avoid touching the
 * user's real ~/.logan/usage.json.
 */
export class UsageStoreImpl {
  private filePath: string;
  private cache: UsageStore | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath || DEFAULT_PATH();
  }

  private load(): UsageStore {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') {
          // Sanitize: drop any hand-edited/corrupt entries missing required
          // fields so the renderer's Usage panel never chokes on a bad row.
          const clean: Record<string, UsageEntry> = {};
          for (const [key, e] of Object.entries(raw.entries as Record<string, unknown>)) {
            const entry = e as Partial<UsageEntry>;
            if (
              entry && typeof entry === 'object' &&
              typeof entry.verb === 'string' &&
              (entry.operator === 'human' || entry.operator === 'ai') &&
              typeof entry.count === 'number' &&
              typeof entry.lastUsed === 'string'
            ) {
              clean[key] = {
                verb: entry.verb,
                operator: entry.operator,
                count: entry.count,
                firstUsed: typeof entry.firstUsed === 'string' ? entry.firstUsed : entry.lastUsed,
                lastUsed: entry.lastUsed,
                daily: (entry.daily && typeof entry.daily === 'object') ? entry.daily : {},
              };
            }
          }
          this.cache = { version: 1, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(), entries: clean };
          return this.cache;
        }
      }
    } catch {
      /* corrupt/unreadable — start fresh, never throw into callers */
    }
    this.cache = emptyStore();
    return this.cache;
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return; // already scheduled
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  /** Synchronously persist the in-memory cache to disk (best-effort). */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.cache) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
    } catch {
      /* disk full / read-only — swallow, usage stats are non-critical */
    }
  }

  /** Increment the counter for (verb, operator). Cheap hot-path; debounced write. */
  bump(verb: string, operator: Operator, at: number = Date.now()): void {
    try {
      if (!verb) return;
      const store = this.load();
      const iso = new Date(at).toISOString();
      const key = keyFor(operator, verb);
      let entry = store.entries[key];
      if (!entry) {
        entry = { verb, operator, count: 0, firstUsed: iso, lastUsed: iso, daily: {} };
        store.entries[key] = entry;
      }
      entry.count += 1;
      entry.lastUsed = iso;
      const dk = dayKey(at);
      entry.daily[dk] = (entry.daily[dk] || 0) + 1;
      entry.daily = capDaily(entry.daily);
      store.updatedAt = iso;
      this.scheduleWrite();
    } catch {
      /* never throw into callers */
    }
  }

  /** Return all entries sorted by count descending (ties broken by lastUsed desc). */
  getAll(): UsageEntry[] {
    try {
      const store = this.load();
      return Object.values(store.entries).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.lastUsed.localeCompare(a.lastUsed);
      });
    } catch {
      return [];
    }
  }

  /** Wipe all usage stats. */
  clear(): void {
    try {
      this.cache = emptyStore();
      this.flush();
    } catch {
      /* never throw */
    }
  }
}

// --- Module-level singleton + thin functional API for app code ---------------

let instance: UsageStoreImpl | null = null;

function store(): UsageStoreImpl {
  if (!instance) instance = new UsageStoreImpl();
  return instance;
}

export function bumpUsage(verb: string, operator: Operator, at?: number): void {
  store().bump(verb, operator, at);
}

export function getUsage(): UsageEntry[] {
  return store().getAll();
}

export function clearUsage(): void {
  store().clear();
}

export function flushUsage(): void {
  store().flush();
}

// --- AI-context flag ---------------------------------------------------------
// Ref-counted marker set while the api-server is dispatching an AI tool call.
// The AI verb is already counted by the api-server 'ai' tap; without this flag
// the same request would ALSO be counted as 'human' via logActivity(), because
// the ctx handlers share the app's code paths. logActivity() consults
// isAiContext() and skips the human bump while an AI call is in flight. The
// depth counter tolerates nested/re-entrant dispatch.
let aiContextDepth = 0;

export function enterAiContext(): void {
  aiContextDepth += 1;
}

export function exitAiContext(): void {
  if (aiContextDepth > 0) aiContextDepth -= 1;
}

export function isAiContext(): boolean {
  return aiContextDepth > 0;
}
