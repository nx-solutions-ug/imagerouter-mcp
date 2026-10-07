import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { expandHome } from './config.js';
import { ImageRouterError } from './errors.js';
import type { RequestBody } from './imagerouter-client.js';

export function isRemoteInput(value: string): boolean {
  return /^(https?:\/\/|data:)/i.test(value);
}

async function fileBlob(input: string): Promise<File> {
  const path = resolve(expandHome(input));
  const info = await stat(path).catch(() => null);
  if (!info) throw new ImageRouterError(`Input file not found: ${input}`, 'LOCAL_ERROR');
  if (!info.isFile()) throw new ImageRouterError(`Input ${input} is not a file`, 'LOCAL_ERROR');
  return new File([await readFile(path)], basename(path));
}

export async function buildRequestBody(
  fields: Record<string, string | number | undefined>,
  images: string[] = [],
  masks: string[] = [],
): Promise<RequestBody> {
  const defined = Object.entries(fields).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  const groups: Array<[string, string[]]> = [
    ['image', images],
    ['mask', masks],
  ];

  if ([...images, ...masks].every(isRemoteInput)) {
    const json: Record<string, unknown> = Object.fromEntries(defined);
    for (const [name, values] of groups) {
      if (values.length === 1) json[name] = values[0];
      else if (values.length > 1) json[name] = values;
    }
    return { json };
  }

  const form = new FormData();
  for (const [name, value] of defined) form.set(name, String(value));
  for (const [name, values] of groups) {
    for (const value of values) {
      form.append(`${name}[]`, isRemoteInput(value) ? value : await fileBlob(value));
    }
  }
  return { form };
}
