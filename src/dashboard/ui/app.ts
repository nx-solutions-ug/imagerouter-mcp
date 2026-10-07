interface Model {
  id: string;
  quality: boolean;
  sizes?: string[];
  min_price: number | null;
}

// A generation record as the dashboard uses it. Records are files on disk that anyone could have
// edited, so `toRecord` re-checks every field before it reaches the DOM.
interface GenerationRecord {
  file: string;
  model: string;
  created?: string;
  prompt?: string;
  requested: { size?: string; quality?: string; output_format?: string };
  width?: number;
  height?: number;
  cost?: number;
  latency_ms?: number;
  url?: string;
}

interface Generated {
  name: string;
  path: string;
  fileUrl: string;
  url?: string;
  model: string;
  cost?: number;
  latency_ms?: number;
  width?: number;
  height?: number;
  record?: unknown;
}

interface GalleryItem {
  name: string;
  path: string;
  fileUrl: string;
  kind: 'image' | 'video';
  record?: unknown;
}

// What the detail view shows: an image, with or without a recorded history.
interface Detail {
  name: string;
  path: string;
  fileUrl: string;
  record: GenerationRecord | null;
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const usd = (value: number): string => `$${value.toFixed(value < 1 ? 4 : 2)}`;
const MODEL_KEY = 'imagerouter:model';
const SEARCH_DELAY_MS = 250;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const pixels = (width?: number, height?: number): string | undefined =>
  width && height ? `${width}×${height}` : undefined;

function toRecord(value: unknown): GenerationRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const asked = (
    typeof raw.requested === 'object' && raw.requested !== null ? raw.requested : {}
  ) as Record<string, unknown>;
  return {
    file: text(raw.file) ?? '',
    model: text(raw.model) ?? '',
    created: text(raw.created),
    prompt: text(raw.prompt),
    requested: {
      size: text(asked.size),
      quality: text(asked.quality),
      output_format: text(asked.output_format),
    },
    width: amount(raw.width),
    height: amount(raw.height),
    cost: amount(raw.cost),
    latency_ms: amount(raw.latency_ms),
    url: text(raw.url),
  };
}

// "$0.0040" for fractions of a cent, "$1.25" otherwise.
const spentLabel = (value: number): string =>
  value > 0 && value < 0.01 ? usd(value) : `$${value.toFixed(2)}`;

let models: Model[] = [];
// The model the user picked. Only the select's change event and a successful generation move it;
// filtering never does, so clearing the filter brings the choice back.
let chosenModel: string | null = null;
let galleryRun = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

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

function copyButton(label: string, value: string, className = 'btn btn-xs'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
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
}

