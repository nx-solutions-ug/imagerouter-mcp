#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseDashboardArgs, startDashboard } from './dashboard/serve.js';
import { resolveConfig } from './lib/config.js';
import { ImageRouterClient } from './lib/imagerouter-client.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const HELP = `imagerouter-mcp ${VERSION}

Usage:
  imagerouter-mcp                 Start the MCP server on stdio
  imagerouter-mcp dashboard       Open the local dashboard
      --port <n>                  Port (default 4477 or IMAGEROUTER_DASHBOARD_PORT)
      --no-open                   Do not open a browser
  imagerouter-mcp --version
  imagerouter-mcp --help

Environment: IMAGEROUTER_API_KEY (required for generation), IMAGEROUTER_OUTPUT_DIR,
IMAGEROUTER_DEFAULT_IMAGE_MODEL, IMAGEROUTER_DEFAULT_VIDEO_MODEL.
`;

async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const config = resolveConfig();
  const deps = { config, client: new ImageRouterClient(config) };

  if (argv[0] === 'dashboard') {
    startDashboard(deps, parseDashboardArgs(argv.slice(1), config.dashboardPort));
    return;
  }
  if (argv[0] !== undefined) {
    process.stderr.write(`Unknown command: ${argv[0]}\n\n${HELP}`);
    process.exit(1);
  }

  if (!config.apiKey) {
    process.stderr.write(
      'imagerouter-mcp: IMAGEROUTER_API_KEY is not set; only list_models will work.\n',
    );
  }
  await createServer(deps).connect(new StdioServerTransport());
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
