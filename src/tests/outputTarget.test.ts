import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { deriveOutputTarget, sanitizeBaseName } from '../main/outputTarget';

describe('deriveOutputTarget', () => {
  it('derives dir/base/ext from a real file path (the FileHandler / segmented case)', () => {
    const t = deriveOutputTarget({ kind: 'file', path: '/logs/run-42/device.log' });
    expect(t.dir).toBe(path.normalize('/logs/run-42'));
    expect(t.baseName).toBe('device');
    expect(t.ext).toBe('.log');
    expect(t.displayPath).toBe('/logs/run-42/device.log');
  });

  it('handles a real file with no extension', () => {
    const t = deriveOutputTarget({ kind: 'file', path: '/logs/syslog' });
    expect(t.baseName).toBe('syslog');
    expect(t.ext).toBe('');
  });

  it('anchors a composite to its first member dir with a filename-safe base from the label', () => {
    const t = deriveOutputTarget({
      kind: 'composite',
      label: 'Single session (3 files)',
      memberPath: '/logs/run-42/a.log',
    });
    expect(t.dir).toBe(path.normalize('/logs/run-42')); // beside the member, not "."
    expect(t.baseName).toBe('Single_session_3_files'); // no spaces/parens in a filename
    expect(t.ext).toBe('');
    expect(t.displayPath).toBe('Single session (3 files)'); // label kept for headers/links
  });

  it('sanitizeBaseName collapses non-word runs and never returns empty', () => {
    expect(sanitizeBaseName('a b/c:d')).toBe('a_b_c_d');
    expect(sanitizeBaseName('keep.dots-and-dashes')).toBe('keep.dots-and-dashes');
    expect(sanitizeBaseName('  ()  ')).toBe('session'); // all stripped → fallback
  });
});
