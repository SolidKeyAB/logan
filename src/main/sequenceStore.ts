import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// --- Clue-sequence store -----------------------------------------------------
// A "clue sequence" is an ORDERED evidence trail: the log lines / ranges / signal
// values / findings that show what went wrong across an incident, in time order.
// It is the EVIDENCE twin of a saved investigation (which records the PROCESS /
// the ordered tool calls). See docs/discovery/investigation-workflow-canvas.md
// ("Clue trail" section). Persisted to a single global JSON file
// (~/.logan/clue-sequences.json). Local-only, no network.
//
// Increment A (this module): the model + store + registry surfacing + the agent
// collect/save verbs. The human right-click "Add to sequence" gesture + clue tray
// + Saved-panel group is Increment B.

// What a single clue points at.
export type ClueRef = 'line' | 'range' | 'signalValue' | 'searchHit' | 'finding';

export const CLUE_REFS: ClueRef[] = ['line', 'range', 'signalValue', 'searchHit', 'finding'];

export interface SequenceClue {
  ref: ClueRef;
  line?: number;             // 1-based viewer line (line / range / searchHit / finding)
  endLine?: number;          // 1-based end line (ref = 'range')
  at?: number;               // timestamp / epoch-ms (ref = 'signalValue', or a time anchor)
  field?: string;            // signal / field name (ref = 'signalValue')
  value?: string | number;   // captured value (signalValue / searchHit)
  note?: string;             // why this clue matters
}

export interface ClueSequence {
  id: string;                // slug
  name: string;
  description?: string;
  scope: 'global' | 'file' | 'ticket';
  sourceFile?: string;       // log the trail was collected from (reference)
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
  clues: SequenceClue[];     // ORDERED
}

export interface SequencesStore {
  version: 1;
  updatedAt: string;
  sequences: Record<string, ClueSequence>; // key = id (slug)
}

// Input accepted by save() — everything but the server-managed timestamps/id.
export interface SequenceInput {
  id?: string;
  name?: string;
  description?: string;
  scope?: 'global' | 'file' | 'ticket';
  sourceFile?: string;
  clues?: any[];
}

const DEFAULT_PATH = () => path.join(os.homedir(), '.logan', 'clue-sequences.json');
const WRITE_DEBOUNCE_MS = 500;

export function slugifySequence(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sequence';
}

const CLUE_REF_SET = new Set<string>(CLUE_REFS);

// Validate + coerce one raw clue. Returns null for an unusable clue (bad ref) so a
// single junk entry can't corrupt a whole trail.
export function normalizeClue(raw: any): SequenceClue | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!CLUE_REF_SET.has(raw.ref)) return null;
  const c: SequenceClue = { ref: raw.ref };
  // Guard '' (Number('') === 0) so a blank field doesn't become a spurious line 0.
  if (raw.line != null && raw.line !== '' && !isNaN(Number(raw.line))) c.line = Number(raw.line);
  if (raw.endLine != null && raw.endLine !== '' && !isNaN(Number(raw.endLine))) c.endLine = Number(raw.endLine);
  if (raw.at != null && raw.at !== '' && !isNaN(Number(raw.at))) c.at = Number(raw.at);
  if (typeof raw.field === 'string' && raw.field) c.field = raw.field;
  if (raw.value != null && (typeof raw.value === 'string' || typeof raw.value === 'number')) c.value = raw.value;
  if (typeof raw.note === 'string' && raw.note) c.note = raw.note;
  return c;
}

function emptyStore(): SequencesStore {
  return { version: 1, updatedAt: new Date().toISOString(), sequences: {} };
}

/**
 * Clue-sequence store. A single default instance backs the app; the class is
 * exported so tests can point at a temp path and never touch the real file.
 */
