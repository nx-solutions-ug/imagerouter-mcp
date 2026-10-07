import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Deps } from './lib/generation.js';
import { registerAllTools } from './tools/index.js';
import { VERSION } from './version.js';

export function createServer(deps: Deps): McpServer {
  const server = new McpServer({ name: 'imagerouter-mcp', version: VERSION });
  registerAllTools(server, deps);
  return server;
}
