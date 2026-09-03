import { describe, it, expect } from 'vitest';
import { launchPathCandidates } from '../main/launchArgs';

const ELECTRON = '/repo/node_modules/electron/dist/electron';

describe('launchPathCandidates', () => {
  it('dev `npm start` (electron . --no-sandbox) yields NO folder — "." is the app path, not a target', () => {
    const argv = [ELECTRON, '.', '--no-sandbox'];
    expect(launchPathCandidates(argv, '/repo', true)).toEqual([]);
  });

  it('dev explicit `electron . -- ./logs` opens the folder after `--`', () => {
    const argv = [ELECTRON, '.', '--no-sandbox', '--', './logs'];
    expect(launchPathCandidates(argv, '/repo', true)[0]).toBe('./logs');
  });

  it('packaged `logan ./logs` opens the folder (user args start at index 1)', () => {
    const argv = ['/Applications/LOGAN.app/Contents/MacOS/LOGAN', './logs'];
    expect(launchPathCandidates(argv, '/Applications/LOGAN.app/Contents/Resources/app.asar', false))
      .toEqual(['./logs']);
  });

  it('packaged `logan app.log` opens the file', () => {
    const argv = ['/Applications/LOGAN.app/Contents/MacOS/LOGAN', 'app.log'];
    expect(launchPathCandidates(argv, '/some/app.asar', false)).toEqual(['app.log']);
  });

  it('never offers the app directory itself as a candidate', () => {
    const argv = [ELECTRON, '/repo', '--no-sandbox'];
    // even if arg parsing reached it, it equals appPath → excluded
    expect(launchPathCandidates(argv, '/repo', false)).toEqual([]);
  });

  it('skips flags and the electron binary in the fallback scan', () => {
    const argv = [ELECTRON, '.', '--inspect', '--no-sandbox'];
    expect(launchPathCandidates(argv, '/repo', true)).toEqual([]);
  });

  it('the `--` form wins even when other positionals exist', () => {
    const argv = ['/Applications/LOGAN.app/Contents/MacOS/LOGAN', 'other', '--', './logs'];
    expect(launchPathCandidates(argv, '/app.asar', false)[0]).toBe('./logs');
  });
});
