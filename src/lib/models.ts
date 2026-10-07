import type { ModelSummary, RawCatalogue, RawModel } from './types.js';

export interface ModelFilters {
  output?: 'image' | 'video';
  supports_edit?: boolean;
  supports_mask?: boolean;
  free_only?: boolean;
  search?: string;
  limit?: number;
}

function minPrice(model: RawModel): number | null {
  const prices = (model.providers ?? [])
    .map((provider) => provider.pricing?.value ?? provider.pricing?.range?.min)
    .filter((price): price is number => typeof price === 'number');
  return prices.length > 0 ? Math.min(...prices) : null;
}

function summarise(id: string, model: RawModel): ModelSummary {
  const params = model.supported_params ?? {
    text: false,
    edit: false,
    mask: false,
    quality: false,
  };
  return {
    id,
    output: model.output?.includes('video') ? 'video' : 'image',
    text: Boolean(params.text),
    edit: Boolean(params.edit),
    mask: Boolean(params.mask),
    quality: Boolean(params.quality),
    ...(model.sizes ? { sizes: model.sizes } : {}),
    ...(model.seconds ? { seconds: model.seconds } : {}),
    min_price: minPrice(model),
    ...(model.release_date ? { release_date: model.release_date } : {}),
  };
}

export function summariseModels(
  raw: RawCatalogue,
  filters: ModelFilters = {},
): { total: number; returned: number; models: ModelSummary[] } {
  const search = filters.search?.toLowerCase();
  const matches = Object.entries(raw)
    .map(([id, model]) => summarise(id, model))
    .filter((model) => !filters.output || model.output === filters.output)
    .filter((model) => !filters.supports_edit || model.edit)
    .filter((model) => !filters.supports_mask || model.mask)
    .filter((model) => !filters.free_only || model.min_price === 0)
    .filter((model) => !search || model.id.toLowerCase().includes(search))
    .toSorted(
      (a, b) =>
        (b.release_date ?? '').localeCompare(a.release_date ?? '') || a.id.localeCompare(b.id),
    );
  const models = matches.slice(0, filters.limit ?? 50);
  return { total: matches.length, returned: models.length, models };
}
