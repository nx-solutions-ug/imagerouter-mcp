export interface Dimensions {
  width: number;
  height: number;
}

const u16be = (bytes: Uint8Array, at: number): number => (bytes[at]! << 8) | bytes[at + 1]!;
const u16le = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
const u24le = (bytes: Uint8Array, at: number): number =>
  bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
const u32be = (bytes: Uint8Array, at: number): number =>
  ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
const u32le = (bytes: Uint8Array, at: number): number =>
  (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

function matches(bytes: Uint8Array, at: number, text: string): boolean {
  if (at < 0 || at + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function sized(width: number, height: number): Dimensions | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function png(bytes: Uint8Array): Dimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  if (!matches(bytes, 12, 'IHDR')) return null;
  return sized(u32be(bytes, 16), u32be(bytes, 20));
}

function gif(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 10 || !matches(bytes, 0, 'GIF8')) return null;
  return sized(u16le(bytes, 6), u16le(bytes, 8));
}

// Frame headers are SOF0-SOF15 except DHT (0xc4), JPG (0xc8) and DAC (0xcc).
const isFrameMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpeg(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  // Every pass moves `at` forward by at least one byte, so the loop is bounded by the input size.
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Markers without a length: TEM, RSTn, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    // EOI or the start of the entropy-coded data: no frame header came before it.
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return null;
    if (at + 4 > bytes.length) return null;
    const length = u16be(bytes, at + 2);
    if (length < 2) return null;
    if (isFrameMarker(marker)) {
      if (at + 9 > bytes.length) return null;
      return sized(u16be(bytes, at + 7), u16be(bytes, at + 5));
    }
    at += 2 + length;
  }
  return null;
}

function webp(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 25 || !matches(bytes, 0, 'RIFF') || !matches(bytes, 8, 'WEBP')) return null;
  if (matches(bytes, 12, 'VP8X')) {
    if (bytes.length < 30) return null;
    return sized(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  }
  if (matches(bytes, 12, 'VP8L')) {
    if (bytes[20] !== 0x2f) return null;
    const packed = u32le(bytes, 21);
    return sized((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
  }
  if (matches(bytes, 12, 'VP8 ')) {
    if (bytes.length < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return sized(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  }
  return null;
}

// Pure and total: hostile or truncated bytes yield null, never an exception or an out-of-bounds
// read. Every access is guarded by an explicit length check.
export function readDimensions(bytes: Uint8Array): Dimensions | null {
  try {
    return png(bytes) ?? gif(bytes) ?? jpeg(bytes) ?? webp(bytes);
  } catch {
    return null;
  }
}
