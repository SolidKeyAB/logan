// ─── Context Manifest — the static-environment entity ────────────────────────
// The "logs + env" half of LOGAN's coverage: a small, typed key/value store of the
// STATIC facts a log was captured under — build id, firmware, device model, feature
// flags, config dump — each with optional provenance. Time-varying env already rides
// the trend/Signals engine; this holds what does NOT change over the log's lifetime.
//
// Persisted as a per-file sidecar (.logan/<file>.context-manifest.json — the fs
// read/write lives in index.ts next to the agent-memory scratchpad), surfaced to both
// operators through the entity registry (kind 'contextManifest'), and injected into:
//   • logan_evidence_pack  — so the agent sees the env up front,
//   • logan_save_report    — an "Environment" section conditioning the findings,
//   • the baseline fingerprint — so a build/firmware change is reported as env drift
//     ("build 4.1 → 4.2") instead of being misread as an anomaly.
//
// This module is PURE (no fs / electron / Date.now) so the merge + diff semantics stay
// trivially unit-testable (see src/tests/contextManifest.test.ts), mirroring
// entityRegistry.ts. The caller supplies `now`.

// One environment fact: its value plus where it came from.
export interface ContextFact {
  value: string;              // the fact, e.g. "4.2.1"
  source?: string;            // provenance: "header line 3", "device boot banner", "user"
}

export interface ContextManifest {
  facts: Record<string, ContextFact>;   // key → { value, source }
  updatedAt: number;                     // epoch ms (caller-supplied)
  agentName?: string;                    // who last wrote it
}

export function emptyManifest(): ContextManifest {
  return { facts: {}, updatedAt: 0 };
}

export interface MergeOpts {
  provenance?: Record<string, string>;   // per-key source override
  source?: string;                       // fallback source for keys without their own
  replace?: boolean;                     // discard existing facts before applying patch
  agentName?: string;
  now: number;                           // epoch ms — caller supplies (keeps module pure)
}

/**
 * Merge a key→value patch into an existing manifest, returning a NEW manifest (never
 * mutates the input). A blank/whitespace value DELETES that key. `replace` starts from
 * an empty manifest. Keys are trimmed; empty keys are ignored.
 */
export function mergeFacts(
  existing: ContextManifest | null,
  patch: Record<string, string>,
  opts: MergeOpts,
): ContextManifest {
  const base: ContextManifest = (opts.replace || !existing)
    ? emptyManifest()
    : { facts: { ...existing.facts }, updatedAt: existing.updatedAt, ...(existing.agentName ? { agentName: existing.agentName } : {}) };

  for (const [rawKey, rawVal] of Object.entries(patch || {})) {
    const key = String(rawKey).trim();
    if (!key) continue;
    if (rawVal == null || String(rawVal).trim() === '') {
      delete base.facts[key];
      continue;
    }
    const src = (opts.provenance && opts.provenance[key]) || opts.source;
    base.facts[key] = { value: String(rawVal).trim(), ...(src ? { source: String(src).trim() } : {}) };
  }

  base.updatedAt = opts.now;
  if (opts.agentName) base.agentName = opts.agentName;
  return base;
}

/** Flatten a manifest to a plain key→value map (for fingerprint storage + display). */
export function factsToPlain(m: ContextManifest | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!m || !m.facts) return out;
  for (const [k, f] of Object.entries(m.facts)) {
    if (f && typeof f.value === 'string') out[k] = f.value;
  }
  return out;
}

/** Count of attached facts — 0 for a null/empty manifest. */
export function factCount(m: ContextManifest | null | undefined): number {
  return m && m.facts ? Object.keys(m.facts).length : 0;
}

// Key-by-key diff of two flattened env maps.
export interface EnvDiff {
  changed: Array<{ key: string; from: string; to: string }>;  // value differs
  added: Array<{ key: string; value: string }>;               // only in current
  removed: Array<{ key: string; value: string }>;             // only in baseline
}

export function diffEnv(
  baseline: Record<string, string> | undefined | null,
  current: Record<string, string> | undefined | null,
): EnvDiff {
  const bl = baseline || {};
  const cur = current || {};
  const changed: EnvDiff['changed'] = [];
  const added: EnvDiff['added'] = [];
  const removed: EnvDiff['removed'] = [];
  const keys = new Set([...Object.keys(bl), ...Object.keys(cur)]);
  for (const k of Array.from(keys).sort()) {
    const b = bl[k];
    const c = cur[k];
    if (b !== undefined && c !== undefined) {
      if (b !== c) changed.push({ key: k, from: b, to: c });
    } else if (c !== undefined) {
      added.push({ key: k, value: c });
    } else {
      removed.push({ key: k, value: b });
    }
  }
  return { changed, added, removed };
}

export function envDiffIsEmpty(d: EnvDiff): boolean {
  return d.changed.length === 0 && d.added.length === 0 && d.removed.length === 0;
}

/** Human one-liners for an EnvDiff, e.g. ["build 4.1 → 4.2", "+device=X100", "-flag.tls (was on)"]. */
export function envDiffToStrings(d: EnvDiff): string[] {
  const out: string[] = [];
  for (const c of d.changed) out.push(`${c.key} ${c.from} → ${c.to}`);
  for (const a of d.added) out.push(`+${a.key}=${a.value}`);
  for (const r of d.removed) out.push(`-${r.key} (was ${r.value})`);
  return out;
}
