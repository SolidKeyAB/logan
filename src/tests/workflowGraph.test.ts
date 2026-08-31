import { describe, it, expect } from 'vitest';
import { investigationToGraph, verbFromPath, isMeaningfulStep, WorkflowStepInput } from '../main/workflowGraph';
import { RequirementsManifest } from '../main/investigationRequirements';
import { describeGuard } from '../shared/recipeComposition';

// Phase 0 (Investigation Workflow Canvas): the pure journal → WorkflowGraph projection.
// No UI, no store — just the typed model both operators will share.

const journal: WorkflowStepInput[] = [
  { path: '/api/search', body: { pattern: 'auth fail', matchCase: false }, ts: 1, label: 'search "auth fail"' },
  { path: '/api/get-lines', body: { start: 100, count: 20 }, ts: 2, label: 'get lines' },            // NOISE
  { path: '/api/filter', body: { pattern: 'error', scope: 'active' }, ts: 3, label: 'filter error' }, // consumes active scope
  { path: '/api/investigate-component', body: { component: 'auth', startTime: '2026-01-01T00:00:00Z' }, ts: 4, label: 'investigate auth' },
  { path: '/api/navigate', body: { line: 42 }, ts: 5, label: 'navigate' },                            // NOISE
];

describe('verbFromPath', () => {
  it('strips the /api/ prefix', () => {
    expect(verbFromPath('/api/search')).toBe('search');
    expect(verbFromPath('/api/investigate-component')).toBe('investigate-component');
    expect(verbFromPath('')).toBe('step');
  });
});

describe('isMeaningfulStep', () => {
  it('drops navigation / fetch / chat plumbing', () => {
    expect(isMeaningfulStep('/api/search')).toBe(true);
    expect(isMeaningfulStep('/api/get-lines')).toBe(false);
    expect(isMeaningfulStep('/api/navigate')).toBe(false);
  });
});

describe('investigationToGraph', () => {
  it('projects only meaningful steps, in order, with sequence edges', () => {
    const g = investigationToGraph(journal);
    expect(g.meta.steps).toBe(3);          // search, filter, investigate-component
    expect(g.meta.dropped).toBe(2);        // get-lines + navigate
    expect(g.nodes.filter(n => n.kind === 'step').map(n => n.verb)).toEqual(['search', 'filter', 'investigate-component']);
    // sequence spine: step-0 → step-1 → step-2
    const seq = g.edges.filter(e => e.kind === 'sequence');
    expect(seq).toEqual([
      { from: 'step-0', to: 'step-1', kind: 'sequence' },
      { from: 'step-1', to: 'step-2', kind: 'sequence' },
    ]);
  });

  it('keeps sourceIndex pointing at the ORIGINAL journal position', () => {
    const g = investigationToGraph(journal);
    const steps = g.nodes.filter(n => n.kind === 'step');
    expect(steps.map(s => s.sourceIndex)).toEqual([0, 2, 3]); // original indices, noise skipped
    expect(steps.map(s => s.stepIndex)).toEqual([0, 1, 2]);   // compact kept-order
  });

  it('extracts tweakable nouns with their kinds and separates config', () => {
    const g = investigationToGraph(journal);
    const search = g.nodes[0];
    expect(search.nouns).toEqual([{ key: 'pattern', value: 'auth fail', kind: 'pattern' }]);
    expect(search.config).toEqual({ matchCase: false });     // non-noun body kept as detail
    const invc = g.nodes.find(n => n.verb === 'investigate-component')!;
    expect(invc.nouns).toEqual([
      { key: 'startTime', value: '2026-01-01T00:00:00Z', kind: 'time' },
      { key: 'component', value: 'auth', kind: 'component' },
    ]);
  });

  it('emits a dataflow edge when a step consumes the active scope', () => {
    const g = investigationToGraph(journal);
    const df = g.edges.filter(e => e.kind === 'dataflow');
    expect(df).toEqual([{ from: 'step-0', to: 'step-1', kind: 'dataflow', label: 'active scope' }]);
  });

  it('adds entity nodes + a reference edge from a step that names the entity', () => {
    const reqs: RequirementsManifest = {
      entities: [
        { kind: 'search', name: 'auth fail' },   // matches the search step's noun
        { kind: 'filter', name: 'nonexistent-xyz' }, // present as a node, no owner step
      ],
    };
    const g = investigationToGraph(journal, reqs);
    expect(g.meta.entities).toBe(2);
    const entNodes = g.nodes.filter(n => n.kind === 'entity');
    expect(entNodes.map(n => n.id)).toEqual(['entity-search:auth fail', 'entity-filter:nonexistent-xyz']);
    const refs = g.edges.filter(e => e.kind === 'reference');
    expect(refs).toEqual([{ from: 'step-0', to: 'entity-search:auth fail', kind: 'reference', label: 'uses' }]);
  });

  it('handles empty / null journals', () => {
    expect(investigationToGraph([]).nodes).toEqual([]);
    expect(investigationToGraph(null).meta).toEqual({ steps: 0, entities: 0, dropped: 0 });
  });

  it('projects a composite step with its sub-recipe name and conditional guard', () => {
    const g = investigationToGraph([
      { path: '/api/investigation-run', body: { name: 'crash-check', params: {} }, label: '▶ Crash check' },
      { path: '/api/investigation-run', body: { name: 'oom-confirm', params: { component: 'mem' } }, label: '▶ OOM confirm', when: { op: 'true' } },
    ]);
    const steps = g.nodes.filter(n => n.kind === 'step');
    expect(steps.map(s => s.verb)).toEqual(['run recipe', 'run recipe']);
    expect(steps.map(s => s.subRecipe)).toEqual(['crash-check', 'oom-confirm']);
    expect(steps[0].guard).toBeUndefined();               // first step: no guard
    expect(steps[1].guard).toBe(describeGuard({ op: 'true' }));
    // composite bodies aren't scanned for raw nouns/config — the sub-recipe IS the content.
    expect(steps[0].nouns).toBeUndefined();
    expect(steps[0].config).toBeUndefined();
  });

  it('carries a captured result onto the step node (Build 2)', () => {
    const g = investigationToGraph([
      { path: '/api/search', body: { pattern: 'x' }, result: '42 matches', label: 'search x' },
      { path: '/api/filter', body: { levels: ['error'] }, label: 'filter' }, // no result
    ]);
    expect(g.nodes[0].result).toBe('42 matches');
    expect(g.nodes[1].result).toBeUndefined();
  });
});
