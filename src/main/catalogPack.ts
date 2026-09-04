// Portable catalogue pack — the pure engine behind LOGAN's "carry my setup with me"
// export/import (scope A: the reusable GLOBAL catalogue only, not per-log analysis).
//
// A `.logan-pack` is a single JSON container:
//   { logan_pack: 1, manifest: {...}, stores: { <kind>: [records], ... } }
// where each `stores[kind]` is exactly the array a store loader already returns. We keep it
// JSON (not a binary/zip) on purpose: the catalogue is tiny structured config, so readability,
// git-diffability, forward-compat and hand-repair beat any binary win. See the design decision
// recorded in session state / docs/discovery.
//
// This module is PURE — Node `crypto` only, no fs / no Electron — so the pack shape, merge
// semantics, integrity check and (opt-in) encryption are all unit-testable. index.ts injects
// the actual store reads/writes via a small registry; identity (how two records "collide") is
// owned here in CATALOG_IDENTITY so both the engine and its callers agree on one rule.

import { createHash, createCipheriv, createDecipheriv, scryptSync, randomBytes, randomUUID } from 'crypto';

export const PACK_FORMAT_VERSION = 1;   // bumps only on a breaking container-shape change
export const PACK_SCHEMA_VERSION = 1;   // bumps when the per-kind record shapes migrate
export const PACK_FILE_EXT = '.logan-pack';

/** How to resolve whether an incoming record is the "same" as an existing one. */
export interface IdentitySpec {
  idKeys: string[];    // stable-id fields (first is the canonical id used for keep-both)
  nameKeys: string[];  // human-name fields; a shared name also counts as a collision
}

// The one place that knows how each catalogue kind is identified. Mirrors resolveSavedEntity
// in index.ts (match by id OR by a name-ish field). Kinds absent here are not importable.
export const CATALOG_IDENTITY: Record<string, IdentitySpec> = {
  search:         { idKeys: ['id'],   nameKeys: ['pattern', 'description'] },
  session:        { idKeys: ['id'],   nameKeys: ['name'] },
  composite:      { idKeys: ['id'],   nameKeys: ['name'] },
  filter:         { idKeys: ['id'],   nameKeys: ['name'] },
  highlightGroup: { idKeys: ['id'],   nameKeys: ['name'] },
  bookmarkSet:    { idKeys: ['id'],   nameKeys: ['name'] },
  columnLayout:   { idKeys: ['id'],   nameKeys: ['name'] },
  columnPattern:  { idKeys: ['id'],   nameKeys: ['name'] },
  constant:       { idKeys: ['name'], nameKeys: ['name'] },   // constants are keyed by name
  trendProperty:  { idKeys: ['id'],   nameKeys: ['name'] },
  pattern:        { idKeys: ['id'],   nameKeys: ['label'] },
  contextDef:     { idKeys: ['id'],   nameKeys: ['name'] },
  sequence:       { idKeys: ['id'],   nameKeys: ['name'] },
  investigation:  { idKeys: ['slug'], nameKeys: ['name'] },
};

export const CATALOG_KINDS: string[] = Object.keys(CATALOG_IDENTITY);

export interface StoreManifestEntry {
  kind: string;
  count: number;
  sha256: string;   // integrity digest of the store's records (see sha256Records)
}

export interface PackManifest {
  formatVersion: number;
  schemaVersion: number;
  app: 'logan';
  createdAt: string;      // ISO 8601 — supplied by the caller (this module has no clock)
  generator?: string;     // e.g. "logan 1.2.3"
  kinds: StoreManifestEntry[];
}

export interface CatalogPack {
  logan_pack: number;                 // == PACK_FORMAT_VERSION; also the container marker
  manifest: PackManifest;
  stores: Record<string, any[]>;      // kind -> records (verbatim store arrays)
}

export type ConflictPolicy = 'skip' | 'overwrite' | 'keepBoth';

// --- integrity -------------------------------------------------------------

/** Deterministic digest of a store's records — hashes exactly the bytes we serialize. */
export function sha256Records(records: any[]): string {
  return createHash('sha256').update(JSON.stringify(records ?? [])).digest('hex');
}

// --- build / (de)serialize -------------------------------------------------

