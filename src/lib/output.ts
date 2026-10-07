import { randomBytes } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { ImageRouterError } from './errors.js';

export const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov']);
const UNSAFE_FILENAME_CHARACTERS = new Set('<>:"|?*');

function normalise(extension: string | undefined): string | undefined {
  const clean = extension?.toLowerCase().replace(/^\./, '');
  if (clean === 'jpeg') return 'jpg';
  return clean && clean in MEDIA_TYPES ? clean : undefined;
}

export function extensionFor(options: {
  contentType?: string | null;
  url?: string;
  fallback: string;
}): string {
  const mime = options.contentType?.split(';')[0].trim().toLowerCase();
  const fromType = Object.entries(MEDIA_TYPES).find(([, type]) => type === mime)?.[0];
  if (fromType) return fromType;

  if (options.url) {
    try {
      const fromUrl = normalise(extname(new URL(options.url).pathname));
      if (fromUrl) return fromUrl;
    } catch {
      // Not a URL: use the fallback.
    }
  }
  return normalise(options.fallback) ?? 'bin';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function stripUnsafeCharacters(value: string): string {
  return [...value]
    .filter((char) => (char.codePointAt(0) ?? 0) > 0x1f && !UNSAFE_FILENAME_CHARACTERS.has(char))
    .join('');
}

function isBareFilename(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    name === basename(name) &&
    !name.includes('\\') &&
    !name.includes('\0')
  );
}

export function buildFilename(options: {
  prompt?: string;
  filename?: string;
  extension: string;
  now?: Date;
  suffix?: string;
}): string {
  const extension = /^[a-z0-9]+$/.test(options.extension) ? options.extension : 'bin';
  if (options.filename) {
    const base = basename(options.filename.replaceAll('\\', '/'));
    const stem = stripUnsafeCharacters(base.slice(0, base.length - extname(base).length));
    if (stem && stem !== '.' && stem !== '..') return `${stem}.${extension}`;
  }

  const now = options.now ?? new Date();
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = (options.prompt ?? '')
    .slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = options.suffix ?? randomBytes(2).toString('hex');
  return [stamp, slug, suffix].filter(Boolean).join('-') + `.${extension}`;
}

export async function saveBytes(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  if (!isBareFilename(name)) {
    throw new ImageRouterError(`Refusing to save to unsafe file name ${name}.`, 'LOCAL_ERROR');
  }
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  try {
    await mkdir(dir, { recursive: true });
    for (let attempt = 0; ; attempt += 1) {
      const path = join(dir, attempt === 0 ? name : `${stem}-${attempt}${extension}`);
      try {
        await writeFile(path, bytes, { flag: 'wx' });
        return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new ImageRouterError(`Cannot write to output directory ${dir} (${code}).`, 'LOCAL_ERROR');
  }
}

export interface SavedEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
  kind: 'image' | 'video';
}

export async function listSaved(
  dir: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ total: number; items: SavedEntry[] }> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: Array<SavedEntry & { time: number }> = [];
  for (const name of names) {
    const extension = normalise(extname(name));
    if (!extension) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info?.isFile()) continue;
    entries.push({
      name,
      path: join(dir, name),
      size: info.size,
      modified: info.mtime.toISOString(),
      kind: VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image',
      time: info.mtimeMs,
    });
  }
  entries.sort((a, b) => b.time - a.time || a.name.localeCompare(b.name));
  const offset = options.offset ?? 0;
  const items = entries
    .slice(offset, offset + (options.limit ?? 60))
    .map(({ time: _time, ...entry }) => entry);
  return { total: entries.length, items };
}

export function resolveSavedFile(dir: string, name: string): string | null {
  if (!isBareFilename(name)) return null;
  return normalise(extname(name)) ? join(dir, name) : null;
}
