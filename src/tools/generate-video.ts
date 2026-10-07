import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ImageRouterError, formatToolError } from '../lib/errors.js';
import { type Deps, runGeneration } from '../lib/generation.js';
import { withProgress } from './progress.js';
import { mediaInputs, model, ok, prompt, saving, size } from './schemas.js';

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
      try {
        if (!args.prompt && !args.images?.length) {
          throw new ImageRouterError(
            'Provide a prompt, at least one image, or both.',
            'INVALID_REQUEST',
          );
        }
        return ok(await withProgress(extra, () => runGeneration(deps, 'video', args)));
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
