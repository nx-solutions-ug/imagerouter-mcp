import { describe, expect, it } from 'vitest';
import {
  MODES,
  type Mode,
  type Model,
  uploadProblem,
  inputMode,
  isMode,
  modelKey,
  secondsFor,
  sizesFor,
  supports,
} from '../../src/dashboard/ui/modes.js';

const model = (over: Partial<Model> = {}): Model => ({
  id: 'm',
  output: 'image',
  text: true,
  edit: false,
  quality: false,
  min_price: 0,
  ...over,
});
const MB = 1024 * 1024;

describe('modes', () => {
  it('lists the four modes in the order of the switch', () => {
    expect(MODES).toEqual(['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video']);
  });

  it('offers a model only in the modes it can do', () => {
    const cases: Array<[Partial<Model>, Mode[]]> = [
      [{ output: 'image', text: true, edit: false }, ['text-to-image']],
      [{ output: 'image', text: true, edit: true }, ['text-to-image', 'image-to-image']],
      [{ output: 'image', text: false, edit: true }, ['image-to-image']],
      [{ output: 'image', text: false, edit: false }, []],
      [{ output: 'video', text: true, edit: false }, ['text-to-video']],
      [{ output: 'video', text: true, edit: true }, ['text-to-video', 'image-to-video']],
      [{ output: 'video', text: false, edit: true }, ['image-to-video']],
    ];
    for (const [flags, expected] of cases) {
      const offered = MODES.filter((mode) => supports(model(flags), mode));
      expect([flags, offered]).toEqual([flags, expected]);
    }
  });

  it('recognises a stored mode and nothing else', () => {
    expect(isMode('image-to-video')).toBe(true);
    for (const value of ['video', '', null, undefined, 3, 'toString']) {
      expect([value, isMode(value)]).toEqual([value, false]);
    }
  });

  it('moves a text mode to the mode that takes an image and leaves the others', () => {
    expect(inputMode('text-to-image')).toBe('image-to-image');
    expect(inputMode('image-to-image')).toBe('image-to-image');
    expect(inputMode('text-to-video')).toBe('image-to-video');
    expect(inputMode('image-to-video')).toBe('image-to-video');
  });

  it('remembers the model per mode and keeps the old key for text to image', () => {
    expect(modelKey('text-to-image')).toBe('imagerouter:model');
    expect(modelKey('image-to-image')).toBe('imagerouter:model:image-to-image');
    expect(modelKey('text-to-video')).toBe('imagerouter:model:text-to-video');
    expect(modelKey('image-to-video')).toBe('imagerouter:model:image-to-video');
  });

  it('offers the sizes of the model, else a neutral list for the output', () => {
    expect(sizesFor(model({ sizes: ['1280x720', '720x1280'] }), 'video')).toEqual([
      '1280x720',
      '720x1280',
    ]);
    expect(sizesFor(model(), 'image')).toEqual(['auto', '1024x1024', '1536x1024', '1024x1536']);
    expect(sizesFor(model({ sizes: [] }), 'image')).toEqual([
      'auto',
      '1024x1024',
      '1536x1024',
      '1024x1536',
    ]);
    expect(sizesFor(undefined, 'image')).toEqual(['auto', '1024x1024', '1536x1024', '1024x1536']);
    expect(sizesFor(model({ output: 'video' }), 'video')).toEqual(['auto']);
    expect(sizesFor(undefined, 'video')).toEqual(['auto']);
  });

  it('offers auto before the durations of the model', () => {
    expect(secondsFor(model({ seconds: [4, 6, 8] }))).toEqual(['auto', '4', '6', '8']);
    expect(secondsFor(model({ seconds: [2.5] }))).toEqual(['auto', '2.5']);
    expect(secondsFor(model())).toEqual(['auto']);
    expect(secondsFor(undefined)).toEqual(['auto']);
  });
});

describe('uploadProblem', () => {
  const none = { count: 0, bytes: 0 };
  const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
    name: 'photo.png',
    type: 'image/png',
    size: 1000,
    ...over,
  });

  it('accepts the four image types', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect([type, uploadProblem(file({ type }), none)]).toEqual([type, null]);
    }
  });

  it('names the file and the reason when it refuses one', () => {
    expect(uploadProblem(file({ name: 'a.svg', type: 'image/svg+xml' }), none)).toBe(
      'a.svg is not a PNG, JPEG, WebP or GIF image.',
    );
    expect(uploadProblem(file({ name: 'a.mp4', type: 'video/mp4' }), none)).toBe(
      'a.mp4 is not a PNG, JPEG, WebP or GIF image.',
    );
    expect(uploadProblem(file({ name: 'notype', type: '' }), none)).toBe(
      'notype is not a PNG, JPEG, WebP or GIF image.',
    );
    expect(uploadProblem(file({ name: 'big.png', size: 10 * MB + 1 }), none)).toBe(
      'big.png is larger than 10 MB.',
    );
    expect(uploadProblem(file({ name: 'empty.png', size: 0 }), none)).toBe('empty.png is empty.');
  });

  it('accepts a file of exactly 10 MB', () => {
    expect(uploadProblem(file({ size: 10 * MB }), none)).toBeNull();
  });

  it('stops at sixteen inputs', () => {
    expect(uploadProblem(file(), { count: 15, bytes: 0 })).toBeNull();
    expect(uploadProblem(file({ name: 'one-more.png' }), { count: 16, bytes: 0 })).toBe(
      'one-more.png was not added: 16 input images is the most a request takes.',
    );
  });

  it('stops when the uploads together pass 45 MB', () => {
    expect(uploadProblem(file({ size: 5 * MB }), { count: 4, bytes: 40 * MB })).toBeNull();
    expect(
      uploadProblem(file({ name: 'last.png', size: 5 * MB + 1 }), { count: 4, bytes: 40 * MB }),
    ).toBe('last.png was not added: the uploads together would be larger than 45 MB.');
  });
});
