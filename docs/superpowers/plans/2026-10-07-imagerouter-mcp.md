# imagerouter-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Bun-runtime stdio MCP server for the ImageRouter API (five tools) plus a localhost dashboard, published as `nx-solutions-ug/imagerouter-mcp` with the chronova-family pipeline.

**Architecture:** One bin (`src/cli.ts`) with two modes. Both sit on the same libs: a single `ImageRouterClient` HTTP boundary, `inputs.ts` (request assembly), `output.ts` (saving), `models.ts` (catalogue projection) and `generation.ts` (the one generation flow). The dashboard is a pure `Request → Response` handler wrapped by `Bun.serve`, so it is testable under vitest/Node.

**Tech Stack:** Bun 1.4.2, TypeScript 6, `@modelcontextprotocol/sdk` ^1.32, Zod 4, vitest 5, oxlint, oxfmt, husky, semantic-release, Tailwind 4 CLI + daisyUI 5.

**Spec:** `docs/superpowers/specs/2026-10-07-imagerouter-mcp-design.md`

## Global Constraints

- All paths are relative to `/home/dev/.projects/imagerouter-mcp`. Never write into `/home/dev/.projects/chronova-mcp` or `/home/dev/.projects/chronova`; they are read-only references.
- Bun is the runtime and package manager. No `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`.
- `bun.lock` must be generated with Bun **1.4.2** (the CI pin). Local Bun is 1.3.14: run `bun upgrade` first, or use `bunx bun@1.4.2 install`.
- Source uses ESM with `.js` import suffixes (`module: Node16`), single quotes, semicolons, 100 columns (oxfmt).
- Tool handlers never throw. Failures return `{ content: [{ type: 'text', text }], isError: true }`.
- Successful tool results are `JSON.stringify(data, null, 2)` in one text block.
- `ImageRouterClient` is the only module that calls `fetch`.
- Nothing is written to stdout in MCP mode except protocol frames; diagnostics go to stderr.
- Environment variable names, defaults and the error-code table are exactly those in the spec.
- Commits use Conventional Commits and end with the two attribution trailers used in this session.
- CI must not call the paid API: live tests run only when `IMAGEROUTER_API_KEY` is set and are excluded from `bun run test`.

## Review Focus

1. **API returns `data: []` or an entry with neither `url` nor `b64_json`** — the tool reports `ImageRouter returned no result` as an error instead of crashing or claiming success. (Task 6)
2. **Prompt with no filename-safe characters (emoji, CJK) or no prompt at all** — the file is still saved, named from timestamp and suffix only. (Task 5)
3. **`filename` argument containing `/`, `..` or an absolute path** — only the basename is used; nothing is written outside the output directory. (Task 5)
4. **Hosted URL download fails (404, network) after the API call succeeded and was billed** — the error names the URL so the user can still fetch the result. (Task 6)
5. **Dashboard reached through a non-local `Host` (DNS rebinding) or a cross-site `POST`** — rejected with 403 before any handler runs. (Task 8)

## File Structure

| File | Responsibility |
|---|---|
| `src/cli.ts` | Bin. Parses argv, starts stdio MCP or dashboard |
| `src/server.ts` | `createServer(deps)` → `McpServer` with all tools |
| `src/version.ts` | `VERSION` from package.json |
| `src/lib/types.ts` | Shared types |
| `src/lib/config.ts` | `resolveConfig(env, home)` |
| `src/lib/errors.ts` | `ImageRouterError`, status mapping, `formatToolError` |
| `src/lib/imagerouter-client.ts` | All HTTP |
| `src/lib/inputs.ts` | Input classification, JSON vs multipart body |
| `src/lib/output.ts` | Naming, saving, listing, safe file resolution |
| `src/lib/models.ts` | Catalogue projection and filters |
| `src/lib/generation.ts` | `runGeneration` — model resolution → request → save |
| `src/tools/*.ts` | One registrar per tool, `index.ts` wires them |
| `src/dashboard/routes.ts` | `createDashboardHandler(deps)` |
| `src/dashboard/serve.ts` | `Bun.serve` wrapper, browser open |
| `src/dashboard/ui/{index.html,app.ts,styles.css}` | The page |
| `scripts/build.ts` | Bundles cli + UI into `dist/` |
| `tests/unit/*.test.ts`, `tests/integration/*.test.ts`, `tests/live/smoke.test.ts` | Tests |
| `tests/helpers/fake-fetch.ts` | Scripted fetch stub |

---

### Task 1: Scaffold, tooling and a green empty pipeline

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.live.config.ts`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`, `.npmignore`, `.env.example`, `.husky/pre-commit`, `renovate.json`, `glama.json`, `.releaserc.json`, `src/version.ts`, `src/lib/types.ts`, `tests/unit/version.test.ts`

**Interfaces:**
- Produces: `VERSION: string` from `src/version.ts`; every type in `src/lib/types.ts` below, used by all later tasks.

- [ ] **Step 1: Copy unchanged tooling files from chronova-mcp**

```bash
cd /home/dev/.projects/imagerouter-mcp
R=/home/dev/.projects/chronova-mcp
cp $R/.oxlintrc.json $R/.oxfmtrc.json $R/renovate.json $R/glama.json $R/tsconfig.json .
mkdir -p .husky && cp $R/.husky/pre-commit .husky/pre-commit
sed 's#nx-solutions-ug/chronova-mcp#nx-solutions-ug/imagerouter-mcp#g' $R/.releaserc.json > .releaserc.json
printf 'node_modules\ndist\n.env\n*.tgz\n' > .gitignore
printf 'node_modules\nsrc\ntests\nscripts\ndocs\n.env\n*.tgz\n' > .npmignore
```

Then in `.oxlintrc.json` remove `"react"` from `plugins`, and in `tsconfig.json` set `"types": ["node", "bun"]`, `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"noEmit": true`, remove `outDir`, `declaration`, `declarationMap`, `sourceMap`, and set `"include": ["src", "scripts"]`.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "imagerouter-mcp",
  "version": "0.0.0",
  "description": "MCP server and local dashboard for generating images and videos through the ImageRouter API",
  "keywords": ["mcp", "modelcontextprotocol", "imagerouter", "image-generation", "video-generation", "bun"],
  "homepage": "https://github.com/nx-solutions-ug/imagerouter-mcp#readme",
  "bugs": { "url": "https://github.com/nx-solutions-ug/imagerouter-mcp/issues" },
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/nx-solutions-ug/imagerouter-mcp.git" },
  "bin": { "imagerouter-mcp": "./dist/cli.js" },
  "files": ["dist", "README.md"],
  "type": "module",
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "bun run scripts/build.ts",
    "prepublishOnly": "bun run build",
    "start": "bun dist/cli.js",
    "dev": "bun --watch src/cli.ts",
    "dashboard": "bun run build && bun dist/cli.js dashboard",
    "test": "vitest run",
    "test:live": "vitest run --config vitest.live.config.ts",
    "type-check": "tsc --noEmit",
    "lint": "oxlint --vitest-plugin --import-plugin",
    "lint:fix": "oxlint --vitest-plugin --import-plugin --fix",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "semantic-release": "semantic-release",
    "prepare": "husky || true"
  },
  "engines": { "bun": ">=1.2" },
  "packageManager": "bun@1.4.2"
}
```

- [ ] **Step 3: Install dependencies with Bun 1.4.2**

```bash
bun --version   # must print 1.4.2; if not: bun upgrade
bun add @modelcontextprotocol/sdk zod
bun add -d typescript vitest oxlint@1.86.0 oxfmt@0.71.0 husky @types/node @types/bun \
  tailwindcss @tailwindcss/cli daisyui semantic-release \
  @semantic-release/changelog @semantic-release/commit-analyzer @semantic-release/git \
  @semantic-release/github @semantic-release/npm @semantic-release/release-notes-generator
```

- [ ] **Step 4: Write vitest configs and `.env.example`**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

`vitest.live.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/live/**/*.test.ts'], testTimeout: 300_000 },
});
```

`.env.example`:

```
IMAGEROUTER_API_KEY=
# IMAGEROUTER_OUTPUT_DIR=~/Pictures/imagerouter
# IMAGEROUTER_DEFAULT_IMAGE_MODEL=black-forest-labs/FLUX-1-schnell:free
# IMAGEROUTER_DEFAULT_VIDEO_MODEL=
# IMAGEROUTER_DASHBOARD_PORT=4477
```

- [ ] **Step 5: Write `src/version.ts` and `src/lib/types.ts`**

`src/version.ts`:

```ts
import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
```

Add `"resolveJsonModule": true` to `tsconfig.json`.

`src/lib/types.ts`:

```ts
export type GenerationKind = 'image' | 'edit' | 'video';
export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type OutputFormat = 'webp' | 'jpeg' | 'png';

export interface Config {
  apiKey?: string;
  baseUrl: string;
  outputDir: string;
  defaultImageModel?: string;
  defaultVideoModel?: string;
  imageTimeoutMs: number;
  videoTimeoutMs: number;
  dashboardPort: number;
}

export interface GenerationResponse {
  created?: number;
  data: Array<{ url?: string; b64_json?: string }>;
  latency?: number;
  cost?: number;
}

export interface RawProvider {
  id: string;
  pricing?: { type?: string; value?: number; range?: { min: number; average?: number; max: number } };
}

export interface RawModel {
  providers: RawProvider[];
  output: Array<'image' | 'video'>;
  supported_params: { text: boolean; mask: boolean; quality: boolean; edit: boolean };
  sizes?: string[];
  seconds?: number[];
  default_seconds?: number;
  release_date?: string;
}

export type RawCatalogue = Record<string, RawModel>;

export interface ModelSummary {
  id: string;
  output: 'image' | 'video';
  text: boolean;
  edit: boolean;
  mask: boolean;
  quality: boolean;
  sizes?: string[];
  seconds?: number[];
  min_price: number | null;
  release_date?: string;
}

export interface Credits {
  remaining_credits: number;
  credit_usage: number;
  total_deposits: number;
}

export interface SavedFile {
  path: string;
  url?: string;
}

export interface GenerationResult {
  path: string;
  url?: string;
  model: string;
  cost?: number;
  latency_ms?: number;
  files?: SavedFile[];
}
```

- [ ] **Step 6: Write the first test**

`tests/unit/version.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';

