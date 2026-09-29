#!/usr/bin/env node
/**
 * Renders the brand SVGs (resources/brand) to PNG icons and writes the Windows app icon.
 *
 * Outputs:
 *   build/icon.ico            app icon for electron-builder (PNG-compressed entries, 16-256 px)
 *   build/icon.png            512 px app icon
 *   resources/icons/*.png     app and module icons for the UI (varak-<size>.png, <module>-<size>.png)
 *
 * Sizes up to 32 px use the simplified mark (logo-small.svg). Every written file is read back and
 * its dimensions are checked.
 *
 * Usage: node scripts/brand/generate-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Image } from '@napi-rs/canvas';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const brandDir = path.join(repoRoot, 'resources', 'brand');
const iconsDir = path.join(repoRoot, 'resources', 'icons');
const buildDir = path.join(repoRoot, 'build');

const APP_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512];
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const MODULE_SIZES = [16, 20, 24, 32, 48, 64, 128, 256];
const MODULES = ['writer', 'calc', 'impress', 'pdf'];
const SMALL_MARK_MAX = 32;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readSvg(name) {
  return fs.readFileSync(path.join(brandDir, `${name}.svg`), 'utf8');
}

/** Rasterises an SVG at `size` px. The root width/height are rewritten so Skia renders at the target size. */
export function renderSvg(svg, size) {
  const sized = svg.replace(/<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 width="${size}" height="${size}"`);
  const image = new Image();
  image.src = Buffer.from(sized, 'utf8');
  if (!image.complete || image.width !== size) throw new Error(`SVG could not be rendered at ${size}px`);
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(image, 0, 0, size, size);
  return canvas.toBuffer('image/png');
}

/** Width and height from the IHDR chunk of a PNG. */
export function pngSize(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG file');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Builds an ICO container whose entries are PNG images (supported since Windows Vista). */
export function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const png of pngs) {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256) throw new Error('ICO entries are limited to 256 px');
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width === 256 ? 0 : width, 0);
    entry.writeUInt8(height === 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2); // palette size
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

/** Parses an ICO file and returns the entries (size and embedded PNG dimensions). */
export function readIco(buffer) {
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) throw new Error('not an ICO file');
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + 16 * i;
    const size = buffer.readUInt8(base) || 256;
    const length = buffer.readUInt32LE(base + 8);
    const offset = buffer.readUInt32LE(base + 12);
    const png = pngSize(buffer.subarray(offset, offset + length));
    if (png.width !== size || png.height !== (buffer.readUInt8(base + 1) || 256)) throw new Error(`ICO entry ${i} size mismatch`);
    entries.push({ size, bytes: length });
  }
  return entries;
}

function writeChecked(file, png, size) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  const back = pngSize(fs.readFileSync(file));
  if (back.width !== size || back.height !== size) throw new Error(`${file}: expected ${size}x${size}, got ${back.width}x${back.height}`);
  return path.relative(repoRoot, file).replace(/\\/g, '/');
}

function main() {
  const logo = readSvg('logo');
  const logoSmall = readSvg('logo-small');
  const appIcon = (size) => renderSvg(size <= SMALL_MARK_MAX ? logoSmall : logo, size);
  const written = [];

  for (const size of APP_SIZES) written.push(writeChecked(path.join(iconsDir, `varak-${size}.png`), appIcon(size), size));
  for (const name of MODULES) {
    const svg = readSvg(name);
    for (const size of MODULE_SIZES) written.push(writeChecked(path.join(iconsDir, `${name}-${size}.png`), renderSvg(svg, size), size));
  }
  written.push(writeChecked(path.join(buildDir, 'icon.png'), appIcon(512), 512));

  const ico = buildIco(ICO_SIZES.map(appIcon));
  const icoFile = path.join(buildDir, 'icon.ico');
  fs.writeFileSync(icoFile, ico);
  const entries = readIco(fs.readFileSync(icoFile));
  const sizes = entries.map((e) => e.size).join(', ');
  if (sizes !== ICO_SIZES.join(', ')) throw new Error(`build/icon.ico entries ${sizes}`);
  written.push(`build/icon.ico (${entries.length} PNG entries: ${sizes}; ${ico.length} bytes)`);

  console.log(`Wrote ${written.length} files:`);
  for (const f of written) console.log(`  ${f}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
  }
}
