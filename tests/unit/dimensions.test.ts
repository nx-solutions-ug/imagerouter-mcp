import { describe, expect, it } from 'vitest';
import { readDimensions } from '../../src/lib/dimensions.js';
import {
  JPEG_DIMENSIONS_END,
  makeGif,
  makeJpeg,
  makeMp4,
  makePng,
  makeWebpExtended,
  makeWebpLossless,
  makeWebpLossy,
} from '../helpers/images.js';

describe('readDimensions', () => {
  it.each([
    ['PNG', makePng(640, 480)],
    ['GIF', makeGif(640, 480)],
    ['baseline JPEG', makeJpeg(640, 480)],
    ['progressive JPEG (SOF2)', makeJpeg(640, 480, 0xc2)],
    ['WebP VP8', makeWebpLossy(640, 480)],
    ['WebP VP8L', makeWebpLossless(640, 480)],
    ['WebP VP8X', makeWebpExtended(640, 480)],
  ])('reads %s', (_name, bytes) => {
    expect(readDimensions(bytes)).toEqual({ width: 640, height: 480 });
  });

  it('reads non-square and large sizes', () => {
    expect(readDimensions(makePng(1, 70000))).toEqual({ width: 1, height: 70000 });
    expect(readDimensions(makeWebpExtended(16384, 3))).toEqual({ width: 16384, height: 3 });
    expect(readDimensions(makeJpeg(65535, 2))).toEqual({ width: 65535, height: 2 });
  });

  it('returns null for video, empty and random data', () => {
    expect(readDimensions(makeMp4())).toBeNull();
    expect(readDimensions(new Uint8Array())).toBeNull();
    expect(readDimensions(new Uint8Array([0xff]))).toBeNull();
    let seed = 7;
    for (let round = 0; round < 300; round += 1) {
      const bytes = new Uint8Array(1 + (round % 64));
      for (let index = 0; index < bytes.length; index += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        bytes[index] = seed >> 16;
      }
      expect(readDimensions(bytes)).toBeNull();
    }
  });

  it('returns null for a PNG or JPEG cut anywhere before its dimensions', () => {
    const png = makePng(32, 16);
    for (let length = 0; length < 24; length += 1) {
      expect(readDimensions(png.subarray(0, length))).toBeNull();
    }
    const jpeg = makeJpeg(32, 16);
    for (let length = 0; length < JPEG_DIMENSIONS_END; length += 1) {
      expect(readDimensions(jpeg.subarray(0, length))).toBeNull();
    }
    expect(readDimensions(jpeg.subarray(0, JPEG_DIMENSIONS_END))).toEqual({
      width: 32,
      height: 16,
    });
  });

  it('never throws on any prefix of any supported format', () => {
    for (const bytes of [
      makePng(5, 5),
      makeGif(5, 5),
      makeJpeg(5, 5),
      makeWebpLossy(5, 5),
      makeWebpLossless(5, 5),
      makeWebpExtended(5, 5),
    ]) {
      for (let length = 0; length <= bytes.length; length += 1) {
        expect(() => readDimensions(bytes.subarray(0, length))).not.toThrow();
      }
    }
  });

  it('rejects zero sizes and unknown WebP chunks', () => {
    expect(readDimensions(makePng(0, 10))).toBeNull();
    expect(readDimensions(makeGif(10, 0))).toBeNull();
    const webp = makeWebpLossy(10, 10);
    webp.set([0x58, 0x58, 0x58, 0x58], 12);
    expect(readDimensions(webp)).toBeNull();
  });

  it('terminates on a JPEG with hostile segment lengths', () => {
    // Zero and tiny lengths, endless fill bytes, a length that points past the end.
    const zeroLength = new Uint8Array([0xff, 0xd8, ...Array(2000).fill([0xff, 0xe0, 0, 0]).flat()]);
    expect(readDimensions(zeroLength)).toBeNull();
    expect(readDimensions(new Uint8Array([0xff, 0xd8, ...Array(5000).fill(0xff)]))).toBeNull();
    expect(readDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 1, 2]))).toBeNull();
    expect(readDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 4, 1, 2, 3, 4]))).toBeNull();
  });

  it('ignores the markers that are not frame headers (DHT, JPG, DAC)', () => {
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      const bytes = makeJpeg(10, 10, marker);
      expect(readDimensions(bytes)).toBeNull();
    }
  });
});
