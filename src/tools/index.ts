import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from '../lib/generation.js';
import { registerEditImage } from './edit-image.js';
import { registerGenerateImage } from './generate-image.js';
import { registerGenerateVideo } from './generate-video.js';
import { registerGetCredits } from './get-credits.js';
import { registerListModels } from './list-models.js';

export function registerAllTools(server: McpServer, deps: Deps): void {
  registerGenerateImage(server, deps);
  registerEditImage(server, deps);
  registerGenerateVideo(server, deps);
  registerListModels(server, deps);
  registerGetCredits(server, deps);
}
