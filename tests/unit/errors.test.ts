import { describe, expect, it } from 'vitest';
import { ImageRouterError, errorFromResponse, formatToolError } from '../../src/lib/errors.js';
import { json } from '../helpers/fake-fetch.js';

describe('errorFromResponse', () => {
  it.each([
    [400, 'INVALID_REQUEST'],
    [422, 'INVALID_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'UNAUTHORIZED'],
    [402, 'INSUFFICIENT_CREDITS'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
    [418, 'API_ERROR'],
  ])('maps %i to %s and keeps the API message', async (status, code) => {
    const error = await errorFromResponse(json({ error: { message: 'boom', type: 'x' } }, status));
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
    expect(error.message).toContain('boom');
  });

  it('reads Retry-After on 429', async () => {
    const error = await errorFromResponse(
      json({ error: { message: 'slow' } }, 429, { 'retry-after': '12' }),
    );
    expect(error.retryAfter).toBe(12);
    expect(error.message).toContain('12');
  });

  it('falls back to the status when the body is not JSON', async () => {
    const error = await errorFromResponse(
      new Response('<html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.message).toContain('502');
  });

  it('names the env var on 401', async () => {
    const error = await errorFromResponse(json({ error: { message: 'bad token' } }, 401));
    expect(error.message).toContain('IMAGEROUTER_API_KEY');
  });
});

describe('formatToolError', () => {
  it('returns the message without a stack for known errors', () => {
    const result = formatToolError(new ImageRouterError('nope', 'NOT_FOUND', 404));
    expect(result).toEqual({ content: [{ type: 'text', text: 'NOT_FOUND: nope' }], isError: true });
  });

  it('wraps unknown errors', () => {
    expect(formatToolError(new Error('x')).content[0].text).toBe('Unexpected error: x');
    expect(formatToolError('y').content[0].text).toBe('Unexpected error: y');
  });
});
