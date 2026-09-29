/**
 * Minimal read-only parser for Compound File Binary containers ([MS-CFB]): legacy DOC/XLS/PPT files
 * and password-encrypted OOXML packages (EncryptionInfo + EncryptedPackage streams).
 * It lists directory entries and reads the first bytes of selected streams; nothing else.
 */
import { open } from 'node:fs/promises';

export const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const MAXREGSECT = 0xfffffffa;
const ENDOFCHAIN = 0xfffffffe;
const MAX_ENTRIES = 100_000;

export type CfbEntryType = 'storage' | 'stream' | 'root';

export interface CfbEntry {
  name: string;
  type: CfbEntryType;
  size: number;
  startSector: number;
}

export interface CfbSummary {
  entries: CfbEntry[];
  /** First bytes of the requested streams (by exact name), when present. */
  heads: Map<string, Buffer>;
}

export type RandomRead = (offset: number, length: number) => Promise<Buffer>;

export class CfbFormatError extends Error {
  override readonly name = 'CfbFormatError';
}

export function isCfb(head: Uint8Array): boolean {
  return head.length >= 8 && CFB_MAGIC.equals(Buffer.from(head.subarray(0, 8)));
}

export async function readCfbSummary(read: RandomRead, fileSize: number, headStreams: readonly string[] = [], headBytes = 4096): Promise<CfbSummary> {
  const header = await read(0, 512);
  if (header.length < 512 || !isCfb(header)) throw new CfbFormatError('not a compound file');
  const sectorShift = header.readUInt16LE(0x1e);
  if (sectorShift !== 9 && sectorShift !== 12) throw new CfbFormatError('bad sector size');
  const sectorSize = 1 << sectorShift;
  const numFatSectors = header.readUInt32LE(0x2c);
  const firstDirSector = header.readUInt32LE(0x30);
  const miniCutoff = header.readUInt32LE(0x38);
  const firstMiniFatSector = header.readUInt32LE(0x3c);
  const firstDifatSector = header.readUInt32LE(0x44);
  const numDifatSectors = header.readUInt32LE(0x48);
  const maxSectors = Math.ceil(fileSize / sectorSize) + 1;

  const sectorOffset = (n: number) => (n + 1) * sectorSize;
  const readSector = async (n: number): Promise<Buffer> => {
    if (n > MAXREGSECT || sectorOffset(n) >= fileSize) throw new CfbFormatError(`sector ${n} out of range`);
    const buf = await read(sectorOffset(n), sectorSize);
    if (buf.length < sectorSize) return Buffer.concat([buf, Buffer.alloc(sectorSize - buf.length)]);
    return buf;
  };

  // DIFAT: 109 entries in the header, then a chain of DIFAT sectors.
  const difat: number[] = [];
  for (let i = 0; i < 109 && difat.length < numFatSectors; i++) difat.push(header.readUInt32LE(0x4c + 4 * i));
  let difatSector = firstDifatSector;
  for (let i = 0; i < numDifatSectors && difatSector <= MAXREGSECT && difat.length < numFatSectors; i++) {
    const buf = await readSector(difatSector);
    const per = sectorSize / 4 - 1;
    for (let j = 0; j < per && difat.length < numFatSectors; j++) difat.push(buf.readUInt32LE(4 * j));
    difatSector = buf.readUInt32LE(sectorSize - 4);
  }

  const fatCache = new Map<number, Buffer>();
  const perFatSector = sectorSize / 4;
  const nextSector = async (n: number): Promise<number> => {
    const idx = Math.floor(n / perFatSector);
    const fatSector = difat[idx];
    if (fatSector === undefined || fatSector > MAXREGSECT) throw new CfbFormatError('FAT entry missing');
    let buf = fatCache.get(idx);
    if (!buf) {
      buf = await readSector(fatSector);
      fatCache.set(idx, buf);
    }
    return buf.readUInt32LE((n % perFatSector) * 4);
  };
  /** Sector numbers of a chain; stops after `limit` sectors, throws on loops. */
  const chain = async (start: number, limit = maxSectors): Promise<number[]> => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s <= MAXREGSECT && s !== ENDOFCHAIN && out.length < limit; s = await nextSector(s)) {
      if (seen.has(s)) throw new CfbFormatError('sector chain loop');
      seen.add(s);
      out.push(s);
    }
    return out;
  };

  const entries: CfbEntry[] = [];
  for (const s of await chain(firstDirSector)) {
    const buf = await readSector(s);
    for (let off = 0; off + 128 <= sectorSize; off += 128) {
      const type = buf[off + 66];
      if (type !== 1 && type !== 2 && type !== 5) continue;
      const nameLen = Math.min(64, buf.readUInt16LE(off + 64));
      const name = buf.toString('utf16le', off, off + Math.max(0, nameLen - 2));
      const size = sectorSize === 512 ? buf.readUInt32LE(off + 120) : Number(buf.readBigUInt64LE(off + 120));
      entries.push({ name, type: type === 1 ? 'storage' : type === 2 ? 'stream' : 'root', size, startSector: buf.readUInt32LE(off + 116) });
      if (entries.length > MAX_ENTRIES) throw new CfbFormatError('too many directory entries');
    }
  }

  const heads = new Map<string, Buffer>();
  const root = entries.find((e) => e.type === 'root');
  let miniFat: Buffer | null = null;
  let miniStreamSectors: number[] | null = null;

  const readRegularHead = async (entry: CfbEntry, max: number): Promise<Buffer> => {
    const parts: Buffer[] = [];
    let got = 0;
    const sectors = await chain(entry.startSector, Math.ceil(max / sectorSize) + 1).catch(() => [] as number[]);
    for (const s of sectors) {
      if (got >= max) break;
      const b = await readSector(s);
      parts.push(b);
      got += b.length;
    }
    return Buffer.concat(parts).subarray(0, Math.min(max, entry.size));
  };

  const readMiniHead = async (entry: CfbEntry, max: number): Promise<Buffer> => {
    if (!root) return Buffer.alloc(0);
    if (!miniFat) {
      const sectors = firstMiniFatSector <= MAXREGSECT ? await chain(firstMiniFatSector) : [];
      miniFat = Buffer.concat(await Promise.all(sectors.map(readSector)));
    }
    if (!miniStreamSectors) miniStreamSectors = await chain(root.startSector);
    const parts: Buffer[] = [];
    const seen = new Set<number>();
    let got = 0;
    for (let m = entry.startSector; m <= MAXREGSECT && m !== ENDOFCHAIN && got < max; ) {
      if (seen.has(m)) break;
      seen.add(m);
      const byteOffset = m * 64;
      const regular = miniStreamSectors[Math.floor(byteOffset / sectorSize)];
      if (regular === undefined) break;
      const b = await read(sectorOffset(regular) + (byteOffset % sectorSize), 64);
      parts.push(b);
      got += b.length;
      m = m * 4 + 4 <= miniFat.length ? miniFat.readUInt32LE(m * 4) : ENDOFCHAIN;
    }
    return Buffer.concat(parts).subarray(0, Math.min(max, entry.size));
  };

  for (const name of headStreams) {
    const entry = entries.find((e) => e.type === 'stream' && e.name === name);
    if (!entry) continue;
    try {
      heads.set(name, entry.size < miniCutoff ? await readMiniHead(entry, headBytes) : await readRegularHead(entry, headBytes));
    } catch {
      // unreadable stream head: the caller treats it as "unknown"
    }
  }

  return { entries, heads };
}

export async function readCfbFileSummary(path: string, headStreams: readonly string[] = [], headBytes = 4096): Promise<CfbSummary> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const read: RandomRead = async (offset, length) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return buf.subarray(0, bytesRead);
    };
    return await readCfbSummary(read, size, headStreams, headBytes);
  } finally {
    await fh.close();
  }
}
