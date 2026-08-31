import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanFolderShallow, dirHasVisibleEntry } from '../main/folderScan';

let root: string;

function write(rel: string, data: string | Buffer): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
}
function mkdir(rel: string): void {
  fs.mkdirSync(path.join(root, rel), { recursive: true });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NUL = Buffer.from([0x00, 0x01, 0x02, 0x03]); // NUL byte → sniffed as binary

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'logan-folderscan-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scanFolderShallow', () => {
  it('returns exactly one level and does not recurse into subdirectories', async () => {
    write('b_dir/inner.txt', 'hello');
    write('b_dir/deep/deeper.txt', 'x'); // must NOT be surfaced
    write('zeta.txt', 'top-level file');

    const entries = await scanFolderShallow(root);
    const bDir = entries.find((e) => e.name === 'b_dir');
    expect(bDir).toBeDefined();
    expect(bDir!.isDirectory).toBe(true);
    // No recursion: children are not populated by the shallow scan.
    expect(bDir!.children).toBeUndefined();
  });

  it('flags hasChildren from a shallow peek (non-empty vs empty dir)', async () => {
    write('has_stuff/inner.txt', 'x');
    mkdir('is_empty');

    const entries = await scanFolderShallow(root);
    expect(entries.find((e) => e.name === 'has_stuff')!.hasChildren).toBe(true);
    expect(entries.find((e) => e.name === 'is_empty')!.hasChildren).toBe(false);
  });

  it('excludes dot entries and skip-listed directories', async () => {
    mkdir('node_modules');
    write('node_modules/pkg.js', 'x');
    mkdir('.hidden_dir');
    write('.hidden_dir/inside.txt', 'x');
    write('.secret', 'x');
    write('keep.txt', 'x');

    const names = (await scanFolderShallow(root)).map((e) => e.name);
    expect(names).toContain('keep.txt');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.hidden_dir');
    expect(names).not.toContain('.secret');
  });

  it('drops unopenable binaries but keeps text, images, and openable binaries by extension', async () => {
    write('log.txt', 'plain text');
    write('shot.png', PNG);
    write('junk.bin', NUL); // arbitrary binary → dropped
    write('capture.esotrace', NUL); // binary bytes but openable extension → kept

    const entries = await scanFolderShallow(root);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName['log.txt'].fileType).toBe('text');
    expect(byName['shot.png'].fileType).toBe('image');
    expect(byName['junk.bin']).toBeUndefined();
    expect(byName['capture.esotrace']).toBeDefined();
    expect(byName['capture.esotrace'].fileType).toBe('binary');
  });

  it('sorts directories first, then alphabetically (case-insensitive)', async () => {
    write('Bravo.txt', 'x');
    write('alpha.txt', 'x');
    write('Zdir/inner.txt', 'x');
    write('adir/inner.txt', 'x');

    const names = (await scanFolderShallow(root)).map((e) => e.name);
    expect(names).toEqual(['adir', 'Zdir', 'alpha.txt', 'Bravo.txt']);
  });
});

describe('dirHasVisibleEntry', () => {
  it('is true when a plain file is present', async () => {
    write('d/file.txt', 'x');
    expect(await dirHasVisibleEntry(path.join(root, 'd'))).toBe(true);
  });

  it('is true when a normal subdirectory is present', async () => {
    mkdir('d/sub');
    expect(await dirHasVisibleEntry(path.join(root, 'd'))).toBe(true);
  });

  it('is false for an empty directory', async () => {
    mkdir('d');
    expect(await dirHasVisibleEntry(path.join(root, 'd'))).toBe(false);
  });

  it('ignores dot entries and skip-listed dirs', async () => {
    write('d/.hidden', 'x');
    mkdir('d/node_modules');
    expect(await dirHasVisibleEntry(path.join(root, 'd'))).toBe(false);
  });
});
