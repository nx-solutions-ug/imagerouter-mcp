import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDashboardHandler, statusFor } from '../../src/dashboard/routes.js';
import { ImageRouterError } from '../../src/lib/errors.js';
import { resolveConfig } from '../../src/lib/config.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { fakeFetch, json } from '../helpers/fake-fetch.js';

const PORT = 4477;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function setup(
  handler: Parameters<typeof fakeFetch>[0],
  env: Record<string, string> = { IMAGEROUTER_API_KEY: 'k' },
) {
  const outputDir = await mkdtemp(join(tmpdir(), 'ir-dash-out-'));
  const uiDir = await mkdtemp(join(tmpdir(), 'ir-dash-ui-'));
  await writeFile(join(uiDir, 'index.html'), '<!doctype html><title>ui</title>');
  await writeFile(join(uiDir, 'app.js'), 'console.log(1)');
  const config = resolveConfig(
    { IMAGEROUTER_BASE_URL: 'http://api.test', IMAGEROUTER_OUTPUT_DIR: outputDir, ...env },
    '/h',
  );
  const fake = fakeFetch(handler);
  const handle = createDashboardHandler({
    deps: { config, client: new ImageRouterClient(config, fake.fetch) },
    uiDir,
    port: PORT,
  });
  const call = (path: string, init: RequestInit = {}) =>
    handle(
      new Request(`${ORIGIN}${path}`, {
        ...init,
        headers: { host: `127.0.0.1:${PORT}`, ...init.headers },
      }),
    );
  return { call, handle, calls: fake.calls, outputDir };
}

const png = () => new Response(new Uint8Array([5]), { headers: { 'content-type': 'image/png' } });

