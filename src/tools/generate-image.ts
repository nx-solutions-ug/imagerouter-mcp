import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatToolError } from '../lib/errors.js';
import { type Deps, runGeneration } from '../lib/generation.js';
import { model, ok, outputFormat, prompt, quality, saving, size } from './schemas.js';
import { withProgress } from './progress.js';

export function registerGenerateImage(server: McpServer, deps: Deps): void {
  server.registerTool(
    'generate_image',
    {
      description:
        'Generate an image from a text prompt through ImageRouter. Saves the image to disk and returns its path, the hosted URL (valid 30 days, publicly reachable), cost in USD, latency and the actual width and height. Also writes a metadata file (<image>.json: prompt, model, size, cost) next to the image and returns its path as metadata_path. Spends credits unless the model is free.',
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
    async (args, extra) => {
      try {
        return ok(await withProgress(extra, () => runGeneration(deps, 'image', args)));
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
