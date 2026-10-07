export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_CREDITS'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT'
  | 'API_ERROR'
  | 'LOCAL_ERROR';

export class ImageRouterError extends Error {
  code: ErrorCode;
  statusCode: number;
  retryAfter?: number;

  constructor(message: string, code: ErrorCode, statusCode = 0, retryAfter?: number) {
    super(message);
    this.name = 'ImageRouterError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

function codeForStatus(status: number): ErrorCode {
  if (status === 400 || status === 422) return 'INVALID_REQUEST';
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 402) return 'INSUFFICIENT_CREDITS';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'API_ERROR';
}

async function apiMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string };
    if (typeof body.error === 'string') return body.error;
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `HTTP ${response.status} ${response.statusText}`.trim();
}

export async function errorFromResponse(response: Response): Promise<ImageRouterError> {
  const code = codeForStatus(response.status);
  let message = await apiMessage(response);
  let retryAfter: number | undefined;

  if (code === 'UNAUTHORIZED') message += '. Check IMAGEROUTER_API_KEY.';
  if (code === 'RATE_LIMITED') {
    const parsed = Number(response.headers.get('retry-after'));
    if (response.headers.has('retry-after') && Number.isFinite(parsed)) {
      retryAfter = parsed;
      message += ` Retry after ${parsed} seconds.`;
    }
  }
  return new ImageRouterError(message, code, response.status, retryAfter);
}

export function formatToolError(error: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const text =
    error instanceof ImageRouterError
      ? `${error.code}: ${error.message}`
      : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: 'text', text }], isError: true };
}
