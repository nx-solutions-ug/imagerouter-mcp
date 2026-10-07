import { resolve } from 'node:path';
import { expandHome } from './config.js';
import { ImageRouterError } from './errors.js';
import type { ImageRouterClient } from './imagerouter-client.js';
import { buildRequestBody } from './inputs.js';
import { buildFilename, extensionFor, saveBytes } from './output.js';
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
  try {
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
