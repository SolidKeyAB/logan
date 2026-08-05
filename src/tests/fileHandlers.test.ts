import { describe, it, expect } from 'vitest';
import { resolveFileHandlers, runFileHandler, __testables } from '../main/fileHandlers';

const { extOf } = __testables;

describe('fileHandlers — extOf', () => {
  it('extracts lower-case extension without the dot', () => {
    expect(extOf('/a/b/App.LOG')).toBe('log');
    expect(extOf('C:\\logs\\trace.esotrace')).toBe('esotrace');
  });
  it('returns empty string for dotfiles and no-extension files', () => {
    expect(extOf('/a/.gitignore')).toBe('');
    expect(extOf('/a/README')).toBe('');
  });
});

describe('fileHandlers — resolveFileHandlers', () => {
  it('a plain file resolves to open-log only, as the default', () => {
    const hs = resolveFileHandlers({ path: '/x/app.log', fileType: 'text' });
    expect(hs.map(h => h.id)).toEqual(['open-log']);
    expect(hs[0].isDefault).toBe(true);
  });

  it('an image file defaults to the image viewer, with open-log offered as an alternative', () => {
    const hs = resolveFileHandlers({ path: '/x/shot.png', fileType: 'image' });
    expect(hs.map(h => h.id)).toEqual(['image', 'open-log']); // priority order
    expect(hs[0].id).toBe('image');
    expect(hs[0].isDefault).toBe(true);
    expect(hs[1].isDefault).toBe(false);
  });

  it('a video file defaults to the video player, open-log as alternative', () => {
    const hs = resolveFileHandlers({ path: '/x/clip.mp4', fileType: 'video' });
    expect(hs.map(h => h.id)).toEqual(['video', 'open-log']);
    expect(hs[0].isDefault).toBe(true);
  });

  it('without a fileType hint, media handlers do not match — open-log wins (safe fallback)', () => {
    const hs = resolveFileHandlers({ path: '/x/unknown.bin' });
    expect(hs.map(h => h.id)).toEqual(['open-log']);
  });

  it('a directory resolves to no handlers in Phase 1 (no folder handler yet)', () => {
    const hs = resolveFileHandlers({ path: '/x/logs', isDirectory: true });
    expect(hs).toEqual([]);
  });

  it('exactly one handler is flagged isDefault', () => {
    const hs = resolveFileHandlers({ path: '/x/shot.png', fileType: 'image' });
    expect(hs.filter(h => h.isDefault).length).toBe(1);
  });
});

describe('fileHandlers — runFileHandler', () => {
  it('open-log produces an open-log descriptor for the path', async () => {
    const r = await runFileHandler('open-log', { path: '/x/app.log', fileType: 'text' });
    expect(r).toEqual({ action: 'open-log', path: '/x/app.log' });
  });

  it('image produces an open-panel:image descriptor', async () => {
    const r = await runFileHandler('image', { path: '/x/shot.png', fileType: 'image' });
    expect(r).toEqual({ action: 'open-panel', panel: 'image', path: '/x/shot.png' });
  });

  it('video produces an open-panel:video descriptor', async () => {
    const r = await runFileHandler('video', { path: '/x/clip.mp4', fileType: 'video' });
    expect(r).toEqual({ action: 'open-panel', panel: 'video', path: '/x/clip.mp4' });
  });

  it('an unknown handler id returns an error toast, not a throw', async () => {
    const r = await runFileHandler('nope', { path: '/x/app.log' });
    expect(r.action).toBe('toast');
    expect(r.level).toBe('error');
  });
});
