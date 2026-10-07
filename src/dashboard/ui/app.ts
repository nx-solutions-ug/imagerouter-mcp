interface Model {
  id: string;
  quality: boolean;
  sizes?: string[];
  min_price: number | null;
}

interface Generated {
  name: string;
  path: string;
  fileUrl: string;
  url?: string;
  model: string;
  cost?: number;
  latency_ms?: number;
}

interface GalleryItem {
  name: string;
  fileUrl: string;
  kind: 'image' | 'video';
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const usd = (value: number): string => `$${value.toFixed(value < 1 ? 4 : 2)}`;
const MODEL_KEY = 'imagerouter:model';

let models: Model[] = [];
// The model the user picked. Only the select's change event and a successful generation move it;
// filtering never does, so clearing the filter brings the choice back.
let chosenModel: string | null = null;

class NetworkError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    throw new NetworkError((error as Error).message);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  return body as T;
}

function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function loadBalance(): Promise<void> {
  try {
    const credits = await api<{ remaining_credits: number; credit_usage: number }>('/api/credits');
    el('balance').textContent = usd(credits.remaining_credits);
    el('usage').textContent = `${usd(credits.credit_usage)} used`;
  } catch (error) {
    el('balance').textContent = '–';
    el('usage').textContent = (error as Error).message;
  }
}

function renderModels(): void {
  const search = el<HTMLInputElement>('model-search').value.trim().toLowerCase();
  const freeOnly = el<HTMLInputElement>('free-only').checked;
  const select = el<HTMLSelectElement>('model');
  const visible = models.filter(
    (model) =>
      (!search || model.id.toLowerCase().includes(search)) && (!freeOnly || model.min_price === 0),
  );
  select.replaceChildren(
    ...visible.map((model) => {
      const price =
        model.min_price === 0
          ? 'free'
          : model.min_price === null
            ? ''
            : `from ${usd(model.min_price)}`;
      return new Option(price ? `${model.id} · ${price}` : model.id, model.id);
    }),
  );
  if (chosenModel && visible.some((model) => model.id === chosenModel)) {
    select.value = chosenModel;
  } else {
    // The chosen model is hidden by the filter. Never fall back to a paid model: take the first
    // free one, or leave the required select empty so the form cannot be submitted.
    const free = visible.find((model) => model.min_price === 0);
    if (free) {
      select.value = free.id;
    } else {
      const placeholder = new Option('Choose a model', '', true, true);
      placeholder.disabled = true;
      select.prepend(placeholder);
      select.value = '';
    }
  }
  renderModelOptions();
}

function renderModelOptions(): void {
  const model = models.find((candidate) => candidate.id === el<HTMLSelectElement>('model').value);
  const sizes = model?.sizes?.length
    ? model.sizes
    : ['auto', '1024x1024', '1536x1024', '1024x1536'];
  el<HTMLSelectElement>('size').replaceChildren(...sizes.map((size) => new Option(size, size)));
  el<HTMLSelectElement>('quality').disabled = !model?.quality;
  el('model-info').textContent = model
    ? model.min_price === 0
      ? 'Free model'
      : model.min_price === null
        ? 'Price unknown'
        : `From ${usd(model.min_price)} per image`
    : el<HTMLSelectElement>('model').options.length > 1
      ? 'Choose a model'
      : 'No model matches the filter';
}

function showResult(result: Generated): void {
  el('result').classList.remove('hidden');
  const image = el<HTMLImageElement>('result-image');
  image.src = result.fileUrl;
  image.alt = result.name;

  const meta = el('result-meta');
  const badge = (text: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = 'badge badge-outline';
    span.textContent = text;
    return span;
  };
  const copy = (label: string, value: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-xs';
    button.textContent = label;
    button.title = value;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Copy failed';
      }
      setTimeout(() => (button.textContent = label), 1200);
    });
    return button;
  };
  meta.replaceChildren(
    badge(result.model),
    ...(result.cost === undefined ? [] : [badge(usd(result.cost))]),
    ...(result.latency_ms === undefined
      ? []
      : [badge(`${(result.latency_ms / 1000).toFixed(1)} s`)]),
    copy('Copy path', result.path),
    ...(result.url ? [copy('Copy URL', result.url)] : []),
  );
}

