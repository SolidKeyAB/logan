// Search-Config similarity / overlap detection.
//
// Two distinct problems, deliberately kept separate because they have DIFFERENT
// correctness guarantees:
//
//   1. EXACT duplicates — same pattern + same flags → provably IDENTICAL match
//      sets. Safe to search once and fan the result out to every chip that
//      shares it (see `groupBySignature`). This is the real "reduce processing"
//      win: an identical regex living in two groups is scanned a single time.
//
//   2. SIMILAR / OVERLAPPING patterns — e.g. `height`, `height=`, `, height=5`.
//      These do NOT have equal match sets, so their searches CANNOT be shared
//      without returning wrong results. What we CAN prove, for plain (non-regex,
//      non-whole-word, same-case) literals, is SUBSUMPTION: if literal A is a
//      substring of literal B, then every line containing B also contains A, so
//      matches(B) ⊆ matches(A) — B is "narrower", A is "broader". We surface
//      that relationship in the UI (a chip badge) so the user can consolidate
//      redundant chips; we never silently merge their searches.
//
// Pure + dependency-free so it can be unit-tested here and MIRRORED verbatim into
// the renderer's script scope (which cannot import). Keep the two copies in sync.

export interface SimConfig {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
}

/**
 * Exact match signature: two configs with the same signature match the exact
 * same set of lines, so one search serves both. Intentionally excludes `id`
 * (identity, not behaviour) and any display/colour fields. Callers that also
 * key on an active filter should prefix their own filter generation.
 */
export function configSignature(
  c: Pick<SimConfig, 'pattern' | 'isRegex' | 'matchCase' | 'wholeWord'>,
): string {
  return `${c.pattern}|${c.isRegex ? 1 : 0}|${c.matchCase ? 1 : 0}|${c.wholeWord ? 1 : 0}`;
}

/**
 * Group config ids by exact signature, preserving first-seen order both of the
 * groups and of the ids within each group. `Map<signature, id[]>`. A group with
 * >1 id is a set of exact duplicates: search the first, copy to the rest.
 */
export function groupBySignature(configs: SimConfig[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const c of configs) {
    const sig = configSignature(c);
    const arr = groups.get(sig);
    if (arr) arr.push(c.id);
    else groups.set(sig, [c.id]);
  }
  return groups;
}

/** How another config's match set relates to THIS config's match set. */
export type OverlapRelation = 'duplicate' | 'broader' | 'narrower';

export interface ConfigOverlap {
  otherId: string;
  otherPattern: string;
  /** Relation of the OTHER config to this one. 'narrower' = other ⊆ this. */
  relation: OverlapRelation;
}

/**
 * Can we PROVE a substring-subsumption relationship between two configs? Only for
 * plain literal matches on comparable terms — anything else (regex, whole-word,
 * mismatched case sensitivity) we refuse to claim, so a flagged overlap is always
 * real. Returns the two patterns normalized for comparison, or null.
 */
function comparableLiterals(a: SimConfig, b: SimConfig): { na: string; nb: string } | null {
  if (a.isRegex || b.isRegex) return null;       // can't reason about arbitrary regex
  if (a.wholeWord || b.wholeWord) return null;    // word boundaries break substring⊆
  if (a.matchCase !== b.matchCase) return null;   // match sets not comparable
  if (!a.pattern || !b.pattern) return null;
  const na = a.matchCase ? a.pattern : a.pattern.toLowerCase();
  const nb = b.matchCase ? b.pattern : b.pattern.toLowerCase();
  return { na, nb };
}

/**
 * For each config, the list of OTHER configs whose match set overlaps it:
 *   - 'duplicate': identical signature (same matches).
 *   - 'narrower' : other's matches are a proven subset of this one's.
 *   - 'broader'  : other's matches are a proven superset of this one's.
 * O(n²) over the (small) chip set. Only proven relationships are reported.
 */
