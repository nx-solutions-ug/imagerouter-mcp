import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/lib/config.js';
import { ImageRouterError } from '../../src/lib/errors.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { fakeFetch, json } from '../helpers/fake-fetch.js';

const config = resolveConfig(
  { IMAGEROUTER_API_KEY: 'k', IMAGEROUTER_BASE_URL: 'http://api.test' },
  '/h',
);

describe('ImageRouterClient', () => {
  it.each([
    ['image', '/v1/openai/images/generations'],
    ['edit', '/v1/openai/images/edits'],
    ['video', '/v1/openai/videos/generations'],
  ] as const)('posts %s JSON to %s with a bearer token', async (kind, path) => {
    const { fetch, calls } = fakeFetch(() =>
      json({ data: [{ url: 'http://x/a.webp' }], cost: 0.1, latency: 5 }),
    );
    const result = await new ImageRouterClient(config, fetch).generate(kind, {
      json: { model: 'm' },
    });
    expect(result.data[0].url).toBe('http://x/a.webp');
    expect(calls[0].url).toBe(`http://api.test${path}`);
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('authorization')).toBe('Bearer k');
    expect(headers.get('content-type')).toBe('application/json');
    expect(calls[0].init.body).toBe('{"model":"m"}');
  });

  it('sends FormData untouched and lets fetch set the content type', async () => {
    const { fetch, calls } = fakeFetch(() => json({ data: [] }));
    const form = new FormData();
    form.set('model', 'm');
    await new ImageRouterClient(config, fetch).generate('edit', { form });
    expect(calls[0].init.body).toBe(form);
    expect(new Headers(calls[0].init.headers).has('content-type')).toBe(false);
  });

  it('throws UNAUTHORIZED before any request when the key is missing', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const client = new ImageRouterClient(resolveConfig({}, '/h'), fetch);
    await expect(client.getCredits()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(0);
  });

  it('lists models without a key', async () => {
    const { fetch, calls } = fakeFetch(() => json({ 'a/b': { providers: [], output: ['image'] } }));
    const models = await new ImageRouterClient(resolveConfig({}, '/h'), fetch).listModels();
    expect(Object.keys(models)).toEqual(['a/b']);
    expect(new Headers(calls[0].init.headers).has('authorization')).toBe(false);
  });

  it('converts credit strings to numbers', async () => {
    const { fetch } = fakeFetch(() =>
      json({ remaining_credits: '4.5', credit_usage: '1.25', total_deposits: '5.75' }),
    );
    expect(await new ImageRouterClient(config, fetch).getCredits()).toEqual({
      remaining_credits: 4.5,
      credit_usage: 1.25,
      total_deposits: 5.75,
    });
  });

  it('maps HTTP errors, network failures and timeouts', async () => {
    const http = fakeFetch(() => json({ error: { message: 'no funds' } }, 402));
    await expect(new ImageRouterClient(config, http.fetch).getCredits()).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
    });

    const net = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(new ImageRouterClient(config, net.fetch).getCredits()).rejects.toMatchObject({
      code: 'CONNECTION_ERROR',
    });

    const slow = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const fast = { ...config, imageTimeoutMs: 20 };
    await expect(
      new ImageRouterClient(fast, slow.fetch).generate('image', { json: { model: 'm' } }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('downloads bytes with their content type and names the URL on failure', async () => {
    const ok = fakeFetch(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const file = await new ImageRouterClient(config, ok.fetch).download('http://x/a');
    expect([...file.bytes]).toEqual([1, 2, 3]);
    expect(file.contentType).toBe('image/png');

    const gone = fakeFetch(() => new Response('', { status: 404 }));
    await expect(new ImageRouterClient(config, gone.fetch).download('http://x/a')).rejects.toThrow(
      'http://x/a',
    );
  });

  describe('billing note and body failures', () => {
    const note = 'The request may still complete and be billed. Check get_credits before retrying.';
    const failing = () =>
      fakeFetch(() => {
        throw new TypeError('fetch failed');
      });

    it('adds the billing note to generate timeouts and network failures only', async () => {
      const slow = fakeFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      );
      const fast = { ...config, imageTimeoutMs: 20 };
      const timeout = await new ImageRouterClient(fast, slow.fetch)
        .generate('image', { json: {} })
        .catch((e: Error) => e);
      expect(timeout).toMatchObject({ code: 'TIMEOUT' });
      expect((timeout as Error).message.endsWith(note)).toBe(true);

      const net = await new ImageRouterClient(config, failing().fetch)
        .generate('image', { json: {} })
        .catch((e: Error) => e);
      expect(net).toMatchObject({ code: 'CONNECTION_ERROR' });
      expect((net as Error).message.endsWith(note)).toBe(true);

      const read = await new ImageRouterClient(config, failing().fetch)
        .getCredits()
        .catch((e: Error) => e);
      expect(read).toMatchObject({ code: 'CONNECTION_ERROR' });
      expect((read as Error).message).not.toContain('billed');
    });

    it('adds the billing note to generation 5xx errors only', async () => {
      const down = (status: number) =>
        fakeFetch(() => json({ error: { message: 'down' } }, status));
      for (const status of [500, 503]) {
        const error = await new ImageRouterClient(config, down(status).fetch)
          .generate('image', { json: {} })
          .catch((e: Error) => e);
        expect(error).toMatchObject({ code: 'SERVER_ERROR', statusCode: status });
        expect((error as Error).message).toBe(`down. ${note}`);
      }
      const rejected = await new ImageRouterClient(config, down(402).fetch)
        .generate('image', { json: {} })
        .catch((e: Error) => e);
      expect((rejected as Error).message).toBe('down');
      const read = await new ImageRouterClient(config, down(503).fetch)
        .getCredits()
        .catch((e: Error) => e);
      expect((read as Error).message).toBe('down');
    });

    it('maps a non-JSON 200 to API_ERROR, with the note only for generate', async () => {
      const html = () => fakeFetch(() => new Response('<html>', { status: 200 }));
      const gen = await new ImageRouterClient(config, html().fetch)
        .generate('image', { json: {} })
        .catch((e: Error) => e);
      expect(gen).toMatchObject({ code: 'API_ERROR' });
      expect((gen as Error).message).toBe(
        `ImageRouter returned a response that is not valid JSON. ${note}`,
      );

      const credits = await new ImageRouterClient(config, html().fetch)
        .getCredits()
        .catch((e: Error) => e);
      expect(credits).toMatchObject({ code: 'API_ERROR' });
      expect((credits as Error).message).toBe(
        'ImageRouter returned a response that is not valid JSON.',
      );
    });

    it('maps a body stream that errors mid-read to an ImageRouterError', async () => {
      const broken = fakeFetch(() => {
        const body = new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'));
          },
        });
        return new Response(body, { status: 200 });
      });
      const error = await new ImageRouterClient(config, broken.fetch)
        .generate('image', { json: {} })
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(ImageRouterError);
      expect(error).toMatchObject({ code: 'CONNECTION_ERROR' });
    });
  });
});
