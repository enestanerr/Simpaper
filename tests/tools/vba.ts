/**
 * VBA project reader ([MS-OVBA]): project name, module names/types and decompressed source code from a
 * vbaProject.bin (or any compound file with a `VBA` storage, e.g. `Macros/VBA` in a legacy .doc).
 * Lets tests check that macros survive a save even when the container itself is rewritten.
 */
import { readCfb } from './cfb';

/** [MS-OVBA] 2.4.1 decompression of a CompressedContainer. */
export function decompressVba(data: Uint8Array, start = 0): Buffer {
  if (data[start] !== 0x01) throw new Error('not a VBA compressed container');
  const out: number[] = [];
  let pos = start + 1;
  while (pos + 2 <= data.length) {
    const header = data[pos]! | (data[pos + 1]! << 8);
    const chunkEnd = Math.min(data.length, pos + (header & 0x0fff) + 3);
    const compressed = (header & 0x8000) !== 0;
    pos += 2;
    const chunkStart = out.length;
    if (!compressed) {
      for (let i = 0; i < 4096 && pos < data.length; i++) out.push(data[pos++]!);
      continue;
    }
    while (pos < chunkEnd) {
      const flags = data[pos++]!;
      for (let bit = 0; bit < 8 && pos < chunkEnd; bit++) {
        if ((flags & (1 << bit)) === 0) {
          out.push(data[pos++]!);
          continue;
        }
        const token = data[pos]! | (data[pos + 1]! << 8);
        pos += 2;
        const difference = out.length - chunkStart;
        const bitCount = Math.max(Math.ceil(Math.log2(Math.max(difference, 1))), 4);
        const lengthMask = 0xffff >>> bitCount;
        const length = (token & lengthMask) + 3;
        const offset = (token >>> (16 - bitCount)) + 1;
        const from = out.length - offset;
        if (from < 0) throw new Error('invalid VBA copy token');
        for (let i = 0; i < length; i++) out.push(out[from + i]!);
      }
    }
  }
  return Buffer.from(out);
}

export interface VbaModule {
  name: string;
  streamName: string;
  /**
   * [MS-OVBA] MODULETYPE: `procedural` for standard modules, `document-or-class` for document, class and
   * designer modules (e.g. ThisWorkbook, Sheet1).
   */
  type: 'procedural' | 'document-or-class';
  /** Source code with CRLF normalised to LF. */
  source: string;
}

export interface VbaProject {
  /** PROJECTNAME record of the dir stream, e.g. `VBAProject`. */
  name: string;
  codePage: number;
  /** Modules in dir-stream order. */
  modules: VbaModule[];
  /** Project GUID of the PROJECT stream (`ID="{…}"`), when present. */
  id?: string;
  /**
   * Module declarations of the PROJECT stream in order (`Module=Module1`, `Document=ThisWorkbook/&H00000000`,
   * `Class=…`, `BaseClass=…`, `Package=…`).
   */
  declarations: string[];
  /** All streams of the compound file by `/`-separated path, for stream-level comparisons. */
  streams: Map<string, Buffer>;
}

const DECLARATION = /^(Module|Document|Class|BaseClass|Package)=/;

/** Full read of a VBA project: dir stream records, module sources and the PROJECT stream. */
export function vbaProject(vbaProjectBin: Uint8Array): VbaProject {
  const streams = readCfb(vbaProjectBin);
  // Compound-file names compare case-insensitively ([MS-CFB] 2.6.4).
  const byLowerPath = new Map([...streams].map(([path, data]) => [path.toLowerCase(), data]));
  const dirPath = [...streams.keys()].find((p) => /(^|\/)VBA\/dir$/i.test(p));
  if (!dirPath) throw new Error('VBA/dir stream not found');
  const vbaDir = dirPath.slice(0, -'dir'.length); // e.g. "VBA/" or "Macros/VBA/"
  const projectDir = vbaDir.slice(0, -'VBA/'.length);
  const dir = decompressVba(streams.get(dirPath)!);

  let codePage = 1252;
  let name = '';
  const found: { name: string; streamName: string; offset: number; type: VbaModule['type'] }[] = [];
  let current: (typeof found)[number] | null = null;
  let pos = 0;
  while (pos + 6 <= dir.length) {
    const id = dir.readUInt16LE(pos);
    let size = dir.readUInt32LE(pos + 2);
    if (id === 0x0009) size = 6; // PROJECTVERSION: the size field is reserved (4) but 6 bytes follow
    const data = dir.subarray(pos + 6, pos + 6 + size);
    pos += 6 + size;
    switch (id) {
      case 0x0003: // PROJECTCODEPAGE
        codePage = data.readUInt16LE(0);
        break;
      case 0x0004: // PROJECTNAME
        name = decode(data, codePage);
        break;
      case 0x0019: // MODULENAME starts a module record
        current = { name: decode(data, codePage), streamName: '', offset: 0, type: 'procedural' };
        break;
      case 0x0047: // MODULENAMEUNICODE
        if (current) current.name = data.toString('utf16le');
        break;
      case 0x001a: // MODULESTREAMNAME
        if (current) current.streamName = decode(data, codePage);
        break;
      case 0x0032: // MODULESTREAMNAME (Unicode part)
        if (current) current.streamName = data.toString('utf16le');
        break;
      case 0x0031: // MODULEOFFSET
        if (current) current.offset = data.readUInt32LE(0);
        break;
      case 0x0021: // MODULETYPE: procedural
      case 0x0022: // MODULETYPE: document, class or designer
        if (current) current.type = id === 0x0021 ? 'procedural' : 'document-or-class';
        break;
      case 0x002b: // module terminator
        if (current) found.push(current);
        current = null;
        break;
      default:
        break;
    }
    if (id === 0x0010) break; // dir terminator
  }

  const modules = found.map((m) => {
    const stream = byLowerPath.get(`${vbaDir}${m.streamName}`.toLowerCase());
    if (!stream) throw new Error(`module stream ${m.streamName} missing`);
    return { name: m.name, streamName: m.streamName, type: m.type, source: decode(decompressVba(stream, m.offset), codePage).replace(/\r\n?/g, '\n') };
  });

  // PROJECT stream ([MS-OVBA] 2.3.1): "key=value" properties, then [Host Extender Info] and [Workspace] sections.
  const projectStream = byLowerPath.get(`${projectDir}PROJECT`.toLowerCase());
  const lines = projectStream ? decode(projectStream, codePage).split(/\r?\n/) : [];
  const sectionStart = lines.findIndex((l) => l.startsWith('['));
  const properties = sectionStart < 0 ? lines : lines.slice(0, sectionStart);
  const projectId = /^ID="(\{[0-9A-Fa-f-]+\})"$/.exec(properties.find((l) => l.startsWith('ID=')) ?? '')?.[1];
  return { name, codePage, modules, id: projectId, declarations: properties.filter((l) => DECLARATION.test(l)), streams };
}

/** Modules of a vbaProject.bin with their source code (decoded with the project code page). */
export function vbaModules(vbaProjectBin: Uint8Array): VbaModule[] {
  return vbaProject(vbaProjectBin).modules;
}

/** WHATWG encoding labels for code pages whose label is not `windows-<n>`. */
const CODE_PAGE_LABELS: Record<number, string> = { 65001: 'utf-8', 1200: 'utf-16le', 10000: 'macintosh', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5' };

function decode(bytes: Uint8Array, codePage: number): string {
  try {
    return new TextDecoder(CODE_PAGE_LABELS[codePage] ?? `windows-${codePage}`).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
