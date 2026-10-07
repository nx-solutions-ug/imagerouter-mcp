# Repository Guidelines

`imagerouter-mcp` lets MCP clients generate and edit images and generate videos
through the ImageRouter API, and ships a small localhost dashboard for doing
the same by hand. Five tools, one stdio transport, results written to local disk.

**What belongs in this file: what you cannot infer from the repository in a
minute, and what you would otherwise get wrong by assuming.** File lists,
script names and dependency versions are deliberately absent — `ls` and
`package.json` answer those, and they stay correct, which a copy here does not.

## Shape

One bin, two modes. `src/cli.ts` with no arguments starts the stdio MCP server
(`src/server.ts`); `dashboard` starts the local UI. Both build on the same
libraries below `src/lib/`.

- `ImageRouterClient` (`src/lib/imagerouter-client.ts`) is the only outward
  HTTP boundary — API calls and result downloads alike. New code keeps it that
  way; tests inject `fetch` into it.
- `runGeneration` (`src/lib/generation.ts`) is the only generation flow:
  resolve model, build the body, call the API, download or decode, save. The
  MCP tools and the dashboard both call it. Never reimplement a step of it.
- After a generation succeeded the request is billed. A failure while
  downloading or saving therefore must say where the results are (hosted URLs,
  files already saved), and a timeout or connection error on a generation call
  must warn that the request may still be billed. Keep both when touching
  `generation.ts` or the client.

## Tool contract

- Inputs are Zod v4 schemas passed as `inputSchema`; the MCP SDK validates
  before the handler runs. Shared fields live in `src/tools/schemas.ts`, and
  the dashboard reuses them.
- A handler **never rethrows**. It catches and returns `formatToolError(error)`:
  `{ content: [...], isError: true }`, no stack traces.
- Successful results are `JSON.stringify(data, null, 2)` in one text block.
- `generate_image`, `edit_image` and `generate_video` set
  `readOnlyHint: false`: they spend credits and write files. `list_models` and
  `get_credits` set `readOnlyHint: true`.
- Saved extensions come from the bytes' signature first, because both ephemeral
  results and hosted files can be mislabelled; then Content-Type, URL, the
  requested format. Unknown result types are saved as `.bin`.

`src/lib/errors.ts` owns the status → code mapping. Extend the mapper, do not
special-case a status at the call site.

## stdout is the protocol

In MCP mode nothing but protocol frames may reach stdout. Diagnostics go to
stderr (`process.stderr.write`). oxlint enforces `no-console` for `src/**`, allowing
only `console.error` and `console.warn`. The dashboard mode prints its URL to stdout on purpose, because
it speaks no protocol.

## No HTTP MCP transport

Deliberate. Results are written to the server's local disk, which a remote
client could not reach. Do not add a Streamable HTTP entry point.

## Dashboard

`src/dashboard/routes.ts` is a pure `Request → Response` function, so vitest
can run it under Node. `src/dashboard/serve.ts` is the only file that touches
`Bun.serve`; it binds `127.0.0.1` only and rejects unknown CLI options.

The Host check (only `localhost`/`127.0.0.1` on the bound port) and the Origin
check on non-GET requests are a **security boundary**, not decoration: without
them any web page could spend credits through the user's browser. The dashboard
never takes paths from the browser (`output_dir`, `images`, `masks` are not
accepted), and `/files/:name` takes a bare file name only. Responses carry
`x-content-type-options: nosniff`; keep the headers when adding routes.

## Build and runtime

The bin targets **Bun**, not Node (unlike chronova-mcp): it uses `Bun.serve`
and `import.meta.dir`, and its shebang is `#!/usr/bin/env bun`. `scripts/build.ts`
bundles the CLI and the dashboard UI into `dist/`. `tsc` is for `--noEmit` only.

Bun is the package manager. `bun.lock` must be produced by the Bun version
pinned in `packageManager` and CI, or `--frozen-lockfile` fails. Do not add an
`npm`, `pnpm` or `yarn` lockfile; npm is the publish registry only.

`semantic-release` owns the version and `CHANGELOG.md` on `main`. Never bump
either by hand.

## Testing

- `bun run test` (vitest) never touches the network. Unit tests per lib module,
  integration tests drive the real MCP server through an in-memory client and
  the dashboard handler directly, both with an injected fake `fetch`.
- `bun run test:live` runs `tests/live/` against the real API. It is skipped
  without `IMAGEROUTER_API_KEY` and uses only the free models `test/test` and
  `ir/test-video`. Never put a paid model in it.

## Adding a tool

1. `src/tools/<tool-name>.ts` exporting `register<ToolName>(server, deps)`.
2. Zod schema, the right `readOnlyHint`, the handler shape above.
3. Wire it into `src/tools/index.ts`.
4. New response shape → `src/lib/types.ts`.
5. In `tests/integration/tools.test.ts`: the success path and at least one
   error status.

## Conventions

- ESM with `.js` import suffixes. Named exports only. `create<X>` for
  factories, `resolve<X>` for resolvers, `register<ToolName>` for registrars.
- Unused variables are allowed when prefixed `_`.
- Commits follow Conventional Commits; the squash subject of a pull request is
  what `semantic-release` reads.

## Gates

```bash
bun run type-check
bun run lint
bun run format:check
bun run test
```
