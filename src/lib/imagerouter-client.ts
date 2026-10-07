import { ImageRouterError, errorFromResponse } from './errors.js';
import type { Config, Credits, GenerationKind, GenerationResponse, RawCatalogue } from './types.js';

export type RequestBody = { json: Record<string, unknown> } | { form: FormData };

const GENERATION_PATHS: Record<GenerationKind, string> = {
  image: '/v1/openai/images/generations',
  edit: '/v1/openai/images/edits',
  video: '/v1/openai/videos/generations',
};

const READ_TIMEOUT_MS = 30_000;
const BILLING_NOTE =
  'The request may still complete and be billed. Check get_credits before retrying.';

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
    const { read } = await this.request(
      `${this.config.baseUrl}${GENERATION_PATHS[kind]}`,
      { method: 'POST', headers, body: payload },
      timeout,
      true,
    );
    return read((r) => r.json() as Promise<GenerationResponse>);
  }

  async listModels(): Promise<RawCatalogue> {
    const { read } = await this.request(`${this.config.baseUrl}/v1/models`, {}, READ_TIMEOUT_MS);
    return read((r) => r.json() as Promise<RawCatalogue>);
  }

  async getCredits(): Promise<Credits> {
    const { read } = await this.request(
      `${this.config.baseUrl}/v1/credits`,
      { headers: this.authHeaders() },
      READ_TIMEOUT_MS,
    );
    const raw = await read((r) => r.json() as Promise<Record<string, unknown>>);
    return {
      remaining_credits: Number(raw.remaining_credits ?? 0),
      credit_usage: Number(raw.credit_usage ?? 0),
      total_deposits: Number(raw.total_deposits ?? 0),
    };
  }

  async download(url: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    try {
      const { response, read } = await this.request(url, {}, this.config.videoTimeoutMs);
      const bytes = await read(async (r) => new Uint8Array(await r.arrayBuffer()));
      return { bytes, contentType: response.headers.get('content-type') };
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

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    billed = false,
  ): Promise<{ response: Response; read: <T>(parse: (r: Response) => Promise<T>) => Promise<T> }> {
    const signal = AbortSignal.timeout(timeoutMs);
    const suffix = billed ? ` ${BILLING_NOTE}` : '';
    const transportError = (error: unknown): ImageRouterError => {
      if (signal.aborted) {
        return new ImageRouterError(
          `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.${suffix}`,
          'TIMEOUT',
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      return new ImageRouterError(
        `Cannot reach ${new URL(url).host}: ${reason}${suffix}`,
        'CONNECTION_ERROR',
      );
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal });
    } catch (error) {
      throw transportError(error);
    }
    if (!response.ok) throw await errorFromResponse(response);

    const read = async <T>(parse: (r: Response) => Promise<T>): Promise<T> => {
      try {
        return await parse(response);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new ImageRouterError(
            `ImageRouter returned a response that is not valid JSON.${suffix}`,
            'API_ERROR',
            response.status,
          );
        }
        throw transportError(error);
      }
    };
    return { response, read };
  }
}
