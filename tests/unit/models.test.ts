import { describe, expect, it } from 'vitest';
import { summariseModels } from '../../src/lib/models.js';
import type { RawCatalogue } from '../../src/lib/types.js';

const params = (edit: boolean, mask: boolean) => ({ text: true, mask, quality: true, edit });

const raw: RawCatalogue = {
  'a/paid': {
    providers: [
      { id: 'p1', pricing: { type: 'post_generation', value: 0.04 } },
      {
        id: 'p2',
        pricing: { type: 'post_generation', range: { min: 0.01, average: 0.02, max: 0.05 } },
      },
    ],
    output: ['image'],
    supported_params: params(true, true),
    sizes: ['1024x1024'],
    release_date: '2025-01-01',
  },
  'a/free:free': {
    providers: [{ id: 'p1', pricing: { type: 'fixed', value: 0 } }],
    output: ['image'],
    supported_params: params(false, false),
    release_date: '2026-01-01',
  },
  'v/clip': {
    providers: [{ id: 'p1', pricing: { type: 'fixed', value: 0.5 } }],
    output: ['video'],
    supported_params: params(true, false),
    seconds: [5, 10],
    release_date: '2025-06-01',
  },
  'z/undated': {
    providers: [{ id: 'p1' }],
    output: ['image'],
    supported_params: params(false, false),
  },
};

describe('summariseModels', () => {
  it('projects compactly, newest first, undated last', () => {
    const result = summariseModels(raw);
    expect(result.total).toBe(4);
    expect(result.models.map((model) => model.id)).toEqual([
      'a/free:free',
      'v/clip',
      'a/paid',
      'z/undated',
    ]);
    expect(result.models[2]).toEqual({
      id: 'a/paid',
      output: 'image',
      text: true,
      edit: true,
      mask: true,
      quality: true,
      sizes: ['1024x1024'],
      min_price: 0.01,
      release_date: '2025-01-01',
    });
    expect(result.models[3]!.min_price).toBeNull();
    expect(result.models[1]!.seconds).toEqual([5, 10]);
  });

  it('applies each filter', () => {
    const ids = (filters: Parameters<typeof summariseModels>[1]) =>
      summariseModels(raw, filters).models.map((model) => model.id);
    expect(ids({ output: 'video' })).toEqual(['v/clip']);
    expect(ids({ supports_edit: true })).toEqual(['v/clip', 'a/paid']);
    expect(ids({ supports_mask: true })).toEqual(['a/paid']);
    expect(ids({ free_only: true })).toEqual(['a/free:free']);
    expect(ids({ search: 'FREE' })).toEqual(['a/free:free']);
  });

  it('limits what is returned but reports the full match count', () => {
    const result = summariseModels(raw, { limit: 2 });
    expect(result.total).toBe(4);
    expect(result.returned).toBe(2);
    expect(result.models).toHaveLength(2);
  });
});
