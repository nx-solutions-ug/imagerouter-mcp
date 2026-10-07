import { ImageRouterError, errorFromResponse } from './errors.js';
import type { Config, Credits, GenerationKind, GenerationResponse, RawCatalogue } from './types.js';

export type RequestBody = { json: Record<string, unknown> } | { form: FormData };

const GENERATION_PATHS: Record<GenerationKind, string> = {
  image: '/v1/openai/images/generations',
  edit: '/v1/openai/images/edits',
  video: '/v1/openai/videos/generations',
};

const READ_TIMEOUT_MS = 30_000;

export class ImageRouterClient {
  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;

  constructor(config: Config, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async generate(kind: GenerationKind, body: RequestBody): Promise<GenerationResponse> {
    const timeout = kind === 'video' ? this.config.videoTimeoutMs : this.config.imageTimeoutMs;
    const headers = this.authHeaders();
    let payload: BodyInit;
    if ('json' in body) {
      headers.set('content-type', 'application/json');
      payload = JSON.stringify(body.json);
    } else {
      payload = body.form;
    }
    const response = await this.request(
      `${this.config.baseUrl}${GENERATION_PATHS[kind]}`,
      { method: 'POST', headers, body: payload },
      timeout,
    );
    return (await response.json()) as GenerationResponse;
  }

  async listModels(): Promise<RawCatalogue> {
    const response = await this.request(`${this.config.baseUrl}/v1/models`, {}, READ_TIMEOUT_MS);
    return (await response.json()) as RawCatalogue;
  }

  async getCredits(): Promise<Credits> {
    const response = await this.request(
      `${this.config.baseUrl}/v1/credits`,
      { headers: this.authHeaders() },
      READ_TIMEOUT_MS,
    );
    const raw = (await response.json()) as Record<string, unknown>;
    return {
      remaining_credits: Number(raw.remaining_credits ?? 0),
      credit_usage: Number(raw.credit_usage ?? 0),
      total_deposits: Number(raw.total_deposits ?? 0),
    };
  }

  async download(url: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    try {
      const response = await this.request(url, {}, this.config.videoTimeoutMs);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type'),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ImageRouterError(
        `The result was generated but could not be downloaded from ${url} (${reason}). It stays available at that URL for 30 days.`,
        'LOCAL_ERROR',
      );
    }
  }

  private authHeaders(): Headers {
    if (!this.config.apiKey) {
      throw new ImageRouterError(
        'No API key configured. Set IMAGEROUTER_API_KEY (create one at https://imagerouter.io/api-keys).',
        'UNAUTHORIZED',
        401,
      );
    }
    return new Headers({ authorization: `Bearer ${this.config.apiKey}` });
  }

  private async request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal });
    } catch (error) {
      if (signal.aborted) {
        throw new ImageRouterError(
          `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
          'TIMEOUT',
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ImageRouterError(
        `Cannot reach ${new URL(url).host}: ${reason}`,
        'CONNECTION_ERROR',
      );
    }
    if (!response.ok) throw await errorFromResponse(response);
    return response;
  }
}
