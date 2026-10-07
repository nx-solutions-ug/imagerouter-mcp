import { describe, expect, it } from 'vitest';
import { parseDashboardArgs } from '../../src/dashboard/serve.js';

describe('parseDashboardArgs', () => {
  it('defaults to the configured port and opening a browser', () => {
    expect(parseDashboardArgs([], 4477)).toEqual({ port: 4477, open: true });
  });

  it('reads --port in both forms and --no-open', () => {
    expect(parseDashboardArgs(['--port', '5000', '--no-open'], 4477)).toEqual({
      port: 5000,
      open: false,
    });
    expect(parseDashboardArgs(['--port=5001'], 4477)).toEqual({ port: 5001, open: true });
  });

  it('rejects an invalid port', () => {
    expect(() => parseDashboardArgs(['--port', 'abc'], 4477)).toThrow('Invalid port: abc');
    expect(() => parseDashboardArgs(['--port', '70000'], 4477)).toThrow('Invalid port: 70000');
    expect(() => parseDashboardArgs(['--port'], 4477)).toThrow('Invalid port');
  });

  it('rejects unknown options instead of ignoring them', () => {
    expect(() => parseDashboardArgs(['--no-opne'], 4477)).toThrow('Unknown option: --no-opne');
    expect(() => parseDashboardArgs(['--port', '5000', 'extra'], 4477)).toThrow(
      'Unknown option: extra',
    );
  });
});
