import { MAX_INPUTS, uploadProblem } from './modes.js';

export type InputPayload = { saved: string } | { data: string };

interface Entry {
  label: string;
  preview: string;
  file?: File;
  saved?: string;
}

function readDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result as string));
    reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

type Refusal = string;

export interface InputList {
  readonly count: number;
  addFiles(files: File[]): Refusal[];
  addSaved(name: string, fileUrl: string): Refusal | null;
  payload(): Promise<InputPayload[]>;
}

export function createInputList(list: HTMLElement, onChange: () => void): InputList {
  let entries: Entry[] = [];

  function remove(entry: Entry): void {
    entries = entries.filter((candidate) => candidate !== entry);
    if (entry.file) URL.revokeObjectURL(entry.preview);
    render();
  }

  function thumbnail(entry: Entry): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'relative';
    const image = document.createElement('img');
    image.src = entry.preview;
    image.alt = entry.label;
    image.title = entry.label;
    image.className = 'h-16 w-16 rounded-box bg-base-200 object-cover';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-circle btn-neutral btn-xs absolute -right-1 -top-1';
    button.textContent = '✕';
    button.setAttribute('aria-label', `Remove ${entry.label}`);
    button.addEventListener('click', () => remove(entry));
    wrapper.append(image, button);
    return wrapper;
  }

  function render(): void {
    list.replaceChildren(...entries.map(thumbnail));
    list.classList.toggle('hidden', entries.length === 0);
    list.classList.toggle('flex', entries.length > 0);
    onChange();
  }

  return {
    get count() {
      return entries.length;
    },
    addFiles(files) {
      const refusals: Refusal[] = [];
      for (const file of files) {
        const uploads = entries.flatMap((entry) => (entry.file ? [entry.file.size] : []));
        const problem = uploadProblem(file, {
          count: entries.length,
          bytes: uploads.reduce((sum, size) => sum + size, 0),
        });
        if (problem) refusals.push(problem);
        else entries.push({ label: file.name, preview: URL.createObjectURL(file), file });
      }
      render();
      return refusals;
    },
    addSaved(name, fileUrl) {
      if (entries.some((entry) => entry.saved === name)) return `${name} is already an input.`;
      if (entries.length >= MAX_INPUTS) {
        return `${name} was not added: ${MAX_INPUTS} input images is the most a request takes.`;
      }
      entries.push({ label: name, preview: fileUrl, saved: name });
      render();
      return null;
    },
    payload() {
      return Promise.all(
        entries.map(async (entry) =>
          entry.file ? { data: await readDataUri(entry.file) } : { saved: entry.saved as string },
        ),
      );
    },
  };
}
