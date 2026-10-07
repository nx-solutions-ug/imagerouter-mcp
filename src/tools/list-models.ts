import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatToolError } from '../lib/errors.js';
import type { Deps } from '../lib/generation.js';
import { summariseModels } from '../lib/models.js';
import { ok } from './schemas.js';

export function registerListModels(server: McpServer, deps: Deps): void {
  server.registerTool(
    'list_models',
    {
      description:
        'List ImageRouter models with capabilities and lowest price in USD, newest first. Filter before reading: there are about 200. Works without an API key.',
      inputSchema: z.object({
        output: z.enum(['image', 'video']).optional(),
        supports_edit: z.boolean().optional().describe('Only models usable with edit_image.'),
        supports_mask: z.boolean().optional(),
        free_only: z.boolean().optional().describe('Only models that cost nothing.'),
        search: z.string().optional().describe('Case-insensitive substring of the model id.'),
        limit: z.number().int().min(1).max(300).optional().describe('Default 50.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(summariseModels(await deps.client.listModels(), args));
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
