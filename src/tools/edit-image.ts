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
        prompt: prompt
          .optional()
          .describe('The change to make. Some models, such as background removal, take none.'),
        masks: mediaInputs
          .optional()
          .describe('Optional masks for models with mask support. Same input forms as images.'),
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
