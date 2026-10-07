import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/lib/config.js';
import { runGeneration } from '../../src/lib/generation.js';
import { ImageRouterError } from '../../src/lib/errors.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { readRecord } from '../../src/lib/metadata.js';
import { fakeFetch, json } from '../helpers/fake-fetch.js';
import { makeJpeg, makeMp4, makePng, toBase64 } from '../helpers/images.js';

async function setup(handler: Parameters<typeof fakeFetch>[0], env: Record<string, string> = {}) {
  const outputDir = await mkdtemp(join(tmpdir(), 'ir-gen-'));
  const config = resolveConfig(
    {
      IMAGEROUTER_API_KEY: 'k',
      IMAGEROUTER_BASE_URL: 'http://api.test',
      IMAGEROUTER_OUTPUT_DIR: outputDir,
      ...env,
    },
    '/h',
  );
  const fake = fakeFetch(handler);
  return {
    deps: { config, client: new ImageRouterClient(config, fake.fetch) },
    calls: fake.calls,
    outputDir,
  };
}

async function failure(promise: Promise<unknown>): Promise<ImageRouterError> {
  try {
    await promise;
  } catch (error) {
    return error as ImageRouterError;
  }
  throw new Error('Expected the generation to fail.');
}

const png = () =>
  new Response(new Uint8Array([9, 9]), { headers: { 'content-type': 'image/png' } });

