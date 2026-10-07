import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRequestBody, isRemoteInput } from '../../src/lib/inputs.js';

describe('isRemoteInput', () => {
  it('recognises URLs and data URIs', () => {
    expect(isRemoteInput('https://x/a.png')).toBe(true);
    expect(isRemoteInput('http://x/a.png')).toBe(true);
    expect(isRemoteInput('data:image/png;base64,AAAA')).toBe(true);
    expect(isRemoteInput('/tmp/a.png')).toBe(false);
    expect(isRemoteInput('a.png')).toBe(false);
  });
});

describe('buildRequestBody', () => {
  it('builds JSON and drops undefined fields', async () => {
    const body = await buildRequestBody({ model: 'm', prompt: 'p', size: undefined, seconds: 5 });
    expect(body).toEqual({ json: { model: 'm', prompt: 'p', seconds: 5 } });
  });

  it('sends one remote image as a string and several as an array', async () => {
    expect(await buildRequestBody({ model: 'm' }, ['https://x/a.png'])).toEqual({
      json: { model: 'm', image: 'https://x/a.png' },
    });
    expect(
      await buildRequestBody(
        { model: 'm' },
        ['https://x/a.png', 'data:image/png;base64,AA'],
        ['https://x/m.png'],
      ),
    ).toEqual({
      json: {
        model: 'm',
        image: ['https://x/a.png', 'data:image/png;base64,AA'],
        mask: 'https://x/m.png',
      },
    });
  });

  it('switches to multipart when any input is a local file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ir-in-'));
    const file = join(dir, 'photo.png');
    await writeFile(file, new Uint8Array([1, 2, 3, 4]));

    const body = await buildRequestBody({ model: 'm', seconds: 5 }, [file, 'https://x/b.png']);
    if (!('form' in body)) throw new Error('expected multipart');
    expect(body.form.get('model')).toBe('m');
    expect(body.form.get('seconds')).toBe('5');
    const images = body.form.getAll('image[]');
    expect(images).toHaveLength(2);
    expect(images[0]).toBeInstanceOf(Blob);
    expect((images[0] as File).name).toBe('photo.png');
    expect((images[0] as File).size).toBe(4);
    expect(images[1]).toBe('https://x/b.png');
  });

  it('rejects a missing file and a directory with the path the user gave', async () => {
    await expect(buildRequestBody({ model: 'm' }, ['/nope/missing.png'])).rejects.toThrow(
      'Input file not found: /nope/missing.png',
    );
    await expect(buildRequestBody({ model: 'm' }, [tmpdir()])).rejects.toThrow('is not a file');
  });
});
