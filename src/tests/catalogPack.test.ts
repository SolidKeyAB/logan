import { describe, it, expect } from 'vitest';
import {
  buildPack, serializePack, parsePack, verifyPack, sha256Records,
  collidesWith, mergeRecords, planImport,
  encryptPack, decryptPack, isEncryptedEnvelope,
  CATALOG_IDENTITY, PACK_FORMAT_VERSION,
  CATALOG_EXPORT_POLICY, EXPORTABLE_KINDS, CATALOG_KINDS,
  type CatalogPack,
} from '../main/catalogPack';
import { ENTITY_KINDS } from '../main/entityRegistry';

const META = { createdAt: '2026-09-03T00:00:00.000Z', generator: 'logan test' };

const sampleStores = () => ({
  search: [{ id: 's1', pattern: 'ERROR', isRegex: false }],
  filter: [{ id: 'f1', name: 'errors only', levels: ['ERROR'] }],
  constant: [{ name: 'vin', value: 'ABC123', createdAt: 'x', updatedAt: 'x' }],
});

describe('buildPack / manifest', () => {
  it('builds a pack with per-kind counts + checksums in stable order', () => {
    const pack = buildPack(sampleStores(), META);
    expect(pack.logan_pack).toBe(PACK_FORMAT_VERSION);
    expect(pack.manifest.app).toBe('logan');
    expect(pack.manifest.createdAt).toBe(META.createdAt);
    // CATALOG_KINDS order: search before filter before constant
    expect(pack.manifest.kinds.map(k => k.kind)).toEqual(['search', 'filter', 'constant']);
    const searchEntry = pack.manifest.kinds.find(k => k.kind === 'search')!;
    expect(searchEntry.count).toBe(1);
    expect(searchEntry.sha256).toBe(sha256Records(pack.stores.search));
  });

  it('coerces missing/non-array stores to empty and skips unknown keys', () => {
    const pack = buildPack({ filter: null as any, bogus: [{}] as any }, META);
    expect(pack.manifest.kinds.find(k => k.kind === 'filter')!.count).toBe(0);
    expect(pack.manifest.kinds.find(k => k.kind === 'bogus')).toBeUndefined();
    expect('bogus' in pack.stores).toBe(false);
  });
});

describe('serialize / parse', () => {
  it('round-trips through JSON', () => {
    const pack = buildPack(sampleStores(), META);
    const back = parsePack(serializePack(pack));
    expect(back).toEqual(pack);
  });

  it('rejects non-packs with clear errors', () => {
    expect(() => parsePack('not json')).toThrow(/not JSON/);
    expect(() => parsePack('{}')).toThrow(/logan_pack/);
    expect(() => parsePack(JSON.stringify({ logan_pack: 1 }))).toThrow(/manifest/);
  });

  it('rejects a newer format version', () => {
    const future = JSON.stringify({ logan_pack: PACK_FORMAT_VERSION + 1, manifest: {}, stores: {} });
    expect(() => parsePack(future)).toThrow(/newer/);
  });
});

describe('verifyPack', () => {
  it('passes a freshly built pack', () => {
    const pack = buildPack(sampleStores(), META);
    expect(verifyPack(pack)).toEqual({ ok: true, problems: [] });
  });

  it('flags a tampered store (checksum + count mismatch)', () => {
    const pack = buildPack(sampleStores(), META);
    pack.stores.search.push({ id: 's2', pattern: 'WARN' }); // mutate after packing
    const res = verifyPack(pack);
    expect(res.ok).toBe(false);
    expect(res.problems.some(p => p.kind === 'search' && /checksum/.test(p.message))).toBe(true);
    expect(res.problems.some(p => p.kind === 'search' && /count/.test(p.message))).toBe(true);
  });

  it('flags an undeclared store', () => {
    const pack = buildPack(sampleStores(), META);
    (pack.stores as any).session = [{ id: 'x' }];
    expect(verifyPack(pack).problems.some(p => p.kind === 'session' && /not declared/.test(p.message))).toBe(true);
  });
});

describe('collidesWith', () => {
  const spec = CATALOG_IDENTITY.filter;
  it('matches by id', () => {
    expect(collidesWith({ id: 'a', name: 'X' }, { id: 'a', name: 'Y' }, spec)).toBe(true);
  });
  it('matches by name (case/space-insensitive)', () => {
    expect(collidesWith({ id: 'a', name: 'Errors Only' }, { id: 'b', name: ' errors only ' }, spec)).toBe(true);
  });
  it('does not match distinct records', () => {
    expect(collidesWith({ id: 'a', name: 'X' }, { id: 'b', name: 'Y' }, spec)).toBe(false);
  });
  it('ignores empty ids/names', () => {
    expect(collidesWith({ id: '', name: '' }, { id: '', name: '' }, spec)).toBe(false);
  });
});

