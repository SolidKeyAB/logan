// Investigation templates — capture the ordered sequence of investigative tool
// calls the agent (or user-driven agent) made for a ticket, and replay it later
// on a new log. Captured calls live as a "journal" in the api-server; this module
// turns a journal into a named, parameterised, re-runnable template on disk.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RequirementsManifest } from './investigationRequirements';
import { StepGuard } from '../shared/recipeComposition';

// One recorded investigative tool call.
export interface JournalEntry {
  path: string;                 // api path, e.g. '/api/search'
  body: Record<string, any>;    // the call's params
  ts: number;
  label: string;                // human summary, e.g. 'search "auth fail"'
  result?: string;              // compact outcome of the call, e.g. '42 matches' (Build 2)
}

// Classification of a fill-in noun — drives ordering + typing of the human
// tweak-before-replay form (time/range windows first, then component, …).
export type ParamKind = 'time' | 'range' | 'component' | 'field' | 'pattern' | 'event' | 'other';

// Whether a param is meant to CHANGE per incident (variable — prompt on replay)
// or is a fixed part of the recipe shape (constant — pinned, shown read-only).
// Orthogonal to ParamKind: kind = the noun TYPE, role = variable-vs-constant.
// Added 2026-08-25 (P0a real parameterized templates); back-filled on read.
export type ParamRole = 'variable' | 'constant';

export interface ParamDef {
  key: string;                  // the body key this param fills, e.g. 'component'
  stepIndex: number;            // which step it belongs to
  label: string;                // display label
  default: any;                 // value captured at record time
  kind?: ParamKind;             // declared noun kind (added 2026-08-20; back-filled for old templates)
  role?: ParamRole;             // variable = prompt on replay; constant = pinned (added 2026-08-25)
  description?: string;         // optional human note, e.g. "device serial for this incident"
}

export interface TemplateStep {
  path: string;
  body: Record<string, any>;
  label: string;
  result?: string;              // outcome captured when the step was recorded (Build 2)
  when?: StepGuard;             // conditional guard (composite recipes): run this step only if
                                // the PREVIOUS step's typed answer satisfies it. Absent = always.
}

export interface InvestigationTemplate {
  name: string;
  slug: string;
  createdAt: number;
  sourceFile?: string;          // log the template was recorded from (for reference)
  sourceFiles?: string[];       // ALL distinct logs the recorded steps ran against — so the
                                // user can see which file(s)/type(s) it was built on and knows
                                // what to apply it to next time (esp. a multi-file investigation)
  aim?: string;                 // what this recipe is FOR — the question it sets out to answer
                                // ("find the root-cause component of the 401 storm")
  description?: string;
  answerStepIndex?: number;     // which step produces the ANSWER (the valuable output that
                                // answers the aim). Unset => the run shows a HEURISTIC answer
                                // (the last output-producing step), flagged as a best guess.
  steps: TemplateStep[];
  params: ParamDef[];           // promoted fill-ins (component/field/pattern/event/…)
  requirements?: RequirementsManifest; // preconditions: file-template + expected saved entities
  composite?: boolean;          // true = a "recipe of recipes": every step runs a saved
                                // sub-recipe (path '/api/investigation-run'), optionally guarded.
}

// Body keys worth exposing as fill-in parameters when replaying on a new log.
// Time-window / range keys lead: the #1 noun to tweak when rerunning a past
// root-cause hunt on a NEW incident is the window, component second.
export const PARAM_KEYS = ['startTime', 'endTime', 'startLine', 'endLine', 'component', 'field', 'pattern', 'event', 'expect', 'analyzerName', 'thresholdSeconds'];

// Classify a body key into a ParamKind (ordering + typing of the tweak-form).
export function paramKind(key: string): ParamKind {
  switch (key) {
    case 'startTime': case 'endTime': return 'time';
    case 'startLine': case 'endLine': return 'range';
    case 'component': return 'component';
    case 'field': return 'field';
    case 'pattern': return 'pattern';
    case 'event': return 'event';
    default: return 'other';
  }
}

// Heuristic: does a captured value look incident-specific (a request-id, serial,
// hash, token, absolute timestamp/line window) rather than a structural part of
// the recipe? Drives the variable-vs-constant DEFAULT only — the user overrides.
export function valueLooksIncidentSpecific(value: any): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return true;              // a raw number = a specific line/threshold/count
  const s = String(value);
  if (!s) return false;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s)) return true; // UUID
  if (/\b[0-9a-fA-F]{8,}\b/.test(s)) return true;          // long hex run (hash/address/token)
  if (/\d{5,}/.test(s)) return true;                       // long digit run (id/serial/epoch)
  if (/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return true; // ISO-ish timestamp
  return false;
}

