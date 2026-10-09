// No DOM in here, so vitest can run these rules under Node.

export type Output = 'image' | 'video';
export type Mode = 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video';

export interface Model {
  id: string;
  output: Output;
  text: boolean;
  edit: boolean;
  quality: boolean;
  sizes?: string[];
  seconds?: number[];
  min_price: number | null;
}

export const MODE_INFO: Record<Mode, { label: string; output: Output; takesInput: boolean }> = {
  'text-to-image': { label: 'Text → Image', output: 'image', takesInput: false },
  'image-to-image': { label: 'Image → Image', output: 'image', takesInput: true },
  'text-to-video': { label: 'Text → Video', output: 'video', takesInput: false },
  'image-to-video': { label: 'Image → Video', output: 'video', takesInput: true },
};

export const MODES = Object.keys(MODE_INFO) as Mode[];

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && Object.hasOwn(MODE_INFO, value);
}

export function supports(model: Model, mode: Mode): boolean {
  const { output, takesInput } = MODE_INFO[mode];
  return model.output === output && (takesInput ? model.edit : model.text);
}

export function inputMode(mode: Mode): Mode {
  return MODE_INFO[mode].output === 'video' ? 'image-to-video' : 'image-to-image';
}

// Text → image keeps the key it had when it was the only mode.
export function modelKey(mode: Mode): string {
  return mode === 'text-to-image' ? 'imagerouter:model' : `imagerouter:model:${mode}`;
}

export function sizesFor(model: Model | undefined, output: Output): string[] {
  if (model?.sizes?.length) return model.sizes;
  return output === 'video' ? ['auto'] : ['auto', '1024x1024', '1536x1024', '1024x1536'];
}

export function secondsFor(model: Model | undefined): string[] {
  return ['auto', ...(model?.seconds ?? []).map(String)];
}

export const MAX_INPUTS = 16;
const MB = 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * MB;
// Uploads travel as base64 in one request: 45 MB of files stay below the server's 64 MB limit.
const MAX_UPLOADS_TOTAL_BYTES = 45 * MB;
export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function uploadProblem(
  file: { name: string; type: string; size: number },
  already: { count: number; bytes: number },
): string | null {
  if (!UPLOAD_TYPES.includes(file.type))
    return `${file.name} is not a PNG, JPEG, WebP or GIF image.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is larger than 10 MB.`;
  if (already.count >= MAX_INPUTS) {
    return `${file.name} was not added: ${MAX_INPUTS} input images is the most a request takes.`;
  }
  if (already.bytes + file.size > MAX_UPLOADS_TOTAL_BYTES) {
    return `${file.name} was not added: the uploads together would be larger than 45 MB.`;
  }
  return null;
}