describe('dashboard handler', () => {
  it('serves the UI and its assets', async () => {
    const { call } = await setup(() => json({}));
    const page = await call('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<title>ui</title>');
    const script = await call('/app.js');
    expect(script.headers.get('content-type')).toContain('javascript');
    expect((await call('/missing.js')).status).toBe(404);
    expect((await call('/..%2Fsecret')).status).toBe(404);
  });

  it('reports status without leaking the key', async () => {
    const { call, outputDir } = await setup(() => json({}), {
      IMAGEROUTER_API_KEY: 'secret-key',
      IMAGEROUTER_DEFAULT_IMAGE_MODEL: 'a/b',
    });
    const body = await (await call('/api/status')).text();
    expect(JSON.parse(body)).toEqual({ hasApiKey: true, outputDir, defaultImageModel: 'a/b' });
    expect(body).not.toContain('secret-key');
  });

  it('returns image models only', async () => {
    const { call } = await setup(() =>
      json({
        'a/img': {
          providers: [],
          output: ['image'],
          supported_params: { text: true, mask: false, quality: true, edit: false },
        },
        'b/vid': {
          providers: [],
          output: ['video'],
          supported_params: { text: true, mask: false, quality: false, edit: false },
        },
      }),
    );
    const data = await (await call('/api/models')).json();
    expect(data.models.map((model: { id: string }) => model.id)).toEqual(['a/img']);
  });

  it('returns credits and maps upstream errors', async () => {
    const ok = await setup(() =>
      json({ remaining_credits: '3', credit_usage: '1', total_deposits: '4' }),
    );
    expect(await (await ok.call('/api/credits')).json()).toEqual({
      remaining_credits: 3,
      credit_usage: 1,
      total_deposits: 4,
    });
    const bad = await setup(() => json({ error: { message: 'bad token' } }, 401));
    const response = await bad.call('/api/credits');
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('generates, saves into the configured directory and exposes the file', async () => {
    const { call, calls, outputDir } = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/a.png' }], cost: 0.02 })
        : png(),
    );
    const response = await call('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        prompt: 'a fox',
        model: 'm',
        output_dir: '/tmp/elsewhere',
        images: ['/etc/passwd'],
      }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.path.startsWith(outputDir)).toBe(true);
    expect(data.fileUrl).toBe(`/files/${encodeURIComponent(data.name)}`);
    expect(data.cost).toBe(0.02);
    expect(JSON.parse(calls[0].init.body as string).image).toBeUndefined();

    const file = await call(data.fileUrl);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([5]);

    const gallery = await (await call('/api/images?limit=10')).json();
    expect(gallery.total).toBe(1);
    expect(gallery.items[0]).toMatchObject({
      name: data.name,
      fileUrl: data.fileUrl,
      kind: 'image',
    });
  });

  it('rejects an empty or malformed generate body', async () => {
    const { call, calls } = await setup(() => json({}));
    const post = (body: string) =>
      call('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body,
      });
    expect((await post('{"prompt":"  "}')).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post('{"prompt":"x","quality":"ultra"}')).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('maps local and connection failures to distinct statuses', async () => {
    const post = (call: Awaited<ReturnType<typeof setup>>['call']) =>
      call('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: '{"prompt":"x","model":"m"}',
      });

    const download404 = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/a.png' }] })
        : new Response('gone', { status: 404 }),
    );
    const local = await post(download404.call);
    expect(local.status).toBe(500);
    expect((await local.json()).error.code).toBe('LOCAL_ERROR');

    const refused = await setup(() => {
      throw new TypeError('fetch failed');
    });
    const connection = await post(refused.call);
    expect(connection.status).toBe(502);
    expect((await connection.json()).error.code).toBe('CONNECTION_ERROR');
  });

  it('honours filename, keeps files in the output dir and ignores output_dir', async () => {
    const { call, outputDir } = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/a.png' }] })
        : png(),
    );
    const post = (body: object) =>
      call('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ prompt: 'x', model: 'm', ...body }),
      });
    const named = await (await post({ filename: 'my-fox', output_dir: '/tmp/elsewhere' })).json();
    expect(named.name).toBe('my-fox.png');
    expect(named.path).toBe(join(outputDir, 'my-fox.png'));

    const sneaky = await (await post({ filename: '../../x' })).json();
    expect(sneaky.path.startsWith(outputDir)).toBe(true);
    expect(sneaky.name).toBe('x.png');
  });

  it('returns no url for ephemeral generations', async () => {
    const { call, outputDir } = await setup(() =>
      json({ data: [{ b64_json: Buffer.from([7]).toString('base64') }] }),
    );
    const response = await call('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ prompt: 'x', model: 'm', ephemeral: true }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.url).toBeUndefined();
    expect(data.path.startsWith(outputDir)).toBe(true);
  });

  it('maps a request timeout to 504', async () => {
    const { call } = await setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      { IMAGEROUTER_API_KEY: 'k', IMAGEROUTER_IMAGE_TIMEOUT_MS: '1' },
    );
    const response = await call('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: '{"prompt":"x","model":"m"}',
    });
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe('TIMEOUT');
  });

  it('answers 401 when no API key is configured', async () => {
    const { call, calls } = await setup(() => json({}), {});
    const response = await call('/api/credits');
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHORIZED');
    expect(calls).toHaveLength(0);
  });

  it('never produces a status outside 400-599', () => {
    expect(statusFor(new ImageRouterError('x', 'API_ERROR', 999))).toBe(502);
    expect(statusFor(new ImageRouterError('x', 'SERVER_ERROR', 600))).toBe(502);
    expect(statusFor(new ImageRouterError('x', 'RATE_LIMITED', 429))).toBe(429);
    expect(statusFor(new ImageRouterError('x', 'API_ERROR', 200))).toBe(400);
  });

  it('sets hardening headers', async () => {
    const { call } = await setup(() => json({}));
    const page = await call('/');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('cross-origin-resource-policy')).toBeNull();
    for (const path of ['/api/status', '/api/nope', '/files/missing.png', '/files/notes.txt']) {
      const response = await call(path);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    }
    const forbidden = await setup(() => json({}));
    const blocked = await forbidden.handle(
      new Request(`${ORIGIN}/api/status`, { headers: { host: 'evil.example' } }),
    );
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('refuses file names that leave the output directory', async () => {
    const { call } = await setup(() => json({}));
    expect((await call('/files/..%2F..%2Fetc%2Fpasswd')).status).toBe(400);
    expect((await call('/files/notes.txt')).status).toBe(400);
    expect((await call('/files/missing.png')).status).toBe(404);
  });

  it('rejects foreign hosts and cross-site posts', async () => {
    const { handle, calls } = await setup(() => json({}));
    const rebind = await handle(
      new Request(`${ORIGIN}/api/credits`, { headers: { host: 'evil.example:4477' } }),
    );
    expect(rebind.status).toBe(403);

    const crossSite = await handle(
      new Request(`${ORIGIN}/api/generate`, {
        method: 'POST',
        headers: {
          host: `localhost:${PORT}`,
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: '{"prompt":"x","model":"m"}',
      }),
    );
    expect(crossSite.status).toBe(403);

    const noOrigin = await handle(
      new Request(`${ORIGIN}/api/generate`, {
        method: 'POST',
        headers: { host: `localhost:${PORT}`, 'content-type': 'text/plain' },
        body: '{"prompt":"x","model":"m"}',
      }),
    );
    expect(noOrigin.status).toBe(415);
    expect(calls).toHaveLength(0);

    const local = await handle(
      new Request(`${ORIGIN}/api/status`, { headers: { host: `localhost:${PORT}` } }),
    );
    expect(local.status).toBe(200);
  });

  it('answers unknown API routes and methods', async () => {
    const { call } = await setup(() => json({}));
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api/generate')).status).toBe(405);
  });
});