describe('runGeneration', () => {
  it('requests a URL, downloads it and saves it', async () => {
    const { deps, calls, outputDir } = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/abc.webp' }], cost: 0.004, latency: 6942 })
        : png(),
    );
    const result = await runGeneration(deps, 'image', {
      prompt: 'a fox',
      model: 'm/x',
      size: '1024x1024',
    });

    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      model: 'm/x',
      prompt: 'a fox',
      size: '1024x1024',
      response_format: 'url',
    });
    expect(result).toMatchObject({
      url: 'http://cdn.test/abc.webp',
      model: 'm/x',
      cost: 0.004,
      latency_ms: 6942,
    });
    expect(result.path.startsWith(outputDir)).toBe(true);
    expect(result.path).toMatch(/a-fox-[0-9a-f]{4}\.png$/);
    expect([...(await readFile(result.path))]).toEqual([9, 9]);
    expect(result.files).toBeUndefined();
  });

  it('decodes ephemeral results and returns no URL', async () => {
    const { deps, calls } = await setup(() => json({ data: [{ b64_json: 'AQID' }] }));
    const result = await runGeneration(deps, 'image', {
      prompt: 'x',
      model: 'm',
      ephemeral: true,
      output_format: 'jpeg',
    });
    expect(JSON.parse(calls[0]!.init.body as string).response_format).toBe('b64_ephemeral');
    expect(calls).toHaveLength(1);
    expect(result.url).toBeUndefined();
    expect(result.path).toMatch(/\.jpg$/);
    expect([...(await readFile(result.path))]).toEqual([1, 2, 3]);
  });

  it('names an ephemeral result after its bytes, not the requested format', async () => {
    // The live test model answers b64_ephemeral with JPEG bytes when no output_format is given.
    const { deps } = await setup(() => json({ data: [{ b64_json: '/9j/4AAQSkZJRg==' }] }));
    const result = await runGeneration(deps, 'image', { prompt: 'x', model: 'm', ephemeral: true });
    expect(result.path).toMatch(/\.jpg$/);
  });

  it('falls back to the default model per kind', async () => {
    const { deps, calls } = await setup(
      (url) =>
        url.startsWith('http://api.test')
          ? json({ data: [{ url: 'http://cdn.test/a.mp4' }] })
          : png(),
      {
        IMAGEROUTER_DEFAULT_IMAGE_MODEL: 'img/default',
        IMAGEROUTER_DEFAULT_VIDEO_MODEL: 'vid/default',
      },
    );
    expect((await runGeneration(deps, 'image', { prompt: 'x' })).model).toBe('img/default');
    expect((await runGeneration(deps, 'edit', { images: ['http://x/a.png'] })).model).toBe(
      'img/default',
    );
    expect((await runGeneration(deps, 'video', { prompt: 'x', seconds: 5 })).model).toBe(
      'vid/default',
    );
    expect(JSON.parse(calls.at(-2)!.init.body as string).seconds).toBe(5);
  });

  it('explains how to choose a model when none is available', async () => {
    const { deps, calls } = await setup(() => json({}));
    await expect(runGeneration(deps, 'image', { prompt: 'x' })).rejects.toThrow(
      'No model given. Pass "model" or set IMAGEROUTER_DEFAULT_IMAGE_MODEL; use list_models to find one.',
    );
    await expect(runGeneration(deps, 'video', { prompt: 'x' })).rejects.toThrow(
      'IMAGEROUTER_DEFAULT_VIDEO_MODEL',
    );
    expect(calls).toHaveLength(0);
  });

  it('saves every result and lists them', async () => {
    const { deps } = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/1.png' }, { url: 'http://cdn.test/2.png' }] })
        : png(),
    );
    const result = await runGeneration(deps, 'image', { prompt: 'x', model: 'm' });
    expect(result.files).toHaveLength(2);
    expect(result.path).toBe(result.files![0]!.path);
    expect(result.files![1]!.url).toBe('http://cdn.test/2.png');
    expect(result.files![0]!.path).not.toBe(result.files![1]!.path);
  });

  it('honours output_dir and filename', async () => {
    const { deps } = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/1.png' }] })
        : png(),
    );
    const dir = await mkdtemp(join(tmpdir(), 'ir-custom-'));
    const result = await runGeneration(deps, 'image', {
      prompt: 'x',
      model: 'm',
      output_dir: dir,
      filename: '../hero.webp',
    });
    expect(result.path).toBe(join(dir, 'hero.png'));
  });

  it('fails clearly when the API returns nothing usable', async () => {
    const empty = await setup(() => json({ data: [] }));
    await expect(runGeneration(empty.deps, 'image', { prompt: 'x', model: 'm' })).rejects.toThrow(
      'ImageRouter returned no result',
    );
    const blank = await setup(() => json({ data: [{}] }));
    await expect(runGeneration(blank.deps, 'image', { prompt: 'x', model: 'm' })).rejects.toThrow(
      'ImageRouter returned no result',
    );
    const missing = await setup(() => json({ cost: 1 }));
    await expect(runGeneration(missing.deps, 'image', { prompt: 'x', model: 'm' })).rejects.toThrow(
      'ImageRouter returned no result',
    );
  });

  it('names the hosted URL when the download fails after generation', async () => {
    const { deps } = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/lost.png' }] })
        : new Response('', { status: 404 }),
    );
    await expect(runGeneration(deps, 'image', { prompt: 'x', model: 'm' })).rejects.toThrow(
      'http://cdn.test/lost.png',
    );
  });

  it('lists every hosted URL and saved file when a later download fails', async () => {
    let downloads = 0;
    const { deps } = await setup((url) => {
      if (url.startsWith('http://api.test')) {
        return json({ data: [{ url: 'http://cdn.test/1.png' }, { url: 'http://cdn.test/2.png' }] });
      }
      downloads += 1;
      return downloads === 1 ? png() : new Response('', { status: 500 });
    });
    const error = await failure(runGeneration(deps, 'image', { prompt: 'x', model: 'm' }));
    expect(error).toBeInstanceOf(ImageRouterError);
    expect(error.code).toBe('LOCAL_ERROR');
    expect(downloads).toBe(2);
    expect(error.message).toContain('Generated results stay available for 30 days at:');
    expect(error.message).toContain('http://cdn.test/1.png');
    expect(error.message).toContain('http://cdn.test/2.png');
    const saved = /Already saved: (\S+)/.exec(error.message)?.[1];
    expect(saved).toBeDefined();
    expect([...(await readFile(saved!))]).toEqual([9, 9]);
  });

  it('keeps the hosted URL when saving fails after a download', async () => {
    // The directory passes the pre-check, then the CDN download replaces it with a file, so the
    // save fails after the paid call.
    const { deps, outputDir } = await setup(() => json({}));
    const dir = join(outputDir, 'sub');
    const fake = fakeFetch(async (url) => {
      if (url.startsWith('http://api.test'))
        return json({ data: [{ url: 'http://cdn.test/1.png' }] });
      await rm(dir, { recursive: true, force: true });
      await writeFile(dir, 'x');
      return png();
    });
    const client = new ImageRouterClient(deps.config, fake.fetch);
    const error = await failure(
      runGeneration({ ...deps, client }, 'image', { prompt: 'x', model: 'm', output_dir: dir }),
    );
    expect(fake.calls).toHaveLength(2);
    expect(error.code).toBe('LOCAL_ERROR');
    expect(error.message).toContain('Cannot write to output directory');
    expect(error.message).toContain('http://cdn.test/1.png');
    expect(error.message).not.toContain('Already saved');
  });

  it('says an ephemeral result cannot be fetched again when saving fails', async () => {
    // The API answer arrives after the pre-check; the directory is swapped for a file meanwhile.
    const { deps, outputDir } = await setup(() => json({}));
    const dir = join(outputDir, 'sub');
    const fake = fakeFetch(async () => {
      await rm(dir, { recursive: true, force: true });
      await writeFile(dir, 'x');
      return json({ data: [{ b64_json: 'AQID' }] });
    });
    const client = new ImageRouterClient(deps.config, fake.fetch);
    const error = await failure(
      runGeneration({ ...deps, client }, 'image', {
        prompt: 'x',
        model: 'm',
        ephemeral: true,
        output_dir: dir,
      }),
    );
    expect(fake.calls).toHaveLength(1);
    expect(error.code).toBe('LOCAL_ERROR');
    expect(error.message).toContain(
      'This was an ephemeral request, so the result cannot be fetched again.',
    );
    expect(error.message).not.toContain('stay available');
  });

  it.each([false, true])(
    'refuses an unusable output directory before any API call (ephemeral: %s)',
    async (ephemeral) => {
      const { deps, calls, outputDir } = await setup(() => json({ data: [{ b64_json: 'AQID' }] }));
      const blocker = join(outputDir, 'file');
      await writeFile(blocker, 'x');
      const error = await failure(
        runGeneration(deps, 'image', {
          prompt: 'x',
          model: 'm',
          ephemeral,
          output_dir: join(blocker, 'sub'),
        }),
      );
      expect(error.code).toBe('LOCAL_ERROR');
      expect(error.message).toContain('Cannot write to output directory');
      expect(calls).toHaveLength(0);
    },
  );

  it('refuses a read-only output directory before any API call', async () => {
    const { deps, calls, outputDir } = await setup(() => json({}));
    const dir = join(outputDir, 'ro');
    await mkdir(dir, { mode: 0o500 });
    try {
      const error = await failure(
        runGeneration(deps, 'image', { prompt: 'x', model: 'm', output_dir: dir }),
      );
      expect(error.code).toBe('LOCAL_ERROR');
      expect(error.message).toContain('Cannot write to output directory');
      expect(calls).toHaveLength(0);
    } finally {
      await chmod(dir, 0o700);
    }
  });

  describe('generation records', () => {
    const image = (width: number, height: number) =>
      new Response(makePng(width, height), { headers: { 'content-type': 'image/png' } });

    it('writes a sidecar for a hosted result and reports the dimensions', async () => {
      const { deps, outputDir } = await setup((url) =>
        url.startsWith('http://api.test')
          ? json({ data: [{ url: 'http://cdn.test/abc.png' }], cost: 0.004, latency: 6942 })
          : image(40, 30),
      );
      const result = await runGeneration(deps, 'image', {
        prompt: 'a fox',
        model: 'm/x',
        size: '1024x1024',
        quality: 'high',
        output_format: 'png',
      });
      expect(result).toMatchObject({ width: 40, height: 30, metadata_path: `${result.path}.json` });
      expect(result.path.startsWith(outputDir)).toBe(true);
      const record = await readRecord(result.path);
      expect(record).toEqual({
        version: 1,
        file: basename(result.path),
        kind: 'image',
        created: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
        model: 'm/x',
        prompt: 'a fox',
        requested: { size: '1024x1024', quality: 'high', output_format: 'png' },
        width: 40,
        height: 30,
        bytes: (await readFile(result.path)).length,
        cost: 0.004,
        latency_ms: 6942,
        url: 'http://cdn.test/abc.png',
        ephemeral: false,
      });
    });

    it('records the default model and an ephemeral request without a URL', async () => {
      const { deps } = await setup(() => json({ data: [{ b64_json: toBase64(makeJpeg(8, 6)) }] }), {
        IMAGEROUTER_DEFAULT_IMAGE_MODEL: 'img/default',
      });
      const result = await runGeneration(deps, 'image', { prompt: 'x', ephemeral: true });
      expect(result).toMatchObject({ width: 8, height: 6 });
      const record = await readRecord(result.path);
      expect(record).toMatchObject({ model: 'img/default', ephemeral: true, width: 8, height: 6 });
      expect(record).not.toHaveProperty('url');
      expect(record).not.toHaveProperty('cost');
    });

    it('records the inputs of an edit and never a data URI', async () => {
      const { deps, outputDir } = await setup((url) =>
        url.startsWith('http://api.test')
          ? json({ data: [{ url: 'http://cdn.test/e.png' }] })
          : image(4, 4),
      );
      const source = join(outputDir, 'source.png');
      await writeFile(source, makePng(2, 2));
      const dataUri = `data:image/png;base64,${toBase64(makePng(2, 2))}`;
      const result = await runGeneration(deps, 'edit', {
        prompt: 'bluer',
        model: 'm/edit',
        images: [source, dataUri, 'http://x.test/a.png'],
        masks: [dataUri],
      });
      const record = await readRecord(result.path);
      expect(record?.kind).toBe('edit');
      expect(record?.inputs).toEqual({
        images: [source, 'data-uri', 'http://x.test/a.png'],
        masks: ['data-uri'],
      });
      expect(await readFile(`${result.path}.json`, 'utf8')).not.toContain('base64');
    });

    it('records a video without dimensions', async () => {
      const { deps } = await setup((url) =>
        url.startsWith('http://api.test')
          ? json({ data: [{ url: 'http://cdn.test/v.mp4' }], cost: 0.5 })
          : new Response(makeMp4(), { headers: { 'content-type': 'video/mp4' } }),
      );
      const result = await runGeneration(deps, 'video', {
        prompt: 'waves',
        model: 'v/m',
        seconds: 'auto',
        size: '1280x720',
      });
      expect(result.path).toMatch(/\.mp4$/);
      expect(result.width).toBeUndefined();
      expect(result.height).toBeUndefined();
      expect(result.metadata_path).toBe(`${result.path}.json`);
      const record = await readRecord(result.path);
      expect(record).toMatchObject({
        kind: 'video',
        requested: { seconds: 'auto', size: '1280x720' },
        cost: 0.5,
      });
      expect(record).not.toHaveProperty('width');
    });

    it('writes one sidecar per result carrying the request cost, index and count', async () => {
      let download = 0;
      const { deps } = await setup((url) => {
        if (url.startsWith('http://api.test')) {
          return json({
            data: [{ url: 'http://cdn.test/1.png' }, { url: 'http://cdn.test/2.png' }],
            cost: 0.02,
          });
        }
        download += 1;
        return image(10 * download, 5);
      });
      const result = await runGeneration(deps, 'image', { prompt: 'x', model: 'm' });
      expect(result.files).toHaveLength(2);
      expect(result.files![0]).toMatchObject({ width: 10, height: 5 });
      expect(result.files![1]).toMatchObject({ width: 20, height: 5 });
      expect(result.metadata_path).toBe(result.files![0]!.metadata_path);
      const records = await Promise.all(result.files!.map((file) => readRecord(file.path)));
      expect(records.map((record) => [record?.cost, record?.index, record?.count])).toEqual([
        [0.02, 0, 2],
        [0.02, 1, 2],
      ]);
      expect(records[1]?.url).toBe('http://cdn.test/2.png');
    });

    it('still succeeds, without metadata_path, when the sidecar cannot be written', async () => {
      const { deps, outputDir } = await setup((url) =>
        url.startsWith('http://api.test')
          ? json({ data: [{ url: 'http://cdn.test/1.png' }], cost: 0.01 })
          : image(3, 3),
      );
      await mkdir(join(outputDir, 'fixed.png.json')); // a directory where the sidecar belongs
      const result = await runGeneration(deps, 'image', {
        prompt: 'x',
        model: 'm',
        filename: 'fixed',
      });
      expect(result.path).toBe(join(outputDir, 'fixed.png'));
      expect(result.cost).toBe(0.01);
      expect(result.width).toBe(3);
      expect(result.metadata_path).toBeUndefined();
      expect(result).not.toHaveProperty('metadata_path');
    });

    it('makes no extra API call for the record', async () => {
      const { deps, calls } = await setup((url) =>
        url.startsWith('http://api.test')
          ? json({ data: [{ url: 'http://cdn.test/1.png' }] })
          : image(3, 3),
      );
      await runGeneration(deps, 'image', { prompt: 'x', model: 'm' });
      // One generation request and one download of its result; the record adds nothing.
      expect(calls.map((call) => call.url)).toEqual([
        expect.stringContaining('http://api.test'),
        'http://cdn.test/1.png',
      ]);
    });
  });
});
