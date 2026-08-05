import { describe, it, expect } from 'vitest';
import { lineMatchesMute } from '../shared/muteMatch';

describe('lineMatchesMute', () => {
  it('no patterns → never muted', () => {
    expect(lineMatchesMute('anything at all', [])).toBe(false);
  });

  it('matches a case-insensitive substring', () => {
    expect(lineMatchesMute('12:00 heartbeat ok', ['heartbeat'])).toBe(true);
    expect(lineMatchesMute('12:00 HEARTBEAT ok', ['heartbeat'])).toBe(true);
    expect(lineMatchesMute('12:00 heartbeat ok', ['HEARTBEAT'])).toBe(true);
  });

  it('is true if ANY pattern matches', () => {
    expect(lineMatchesMute('ping response', ['heartbeat', 'ping'])).toBe(true);
    expect(lineMatchesMute('unrelated line', ['heartbeat', 'ping'])).toBe(false);
  });

  it('ignores empty/blank patterns (never mutes the whole file)', () => {
    expect(lineMatchesMute('any line', [''])).toBe(false);
    expect(lineMatchesMute('any line', ['', '   '])).toBe(false);
    // whitespace-only patterns still substring-match a space, but callers trim on
    // add; a bare space would match — assert the empty-string guard specifically:
    expect(lineMatchesMute('nospaces', [''])).toBe(false);
  });

  it('does not match when the substring is absent', () => {
    expect(lineMatchesMute('all clear', ['error'])).toBe(false);
  });
});
