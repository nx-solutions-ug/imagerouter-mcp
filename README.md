# imagerouter-mcp

An [MCP](https://modelcontextprotocol.io) server and a local dashboard for
[ImageRouter](https://imagerouter.io). Generate and edit images, generate
videos, pick a model and check your balance from Claude Code, Claude Desktop or
any stdio MCP client. Results are saved to disk and the tools return the file
path. Requires [Bun](https://bun.sh) 1.2 or newer.

## Quick start

Create an API key at <https://imagerouter.io/api-keys>, then register the server.

Claude Code:

```bash
claude mcp add imagerouter --env IMAGEROUTER_API_KEY=your-key -- bunx @chronova/imagerouter-mcp
```

Claude Desktop or any client that takes a JSON config:

```json
{
  "mcpServers": {
    "imagerouter": {
      "command": "bunx",
      "args": ["@chronova/imagerouter-mcp"],
      "env": {
        "IMAGEROUTER_API_KEY": "your-key",
        "IMAGEROUTER_DEFAULT_IMAGE_MODEL": "black-forest-labs/FLUX-1-schnell:free"
      }
    }
  }
}
```

Without a key the server still starts and `list_models` works; the other tools
return an `UNAUTHORIZED` error that names `IMAGEROUTER_API_KEY`.

### From source

```bash
git clone https://github.com/nx-solutions-ug/imagerouter-mcp.git
cd imagerouter-mcp
bun install
bun run build
```

Then use `bun /path/to/imagerouter-mcp/dist/cli.js` wherever the examples above
say `bunx @chronova/imagerouter-mcp`, for example:

```bash
claude mcp add imagerouter --env IMAGEROUTER_API_KEY=your-key -- bun /path/to/imagerouter-mcp/dist/cli.js
```

## Tools

| Tool             | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `generate_image` | Generate an image from a text prompt and save it.                           |
| `edit_image`     | Edit images (image-to-image, mask inpainting, background removal) and save. |
| `generate_video` | Generate a video from a prompt, from images, or both, and save it.          |
| `list_models`    | List models with capabilities and lowest price in USD. Works without a key. |
| `get_credits`    | Show the account balance in USD.                                            |

Every generation tool resolves its model as: the `model` argument, then
`IMAGEROUTER_DEFAULT_IMAGE_MODEL` / `IMAGEROUTER_DEFAULT_VIDEO_MODEL`, otherwise
it fails with a message telling you to pass one. `edit_image` uses the image
default. Use `list_models` to find a model; there are about 200, so filter.

Failures come back as an error result such as
`INSUFFICIENT_CREDITS: ...`, never as a crash. The codes are `INVALID_REQUEST`,
`UNAUTHORIZED`, `INSUFFICIENT_CREDITS`, `NOT_FOUND`, `RATE_LIMITED`,
`SERVER_ERROR`, `CONNECTION_ERROR`, `TIMEOUT`, `API_ERROR` and `LOCAL_ERROR`.

Two cases to know about:

- A `TIMEOUT` or `CONNECTION_ERROR` on a generation call warns that the request
  may still complete and be billed. Check `get_credits` before retrying.
- If a generation succeeded but downloading or saving the result failed, the
  error lists the hosted URLs (kept for 30 days) and any files already saved,
  so nothing you paid for is lost.

### Saving arguments (all three generation tools)

| Argument     | Meaning                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| `output_dir` | Directory to save into. Defaults to `IMAGEROUTER_OUTPUT_DIR`.                        |
| `filename`   | File name without directory. The extension is set from the result.                   |
| `ephemeral`  | `true`: ImageRouter does not store the result and no URL is returned, only the file. |

Without `filename` files are named `<yyyyMMdd-HHmmss>-<prompt slug>-<4 hex>.<ext>`.
Existing files are never overwritten; a numeric suffix is added. The extension
comes from the file's own signature when it is recognised, then the download's
content type, then the URL, then `output_format`. A type that cannot be
identified is saved as `.bin`.

### `generate_image`

Arguments: `prompt` (required, up to 20000 characters), `model`, `size` (`auto`
or `WIDTHxHEIGHT`), `quality` (`auto|low|medium|high`), `output_format`
(`webp|jpeg|png`), plus the saving arguments.

```json
{
  "path": "/home/you/Pictures/imagerouter/20261007-140509-a-fox-in-snow-3f9a.webp",
  "url": "https://storage.imagerouter.io/....webp",
  "model": "black-forest-labs/FLUX-1-schnell:free",
  "cost": 0,
  "latency_ms": 2140
}
```

### `edit_image`

Arguments: `images` (required, 1 to 16: local paths, `http(s)` URLs or data
URIs), `prompt` (optional; some models such as background removal take none),
`masks` (optional, same forms, for models with mask support), `model`, `size`,
`quality`, `output_format`, plus the saving arguments. Use
`list_models` with `supports_edit` to find a model that can edit. The result has
the same shape as `generate_image`.

### `generate_video`

Arguments: `prompt`, `images` (start images for image-to-video, up to 16; at
least one of `prompt` or `images` is required), `model`, `size`, `seconds`
(`auto` or 1 to 60; accepted values depend on the model), plus the saving
arguments. Video can take several minutes; if the client sent a progress token
the server reports progress every 15 seconds. The result has the same shape as
`generate_image`. When a call returns several files, `path` and `url` point at
the first and a `files` array lists all of them.

### `list_models`

Arguments: `output` (`image|video`), `supports_edit`, `supports_mask`,
`free_only`, `search` (case-insensitive substring of the id), `limit` (1 to 300,
default 50). Newest models come first.

```json
{
  "total": 41,
  "returned": 1,
  "models": [
    {
      "id": "black-forest-labs/FLUX-1-schnell:free",
      "output": "image",
      "text": true,
      "edit": false,
      "mask": false,
      "quality": false,
      "min_price": 0,
      "release_date": "2024-08-01"
    }
  ]
}
```

`min_price` is the lowest price in USD across providers, or `null` when unknown.
`sizes` and `seconds` appear when the model restricts them.

### `get_credits`

No arguments.

```json
{
  "remaining_credits": 4.82,
  "credit_usage": 0.18,
  "total_deposits": 5
}
```

## Dashboard

```bash
IMAGEROUTER_API_KEY=your-key bunx @chronova/imagerouter-mcp dashboard
```

Starts a page on `http://127.0.0.1:4477` and opens your browser. Options:

- `--port <n>` or `--port=<n>`: port to use (default `4477`, or `IMAGEROUTER_DASHBOARD_PORT`).
- `--no-open`: do not open a browser.

Any other option is rejected. The dashboard shows your balance, a form to
generate images (searchable model picker with prices and free models marked,
size, quality, format), the result with its cost, latency, path and URL, and a
gallery of the saved images in the output directory (videos and files of
unrecognised type, saved as `.bin`, are not shown). When there is no remembered
or configured model, or that model is not in the current filtered list, it
preselects a free model so a first click never spends credits by accident.
Editing and video are available through the MCP tools only.

It listens on `127.0.0.1` only and answers only requests addressed to
`localhost` or `127.0.0.1` on its own port. Cross-site POSTs are refused and
responses carry security headers. Your API key stays in the server process; the
browser never sees it.

## Configuration

| Variable                          | Default                      | Purpose                                       |
| --------------------------------- | ---------------------------- | --------------------------------------------- |
| `IMAGEROUTER_API_KEY`             | none                         | Required for everything except listing models |
| `IMAGEROUTER_BASE_URL`            | `https://api.imagerouter.io` | Override for testing                          |
| `IMAGEROUTER_OUTPUT_DIR`          | `~/Pictures/imagerouter`     | Where results are saved                       |
| `IMAGEROUTER_DEFAULT_IMAGE_MODEL` | none                         | Used when a call omits `model`                |
| `IMAGEROUTER_DEFAULT_VIDEO_MODEL` | none                         | Same, for video                               |
| `IMAGEROUTER_IMAGE_TIMEOUT_MS`    | `180000`                     | Request timeout, image calls                  |
| `IMAGEROUTER_VIDEO_TIMEOUT_MS`    | `900000`                     | Request timeout, video calls                  |
| `IMAGEROUTER_DASHBOARD_PORT`      | `4477`                       | Dashboard port (`--port` overrides)           |

## Where files go and what is public

Results are saved to `~/Pictures/imagerouter` unless `IMAGEROUTER_OUTPUT_DIR` or
the `output_dir` argument says otherwise. Unless you pass `ephemeral: true`,
ImageRouter also stores each result for 30 days at a hosted URL that anyone
holding the link can open. Use `ephemeral: true` when the content must not be
stored on ImageRouter; you then get only the local file and no URL, and the
result cannot be fetched again if saving fails.

## Development

```bash
bun install
bun run test        # unit and integration tests, no network
bun run test:live   # smoke test against the real API, needs IMAGEROUTER_API_KEY
bun run build       # bundle into dist/
bun run dashboard   # build, then start the dashboard
```

`bun run test:live` is skipped without a key and uses only the free models
`test/test` and `ir/test-video`, so it costs nothing. Before opening a pull
request also run `bun run type-check`, `bun run lint` and `bun run format:check`.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License

MIT, see [LICENSE](LICENSE).
