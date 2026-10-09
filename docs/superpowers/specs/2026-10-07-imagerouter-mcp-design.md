# imagerouter-mcp — design

Date: 2026-10-07
Repo: `nx-solutions-ug/imagerouter-mcp` (public) · npm: `@chronova/imagerouter-mcp` (bin `imagerouter-mcp`)

## Goal

Let an MCP client (Claude Code, Claude Desktop, any stdio client) generate and
edit images and generate videos through the [ImageRouter API](https://docs.imagerouter.io/),
pick a model, and check the account balance. Ship a small local dashboard in the
same package for doing the same by hand: generate images, browse what was
generated, see the balance.

Success means: `bunx @chronova/imagerouter-mcp` works as a stdio MCP server with five
tools, `bunx @chronova/imagerouter-mcp dashboard` opens a working local UI, and the repo
carries the chronova-family pipeline and releases to npm from `main`.

## Decisions taken with the user

- Tool scope: images **and** video.
- Results are saved to disk; tools return the path and the hosted URL.
- Chronova-family workflows, including the semantic-release npm publish.
- Bun is the runtime: the published bin targets Bun, not Node.
- A local dashboard is part of the package.

## API facts this design relies on

Verified against `https://api.imagerouter.io/.well-known/openapi.yaml`, the docs
and live probes on 2026-10-07.

- Base URL `https://api.imagerouter.io`, auth `Authorization: Bearer <key>`.
- `POST /v1/openai/images/generations`, `POST /v1/openai/images/edits`,
  `POST /v1/openai/videos/generations` — JSON or `multipart/form-data`.
  Only `model` is required. Calls are synchronous.
- Parameters: `prompt` (max 20000 chars), `model`, `size` (`auto` or `WxH`),
  `quality` (`auto|low|medium|high`), `response_format`
  (`url|b64_json|b64_ephemeral`), `output_format` (`webp|jpeg|png`, images),
  `seconds` (`auto` or 1–60, video), `image`/`image[]`, `mask`/`mask[]`.
- Input images and masks: multipart files, URL strings or data URIs; up to 16.
- Response: `{ created, data: [{ url } | { b64_json }], latency, cost }`.
- `url`/`b64_json` results are stored 30 days and publicly reachable by URL;
  `b64_ephemeral` is not stored.
- `GET /v1/models` needs no key and returns an object keyed by model id:
  `{ providers: [{ id, pricing: { type, value | range } }], output: ['image'|'video'],
  supported_params: { text, mask, quality, edit }, sizes?, seconds?,
  default_seconds?, release_date? }`. 200 models, 78 KB.
- `GET /v1/credits` → `{ remaining_credits, credit_usage, total_deposits }` (strings).
- Errors: `{ "error": { "message", "type" } }`; 401 confirmed with type
  `unauthorized`. Other statuses are not documented.
- Free models for smoke tests: `test/test` (image), `ir/test-video` (video).
- Live run on 2026-10-07 (`bun run test:live`, 5/5): a multipart edit upload
  whose file part carries no MIME type (`new File([bytes], name)`) is accepted.
  `b64_ephemeral` entries are `{ revised_prompt, b64_json }` with raw image
  bytes and no content type; `test/test` answers with JPEG bytes even though
  no `output_format` was sent, so the format cannot be assumed (see Saving).
  Its hosted URL (a GitHub raw file) is served as `image/png` although the
  bytes are JPEG, which is why the signature outranks the header.

## Architecture

One package, one bin, two modes that share everything below the entry point.

```
src/
  cli.ts                  bin: no args → stdio MCP server; `dashboard` → local UI
  server.ts               builds the McpServer, registers tools
  version.ts
  tools/
    generate-image.ts
    edit-image.ts
    generate-video.ts
    list-models.ts
    get-credits.ts
    index.ts
  lib/
    config.ts             env → typed config
    imagerouter-client.ts the only outward HTTP boundary; fetch injectable
    errors.ts             status → error code mapping, user-facing messages
    inputs.ts             path / URL / data URI classification, multipart assembly
    output.ts             download or decode, name, write, list saved files
    models.ts             raw catalogue → compact projection + filters
    types.ts
  dashboard/
    serve.ts              Bun.serve on 127.0.0.1: JSON routes + static UI
    routes.ts             handlers, built on the same client/output/models libs
    ui/                   index.html, app.ts, styles.css (Tailwind + daisyUI)
tests/
  unit/…                  per lib module
  integration/tools.test.ts
  integration/dashboard.test.ts
  live/smoke.test.ts      opt-in
```

No HTTP MCP transport. Tools write to the server's local disk, which is useless
to a remote client, so chronova-mcp's Express entry point is deliberately absent.

### Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `IMAGEROUTER_API_KEY` | — | Required for everything except listing models |
| `IMAGEROUTER_BASE_URL` | `https://api.imagerouter.io` | Override for testing |
| `IMAGEROUTER_OUTPUT_DIR` | `~/Pictures/imagerouter` | Where results are saved |
| `IMAGEROUTER_DEFAULT_IMAGE_MODEL` | — | Used when a call omits `model` |
| `IMAGEROUTER_DEFAULT_VIDEO_MODEL` | — | Same, for video |
| `IMAGEROUTER_IMAGE_TIMEOUT_MS` | `180000` | Request timeout, image calls |
| `IMAGEROUTER_VIDEO_TIMEOUT_MS` | `900000` | Request timeout, video calls |
| `IMAGEROUTER_DASHBOARD_PORT` | `4477` | Dashboard port (`--port` overrides) |

A missing API key is not a startup failure: the server starts, `list_models`
works, and the other tools return a clear `UNAUTHORIZED` error naming the variable.

## MCP tools

Inputs are Zod v4 schemas; the SDK validates before the handler runs. Handlers
never throw: failures return `{ content, isError: true }` with a clean message.
Successful results are `JSON.stringify(data, null, 2)` in a text block.

### `generate_image`

Input: `prompt` (string, ≤20000), `model?`, `size?`, `quality?`,
`output_format?` (`webp|jpeg|png`), `output_dir?`, `filename?`, `ephemeral?` (bool).

Result: `{ path, url, model, cost, latency_ms }` — `url` omitted when `ephemeral`.

### `edit_image`

As `generate_image`, plus `images` (1–16 strings, required) and `masks?` (≤16).
`prompt` is optional here, since some edit models (background removal) take none.
Posts to `/v1/openai/images/edits`.

### `generate_video`

Input: `prompt?`, `model?`, `size?`, `seconds?` (`auto` or 1–60), `images?`
(≤16, image-to-video), `output_dir?`, `filename?`, `ephemeral?`.
At least one of `prompt` or `images` is required.
Result shape as above. If the client sent a progress token, the handler emits a
progress notification every 15 s while waiting so the client does not look hung.

### `list_models`

Input: `output?` (`image|video`), `supports_edit?`, `supports_mask?`,
`free_only?`, `search?` (case-insensitive substring of the id), `limit?` (default 50).

Result: `{ total, returned, models: [{ id, output, text, edit, mask, quality,
sizes?, seconds?, min_price, release_date? }] }`, sorted newest first.
`min_price` is the lowest `value` or `range.min` across providers. The raw
catalogue is never returned.

### `get_credits`

No input. Result: `{ remaining_credits, credit_usage, total_deposits }` as numbers.

### Shared behaviour

- **Model resolution:** call argument → the matching default env var → error
  `No model given. Pass "model" or set IMAGEROUTER_DEFAULT_IMAGE_MODEL; use list_models to find one.`
- **Response format:** never exposed. Default flow requests `url`, downloads it
  and saves it. `ephemeral: true` requests `b64_ephemeral`, decodes and saves.
- **Inputs (`inputs.ts`):** a string starting `http://`/`https://` or `data:` is
  passed through; anything else is a local path (with `~` expanded) that must
  exist and be a file. If every input is pass-through the request is JSON;
  if any is a local file the whole request is multipart, with pass-through
  strings sent as form fields.
- **Saving (`output.ts`):** directory = `output_dir` argument → env → default,
  created if missing. Name = `filename` argument (basename only, extension
  forced) or `<yyyyMMdd-HHmmss>-<slug of first 40 prompt chars>-<4 hex>.<ext>`.
  Extension comes from the file signature of the bytes (png, jpeg, gif, webp,
  mp4, webm) when recognised, then the downloaded `Content-Type`, then the URL's
  extension, then `output_format`, then `webp`/`mp4`. An unrecognised type is
  saved as `.bin`. Existing files are never overwritten: a
  numeric suffix is added.
- **Billing safety:** a `TIMEOUT` or `CONNECTION_ERROR` on a generation call
  adds that the request may still be billed and to check `get_credits` before
  retrying. After a billed generation, a download or save failure is a
  `LOCAL_ERROR` that lists the hosted URLs (30 days) and the files already
  saved, or says an ephemeral result cannot be fetched again.
- **Multiple results:** every entry in `data` is saved; the result gains a
  `files` array and `path`/`url` point at the first.
- **Annotations:** the three generation tools set `readOnlyHint: false`,
  `openWorldHint: true`; `list_models` and `get_credits` set `readOnlyHint: true`.

## Generation records

Every saved result `X` gets a sidecar `X.json` next to it (`src/lib/metadata.ts`,
`GenerationRecord`, `version: 1`): `file`, `kind`, `created`, resolved `model`,
`prompt`, `requested` (`size`, `quality`, `output_format`, `seconds`), actual
`width`/`height` (read from the saved bytes by `src/lib/dimensions.ts`: PNG, GIF,
JPEG, WebP; absent for video), `bytes`, `cost`, `latency_ms`, `url` (absent when
ephemeral), `ephemeral`, `inputs` (data URIs replaced by `data-uri`) and, for a
multi-result request, `index`/`count`. `cost` is the request's cost and is
repeated on each sidecar, so a reader counts only `index` 0 or absent.

`runGeneration` writes the sidecar right after each file is saved. Writing is
best-effort (`null` on failure, never throws): the request is already billed. The
result gains `width`, `height`, `metadata_path` and the same per entry of `files`.
Sidecars are written atomically (temporary file, then rename). Records are untrusted on
read: types are validated, wrong-typed optional fields dropped, strings capped (prompt
20000, others 2048), `model` must be non-empty and `url` must be http(s). Prompts are stored in plain text in the output directory, also for
`ephemeral` requests. Out of scope: deleting or editing records, a central
history, records for earlier images.

## Errors

`errors.ts` maps HTTP status to a code and keeps the API's own message:

| Status | Code |
|---|---|
| 400, 422 | `INVALID_REQUEST` |
| 401, 403 | `UNAUTHORIZED` |
| 402 | `INSUFFICIENT_CREDITS` |
| 404 | `NOT_FOUND` |
| 429 | `RATE_LIMITED` (with `retryAfter` when the header is present) |
| 5xx | `SERVER_ERROR` |
| network failure | `CONNECTION_ERROR` |
| abort on timeout | `TIMEOUT` |

A non-JSON error body falls back to the status text. Local failures (missing
input file, unwritable output directory, failed download) get their own
messages without stack traces or internal paths beyond the path the user gave.

## Dashboard

`imagerouter-mcp dashboard [--port N] [--no-open]` starts `Bun.serve` on
`127.0.0.1` and opens the browser. The API key stays in the server process; the
browser only ever talks to localhost.

### Routes

| Route | Does |
|---|---|
| `GET /` and assets | The bundled UI |
| `GET /api/status` | `{ hasApiKey, outputDir, defaultImageModel }` |
| `GET /api/models` | Compact image-model list (same projection as `list_models`) |
| `GET /api/credits` | Balance |
| `POST /api/generate` | Body = `generate_image` input minus `output_dir` (so `filename` and `ephemeral` are accepted); returns the saved file, `width`/`height`, `metadata_path` and the first file's `record` |
| `GET /api/images` | Saved images (videos are excluded) in the output dir, newest first, paginated; each with its `record` or `null`; `?q=` filters (case-insensitive) by prompt, model, file name before paging; `total` counts matching images; `spent` sums the cost of all matching images, a multi-result request once |
| `GET /files/:name` | Serves one saved file |

Route handlers call the same `ImageRouterClient`, `models.ts` and `output.ts`
as the MCP tools; there is no second implementation of generation.

### UI

Single page, vanilla TypeScript, Tailwind + daisyUI, bundled by Bun at build time.

- **Header:** balance stat (remaining, used), refreshed on load and after each
  generation; a warning banner when no API key is configured.
- **Generate panel:** prompt textarea, model picker (searchable, free models
  badged, price shown, remembers the last choice in `localStorage`; with
  nothing remembered it preselects the first free model), size
  (options from the model's `sizes` when it has them), quality, format, Generate
  button with a loading state, inline error alert.
- **Result:** the new image with model, actual size, cost and latency, a Details
  button, path and URL with copy buttons.
- **Gallery:** grid of images already in the output directory; a tile shows model
  and pixel size (prompt as tooltip) when a record exists. A search box filters by
  prompt, model or file name (debounced, Enter never submits the form); the count
  is accompanied by "Spent $X.XX on N images" (N = all matches). Click opens the detail view:
  full record, Copy prompt/path/URL, and **Use these settings** (images only), which
  loads prompt, model, size, quality and format into the form without submitting it,
  resetting any field the record lacks to a neutral default.
  Record data reaches the DOM only through `textContent`/`Option`/property setters.

Scope is image generation and balance, as asked. Editing and video stay
MCP-only for now.

Superseded on 2026-10-09: the dashboard now also edits images and generates
videos, and its gallery lists videos. See
`2026-10-09-dashboard-generation-modes-design.md`.

### Dashboard safety

- Binds to `127.0.0.1` only.
- Rejects requests whose `Host` is not `localhost`/`127.0.0.1` on the bound
  port, and `POST`s whose `Origin` is present and does not match. Without this
  any web page could spend credits through the user's browser.
- Unknown CLI options are an error, not ignored.
- Every response sends `X-Content-Type-Options: nosniff`; `/api/*` and
  `/files/*` also send `Cross-Origin-Resource-Policy: same-origin`.
- `/files/:name` accepts a bare filename only and resolves it inside the output
  directory; anything else is a 400.

## Build and runtime

- Bun ≥ 1.2 is the runtime. Bin `imagerouter-mcp` → `dist/cli.js` with
  `#!/usr/bin/env bun`; `bun build src/cli.ts --target bun --packages external`.
- The dashboard UI is bundled into `dist/dashboard/` by the same build script.
- `tsc` is used for `--noEmit` only.
- `packageManager` and CI pin the same Bun version, and `bun.lock` is generated
  with that version so `--frozen-lockfile` holds in CI.
- Dependencies: `@modelcontextprotocol/sdk`, `zod`. Dev: typescript, vitest,
  oxlint, oxfmt, husky, semantic-release and plugins, tailwindcss, daisyui.

## Testing

- **Unit:** `inputs` (classification, multipart vs JSON), `output` (naming,
  collisions, extension choice, filename sanitising), `models` (projection,
  each filter, min price), `errors` (each status), `config`.
- **Integration, MCP:** in-memory client ↔ server with a stubbed fetch: success
  path for every tool plus at least one error status each, model fallback,
  ephemeral flow, multipart when a local file is given.
- **Integration, dashboard:** route handlers against a stubbed client: generate,
  credits, gallery listing, Host/Origin rejection, path traversal rejection.
- **Live smoke (opt-in):** runs only when `IMAGEROUTER_API_KEY` is set; uses
  `test/test` and `ir/test-video`, so it costs nothing. Not run in CI.
- **Dashboard UI:** verified by hand in a browser before release.

## Repository and release

- Tooling copied from `chronova-mcp`: `.oxlintrc.json`, `.oxfmtrc.json`,
  `.husky`, `tsconfig.json`, `vitest.config.ts`, `renovate.json`, `glama.json`,
  `.releaserc.json` (repo URL changed), `.gitignore`, `.npmignore`, `CONTRIBUTING.md`.
- Workflows: `test.yml`, `release.yml` (its gate also runs tests), `auto-manage.yml`,
  `vouch-manage.yml`, `vouch-pr.yml` from `chronova-mcp`; `claude-ci.yml`,
  `claude-code-review.yml`, `claude-fix-issue.yml`, `claude.yml` and
  `.claude/commands/*` diffed against `chronova` (the source of truth) and
  adapted the way `chronova-mcp` adapts them.
- `AGENTS.md` written for this server: the shape above, the tool contract
  (including that generation tools are *not* read-only), how to add a tool.
- `README.md`: what it does, the env table, config snippets for Claude Code and
  Claude Desktop, the dashboard, tool reference.
- Org-level secrets (`APP_CLIENT_ID`, `APP_PRIVATE_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`)
  and org-wide app installs (renovate, chronova-agent, claude) apply automatically.
- **Manual prerequisite:** `NPM_TOKEN` as a repo secret. Until it exists the
  release job fails at the npm step.
- First push is a `feat:` commit on `main`; semantic-release cuts `v1.0.0`.

## Out of scope

Chat completions and Responses endpoints, API-key management, an HTTP MCP
transport, image editing and video in the dashboard, hosting the dashboard
anywhere but localhost.