describe('VERSION', () => {
  it('is a semver string from package.json', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 7: Run all gates**

Run: `bun run test && bun run type-check && bun run lint && bun run format && bun run format:check`
Expected: 1 test passes; type-check, lint and format:check exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold project tooling"
```

---
### Task 2: Configuration

**Files:**
- Create: `src/lib/config.ts`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Consumes: `Config` from `src/lib/types.ts`.
- Produces: `resolveConfig(env?: Record<string, string | undefined>, home?: string): Config`; `expandHome(path: string, home?: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { expandHome, resolveConfig } from '../../src/lib/config.js';

describe('resolveConfig', () => {
  it('uses spec defaults when the environment is empty', () => {
    expect(resolveConfig({}, '/home/u')).toEqual({
      apiKey: undefined,
      baseUrl: 'https://api.imagerouter.io',
      outputDir: '/home/u/Pictures/imagerouter',
      defaultImageModel: undefined,
      defaultVideoModel: undefined,
      imageTimeoutMs: 180_000,
      videoTimeoutMs: 900_000,
      dashboardPort: 4477,
    });
  });

  it('reads every variable and trims a trailing slash from the base URL', () => {
    const config = resolveConfig(
      {
        IMAGEROUTER_API_KEY: ' key ',
        IMAGEROUTER_BASE_URL: 'http://localhost:9/',
        IMAGEROUTER_OUTPUT_DIR: '~/out',
        IMAGEROUTER_DEFAULT_IMAGE_MODEL: 'a/b',
        IMAGEROUTER_DEFAULT_VIDEO_MODEL: 'c/d',
        IMAGEROUTER_IMAGE_TIMEOUT_MS: '1000',
        IMAGEROUTER_VIDEO_TIMEOUT_MS: '2000',
        IMAGEROUTER_DASHBOARD_PORT: '5000',
      },
      '/home/u',
    );
    expect(config).toEqual({
      apiKey: 'key',
      baseUrl: 'http://localhost:9',
      outputDir: '/home/u/out',
      defaultImageModel: 'a/b',
      defaultVideoModel: 'c/d',
      imageTimeoutMs: 1000,
      videoTimeoutMs: 2000,
      dashboardPort: 5000,
    });
  });

  it('treats blank strings as unset and falls back on invalid numbers', () => {
    const config = resolveConfig(
      { IMAGEROUTER_API_KEY: '  ', IMAGEROUTER_IMAGE_TIMEOUT_MS: 'abc', IMAGEROUTER_DASHBOARD_PORT: '-1' },
      '/home/u',
    );
    expect(config.apiKey).toBeUndefined();
    expect(config.imageTimeoutMs).toBe(180_000);
    expect(config.dashboardPort).toBe(4477);
  });
});

describe('expandHome', () => {
  it('expands a leading tilde only', () => {
    expect(expandHome('~/a', '/h')).toBe('/h/a');
    expect(expandHome('~', '/h')).toBe('/h');
    expect(expandHome('/x/~/a', '/h')).toBe('/x/~/a');
  });
});
```

- [ ] **Step 2: Run it** — `bun run test tests/unit/config.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/config.ts`**

```ts
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Config } from './types.js';

type Env = Record<string, string | undefined>;

export function expandHome(path: string, home: string = homedir()): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const parsed = Number(text(env, name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveConfig(env: Env = process.env, home: string = homedir()): Config {
  const outputDir = text(env, 'IMAGEROUTER_OUTPUT_DIR') ?? '~/Pictures/imagerouter';
  return {
    apiKey: text(env, 'IMAGEROUTER_API_KEY'),
    baseUrl: (text(env, 'IMAGEROUTER_BASE_URL') ?? 'https://api.imagerouter.io').replace(/\/+$/, ''),
    outputDir: resolve(expandHome(outputDir, home)),
    defaultImageModel: text(env, 'IMAGEROUTER_DEFAULT_IMAGE_MODEL'),
    defaultVideoModel: text(env, 'IMAGEROUTER_DEFAULT_VIDEO_MODEL'),
    imageTimeoutMs: positiveInt(env, 'IMAGEROUTER_IMAGE_TIMEOUT_MS', 180_000),
    videoTimeoutMs: positiveInt(env, 'IMAGEROUTER_VIDEO_TIMEOUT_MS', 900_000),
    dashboardPort: positiveInt(env, 'IMAGEROUTER_DASHBOARD_PORT', 4477),
  };
}
```

- [ ] **Step 4: Run it** — same command → PASS (4 tests).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: resolve configuration from environment"`

---

### Task 3: Errors and the HTTP client

**Files:**
- Create: `src/lib/errors.ts`, `src/lib/imagerouter-client.ts`, `tests/helpers/fake-fetch.ts`
- Test: `tests/unit/errors.test.ts`, `tests/unit/client.test.ts`

**Interfaces:**
- Consumes: `Config`, `GenerationKind`, `GenerationResponse`, `RawCatalogue`, `Credits`.
- Produces:
  - `type ErrorCode = 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'INSUFFICIENT_CREDITS' | 'NOT_FOUND' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'CONNECTION_ERROR' | 'TIMEOUT' | 'API_ERROR' | 'LOCAL_ERROR'`
  - `class ImageRouterError extends Error { code: ErrorCode; statusCode: number; retryAfter?: number }` with constructor `(message, code, statusCode = 0, retryAfter?)`
  - `errorFromResponse(response: Response): Promise<ImageRouterError>`
  - `formatToolError(error: unknown): { content: [{ type: 'text'; text: string }]; isError: true }`
  - `type RequestBody = { json: Record<string, unknown> } | { form: FormData }`
  - `class ImageRouterClient` with `constructor(config: Config, fetchImpl?: typeof fetch)`, `generate(kind: GenerationKind, body: RequestBody): Promise<GenerationResponse>`, `listModels(): Promise<RawCatalogue>`, `getCredits(): Promise<Credits>`, `download(url: string): Promise<{ bytes: Uint8Array; contentType: string | null }>`
  - `fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> }` and `json(body: unknown, status?: number, headers?: Record<string, string>): Response` in `tests/helpers/fake-fetch.ts`

- [ ] **Step 1: Write `tests/helpers/fake-fetch.ts`**

```ts
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch: impl as typeof fetch, calls };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ImageRouterError, errorFromResponse, formatToolError } from '../../src/lib/errors.js';
import { json } from '../helpers/fake-fetch.js';

describe('errorFromResponse', () => {
  it.each([
    [400, 'INVALID_REQUEST'],
    [422, 'INVALID_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'UNAUTHORIZED'],
    [402, 'INSUFFICIENT_CREDITS'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
    [418, 'API_ERROR'],
  ])('maps %i to %s and keeps the API message', async (status, code) => {
    const error = await errorFromResponse(json({ error: { message: 'boom', type: 'x' } }, status));
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
    expect(error.message).toContain('boom');
  });

  it('reads Retry-After on 429', async () => {
    const error = await errorFromResponse(json({ error: { message: 'slow' } }, 429, { 'retry-after': '12' }));
    expect(error.retryAfter).toBe(12);
    expect(error.message).toContain('12');
  });

  it('falls back to the status when the body is not JSON', async () => {
    const error = await errorFromResponse(new Response('<html>', { status: 502, statusText: 'Bad Gateway' }));
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toContain('502');
  });

  it('names the env var on 401', async () => {
    const error = await errorFromResponse(json({ error: { message: 'bad token' } }, 401));
    expect(error.message).toContain('IMAGEROUTER_API_KEY');
  });
});

describe('formatToolError', () => {
  it('returns the message without a stack for known errors', () => {
    const result = formatToolError(new ImageRouterError('nope', 'NOT_FOUND', 404));
    expect(result).toEqual({ content: [{ type: 'text', text: 'NOT_FOUND: nope' }], isError: true });
  });

  it('wraps unknown errors', () => {
    expect(formatToolError(new Error('x')).content[0].text).toBe('Unexpected error: x');
    expect(formatToolError('y').content[0].text).toBe('Unexpected error: y');
  });
});
```

`tests/unit/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/lib/config.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { fakeFetch, json } from '../helpers/fake-fetch.js';

const config = resolveConfig({ IMAGEROUTER_API_KEY: 'k', IMAGEROUTER_BASE_URL: 'http://api.test' }, '/h');

describe('ImageRouterClient', () => {
  it.each([
    ['image', '/v1/openai/images/generations'],
    ['edit', '/v1/openai/images/edits'],
    ['video', '/v1/openai/videos/generations'],
  ] as const)('posts %s JSON to %s with a bearer token', async (kind, path) => {
    const { fetch, calls } = fakeFetch(() => json({ data: [{ url: 'http://x/a.webp' }], cost: 0.1, latency: 5 }));
    const result = await new ImageRouterClient(config, fetch).generate(kind, { json: { model: 'm' } });
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
    const ok = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    const file = await new ImageRouterClient(config, ok.fetch).download('http://x/a');
    expect([...file.bytes]).toEqual([1, 2, 3]);
    expect(file.contentType).toBe('image/png');

    const gone = fakeFetch(() => new Response('', { status: 404 }));
    await expect(new ImageRouterClient(config, gone.fetch).download('http://x/a')).rejects.toThrow(
      'http://x/a',
    );
  });
});
```

- [ ] **Step 3: Run them** — `bun run test tests/unit/errors.test.ts tests/unit/client.test.ts` → FAIL, modules not found.

- [ ] **Step 4: Implement `src/lib/errors.ts`**

```ts
export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_CREDITS'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT'
  | 'API_ERROR'
  | 'LOCAL_ERROR';

export class ImageRouterError extends Error {
  code: ErrorCode;
  statusCode: number;
  retryAfter?: number;

  constructor(message: string, code: ErrorCode, statusCode = 0, retryAfter?: number) {
    super(message);
    this.name = 'ImageRouterError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

function codeForStatus(status: number): ErrorCode {
  if (status === 400 || status === 422) return 'INVALID_REQUEST';
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 402) return 'INSUFFICIENT_CREDITS';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'API_ERROR';
}

async function apiMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string };
    if (typeof body.error === 'string') return body.error;
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `HTTP ${response.status} ${response.statusText}`.trim();
}

export async function errorFromResponse(response: Response): Promise<ImageRouterError> {
  const code = codeForStatus(response.status);
  let message = await apiMessage(response);
  let retryAfter: number | undefined;

  if (code === 'UNAUTHORIZED') message += '. Check IMAGEROUTER_API_KEY.';
  if (code === 'RATE_LIMITED') {
    const parsed = Number(response.headers.get('retry-after'));
    if (response.headers.has('retry-after') && Number.isFinite(parsed)) {
      retryAfter = parsed;
      message += ` Retry after ${parsed} seconds.`;
    }
  }
  return new ImageRouterError(message, code, response.status, retryAfter);
}

export function formatToolError(error: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const text =
    error instanceof ImageRouterError
      ? `${error.code}: ${error.message}`
      : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: 'text', text }], isError: true };
}
```

- [ ] **Step 5: Implement `src/lib/imagerouter-client.ts`**

```ts
import { ImageRouterError, errorFromResponse } from './errors.js';
import type { Config, Credits, GenerationKind, GenerationResponse, RawCatalogue } from './types.js';

export type RequestBody = { json: Record<string, unknown> } | { form: FormData };

const GENERATION_PATHS: Record<GenerationKind, string> = {
  image: '/v1/openai/images/generations',
  edit: '/v1/openai/images/edits',
  video: '/v1/openai/videos/generations',
};

const READ_TIMEOUT_MS = 30_000;

export class ImageRouterClient {
  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;

  constructor(config: Config, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async generate(kind: GenerationKind, body: RequestBody): Promise<GenerationResponse> {
    const timeout = kind === 'video' ? this.config.videoTimeoutMs : this.config.imageTimeoutMs;
    const headers = this.authHeaders();
    let payload: BodyInit;
    if ('json' in body) {
      headers.set('content-type', 'application/json');
      payload = JSON.stringify(body.json);
    } else {
      payload = body.form;
    }
    const response = await this.request(
      `${this.config.baseUrl}${GENERATION_PATHS[kind]}`,
      { method: 'POST', headers, body: payload },
      timeout,
    );
    return (await response.json()) as GenerationResponse;
  }

  async listModels(): Promise<RawCatalogue> {
    const response = await this.request(`${this.config.baseUrl}/v1/models`, {}, READ_TIMEOUT_MS);
    return (await response.json()) as RawCatalogue;
  }

  async getCredits(): Promise<Credits> {
    const response = await this.request(
      `${this.config.baseUrl}/v1/credits`,
      { headers: this.authHeaders() },
      READ_TIMEOUT_MS,
    );
    const raw = (await response.json()) as Record<string, unknown>;
    return {
      remaining_credits: Number(raw.remaining_credits ?? 0),
      credit_usage: Number(raw.credit_usage ?? 0),
      total_deposits: Number(raw.total_deposits ?? 0),
    };
  }

  async download(url: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    try {
      const response = await this.request(url, {}, this.config.videoTimeoutMs);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type'),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ImageRouterError(
        `The result was generated but could not be downloaded from ${url} (${reason}). It stays available at that URL for 30 days.`,
        'LOCAL_ERROR',
      );
    }
  }

  private authHeaders(): Headers {
    if (!this.config.apiKey) {
      throw new ImageRouterError(
        'No API key configured. Set IMAGEROUTER_API_KEY (create one at https://imagerouter.io/api-keys).',
        'UNAUTHORIZED',
        401,
      );
    }
    return new Headers({ authorization: `Bearer ${this.config.apiKey}` });
  }

  private async request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal });
    } catch (error) {
      if (signal.aborted) {
        throw new ImageRouterError(
          `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
          'TIMEOUT',
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ImageRouterError(`Cannot reach ${new URL(url).host}: ${reason}`, 'CONNECTION_ERROR');
    }
    if (!response.ok) throw await errorFromResponse(response);
    return response;
  }
}
```

- [ ] **Step 6: Run them** — same command → PASS.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: add ImageRouter client and error mapping"`

---
### Task 4: Request inputs

**Files:**
- Create: `src/lib/inputs.ts`
- Test: `tests/unit/inputs.test.ts`

**Interfaces:**
- Consumes: `ImageRouterError`, `RequestBody`, `expandHome`.
- Produces:
  - `isRemoteInput(value: string): boolean` — true for `http://`, `https://`, `data:`
  - `buildRequestBody(fields: Record<string, string | number | undefined>, images?: string[], masks?: string[]): Promise<RequestBody>`

Rules: `undefined` fields are dropped. With no local file the body is JSON, where one image is sent as `image: string` and several as `image: string[]` (same for `mask`). With any local file the whole body is multipart: fields as strings, every image under `image[]`, every mask under `mask[]`, local files as `Blob` with their basename, remote strings as plain form values.

- [ ] **Step 1: Write the failing test**

```ts
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
      await buildRequestBody({ model: 'm' }, ['https://x/a.png', 'data:image/png;base64,AA'], ['https://x/m.png']),
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
```

- [ ] **Step 2: Run it** — `bun run test tests/unit/inputs.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/inputs.ts`**

```ts
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { expandHome } from './config.js';
import { ImageRouterError } from './errors.js';
import type { RequestBody } from './imagerouter-client.js';

export function isRemoteInput(value: string): boolean {
  return /^(https?:\/\/|data:)/i.test(value);
}

async function fileBlob(input: string): Promise<File> {
  const path = resolve(expandHome(input));
  const info = await stat(path).catch(() => null);
  if (!info) throw new ImageRouterError(`Input file not found: ${input}`, 'LOCAL_ERROR');
  if (!info.isFile()) throw new ImageRouterError(`Input ${input} is not a file`, 'LOCAL_ERROR');
  return new File([await readFile(path)], basename(path));
}

export async function buildRequestBody(
  fields: Record<string, string | number | undefined>,
  images: string[] = [],
  masks: string[] = [],
): Promise<RequestBody> {
  const defined = Object.entries(fields).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  const groups: Array<[string, string[]]> = [
    ['image', images],
    ['mask', masks],
  ];

  if ([...images, ...masks].every(isRemoteInput)) {
    const json: Record<string, unknown> = Object.fromEntries(defined);
    for (const [name, values] of groups) {
      if (values.length === 1) json[name] = values[0];
      else if (values.length > 1) json[name] = values;
    }
    return { json };
  }

  const form = new FormData();
  for (const [name, value] of defined) form.set(name, String(value));
  for (const [name, values] of groups) {
    for (const value of values) {
      form.append(`${name}[]`, isRemoteInput(value) ? value : await fileBlob(value));
    }
  }
  return { form };
}
```

- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: assemble JSON and multipart request bodies"`

---

### Task 5: Saving and listing output

**Files:**
- Create: `src/lib/output.ts`
- Test: `tests/unit/output.test.ts`

**Interfaces:**
- Consumes: `ImageRouterError`.
- Produces:
  - `extensionFor(options: { contentType?: string | null; url?: string; fallback: string }): string`
  - `buildFilename(options: { prompt?: string; filename?: string; extension: string; now?: Date; suffix?: string }): string`
  - `saveBytes(dir: string, name: string, bytes: Uint8Array): Promise<string>` — creates the directory, never overwrites, returns the absolute path
  - `interface SavedEntry { name: string; path: string; size: number; modified: string; kind: 'image' | 'video' }`
  - `listSaved(dir: string, options?: { limit?: number; offset?: number }): Promise<{ total: number; items: SavedEntry[] }>` — newest first, missing directory → empty
  - `resolveSavedFile(dir: string, name: string): string | null` — null unless `name` is a bare filename with a known media extension
  - `MEDIA_TYPES: Record<string, string>` — extension → content type

- [ ] **Step 1: Write the failing test**

```ts
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
    expect(extensionFor({ contentType: 'image/jpeg', url: 'http://x/a.webp', fallback: 'png' })).toBe('jpg');
    expect(extensionFor({ contentType: 'video/mp4; codecs=avc1', fallback: 'webp' })).toBe('mp4');
    expect(extensionFor({ contentType: 'application/octet-stream', url: 'http://x/a.webp?x=1', fallback: 'png' })).toBe('webp');
    expect(extensionFor({ contentType: null, url: 'http://x/noext', fallback: 'jpeg' })).toBe('jpg');
  });
});

describe('buildFilename', () => {
  it('uses timestamp, prompt slug and suffix', () => {
    expect(
      buildFilename({ prompt: 'A red Fox, jumping!  Over snow and much more text here', extension: 'webp', now, suffix: 'ab12' }),
    ).toBe('20261007-140509-a-red-fox-jumping-over-snow-and-much-mor-ab12.webp');
  });

  it('survives prompts with no filename-safe characters and missing prompts', () => {
    expect(buildFilename({ prompt: '🦊🦊 狐', extension: 'png', now, suffix: 'ab12' })).toBe('20261007-140509-ab12.png');
    expect(buildFilename({ extension: 'mp4', now, suffix: 'ab12' })).toBe('20261007-140509-ab12.mp4');
  });

  it('keeps only the basename of a requested filename and forces the extension', () => {
    expect(buildFilename({ filename: '../../etc/passwd', extension: 'png' })).toBe('passwd.png');
    expect(buildFilename({ filename: '/abs/hero.jpeg', extension: 'webp' })).toBe('hero.webp');
    expect(buildFilename({ filename: 'my hero.final.png', extension: 'png' })).toBe('my hero.final.png');
    expect(buildFilename({ filename: '..', extension: 'png', now, suffix: 'ab12' })).toBe('20261007-140509-ab12.png');
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
    expect(all.items[1].kind).toBe('video');
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
```

- [ ] **Step 2: Run it** — `bun run test tests/unit/output.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/output.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ImageRouterError } from './errors.js';

export const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov']);

function normalise(extension: string | undefined): string | undefined {
  const clean = extension?.toLowerCase().replace(/^\./, '');
  if (clean === 'jpeg') return 'jpg';
  return clean && clean in MEDIA_TYPES ? clean : undefined;
}

export function extensionFor(options: {
  contentType?: string | null;
  url?: string;
  fallback: string;
}): string {
  const mime = options.contentType?.split(';')[0].trim().toLowerCase();
  const fromType = Object.entries(MEDIA_TYPES).find(([, type]) => type === mime)?.[0];
  if (fromType) return fromType;

  if (options.url) {
    try {
      const fromUrl = normalise(extname(new URL(options.url).pathname));
      if (fromUrl) return fromUrl;
    } catch {
      // Not a URL: use the fallback.
    }
  }
  return normalise(options.fallback) ?? options.fallback;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function buildFilename(options: {
  prompt?: string;
  filename?: string;
  extension: string;
  now?: Date;
  suffix?: string;
}): string {
  if (options.filename) {
    const base = basename(options.filename.replaceAll('\\', '/'));
    const stem = base.slice(0, base.length - extname(base).length).replace(/[\0-\x1f<>:"|?*]/g, '');
    if (stem && stem !== '.' && stem !== '..') return `${stem}.${options.extension}`;
  }

  const now = options.now ?? new Date();
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = (options.prompt ?? '')
    .slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = options.suffix ?? randomBytes(2).toString('hex');
  return [stamp, slug, suffix].filter(Boolean).join('-') + `.${options.extension}`;
}

export async function saveBytes(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  try {
    await mkdir(dir, { recursive: true });
    for (let attempt = 0; ; attempt += 1) {
      const path = join(dir, attempt === 0 ? name : `${stem}-${attempt}${extension}`);
      try {
        await writeFile(path, bytes, { flag: 'wx' });
        return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new ImageRouterError(`Cannot write to output directory ${dir} (${code}).`, 'LOCAL_ERROR');
  }
}

export interface SavedEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
  kind: 'image' | 'video';
}

export async function listSaved(
  dir: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ total: number; items: SavedEntry[] }> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: Array<SavedEntry & { time: number }> = [];
  for (const name of names) {
    const extension = normalise(extname(name));
    if (!extension) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info?.isFile()) continue;
    entries.push({
      name,
      path: join(dir, name),
      size: info.size,
      modified: info.mtime.toISOString(),
      kind: VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image',
      time: info.mtimeMs,
    });
  }
  entries.sort((a, b) => b.time - a.time || a.name.localeCompare(b.name));
  const offset = options.offset ?? 0;
  const items = entries
    .slice(offset, offset + (options.limit ?? 60))
    .map(({ time: _time, ...entry }) => entry);
  return { total: entries.length, items };
}

export function resolveSavedFile(dir: string, name: string): string | null {
  if (!name || name !== basename(name) || name.includes('\\') || name === '.' || name === '..') {
    return null;
  }
  return normalise(extname(name)) ? join(dir, name) : null;
}
```

- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: name, save and list generated files"`

---
### Task 6: Model catalogue and the generation flow

**Files:**
- Create: `src/lib/models.ts`, `src/lib/generation.ts`
- Test: `tests/unit/models.test.ts`, `tests/unit/generation.test.ts`

**Interfaces:**
- Consumes: `ImageRouterClient`, `buildRequestBody`, `extensionFor`, `buildFilename`, `saveBytes`, `expandHome`, types.
- Produces:
  - `interface ModelFilters { output?: 'image' | 'video'; supports_edit?: boolean; supports_mask?: boolean; free_only?: boolean; search?: string; limit?: number }`
  - `summariseModels(raw: RawCatalogue, filters?: ModelFilters): { total: number; returned: number; models: ModelSummary[] }` — `total` counts matches before `limit` (default 50); newest `release_date` first, undated last, ties by id
  - `interface Deps { config: Config; client: ImageRouterClient }`
  - `interface GenerationArgs { prompt?: string; model?: string; size?: string; quality?: Quality; output_format?: OutputFormat; seconds?: number | 'auto'; images?: string[]; masks?: string[]; output_dir?: string; filename?: string; ephemeral?: boolean }`
  - `runGeneration(deps: Deps, kind: GenerationKind, args: GenerationArgs): Promise<GenerationResult>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summariseModels } from '../../src/lib/models.js';
import type { RawCatalogue } from '../../src/lib/types.js';

const params = (edit: boolean, mask: boolean) => ({ text: true, mask, quality: true, edit });

const raw: RawCatalogue = {
  'a/paid': {
    providers: [
      { id: 'p1', pricing: { type: 'post_generation', value: 0.04 } },
      { id: 'p2', pricing: { type: 'post_generation', range: { min: 0.01, average: 0.02, max: 0.05 } } },
    ],
    output: ['image'],
    supported_params: params(true, true),
    sizes: ['1024x1024'],
    release_date: '2025-01-01',
  },
  'a/free:free': {
    providers: [{ id: 'p1', pricing: { type: 'fixed', value: 0 } }],
    output: ['image'],
    supported_params: params(false, false),
    release_date: '2026-01-01',
  },
  'v/clip': {
    providers: [{ id: 'p1', pricing: { type: 'fixed', value: 0.5 } }],
    output: ['video'],
    supported_params: params(true, false),
    seconds: [5, 10],
    release_date: '2025-06-01',
  },
  'z/undated': { providers: [{ id: 'p1' }], output: ['image'], supported_params: params(false, false) },
};

describe('summariseModels', () => {
  it('projects compactly, newest first, undated last', () => {
    const result = summariseModels(raw);
    expect(result.total).toBe(4);
    expect(result.models.map((model) => model.id)).toEqual(['a/free:free', 'v/clip', 'a/paid', 'z/undated']);
    expect(result.models[2]).toEqual({
      id: 'a/paid',
      output: 'image',
      text: true,
      edit: true,
      mask: true,
      quality: true,
      sizes: ['1024x1024'],
      min_price: 0.01,
      release_date: '2025-01-01',
    });
    expect(result.models[3].min_price).toBeNull();
    expect(result.models[1].seconds).toEqual([5, 10]);
  });

  it('applies each filter', () => {
    const ids = (filters: Parameters<typeof summariseModels>[1]) =>
      summariseModels(raw, filters).models.map((model) => model.id);
    expect(ids({ output: 'video' })).toEqual(['v/clip']);
    expect(ids({ supports_edit: true })).toEqual(['v/clip', 'a/paid']);
    expect(ids({ supports_mask: true })).toEqual(['a/paid']);
    expect(ids({ free_only: true })).toEqual(['a/free:free']);
    expect(ids({ search: 'FREE' })).toEqual(['a/free:free']);
  });

  it('limits what is returned but reports the full match count', () => {
    const result = summariseModels(raw, { limit: 2 });
    expect(result.total).toBe(4);
    expect(result.returned).toBe(2);
    expect(result.models).toHaveLength(2);
  });
});
```

`tests/unit/generation.test.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/lib/config.js';
import { runGeneration } from '../../src/lib/generation.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { fakeFetch, json } from '../helpers/fake-fetch.js';

async function setup(
  handler: Parameters<typeof fakeFetch>[0],
  env: Record<string, string> = {},
) {
  const outputDir = await mkdtemp(join(tmpdir(), 'ir-gen-'));
  const config = resolveConfig(
    { IMAGEROUTER_API_KEY: 'k', IMAGEROUTER_BASE_URL: 'http://api.test', IMAGEROUTER_OUTPUT_DIR: outputDir, ...env },
    '/h',
  );
  const fake = fakeFetch(handler);
  return { deps: { config, client: new ImageRouterClient(config, fake.fetch) }, calls: fake.calls, outputDir };
}

const png = () => new Response(new Uint8Array([9, 9]), { headers: { 'content-type': 'image/png' } });

describe('runGeneration', () => {
  it('requests a URL, downloads it and saves it', async () => {
    const { deps, calls, outputDir } = await setup((url) =>
      url.startsWith('http://api.test')
        ? json({ data: [{ url: 'http://cdn.test/abc.webp' }], cost: 0.004, latency: 6942 })
        : png(),
    );
    const result = await runGeneration(deps, 'image', { prompt: 'a fox', model: 'm/x', size: '1024x1024' });

    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model: 'm/x',
      prompt: 'a fox',
      size: '1024x1024',
      response_format: 'url',
    });
    expect(result).toMatchObject({ url: 'http://cdn.test/abc.webp', model: 'm/x', cost: 0.004, latency_ms: 6942 });
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
    expect(JSON.parse(calls[0].init.body as string).response_format).toBe('b64_ephemeral');
    expect(calls).toHaveLength(1);
    expect(result.url).toBeUndefined();
    expect(result.path).toMatch(/\.jpg$/);
    expect([...(await readFile(result.path))]).toEqual([1, 2, 3]);
  });

  it('falls back to the default model per kind', async () => {
    const { deps, calls } = await setup(
      (url) => (url.startsWith('http://api.test') ? json({ data: [{ url: 'http://cdn.test/a.mp4' }] }) : png()),
      { IMAGEROUTER_DEFAULT_IMAGE_MODEL: 'img/default', IMAGEROUTER_DEFAULT_VIDEO_MODEL: 'vid/default' },
    );
    expect((await runGeneration(deps, 'image', { prompt: 'x' })).model).toBe('img/default');
    expect((await runGeneration(deps, 'edit', { images: ['http://x/a.png'] })).model).toBe('img/default');
    expect((await runGeneration(deps, 'video', { prompt: 'x', seconds: 5 })).model).toBe('vid/default');
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
    expect(result.path).toBe(result.files![0].path);
    expect(result.files![1].url).toBe('http://cdn.test/2.png');
    expect(result.files![0].path).not.toBe(result.files![1].path);
  });

  it('honours output_dir and filename', async () => {
    const { deps } = await setup((url) =>
      url.startsWith('http://api.test') ? json({ data: [{ url: 'http://cdn.test/1.png' }] }) : png(),
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
});
```

- [ ] **Step 2: Run them** — `bun run test tests/unit/models.test.ts tests/unit/generation.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/models.ts`**

```ts
import type { ModelSummary, RawCatalogue, RawModel } from './types.js';

export interface ModelFilters {
  output?: 'image' | 'video';
  supports_edit?: boolean;
  supports_mask?: boolean;
  free_only?: boolean;
  search?: string;
  limit?: number;
}

function minPrice(model: RawModel): number | null {
  const prices = (model.providers ?? [])
    .map((provider) => provider.pricing?.value ?? provider.pricing?.range?.min)
    .filter((price): price is number => typeof price === 'number');
  return prices.length > 0 ? Math.min(...prices) : null;
}

function summarise(id: string, model: RawModel): ModelSummary {
  const params = model.supported_params ?? { text: false, edit: false, mask: false, quality: false };
  return {
    id,
    output: model.output?.includes('video') ? 'video' : 'image',
    text: Boolean(params.text),
    edit: Boolean(params.edit),
    mask: Boolean(params.mask),
    quality: Boolean(params.quality),
    ...(model.sizes ? { sizes: model.sizes } : {}),
    ...(model.seconds ? { seconds: model.seconds } : {}),
    min_price: minPrice(model),
    ...(model.release_date ? { release_date: model.release_date } : {}),
  };
}

export function summariseModels(
  raw: RawCatalogue,
  filters: ModelFilters = {},
): { total: number; returned: number; models: ModelSummary[] } {
  const search = filters.search?.toLowerCase();
  const matches = Object.entries(raw)
    .map(([id, model]) => summarise(id, model))
    .filter((model) => !filters.output || model.output === filters.output)
    .filter((model) => !filters.supports_edit || model.edit)
    .filter((model) => !filters.supports_mask || model.mask)
    .filter((model) => !filters.free_only || model.min_price === 0)
    .filter((model) => !search || model.id.toLowerCase().includes(search))
    .toSorted(
      (a, b) =>
        (b.release_date ?? '').localeCompare(a.release_date ?? '') || a.id.localeCompare(b.id),
    );
  const models = matches.slice(0, filters.limit ?? 50);
  return { total: matches.length, returned: models.length, models };
}
```

- [ ] **Step 4: Implement `src/lib/generation.ts`**

```ts
import { resolve } from 'node:path';
import { expandHome } from './config.js';
import { ImageRouterError } from './errors.js';
import type { ImageRouterClient } from './imagerouter-client.js';
import { buildRequestBody } from './inputs.js';
import { buildFilename, extensionFor, saveBytes } from './output.js';
import type {
  Config,
  GenerationKind,
  GenerationResult,
  OutputFormat,
  Quality,
  SavedFile,
} from './types.js';

export interface Deps {
  config: Config;
  client: ImageRouterClient;
}

export interface GenerationArgs {
  prompt?: string;
  model?: string;
  size?: string;
  quality?: Quality;
  output_format?: OutputFormat;
  seconds?: number | 'auto';
  images?: string[];
  masks?: string[];
  output_dir?: string;
  filename?: string;
  ephemeral?: boolean;
}

function resolveModel(config: Config, kind: GenerationKind, model?: string): string {
  const isVideo = kind === 'video';
  const chosen = model ?? (isVideo ? config.defaultVideoModel : config.defaultImageModel);
  if (chosen) return chosen;
  const variable = isVideo ? 'IMAGEROUTER_DEFAULT_VIDEO_MODEL' : 'IMAGEROUTER_DEFAULT_IMAGE_MODEL';
  throw new ImageRouterError(
    `No model given. Pass "model" or set ${variable}; use list_models to find one.`,
    'INVALID_REQUEST',
  );
}

export async function runGeneration(
  deps: Deps,
  kind: GenerationKind,
  args: GenerationArgs,
): Promise<GenerationResult> {
  const { config, client } = deps;
  const model = resolveModel(config, kind, args.model);
  const body = await buildRequestBody(
    {
      model,
      prompt: args.prompt,
      size: args.size,
      quality: args.quality,
      output_format: kind === 'video' ? undefined : args.output_format,
      seconds: kind === 'video' ? args.seconds : undefined,
      response_format: args.ephemeral ? 'b64_ephemeral' : 'url',
    },
    args.images,
    args.masks,
  );

  const response = await client.generate(kind, body);
  const entries = (response.data ?? []).filter((entry) => entry.url || entry.b64_json);
  if (entries.length === 0) {
    throw new ImageRouterError('ImageRouter returned no result for this request.', 'API_ERROR');
  }

  const dir = resolve(expandHome(args.output_dir ?? config.outputDir));
  const fallback = kind === 'video' ? 'mp4' : (args.output_format ?? 'webp');
  const files: SavedFile[] = [];
  for (const entry of entries) {
    let bytes: Uint8Array;
    let extension: string;
    if (entry.url) {
      const file = await client.download(entry.url);
      bytes = file.bytes;
      extension = extensionFor({ contentType: file.contentType, url: entry.url, fallback });
    } else {
      bytes = new Uint8Array(Buffer.from(entry.b64_json as string, 'base64'));
      extension = extensionFor({ fallback });
    }
    const name = buildFilename({ prompt: args.prompt, filename: args.filename, extension });
    const path = await saveBytes(dir, name, bytes);
    files.push(entry.url ? { path, url: entry.url } : { path });
  }

  return {
    ...files[0],
    model,
    ...(response.cost === undefined ? {} : { cost: response.cost }),
    ...(response.latency === undefined ? {} : { latency_ms: response.latency }),
    ...(files.length > 1 ? { files } : {}),
  };
}
```

- [ ] **Step 5: Run them** → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: add model catalogue projection and generation flow"`

---
### Task 7: MCP tools, server and stdio entry point

**Files:**
- Create: `src/tools/schemas.ts`, `src/tools/generate-image.ts`, `src/tools/edit-image.ts`, `src/tools/generate-video.ts`, `src/tools/list-models.ts`, `src/tools/get-credits.ts`, `src/tools/index.ts`, `src/server.ts`, `src/cli.ts`
- Test: `tests/integration/tools.test.ts`

**Interfaces:**
- Consumes: `Deps`, `runGeneration`, `summariseModels`, `formatToolError`, `ImageRouterError`, `resolveConfig`, `ImageRouterClient`, `VERSION`.
- Produces:
  - `registerAllTools(server: McpServer, deps: Deps): void`
  - `createServer(deps: Deps): McpServer`
  - `ok(data: unknown): { content: [{ type: 'text'; text: string }] }` in `src/tools/schemas.ts`
  - `src/cli.ts` exports nothing; `main(argv)` dispatches `dashboard` to `startDashboard` (Task 9) and everything else to stdio. Until Task 9 the `dashboard` branch prints `Dashboard is not built yet` to stderr and exits 1.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/tools.test.ts`:

```ts
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

async function connect(handler: Handler, env: Record<string, string> = { IMAGEROUTER_API_KEY: 'k' }) {
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

const media = (type: string) => new Response(new Uint8Array([7]), { headers: { 'content-type': type } });
const generated = (url: string): Handler => (requestUrl) =>
  requestUrl.startsWith('http://api.test') ? json({ data: [{ url }], cost: 0.01, latency: 100 }) : media('image/png');

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
    const hint = (name: string) => tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint;
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
    expect(data).toMatchObject({ url: 'http://cdn.test/a.png', model: 'm/x', cost: 0.01, latency_ms: 100 });
    expect(data.path.startsWith(outputDir)).toBe(true);
    expect(calls[0].url).toBe('http://api.test/v1/openai/images/generations');
    expect(JSON.parse(calls[0].init.body as string).quality).toBe('high');
  });

  it('returns isError with the API message on 402', async () => {
    const { client } = await connect(() => json({ error: { message: 'Insufficient credits' } }, 402));
    const result = await client.callTool({ name: 'generate_image', arguments: { prompt: 'x', model: 'm' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('INSUFFICIENT_CREDITS: Insufficient credits');
  });

  it('names the env var when no key is configured', async () => {
    const { client } = await connect(() => json({}), {});
    const result = await client.callTool({ name: 'generate_image', arguments: { prompt: 'x', model: 'm' } });
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
      url.startsWith('http://api.test') ? json({ data: [{ url: 'http://cdn.test/v.mp4' }] }) : media('video/mp4'),
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
    const result = await client.callTool({ name: 'generate_video', arguments: { prompt: 'x', model: 'v/m' } });
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
    expect(JSON.parse(text(result))).toEqual({ remaining_credits: 9.5, credit_usage: 0.5, total_deposits: 10 });
  });

  it('returns isError on 401', async () => {
    const { client } = await connect(() => json({ error: { message: 'bad token' } }, 401));
    const result = await client.callTool({ name: 'get_credits', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('UNAUTHORIZED: bad token');
  });
});
```

- [ ] **Step 2: Run it** — `bun run test tests/integration/tools.test.ts` → FAIL, `src/server.js` not found.

- [ ] **Step 3: Write `src/tools/schemas.ts`**

```ts
import { z } from 'zod';

export const prompt = z.string().max(20_000);
export const model = z
  .string()
  .min(1)
  .optional()
  .describe('Model id such as "openai/gpt-image-2". Use list_models to find one. Falls back to the configured default.');
export const size = z
  .string()
  .regex(/^(auto|\d+x\d+)$/)
  .optional()
  .describe('"auto" or WIDTHxHEIGHT, e.g. 1024x1024. Accepted sizes depend on the model.');
export const quality = z
  .enum(['auto', 'low', 'medium', 'high'])
  .optional()
  .describe('Only honoured by models that support quality.');
export const outputFormat = z.enum(['webp', 'jpeg', 'png']).optional().describe('Default webp.');
export const mediaInputs = z
  .array(z.string().min(1))
  .max(16)
  .describe('Local file paths, http(s) URLs or data URIs. Up to 16.');
export const saving = {
  output_dir: z
    .string()
    .optional()
    .describe('Directory to save into. Defaults to IMAGEROUTER_OUTPUT_DIR or ~/Pictures/imagerouter.'),
  filename: z
    .string()
    .optional()
    .describe('File name without directory; the extension is set from the result.'),
  ephemeral: z
    .boolean()
    .optional()
    .describe('If true the result is not stored by ImageRouter and no URL is returned, only the saved file.'),
};

export function ok(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
```

- [ ] **Step 4: Write the five registrars**

`src/tools/generate-image.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatToolError } from '../lib/errors.js';
import { type Deps, runGeneration } from '../lib/generation.js';
import { model, ok, outputFormat, prompt, quality, saving, size } from './schemas.js';

export function registerGenerateImage(server: McpServer, deps: Deps): void {
  server.registerTool(
    'generate_image',
    {
      description:
        'Generate an image from a text prompt through ImageRouter. Saves the image to disk and returns its path, the hosted URL (valid 30 days, publicly reachable), cost in USD and latency. Spends credits unless the model is free.',
      inputSchema: z.object({
        prompt: prompt.describe('What to generate.'),
        model,
        size,
        quality,
        output_format: outputFormat,
        ...saving,
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(await runGeneration(deps, 'image', args));
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
```

`src/tools/edit-image.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatToolError } from '../lib/errors.js';
import { type Deps, runGeneration } from '../lib/generation.js';
import { mediaInputs, model, ok, outputFormat, prompt, quality, saving, size } from './schemas.js';

export function registerEditImage(server: McpServer, deps: Deps): void {
  server.registerTool(
    'edit_image',
    {
      description:
        'Edit or transform existing images (image-to-image, inpainting with a mask, background removal) through ImageRouter. Needs a model with edit support: list_models with supports_edit. Saves the result to disk and returns its path, hosted URL, cost and latency.',
      inputSchema: z.object({
        images: mediaInputs.min(1),
        prompt: prompt.optional().describe('The change to make. Some models, such as background removal, take none.'),
        masks: mediaInputs.optional().describe('Optional masks for models with mask support. Same input forms as images.'),
        model,
        size,
        quality,
        output_format: outputFormat,
        ...saving,
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(await runGeneration(deps, 'edit', args));
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
```

`src/tools/generate-video.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ImageRouterError, formatToolError } from '../lib/errors.js';
import { type Deps, runGeneration } from '../lib/generation.js';
import { mediaInputs, model, ok, prompt, saving, size } from './schemas.js';

const PROGRESS_INTERVAL_MS = 15_000;

export function registerGenerateVideo(server: McpServer, deps: Deps): void {
  server.registerTool(
    'generate_video',
    {
      description:
        'Generate a video from a text prompt, from images (image-to-video), or both, through ImageRouter. Can take several minutes. Saves the video to disk and returns its path, hosted URL, cost and latency.',
      inputSchema: z.object({
        prompt: prompt.optional().describe('What to generate.'),
        images: mediaInputs.optional().describe('Start image(s) for image-to-video.'),
        model,
        size,
        seconds: z
          .union([z.literal('auto'), z.number().min(1).max(60)])
          .optional()
          .describe('Duration. Accepted values depend on the model; see list_models.'),
        ...saving,
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args, extra) => {
      const progressToken = extra._meta?.progressToken;
      let ticks = 0;
      const timer =
        progressToken === undefined
          ? undefined
          : setInterval(() => {
              ticks += 1;
              extra
                .sendNotification({
                  method: 'notifications/progress',
                  params: {
                    progressToken,
                    progress: ticks,
                    message: `Still generating (${(ticks * PROGRESS_INTERVAL_MS) / 1000}s)`,
                  },
                })
                .catch(() => {});
            }, PROGRESS_INTERVAL_MS);
      try {
        if (!args.prompt && !args.images?.length) {
          throw new ImageRouterError(
            'Provide a prompt, at least one image, or both.',
            'INVALID_REQUEST',
          );
        }
        return ok(await runGeneration(deps, 'video', args));
      } catch (error) {
        return formatToolError(error);
      } finally {
        clearInterval(timer);
      }
    },
  );
}
```

`src/tools/list-models.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatToolError } from '../lib/errors.js';
import type { Deps } from '../lib/generation.js';
import { summariseModels } from '../lib/models.js';
import { ok } from './schemas.js';

export function registerListModels(server: McpServer, deps: Deps): void {
  server.registerTool(
    'list_models',
    {
      description:
        'List ImageRouter models with capabilities and lowest price in USD, newest first. Filter before reading: there are about 200. Works without an API key.',
      inputSchema: z.object({
        output: z.enum(['image', 'video']).optional(),
        supports_edit: z.boolean().optional().describe('Only models usable with edit_image.'),
        supports_mask: z.boolean().optional(),
        free_only: z.boolean().optional().describe('Only models that cost nothing.'),
        search: z.string().optional().describe('Case-insensitive substring of the model id.'),
        limit: z.number().int().min(1).max(300).optional().describe('Default 50.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(summariseModels(await deps.client.listModels(), args));
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
```

`src/tools/get-credits.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatToolError } from '../lib/errors.js';
import type { Deps } from '../lib/generation.js';
import { ok } from './schemas.js';

export function registerGetCredits(server: McpServer, deps: Deps): void {
  server.registerTool(
    'get_credits',
    {
      description: 'Get the ImageRouter account balance in USD: remaining credits, usage and total deposits.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await deps.client.getCredits());
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
```

`src/tools/index.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from '../lib/generation.js';
import { registerEditImage } from './edit-image.js';
import { registerGenerateImage } from './generate-image.js';
import { registerGenerateVideo } from './generate-video.js';
import { registerGetCredits } from './get-credits.js';
import { registerListModels } from './list-models.js';

export function registerAllTools(server: McpServer, deps: Deps): void {
  registerGenerateImage(server, deps);
  registerEditImage(server, deps);
  registerGenerateVideo(server, deps);
  registerListModels(server, deps);
  registerGetCredits(server, deps);
}
```

- [ ] **Step 5: Write `src/server.ts` and `src/cli.ts`**

`src/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from './lib/generation.js';
import { registerAllTools } from './tools/index.js';
import { VERSION } from './version.js';

export function createServer(deps: Deps): McpServer {
  const server = new McpServer({ name: 'imagerouter-mcp', version: VERSION });
  registerAllTools(server, deps);
  return server;
}
```

`src/cli.ts`:

```ts
#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveConfig } from './lib/config.js';
import { ImageRouterClient } from './lib/imagerouter-client.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const HELP = `imagerouter-mcp ${VERSION}

Usage:
  imagerouter-mcp                 Start the MCP server on stdio
  imagerouter-mcp dashboard       Open the local dashboard
      --port <n>                  Port (default 4477 or IMAGEROUTER_DASHBOARD_PORT)
      --no-open                   Do not open a browser
  imagerouter-mcp --version
  imagerouter-mcp --help

Environment: IMAGEROUTER_API_KEY (required for generation), IMAGEROUTER_OUTPUT_DIR,
IMAGEROUTER_DEFAULT_IMAGE_MODEL, IMAGEROUTER_DEFAULT_VIDEO_MODEL.
`;

async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const config = resolveConfig();
  const deps = { config, client: new ImageRouterClient(config) };

  if (argv[0] === 'dashboard') {
    process.stderr.write('Dashboard is not built yet\n');
    process.exit(1);
  }
  if (argv[0] !== undefined) {
    process.stderr.write(`Unknown command: ${argv[0]}\n\n${HELP}`);
    process.exit(1);
  }

  if (!config.apiKey) {
    process.stderr.write(
      'imagerouter-mcp: IMAGEROUTER_API_KEY is not set; only list_models will work.\n',
    );
  }
  await createServer(deps).connect(new StdioServerTransport());
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
```

- [ ] **Step 6: Run the tests and gates**

Run: `bun run test && bun run type-check && bun run lint && bun run format && bun run format:check`
Expected: all tests pass, gates exit 0. If `extra._meta` or `extra.sendNotification` do not type-check against the installed SDK, read `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts` (`RequestHandlerExtra`) and use the names it declares.

- [ ] **Step 7: Smoke the stdio server by hand**

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | bun src/cli.ts 2>/dev/null | tail -1 | grep -o '"name":"[a-z_]*"'
```

Expected: the five tool names.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: add MCP tools and stdio server"`

---
### Task 8: Dashboard request handler

**Files:**
- Create: `src/dashboard/routes.ts`
- Test: `tests/integration/dashboard.test.ts`

**Interfaces:**
- Consumes: `Deps`, `runGeneration`, `summariseModels`, `listSaved`, `resolveSavedFile`, `MEDIA_TYPES`, `ImageRouterError`.
- Produces: `createDashboardHandler(options: { deps: Deps; uiDir: string; port: number }): (request: Request) => Promise<Response>`

Uses only web-standard `Request`/`Response` and `node:fs`, so it runs under vitest on Node. API errors are returned as `{ error: { code, message } }` with the upstream status (or 400 for local/validation errors, 500 for unknown).

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDashboardHandler } from '../../src/dashboard/routes.js';
import { resolveConfig } from '../../src/lib/config.js';
import { ImageRouterClient } from '../../src/lib/imagerouter-client.js';
import { fakeFetch, json } from '../helpers/fake-fetch.js';

const PORT = 4477;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function setup(handler: Parameters<typeof fakeFetch>[0], env: Record<string, string> = { IMAGEROUTER_API_KEY: 'k' }) {
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
    handle(new Request(`${ORIGIN}${path}`, { ...init, headers: { host: `127.0.0.1:${PORT}`, ...init.headers } }));
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
        'a/img': { providers: [], output: ['image'], supported_params: { text: true, mask: false, quality: true, edit: false } },
        'b/vid': { providers: [], output: ['video'], supported_params: { text: true, mask: false, quality: false, edit: false } },
      }),
    );
    const data = await (await call('/api/models')).json();
    expect(data.models.map((model: { id: string }) => model.id)).toEqual(['a/img']);
  });

  it('returns credits and maps upstream errors', async () => {
    const ok = await setup(() => json({ remaining_credits: '3', credit_usage: '1', total_deposits: '4' }));
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
      url.startsWith('http://api.test') ? json({ data: [{ url: 'http://cdn.test/a.png' }], cost: 0.02 }) : png(),
    );
    const response = await call('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ prompt: 'a fox', model: 'm', output_dir: '/tmp/elsewhere', images: ['/etc/passwd'] }),
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
    expect(gallery.items[0]).toMatchObject({ name: data.name, fileUrl: data.fileUrl, kind: 'image' });
  });

  it('rejects an empty or malformed generate body', async () => {
    const { call, calls } = await setup(() => json({}));
    const post = (body: string) =>
      call('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body });
    expect((await post('{"prompt":"  "}')).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post('{"prompt":"x","quality":"ultra"}')).status).toBe(400);
    expect(calls).toHaveLength(0);
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
        headers: { host: `localhost:${PORT}`, origin: 'https://evil.example', 'content-type': 'application/json' },
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

    const local = await handle(new Request(`${ORIGIN}/api/status`, { headers: { host: `localhost:${PORT}` } }));
    expect(local.status).toBe(200);
  });

  it('answers unknown API routes and methods', async () => {
    const { call } = await setup(() => json({}));
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api/generate')).status).toBe(405);
  });
});
```

- [ ] **Step 2: Run it** — `bun run test tests/integration/dashboard.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/dashboard/routes.ts`**

```ts
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

function failFrom(error: unknown): Response {
  if (error instanceof ImageRouterError) {
    const status = error.statusCode >= 400 ? error.statusCode : error.code === 'TIMEOUT' ? 504 : 400;
    return fail(status, error.code, error.message);
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
        return send(summariseModels(await deps.client.listModels(), { output: 'image', limit: 500 }));
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
```

Note for the status test: `defaultImageModel` is `'a/b'` there; when unset it is `null`.

- [ ] **Step 4: Run it** → PASS. If `/..%2Fsecret` or `/files/..%2F..` arrive already normalised by `new URL`, the assertions still hold (404 / 400); do not loosen them.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: add dashboard request handler"`

---
### Task 9: Dashboard server, UI and build

**Files:**
- Create: `src/dashboard/serve.ts`, `src/dashboard/ui/index.html`, `src/dashboard/ui/styles.css`, `src/dashboard/ui/app.ts`, `scripts/build.ts`
- Modify: `src/cli.ts` (replace the `dashboard` stub)
- Test: `tests/unit/cli-args.test.ts`

**Interfaces:**
- Consumes: `createDashboardHandler`, `Deps`.
- Produces:
  - `parseDashboardArgs(argv: string[], defaultPort: number): { port: number; open: boolean }` in `src/dashboard/serve.ts`
  - `startDashboard(deps: Deps, options: { port: number; open: boolean }): void`
  - `dist/cli.js` (executable, `#!/usr/bin/env bun`) and `dist/dashboard/{index.html,app.js,styles.css}`

Before writing the UI, invoke the `daisyui:daisyui` skill and follow it; the markup below is the required structure and behaviour, and class names may be adjusted to what the skill prescribes for daisyUI 5.

- [ ] **Step 1: Write the failing test**

`tests/unit/cli-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseDashboardArgs } from '../../src/dashboard/serve.js';

describe('parseDashboardArgs', () => {
  it('defaults to the configured port and opening a browser', () => {
    expect(parseDashboardArgs([], 4477)).toEqual({ port: 4477, open: true });
  });

  it('reads --port in both forms and --no-open', () => {
    expect(parseDashboardArgs(['--port', '5000', '--no-open'], 4477)).toEqual({ port: 5000, open: false });
    expect(parseDashboardArgs(['--port=5001'], 4477)).toEqual({ port: 5001, open: true });
  });

  it('rejects an invalid port', () => {
    expect(() => parseDashboardArgs(['--port', 'abc'], 4477)).toThrow('Invalid port: abc');
    expect(() => parseDashboardArgs(['--port', '70000'], 4477)).toThrow('Invalid port: 70000');
    expect(() => parseDashboardArgs(['--port'], 4477)).toThrow('Invalid port');
  });
});
```

- [ ] **Step 2: Run it** — `bun run test tests/unit/cli-args.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/dashboard/serve.ts`**

```ts
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Deps } from '../lib/generation.js';
import { createDashboardHandler } from './routes.js';

export function parseDashboardArgs(
  argv: string[],
  defaultPort: number,
): { port: number; open: boolean } {
  let port = defaultPort;
  let open = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-open') {
      open = false;
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = arg === '--port' ? argv[++index] : arg.slice('--port='.length);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new Error(`Invalid port: ${raw ?? '(missing)'}`);
      }
      port = parsed;
    }
  }
  return { port, open };
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    // No browser launcher available: the URL is printed below.
  }
}

export function startDashboard(deps: Deps, options: { port: number; open: boolean }): void {
  // In the published bundle this file is inlined into dist/cli.js, next to dist/dashboard/.
  const uiDir = join(import.meta.dir, 'dashboard');
  const handler = createDashboardHandler({ deps, uiDir, port: options.port });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port,
    idleTimeout: 255,
    fetch: handler,
  });
  const url = `http://127.0.0.1:${server.port}`;
  process.stdout.write(`ImageRouter dashboard: ${url}\nSaving to ${deps.config.outputDir}\n`);
  if (!deps.config.apiKey) {
    process.stdout.write('IMAGEROUTER_API_KEY is not set: generation and balance will fail.\n');
  }
  if (options.open) openBrowser(url);
}
```

`idleTimeout: 255` is Bun's maximum (seconds); image generation runs up to 180 s and must not be cut off.

- [ ] **Step 4: Wire it into `src/cli.ts`**

Add the import and replace the stub branch:

```ts
import { parseDashboardArgs, startDashboard } from './dashboard/serve.js';
```

```ts
  if (argv[0] === 'dashboard') {
    startDashboard(deps, parseDashboardArgs(argv.slice(1), config.dashboardPort));
    return;
  }
```

- [ ] **Step 5: Write `scripts/build.ts`**

```ts
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { $ } from 'bun';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/dashboard', { recursive: true });

const cli = await Bun.build({
  entrypoints: ['src/cli.ts'],
  outdir: 'dist',
  target: 'bun',
  format: 'esm',
  packages: 'external',
});
const ui = await Bun.build({
  entrypoints: ['src/dashboard/ui/app.ts'],
  outdir: 'dist/dashboard',
  target: 'browser',
  minify: true,
});
for (const result of [cli, ui]) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

const built = await readFile('dist/cli.js', 'utf8');
if (!built.startsWith('#!')) await writeFile('dist/cli.js', `#!/usr/bin/env bun\n${built}`);
await chmod('dist/cli.js', 0o755);

await $`bunx @tailwindcss/cli -i src/dashboard/ui/styles.css -o dist/dashboard/styles.css --minify`.quiet();
await cp('src/dashboard/ui/index.html', 'dist/dashboard/index.html');
console.log('Built dist/cli.js and dist/dashboard/');
```

- [ ] **Step 6: Write the UI**

`src/dashboard/ui/styles.css`:

```css
@import 'tailwindcss';
@plugin "daisyui" {
  themes:
    light --default,
    dark --prefersdark;
}
@source "./index.html";
@source "./app.ts";
```

`src/dashboard/ui/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ImageRouter Dashboard</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bg-base-200 min-h-screen">
    <header class="navbar bg-base-100 shadow-sm px-4">
      <div class="flex-1 text-lg font-semibold">ImageRouter</div>
      <div class="stats bg-transparent">
        <div class="stat py-1 px-4">
          <div class="stat-title">Balance</div>
          <div class="stat-value text-xl" id="balance">–</div>
          <div class="stat-desc" id="usage"></div>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" id="refresh-balance" aria-label="Refresh balance">↻</button>
    </header>

    <main class="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[24rem_1fr]">
      <div role="alert" class="alert alert-warning lg:col-span-2 hidden" id="key-warning">
        <span>
          No API key configured. Set <code>IMAGEROUTER_API_KEY</code> and restart the dashboard.
        </span>
      </div>

      <form class="card bg-base-100 shadow-sm h-fit" id="generate-form">
        <div class="card-body gap-3">
          <h2 class="card-title">Generate</h2>
          <label class="form-control">
            <span class="label-text mb-1">Prompt</span>
            <textarea class="textarea textarea-bordered w-full h-32" id="prompt" maxlength="20000" required></textarea>
          </label>
          <label class="form-control">
            <span class="label-text mb-1">Model</span>
            <input class="input input-bordered w-full mb-2" id="model-search" type="search" placeholder="Filter models" />
            <select class="select select-bordered w-full" id="model" required></select>
            <span class="label-text-alt mt-1" id="model-info"></span>
          </label>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" class="toggle toggle-sm" id="free-only" />
            <span class="label-text">Free models only</span>
          </label>
          <div class="grid grid-cols-3 gap-2">
            <label class="form-control">
              <span class="label-text mb-1">Size</span>
              <select class="select select-bordered select-sm w-full" id="size"></select>
            </label>
            <label class="form-control">
              <span class="label-text mb-1">Quality</span>
              <select class="select select-bordered select-sm w-full" id="quality">
                <option>auto</option>
                <option>low</option>
                <option>medium</option>
                <option>high</option>
              </select>
            </label>
            <label class="form-control">
              <span class="label-text mb-1">Format</span>
              <select class="select select-bordered select-sm w-full" id="format">
                <option>webp</option>
                <option>png</option>
                <option>jpeg</option>
              </select>
            </label>
          </div>
          <div role="alert" class="alert alert-error hidden" id="error"></div>
          <button class="btn btn-primary" id="submit" type="submit">Generate</button>
        </div>
      </form>

      <section class="flex flex-col gap-4">
        <div class="card bg-base-100 shadow-sm hidden" id="result">
          <div class="card-body gap-3">
            <img class="rounded-box max-h-[70vh] w-full object-contain bg-base-200" id="result-image" alt="" />
            <div class="flex flex-wrap items-center gap-2 text-sm" id="result-meta"></div>
          </div>
        </div>
        <div class="card bg-base-100 shadow-sm">
          <div class="card-body">
            <h2 class="card-title">Gallery <span class="badge" id="gallery-count">0</span></h2>
            <p class="text-sm opacity-70" id="gallery-dir"></p>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" id="gallery"></div>
            <p class="opacity-70 hidden" id="gallery-empty">Nothing generated yet.</p>
          </div>
        </div>
      </section>
    </main>

    <dialog class="modal" id="lightbox">
      <div class="modal-box max-w-5xl p-2">
        <img class="w-full rounded-box" id="lightbox-image" alt="" />
        <p class="p-2 text-sm break-all" id="lightbox-name"></p>
      </div>
      <form method="dialog" class="modal-backdrop"><button>close</button></form>
    </dialog>

    <script type="module" src="/app.js"></script>
  </body>
</html>
```

`src/dashboard/ui/app.ts`:

```ts
interface Model {
  id: string;
  quality: boolean;
  sizes?: string[];
  min_price: number | null;
}

interface Generated {
  name: string;
  path: string;
  fileUrl: string;
  url?: string;
  model: string;
  cost?: number;
  latency_ms?: number;
}

interface GalleryItem {
  name: string;
  fileUrl: string;
  kind: 'image' | 'video';
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const usd = (value: number): string => `$${value.toFixed(value < 1 ? 4 : 2)}`;
const MODEL_KEY = 'imagerouter:model';

let models: Model[] = [];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  return body as T;
}

function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function loadBalance(): Promise<void> {
  try {
    const credits = await api<{ remaining_credits: number; credit_usage: number }>('/api/credits');
    el('balance').textContent = usd(credits.remaining_credits);
    el('usage').textContent = `${usd(credits.credit_usage)} used`;
  } catch (error) {
    el('balance').textContent = '–';
    el('usage').textContent = (error as Error).message;
  }
}

function renderModels(): void {
  const search = el<HTMLInputElement>('model-search').value.trim().toLowerCase();
  const freeOnly = el<HTMLInputElement>('free-only').checked;
  const select = el<HTMLSelectElement>('model');
  const previous = select.value || remember(MODEL_KEY);
  const visible = models.filter(
    (model) =>
      (!search || model.id.toLowerCase().includes(search)) && (!freeOnly || model.min_price === 0),
  );
  select.replaceChildren(
    ...visible.map((model) => {
      const price =
        model.min_price === 0 ? 'free' : model.min_price === null ? '' : `from ${usd(model.min_price)}`;
      return new Option(price ? `${model.id} · ${price}` : model.id, model.id);
    }),
  );
  if (previous && visible.some((model) => model.id === previous)) select.value = previous;
  renderModelOptions();
}

function renderModelOptions(): void {
  const model = models.find((candidate) => candidate.id === el<HTMLSelectElement>('model').value);
  const sizes = model?.sizes?.length ? model.sizes : ['auto', '1024x1024', '1536x1024', '1024x1536'];
  el<HTMLSelectElement>('size').replaceChildren(...sizes.map((size) => new Option(size, size)));
  el<HTMLSelectElement>('quality').disabled = !model?.quality;
  el('model-info').textContent = model
    ? model.min_price === 0
      ? 'Free model'
      : model.min_price === null
        ? 'Price unknown'
        : `From ${usd(model.min_price)} per image`
    : 'No model matches the filter';
}

function showResult(result: Generated): void {
  el('result').classList.remove('hidden');
  const image = el<HTMLImageElement>('result-image');
  image.src = result.fileUrl;
  image.alt = result.name;

  const meta = el('result-meta');
  const badge = (text: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = 'badge badge-outline';
    span.textContent = text;
    return span;
  };
  const copy = (label: string, value: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-xs';
    button.textContent = label;
    button.title = value;
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = label), 1200);
    });
    return button;
  };
  meta.replaceChildren(
    badge(result.model),
    ...(result.cost === undefined ? [] : [badge(usd(result.cost))]),
    ...(result.latency_ms === undefined ? [] : [badge(`${(result.latency_ms / 1000).toFixed(1)} s`)]),
    copy('Copy path', result.path),
    ...(result.url ? [copy('Copy URL', result.url)] : []),
  );
}

async function loadGallery(): Promise<void> {
  const page = await api<{ total: number; items: GalleryItem[] }>('/api/images?limit=60');
  const images = page.items.filter((item) => item.kind === 'image');
  el('gallery-count').textContent = String(page.total);
  el('gallery-empty').classList.toggle('hidden', images.length > 0);
  el('gallery').replaceChildren(
    ...images.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'aspect-square overflow-hidden rounded-box bg-base-200';
      const image = document.createElement('img');
      image.src = item.fileUrl;
      image.alt = item.name;
      image.loading = 'lazy';
      image.className = 'h-full w-full object-cover transition hover:scale-105';
      button.append(image);
      button.addEventListener('click', () => {
        el<HTMLImageElement>('lightbox-image').src = item.fileUrl;
        el('lightbox-name').textContent = item.name;
        el<HTMLDialogElement>('lightbox').showModal();
      });
      return button;
    }),
  );
}

async function generate(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const submit = el<HTMLButtonElement>('submit');
  const error = el('error');
  error.classList.add('hidden');
  submit.disabled = true;
  submit.innerHTML = '<span class="loading loading-spinner loading-sm"></span> Generating';
  try {
    const model = el<HTMLSelectElement>('model').value;
    const quality = el<HTMLSelectElement>('quality');
    const result = await api<Generated>('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: el<HTMLTextAreaElement>('prompt').value,
        model,
        size: el<HTMLSelectElement>('size').value,
        quality: quality.disabled ? undefined : quality.value,
        output_format: el<HTMLSelectElement>('format').value,
      }),
    });
    remember(MODEL_KEY, model);
    showResult(result);
    await Promise.all([loadGallery(), loadBalance()]);
  } catch (caught) {
    error.textContent = (caught as Error).message;
    error.classList.remove('hidden');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Generate';
  }
}

async function init(): Promise<void> {
  el('generate-form').addEventListener('submit', (event) => void generate(event as SubmitEvent));
  el('model-search').addEventListener('input', renderModels);
  el('free-only').addEventListener('change', renderModels);
  el('model').addEventListener('change', renderModelOptions);
  el('refresh-balance').addEventListener('click', () => void loadBalance());

  const status = await api<{ hasApiKey: boolean; outputDir: string; defaultImageModel: string | null }>(
    '/api/status',
  );
  el('key-warning').classList.toggle('hidden', status.hasApiKey);
  el('gallery-dir').textContent = status.outputDir;
  if (status.defaultImageModel && !remember(MODEL_KEY)) remember(MODEL_KEY, status.defaultImageModel);

  void loadGallery();
  if (status.hasApiKey) void loadBalance();
  try {
    models = (await api<{ models: Model[] }>('/api/models')).models;
    renderModels();
  } catch (error) {
    el('model-info').textContent = `Could not load models: ${(error as Error).message}`;
  }
}

void init();
```

- [ ] **Step 7: Build and run the gates**

Run: `bun run build && ls dist dist/dashboard && head -1 dist/cli.js && bun run test && bun run type-check && bun run lint && bun run format && bun run format:check`
Expected: `dist/cli.js` starts with `#!/usr/bin/env bun`; `dist/dashboard` holds `index.html`, `app.js`, `styles.css`; `grep -c 'btn-primary' dist/dashboard/styles.css` ≥ 1 (daisyUI classes were generated); all gates pass. If `tsc` rejects DOM types in `app.ts` together with Node types, add `/// <reference lib="dom" />` at the top of `app.ts`.

- [ ] **Step 8: Verify in a real browser**

```bash
IMAGEROUTER_OUTPUT_DIR=/tmp/ir-dashboard-check bun dist/cli.js dashboard --no-open --port 4477
```

Open `http://127.0.0.1:4477` with a browser tool and confirm, with screenshots: the page is styled; without a key the warning banner shows and models still load; with `IMAGEROUTER_API_KEY` set, the balance shows, generating with `test/test` displays the image, adds it to the gallery and refreshes the balance; the lightbox opens; an invalid model shows the error alert; layout holds at 390 px width and in dark mode. Also confirm `curl -s -H 'Host: evil.example' http://127.0.0.1:4477/api/status` returns 403. Stop the server afterwards.

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat: add local dashboard"`

---
### Task 10: Live smoke test and documentation

**Files:**
- Create: `tests/live/smoke.test.ts`, `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `LICENSE`

**Interfaces:**
- Consumes: `resolveConfig`, `ImageRouterClient`, `runGeneration`, `summariseModels`.

- [ ] **Step 1: Write `tests/live/smoke.test.ts`**

```ts
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
    const video = await runGeneration(deps, 'video', { prompt: 'smoke test', model: 'ir/test-video' });
    expect((await stat(video.path)).size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun run test:live`
Expected with `IMAGEROUTER_API_KEY` exported: 5 pass. Without a key: 5 skipped; say so in the final report rather than claiming live verification. A live failure is a finding about the real API: fix the code to match what the API actually returns, update the spec's "API facts" section in the same commit, and re-run.

- [ ] **Step 3: Write `README.md`**

Sections, in this order, with real content:

1. Title and one-paragraph description (MCP server + local dashboard for ImageRouter; requires Bun ≥ 1.2).
2. **Quick start** — get a key at `https://imagerouter.io/api-keys`, then:

   ```bash
   claude mcp add imagerouter --env IMAGEROUTER_API_KEY=your-key -- bunx imagerouter-mcp
   ```

   and the Claude Desktop / generic JSON form:

   ```json
   {
     "mcpServers": {
       "imagerouter": {
         "command": "bunx",
         "args": ["imagerouter-mcp"],
         "env": {
           "IMAGEROUTER_API_KEY": "your-key",
           "IMAGEROUTER_DEFAULT_IMAGE_MODEL": "black-forest-labs/FLUX-1-schnell:free"
         }
       }
     }
   }
   ```

3. **Tools** — a table of the five tools with one-line descriptions, then per tool its arguments and an example result (copy the shapes from the spec).
4. **Dashboard** — `IMAGEROUTER_API_KEY=your-key bunx imagerouter-mcp dashboard`, the `--port` and `--no-open` flags, what it shows, that it listens on `127.0.0.1` only.
5. **Configuration** — the environment table from the spec, verbatim.
6. **Where files go and what is public** — default directory; hosted URLs are publicly reachable for 30 days; `ephemeral: true` avoids storage on ImageRouter.
7. **Development** — `bun install`, `bun run test`, `bun run test:live`, `bun run build`, `bun run dashboard`.
8. **License** — MIT.

- [ ] **Step 4: Write `AGENTS.md`**

Model it on `/home/dev/.projects/chronova-mcp/AGENTS.md` (same opening rule: only what cannot be inferred in a minute). It must state:

- Shape: one bin, two modes; `ImageRouterClient` is the only outward HTTP boundary; `runGeneration` is the only generation flow and both the MCP tools and the dashboard call it.
- Tool contract: Zod v4 `inputSchema`; handlers never rethrow and return `formatToolError(error)`; results are `JSON.stringify(data, null, 2)`; generation tools are `readOnlyHint: false` because they spend credits and write files, the two read tools are `readOnlyHint: true`.
- stdout is the MCP channel: diagnostics go to stderr only.
- No HTTP MCP transport, on purpose: results are written to local disk.
- Dashboard: `routes.ts` is a pure `Request → Response` function so vitest can run it under Node; `serve.ts` is the only file that touches `Bun.serve`. The Host/Origin check is a security boundary, not decoration.
- Build and runtime: the bin targets **Bun**, not Node (unlike chronova-mcp); `bun.lock` must be produced by the Bun version pinned in `packageManager` and CI.
- Tests: `bun run test` never touches the network; `bun run test:live` uses only `test/test` and `ir/test-video`.
- Adding a tool: registrar in `src/tools/`, wire in `src/tools/index.ts`, success and one error status in `tests/integration/tools.test.ts`.

- [ ] **Step 5: Write `CONTRIBUTING.md` and `LICENSE`**

Copy `/home/dev/.projects/chronova-mcp/CONTRIBUTING.md`, replace the project name and repo URL, and remove anything that refers to the HTTP transport, Docker or WakaTime config. `LICENSE` is the MIT text, `Copyright (c) 2026 NX Solutions UG`.

- [ ] **Step 6: Gates and commit**

Run: `bun run format && bun run format:check && bun run lint && bun run test`
Then: `git add -A && git commit -m "docs: add README, agent guide and live smoke test"`

---

### Task 11: Workflows, GitHub repository and first release

**Files:**
- Create: `.github/workflows/{test,release,auto-manage,vouch-manage,vouch-pr,claude,claude-ci,claude-code-review,claude-fix-issue}.yml`, `.claude/commands/*.md`

**Interfaces:**
- Consumes: the scripts `type-check`, `lint`, `format:check`, `test`, `build`, `semantic-release` from `package.json`.

- [ ] **Step 1: Copy the workflows that are specific to the MCP family**

```bash
R=/home/dev/.projects/chronova-mcp
mkdir -p .github/workflows .claude/commands
cp $R/.github/workflows/{test,release,auto-manage,vouch-manage,vouch-pr}.yml .github/workflows/
```

In `release.yml`, add these two steps to the `test` job after "Check formatting with oxfmt", so a release cannot ship untested or unbuildable code:

```yaml
      - name: Run tests
        run: bun run test

      - name: Build
        run: bun run build
```

Read every copied file end to end. Replace any `chronova-mcp` literal with `imagerouter-mcp`; leave `${{ github.repository }}` expressions alone. Confirm every `bun-version` is `'1.4.2'`, matching `packageManager`.

- [ ] **Step 2: Port the Claude workflows from the source of truth**

`chronova` owns `claude*.yml`; `chronova-mcp` carries adapted copies. For each of `claude.yml`, `claude-ci.yml`, `claude-code-review.yml`, `claude-fix-issue.yml`:

```bash
git -C /home/dev/.projects/chronova fetch -q && git -C /home/dev/.projects/chronova-mcp fetch -q
diff /home/dev/.projects/chronova/.github/workflows/claude-code-review.yml \
     /home/dev/.projects/chronova-mcp/.github/workflows/claude-code-review.yml
```

Start from the `chronova-mcp` copy (same stack: bun, oxlint, oxfmt, vitest). Where the diff shows `chronova` has since gained a fix that is not stack-specific, take it. Read the result and replace repo-specific literals. Then copy `.claude/commands/*.md` from `chronova-mcp` and rewrite the stack and review-criteria passages for this repo: Bun runtime bin, stdio only, the tool contract from `AGENTS.md`, no HTTP transport, no Docker. Remove criteria that refer to files this repo does not have.

- [ ] **Step 3: Validate the workflow files**

```bash
for f in .github/workflows/*.yml; do bun -e "Bun.YAML.parse(await Bun.file('$f').text())" && echo "ok $f"; done
grep -rn "chronova" .github .claude || echo "no stray references"
```

Expected: every file parses. Remaining `chronova` matches must be intentional (`chronova-agent[bot]`, the shared GitHub App) and each one is read and justified, not assumed.

- [ ] **Step 4: Full local verification before anything leaves the machine**

Run: `rm -rf node_modules && bun install --frozen-lockfile && bun run type-check && bun run lint && bun run format:check && bun run test && bun run build && bun pm pack --dry-run`
Expected: all pass; the pack listing contains `dist/cli.js`, `dist/dashboard/index.html`, `dist/dashboard/app.js`, `dist/dashboard/styles.css`, `README.md`, `package.json` and no `src/`, `tests/` or `docs/`.

Then install the tarball the way a user would:

```bash
bun pm pack && T=$(mktemp -d) && cp imagerouter-mcp-*.tgz $T/ && (cd $T && bun init -y >/dev/null && bun add ./imagerouter-mcp-*.tgz && bunx imagerouter-mcp --version) ; rm -f imagerouter-mcp-*.tgz
```

Expected: prints the version.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "ci: add test, release and agent workflows"
```

- [ ] **Step 6: Squash-free history check, then create the repository and push**

`git log --oneline` must show at least one `feat:` commit (it does, from Tasks 2–9), so semantic-release will cut `1.0.0`.

```bash
gh repo create nx-solutions-ug/imagerouter-mcp --public \
  --description "MCP server and local dashboard for generating images and videos through the ImageRouter API" \
  --source . --remote origin --push
gh repo edit nx-solutions-ug/imagerouter-mcp --add-topic mcp --add-topic imagerouter --add-topic image-generation --add-topic bun
```

- [ ] **Step 7: Watch CI**

```bash
gh run list -R nx-solutions-ug/imagerouter-mcp --limit 5
gh run watch -R nx-solutions-ug/imagerouter-mcp $(gh run list -R nx-solutions-ug/imagerouter-mcp --workflow Tests --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: `Tests` is green. `Release` passes its test job; its release job fails at npm publish until `NPM_TOKEN` exists as a repo secret. Read the failing log to confirm that is the only cause (`gh run view --log-failed`); fix anything else. Do not attempt to supply an npm token.

- [ ] **Step 8: Report**

State plainly: repo URL, CI status per workflow, whether the live smoke test ran, whether the dashboard was verified in a browser, and that the first npm release needs `gh secret set NPM_TOKEN -R nx-solutions-ug/imagerouter-mcp` followed by `gh workflow run Release -R nx-solutions-ug/imagerouter-mcp`.