/** Assemble a pack from already-loaded store arrays + caller-supplied metadata. */
export function buildPack(
  storesByKind: Record<string, any[]>,
  meta: { createdAt: string; generator?: string },
): CatalogPack {
  const stores: Record<string, any[]> = {};
  const kinds: StoreManifestEntry[] = [];
  // Stable order (CATALOG_KINDS) so two exports of the same data serialize identically.
  for (const kind of CATALOG_KINDS) {
    if (!(kind in storesByKind)) continue;
    const records = Array.isArray(storesByKind[kind]) ? storesByKind[kind] : [];
    stores[kind] = records;
    kinds.push({ kind, count: records.length, sha256: sha256Records(records) });
  }
  return {
    logan_pack: PACK_FORMAT_VERSION,
    manifest: {
      formatVersion: PACK_FORMAT_VERSION,
      schemaVersion: PACK_SCHEMA_VERSION,
      app: 'logan',
      createdAt: meta.createdAt,
      generator: meta.generator,
      kinds,
    },
    stores,
  };
}

export function serializePack(pack: CatalogPack): string {
  return JSON.stringify(pack, null, 2);
}

/** Parse + shape-validate a pack. Throws a clear error on anything that isn't one. */
export function parsePack(text: string): CatalogPack {
  let obj: any;
  try { obj = JSON.parse(text); } catch { throw new Error('not JSON'); }
  if (!obj || typeof obj !== 'object') throw new Error('not an object');
  if (typeof obj.logan_pack !== 'number') throw new Error('missing "logan_pack" marker — not a LOGAN catalogue pack');
  if (obj.logan_pack > PACK_FORMAT_VERSION) throw new Error(`pack format v${obj.logan_pack} is newer than this LOGAN understands (v${PACK_FORMAT_VERSION}) — please update`);
  if (!obj.manifest || typeof obj.manifest !== 'object') throw new Error('missing manifest');
  if (!obj.stores || typeof obj.stores !== 'object') throw new Error('missing stores');
  // Coerce store values to arrays defensively.
  const stores: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(obj.stores)) stores[k] = Array.isArray(v) ? v : [];
  return { logan_pack: obj.logan_pack, manifest: obj.manifest, stores };
}

export interface PackProblem { kind?: string; message: string; }

/** Recompute checksums + counts and compare to the manifest. Never throws. */
export function verifyPack(pack: CatalogPack): { ok: boolean; problems: PackProblem[] } {
  const problems: PackProblem[] = [];
  const m = pack.manifest;
  if (!m) return { ok: false, problems: [{ message: 'no manifest' }] };
  if (typeof m.schemaVersion === 'number' && m.schemaVersion > PACK_SCHEMA_VERSION) {
    problems.push({ message: `schema v${m.schemaVersion} is newer than v${PACK_SCHEMA_VERSION} — records may not import cleanly` });
  }
  const declared = new Map((m.kinds || []).map(e => [e.kind, e]));
  // Every declared kind must match its store's recomputed digest + count.
  for (const entry of m.kinds || []) {
    const records = pack.stores[entry.kind];
    if (!records) { problems.push({ kind: entry.kind, message: 'declared in manifest but missing from stores' }); continue; }
    if (records.length !== entry.count) problems.push({ kind: entry.kind, message: `count mismatch (manifest ${entry.count}, actual ${records.length})` });
    if (sha256Records(records) !== entry.sha256) problems.push({ kind: entry.kind, message: 'checksum mismatch — store was modified after packing' });
  }
  // A store present but undeclared is suspicious but not fatal.
  for (const kind of Object.keys(pack.stores)) {
    if (!declared.has(kind)) problems.push({ kind, message: 'present in stores but not declared in manifest' });
  }
  return { ok: problems.length === 0, problems };
}

// --- merge -----------------------------------------------------------------

const norm = (v: any): string => (v == null ? '' : String(v).trim().toLowerCase());

/** True if two records refer to the same entity under `spec` (id match OR name match). */
export function collidesWith(a: any, b: any, spec: IdentitySpec): boolean {
  if (!a || !b) return false;
  for (const k of spec.idKeys) {
    if (a[k] != null && a[k] !== '' && a[k] === b[k]) return true;
  }
  for (const k of spec.nameKeys) {
    const av = norm(a[k]);
    if (av && av === norm(b[k])) return true;
  }
  return false;
}

export interface MergeResult {
  merged: any[];
  added: number;
  overwritten: number;
  skipped: number;
  keptBoth: number;
}

/**
 * Merge `incoming` into `existing` under `policy`. Dedups incoming-vs-incoming too (each
 * incoming is matched against the running merged set). keepBoth clones the incoming record
 * with a fresh identity so nothing is lost; for name-keyed kinds (e.g. constants) it suffixes
 * the name to stay unique+readable, otherwise it mints a new id and leaves names untouched.
 */
