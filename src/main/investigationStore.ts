// Investigation templates — capture the ordered sequence of investigative tool
// calls the agent (or user-driven agent) made for a ticket, and replay it later
// on a new log. Captured calls live as a "journal" in the api-server; this module
// turns a journal into a named, parameterised, re-runnable template on disk.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// One recorded investigative tool call.
export interface JournalEntry {
  path: string;                 // api path, e.g. '/api/search'
  body: Record<string, any>;    // the call's params
  ts: number;
  label: string;                // human summary, e.g. 'search "auth fail"'
}

export interface ParamDef {
  key: string;                  // the body key this param fills, e.g. 'component'
  stepIndex: number;            // which step it belongs to
  label: string;                // display label
  default: any;                 // value captured at record time
}

export interface TemplateStep {
  path: string;
  body: Record<string, any>;
  label: string;
}

export interface InvestigationTemplate {
  name: string;
  slug: string;
  createdAt: number;
  sourceFile?: string;          // log the template was recorded from (for reference)
  description?: string;
  steps: TemplateStep[];
  params: ParamDef[];           // promoted fill-ins (component/field/pattern/event/…)
}

// Body keys worth exposing as fill-in parameters when replaying on a new log.
const PARAM_KEYS = ['component', 'field', 'pattern', 'event', 'expect', 'analyzerName', 'thresholdSeconds'];

const TEMPLATES_DIR = path.join(os.homedir(), '.logan', 'investigate-templates');

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'template';
}

function ensureDir(): void {
  try { fs.mkdirSync(TEMPLATES_DIR, { recursive: true }); } catch { /* ignore */ }
}

// Turn a recorded journal into a parameterised template.
export function buildTemplate(name: string, journal: JournalEntry[], sourceFile?: string, description?: string): InvestigationTemplate {
  const steps: TemplateStep[] = journal.map(e => ({ path: e.path, body: { ...e.body }, label: e.label }));
  const params: ParamDef[] = [];
  steps.forEach((step, i) => {
    for (const key of PARAM_KEYS) {
      const v = step.body[key];
      if (v !== undefined && v !== null && v !== '') {
        params.push({ key, stepIndex: i, label: `${stepLabel(step)} · ${key}`, default: v });
      }
    }
  });
  return { name, slug: slugify(name), createdAt: Date.now(), sourceFile, description, steps, params };
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
      if (tpl && Array.isArray(tpl.steps)) out.push(tpl);
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function getTemplate(slugOrName: string): InvestigationTemplate | null {
  const slug = slugify(slugOrName);
  ensureDir();
  const file = path.join(TEMPLATES_DIR, slug + '.json');
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { /* ignore */ }
  // Fall back to scanning by name
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
export function resolveSteps(tpl: InvestigationTemplate, overrides: Record<string, any> = {}): TemplateStep[] {
  const steps = tpl.steps.map(s => ({ ...s, body: { ...s.body } }));
  // Overrides are matched by param key; if a key appears in multiple steps, all are updated.
  for (const p of tpl.params) {
    if (overrides[p.key] !== undefined && steps[p.stepIndex]) {
      steps[p.stepIndex].body[p.key] = overrides[p.key];
    }
  }
  return steps;
}