// Derive the DEFAULT role for a promoted param — zero-migration, applied at read
// time (like kind back-fill) and at build/promote time. Structural nouns that
// define the hunt (component/field/event, config keys) default to constant; the
// per-incident window (time/range) defaults to variable; a pattern is variable
// only when it embeds an incident-specific literal. The user overrides freely.
export function deriveRole(key: string, value: any, kind?: ParamKind): ParamRole {
  const k = kind || paramKind(key);
  switch (k) {
    case 'time': case 'range': return 'variable';
    case 'component': case 'field': case 'event': return 'constant';
    case 'pattern': return valueLooksIncidentSpecific(value) ? 'variable' : 'constant';
    default:
      if (key === 'expect' || key === 'analyzerName' || key === 'thresholdSeconds') return 'constant';
      return valueLooksIncidentSpecific(value) ? 'variable' : 'constant';
  }
}

// Back-fill fields that older on-disk templates may lack (currently the param
// `kind`, added 2026-08-20) so every consumer sees a complete param schema.
function normalizeTemplate(tpl: InvestigationTemplate): InvestigationTemplate {
  if (Array.isArray(tpl.params)) {
    for (const p of tpl.params) {
      if (!p.kind) p.kind = paramKind(p.key);
      if (!p.role) p.role = deriveRole(p.key, p.default, p.kind); // back-fill role (added 2026-08-25)
    }
  }
  return tpl;
}

const TEMPLATES_DIR = path.join(os.homedir(), '.logan', 'investigate-templates');

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'template';
}

function ensureDir(): void {
  try { fs.mkdirSync(TEMPLATES_DIR, { recursive: true }); } catch { /* ignore */ }
}

// Turn a recorded journal into a parameterised template.
export function buildTemplate(name: string, journal: JournalEntry[], sourceFile?: string, description?: string, requirements?: RequirementsManifest, aim?: string, sourceFiles?: string[]): InvestigationTemplate {
  const steps: TemplateStep[] = journal.map(e => ({ path: e.path, body: { ...e.body }, label: e.label, result: e.result }));
  const params: ParamDef[] = [];
  steps.forEach((step, i) => {
    for (const key of PARAM_KEYS) {
      const v = step.body[key];
      if (v !== undefined && v !== null && v !== '') {
        const kind = paramKind(key);
        params.push({ key, stepIndex: i, label: `${stepLabel(step)} · ${key}`, default: v, kind, role: deriveRole(key, v, kind) });
      }
    }
  });
  // Keep sourceFiles distinct + non-empty; fall back to the single sourceFile.
  const files = Array.from(new Set((sourceFiles && sourceFiles.length ? sourceFiles : (sourceFile ? [sourceFile] : [])).filter(Boolean)));
  return { name, slug: slugify(name), createdAt: Date.now(), sourceFile, sourceFiles: files.length ? files : undefined, aim, description, steps, params, requirements };
}

function stepLabel(step: TemplateStep): string {
  return step.label || step.path.replace('/api/', '');
}

export function saveTemplate(tpl: InvestigationTemplate): string {
  ensureDir();
  const file = path.join(TEMPLATES_DIR, tpl.slug + '.json');
  fs.writeFileSync(file, JSON.stringify(tpl, null, 2));
  return file;
}

