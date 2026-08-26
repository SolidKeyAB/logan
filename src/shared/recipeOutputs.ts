// Recipe outputs — what a saved investigation (a "recipe") YIELDS.
//
// A recipe is a typed transform: inputs (its params + requirements) → steps → OUTPUTS.
// The inputs were already modelled (ParamDef roles + RequirementsManifest); this is the
// output half. v1 DERIVES the output kinds from the recorded step verbs (zero migration,
// same derive-at-read trick as ParamRole) so a recipe can advertise "what it produces"
// before you run it, and the run can present its result as an explicit Output. A future
// slice can let a recipe AUTHOR/declare its outputs explicitly.
//
// Pure (no DOM) so it's unit-tested headlessly; the renderer mirrors it as a script fn.

// api path → the human label of the output that step produces (null = not an output verb).
const OUTPUT_LABEL_BY_PATH: Record<string, string> = {
  '/api/search': 'matches',
  '/api/filter': 'filtered view',
  '/api/analyze': 'level breakdown',
  '/api/time-gaps': 'time gaps',
  '/api/investigate-crashes': 'crash findings',
  '/api/investigate-component': 'component health',
  '/api/investigate-timerange': 'timerange findings',
  '/api/triage': 'triage',
  '/api/build-conclusion': 'verdict',
  '/api/summarize': 'templates',
  '/api/evidence-pack': 'evidence pack',
  '/api/diff-runs': 'run diff',
};

export function outputLabelForPath(path: string | undefined): string | null {
  if (!path) return null;
  if (OUTPUT_LABEL_BY_PATH[path]) return OUTPUT_LABEL_BY_PATH[path];
  if (path.startsWith('/api/trend')) return 'trend';
  return null;
}

/** Distinct output kinds a recipe yields, in first-seen order (its output "signature"). */
export function deriveRecipeOutputs(steps: Array<{ path?: string }> | undefined): string[] {
  const out: string[] = [];
  for (const s of steps || []) {
    const label = outputLabelForPath(s?.path);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}
