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
