export type GenerationKind = 'image' | 'edit' | 'video';
export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type OutputFormat = 'webp' | 'jpeg' | 'png';

export interface Config {
  apiKey?: string;
  baseUrl: string;
  outputDir: string;
  defaultImageModel?: string;
  defaultVideoModel?: string;
  imageTimeoutMs: number;
  videoTimeoutMs: number;
  dashboardPort: number;
}

export interface GenerationResponse {
  created?: number;
  data: Array<{ url?: string; b64_json?: string }>;
  latency?: number;
  cost?: number;
}

export interface RawProvider {
  id: string;
  pricing?: {
    type?: string;
    value?: number;
    range?: { min: number; average?: number; max: number };
  };
}

export interface RawModel {
  providers: RawProvider[];
  output: Array<'image' | 'video'>;
  supported_params: { text: boolean; mask: boolean; quality: boolean; edit: boolean };
  sizes?: string[];
  seconds?: number[];
  default_seconds?: number;
  release_date?: string;
}

export type RawCatalogue = Record<string, RawModel>;

export interface ModelSummary {
  id: string;
  output: 'image' | 'video';
  text: boolean;
  edit: boolean;
  mask: boolean;
  quality: boolean;
  sizes?: string[];
  seconds?: number[];
  min_price: number | null;
  release_date?: string;
}

export interface Credits {
  remaining_credits: number;
  credit_usage: number;
  total_deposits: number;
}

export interface SavedFile {
  path: string;
  url?: string;
  /** Actual pixels, read from the saved bytes; absent for video and unrecognised formats. */
  width?: number;
  height?: number;
  /** The sidecar record next to the file; absent when it could not be written. */
  metadata_path?: string;
}

export interface GenerationResult {
  path: string;
  url?: string;
  model: string;
  cost?: number;
  latency_ms?: number;
  /** Dimensions and sidecar path of the first file. */
  width?: number;
  height?: number;
  metadata_path?: string;
  files?: SavedFile[];
}
