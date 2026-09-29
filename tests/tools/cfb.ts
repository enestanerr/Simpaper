/**
 * Minimal read-only Compound File Binary (OLE2, [MS-CFB]) reader: returns every stream by path.
 * Used to compare VBA projects (vbaProject.bin) and legacy containers independent of their sector layout.
 */
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

interface DirEntry {
  name: string;
  type: number; // 1 storage, 2 stream, 5 root
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

export function isCfb(buf: Uint8Array): boolean {
  return buf.length >= 512 && Buffer.from(buf.subarray(0, 8)).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}

/** All streams of a compound file keyed by `/`-separated path (e.g. `VBA/dir`). */
export function readCfb(input: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(input);
  if (!isCfb(buf)) throw new Error('not a compound file');
  const sectorSize = 1 << buf.readUInt16LE(0x1e);
  const miniSectorSize = 1 << buf.readUInt16LE(0x20);
  const numFatSectors = buf.readUInt32LE(0x2c);
  const firstDirSector = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFat = buf.readUInt32LE(0x3c);
  let difatSector = buf.readUInt32LE(0x44);
  const sectorOffset = (s: number) => (s + 1) * sectorSize;

  // DIFAT → FAT sector numbers
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s !== FREESECT) fatSectors.push(s);
  }
  const perDifat = sectorSize / 4 - 1;
  for (let guard = 0; difatSector !== ENDOFCHAIN && difatSector !== FREESECT && fatSectors.length < numFatSectors && guard < 10_000; guard++) {
    const off = sectorOffset(difatSector);
    for (let i = 0; i < perDifat && fatSectors.length < numFatSectors; i++) {
      const s = buf.readUInt32LE(off + i * 4);
      if (s !== FREESECT) fatSectors.push(s);
    }
    difatSector = buf.readUInt32LE(off + perDifat * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(sectorOffset(s) + i * 4));

  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    for (let s = start; s !== ENDOFCHAIN && s !== FREESECT && s < table.length; s = table[s]!) {
      if (out.length > table.length) throw new Error('cyclic sector chain');
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number) => Buffer.concat(chain(start, fat).map((s) => buf.subarray(sectorOffset(s), sectorOffset(s) + sectorSize)));

  const dirData = readChain(firstDirSector);
  const entries: DirEntry[] = [];
  for (let off = 0; off + 128 <= dirData.length; off += 128) {
    const nameLen = dirData.readUInt16LE(off + 0x40);
    entries.push({
      name: dirData.toString('utf16le', off, off + Math.max(0, nameLen - 2)),
      type: dirData[off + 0x42]!,
      left: dirData.readUInt32LE(off + 0x44),
      right: dirData.readUInt32LE(off + 0x48),
      child: dirData.readUInt32LE(off + 0x4c),
      start: dirData.readUInt32LE(off + 0x74),
      size: dirData.readUInt32LE(off + 0x78),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new Error('missing root entry');
  const miniStream = readChain(root.start);
  const miniFat: number[] = [];
  if (firstMiniFat !== ENDOFCHAIN) {
    const data = readChain(firstMiniFat);
    for (let i = 0; i + 4 <= data.length; i += 4) miniFat.push(data.readUInt32LE(i));
  }
  const readStream = (e: DirEntry): Buffer => {
    if (e.size < miniCutoff) {
      const parts = chain(e.start, miniFat).map((s) => miniStream.subarray(s * miniSectorSize, (s + 1) * miniSectorSize));
      return Buffer.concat(parts).subarray(0, e.size);
    }
    return readChain(e.start).subarray(0, e.size);
  };

  const streams = new Map<string, Buffer>();
  const visit = (index: number, prefix: string, depth: number) => {
    if (index === NOSTREAM || depth > 64) return;
    const e = entries[index];
    if (!e) return;
    visit(e.left, prefix, depth + 1);
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.type === 2) streams.set(path, readStream(e));
    else if (e.type === 1) visit(e.child, path, depth + 1);
    visit(e.right, prefix, depth + 1);
  };
  visit(root.child, '', 0);
  return streams;
}
