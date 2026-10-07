import { basename, resolve } from 'node:path';
import { expandHome } from './config.js';
import { readDimensions } from './dimensions.js';
import { ImageRouterError } from './errors.js';
import type { ImageRouterClient } from './imagerouter-client.js';
import { buildRequestBody } from './inputs.js';
import { type GenerationRecord, writeRecord } from './metadata.js';
import { buildFilename, ensureWritableDir, extensionFor, saveBytes } from './output.js';
import type {
  Config,
  GenerationKind,
  GenerationResponse,
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

// The request is already billed once `generate` returns, so a failure while fetching or saving
// results must say where everything that was produced can still be found.
function recoveryError(
  cause: unknown,
  entries: GenerationResponse['data'],
  saved: SavedFile[],
): ImageRouterError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const urls = entries.flatMap((entry) => (entry.url ? [entry.url] : []));
  const parts = [reason];
  if (urls.length > 0) {
    parts.push(`Generated results stay available for 30 days at: ${urls.join(', ')}`);
  }
  if (saved.length > 0) {
    parts.push(`Already saved: ${saved.map((file) => file.path).join(', ')}`);
  }
  if (urls.length === 0 && saved.length === 0) {
    parts.push('This was an ephemeral request, so the result cannot be fetched again.');
  }
  return new ImageRouterError(parts.join(' '), 'LOCAL_ERROR');
}

// Dimensions and sidecar for one saved file. The request is already billed, so nothing in here
// may fail the generation: any problem leaves the optional fields out.
async function describeSaved(options: {
  path: string;
  bytes: Uint8Array;
  url?: string;
  kind: GenerationKind;
  model: string;
  args: GenerationArgs;
  cost?: number;
  latency?: number;
  index: number;
  count: number;
}): Promise<Pick<SavedFile, 'width' | 'height' | 'metadata_path'>> {
  try {
    const { args, bytes, path, url } = options;
    const isVideo = options.kind === 'video';
    const size = readDimensions(bytes);
    const inputs = {
      ...(args.images?.length ? { images: args.images } : {}),
      ...(args.masks?.length ? { masks: args.masks } : {}),
    };
    const record: GenerationRecord = {
      version: 1,
      file: basename(path),
      kind: options.kind,
      created: new Date().toISOString(),
      model: options.model,
      ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
      requested: {
        ...(args.size === undefined ? {} : { size: args.size }),
        ...(args.quality === undefined || isVideo ? {} : { quality: args.quality }),
        ...(args.output_format === undefined || isVideo
          ? {}
          : { output_format: args.output_format }),
        ...(args.seconds === undefined || !isVideo ? {} : { seconds: args.seconds }),
      },
      ...size,
      bytes: bytes.length,
      ...(options.cost === undefined ? {} : { cost: options.cost }),
      ...(options.latency === undefined ? {} : { latency_ms: options.latency }),
      ...(url ? { url } : {}),
      ephemeral: Boolean(args.ephemeral),
      ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
      ...(options.count > 1 ? { index: options.index, count: options.count } : {}),
    };
    const metadataPath = await writeRecord(path, record);
    return { ...size, ...(metadataPath ? { metadata_path: metadataPath } : {}) };
  } catch {
    return {};
  }
}

export async function runGeneration(
  deps: Deps,
  kind: GenerationKind,
  args: GenerationArgs,
): Promise<GenerationResult> {
  const { config, client } = deps;
  const model = resolveModel(config, kind, args.model);
  // Fail on an unusable destination before the request is billed.
  const dir = resolve(expandHome(args.output_dir ?? config.outputDir));
  await ensureWritableDir(dir);
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

  const fallback = kind === 'video' ? 'mp4' : (args.output_format ?? 'webp');
  const files: SavedFile[] = [];
  try {
    for (const entry of entries) {
      let bytes: Uint8Array;
      let extension: string;
      if (entry.url) {
        const file = await client.download(entry.url);
        bytes = file.bytes;
        extension = extensionFor({
          contentType: file.contentType,
          url: entry.url,
          bytes,
          fallback,
        });
      } else {
        bytes = new Uint8Array(Buffer.from(entry.b64_json as string, 'base64'));
        extension = extensionFor({ bytes, fallback });
      }
      const name = buildFilename({ prompt: args.prompt, filename: args.filename, extension });
      const path = await saveBytes(dir, name, bytes);
      const described = await describeSaved({
        path,
        bytes,
        url: entry.url,
        kind,
        model,
        args,
        cost: response.cost,
        latency: response.latency,
        index: files.length,
        count: entries.length,
      });
      files.push({ path, ...(entry.url ? { url: entry.url } : {}), ...described });
    }
  } catch (error) {
    throw recoveryError(error, entries, files);
  }

  return {
    ...files[0]!,
    model,
    ...(response.cost === undefined ? {} : { cost: response.cost }),
    ...(response.latency === undefined ? {} : { latency_ms: response.latency }),
    ...(files.length > 1 ? { files } : {}),
  };
}