export class SequenceStoreImpl {
  private filePath: string;
  private cache: SequencesStore | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath || DEFAULT_PATH();
  }

  private load(): SequencesStore {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (raw && typeof raw === 'object' && raw.sequences) {
          this.cache = raw as SequencesStore;
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
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => { this.writeTimer = null; this.flush(); }, WRITE_DEBOUNCE_MS);
  }

  /** Synchronously persist the in-memory cache to disk (best-effort). */
  flush(): void {
    if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = null; }
    if (!this.cache) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
    } catch {
      /* disk full / read-only — swallow, sequences are non-critical */
    }
  }

  private byIdOrName(store: SequencesStore, idOrName: string): ClueSequence | null {
    const key = (idOrName || '').trim();
    if (!key) return null;
    // own-property guard so lookups like 'constructor'/'toString' can't hit Object.prototype.
    const has = (k: string) => Object.prototype.hasOwnProperty.call(store.sequences, k);
    if (has(key)) return store.sequences[key];
    const slug = slugifySequence(key);
    if (has(slug)) return store.sequences[slug];
    return Object.values(store.sequences).find(s => s.name === key) || null;
  }

  /** Upsert a named sequence (by id, else by name slug). Returns the saved sequence, or null if no name/id. */
  save(input: SequenceInput): ClueSequence | null {
    try {
      const name = (input.name || '').trim();
      const id = input.id ? slugifySequence(input.id) : slugifySequence(name);
      if (!id || (!name && !input.id)) return null;
      const store = this.load();
      const iso = new Date().toISOString();
      const existing = store.sequences[id];
      const seq: ClueSequence = existing || { id, name: name || id, scope: 'global', createdAt: iso, updatedAt: iso, clues: [] };
      if (name) seq.name = name;
      if (input.description !== undefined) seq.description = input.description;
      if (input.scope) seq.scope = input.scope;
      if (input.sourceFile !== undefined) seq.sourceFile = input.sourceFile;
      if (Array.isArray(input.clues)) seq.clues = input.clues.map(normalizeClue).filter((c): c is SequenceClue => c !== null);
      seq.updatedAt = iso;
      store.sequences[id] = seq;
      store.updatedAt = iso;
      this.scheduleWrite();
      return seq;
    } catch {
      return null;
    }
  }

  /** Append ONE clue to a sequence, creating it (by name) if it does not exist yet. */
  appendClue(idOrName: string, rawClue: any): ClueSequence | null {
    try {
      const clue = normalizeClue(rawClue);
      if (!clue) return null;
      const store = this.load();
      let seq = this.byIdOrName(store, idOrName);
      if (!seq) { seq = this.save({ name: idOrName }); if (!seq) return null; }
      seq.clues.push(clue);
      seq.updatedAt = new Date().toISOString();
      store.updatedAt = seq.updatedAt;
      this.scheduleWrite();
      return seq;
    } catch {
      return null;
    }
  }

  /** All sequences, most-recently-updated first. */
  list(): ClueSequence[] {
    try {
      return Object.values(this.load().sequences).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    } catch {
      return [];
    }
  }

  get(idOrName: string): ClueSequence | null {
    try { return this.byIdOrName(this.load(), idOrName); } catch { return null; }
  }

  /** Delete a sequence by id or name. Returns true if one was removed. */
  delete(idOrName: string): boolean {
    try {
      const store = this.load();
      const seq = this.byIdOrName(store, idOrName);
      if (!seq) return false;
      delete store.sequences[seq.id];
      store.updatedAt = new Date().toISOString();
      this.scheduleWrite();
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    try { this.cache = emptyStore(); this.flush(); } catch { /* never throw */ }
  }
}

// --- Module-level singleton + thin functional API for app code ---------------

let instance: SequenceStoreImpl | null = null;

function store(): SequenceStoreImpl {
  if (!instance) instance = new SequenceStoreImpl();
  return instance;
}

export function saveSequence(input: SequenceInput): ClueSequence | null { return store().save(input); }
export function appendClue(idOrName: string, clue: any): ClueSequence | null { return store().appendClue(idOrName, clue); }
export function listSequences(): ClueSequence[] { return store().list(); }
export function getSequence(idOrName: string): ClueSequence | null { return store().get(idOrName); }
export function deleteSequence(idOrName: string): boolean { return store().delete(idOrName); }
export function flushSequences(): void { store().flush(); }
export function clearSequences(): void { store().clear(); }
