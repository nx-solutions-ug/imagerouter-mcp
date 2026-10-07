import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/lib/config.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { createServer } from '../../src/server.js';
import { fakeFetch, json } from '../helpers/fake-fetch.js';

type Handler = Parameters<typeof fakeFetch>[0];

async function connect(
  handler: Handler,
  env: Record<string, string> = { IMAGEROUTER_API_KEY: 'k' },
) {
  const outputDir = await mkdtemp(join(tmpdir(), 'ir-tools-'));
  const config = resolveConfig(
    { IMAGEROUTER_BASE_URL: 'http://api.test', IMAGEROUTER_OUTPUT_DIR: outputDir, ...env },
    '/h',
  );
  const fake = fakeFetch(handler);
  const server = createServer({ config, client: new ImageRouterClient(config, fake.fetch) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, calls: fake.calls, outputDir };
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

const media = (type: string) =>
  new Response(new Uint8Array([7]), { headers: { 'content-type': type } });
const generated =
  (url: string): Handler =>
  (requestUrl) =>
    requestUrl.startsWith('http://api.test')
      ? json({ data: [{ url }], cost: 0.01, latency: 100 })
      : media('image/png');

describe('tool surface', () => {
  it('registers the five tools with honest annotations', async () => {
    const { client } = await connect(() => json({}));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'edit_image',
      'generate_image',
      'generate_video',
      'get_credits',
      'list_models',
    ]);
    const hint = (name: string) =>
      tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint;
    expect(hint('generate_image')).toBe(false);
    expect(hint('edit_image')).toBe(false);
    expect(hint('generate_video')).toBe(false);
    expect(hint('list_models')).toBe(true);
    expect(hint('get_credits')).toBe(true);
  });
});

describe('generate_image', () => {
  it('saves the image and returns path, url, cost and latency', async () => {
    const { client, calls, outputDir } = await connect(generated('http://cdn.test/a.png'));
    const result = await client.callTool({
      name: 'generate_image',
      arguments: { prompt: 'a fox', model: 'm/x', quality: 'high' },
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(text(result));
    expect(data).toMatchObject({
      url: 'http://cdn.test/a.png',
      model: 'm/x',
      cost: 0.01,
      latency_ms: 100,
    });
    expect(data.path.startsWith(outputDir)).toBe(true);
    expect(calls[0].url).toBe('http://api.test/v1/openai/images/generations');
    expect(JSON.parse(calls[0].init.body as string).quality).toBe('high');
  });

  it('returns isError with the API message on 402', async () => {
    const { client } = await connect(() =>
      json({ error: { message: 'Insufficient credits' } }, 402),
    );
    const result = await client.callTool({
      name: 'generate_image',
      arguments: { prompt: 'x', model: 'm' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('INSUFFICIENT_CREDITS: Insufficient credits');
  });

  it('names the env var when no key is configured', async () => {
    const { client } = await connect(() => json({}), {});
    const result = await client.callTool({
      name: 'generate_image',
      arguments: { prompt: 'x', model: 'm' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('IMAGEROUTER_API_KEY');
  });

  it('rejects an over-long prompt before calling the API', async () => {
    const { client, calls } = await connect(() => json({}));
    const result = await client.callTool({
      name: 'generate_image',
      arguments: { prompt: 'x'.repeat(20_001), model: 'm' },
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('edit_image', () => {
  it('uploads a local file as multipart to the edits endpoint', async () => {
    const { client, calls, outputDir } = await connect(generated('http://cdn.test/e.png'));
    const input = join(outputDir, 'in.png');
    await writeFile(input, new Uint8Array([1, 2]));
    const result = await client.callTool({
      name: 'edit_image',
      arguments: { prompt: 'make it blue', model: 'm', images: [input] },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].url).toBe('http://api.test/v1/openai/images/edits');
    const form = calls[0].init.body as FormData;
    expect(form.getAll('image[]')).toHaveLength(1);
    expect(form.get('prompt')).toBe('make it blue');
  });

  it('returns isError for a missing input file', async () => {
    const { client } = await connect(() => json({}));
    const result = await client.callTool({
      name: 'edit_image',
      arguments: { model: 'm', images: ['/nope/missing.png'] },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Input file not found: /nope/missing.png');
  });
});

describe('generate_video', () => {
  it('posts seconds and saves an mp4', async () => {
    const { client, calls } = await connect((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/v.mp4' }] })
        : media('video/mp4'),
    );
    const result = await client.callTool({
      name: 'generate_video',
      arguments: { prompt: 'waves', model: 'v/m', seconds: 5 },
    });
    expect(JSON.parse(text(result)).path).toMatch(/\.mp4$/);
    expect(calls[0].url).toBe('http://api.test/v1/openai/videos/generations');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ seconds: 5, model: 'v/m' });
  });

  it('requires a prompt or an image', async () => {
    const { client, calls } = await connect(() => json({}));
    const result = await client.callTool({ name: 'generate_video', arguments: { model: 'v/m' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Provide a prompt, at least one image, or both.');
    expect(calls).toHaveLength(0);
  });

  it('returns isError on a 500', async () => {
    const { client } = await connect(() => json({ error: { message: 'provider down' } }, 500));
    const result = await client.callTool({
      name: 'generate_video',
      arguments: { prompt: 'x', model: 'v/m' },
    });
    expect(text(result)).toBe('SERVER_ERROR: provider down');
  });
});

describe('list_models and get_credits', () => {
  const catalogue = {
    'a/img': {
      providers: [{ id: 'p', pricing: { type: 'fixed', value: 0 } }],
      output: ['image'],
      supported_params: { text: true, mask: false, quality: true, edit: true },
      release_date: '2026-01-01',
    },
    'b/vid': {
      providers: [{ id: 'p', pricing: { type: 'fixed', value: 0.2 } }],
      output: ['video'],
      supported_params: { text: true, mask: false, quality: false, edit: false },
    },
  };

  it('lists a filtered compact catalogue without an API key', async () => {
    const { client } = await connect(() => json(catalogue), {});
    const result = await client.callTool({ name: 'list_models', arguments: { output: 'image' } });
    const data = JSON.parse(text(result));
    expect(data.total).toBe(1);
    expect(data.models[0]).toMatchObject({ id: 'a/img', min_price: 0, edit: true });
    expect(data.models[0].providers).toBeUndefined();
  });

  it('returns isError when the catalogue cannot be fetched', async () => {
    const { client } = await connect(() => json({ error: { message: 'down' } }, 503));
    const result = await client.callTool({ name: 'list_models', arguments: {} });
    expect(text(result)).toBe('SERVER_ERROR: down');
  });

  it('returns the balance as numbers', async () => {
    const { client } = await connect(() =>
      json({ remaining_credits: '9.5', credit_usage: '0.5', total_deposits: '10' }),
    );
    const result = await client.callTool({ name: 'get_credits', arguments: {} });
    expect(JSON.parse(text(result))).toEqual({
      remaining_credits: 9.5,
      credit_usage: 0.5,
      total_deposits: 10,
    });
  });

  it('returns isError on 401', async () => {
    const { client } = await connect(() => json({ error: { message: 'bad token' } }, 401));
    const result = await client.callTool({ name: 'get_credits', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('UNAUTHORIZED: bad token');
  });
});
