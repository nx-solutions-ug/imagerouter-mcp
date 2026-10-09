import { type InputList, createInputList } from './inputs.js';
import {
  MODES,
  MODE_INFO,
  type Mode,
  type Model,
  inputMode,
  isMode,
  modelKey,
  secondsFor,
  sizesFor,
  supports,
} from './modes.js';

type MediaKind = 'image' | 'video';

// A generation record as the dashboard uses it. Records are files on disk that anyone could have
// edited, so `toRecord` re-checks every field before it reaches the DOM.
interface GenerationRecord {
  file: string;
  kind?: string;
  model: string;
  created?: string;
  prompt?: string;
  requested: { size?: string; quality?: string; output_format?: string; seconds?: string };
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
  kind?: unknown;
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
  kind: MediaKind;
  record?: unknown;
}

// What the detail view shows: an image or a video, with or without a recorded history.
interface Detail {
  name: string;
  path: string;
  fileUrl: string;
  kind: MediaKind;
  record: GenerationRecord | null;
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const usd = (value: number): string => `$${value.toFixed(value < 1 ? 4 : 2)}`;
const MODE_KEY = 'imagerouter:mode';
const SEARCH_DELAY_MS = 250;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const pixels = (width?: number, height?: number): string | undefined =>
  width && height ? `${width}×${height}` : undefined;
const mediaKind = (value: unknown): MediaKind => (value === 'video' ? 'video' : 'image');

function toRecord(value: unknown): GenerationRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const asked = (
    typeof raw.requested === 'object' && raw.requested !== null ? raw.requested : {}
  ) as Record<string, unknown>;
  return {
    file: text(raw.file) ?? '',
    kind: text(raw.kind),
    model: text(raw.model) ?? '',
    created: text(raw.created),
    prompt: text(raw.prompt),
    requested: {
      size: text(asked.size),
      quality: text(asked.quality),
      output_format: text(asked.output_format),
      seconds: asked.seconds === 'auto' ? 'auto' : amount(asked.seconds)?.toString(),
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
// Shown in place of the model hint while there are no models: loading, or why loading failed.
let modelsNote = 'Loading models…';
let mode: Mode = 'text-to-image';
// The model the user picked in each mode. Only the select's change event and a successful
// generation move it; filtering never does, so clearing the filter brings the choice back.
const chosenModel: Partial<Record<Mode, string | null>> = {};
// Counts the picks per mode, so a generation can tell whether the user chose again meanwhile.
const picks: Partial<Record<Mode, number>> = {};
let inputs: InputList;
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
    // The server refuses an oversized body before the handler runs, so there is no message.
    if (response.status === 413) {
      throw new Error('The images are too large to send. Use fewer or smaller images.');
    }
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

function priceLabel(model: Model): string {
  if (model.min_price === 0) return 'free';
  return model.min_price === null ? '' : `from ${usd(model.min_price)}`;
}

function renderModels(): void {
  const search = el<HTMLInputElement>('model-search').value.trim().toLowerCase();
  const freeOnly = el<HTMLInputElement>('free-only').checked;
  const select = el<HTMLSelectElement>('model');
  const visible = models.filter(
    (model) =>
      supports(model, mode) &&
      (!search || model.id.toLowerCase().includes(search)) &&
      (!freeOnly || model.min_price === 0),
  );
  select.replaceChildren(
    ...visible.map((model) => {
      const price = priceLabel(model);
      return new Option(price ? `${model.id} · ${price}` : model.id, model.id);
    }),
  );
  const chosen = chosenModel[mode];
  if (chosen && visible.some((model) => model.id === chosen)) {
    select.value = chosen;
  } else {
    // The chosen model is hidden by the filter or cannot do this mode. Never fall back to a paid
    // model: take the first free one, or leave the required select empty so the form cannot be
    // submitted.
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
  const { output } = MODE_INFO[mode];
  const model = models.find((candidate) => candidate.id === el<HTMLSelectElement>('model').value);
  el<HTMLSelectElement>('size').replaceChildren(
    ...sizesFor(model, output).map((size) => new Option(size, size)),
  );
  el<HTMLSelectElement>('seconds').replaceChildren(
    ...secondsFor(model).map((seconds) => new Option(seconds, seconds)),
  );
  el<HTMLSelectElement>('quality').disabled = !model?.quality;
  el('model-info').textContent = model
    ? model.min_price === 0
      ? 'Free model'
      : model.min_price === null
        ? 'Price unknown'
        : `From ${usd(model.min_price)} per ${output}`
    : el<HTMLSelectElement>('model').options.length > 1
      ? 'Choose a model'
      : models.length === 0
        ? modelsNote
        : models.some((candidate) => supports(candidate, mode))
          ? 'No model matches the filter'
          : 'No model offers this mode';
}

// Shows the fields of a mode and its models. It never submits: generating spends credits.
function setMode(next: Mode): void {
  mode = next;
  remember(MODE_KEY, next);
  const { output, takesInput } = MODE_INFO[next];
  const isVideo = output === 'video';
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.checked = radio.value === next;
  }
  el('inputs-field').classList.toggle('hidden', !takesInput);
  el('quality-field').classList.toggle('hidden', isVideo);
  el('format-field').classList.toggle('hidden', isVideo);
  el('seconds-field').classList.toggle('hidden', !isVideo);
  el('video-hint').classList.toggle('hidden', !isVideo);
  const prompt = el<HTMLTextAreaElement>('prompt');
  // Some models that take an image, such as background removal, take no prompt.
  prompt.required = !takesInput;
  prompt.placeholder = takesInput ? 'Optional for some models' : '';
  renderModels();
}

function addInputFiles(files: File[]): void {
  if (files.length === 0) return;
  el('inputs-info').textContent = inputs.addFiles(files).join(' ');
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

// Shows a saved file in the image or the video element of a pair and hides the other.
function showMedia(
  image: HTMLImageElement,
  video: HTMLVideoElement,
  media: { kind: MediaKind; fileUrl: string; name: string },
): void {
  const isVideo = media.kind === 'video';
  image.classList.toggle('hidden', isVideo);
  video.classList.toggle('hidden', !isVideo);
  video.pause();
  if (isVideo) {
    image.removeAttribute('src');
    video.src = media.fileUrl;
    video.setAttribute('aria-label', media.name);
  } else {
    video.removeAttribute('src');
    video.load();
    image.src = media.fileUrl;
    image.alt = media.name;
  }
}

function showResult(result: Generated): void {
  const kind = mediaKind(result.kind);
  el('result').classList.remove('hidden');
  showMedia(el<HTMLImageElement>('result-image'), el<HTMLVideoElement>('result-video'), {
    kind,
    fileUrl: result.fileUrl,
    name: result.name,
  });

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
          kind,
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
  description.className = wrap
    ? 'min-w-0 max-h-[30vh] overflow-y-auto whitespace-pre-wrap break-words'
    : 'min-w-0 break-words';
  description.textContent = value;
  return [term, description];
}

function openDetail(detail: Detail): void {
  const { record } = detail;
  showMedia(el<HTMLImageElement>('detail-image'), el<HTMLVideoElement>('detail-video'), detail);
  el('detail-name').textContent = detail.name;
  el<HTMLDialogElement>('detail').setAttribute('aria-label', `Details of ${detail.name}`);
  el('detail-empty').classList.toggle('hidden', record !== null);

  const rows: Array<[string, string | undefined, boolean?]> = record
    ? [
        ['Prompt', record.prompt, true],
        ['Kind', record.kind],
        ['Model', record.model],
        [
          'Size',
          record.requested.size && pixels(record.width, record.height)
            ? `${record.requested.size} → ${pixels(record.width, record.height)}`
            : (pixels(record.width, record.height) ?? record.requested.size),
        ],
        ['Quality', record.requested.quality],
        ['Format', record.requested.output_format],
        ['Seconds', record.requested.seconds],
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
  if (detail.kind === 'image') {
    actions.push(actionButton('Use as input', () => useAsInput(detail), 'btn btn-sm'));
  }
  // The form cannot reproduce the inputs of an edit or a video, so only images offer this.
  if (record && (record.kind === undefined || record.kind === 'image')) {
    actions.push(
      actionButton('Use these settings', () => useSettings(record), 'btn btn-sm btn-primary'),
    );
  }
  el('detail-actions').replaceChildren(...actions);
  el<HTMLDialogElement>('detail').showModal();
}

// Selects `value` when the select offers it, else the neutral `fallback`, else the first option.
function pick(select: HTMLSelectElement, value: string | undefined, fallback: string): void {
  const offered = (candidate: string | undefined): candidate is string =>
    candidate !== undefined && [...select.options].some((option) => option.value === candidate);
  if (offered(value)) select.value = value;
  else if (offered(fallback)) select.value = fallback;
  else select.selectedIndex = 0;
}

function backToForm(): void {
  el<HTMLDialogElement>('detail').close();
  el('generate-form').scrollIntoView({ block: 'start' });
}

// Adds a gallery image to the inputs and moves a text mode to the mode that takes them. It never
// submits: generating spends credits.
function useAsInput(detail: Detail): void {
  const refusal = inputs.addSaved(detail.name, detail.fileUrl);
  setMode(inputMode(mode));
  el('inputs-info').textContent = refusal ?? '';
  backToForm();
  el('add-inputs').focus();
}

// Loads a record into the form. It never submits: generating spends credits. Every field is set,
// to the recorded value or a neutral default, so nothing stale from an earlier choice survives.
function useSettings(record: GenerationRecord): void {
  // Only the records of this mode offer their settings.
  const target: Mode = 'text-to-image';
  el<HTMLTextAreaElement>('prompt').value = record.prompt ?? '';
  const recorded = models.find(
    (candidate) => candidate.id === record.model && supports(candidate, target),
  );
  if (recorded) {
    // Only when the filters hide the recorded model are they cleared; otherwise they stay as set.
    const search = el<HTMLInputElement>('model-search').value.trim().toLowerCase();
    const freeOnly = el<HTMLInputElement>('free-only').checked;
    if (
      (search && !recorded.id.toLowerCase().includes(search)) ||
      (freeOnly && recorded.min_price !== 0)
    ) {
      el<HTMLInputElement>('model-search').value = '';
      el<HTMLInputElement>('free-only').checked = false;
    }
    // Remembered in memory for this page only; the choice is persisted by the select's change
    // event and after a successful generation, never here.
    chosenModel[target] = recorded.id;
    picks[target] = (picks[target] ?? 0) + 1;
  }
  setMode(target);
  pick(el<HTMLSelectElement>('size'), record.requested.size, 'auto');
  pick(el<HTMLSelectElement>('quality'), record.requested.quality, 'auto');
  pick(el<HTMLSelectElement>('format'), record.requested.output_format, 'webp');
  if (!recorded) {
    el('model-info').textContent = record.model
      ? `The recorded model ${record.model} is not available. Choose another model.`
      : 'The recorded model is not available. Choose another model.';
  }
  backToForm();
  el('prompt').focus();
}

function tile(item: GalleryItem): HTMLElement {
  const record = toRecord(item.record);
  const kind = mediaKind(item.kind);
  const wrapper = document.createElement('div');
  wrapper.className = 'flex min-w-0 flex-col gap-1';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'relative aspect-square overflow-hidden rounded-box bg-base-200';
  button.setAttribute('aria-label', `Open ${item.name}`);
  if (record?.prompt) button.title = record.prompt;
  const className = 'h-full w-full object-cover transition hover:scale-105';
  if (kind === 'video') {
    const video = document.createElement('video');
    // Only the metadata is fetched, and the fragment makes the browser show a first frame.
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = `${item.fileUrl}#t=0.1`;
    video.className = className;
    const marker = document.createElement('span');
    marker.className = 'badge badge-neutral badge-sm absolute bottom-2 left-2';
    marker.textContent = 'Video';
    button.append(video, marker);
  } else {
    const image = document.createElement('img');
    image.src = item.fileUrl;
    image.alt = item.name;
    image.loading = 'lazy';
    image.className = className;
    button.append(image);
  }
  button.addEventListener('click', () =>
    openDetail({ name: item.name, path: item.path, fileUrl: item.fileUrl, kind, record }),
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
  const { items } = page;
  el('gallery-count').textContent = String(items.length);
  empty.textContent = query ? 'Nothing matches.' : 'Nothing generated yet.';
  empty.classList.toggle('hidden', items.length > 0);

  const spent = el('gallery-spent');
  const spentTotal = amount(page.spent);
  const anyCost = items.some((item) => toRecord(item.record)?.cost !== undefined);
  const matching = amount(page.total) ?? items.length;
  spent.textContent =
    spentTotal === undefined
      ? ''
      : `Spent ${spentLabel(spentTotal)} on ${matching} ${matching === 1 ? 'file' : 'files'}`;
  spent.classList.toggle('hidden', !anyCost || spentTotal === undefined);

  el('gallery').replaceChildren(...items.map(tile));
}

async function generate(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const submit = el<HTMLButtonElement>('submit');
  const error = el('error');
  error.classList.add('hidden');
  const submitted = mode;
  const { output, takesInput } = MODE_INFO[submitted];
  if (takesInput && inputs.count === 0) {
    error.textContent = 'Add at least one input image.';
    error.classList.remove('hidden');
    return;
  }
  submit.disabled = true;
  submit.innerHTML = '<span class="loading loading-spinner loading-sm"></span> Generating';
  try {
    const model = el<HTMLSelectElement>('model').value;
    const picked = picks[submitted];
    const quality = el<HTMLSelectElement>('quality');
    const seconds = el<HTMLSelectElement>('seconds').value;
    const result = await api<Generated>('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: el<HTMLTextAreaElement>('prompt').value.trim() || undefined,
        model,
        size: el<HTMLSelectElement>('size').value,
        output,
        ...(output === 'video'
          ? { seconds: seconds === 'auto' ? 'auto' : Number(seconds) }
          : {
              quality: quality.disabled ? undefined : quality.value,
              output_format: el<HTMLSelectElement>('format').value,
            }),
        ...(takesInput ? { inputs: await inputs.payload() } : {}),
      }),
    });
    // Keep a model the user picked in this mode while the request was in flight.
    if (picks[submitted] === picked) {
      chosenModel[submitted] = model;
      remember(modelKey(submitted), model);
    }
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
    if (value) {
      chosenModel[mode] = value;
      picks[mode] = (picks[mode] ?? 0) + 1;
    }
    renderModelOptions();
  });
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked && isMode(radio.value)) setMode(radio.value);
    });
  }

  inputs = createInputList(el('input-list'), () => (el('inputs-info').textContent = ''));
  const picker = el<HTMLInputElement>('input-files');
  el('add-inputs').addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    addInputFiles([...(picker.files ?? [])]);
    // Picking the same file again must fire the event again.
    picker.value = '';
  });
  // A file dropped on the page would make the browser leave it for that file. Dragged text is
  // left alone, so it can still be dropped into the prompt.
  const carriesFiles = (event: DragEvent): boolean =>
    event.dataTransfer?.types.includes('Files') ?? false;
  document.addEventListener('dragover', (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (MODE_INFO[mode].takesInput) addInputFiles([...(event.dataTransfer?.files ?? [])]);
  });
  document.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files ?? [])];
    // Pasted text still goes into the prompt.
    if (!MODE_INFO[mode].takesInput || files.length === 0) return;
    event.preventDefault();
    addInputFiles(files);
  });
  const detailVideo = el<HTMLVideoElement>('detail-video');
  el('detail').addEventListener('close', () => detailVideo.pause());
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

  interface Status {
    hasApiKey: boolean;
    outputDir: string;
    defaultImageModel: string | null;
    defaultVideoModel: string | null;
  }
  let status: Status | null = null;
  try {
    status = await api<Status>('/api/status');
  } catch (error) {
    const alert = el('error');
    alert.textContent = `Could not load status: ${(error as Error).message}`;
    alert.classList.remove('hidden');
  }
  if (status) {
    el('key-warning').classList.toggle('hidden', status.hasApiKey);
    el('gallery-dir').textContent = status.outputDir;
    if (status.hasApiKey) void loadBalance();
  }
  for (const candidate of MODES) {
    const configured =
      MODE_INFO[candidate].output === 'video'
        ? status?.defaultVideoModel
        : status?.defaultImageModel;
    if (configured && !remember(modelKey(candidate))) remember(modelKey(candidate), configured);
    chosenModel[candidate] = remember(modelKey(candidate));
  }
  const remembered = remember(MODE_KEY);
  setMode(isMode(remembered) ? remembered : 'text-to-image');

  void loadGallery();
  try {
    models = (await api<{ models: Model[] }>('/api/models')).models;
    renderModels();
  } catch (error) {
    modelsNote = `Could not load models: ${(error as Error).message}`;
    renderModelOptions();
  }
}

void init();
