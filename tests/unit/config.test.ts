import { describe, expect, it } from 'vitest';
import { expandHome, resolveConfig } from '../../src/lib/config.js';

describe('resolveConfig', () => {
  it('uses spec defaults when the environment is empty', () => {
    expect(resolveConfig({}, '/home/u')).toEqual({
      apiKey: undefined,
      baseUrl: 'https://api.imagerouter.io',
      outputDir: '/home/u/Pictures/imagerouter',
      defaultImageModel: undefined,
      defaultVideoModel: undefined,
      imageTimeoutMs: 180_000,
      videoTimeoutMs: 900_000,
      dashboardPort: 4477,
    });
  });

  it('reads every variable and trims a trailing slash from the base URL', () => {
    const config = resolveConfig(
      {
        IMAGEROUTER_API_KEY: ' key ',
        IMAGEROUTER_BASE_URL: 'http://localhost:9/',
        IMAGEROUTER_OUTPUT_DIR: '~/out',
        IMAGEROUTER_DEFAULT_IMAGE_MODEL: 'a/b',
        IMAGEROUTER_DEFAULT_VIDEO_MODEL: 'c/d',
        IMAGEROUTER_IMAGE_TIMEOUT_MS: '1000',
        IMAGEROUTER_VIDEO_TIMEOUT_MS: '2000',
        IMAGEROUTER_DASHBOARD_PORT: '5000',
      },
      '/home/u',
    );
    expect(config).toEqual({
      apiKey: 'key',
      baseUrl: 'http://localhost:9',
      outputDir: '/home/u/out',
      defaultImageModel: 'a/b',
      defaultVideoModel: 'c/d',
      imageTimeoutMs: 1000,
      videoTimeoutMs: 2000,
      dashboardPort: 5000,
    });
  });

  it('treats blank strings as unset and falls back on invalid numbers', () => {
    const config = resolveConfig(
      {
        IMAGEROUTER_API_KEY: '  ',
        IMAGEROUTER_IMAGE_TIMEOUT_MS: 'abc',
        IMAGEROUTER_DASHBOARD_PORT: '-1',
      },
      '/home/u',
    );
    expect(config.apiKey).toBeUndefined();
    expect(config.imageTimeoutMs).toBe(180_000);
    expect(config.dashboardPort).toBe(4477);
  });
});

describe('expandHome', () => {
  it('expands a leading tilde only', () => {
    expect(expandHome('~/a', '/h')).toBe('/h/a');
    expect(expandHome('~', '/h')).toBe('/h');
    expect(expandHome('/x/~/a', '/h')).toBe('/x/~/a');
  });
});
