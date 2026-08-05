// Unified "control-ladder" pattern compiler.
//
// One function compiles any authoring mode down to a single JS RegExp, with
// non-fatal safety warnings and a never-throw contract. Grok / paint delegate
// to the existing columnPattern engine (single source of truth for that logic);
// this layer adds the `plain` convenience mode (literal + case/word/invert
// options), raw-regex validation, and catastrophic-backtracking heuristics.
//
// Kept free of Electron / FileHandler deps so it stays unit-testable and can be
// reused server-side (renderer, MCP/api-server) without wiring.

import { compileColumnPattern, ColumnPatternSpec } from './columnPattern';

export type PatternMode = 'plain' | 'grok' | 'paint' | 'regex';

export interface CompileInput {
  text?: string;
  mode: PatternMode;
  flags?: string;
  sample?: string; // paint
  spans?: { start: number; end: number; name: string }[]; // paint
  matchCase?: boolean; // 'plain'/'options' conveniences
  wholeWord?: boolean;
  invert?: boolean;
}

export interface CompileResult {
  ok: boolean;
  source: string;
  flags: string;
  regex?: RegExp;
  error?: string;
  warnings: string[];
  mode: PatternMode;
  invert?: boolean;
}

const MAX_SAFE_LEN = 1000;

// Same escaping approach as columnPattern.ts / the renderer: escape every JS
// regex metacharacter so the literal text matches verbatim.
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIALS, '\\$&');
}

// Heuristics for catastrophic backtracking / accidental full-line scans. These
// are intentionally coarse (WARN-only, non-fatal) — the goal is to flag the
// obvious foot-guns, not to prove regex safety.
function backtrackingWarnings(source: string): string[] {
  const out: string[] = [];
  // Nested quantifiers: a quantified group whose body is itself quantified,
  // e.g. (a+)+, (.*)*, (\S+)+, (a*)* — the classic exponential-blowup shapes.
  // Matches `( ... <+*> )<+*>` where the group body contains a quantifier and
  // no nested closing paren (keeps the heuristic simple + cheap).
  if (/\([^)]*[+*][^)]*\)[+*]/.test(source)) {
    out.push('Possible catastrophic backtracking: a nested quantifier (e.g. "(a+)+") can hang on long inputs.');
  }
  // Unbounded leading .* / .+ forces a scan from the very start of every line.
  if (/^\^?\.[*+]/.test(source)) {
    out.push('Pattern starts with an unbounded ".*"/".+" — this scans from the start of every line and can be slow.');
  }
  return out;
}

function commonWarnings(source: string): string[] {
  const out: string[] = [];
  if (source.length > MAX_SAFE_LEN) {
    out.push(`Pattern is very long (${source.length} chars > ${MAX_SAFE_LEN}) — consider simplifying.`);
  }
  out.push(...backtrackingWarnings(source));
  return out;
}

// Fold the plain-mode option conveniences (matchCase / wholeWord) into the
// source + flags. `invert` is metadata only and never touches the regex.
function buildPlainSource(text: string, wholeWord?: boolean): string {
  let src = escapeRegex(text);
  if (wholeWord) src = `\\b${src}\\b`;
  return src;
}

function withCaseFlag(flags: string, matchCase?: boolean): string {
  // matchCase === false → add 'i'. Default (undefined/true) → leave as-is.
  if (matchCase === false && !flags.includes('i')) return flags + 'i';
  return flags;
}

/**
 * Compile any authoring mode to a single RegExp. Never throws — invalid input
 * comes back as `{ ok: false, error }`. Safety issues come back as non-fatal
 * `warnings[]` while still producing a usable regex where possible.
 */
export function compilePattern(input: CompileInput): CompileResult {
  const mode = input.mode;
  const invert = input.invert === true;
  const baseFlags = input.flags || '';

  const fail = (error: string, source = ''): CompileResult => ({
    ok: false, source, flags: baseFlags, error, warnings: [], mode, invert,
  });

  try {
    if (mode === 'plain') {
      const text = input.text || '';
      if (!text) return fail('Empty pattern');
      const source = buildPlainSource(text, input.wholeWord);
      const flags = withCaseFlag(baseFlags, input.matchCase);
      const warnings = commonWarnings(source);
      try {
        const regex = new RegExp(source, flags);
        return { ok: true, source, flags, regex, warnings, mode, invert };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e), source);
      }
    }

    if (mode === 'grok' || mode === 'paint') {
      // Delegate grok/paint compilation to the columnPattern engine (single
      // source of truth). It throws on bad input — surface that message.
      const spec: ColumnPatternSpec = {
        mode,
        pattern: input.text,
        sample: input.sample,
        spans: input.spans,
        flags: baseFlags,
      };
      let compiled;
      try {
        compiled = compileColumnPattern(spec);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      const source = compiled.regex;
      const flags = withCaseFlag(compiled.flags, input.matchCase);
      const warnings = commonWarnings(source);
      try {
        const regex = new RegExp(source, flags);
        return { ok: true, source, flags, regex, warnings, mode, invert };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e), source);
      }
    }

    if (mode === 'regex') {
      const text = input.text || '';
      if (!text) return fail('Empty regex');
      const flags = withCaseFlag(baseFlags, input.matchCase);
      const warnings = commonWarnings(text);
      try {
        const regex = new RegExp(text, flags); // validate: throws on invalid
        return { ok: true, source: text, flags, regex, warnings, mode, invert };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e), text);
      }
    }

    return fail(`Unknown pattern mode: ${String(mode)}`);
  } catch (e) {
    // Absolute backstop — the contract is "never throw to the caller".
    return fail(e instanceof Error ? e.message : String(e));
  }
}
