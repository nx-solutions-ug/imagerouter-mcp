# Dashboard generation modes — design

Date: 2026-10-09
Extends: `2026-10-07-imagerouter-mcp-design.md`. Where the two disagree about the
dashboard, this document wins.

## Goal

The dashboard's Generate form offers four modes instead of one:

| Mode | Input | Output |
|---|---|---|
| Text → Image | prompt | image |
| Image → Image | images, prompt optional | image |
| Text → Video | prompt | video |
| Image → Video | images, prompt optional | video |

The model picker only offers models that can do the selected mode. Success
means: each mode can be run by hand from the dashboard, the result is shown and
stays findable in the gallery, and a first click still never spends credits by
accident.

## Decisions taken with the user

- Input images come from **both** an upload (pick, drop, paste) and the gallery
  (an image already saved in the output directory).
- Videos **join the gallery**, its count and its "Spent" total. This reverses the
  images-only gallery of the first design.
- The backend changes listed below are approved.

## Facts this design relies on

Verified on 2026-10-09 against the docs, the OpenAPI document and the live API.

- `GET /v1/models`, which the dashboard already loads, says what a model can do.
  `output` is `["image"]` or `["video"]`; `supported_params.text` means it takes
  a prompt, `supported_params.edit` means it takes input images. The newer
  `/v3/models` reports the same as `architecture.input_modalities`; all 200
  models agree between the two, so no second catalogue call is needed.
  `summariseModels` already projects `output`, `text`, `edit`, `sizes`, `seconds`.
- Live counts: text → image 139, image → image 91, text → video 56, image → video
  56. Five image models take no prompt at all (background removal, upscaling).
  The only free video model is `ir/test-video`.
- Input images are sent as `image` / `image[]`: a file upload, an http(s) URL or
  a `data:` URI, up to 16. Data URIs were probed live with the free models
  `test/test` and `ir/test-video`: one and several in a JSON body, mixed with a
  file in a multipart body, with and without a prompt. All succeeded.
- `runGeneration` already implements the kinds `image`, `edit` and `video`,
  including data URI and file inputs; the MCP tools use them. Only the dashboard
  restricts itself to `image`.
- Bun's `idleTimeout` is capped at 255 s and closes a connection on which nothing
  was sent. A video call may run up to `IMAGEROUTER_VIDEO_TIMEOUT_MS` (15 min).
  `server.timeout(request, 0)` lifts the limit for one request; probed on the
  pinned Bun 1.4.2.

## Approach

Uploads travel as data URIs inside the existing JSON body of `POST /api/generate`.
`runGeneration` is called unchanged, and the route keeps requiring
`application/json`, which is part of the cross-site protection (such a request
is never a "simple" cross-origin request).

Rejected: a multipart upload (the shared generation code would have to learn
in-memory files, and the POST would no longer be JSON-only), and saving uploads
into the output directory first (it fills the gallery with input photos).

## Server

### `POST /api/generate`

New optional fields next to `prompt`, `model`, `size`, `quality`,
`output_format`, `filename`, `ephemeral`:

| Field | Type | Meaning |
|---|---|---|
| `output` | `"image"` (default) or `"video"` | What to generate |
| `seconds` | `"auto"` or a number 1–60 | Video duration, as in `generate_video` |
| `inputs` | array, at most 16 | Input images, in order |

An entry of `inputs` is exactly one of:

- `{ "saved": "<file name>" }` — a bare file name in the output directory. It
  passes the same check as `/files/:name` (`resolveSavedFile`), must be an image
  and must exist.
- `{ "data": "data:image/<png|jpeg|webp|gif>;base64,<base64>" }` — the bytes of
  an upload, at most 10 MB decoded.

The kind handed to `runGeneration` is derived, never sent: `video` when `output`
is `video`, else `edit` when `inputs` is non-empty, else `image`. `inputs` become
its `images` argument: the resolved path for a saved file, the data URI for an
upload. For a video, `quality` and `output_format` are not passed on, matching
`generate_video`.

`prompt` becomes optional. A request with neither a prompt nor an input is
rejected.

Everything above is checked before the API is called, so a rejected request is
never billed. All rejections are `400 INVALID_REQUEST`: an entry that is neither
form, a data URI of another type or over the limit, more than 16 entries, a name
that is not bare, a name of a video or a sidecar, a file that does not exist,
neither prompt nor input.

The dashboard still never takes a path from the browser: `images`, `masks` and
`output_dir` stay unknown fields and are ignored as before.

The response gains `kind`: `"image"` or `"video"`, the type of the saved file,
with the same meaning as in the gallery listing.

### Other routes

| Route | Change |
|---|---|
| `GET /api/models` | All image and video models with their flags (`output`, `text`, `edit`, `quality`, `sizes`, `seconds`, `min_price`), not image models only |
| `GET /api/status` | Adds `defaultVideoModel` |
| `GET /api/images` | Lists videos too; `total` and `spent` cover every matching file. The route keeps its name |
| `GET /files/:name` | Answers a single `Range` (`bytes=a-b`, `a-`, `-n`) with `206` and `content-range`, reading only that part of the file; sends `accept-ranges: bytes`; an unsatisfiable range is `416`; anything else it cannot parse gets the whole file |

Range support is what lets a browser seek in a video; Safari does not play one
without it.

### `serve.ts`

- The `fetch` wrapper calls `server.timeout(request, 0)` for
  `POST /api/generate` and passes the request on unchanged. The call stays
  bounded by the client's own image and video timeouts. `routes.ts` stays a pure
  `Request → Response` function.
