import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// --- Pattern "flight recorder" ----------------------------------------------
// A rolling log of every pattern APPLICATION (search/filter/highlight etc.),
// split by operator (human vs AI), persisted to a single global JSON file
// (~/.logan/pattern-log.json). Records compile/scan metadata + a few sample hit
// line refs — never full content. Local-only, no network.
//
// Mirrors usageStore.ts: class impl + functional singleton + debounced write +
// testable temp-path constructor + try/catch throughout (never throws into
// callers — pattern logging is non-critical telemetry).

export interface PatternLogEntry {
  id: string;
  ts: string; // ISO 8601
  operator: 'human' | 'ai';
  mode: string;
  source: string;
  scope: string;
  scanned: number;
  matched: number;
  hid: number;
  sampleHits: number[]; // viewerLine refs
  ms: number;
  capped: boolean;
  valid: boolean;
  error?: string;
}

export interface PatternLogStore {
  version: 1;
  updatedAt: string; // ISO 8601
  entries: PatternLogEntry[]; // most-recent-first
}

const DEFAULT_PATH = () => path.join(os.homedir(), '.logan', 'pattern-log.json');
const ENTRY_CAP = 500; // keep at most ~500 most-recent entries
const WRITE_DEBOUNCE_MS = 500;

function emptyStore(): PatternLogStore {
  return { version: 1, updatedAt: new Date().toISOString(), entries: [] };
}

let idCounter = 0;
function makeId(at: number): string {
  // Time-prefixed + monotonic counter + randomness → unique even for same-ms bursts.
  idCounter = (idCounter + 1) % 1_000_000;
  return `${at.toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Pattern-application log store. A single default instance is exported for the
 * app; the class is exported so tests can point at a temp path and avoid
 * touching the user's real ~/.logan/pattern-log.json.
 */
export class PatternLogStoreImpl {
  private filePath: string;
  private cache: PatternLogStore | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath || DEFAULT_PATH();
  }

  private load(): PatternLogStore {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (raw && typeof raw === 'object' && Array.isArray(raw.entries)) {
          this.cache = raw as PatternLogStore;
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
      /* disk full / read-only — swallow, the log is non-critical */
    }
  }

  /** Record one pattern application. Assigns id + ISO ts, prepends, caps, debounces the write. */
  log(entry: Omit<PatternLogEntry, 'id' | 'ts'> & { at?: number }): void {
    try {
      const store = this.load();
      const at = entry.at ?? Date.now();
      const { at: _drop, ...rest } = entry;
      const full: PatternLogEntry = {
        ...rest,
        id: makeId(at),
        ts: new Date(at).toISOString(),
      };
      store.entries.unshift(full); // prepend → most-recent-first
      if (store.entries.length > ENTRY_CAP) {
        store.entries.length = ENTRY_CAP; // drop the oldest overflow
      }
      store.updatedAt = full.ts;
      this.scheduleWrite();
    } catch {
      /* never throw into callers */
    }
  }

  /** Return all entries, most-recent-first (as stored). */
  getAll(): PatternLogEntry[] {
    try {
      return this.load().entries.slice();
    } catch {
      return [];
    }
  }

  /** Wipe the entire log. */
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

let instance: PatternLogStoreImpl | null = null;

function store(): PatternLogStoreImpl {
  if (!instance) instance = new PatternLogStoreImpl();
  return instance;
}

export function logPattern(entry: Omit<PatternLogEntry, 'id' | 'ts'> & { at?: number }): void {
  store().log(entry);
}

export function getPatternLog(): PatternLogEntry[] {
  return store().getAll();
}

export function clearPatternLog(): void {
  store().clear();
}

export function flushPatternLog(): void {
  store().flush();
}
