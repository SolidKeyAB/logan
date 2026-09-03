import { describe, it, expect } from 'vitest';
import { matchColumnLayout } from '../shared/layoutMatch';

const layout = (name: string, delimiter: string, names: string[], method: 'delimiter' | 'pattern' = 'delimiter') => ({
  id: name, name, method, delimiter,
  columns: names.map((n, i) => ({ index: i, name: n, visible: true })),
});

const analysis = (delimiter: string, names: Array<string | undefined>) => ({
  delimiter,
  columns: names.map(n => ({ name: n })),
});

describe('matchColumnLayout', () => {
  it('matches a saved layout with the same delimiter, column count, and overlapping names', () => {
    const layouts = [layout('access', ' ', ['time', 'level', 'msg'])];
    const m = matchColumnLayout(analysis(' ', ['time', 'level', 'msg']), layouts);
    expect(m?.name).toBe('access');
  });

  it('is case-insensitive on column names', () => {
    const layouts = [layout('access', ',', ['Time', 'Level', 'Msg'])];
    const m = matchColumnLayout(analysis(',', ['time', 'level', 'msg']), layouts);
    expect(m?.name).toBe('access');
  });

  it('does not match when the delimiter differs', () => {
    const layouts = [layout('access', '\t', ['time', 'level', 'msg'])];
    expect(matchColumnLayout(analysis(' ', ['time', 'level', 'msg']), layouts)).toBeNull();
  });

  it('does not match when the column count differs', () => {
    const layouts = [layout('access', ' ', ['time', 'level', 'msg', 'extra'])];
    expect(matchColumnLayout(analysis(' ', ['time', 'level', 'msg']), layouts)).toBeNull();
  });

  it('returns null when the file has no header names to key on', () => {
    const layouts = [layout('access', ' ', ['time', 'level', 'msg'])];
    expect(matchColumnLayout(analysis(' ', [undefined, undefined, undefined]), layouts)).toBeNull();
  });

  it('requires at least one overlapping name (count alone is not enough)', () => {
    const layouts = [layout('sensor', ' ', ['aaa', 'bbb', 'ccc'])];
    expect(matchColumnLayout(analysis(' ', ['time', 'level', 'msg']), layouts)).toBeNull();
  });

  it('ignores pattern-method layouts', () => {
    const layouts = [layout('patt', ' ', ['time', 'level', 'msg'], 'pattern')];
    expect(matchColumnLayout(analysis(' ', ['time', 'level', 'msg']), layouts)).toBeNull();
  });

  it('picks the layout with the most overlapping names', () => {
    const layouts = [
      layout('partial', ' ', ['time', 'xxx', 'yyy']),
      layout('full', ' ', ['time', 'level', 'msg']),
    ];
    expect(matchColumnLayout(analysis(' ', ['time', 'level', 'msg']), layouts)?.name).toBe('full');
  });
});
