import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Config } from './types.js';

type Env = Record<string, string | undefined>;

export function expandHome(path: string, home: string = homedir()): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const parsed = Number(text(env, name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveConfig(env: Env = process.env, home: string = homedir()): Config {
  const outputDir = text(env, 'IMAGEROUTER_OUTPUT_DIR') ?? '~/Pictures/imagerouter';
  return {
    apiKey: text(env, 'IMAGEROUTER_API_KEY'),
    baseUrl: (text(env, 'IMAGEROUTER_BASE_URL') ?? 'https://api.imagerouter.io').replace(
      /\/+$/,
      '',
    ),
    outputDir: resolve(expandHome(outputDir, home)),
    defaultImageModel: text(env, 'IMAGEROUTER_DEFAULT_IMAGE_MODEL'),
    defaultVideoModel: text(env, 'IMAGEROUTER_DEFAULT_VIDEO_MODEL'),
    imageTimeoutMs: positiveInt(env, 'IMAGEROUTER_IMAGE_TIMEOUT_MS', 180_000),
    videoTimeoutMs: positiveInt(env, 'IMAGEROUTER_VIDEO_TIMEOUT_MS', 900_000),
    dashboardPort: positiveInt(env, 'IMAGEROUTER_DASHBOARD_PORT', 4477),
  };
}