export function computeOverlaps(configs: SimConfig[]): Map<string, ConfigOverlap[]> {
  const out = new Map<string, ConfigOverlap[]>();
  const push = (id: string, o: ConfigOverlap) => {
    const arr = out.get(id);
    if (arr) arr.push(o);
    else out.set(id, [o]);
  };

  for (let i = 0; i < configs.length; i++) {
    for (let j = i + 1; j < configs.length; j++) {
      const a = configs[i];
      const b = configs[j];
      if (a.id === b.id) continue;

      if (configSignature(a) === configSignature(b)) {
        push(a.id, { otherId: b.id, otherPattern: b.pattern, relation: 'duplicate' });
        push(b.id, { otherId: a.id, otherPattern: a.pattern, relation: 'duplicate' });
        continue;
      }

      const lit = comparableLiterals(a, b);
      if (!lit) continue;
      const { na, nb } = lit;
      if (na === nb) continue; // same normalized literal but different flags → not a clean subset

      // A ⊂ B (A's text is inside B's) ⇒ matches(B) ⊆ matches(A): B is narrower.
      if (nb.includes(na)) {
        push(a.id, { otherId: b.id, otherPattern: b.pattern, relation: 'narrower' });
        push(b.id, { otherId: a.id, otherPattern: a.pattern, relation: 'broader' });
      } else if (na.includes(nb)) {
        push(a.id, { otherId: b.id, otherPattern: b.pattern, relation: 'broader' });
        push(b.id, { otherId: a.id, otherPattern: a.pattern, relation: 'narrower' });
      }
    }
  }
  return out;
}

/** A config plus its on/off state — for redundancy decisions that only care about
 *  duplicates that are ACTUALLY running. */
export interface SimConfigState extends SimConfig {
  enabled?: boolean;
}

/**
 * The first already-ENABLED exact duplicate of `candidate` among `existing`, or
 * null. This is the signal to add a brand-new chip switched OFF (its search is
 * fully redundant — an identical enabled chip already produces those matches).
 * Only EXACT duplicates qualify: a narrower/broader overlap is a valid distinct
 * lens and must NOT be auto-disabled. A disabled duplicate also doesn't count —
 * if nothing is running the pattern yet, the new chip should run.
 */
export function firstActiveDuplicate(
  candidate: SimConfig,
  existing: SimConfigState[],
): SimConfigState | null {
  const sig = configSignature(candidate);
  for (const c of existing) {
    if (c.id !== candidate.id && c.enabled !== false && configSignature(c) === sig) return c;
  }
  return null;
}

/**
 * The first already-ENABLED config that is strictly BROADER than `candidate`
 * (candidate's matches ⊆ its), or null — used to gently note "you already have a
 * broader pattern covering these" without disabling the narrower view.
 */
export function firstActiveBroader(
  candidate: SimConfigState,
  existing: SimConfigState[],
): SimConfigState | null {
  const all = [candidate, ...existing.filter(c => c.id !== candidate.id)];
  const overlaps = computeOverlaps(all).get(candidate.id) || [];
  for (const o of overlaps) {
    if (o.relation !== 'broader') continue;
    const other = existing.find(c => c.id === o.otherId);
    if (other && other.enabled !== false) return other;
  }
  return null;
}

/** Human-readable one-liner for a chip's overlap badge tooltip. */
export function describeOverlaps(overlaps: ConfigOverlap[]): string {
  if (!overlaps.length) return '';
  const dup = overlaps.filter(o => o.relation === 'duplicate').map(o => o.otherPattern);
  const broader = overlaps.filter(o => o.relation === 'broader').map(o => o.otherPattern);
  const narrower = overlaps.filter(o => o.relation === 'narrower').map(o => o.otherPattern);
  const parts: string[] = [];
  if (dup.length) parts.push(`Exact duplicate of: ${dup.join(', ')} (searched once, shared)`);
  if (broader.length) parts.push(`Broader patterns that already include these matches: ${broader.join(', ')}`);
  if (narrower.length) parts.push(`Narrower patterns fully contained in this one: ${narrower.join(', ')}`);
  return parts.join('\n');
}
