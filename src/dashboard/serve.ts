import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Deps } from '../lib/generation.js';
import { createDashboardHandler } from './routes.js';

export function parseDashboardArgs(
  argv: string[],
  defaultPort: number,
): { port: number; open: boolean } {
  let port = defaultPort;
  let open = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-open') {
      open = false;
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = arg === '--port' ? argv[++index] : arg.slice('--port='.length);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new Error(`Invalid port: ${raw ?? '(missing)'}`);
      }
      port = parsed;
    }
  }
  return { port, open };
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    // No browser launcher available: the URL is printed below.
  }
}

export function startDashboard(deps: Deps, options: { port: number; open: boolean }): void {
  // In the published bundle this file is inlined into dist/cli.js, next to dist/dashboard/.
  const uiDir = join(import.meta.dir, 'dashboard');
  const handler = createDashboardHandler({ deps, uiDir, port: options.port });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port,
    // Bun's maximum (seconds): image generation runs up to 180 s and must not be cut off.
    idleTimeout: 255,
    // The only POST body is a small JSON document.
    maxRequestBodySize: 1024 * 1024,
    // The Request is passed through unchanged so the handler's Host header guard sees it.
    fetch: handler,
  });
  const url = `http://127.0.0.1:${server.port}`;
  process.stdout.write(`ImageRouter dashboard: ${url}\nSaving to ${deps.config.outputDir}\n`);
  if (!deps.config.apiKey) {
    process.stdout.write('IMAGEROUTER_API_KEY is not set: generation and balance will fail.\n');
  }
  if (options.open) openBrowser(url);
}
