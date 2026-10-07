import { readFile, stat, writeFile } from 'node:fs/promises';
import type { GenerationKind } from './types.js';

export interface GenerationRecord {
  version: 1;
  /** Bare filename of the media file. */
  file: string;
  kind: GenerationKind;
  /** ISO 8601. */
  created: string;
  /** The resolved model, including a default. */
  model: string;
  prompt?: string;
  requested: { size?: string; quality?: string; output_format?: string; seconds?: number | 'auto' };
  /** Actual pixels, read from the saved bytes. */
  width?: number;
  height?: number;
  /** File size. */
  bytes: number;
  /** USD, for the whole request: every result of a multi-result request carries the same value. */
  cost?: number;
  latency_ms?: number;
  /** Hosted URL; absent for ephemeral requests. */
  url?: string;
  ephemeral: boolean;
  /** As given; data URIs are replaced by the literal "data-uri". */
  inputs?: { images?: string[]; masks?: string[] };
  /** Position within a multi-result request, 0-based. */
  index?: number;
  /** Number of results in that request. */
  count?: number;
}

// A record is a handful of fields; anything bigger is not one of ours.
const MAX_RECORD_BYTES = 1_000_000;
const KINDS: readonly string[] = ['image', 'edit', 'video'];

export function metadataPath(mediaPath: string): string {
  return `${mediaPath}.json`;
}

function redactInputs(values: string[] | undefined): string[] | undefined {
  return values?.map((value) => (/^data:/i.test(value) ? 'data-uri' : value));
}

// Best-effort by contract: the generation was already billed, so a sidecar problem is reported
// as `null` and never propagates.
export async function writeRecord(
  mediaPath: string,
  record: GenerationRecord,
): Promise<string | null> {
  try {
    const inputs = record.inputs
      ? {
          ...(record.inputs.images ? { images: redactInputs(record.inputs.images) } : {}),
          ...(record.inputs.masks ? { masks: redactInputs(record.inputs.masks) } : {}),
        }
      : undefined;
    const safe = { ...record, ...(inputs ? { inputs } : {}) };
    const path = metadataPath(mediaPath);
    await writeFile(path, `${JSON.stringify(safe, null, 2)}\n`);
    return path;
  } catch {
    return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const whole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const strings = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter((entry): entry is string => typeof entry === 'string');
  return kept.length > 0 ? kept : undefined;
};

// Only defined values survive, so a dropped field is simply absent.
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

// Sidecars are plain files that anyone could have edited: every field is validated, optional
// fields of the wrong type are dropped, and a record missing a required field is not one.
function parseRecord(raw: unknown): GenerationRecord | null {
  if (!isObject(raw) || raw.version !== 1) return null;
  const file = text(raw.file);
  const created = text(raw.created);
  const model = text(raw.model);
  const bytes = count(raw.bytes);
  if (
    file === undefined ||
    created === undefined ||
    model === undefined ||
    bytes === undefined ||
    typeof raw.kind !== 'string' ||
    !KINDS.includes(raw.kind) ||
    typeof raw.ephemeral !== 'boolean'
  ) {
    return null;
  }

  const asked = isObject(raw.requested) ? raw.requested : {};
  const seconds = asked.seconds === 'auto' ? 'auto' : count(asked.seconds);
  const inputs = isObject(raw.inputs)
    ? compact({ images: strings(raw.inputs.images), masks: strings(raw.inputs.masks) })
    : {};

  const record: GenerationRecord = {
    version: 1,
    file,
    kind: raw.kind as GenerationKind,
    created,
    model,
    requested: compact({
      size: text(asked.size),
      quality: text(asked.quality),
      output_format: text(asked.output_format),
      seconds,
    }),
    bytes,
    ephemeral: raw.ephemeral,
    ...compact({
      prompt: text(raw.prompt),
      width: whole(raw.width),
      height: whole(raw.height),
      cost: count(raw.cost),
      latency_ms: count(raw.latency_ms),
      url: text(raw.url),
      index: whole(raw.index),
      count: whole(raw.count),
      inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
    }),
  };
  return record;
}

export async function readRecord(mediaPath: string): Promise<GenerationRecord | null> {
  try {
    const path = metadataPath(mediaPath);
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_RECORD_BYTES) return null;
    return parseRecord(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}
