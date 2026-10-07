import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type GenerationRecord,
  metadataPath,
  readRecord,
  writeRecord,
} from '../../src/lib/metadata.js';

const record = (overrides: Partial<GenerationRecord> = {}): GenerationRecord => ({
  version: 1,
  file: 'fox.jpg',
  kind: 'image',
  created: '2026-10-07T12:00:00.000Z',
  model: 'test/test',
  prompt: 'a fox',
  requested: { size: '1024x1024', quality: 'high', output_format: 'jpeg' },
  width: 640,
  height: 480,
  bytes: 1234,
  cost: 0.004,
  latency_ms: 321,
  url: 'https://cdn.test/fox.jpg',
  ephemeral: false,
  ...overrides,
});

async function dir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ir-meta-'));
}

async function sidecar(contents: string): Promise<string> {
  const target = join(await dir(), 'fox.jpg');
  await writeFile(metadataPath(target), contents);
  return target;
}

describe('metadata records', () => {
  it('puts the sidecar next to the media file', () => {
    expect(metadataPath('/a/b/fox.jpg')).toBe('/a/b/fox.jpg.json');
  });

  it('round-trips a record and writes pretty JSON with a trailing newline', async () => {
    const target = join(await dir(), 'fox.jpg');
    const path = await writeRecord(target, record({ index: 0, count: 2 }));
    expect(path).toBe(`${target}.json`);
    const text = await readFile(path!, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "version": 1,');
    expect(await readRecord(target)).toEqual(record({ index: 0, count: 2 }));
  });

  it('never throws and returns null when the sidecar cannot be written', async () => {
    const missing = join(await dir(), 'does', 'not', 'exist', 'fox.jpg');
    await expect(writeRecord(missing, record())).resolves.toBeNull();
    const blocked = join(await dir(), 'fox.jpg');
    await mkdir(metadataPath(blocked)); // a directory where the file should go
    await expect(writeRecord(blocked, record())).resolves.toBeNull();
  });

  it('never writes a data URI to disk', async () => {
    const target = join(await dir(), 'fox.jpg');
    const huge = `data:image/png;base64,${'A'.repeat(100_000)}`;
    await writeRecord(
      target,
      record({
        kind: 'edit',
        inputs: { images: [huge, 'photo.png', 'https://x.test/a.png'], masks: [huge] },
      }),
    );
    const text = await readFile(metadataPath(target), 'utf8');
    expect(text.length).toBeLessThan(2000);
    expect(JSON.parse(text).inputs).toEqual({
      images: ['data-uri', 'photo.png', 'https://x.test/a.png'],
      masks: ['data-uri'],
    });
  });

  it('returns null for a missing, unreadable or invalid file', async () => {
    expect(await readRecord(join(await dir(), 'none.jpg'))).toBeNull();
    expect(await readRecord(await sidecar('{not json'))).toBeNull();
    expect(await readRecord(await sidecar(''))).toBeNull();
    expect(await readRecord(await sidecar('[]'))).toBeNull();
    expect(await readRecord(await sidecar('null'))).toBeNull();
    expect(await readRecord(await sidecar('"text"'))).toBeNull();
    const unreadable = join(await dir(), 'fox.jpg');
    await mkdir(metadataPath(unreadable));
    expect(await readRecord(unreadable)).toBeNull();
  });

  it('returns null for a wrong version or wrong required fields', async () => {
    const base = record();
    expect(await readRecord(await sidecar(JSON.stringify({ ...base, version: 2 })))).toBeNull();
    expect(await readRecord(await sidecar(JSON.stringify({ ...base, version: '1' })))).toBeNull();
    expect(await readRecord(await sidecar(JSON.stringify({ ...base, model: 5 })))).toBeNull();
    expect(await readRecord(await sidecar(JSON.stringify({ ...base, kind: 'audio' })))).toBeNull();
    expect(await readRecord(await sidecar(JSON.stringify({ ...base, bytes: 'big' })))).toBeNull();
  });

  it('drops optional fields of the wrong type and keeps the rest', async () => {
    const hostile = {
      ...record(),
      prompt: { evil: true },
      width: '640',
      height: -1,
      cost: 'free',
      latency_ms: null,
      url: 42,
      index: 1.5,
      count: [],
      requested: { size: 5, quality: 'high', seconds: 'soon' },
      inputs: { images: ['a.png', 7, null], masks: 'm.png' },
      extra: 'ignored',
    };
    const read = await readRecord(await sidecar(JSON.stringify(hostile)));
    expect(read).toEqual({
      version: 1,
      file: 'fox.jpg',
      kind: 'image',
      created: '2026-10-07T12:00:00.000Z',
      model: 'test/test',
      requested: { quality: 'high' },
      bytes: 1234,
      ephemeral: false,
      inputs: { images: ['a.png'] },
    });
    expect(read).not.toHaveProperty('extra');
  });

  it('keeps seconds as a number or "auto"', async () => {
    const read = await readRecord(
      await sidecar(JSON.stringify(record({ kind: 'video', requested: { seconds: 'auto' } }))),
    );
    expect(read?.requested.seconds).toBe('auto');
    const numeric = await readRecord(
      await sidecar(JSON.stringify(record({ kind: 'video', requested: { seconds: 8 } }))),
    );
    expect(numeric?.requested.seconds).toBe(8);
  });

  it('treats a record that is not an object of the right shape as missing requested', async () => {
    const read = await readRecord(await sidecar(JSON.stringify({ ...record(), requested: 'x' })));
    expect(read?.requested).toEqual({});
  });

  it('refuses an absurdly large sidecar', async () => {
    const target = await sidecar(JSON.stringify({ ...record(), prompt: 'x'.repeat(2_000_000) }));
    expect(await readRecord(target)).toBeNull();
  });

  it('truncates long strings on read instead of rejecting the record', async () => {
    const read = await readRecord(
      await sidecar(
        JSON.stringify({
          ...record(),
          prompt: 'p'.repeat(30_000),
          model: 'm'.repeat(5000),
          file: 'f'.repeat(5000),
          requested: { size: 's'.repeat(5000) },
          inputs: { images: ['i'.repeat(5000)] },
        }),
      ),
    );
    expect(read?.prompt).toHaveLength(20_000);
    expect(read?.model).toHaveLength(2048);
    expect(read?.file).toHaveLength(2048);
    expect(read?.requested.size).toHaveLength(2048);
    expect(read?.inputs?.images?.[0]).toHaveLength(2048);
  });

  it('requires a non-empty model', async () => {
    expect(await readRecord(await sidecar(JSON.stringify({ ...record(), model: '' })))).toBeNull();
  });

  it('keeps only http(s) URLs', async () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'ftp://x/a',
      'cdn.test/a.png',
      '',
    ]) {
      const read = await readRecord(await sidecar(JSON.stringify({ ...record(), url })));
      expect({ url, parsed: read !== null }).toEqual({ url, parsed: true });
      expect(read).not.toHaveProperty('url');
    }
    for (const url of ['http://cdn.test/a.png', 'HTTPS://cdn.test/a.png']) {
      expect((await readRecord(await sidecar(JSON.stringify({ ...record(), url }))))?.url).toBe(
        url,
      );
    }
  });

  it('writes atomically and leaves no temporary file behind', async () => {
    const folder = await dir();
    const target = join(folder, 'fox.jpg');
    await writeRecord(target, record());
    await writeRecord(target, record({ prompt: 'again' }));
    expect(await readdir(folder)).toEqual(['fox.jpg.json']);
    expect((await readRecord(target))?.prompt).toBe('again');
  });

  it('removes the temporary file when the sidecar cannot be put in place', async () => {
    const folder = await dir();
    const target = join(folder, 'fox.jpg');
    await mkdir(metadataPath(target)); // rename onto a directory fails
    await expect(writeRecord(target, record())).resolves.toBeNull();
    expect(await readdir(folder)).toEqual(['fox.jpg.json']);
  });

  it('uses a temporary name that cannot be mistaken for media or collide', async () => {
    const folder = await dir();
    const seen = new Set<string>();
    // Observe the temporary names through the directory while writes are in flight.
    const target = join(folder, 'fox.jpg');
    const writes = Array.from({ length: 20 }, () => writeRecord(target, record()));
    for (let round = 0; round < 5; round += 1) {
      for (const name of await readdir(folder)) seen.add(name);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all(writes);
    const others = [...seen].filter((name) => name !== 'fox.jpg.json');
    expect(others.every((name) => name.endsWith('.tmp'))).toBe(true);
    expect((await readdir(folder)).toSorted()).toEqual(['fox.jpg.json']);
    expect(await readRecord(target)).not.toBeNull();
  });
});
