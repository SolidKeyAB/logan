import { ScopeDescriptor } from './types';

// Convert a scope descriptor from the MCP/viewer convention (1-based line numbers)
// to the HTTP/main convention (0-based line indices). Mirrors how the trend tools
// already convert startLine/endLine before calling the API. Only `range` and
// `indices` carry line numbers; every other descriptor passes through untouched.
export function toApiScope(scope?: ScopeDescriptor | null): ScopeDescriptor | undefined {
  if (!scope) return undefined;
  switch (scope.type) {
    case 'range':
      return { type: 'range', start: Math.max(0, (scope.start ?? 1) - 1), end: Math.max(0, (scope.end ?? 1) - 1) };
    case 'indices':
      return {
        type: 'indices',
        lines: (scope.lines || []).map(n => Math.max(0, n - 1)),
        ...(scope.label ? { label: scope.label } : {}),
      };
    default:
      return scope;
  }
}
