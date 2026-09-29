/**
 * Reads the product version of the engine without starting it: the VS_FIXEDFILEINFO block of
 * soffice.exe's version resource (e.g. "26.8.0.3"). Used by EngineManager.probe().
 */
import { readFile } from 'node:fs/promises';

const SIGNATURE = Buffer.from([0xbd, 0x04, 0xef, 0xfe]); // 0xFEEF04BD, little endian
const MAX_SIZE = 64 * 1024 * 1024;

/** Parses the file version from a PE image buffer; null if no VS_FIXEDFILEINFO is present. */
export function parsePeFileVersion(image: Buffer): string | null {
  let at = image.lastIndexOf(SIGNATURE);
  while (at >= 0) {
    // VS_FIXEDFILEINFO: dwSignature, dwStrucVersion, dwFileVersionMS, dwFileVersionLS, ...
    if (at + 16 <= image.length && image.readUInt32LE(at + 4) === 0x00010000) {
      const ms = image.readUInt32LE(at + 8);
      const ls = image.readUInt32LE(at + 12);
      return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.');
    }
    at = at > 0 ? image.lastIndexOf(SIGNATURE, at - 1) : -1;
  }
  return null;
}

export async function readPeFileVersion(path: string): Promise<string | null> {
  try {
    const image = await readFile(path);
    if (image.length > MAX_SIZE) return null;
    return parsePeFileVersion(image);
  } catch {
    return null;
  }
}
