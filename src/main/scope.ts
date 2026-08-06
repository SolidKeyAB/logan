// Scope resolution — turn a caller-supplied ScopeDescriptor into a concrete
// ResolvedScope (a contiguous range OR an explicit, sanitized line-set) that the
// engines already consume. This is the one resolver every scopeable endpoint uses.
//
// The heavy/stateful cases (search / selection / active state, and time /
// component which need a scan) are injected via optional context callbacks so
// this function stays pure and unit-testable. PR1 ships the cheap cases
// (all / range / indices / filter); PR2/PR3 wire the injected resolvers.

import { ScopeDescriptor, ResolvedScope, ScopeInfo } from '../shared/types';

export interface ScopeResolverContext {
  getTotalLines(): number;                                   // visible line count (0-based indices 0..N-1)
  getFilteredLines(): number[] | null;                       // active filter's 0-based line-set (null = no filter)
  getSearchLines?(): number[] | null;                        // current search results' 0-based lines
  getSelectionLines?(): number[] | null;                     // current viewer selection's 0-based lines
  getActiveScope?(): ScopeDescriptor | null;                 // whatever the human/app currently has set
  resolveComponentLines?(name: string): number[];            // scan → 0-based lines belonging to a component
  resolveTimeWindow?(from: string, to: string): { startLine: number; endLine: number } | null; // scan → range
}

const EMPTY_RANGE = (label: string): ResolvedScope => ({ kind: 'range', startLine: 0, endLine: -1, count: 0, label });

function rangeAll(total: number): ResolvedScope {
  if (total <= 0) return EMPTY_RANGE('whole file (empty)');
  return { kind: 'range', startLine: 0, endLine: total - 1, count: total, label: 'whole file' };
}

// Whole file, but flag that a more specific scope was asked for and couldn't be honored yet.
function fallbackAll(total: number, warning: string): ResolvedScope {
  return { ...rangeAll(total), warning };
}

function fromIndices(lines: number[], label: string, total: number): ResolvedScope {
  const clean = Array.from(new Set(
    (lines || []).filter(n => Number.isInteger(n) && n >= 0 && n < total)
  )).sort((a, b) => a - b);
  return { kind: 'indices', lines: clean, count: clean.length, label };
}

export function resolveScope(
  ctx: ScopeResolverContext,
  descriptor?: ScopeDescriptor | null,
  depth = 0,
): ResolvedScope {
  const total = ctx.getTotalLines();
  const d: ScopeDescriptor = descriptor ?? { type: 'all' };

  switch (d.type) {
    case 'all':
      return rangeAll(total);

    case 'range': {
      if (total <= 0) return EMPTY_RANGE('range (empty)');
      const lo = Math.max(0, Math.min(d.start, d.end));
      const hi = Math.min(total - 1, Math.max(d.start, d.end));
      if (lo > hi) return EMPTY_RANGE('range (empty)');
      return { kind: 'range', startLine: lo, endLine: hi, count: hi - lo + 1, label: `lines ${lo + 1}–${hi + 1}` };
    }

    case 'indices':
      return fromIndices(d.lines, d.label || `${(d.lines || []).length} lines`, total);

    case 'filter': {
      const f = ctx.getFilteredLines();
      if (f == null) return fallbackAll(total, 'no active filter — scoped to whole file');
      return fromIndices(f, `filter (${f.length})`, total);
    }

    case 'search': {
      const s = ctx.getSearchLines?.() ?? null;
      if (s == null) return fallbackAll(total, 'no search results available — scoped to whole file');
      return fromIndices(s, `search (${s.length})`, total);
    }

    case 'selection': {
      const s = ctx.getSelectionLines?.() ?? null;
      if (s == null) return fallbackAll(total, 'no selection available — scoped to whole file');
      return fromIndices(s, `selection (${s.length})`, total);
    }

    case 'active': {
      if (depth > 3) return fallbackAll(total, 'scope recursion — scoped to whole file');
      const a = ctx.getActiveScope?.() ?? null;
      if (a == null || a.type === 'active') return fallbackAll(total, 'no active scope — whole file');
      return resolveScope(ctx, a, depth + 1);
    }

    case 'compose': {
      if (depth > 4) return fallbackAll(total, 'scope nesting too deep — whole file');
      const parts = (d.scopes || []).map(s => resolveScope(ctx, s, depth + 1));
      const composed = intersectResolved(parts, total);
      if (d.label) composed.label = d.label;
      return composed;
    }

    case 'component': {
      if (!ctx.resolveComponentLines) return fallbackAll(total, 'component scope unavailable — whole file');
      const lines = ctx.resolveComponentLines(d.name);
      return fromIndices(lines, `component:${d.name} (${lines.length})`, total);
    }

    case 'time': {
      if (!ctx.resolveTimeWindow) return fallbackAll(total, 'time scope unavailable — whole file');
      const w = ctx.resolveTimeWindow(d.from, d.to);
      if (!w) return EMPTY_RANGE(`time ${d.from}…${d.to} (no lines)`);
      if (total <= 0) return EMPTY_RANGE('time (empty)');
      const lo = Math.max(0, Math.min(w.startLine, w.endLine));
      const hi = Math.min(total - 1, Math.max(w.startLine, w.endLine));
      if (lo > hi) return EMPTY_RANGE('time (empty)');
      return { kind: 'range', startLine: lo, endLine: hi, count: hi - lo + 1, label: `time ${d.from}…${d.to}` };
    }

    default:
      return rangeAll(total);
  }
}

