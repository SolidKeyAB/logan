import { describe, it, expect } from 'vitest';
import { resolveTier } from '../main/investigationStore';

describe('resolveTier', () => {
  it('defaults an atomic (non-composite) recipe to fundamental', () => {
    expect(resolveTier({ composite: false })).toBe('fundamental');
    expect(resolveTier({})).toBe('fundamental');
  });

  it('defaults a composite recipe to complex', () => {
    expect(resolveTier({ composite: true })).toBe('complex');
  });

  it('an explicit tier overrides the smart default (either direction)', () => {
    // A composite pinned down to fundamental...
    expect(resolveTier({ composite: true, tier: 'fundamental' })).toBe('fundamental');
    // ...and an atomic recipe promoted to complex.
    expect(resolveTier({ composite: false, tier: 'complex' })).toBe('complex');
  });

  it('ignores an invalid tier value and falls back to the default', () => {
    expect(resolveTier({ composite: true, tier: 'nonsense' as any })).toBe('complex');
    expect(resolveTier({ composite: false, tier: '' as any })).toBe('fundamental');
  });
});