export function mergeRecords(
  existing: any[],
  incoming: any[],
  spec: IdentitySpec,
  policy: ConflictPolicy,
  opts?: { newId?: (rec: any) => string },
): MergeResult {
  const newId = opts?.newId || (() => randomUUID());
  const merged: any[] = Array.isArray(existing) ? existing.slice() : [];
  let added = 0, overwritten = 0, skipped = 0, keptBoth = 0;
  const idKey = spec.idKeys[0];
  const nameIsId = spec.nameKeys.includes(idKey);

  const takenNames = (): Set<string> => new Set(merged.map(r => norm(r?.[idKey])).filter(Boolean));

  for (const inc of incoming || []) {
    const idx = merged.findIndex(m => collidesWith(m, inc, spec));
    if (idx === -1) { merged.push(inc); added++; continue; }
    if (policy === 'skip') { skipped++; continue; }
    if (policy === 'overwrite') { merged[idx] = inc; overwritten++; continue; }
    // keepBoth: store as a distinct record.
    const clone = { ...inc };
    if (nameIsId) {
      const base = String(clone[idKey] ?? 'imported');
      const taken = takenNames();
      let candidate = `${base} (imported)`;
      let n = 2;
      while (taken.has(norm(candidate))) candidate = `${base} (imported ${n++})`;
      clone[idKey] = candidate;
    } else if (idKey) {
      clone[idKey] = newId(inc);
    }
    merged.push(clone);
    keptBoth++;
  }
  return { merged, added, overwritten, skipped, keptBoth };
}

// --- import planning (dry-run preview) -------------------------------------

export interface StorePlan {
  kind: string;
  incoming: number;
  existing: number;
  add: number;       // incoming with no match in existing
  conflict: number;  // incoming that collide with an existing record
}

export interface ImportPlan {
  stores: StorePlan[];
  totalIncoming: number;
  totalAdd: number;
  totalConflict: number;
  unknownKinds: string[];   // kinds in the pack this LOGAN can't import
}

/** What an import WOULD do, per kind, without writing anything. Policy-independent counts. */
export function planImport(
  existingByKind: Record<string, any[]>,
  pack: CatalogPack,
  specs: Record<string, IdentitySpec> = CATALOG_IDENTITY,
): ImportPlan {
  const stores: StorePlan[] = [];
  const unknownKinds: string[] = [];
  let totalIncoming = 0, totalAdd = 0, totalConflict = 0;
  for (const [kind, incoming] of Object.entries(pack.stores)) {
    const spec = specs[kind];
    if (!spec) { if ((incoming || []).length) unknownKinds.push(kind); continue; }
    const existing = existingByKind[kind] || [];
    let add = 0, conflict = 0;
    for (const inc of incoming || []) {
      if (existing.some(e => collidesWith(e, inc, spec))) conflict++; else add++;
    }
    stores.push({ kind, incoming: (incoming || []).length, existing: existing.length, add, conflict });
    totalIncoming += (incoming || []).length;
    totalAdd += add;
    totalConflict += conflict;
  }
  return { stores, totalIncoming, totalAdd, totalConflict, unknownKinds };
}

// --- encryption (opt-in passphrase) ----------------------------------------
// AES-256-GCM with a scrypt-derived key. The envelope is itself JSON so an encrypted
// .logan-pack is still a well-formed (if opaque) JSON file.

export interface EncryptedEnvelope {
  logan_pack_encrypted: true;
  v: number;
  kdf: 'scrypt';
  cipher: 'aes-256-gcm';
  salt: string;   // base64
  iv: string;     // base64
  tag: string;    // base64 auth tag
  data: string;   // base64 ciphertext
}

const SCRYPT_N = 16384, SCRYPT_KEYLEN = 32;

export function encryptPack(plaintext: string, passphrase: string): EncryptedEnvelope {
  if (!passphrase) throw new Error('passphrase required');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf-8')), cipher.final()]);
  return {
    logan_pack_encrypted: true,
    v: PACK_FORMAT_VERSION,
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
  };
}

export function decryptPack(env: EncryptedEnvelope, passphrase: string): string {
  if (!passphrase) throw new Error('passphrase required');
  const key = scryptSync(passphrase, Buffer.from(env.salt, 'base64'), SCRYPT_KEYLEN, { N: SCRYPT_N });
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
  return dec.toString('utf-8');
}

export function isEncryptedEnvelope(obj: any): obj is EncryptedEnvelope {
  return !!obj && typeof obj === 'object' && obj.logan_pack_encrypted === true && typeof obj.data === 'string';
}
