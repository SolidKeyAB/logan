// Row-mute matching for the viewer's "Mute pattern" feature: a row is muted
// (dimmed in place) when its text contains ANY active mute pattern, matched as a
// case-insensitive substring. Empty/blank patterns are ignored so a stray "" (or
// a cleared input) never mutes the whole file.
//
// This is the TESTED spec. The renderer keeps a byte-for-byte MIRROR named
// isLineMuted() (renderer.ts is a script and can't import this — see the header
// note there). Keep the two in sync.
export function lineMatchesMute(text: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const lower = text.toLowerCase();
  for (const p of patterns) {
    if (p && lower.includes(p.toLowerCase())) return true;
  }
  return false;
}
