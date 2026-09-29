/** Plain-text helpers: BOM-aware decoding, a minimal RTF text extractor and container sniffing. */
import { readFileSync } from 'node:fs';

export interface DecodedText {
  text: string;
  bom: boolean;
  /** Lines without terminators; a final empty line (trailing newline) is dropped. */
  lines: string[];
  lineEnding: 'CRLF' | 'LF' | 'mixed' | 'none';
}

/** Decodes UTF-8 (with or without BOM) and reports the line-ending style. */
export function readText(source: string | Buffer): DecodedText {
  const buf = typeof source === 'string' ? readFileSync(source) : source;
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? buf.subarray(3) : buf);
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return { text, bom, lines, lineEnding: lf === 0 ? 'none' : crlf === lf ? 'CRLF' : crlf === 0 ? 'LF' : 'mixed' };
}

/**
 * Decoder for a Windows ANSI code page number (`\ansicpgN`), windows-1252 when the runtime does not know it.
 * (The return type is inferred: under the Node typings TextDecoder is a value, not an interface type.)
 */
function ansiDecoder(codePage: string) {
  try {
    return new TextDecoder(`windows-${codePage}`);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

const SKIP_DESTINATIONS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'pgdsctbl']);

/**
 * Visible text of an RTF document: `\uN` escapes (with `\ucN` fallback skipping), `\'hh` in the declared
 * ANSI code page, `\par`/`\line` as newlines, `\tab`; ignorable destinations (`{\*...}`), tables of
 * fonts/colours/styles, headers/footers and pictures are skipped. Enough for content assertions.
 */
export function rtfText(rtf: string): string {
  const decoder = ansiDecoder(/\\ansicpg(\d+)/.exec(rtf)?.[1] ?? '1252');
  let out = '';
  const stack: { skip: boolean; uc: number }[] = [];
  let state = { skip: false, uc: 1 };
  let pendingSkip = 0;
  const emit = (s: string) => {
    if (!state.skip) out += s;
  };
  for (let i = 0; i < rtf.length; ) {
    const ch = rtf[i]!;
    if (ch === '{') {
      stack.push(state);
      state = { ...state };
      i++;
      if (rtf.startsWith('\\*', i)) state.skip = true;
      continue;
    }
    if (ch === '}') {
      state = stack.pop() ?? { skip: false, uc: 1 };
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch !== '\\') {
      if (pendingSkip > 0) pendingSkip--;
      else emit(ch);
      i++;
      continue;
    }
    const next = rtf[i + 1] ?? '';
    if (next === "'") {
      const byte = parseInt(rtf.slice(i + 2, i + 4), 16);
      if (pendingSkip > 0) pendingSkip--;
      else emit(decoder.decode(Uint8Array.of(byte)));
      i += 4;
      continue;
    }
    if (!/[a-zA-Z]/.test(next)) {
      if (next === '~') emit(' ');
      else if (next === '\\' || next === '{' || next === '}') emit(next);
      i += 2;
      continue;
    }
    const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40))!;
    const [whole, word, arg] = m;
    i += whole!.length;
    if (SKIP_DESTINATIONS.has(word!)) state.skip = true;
    else if (word === 'uc') state.uc = Number(arg ?? 1);
    else if (word === 'u') {
      let code = Number(arg);
      if (code < 0) code += 65536;
      emit(String.fromCharCode(code));
      pendingSkip = state.uc;
    } else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') emit('\n');
    else if (word === 'tab' || word === 'cell') emit('\t');
    else if (word === 'row') emit('\n');
  }
  return out;
}

export type ContainerKind = 'zip' | 'ole2' | 'pdf' | 'rtf' | 'unknown';

/** Identifies the container by magic bytes. */
export function sniffContainer(buf: Buffer): ContainerKind {
  if (buf.readUInt32LE(0) === 0x04034b50) return 'zip';
  if (buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1) return 'ole2';
  if (buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (buf.toString('latin1', 0, 5) === '{\\rtf') return 'rtf';
  return 'unknown';
}

/**
 * True for password-protected OOXML files: an OLE2 compound file whose directory names the
 * `EncryptionInfo` and `EncryptedPackage` streams (ECMA-376 part 2 / MS-OFFCRYPTO). Heuristic search of
 * the UTF-16LE stream names; sufficient to route such files to a password prompt.
 */
export function isEncryptedOoxml(buf: Buffer): boolean {
  if (sniffContainer(buf) !== 'ole2') return false;
  const has = (name: string) => buf.includes(Buffer.from(name, 'utf16le'));
  return has('EncryptionInfo') && has('EncryptedPackage');
}