export function listTemplates(): InvestigationTemplate[] {
  ensureDir();
  const out: InvestigationTemplate[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    try {
      const tpl = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf-8'));
      if (tpl && Array.isArray(tpl.steps)) out.push(normalizeTemplate(tpl));
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function getTemplate(slugOrName: string): InvestigationTemplate | null {
  const slug = slugify(slugOrName);
  ensureDir();
  const file = path.join(TEMPLATES_DIR, slug + '.json');
  try {
    if (fs.existsSync(file)) return normalizeTemplate(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch { /* ignore */ }
  // Fall back to scanning by name (listTemplates already normalizes)
  return listTemplates().find(t => t.slug === slug || t.name === slugOrName) || null;
}

export function deleteTemplate(slugOrName: string): boolean {
  const slug = slugify(slugOrName);
  const file = path.join(TEMPLATES_DIR, slug + '.json');
  try {
    if (fs.existsSync(file)) { fs.unlinkSync(file); return true; }
  } catch { /* ignore */ }
  return false;
}

// Apply param overrides (key→value) to a copy of the template's steps.
// Constants are PINNED: they keep their recorded value and are never overridden
// on replay (enforced here so no operator — human or agent — can move a value the
// author locked as part of the recipe's fixed shape). Only variables are tweakable.
export function resolveSteps(tpl: InvestigationTemplate, overrides: Record<string, any> = {}): TemplateStep[] {
  const steps = tpl.steps.map(s => ({ ...s, body: { ...s.body } }));
  // Overrides are matched by param key; if a key appears in multiple steps, all are updated.
  for (const p of tpl.params) {
    if (p.role === 'constant') continue; // pinned — recipe shape, not tweakable on replay
    if (overrides[p.key] !== undefined && steps[p.stepIndex]) {
      steps[p.stepIndex].body[p.key] = overrides[p.key];
    }
  }
  return steps;
}

// The subset of params a replay should PROMPT for — variables only. Constants are
// still exposed to callers (rendered read-only) so the recipe shape stays legible.
export function variableParams(tpl: InvestigationTemplate): ParamDef[] {
  return (tpl.params || []).filter(p => (p.role || 'variable') === 'variable');
}

// A curation edit to a template's params: retype an existing param's role/label/
// description, PROMOTE an arbitrary (stepIndex, key) body value into a param, or
// DEMOTE (remove) a param back to a plain pinned body value.
export interface ParamPatch {
  stepIndex: number;
  key: string;
  role?: ParamRole;
  label?: string;
  description?: string;
  default?: any;                // set the param's captured value (+ the step body) — "save tweaks as new defaults"
  remove?: boolean;             // demote: drop this param (value stays in the step body)
}

// Apply curation patches to a template in memory. Promotion requires the value to
// actually exist in that step's body (we never fabricate a fill-in). Returns the
// mutated template; callers persist with saveTemplate / setTemplateParams.
export function applyParamPatches(tpl: InvestigationTemplate, patches: ParamPatch[]): { tpl: InvestigationTemplate; applied: number; errors: string[] } {
  const errors: string[] = [];
  let applied = 0;
  if (!Array.isArray(tpl.params)) tpl.params = [];
  for (const patch of patches || []) {
    const { stepIndex, key } = patch;
    if (typeof stepIndex !== 'number' || !key) { errors.push(`invalid patch (need stepIndex+key): ${JSON.stringify(patch)}`); continue; }
    const step = tpl.steps[stepIndex];
    if (!step) { errors.push(`no step at index ${stepIndex}`); continue; }
    const idx = tpl.params.findIndex(p => p.stepIndex === stepIndex && p.key === key);
    if (patch.remove) {
      if (idx >= 0) { tpl.params.splice(idx, 1); applied++; }
      else errors.push(`no param to remove at step ${stepIndex} key "${key}"`);
      continue;
    }
    if (idx >= 0) {
      const p = tpl.params[idx];
      if (patch.role) p.role = patch.role;
      if (patch.label) p.label = patch.label;
      if (patch.description !== undefined) p.description = patch.description;
      // Persist a tweaked value as the param's NEW default (and mirror it into the step
      // body so a replay with no overrides now uses it) — "Save" in the template hub.
      // Roles/labels are preserved (unlike a fork, which re-derives them).
      if (patch.default !== undefined) { p.default = patch.default; step.body[key] = patch.default; }
      applied++;
    } else {
      // Promotion: the value must be present in the step body.
      const v = step.body[key];
      if (v === undefined || v === null || v === '') { errors.push(`cannot promote step ${stepIndex} key "${key}" — no value in body`); continue; }
      const kind = paramKind(key);
      tpl.params.push({
        key, stepIndex, label: patch.label || `${stepLabel(step)} · ${key}`, default: v, kind,
        role: patch.role || deriveRole(key, v, kind),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
      });
      applied++;
    }
  }
  // Keep params ordered by step then key for stable rendering.
  tpl.params.sort((a, b) => a.stepIndex - b.stepIndex || a.key.localeCompare(b.key));
  return { tpl, applied, errors };
}

// Load a template, apply param curation patches, persist. Returns the saved
// template (normalized) or null if not found.
export function setTemplateParams(slugOrName: string, patches: ParamPatch[]): { tpl: InvestigationTemplate; applied: number; errors: string[] } | null {
  const tpl = getTemplate(slugOrName);
  if (!tpl) return null;
  const res = applyParamPatches(tpl, patches);
  saveTemplate(res.tpl);
  return res;
}
