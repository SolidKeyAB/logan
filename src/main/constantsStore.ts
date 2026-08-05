import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// --- Constants store ---------------------------------------------------------
// Named constants captured from a selection ("Save as constant…" in the log
// viewer's right-click menu). Each is a simple {name, value} pair, persisted to
// a single global JSON file (~/.logan/constants.json). Local-only, no network.
// Consumed by a later brick; this store is just persistence + the save gesture.

export interface ConstantEntry {
  name: string;
  value: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface ConstantsStore {
  version: 1;
  updatedAt: string; // ISO 8601
  entries: Record<string, ConstantEntry>; // key = name
}

const DEFAULT_PATH = () => path.join(os.homedir(), '.logan', 'constants.json');
const WRITE_DEBOUNCE_MS = 500;

function emptyStore(): ConstantsStore {
  return { version: 1, updatedAt: new Date().toISOString(), entries: {} };
}

/**
 * Named-constants store. A single default instance is exported for the app; the
 * class is exported so tests can point at a temp path and avoid touching the
 * user's real ~/.logan/constants.json.
 */
export class ConstantsStoreImpl {
  private filePath: string;
  private cache: ConstantsStore | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath || DEFAULT_PATH();
  }

  private load(): ConstantsStore {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (raw && typeof raw === 'object' && raw.entries) {
          this.cache = raw as ConstantsStore;
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
      /* disk full / read-only — swallow, constants are non-critical */
    }
  }

  /** Upsert a named constant. Empty name/value is a no-op. Debounced write. */
  save(name: string, value: string, at: number = Date.now()): void {
    try {
      const trimmedName = (name || '').trim();
      if (!trimmedName || !value) return;
      const store = this.load();
      const iso = new Date(at).toISOString();
      const existing = store.entries[trimmedName];
      if (existing) {
        existing.value = value;
        existing.updatedAt = iso;
      } else {
        store.entries[trimmedName] = { name: trimmedName, value, createdAt: iso, updatedAt: iso };
      }
      store.updatedAt = iso;
      this.scheduleWrite();
    } catch {
      /* never throw into callers */
    }
  }

  /** Return all constants sorted by name (ascending). */
  getAll(): ConstantEntry[] {
    try {
      const store = this.load();
      return Object.values(store.entries).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  /** Delete a named constant. Returns true if one was removed. Debounced write. */
  delete(name: string): boolean {
    try {
      const trimmedName = (name || '').trim();
      if (!trimmedName) return false;
      const store = this.load();
      if (!store.entries[trimmedName]) return false;
      delete store.entries[trimmedName];
      store.updatedAt = new Date().toISOString();
      this.scheduleWrite();
      return true;
    } catch {
      return false;
    }
  }

  /** Wipe all constants. */
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

let instance: ConstantsStoreImpl | null = null;

function store(): ConstantsStoreImpl {
  if (!instance) instance = new ConstantsStoreImpl();
  return instance;
}

export function saveConstant(name: string, value: string, at?: number): void {
  store().save(name, value, at);
}

export function getConstants(): ConstantEntry[] {
  return store().getAll();
}

export function deleteConstant(name: string): boolean {
  return store().delete(name);
}

export function clearConstants(): void {
  store().clear();
}

export function flushConstants(): void {
  store().flush();
}