// Never rejects: a failed refresh is reported in the gallery area, not as a generation error.
async function loadGallery(): Promise<void> {
  const empty = el('gallery-empty');
  let page: { total: number; items: GalleryItem[] };
  try {
    page = await api<{ total: number; items: GalleryItem[] }>('/api/images?limit=60');
  } catch (error) {
    empty.textContent = `Could not load the gallery: ${(error as Error).message}`;
    empty.classList.remove('hidden');
    return;
  }
  const images = page.items.filter((item) => item.kind === 'image');
  el('gallery-count').textContent = String(images.length);
  empty.textContent = 'Nothing generated yet.';
  empty.classList.toggle('hidden', images.length > 0);
  el('gallery').replaceChildren(
    ...images.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'aspect-square overflow-hidden rounded-box bg-base-200';
      button.setAttribute('aria-label', `Open ${item.name}`);
      const image = document.createElement('img');
      image.src = item.fileUrl;
      image.alt = item.name;
      image.loading = 'lazy';
      image.className = 'h-full w-full object-cover transition hover:scale-105';
      button.append(image);
      button.addEventListener('click', () => {
        el<HTMLImageElement>('lightbox-image').src = item.fileUrl;
        el('lightbox-name').textContent = item.name;
        el<HTMLDialogElement>('lightbox').showModal();
      });
      return button;
    }),
  );
}

async function generate(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const submit = el<HTMLButtonElement>('submit');
  const error = el('error');
  error.classList.add('hidden');
  submit.disabled = true;
  submit.innerHTML = '<span class="loading loading-spinner loading-sm"></span> Generating';
  try {
    const model = el<HTMLSelectElement>('model').value;
    const quality = el<HTMLSelectElement>('quality');
    const result = await api<Generated>('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: el<HTMLTextAreaElement>('prompt').value,
        model,
        size: el<HTMLSelectElement>('size').value,
        quality: quality.disabled ? undefined : quality.value,
        output_format: el<HTMLSelectElement>('format').value,
      }),
    });
    chosenModel = model;
    remember(MODEL_KEY, model);
    showResult(result);
    await Promise.all([loadGallery(), loadBalance()]);
  } catch (caught) {
    if (caught instanceof NetworkError) {
      // The request may have reached ImageRouter and been billed even though no answer came back.
      error.textContent =
        'The connection to the dashboard was lost before an answer arrived. The request may still have completed and been billed; the gallery and balance are refreshed below, check them before trying again.';
      await Promise.all([loadGallery(), loadBalance()]);
    } else {
      error.textContent = (caught as Error).message;
    }
    error.classList.remove('hidden');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Generate';
  }
}

async function init(): Promise<void> {
  el('generate-form').addEventListener('submit', (event) => void generate(event as SubmitEvent));
  // Enter in a filter control must never submit the form: submitting spends credits.
  for (const id of ['model-search', 'free-only']) {
    el(id).addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') event.preventDefault();
    });
  }
  el('model-search').addEventListener('input', renderModels);
  el('free-only').addEventListener('change', renderModels);
  el('model').addEventListener('change', () => {
    const value = el<HTMLSelectElement>('model').value;
    if (value) chosenModel = value;
    renderModelOptions();
  });
  el('refresh-balance').addEventListener('click', () => void loadBalance());

  let status: { hasApiKey: boolean; outputDir: string; defaultImageModel: string | null } | null =
    null;
  try {
    status = await api<{ hasApiKey: boolean; outputDir: string; defaultImageModel: string | null }>(
      '/api/status',
    );
  } catch (error) {
    const alert = el('error');
    alert.textContent = `Could not load status: ${(error as Error).message}`;
    alert.classList.remove('hidden');
  }
  if (status) {
    el('key-warning').classList.toggle('hidden', status.hasApiKey);
    el('gallery-dir').textContent = status.outputDir;
    if (status.defaultImageModel && !remember(MODEL_KEY)) {
      remember(MODEL_KEY, status.defaultImageModel);
    }
    if (status.hasApiKey) void loadBalance();
  }
  chosenModel = remember(MODEL_KEY);

  void loadGallery();
  try {
    models = (await api<{ models: Model[] }>('/api/models')).models;
    renderModels();
  } catch (error) {
    el('model-info').textContent = `Could not load models: ${(error as Error).message}`;
  }
}

void init();
