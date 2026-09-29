/** Deterministic raster images (pngjs) used inside the generated documents. */
import pngjs from 'pngjs';

const { PNG } = pngjs;

/**
 * Encodes an RGBA image; `pixel(x, y)` returns [r, g, b, a].
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => [number, number, number, number]} pixel
 * @returns {Buffer}
 */
export function makePng(width, height, pixel) {
  const png = new PNG({ width, height, colorType: 6 });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9, filterType: 4 });
}

/** Brand-coloured test picture: ink→gold gradient, a white frame, a checkerboard and three colour bars. */
export function testPicture(width = 320, height = 200) {
  const ink = [0x1d, 0x2b, 0x53];
  const gold = [0xc9, 0xa2, 0x27];
  const bars = [
    [0x3b, 0x5b, 0xdb],
    [0x12, 0x87, 0x6f],
    [0xd5, 0x58, 0x2a],
  ];
  return makePng(width, height, (x, y) => {
    if (x < 4 || y < 4 || x >= width - 4 || y >= height - 4) return [255, 255, 255, 255];
    if (y > height * 0.7) {
      const bar = bars[Math.min(2, Math.floor((x / width) * 3))];
      return [...bar, 255];
    }
    if (x > width * 0.65 && y < height * 0.45) {
      const on = (Math.floor(x / 10) + Math.floor(y / 10)) % 2 === 0;
      return on ? [255, 255, 255, 255] : [0, 0, 0, 255];
    }
    const t = x / (width - 1);
    return [0, 1, 2].map((c) => Math.round(ink[c] + (gold[c] - ink[c]) * t)).concat(255);
  });
}

/** Reads width/height from a PNG header. */
export function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