function actionButton(label: string, onClick: () => void, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function showResult(result: Generated): void {
  el('result').classList.remove('hidden');
  const image = el<HTMLImageElement>('result-image');
  image.src = result.fileUrl;
  image.alt = result.name;

  const badge = (label: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = 'badge badge-outline';
    span.textContent = label;
    return span;
  };
  const size = pixels(result.width, result.height);
  el('result-meta').replaceChildren(
    badge(result.model),
    ...(size ? [badge(size)] : []),
    ...(result.cost === undefined ? [] : [badge(usd(result.cost))]),
    ...(result.latency_ms === undefined
      ? []
      : [badge(`${(result.latency_ms / 1000).toFixed(1)} s`)]),
    actionButton(
      'Details',
      () =>
        openDetail({
          name: result.name,
          path: result.path,
          fileUrl: result.fileUrl,
          record: toRecord(result.record),
        }),
      'btn btn-xs',
    ),
    copyButton('Copy path', result.path),
    ...(result.url ? [copyButton('Copy URL', result.url)] : []),
  );
}

function detailRow(label: string, value: string, wrap = false): HTMLElement[] {
  const term = document.createElement('dt');
  term.className = 'opacity-60';
  term.textContent = label;
  const description = document.createElement('dd');
  description.className = wrap ? 'min-w-0 whitespace-pre-wrap break-words' : 'min-w-0 break-words';
  description.textContent = value;
  return [term, description];
}

function openDetail(detail: Detail): void {
  const { record } = detail;
  const image = el<HTMLImageElement>('detail-image');
  image.src = detail.fileUrl;
  image.alt = detail.name;
  el('detail-name').textContent = detail.name;
  el<HTMLDialogElement>('detail').setAttribute('aria-label', `Details of ${detail.name}`);
  el('detail-empty').classList.toggle('hidden', record !== null);

  const rows: Array<[string, string | undefined, boolean?]> = record
    ? [
        ['Prompt', record.prompt, true],
        ['Model', record.model],
        [
          'Size',
          record.requested.size && pixels(record.width, record.height)
            ? `${record.requested.size} → ${pixels(record.width, record.height)}`
            : (pixels(record.width, record.height) ?? record.requested.size),
        ],
        ['Quality', record.requested.quality],
        ['Format', record.requested.output_format],
        ['Cost', record.cost === undefined ? undefined : usd(record.cost)],
        [
          'Latency',
          record.latency_ms === undefined
            ? undefined
            : `${(record.latency_ms / 1000).toFixed(1)} s`,
        ],
        [
          'Created',
          record.created && !Number.isNaN(Date.parse(record.created))
            ? new Date(record.created).toLocaleString()
            : undefined,
        ],
        ['File', detail.name],
      ]
    : [];
  el('detail-list').replaceChildren(
    ...rows.flatMap(([label, value, wrap]) => (value ? detailRow(label, value, wrap) : [])),
  );

  const actions: HTMLElement[] = [];
  if (record) {
    if (record.prompt) actions.push(copyButton('Copy prompt', record.prompt, 'btn btn-sm'));
  }
  actions.push(copyButton('Copy path', detail.path, 'btn btn-sm'));
  // A URL from a record is only ever copied, never followed.
  if (record?.url) actions.push(copyButton('Copy URL', record.url, 'btn btn-sm'));
  if (record) {
    actions.push(
      actionButton('Use these settings', () => useSettings(record), 'btn btn-sm btn-primary'),
    );
  }
  el('detail-actions').replaceChildren(...actions);
  el<HTMLDialogElement>('detail').showModal();
}

function pick(select: HTMLSelectElement, value: string | undefined): void {
  if (value && [...select.options].some((option) => option.value === value)) select.value = value;
}

// Loads a record into the form. It never submits: generating spends credits.
function useSettings(record: GenerationRecord): void {
  if (record.prompt) el<HTMLTextAreaElement>('prompt').value = record.prompt;
  const available = models.some((candidate) => candidate.id === record.model);
  if (available) {
    // Clear the filters so the recorded model is certain to be in the list.
    el<HTMLInputElement>('model-search').value = '';
    el<HTMLInputElement>('free-only').checked = false;
    chosenModel = record.model;
    remember(MODEL_KEY, record.model);
  }
  renderModels();
  pick(el<HTMLSelectElement>('size'), record.requested.size);
  pick(el<HTMLSelectElement>('quality'), record.requested.quality);
  pick(el<HTMLSelectElement>('format'), record.requested.output_format);
  if (!available) {
    el('model-info').textContent = record.model
      ? `The recorded model ${record.model} is not available. Choose another model.`
      : 'The recorded model is not available. Choose another model.';
  }
  el<HTMLDialogElement>('detail').close();
  el('prompt').focus();
  el('generate-form').scrollIntoView({ block: 'start' });
}

function tile(item: GalleryItem): HTMLElement {
  const record = toRecord(item.record);
  const wrapper = document.createElement('div');
  wrapper.className = 'flex min-w-0 flex-col gap-1';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'aspect-square overflow-hidden rounded-box bg-base-200';
  button.setAttribute('aria-label', `Open ${item.name}`);
  if (record?.prompt) button.title = record.prompt;
  const image = document.createElement('img');
  image.src = item.fileUrl;
  image.alt = item.name;
  image.loading = 'lazy';
  image.className = 'h-full w-full object-cover transition hover:scale-105';
  button.append(image);
  button.addEventListener('click', () =>
    openDetail({ name: item.name, path: item.path, fileUrl: item.fileUrl, record }),
  );
  wrapper.append(button);

  if (record) {
    const caption = document.createElement('div');
    caption.className = 'px-1 text-xs leading-tight';
    const model = document.createElement('div');
    model.className = 'truncate font-medium';
    model.textContent = record.model;
    model.title = record.model;
    caption.append(model);
    const size = pixels(record.width, record.height);
    if (size) {
      const dimensions = document.createElement('div');
      dimensions.className = 'opacity-60';
      dimensions.textContent = size;
      caption.append(dimensions);
    }
    wrapper.append(caption);
  }
  return wrapper;
}

// Never rejects: a failed refresh is reported in the gallery area, not as a generation error.
async function loadGallery(): Promise<void> {
  const run = ++galleryRun;
  const query = el<HTMLInputElement>('gallery-search').value.trim();
  const empty = el('gallery-empty');
  let page: { total: number; spent?: number; items: GalleryItem[] };
  try {
    page = await api<typeof page>(`/api/images?limit=60&q=${encodeURIComponent(query)}`);
  } catch (error) {
    if (run !== galleryRun) return;
    empty.textContent = `Could not load the gallery: ${(error as Error).message}`;
    empty.classList.remove('hidden');
    return;
  }
  // A newer search or refresh superseded this answer.
  if (run !== galleryRun) return;
  const images = page.items.filter((item) => item.kind === 'image');
  el('gallery-count').textContent = String(images.length);
  empty.textContent = query ? 'No images match.' : 'Nothing generated yet.';
  empty.classList.toggle('hidden', images.length > 0);

  const spent = el('gallery-spent');
  const spentTotal = amount(page.spent);
  const anyCost = images.some((item) => toRecord(item.record)?.cost !== undefined);
  spent.textContent =
    spentTotal === undefined ? '' : `Spent ${spentLabel(spentTotal)} on these images`;
  spent.classList.toggle('hidden', !anyCost || spentTotal === undefined);

  el('gallery').replaceChildren(...images.map(tile));
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
  const search = el<HTMLInputElement>('gallery-search');
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadGallery(), SEARCH_DELAY_MS);
  });
  search.addEventListener('keydown', (event) => {
    // Never submit the generate form from here; Enter just searches now.
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      clearTimeout(searchTimer);
      void loadGallery();
    }
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
