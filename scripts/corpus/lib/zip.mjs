/** Deterministic OPC/ODF packaging with JSZip: fixed timestamps, stable entry order, no folder entries. */
import JSZip from 'jszip';
import { FIXED_DATE } from './constants.mjs';

const DEFLATE = { compression: 'DEFLATE', compressionOptions: { level: 6 } };

/**
 * Builds a zip package from `[name, content]` entries in the given order.
 * @param {Array<[string, string | Uint8Array]>} entries
 * @param {{ stored?: string[] }} [opts] entry names written without compression (e.g. ODF `mimetype`)
 * @returns {Promise<Buffer>}
 */
export async function buildPackage(entries, { stored = [] } = {}) {
  const zip = new JSZip();
  for (const [name, content] of entries) {
    zip.file(name, content, { date: FIXED_DATE, createFolders: false, compression: stored.includes(name) ? 'STORE' : 'DEFLATE' });
  }
  return zip.generateAsync({ type: 'nodebuffer', platform: 'DOS', ...DEFLATE });
}

/**
 * Re-packs an existing zip with fixed timestamps (entry order and contents unchanged, folder entries dropped).
 * `transform(name, content)` may rewrite an entry (e.g. normalise docProps written by a library).
 * @param {Uint8Array} buffer
 * @param {(name: string, content: Buffer) => Buffer | string} [transform]
 * @returns {Promise<Buffer>}
 */
export async function normalizeZip(buffer, transform) {
  const src = await JSZip.loadAsync(buffer);
  const entries = [];
  for (const file of Object.values(src.files)) {
    if (file.dir) continue;
    const content = await file.async('nodebuffer');
    entries.push([file.name, transform ? transform(file.name, content) : content]);
  }
  return buildPackage(entries);
}

/**
 * Hashes of the uncompressed parts (stable identity of a package independent of zip metadata).
 * @param {Uint8Array} buffer
 * @returns {Promise<Record<string, string>>}
 */
export async function partHashes(buffer) {
  const { createHash } = await import('node:crypto');
  const zip = await JSZip.loadAsync(buffer);
  const out = {};
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    out[file.name] = createHash('sha256').update(await file.async('nodebuffer')).digest('hex');
  }
  return out;
}