describe('mergeRecords', () => {
  const spec = CATALOG_IDENTITY.filter;
  const existing = [{ id: 'a', name: 'errors' }];

  it('adds non-colliding records', () => {
    const r = mergeRecords(existing, [{ id: 'b', name: 'warnings' }], spec, 'skip');
    expect(r.added).toBe(1);
    expect(r.merged).toHaveLength(2);
  });

  it('skip keeps existing on collision', () => {
    const r = mergeRecords(existing, [{ id: 'a', name: 'errors', extra: 1 }], spec, 'skip');
    expect(r).toMatchObject({ added: 0, skipped: 1, overwritten: 0, keptBoth: 0 });
    expect(r.merged).toHaveLength(1);
    expect(r.merged[0].extra).toBeUndefined();
  });

  it('overwrite replaces existing on collision', () => {
    const r = mergeRecords(existing, [{ id: 'a', name: 'errors', extra: 1 }], spec, 'overwrite');
    expect(r.overwritten).toBe(1);
    expect(r.merged).toHaveLength(1);
    expect(r.merged[0].extra).toBe(1);
  });

  it('keepBoth clones id-keyed record with a fresh id, names untouched', () => {
    const r = mergeRecords(existing, [{ id: 'a', name: 'errors' }], spec, 'keepBoth', { newId: () => 'NEW' });
    expect(r.keptBoth).toBe(1);
    expect(r.merged).toHaveLength(2);
    expect(r.merged[1].id).toBe('NEW');
    expect(r.merged[1].name).toBe('errors');
  });

  it('keepBoth suffixes the name for name-keyed kinds (constants)', () => {
    const cspec = CATALOG_IDENTITY.constant;
    const cur = [{ name: 'vin', value: '1' }];
    const r = mergeRecords(cur, [{ name: 'vin', value: '2' }], cspec, 'keepBoth');
    expect(r.merged).toHaveLength(2);
    expect(r.merged[1].name).toBe('vin (imported)');
    expect(r.merged[1].value).toBe('2');
  });

  it('dedups incoming-vs-incoming', () => {
    const r = mergeRecords([], [{ id: 'a', name: 'x' }, { id: 'a', name: 'x2' }], spec, 'skip');
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
  });
});

describe('planImport', () => {
  it('reports add vs conflict per kind + unknown kinds', () => {
    const pack = buildPack({
      search: [{ id: 's1', pattern: 'A' }, { id: 's2', pattern: 'B' }],
      filter: [{ id: 'f1', name: 'errors' }],
    }, META) as CatalogPack;
    (pack.stores as any).mysteryKind = [{ id: 'z' }]; // not in CATALOG_IDENTITY
    const existing = { search: [{ id: 's1', pattern: 'A' }], filter: [] as any[] };
    const plan = planImport(existing, pack);
    const searchPlan = plan.stores.find(s => s.kind === 'search')!;
    expect(searchPlan).toMatchObject({ incoming: 2, existing: 1, add: 1, conflict: 1 });
    expect(plan.totalConflict).toBe(1);
    expect(plan.unknownKinds).toContain('mysteryKind');
  });
});

// The forcing function: if a new EntityKind is added but not wired into the catalogue, these
// fail (alongside the tsc gates on CATALOG_EXPORT_POLICY / buildCatalogRegistry). This is what
// keeps export/import in lockstep with the entity registry as LOGAN grows.
describe('export coverage guardrail', () => {
  it('classifies EVERY entity kind (policy ⇔ ENTITY_KINDS)', () => {
    // If this fails, a new kind was added to entityRegistry — add it to CATALOG_EXPORT_POLICY
    // (export:true → also add to CATALOG_IDENTITY + buildCatalogRegistry; else export:false + reason).
    expect(Object.keys(CATALOG_EXPORT_POLICY).sort()).toEqual([...ENTITY_KINDS].sort());
  });

  it('identity table covers exactly the exportable kinds', () => {
    expect(Object.keys(CATALOG_IDENTITY).sort()).toEqual([...EXPORTABLE_KINDS].sort());
  });

  it('CATALOG_KINDS (export order) matches the exportable set', () => {
    expect([...CATALOG_KINDS].sort()).toEqual([...EXPORTABLE_KINDS].sort());
  });

  it('every excluded kind states a reason', () => {
    for (const [kind, d] of Object.entries(CATALOG_EXPORT_POLICY)) {
      if (!d.export) expect(d.reason, `excluded kind "${kind}" needs a reason`).toBeTruthy();
    }
  });

  it('records the current export decisions (baselines in, per-file context out)', () => {
    // A deliberate snapshot: changing what's exportable should show up as a diff here.
    expect(EXPORTABLE_KINDS).toContain('baseline');
    expect(CATALOG_EXPORT_POLICY.contextManifest.export).toBe(false);
  });

  it('every identity spec has at least one id key and one name key', () => {
    for (const [kind, spec] of Object.entries(CATALOG_IDENTITY)) {
      expect(spec.idKeys.length, `${kind} idKeys`).toBeGreaterThan(0);
      expect(spec.nameKeys.length, `${kind} nameKeys`).toBeGreaterThan(0);
    }
  });
});

describe('encryption round-trip', () => {
  it('encrypts and decrypts with the right passphrase', () => {
    const pack = buildPack(sampleStores(), META);
    const text = serializePack(pack);
    const env = encryptPack(text, 'hunter2');
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(env.data).not.toContain('ERROR');
    expect(decryptPack(env, 'hunter2')).toBe(text);
  });

  it('fails to decrypt with the wrong passphrase', () => {
    const env = encryptPack('secret', 'right');
    expect(() => decryptPack(env, 'wrong')).toThrow();
  });

  it('isEncryptedEnvelope rejects a plain pack', () => {
    const pack = buildPack(sampleStores(), META);
    expect(isEncryptedEnvelope(pack)).toBe(false);
  });
});
