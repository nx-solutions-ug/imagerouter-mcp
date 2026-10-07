import { mkdtemp, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFilename,
  extensionFor,
  listSaved,
  resolveSavedFile,
  saveBytes,
} from '../../src/lib/output.js';

const now = new Date(2026, 9, 7, 14, 5, 9);

describe('extensionFor', () => {
  it('prefers content type, then URL, then the fallback', () => {
    expect(
      extensionFor({ contentType: 'image/jpeg', url: 'http://x/a.webp', fallback: 'png' }),
    ).toBe('jpg');
    expect(extensionFor({ contentType: 'video/mp4; codecs=avc1', fallback: 'webp' })).toBe('mp4');
    expect(
      extensionFor({
        contentType: 'application/octet-stream',
        url: 'http://x/a.webp?x=1',
        fallback: 'png',
      }),
    ).toBe('webp');
    expect(extensionFor({ contentType: null, url: 'http://x/noext', fallback: 'jpeg' })).toBe(
      'jpg',
    );
  });
});

describe('buildFilename', () => {
  it('uses timestamp, prompt slug and suffix', () => {
    expect(
      buildFilename({
        prompt: 'A red Fox, jumping!  Over snow and much more text here',
        extension: 'webp',
        now,
        suffix: 'ab12',
      }),
    ).toBe('20261007-140509-a-red-fox-jumping-over-snow-and-much-ab12.webp');
  });

  it('survives prompts with no filename-safe characters and missing prompts', () => {
    expect(buildFilename({ prompt: '🦊🦊 狐', extension: 'png', now, suffix: 'ab12' })).toBe(
      '20261007-140509-ab12.png',
    );
    expect(buildFilename({ extension: 'mp4', now, suffix: 'ab12' })).toBe(
      '20261007-140509-ab12.mp4',
    );
  });

  it('keeps only the basename of a requested filename and forces the extension', () => {
    expect(buildFilename({ filename: '../../etc/passwd', extension: 'png' })).toBe('passwd.png');
    expect(buildFilename({ filename: '/abs/hero.jpeg', extension: 'webp' })).toBe('hero.webp');
    expect(buildFilename({ filename: 'my hero.final.png', extension: 'png' })).toBe(
      'my hero.final.png',
    );
    expect(buildFilename({ filename: '..', extension: 'png', now, suffix: 'ab12' })).toBe(
      '20261007-140509-ab12.png',
    );
  });
});

describe('saveBytes', () => {
  it('creates the directory and never overwrites', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'ir-out-')), 'nested', 'dir');
    const first = await saveBytes(dir, 'a.png', new Uint8Array([1]));
    const second = await saveBytes(dir, 'a.png', new Uint8Array([2]));
    const third = await saveBytes(dir, 'a.png', new Uint8Array([3]));
    expect(first).toBe(join(dir, 'a.png'));
    expect(second).toBe(join(dir, 'a-1.png'));
    expect(third).toBe(join(dir, 'a-2.png'));
    expect([...(await readFile(first))]).toEqual([1]);
    expect(await readdir(dir)).toHaveLength(3);
  });

  it('reports an unwritable directory without a stack trace', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'ir-out-')), 'file');
    await writeFile(file, 'x');
    await expect(saveBytes(join(file, 'sub'), 'a.png', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'LOCAL_ERROR',
      message: expect.stringContaining('Cannot write to output directory'),
    });
  });
});

describe('listSaved', () => {
  it('lists media newest first, paginated, ignoring other files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ir-list-'));
    for (const [index, name] of ['old.png', 'mid.mp4', 'new.webp', 'notes.txt'].entries()) {
      await writeFile(join(dir, name), 'x');
      await utimes(join(dir, name), 1000 + index, 1000 + index);
    }
    const all = await listSaved(dir);
    expect(all.total).toBe(3);
    expect(all.items.map((item) => item.name)).toEqual(['new.webp', 'mid.mp4', 'old.png']);
    expect(all.items[1]?.kind).toBe('video');
    const page = await listSaved(dir, { limit: 1, offset: 1 });
    expect(page.items.map((item) => item.name)).toEqual(['mid.mp4']);
  });

  it('returns nothing for a missing directory', async () => {
    expect(await listSaved('/nope/missing')).toEqual({ total: 0, items: [] });
  });
});

describe('resolveSavedFile', () => {
  it('accepts bare media filenames only', () => {
    expect(resolveSavedFile('/out', 'a.png')).toBe('/out/a.png');
    expect(resolveSavedFile('/out', '../a.png')).toBeNull();
    expect(resolveSavedFile('/out', 'sub/a.png')).toBeNull();
    expect(resolveSavedFile('/out', '..')).toBeNull();
    expect(resolveSavedFile('/out', 'a.txt')).toBeNull();
    expect(resolveSavedFile('/out', '')).toBeNull();
  });
});
