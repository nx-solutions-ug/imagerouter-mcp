import { deflateSync } from 'node:zlib';

function u16be(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}
function u16le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}
function u24le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
}
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

function crc32(bytes: number[]): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: number[]): number[] {
  const body = [...ascii(type), ...data];
  return [...u32be(data.length), ...body, ...u32be(crc32(body))];
}

// A complete, decodable 8-bit grayscale PNG.
export function makePng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const rows = Buffer.alloc((width + 1) * height);
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', [...u32be(width), ...u32be(height), 8, 0, 0, 0, 0]),
    ...pngChunk('IDAT', [...deflateSync(rows)]),
    ...pngChunk('IEND', []),
  ]);
}

export function makeGif(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    ...ascii('GIF89a'),
    ...u16le(width),
    ...u16le(height),
    0x00,
    0x00,
    0x00,
    0x3b,
  ]);
}

// SOI, a JFIF APP0 segment, then the frame header. `marker` 0xc0 is baseline, 0xc2 progressive.
export function makeJpeg(width: number, height: number, marker = 0xc0): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...u16be(16),
    ...ascii('JFIF'),
    0,
    1,
    1,
    0,
    ...u16be(1),
    ...u16be(1),
    0,
    0,
    0xff,
    marker,
    ...u16be(17),
    8,
    ...u16be(height),
    ...u16be(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ]);
}

// Byte length of the JPEG up to and including the width field of the frame header.
export const JPEG_DIMENSIONS_END = 2 + 18 + 2 + 2 + 1 + 2 + 2;

function riff(chunks: number[]): number[] {
  return [...ascii('RIFF'), ...u32le(chunks.length + 4), ...ascii('WEBP'), ...chunks];
}

export function makeWebpLossy(width: number, height: number): Uint8Array<ArrayBuffer> {
  const payload = [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height), 0, 0];
  return new Uint8Array(riff([...ascii('VP8 '), ...u32le(payload.length), ...payload]));
}

export function makeWebpLossless(width: number, height: number): Uint8Array<ArrayBuffer> {
  const packed = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const payload = [0x2f, ...u32le(packed >>> 0), 0, 0, 0, 0];
  return new Uint8Array(riff([...ascii('VP8L'), ...u32le(payload.length), ...payload]));
}

export function makeWebpExtended(width: number, height: number): Uint8Array<ArrayBuffer> {
  const payload = [0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  return new Uint8Array(riff([...ascii('VP8X'), ...u32le(payload.length), ...payload]));
}

export function makeMp4(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    ...u32be(24),
    ...ascii('ftypisom'),
    ...u32be(512),
    ...ascii('isomiso2'),
    ...u32be(8),
    ...ascii('free'),
  ]);
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
