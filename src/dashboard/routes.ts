import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';
import { ImageRouterError } from '../lib/errors.js';
import { type Deps, runGeneration } from '../lib/generation.js';
import { summariseModels } from '../lib/models.js';
import { MEDIA_TYPES, listSaved, resolveSavedFile } from '../lib/output.js';

const ASSET_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

const generateBody = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  model: z.string().min(1).optional(),
  size: z
    .string()
    .regex(/^(auto|\d+x\d+)$/)
    .optional(),
  quality: z.enum(['auto', 'low', 'medium', 'high']).optional(),
  output_format: z.enum(['webp', 'jpeg', 'png']).optional(),
});

function send(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function fail(status: number, code: string, message: string): Response {
  return send({ error: { code, message } }, status);
}

function statusFor(error: ImageRouterError): number {
  if (error.statusCode >= 400) return error.statusCode;
  if (error.code === 'TIMEOUT') return 504;
  if (error.code === 'CONNECTION_ERROR') return 502;
  // The request was fine; the server could not download or save the result.
  if (error.code === 'LOCAL_ERROR') return 500;
  return 400;
}

function failFrom(error: unknown): Response {
  if (error instanceof ImageRouterError) {
    return fail(statusFor(error), error.code, error.message);
  }
  return fail(500, 'INTERNAL', error instanceof Error ? error.message : String(error));
}

const fileUrl = (name: string): string => `/files/${encodeURIComponent(name)}`;

export function createDashboardHandler(options: {
  deps: Deps;
  uiDir: string;
  port: number;
}): (request: Request) => Promise<Response> {
  const { deps, uiDir, port } = options;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((host) => `http://${host}`));

  async function asset(pathname: string): Promise<Response> {
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    const type = ASSET_TYPES[extname(name)];
    if (!type || name !== basename(name)) return fail(404, 'NOT_FOUND', 'Not found');
    try {
      return new Response(await readFile(join(uiDir, name)), { headers: { 'content-type': type } });
    } catch {
      return fail(404, 'NOT_FOUND', 'Not found');
    }
  }

  async function savedFile(encoded: string): Promise<Response> {
    let name: string;
    try {
      name = decodeURIComponent(encoded);
    } catch {
      return fail(400, 'INVALID_REQUEST', 'Invalid file name');
    }
    const path = resolveSavedFile(deps.config.outputDir, name);
    if (!path) return fail(400, 'INVALID_REQUEST', 'Invalid file name');
    try {
      const type = MEDIA_TYPES[extname(name).slice(1).toLowerCase().replace('jpeg', 'jpg')];
      return new Response(await readFile(path), {
        headers: { 'content-type': type, 'cache-control': 'private, max-age=3600' },
      });
    } catch {
      return fail(404, 'NOT_FOUND', 'File not found');
    }
  }

  async function generate(request: Request): Promise<Response> {
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return fail(415, 'INVALID_REQUEST', 'Send application/json');
    }
    const parsed = generateBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, 'INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid request');
    }
    const result = await runGeneration(deps, 'image', parsed.data);
    const name = basename(result.path);
    return send({ ...result, name, fileUrl: fileUrl(name) });
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (!hosts.has(request.headers.get('host') ?? '')) {
      return fail(403, 'FORBIDDEN', 'This dashboard only answers on localhost');
    }
    const origin = request.headers.get('origin');
    if (request.method !== 'GET' && origin !== null && !origins.has(origin)) {
      return fail(403, 'FORBIDDEN', 'Cross-site requests are not allowed');
    }

    try {
      if (pathname === '/api/generate') {
        if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST');
        return await generate(request);
      }
      if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Use GET');

      if (pathname === '/api/status') {
        return send({
          hasApiKey: Boolean(deps.config.apiKey),
          outputDir: deps.config.outputDir,
          defaultImageModel: deps.config.defaultImageModel ?? null,
        });
      }
      if (pathname === '/api/models') {
        return send(
          summariseModels(await deps.client.listModels(), { output: 'image', limit: 500 }),
        );
      }
      if (pathname === '/api/credits') return send(await deps.client.getCredits());
      if (pathname === '/api/images') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 60, 1), 200);
        const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
        const page = await listSaved(deps.config.outputDir, { limit, offset });
        return send({
          total: page.total,
          items: page.items.map((item) => ({ ...item, fileUrl: fileUrl(item.name) })),
        });
      }
      if (pathname.startsWith('/api/')) return fail(404, 'NOT_FOUND', 'Unknown API route');
      if (pathname.startsWith('/files/')) return await savedFile(pathname.slice('/files/'.length));
      return await asset(pathname);
    } catch (error) {
      return failFrom(error);
    }
  };
}
