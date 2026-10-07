import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/lib/config.js';
import { runGeneration } from '../../src/lib/generation.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { summariseModels } from '../../src/lib/models.js';

// Uses only the free test models, so it costs nothing. Skipped without a key.
describe.skipIf(!process.env.IMAGEROUTER_API_KEY)('live ImageRouter API', () => {
  const setup = async () => {
    const config = resolveConfig({
      ...process.env,
      IMAGEROUTER_OUTPUT_DIR: await mkdtemp(join(tmpdir(), 'ir-live-')),
    });
    return { config, client: new ImageRouterClient(config) };
  };

  it('lists models including the free test models', async () => {
    const { client } = await setup();
    const { models } = summariseModels(await client.listModels(), { limit: 1000 });
    expect(models.some((model) => model.id === 'test/test')).toBe(true);
    expect(models.some((model) => model.id === 'ir/test-video')).toBe(true);
  });

  it('reads the balance', async () => {
    const { client } = await setup();
    const credits = await client.getCredits();
    expect(Number.isFinite(credits.remaining_credits)).toBe(true);
  });

  it('generates and saves an image, hosted and ephemeral', async () => {
    const deps = await setup();
    const hosted = await runGeneration(deps, 'image', { prompt: 'smoke test', model: 'test/test' });
    expect(hosted.url).toMatch(/^https:\/\//);
    expect((await stat(hosted.path)).size).toBeGreaterThan(0);

    const ephemeral = await runGeneration(deps, 'image', {
      prompt: 'smoke test',
      model: 'test/test',
      ephemeral: true,
    });
    expect(ephemeral.url).toBeUndefined();
    expect((await stat(ephemeral.path)).size).toBeGreaterThan(0);
  });

  it('edits an image from a local file', async () => {
    const deps = await setup();
    const source = await runGeneration(deps, 'image', { prompt: 'source', model: 'test/test' });
    const edited = await runGeneration(deps, 'edit', {
      prompt: 'edit',
      model: 'test/test',
      images: [source.path],
    });
    expect((await stat(edited.path)).size).toBeGreaterThan(0);
  });

  it('generates and saves a video', async () => {
    const deps = await setup();
    const video = await runGeneration(deps, 'video', {
      prompt: 'smoke test',
      model: 'ir/test-video',
    });
    expect((await stat(video.path)).size).toBeGreaterThan(0);
  });
});