// Intersect several resolved scopes into one — the "true pipe" (filter ∩ search
// ∩ range …). Pure ranges intersect to a range without materializing; once any
// part is an explicit line-set, we seed from the smallest set and filter it by
// every other set/range, so we never expand a whole-file range into memory.
export function intersectResolved(parts: ResolvedScope[], total: number): ResolvedScope {
  if (parts.length === 0) return rangeAll(total);
  if (parts.length === 1) return parts[0];

  const warnings = parts.map(p => p.warning).filter((w): w is string => !!w);
  const warn = warnings.length ? warnings.join('; ') : undefined;
  const label = parts.map(p => p.label).join(' ∩ ');

  const ranges = parts.filter((p): p is Extract<ResolvedScope, { kind: 'range' }> => p.kind === 'range');
  const indexSets = parts.filter((p): p is Extract<ResolvedScope, { kind: 'indices' }> => p.kind === 'indices');

  // Any empty part ⇒ empty intersection.
  if (parts.some(p => p.count === 0)) {
    return { kind: 'range', startLine: 0, endLine: -1, count: 0, label: `${label} (empty)`, ...(warn ? { warning: warn } : {}) };
  }

  // Pure ranges → intersection is itself a range [max(starts), min(ends)].
  if (indexSets.length === 0) {
    let lo = 0, hi = total - 1;
    for (const r of ranges) { lo = Math.max(lo, r.startLine); hi = Math.min(hi, r.endLine); }
    if (total <= 0 || lo > hi) return { kind: 'range', startLine: 0, endLine: -1, count: 0, label: `${label} (empty)`, ...(warn ? { warning: warn } : {}) };
    return { kind: 'range', startLine: lo, endLine: hi, count: hi - lo + 1, label, ...(warn ? { warning: warn } : {}) };
  }

  // Seed from the smallest explicit set, then keep only lines present in every
  // other set and inside every range.
  const seed = indexSets.reduce((a, b) => (a.lines.length <= b.lines.length ? a : b)).lines;
  const otherSets = indexSets.map(p => new Set(p.lines));
  const inAllRanges = (n: number) => ranges.every(r => n >= r.startLine && n <= r.endLine);
  const lines = seed.filter(n => inAllRanges(n) && otherSets.every(s => s.has(n)));

  return { kind: 'indices', lines, count: lines.length, label, ...(warn ? { warning: warn } : {}) };
}

// Build a compact, JSON-safe summary of a resolved scope (see ScopeInfo in
// shared/types) so both operators can see "what am I looking through".
export function scopeInfo(resolved: ResolvedScope): ScopeInfo {
  if (resolved.kind === 'range') {
    return {
      kind: 'range',
      label: resolved.label,
      count: resolved.count,
      startLine: resolved.count > 0 ? resolved.startLine + 1 : undefined,
      endLine: resolved.count > 0 ? resolved.endLine + 1 : undefined,
      ...(resolved.warning ? { warning: resolved.warning } : {}),
    };
  }
  return {
    kind: 'indices',
    label: resolved.label,
    count: resolved.count,
    ...(resolved.warning ? { warning: resolved.warning } : {}),
  };
}

// True when a resolved scope covers the entire file (so callers can shortcut to
// the existing whole-file engine path instead of the subset path).
export function isWholeFile(resolved: ResolvedScope, total: number): boolean {
  return resolved.kind === 'range'
    && !resolved.warning
    && resolved.startLine === 0
    && resolved.endLine === total - 1
    && total > 0;
}

// Minimal line source — FileHandler.getLines(startLine, count) satisfies this
// (0-based; each entry carries at least the line text).
export interface ScopeTextReader {
  getLines(startLine: number, count: number): Array<{ text: string }>;
}

// Walk every line in a resolved scope IN ORDER, batching reads. `fn` receives the
// line text and its real 0-based line number (computed from the scope position,
// so the reader need only return text). Return `false` from `fn` to stop early.
// A `range` reads in fixed batches; an `indices` set collapses consecutive runs
// into single batched reads so a dense filter isn't one syscall per line.
export function forEachScopeLine(
  reader: ScopeTextReader,
  resolved: ResolvedScope,
  fn: (text: string, lineNumber: number) => boolean | void,
): void {
  const BATCH = 5000;
  if (resolved.kind === 'range') {
    for (let start = resolved.startLine; start <= resolved.endLine; start += BATCH) {
      const want = Math.min(BATCH, resolved.endLine - start + 1);
      const lines = reader.getLines(start, want);
      for (let i = 0; i < lines.length; i++) {
        if (fn(lines[i].text, start + i) === false) return;
      }
    }
  } else {
    const arr = resolved.lines;
    let i = 0;
    while (i < arr.length) {
      let runEnd = i;
      while (runEnd + 1 < arr.length && arr[runEnd + 1] === arr[runEnd] + 1) runEnd++;
      const runStart = arr[i];
      const batch = reader.getLines(runStart, runEnd - i + 1);
      for (let j = 0; j < batch.length; j++) {
        if (fn(batch[j].text, runStart + j) === false) return;
      }
      i = runEnd + 1;
    }
  }
}
