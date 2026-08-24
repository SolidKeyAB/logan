// Workflow graph model (Investigation Workflow Canvas — Phase 0, the pure primitive).
//
// An investigation is captured as a flat, ordered JOURNAL of tool calls (see
// investigationStore.JournalEntry) plus, when saved, a RequirementsManifest that
// references other saved entities by-reference. A *canvas* needs more than a flat
// list: it needs each meaningful step as a typed NODE (verb + tweakable nouns +
// config) with typed EDGES (sequence | dataflow | reference), and the referenced
// entities as their own nodes.
//
// `investigationToGraph()` is that lossless projection. It is PURE and free of
// Electron / FileHandler deps (mirrors columnPattern.ts / investigationRequirements.ts)
// so it stays unit-testable and can run on either operator's side. There is NO UI,
// no store, and no agent verb here — those are later phases. This module only
// establishes the model + the projection contract both operators will share.

import { ParamKind, paramKind, PARAM_KEYS } from './investigationStore';
import { RequirementsManifest, EntityRef } from './investigationRequirements';

export type WorkflowNodeKind = 'step' | 'entity';
// sequence = temporal order; dataflow = a step consumes a prior step's output
// (e.g. scope:'active'); reference = a step (or the workflow) points at a saved entity.
export type WorkflowEdgeKind = 'sequence' | 'dataflow' | 'reference';

// A tweakable "noun" of a step — the fill-ins the replay tweak-form exposes. Shares
// PARAM_KEYS + paramKind with the investigation template so the graph's nouns and the
// template's params[] stay in lockstep (one source of truth).
export interface WorkflowNoun {
  key: string;      // body key, e.g. 'component'
  value: any;       // captured value
  kind: ParamKind;  // time | range | component | field | pattern | event | other
}

export interface WorkflowNode {
  id: string;                 // stable within a graph: 'step-<i>' | 'entity-<kind>:<key>'
  kind: WorkflowNodeKind;
  verb: string;               // step: the tool verb ('search'…); entity: the entity kind
  label: string;              // human summary (from the journal label, else derived)
  // ── step nodes ──
  stepIndex?: number;         // position among KEPT (meaningful) steps
  sourceIndex?: number;       // index in the ORIGINAL journal (before noise filtering)
  nouns?: WorkflowNoun[];     // tweakable fill-ins present on this step
  config?: Record<string, any>; // remaining non-noun body (detail; noise-free)
  result?: string;            // outcome summary — reserved (journal carries none yet)
  // ── entity nodes ──
  entityRef?: EntityRef;      // the saved entity this node stands for (from requirements)
}

export interface WorkflowEdge {
  from: string;               // node id
  to: string;                 // node id
  kind: WorkflowEdgeKind;
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  meta: {
    steps: number;            // kept step nodes
    entities: number;         // entity nodes
    dropped: number;          // journal entries filtered as noise
  };
}

// A journal entry OR a template step — both carry { path, body, label }; ts is optional.
export interface WorkflowStepInput {
  path: string;
  body?: Record<string, any>;
  label?: string;
  ts?: number;
}

// Non-investigative calls that are just navigation / fetching / chat plumbing. They
// carry no analytic meaning, so they never become nodes (Fable review #5: "drop
// journal noise — only meaningful investigative steps become nodes").
const NOISE_PATHS = new Set<string>([
  '/api/get-lines',
  '/api/navigate',
  '/api/status',
  '/api/messages',
  '/api/get-messages',
  '/api/send-message',
  '/api/wait-for-message',
  '/api/get-notes',
  '/api/entities',       // listing the catalog, not acting on the log
]);

