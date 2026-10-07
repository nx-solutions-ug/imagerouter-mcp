import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/lib/config.js';
import { runGeneration } from '../../src/lib/generation.js';
import { ImageRouterError } from '../../src/lib/errors.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { fakeFetch, json } from '../helpers/fake-fetch.js';

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
    const { deps, outputDir } = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/1.png' }] })
        : png(),
    );
    const blocker = join(outputDir, 'file');
    await writeFile(blocker, 'x');
    const error = await failure(
      runGeneration(deps, 'image', {
        prompt: 'x',
        model: 'm',
        output_dir: join(blocker, 'sub'),
      }),
    );
    expect(error.code).toBe('LOCAL_ERROR');
    expect(error.message).toContain('Cannot write to output directory');
    expect(error.message).toContain('http://cdn.test/1.png');
    expect(error.message).not.toContain('Already saved');
  });

  it('says an ephemeral result cannot be fetched again when saving fails', async () => {
    const { deps, outputDir } = await setup(() => json({ data: [{ b64_json: 'AQID' }] }));
    const blocker = join(outputDir, 'file');
    await writeFile(blocker, 'x');
    const error = await failure(
      runGeneration(deps, 'image', {
        prompt: 'x',
        model: 'm',
        ephemeral: true,
        output_dir: join(blocker, 'sub'),
      }),
    );
    expect(error.code).toBe('LOCAL_ERROR');
    expect(error.message).toContain(
      'This was an ephemeral request, so the result cannot be fetched again.',
    );
    expect(error.message).not.toContain('stay available');
  });
});
