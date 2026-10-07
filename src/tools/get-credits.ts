import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatToolError } from '../lib/errors.js';
import type { Deps } from '../lib/generation.js';
import { ok } from './schemas.js';

export function registerGetCredits(server: McpServer, deps: Deps): void {
  server.registerTool(
    'get_credits',
    {
      description:
        'Get the ImageRouter account balance in USD: remaining credits, usage and total deposits.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await deps.client.getCredits());
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