// '/api/search' → 'search', '/api/investigate-component' → 'investigate-component'.
export function verbFromPath(path: string): string {
  if (!path) return 'step';
  return path.replace(/^\/api\//, '').replace(/^\//, '') || path;
}

export function isMeaningfulStep(path: string): boolean {
  return !!path && !NOISE_PATHS.has(path);
}

const NOUN_KEYS = new Set(PARAM_KEYS);

function extractNouns(body: Record<string, any>): WorkflowNoun[] {
  const nouns: WorkflowNoun[] = [];
  for (const key of PARAM_KEYS) {
    const v = body[key];
    if (v !== undefined && v !== null && v !== '') nouns.push({ key, value: v, kind: paramKind(key) });
  }
  return nouns;
}

// Non-noun body fields worth keeping as node detail (skip empties + the nouns, which
// are already broken out). Kept small on purpose — the canvas shows nouns, not dumps.
function extractConfig(body: Record<string, any>): Record<string, any> {
  const cfg: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (NOUN_KEYS.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    cfg[k] = v;
  }
  return cfg;
}

// Does a step consume the running "active scope" (the prior step's output)? LOGAN's
// scope param can be the string 'active' or a { type: 'active' } descriptor.
function usesActiveScope(body: Record<string, any>): boolean {
  const s = body.scope;
  if (s === 'active') return true;
  if (s && typeof s === 'object' && (s.type === 'active' || s.kind === 'active')) return true;
  return false;
}

// Heuristic: a step "references" an entity when the entity's name/id appears in the
// step's body (e.g. applying a saved session/highlight/pattern by name). Conservative —
// needs a ≥3-char key so short names don't false-match.
function stepReferencesEntity(step: WorkflowNode, ref: EntityRef): boolean {
  const needle = (ref.name || ref.id || '').toLowerCase();
  if (needle.length < 3) return false;
  const hay = JSON.stringify({ config: step.config || {}, nouns: step.nouns || [] }).toLowerCase();
  return hay.includes(needle);
}

/**
 * Project an investigation journal (+ optional requirements manifest) into a typed
 * workflow graph. Lossless over meaningful steps: every non-noise journal entry becomes
 * a step node in order, joined by `sequence` edges; a step that consumes the active
 * scope gets a `dataflow` edge from its predecessor; each requirements-referenced entity
 * becomes an `entity` node, joined by a `reference` edge from any step that names it.
 *
 * Pure — no I/O, no Electron. Accepts a JournalEntry[] or a TemplateStep[] (both fit
 * WorkflowStepInput). Zero visual; this is the model + contract only.
 */
export function investigationToGraph(
  journal: WorkflowStepInput[] | null | undefined,
  requirements?: RequirementsManifest | null,
): WorkflowGraph {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const stepNodes: WorkflowNode[] = [];
  let dropped = 0;

  (journal || []).forEach((entry, sourceIndex) => {
    if (!entry || !isMeaningfulStep(entry.path)) { dropped++; return; }
    const body = entry.body || {};
    const verb = verbFromPath(entry.path);
    const nouns = extractNouns(body);
    const config = extractConfig(body);
    const stepIndex = stepNodes.length;
    const node: WorkflowNode = {
      id: `step-${stepIndex}`,
      kind: 'step',
      verb,
      label: entry.label || verb,
      stepIndex,
      sourceIndex,
      nouns: nouns.length ? nouns : undefined,
      config: Object.keys(config).length ? config : undefined,
    };
    // dataflow edge: this step reads the prior step's active scope.
    if (stepIndex > 0 && usesActiveScope(body)) {
      edges.push({ from: stepNodes[stepIndex - 1].id, to: node.id, kind: 'dataflow', label: 'active scope' });
    }
    stepNodes.push(node);
    nodes.push(node);
  });

  // sequence edges — the temporal spine.
  for (let i = 1; i < stepNodes.length; i++) {
    edges.push({ from: stepNodes[i - 1].id, to: stepNodes[i].id, kind: 'sequence' });
  }

  // entity nodes + reference edges from the requirements manifest.
  let entities = 0;
  (requirements?.entities ?? []).forEach((ref, i) => {
    const key = ref.id || ref.name || String(i);
    const entityNode: WorkflowNode = {
      id: `entity-${ref.kind}:${key}`,
      kind: 'entity',
      verb: ref.kind,
      label: `${ref.kind}: ${ref.name || ref.id || '(unnamed)'}`,
      entityRef: ref,
    };
    nodes.push(entityNode);
    entities++;
    const owner = stepNodes.find(s => stepReferencesEntity(s, ref));
    if (owner) edges.push({ from: owner.id, to: entityNode.id, kind: 'reference', label: 'uses' });
  });

  return { nodes, edges, meta: { steps: stepNodes.length, entities, dropped } };
}