- `maxRequestBodySize` rises from 1 MB to 64 MB. Bun answers a larger body with
  `413` before the handler runs; the UI keeps uploads below that (45 MB of files
  are 60 MB of base64) and reports a `413` as "the images are too large".

### `output.ts`

Exports the image/video classification that `listSaved` already does by
extension, so the route can tell that a saved name is an image and what kind of
file a generation produced.

## UI

`app.ts` has 548 lines. Two modules are split off and bundled through it:

- `ui/modes.ts` — pure, no DOM: the four modes, which model supports which mode,
  the storage key per mode, the mode that adds an input to a text mode, the size
  and duration choices of a model, the upload limits.
- `ui/inputs.ts` — the list of input images: adding files and gallery images,
  removing, thumbnails, and the `inputs` payload.

### Form

- **Mode switch** above the prompt: four radio buttons in a 2×2 grid, "Text →
  Image", "Image → Image", "Text → Video", "Image → Video". The mode is
  remembered in `localStorage`. Changing it never submits.
- **Model picker**: lists the models of the mode. Search and "Free models only"
  work inside the mode. The chosen model is remembered per mode; text → image
  keeps the existing key `imagerouter:model`. The configured default image model
  seeds the image modes and the default video model the video modes, each only
  where nothing is remembered. The rule of the first design holds per mode: when
  the chosen model is not offered, the first visible free model is selected, and
  with none the picker shows "Choose a model" and the form cannot be submitted.
- **Input images**, shown in the two image-input modes: a drop zone with a file
  button; pasting an image adds it too. Accepted are PNG, JPEG, WebP and GIF, at
  most 16 images, 10 MB each and 45 MB of uploads in total; a rejected file is
  named with the reason and nothing is sent. Each input shows a thumbnail with a
  remove button. The list survives a mode change and is only sent in an
  image-input mode. Without an input the form cannot be submitted in those modes.
- **Prompt**: required in the text modes, optional in the image-input modes.
- **Size**: the model's `sizes`, else the existing fallback list for images and
  `auto` for videos.
- **Quality and Format** in the image modes as today. In the video modes a
  **Seconds** select replaces them: `auto` and the model's `seconds`.
- **Price hint**: "From $X per image" or "per video".
- **Submit**: the video modes show "A video can take several minutes. Keep this
  tab open." The existing message for a lost connection stays: the request may
  have been billed, gallery and balance are refreshed.

### Result and gallery

- The result panel shows a `<video controls>` for a video, with the same badges
  and buttons; a video has no pixel size.
- The gallery lists images and videos. A video tile is a muted
  `<video preload="metadata">` with a "Video" marker and the same caption. The spend
  line reads "Spent $X.XX on N files". The search covers both.
- The details dialog plays a video, and shows "Seconds" where a record has it.
- **Use as input** in the details dialog of an image, with or without a record:
  adds it to the input list, switches a text mode to its image-input mode,
  closes the dialog and scrolls to the form. It never submits.
- **Use these settings** stays as it is: text → image records only.

### Safety

- Names and record fields still reach the DOM only through `textContent`,
  `Option` and property setters. A record's `url` is never an `href` or `src`.
- Upload previews are `blob:` URLs of the picked files; gallery previews are the
  `fileUrl` the server built.
- A `saved` name is validated by the server, whatever the browser sends.

## Left out

- Masks.
- **Use these settings** for edits and videos: the input images of a record
  cannot be restored.
- Image URLs as input.
- Quality for the four video models that support it.
- Showing more than the first file of a multi-result request, as before.

## Testing

- **Integration, dashboard** (`tests/integration/dashboard.test.ts`):
  - each mode reaches the right endpoint with the right body: a data URI as
    `image` in JSON, a saved file as `image[]` in multipart, `seconds` for video,
    no `quality`/`output_format` for video;
  - a video result is saved as `.mp4`, returned with `kind: "video"` and served;
  - every rejection listed above answers 400 and calls nothing upstream;
  - `images`, `masks` and `output_dir` are still ignored;
  - the gallery lists a video, counts it in `total` and `spent`, finds it by search;
  - `/files/:name` with a range: `206`, the right bytes and headers; `416`; a
    malformed range gets the whole file;
  - `/api/models` returns image and video models with flags; `/api/status`
    returns `defaultVideoModel`.
  The tests that pinned the images-only gallery and model list are rewritten.
- **Unit** (`tests/unit/modes.test.ts`): support per mode for each flag
  combination, including a prompt-less model; storage keys; the size and
  duration choices; the upload limits.
- **Live** (`tests/live/`): an edit from a data URI with `test/test`. A video from
  a data URI was probed by hand with `ir/test-video`; the live suite keeps to one
  video call per run because that model is rate limited.
- **By hand, in a browser**: all four modes with the free models, upload, drop,
  paste, Use as input, video playback and seeking, a narrow window.
- **Not automated**: the timeout wrapper in `serve.ts` needs a real Bun server,
  and no free model runs long enough to outlast the idle timeout. It is checked
  once with a script that starts the real dashboard against a fake client that
  answers after more than 255 s.

## Documentation

- `README.md`: the Dashboard section, including the sentence that editing and
  video are MCP-only.
- `AGENTS.md`: the Dashboard section — `inputs` and its two forms, videos in the
  gallery listing, the lifted timeout and the body limit.
