import { describe, it, expect } from 'vitest';
import {
  VERB_REGISTRY,
  canonicalizeHumanVerb,
  canonicalizeAiVerb,
  canonicalizeVerb,
  featureDisplayName,
  aggregateUsageByFeature,
} from '../shared/verbRegistry';

describe('canonical verb registry', () => {
  it('maps a human action and its AI slug onto the SAME feature', () => {
    expect(canonicalizeHumanVerb('filter_applied')).toBe('filter');
    expect(canonicalizeAiVerb('filter')).toBe('filter');
    expect(canonicalizeHumanVerb('analysis_run')).toBe('analyze');
    expect(canonicalizeAiVerb('analyze')).toBe('analyze');
  });

  it('joins the human 🔗 single-session action with the AI composite-create slug', () => {
    // Single-session create parity (2026-08-18): human 🔗 button logs 'composite_created',
    // the agent's logan_single_session hits /api/composite-create → both canonicalize to one feature.
    expect(canonicalizeHumanVerb('composite_created')).toBe('composite-create');
    expect(canonicalizeAiVerb('composite-create')).toBe('composite-create');
    expect(featureDisplayName('composite-create')).toBe('Single session');
    const rows = aggregateUsageByFeature([
      { verb: 'composite_created', operator: 'human', count: 2, lastUsed: '2026-08-18T10:00:00.000Z' },
      { verb: 'composite-create', operator: 'ai', count: 1, lastUsed: '2026-08-18T11:00:00.000Z' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].feature).toBe('composite-create');
    expect(rows[0].human).toBe(2);
    expect(rows[0].ai).toBe(1);
  });

  it('is idempotent — canonicalizing an already-canonical verb returns it unchanged', () => {
    for (const f of VERB_REGISTRY) {
      // A stored feature id must round-trip for both operators.
      expect(canonicalizeHumanVerb(f.feature)).toBe(f.feature);
      expect(canonicalizeAiVerb(f.feature)).toBe(f.feature);
    }
  });

  it('passes unknown verbs through as identity (no data loss)', () => {
    expect(canonicalizeAiVerb('mystery-verb')).toBe('mystery-verb');
    expect(canonicalizeHumanVerb('panel:usage')).toBe('panel:usage');
    expect(canonicalizeVerb('whatever', 'ai')).toBe('whatever');
  });

  it('has no duplicate feature ids and no verb claimed by two features', () => {
    const features = VERB_REGISTRY.map(f => f.feature);
    expect(new Set(features).size).toBe(features.length);
    const human = VERB_REGISTRY.flatMap(f => f.humanActions);
    expect(new Set(human).size).toBe(human.length);
    const ai = VERB_REGISTRY.flatMap(f => f.aiSlugs);
    expect(new Set(ai).size).toBe(ai.length);
  });

  it('gives every feature a display name; falls back to a prettified label', () => {
    expect(featureDisplayName('filter')).toBe('Filter');
    expect(featureDisplayName('search')).toBe('Search');
    expect(featureDisplayName('panel:usage')).toBe('Panel: Usage');
    expect(featureDisplayName('some-unknown-verb')).toBe('Some unknown verb');
  });

  it('joins human + AI counts per feature when aggregating', () => {
    const rows = aggregateUsageByFeature([
      { verb: 'filter_applied', operator: 'human', count: 3, lastUsed: '2026-08-06T10:00:00.000Z' },
      { verb: 'filter', operator: 'ai', count: 5, lastUsed: '2026-08-06T11:00:00.000Z' },
      { verb: 'search', operator: 'human', count: 2, lastUsed: '2026-08-06T09:00:00.000Z' },
      { verb: 'search', operator: 'ai', count: 1, lastUsed: '2026-08-06T09:30:00.000Z' },
    ]);
    const filter = rows.find(r => r.feature === 'filter');
    expect(filter).toBeDefined();
    expect(filter!.human).toBe(3);
    expect(filter!.ai).toBe(5);
    expect(filter!.total).toBe(8);
    expect(filter!.lastUsed).toBe('2026-08-06T11:00:00.000Z');
    // Sorted by total desc → filter (8) before search (3).
    expect(rows[0].feature).toBe('filter');
    expect(rows[0].display).toBe('Filter');
  });

  it('merges legacy (raw) and canonical stored verbs into one feature row', () => {
    const rows = aggregateUsageByFeature([
      { verb: 'filter_applied', operator: 'human', count: 2, lastUsed: '2026-08-05T00:00:00.000Z' }, // legacy human
      { verb: 'filter', operator: 'human', count: 4, lastUsed: '2026-08-06T00:00:00.000Z' },         // canonicalized human
      { verb: 'filter', operator: 'ai', count: 1, lastUsed: '2026-08-06T00:00:00.000Z' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].feature).toBe('filter');
    expect(rows[0].human).toBe(6);
    expect(rows[0].ai).toBe(1);
  });

  it('tolerates malformed entries without throwing', () => {
    const rows = aggregateUsageByFeature([
      { verb: 'search', operator: 'human', count: Number.NaN as unknown as number },
      // @ts-expect-error — intentionally malformed
      { operator: 'ai', count: 3 },
      // @ts-expect-error — intentionally malformed
      null,
    ]);
    const search = rows.find(r => r.feature === 'search');
    expect(search!.human).toBe(0); // NaN coerced to 0
  });
});
