/**
 * PDF service: file operations of the PDF module on the document's private working copy.
 * Rendering, annotations and form filling happen in the renderer (pdf.js); this service rewrites or
 * extends the file with @cantoo/pdf-lib and writes the user's file only through the safe-save pipeline.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { CompatFinding, DocumentDescriptor, Prompt, SaveResult } from '@shared/api/documents';
import type { PdfImageInsert, PdfPageOp, PdfPrintPage, PdfTextInsert } from '@shared/api/pdf';
import { stampOf } from '../documents/record';
import type { DocumentRegistry, OpenDocumentRecord, SafeWriter } from '../documents/types';
import { ensurePdfExtension, samePath, statOrNull } from '../files/fsUtil';
import type { Logger } from '../log';
import { fixUnicodeAppearances } from './appearance';
import { insertImageItem, insertTextItems } from './content';
import { PdfServiceError, errorKeyOf, errorMessage } from './errors';
import { createFontProvider } from './fonts';
import { containsAscii, looksLikePdf } from './load';
import { createKeyedMutex } from './mutex';
import { appendDocuments, applyPageOps, extractDocument, type MergeSource } from './page-ops';
import { printRenderedPages, validatePrintPages } from './print';
import type { PdfService } from './types';
import { verifyPdfBytes, verifyPdfFile } from './verify';

export type { PdfService } from './types';
export { PdfServiceError } from './errors';
export { createBlankPdfBytes } from './page-ops';

export type PdfServiceDeps = Parameters<typeof createPdfService>[0];

function toUint8(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Adds `.pdf` when the dialog returned a name without it. */
export { ensurePdfExtension };

function stem(desc: DocumentDescriptor): string {
  const name = desc.path ? basename(desc.path) : desc.title;
  return name.replace(/\.pdf$/i, '') || 'document';
}

/** Compact, language-neutral page list for file names: [0,1,2,4] → "1-3,5". */
export function pageRangeLabel(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(i === j ? `${sorted[i]! + 1}` : `${sorted[i]! + 1}-${sorted[j]! + 1}`);
    i = j + 1;
  }
  return parts.join(',');
}

function isSigned(bytes: Uint8Array): boolean {
  return containsAscii(bytes, '/ByteRange') && containsAscii(bytes, '/Sig');
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  return Buffer.from(bytes.buffer, bytes.byteOffset, prefix.length).equals(Buffer.from(prefix.buffer, prefix.byteOffset, prefix.byteLength));
}

export function createPdfService(deps: {
  registry: DocumentRegistry;
  safeWrite: SafeWriter;
  log: Logger;
  fontFiles: () => string[];
  dialogs: {
    saveAs(win: BrowserWindow | null, defaultPath: string): Promise<string | null>;
    openPdfs(win: BrowserWindow | null): Promise<string[]>;
  };
}): PdfService {
  const { registry, safeWrite, log, dialogs } = deps;
  const lock = createKeyedMutex();
  const fonts = createFontProvider(deps.fontFiles, log);

  function requireRecord(docId: string): OpenDocumentRecord & { workingCopyPath: string } {
    const rec = registry.get(docId);
    if (!rec || rec.descriptor.kind !== 'pdf') throw new PdfServiceError('pdf.errors.notOpen', docId);
    if (!rec.workingCopyPath) throw new PdfServiceError('pdf.errors.noWorkingCopy', docId);
    return rec as OpenDocumentRecord & { workingCopyPath: string };
  }

  async function readBytes(path: string): Promise<Uint8Array> {
    return toUint8(await readFile(path));
  }

  async function writeWorkingCopy(path: string, bytes: Uint8Array): Promise<void> {
    await safeWrite(path, (tmp) => writeFile(tmp, bytes));
  }

  function markModified(docId: string): void {
    const doc = registry.update(docId, { modified: true });
    registry.emit({ type: 'updated', doc });
  }

  /** Read-modify-write of the working copy under the document's lock. */
  function transform(docId: string, what: string, fn: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
    return lock.run(docId, async () => {
      const rec = requireRecord(docId);
      const started = Date.now();
      const input = await readBytes(rec.workingCopyPath);
      const output = await fn(input);
      await writeWorkingCopy(rec.workingCopyPath, output);
      markModified(docId);
      log.info(`pdf ${what}`, { docId, bytesIn: input.length, bytesOut: output.length, ms: Date.now() - started });
      return output;
    });
  }

  function failed(err: unknown, fallback: Parameters<typeof errorKeyOf>[1]): SaveResult {
    return { outcome: 'failed', errorKey: errorKeyOf(err, fallback), errorDetail: errorMessage(err) };
  }

  /**
   * Overwriting a signed original with a file that is not an incremental update of it invalidates the
   * signatures; the user is asked first and may save a copy instead.
   */
  async function signatureRisk(rec: OpenDocumentRecord, target: string): Promise<'proceed' | 'saveCopy' | 'cancel'> {
    const original = rec.descriptor.path;
    if (!original || !samePath(original, target)) return 'proceed';
    let originalBytes: Uint8Array;
    try {
      originalBytes = await readBytes(original);
    } catch {
      return 'proceed';
    }
    if (!isSigned(originalBytes)) return 'proceed';
    const working = await readBytes(rec.workingCopyPath!);
    if (startsWith(working, originalBytes)) return 'proceed';
    const finding: CompatFinding = { id: 'digitalSignature', severity: 'risk', messageKey: 'compat.finding.digitalSignature' };
    const answer = await registry.prompt<Extract<Prompt, { kind: 'saveRisk' }>>({
      kind: 'saveRisk',
      docId: rec.descriptor.docId,
      fileName: basename(original),
      format: 'pdf',
      findings: [finding],
    });
    if (answer.kind !== 'saveRisk') return 'cancel';
    if (answer.choice === 'saveAnyway') return 'proceed';
    if (answer.choice === 'saveCopy') return 'saveCopy';
    return 'cancel';
  }

  /** Another open document is bound to `target`: both tabs would then write the same file. */
  function openElsewhere(docId: string, target: string): boolean {
    return registry.list().some((r) => r.descriptor.docId !== docId && r.descriptor.path !== null && samePath(r.descriptor.path, target));
  }

  /**
   * The document's own file changed on disk since it was opened or last saved (another program or a sync
   * client wrote it): the user decides before it is overwritten (the same `overwriteNewer` prompt as office saves).
   */
  async function overwriteNewerChoice(rec: OpenDocumentRecord, target: string): Promise<'overwrite' | 'saveCopy' | 'cancel'> {
    const own = rec.descriptor.path;
    const stamp = registry.diskStampOf?.(rec.descriptor.docId);
    if (!own || !stamp || !samePath(own, target)) return 'overwrite';
    const st = await statOrNull(target);
    if (!st || (st.mtimeMs === stamp.mtimeMs && st.size === stamp.size)) return 'overwrite';
    const answer = await registry.prompt<Extract<Prompt, { kind: 'overwriteNewer' }>>({ kind: 'overwriteNewer', docId: rec.descriptor.docId, fileName: basename(target) });
    return answer.kind === 'overwriteNewer' ? answer.choice : 'cancel';
  }

  /**
   * Writes the working copy to `target`. `afterWrite` runs still under the document's lock, so a pdf:update
   * queued behind the save marks the document modified after the saved state was applied, never before.
   */
  async function writeUserFile(docId: string, target: string, afterWrite?: () => Promise<void>): Promise<number> {
    return lock.run(docId, async () => {
      const rec = requireRecord(docId);
      const bytes = await readBytes(rec.workingCopyPath);
      const { pageCount } = await verifyPdfBytes(bytes);
      await safeWrite(target, (tmp) => writeFile(tmp, bytes), {
        verify: async (tmp) => {
          await verifyPdfFile(tmp, { pageCount });
        },
      });
      log.info('pdf written', { docId, bytes: bytes.length, pages: pageCount });
      await afterWrite?.();
      return pageCount;
    });
  }

  return {
    read(docId) {
      return lock.run(docId, async () => readBytes(requireRecord(docId).workingCopyPath));
    },

    update(docId, bytes) {
      return lock.run(docId, async () => {
        const rec = requireRecord(docId);
        const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayLike<number>);
        if (!looksLikePdf(input)) throw new PdfServiceError('pdf.errors.invalidBytes', `${input.length} bytes`);
        const fixed = await fixUnicodeAppearances(input, fonts, log);
        await writeWorkingCopy(rec.workingCopyPath, fixed.bytes);
        markModified(docId);
        log.info('pdf updated from viewer', { docId, bytes: fixed.bytes.length, fixedFreeTexts: fixed.freeTexts, fixedFields: fixed.fields });
      });
    },

    async save(docId, saveAs, win) {
      let rec: OpenDocumentRecord;
      try {
        requireRecord(docId);
        // Edits pdf.js still holds reach the working copy first (flushRequest → pdf:update → documents:flushDone).
        await registry.requestFlush?.(docId);
        rec = requireRecord(docId);
      } catch (err) {
        return failed(err, 'pdf.errors.saveFailed');
      }
      const desc = rec.descriptor;
      const needsDialog = saveAs || !desc.path || desc.readOnly || (desc.format !== null && desc.format !== 'pdf');
      let target = desc.path;
      if (needsDialog) {
        const chosen = await dialogs.saveAs(win, desc.path ?? `${stem(desc)}.pdf`);
        if (!chosen) return { outcome: 'cancelled' };
        target = ensurePdfExtension(chosen);
      }
      if (!target) return { outcome: 'cancelled' };
      let copyOnly = false;
      // Language-neutral default name of a copy; the main process does not know the UI language.
      const copyTarget = async (): Promise<string | null> => {
        const chosen = await dialogs.saveAs(win, `${stem(desc)} (2).pdf`);
        return chosen ? ensurePdfExtension(chosen) : null;
      };
      try {
        const risk = await signatureRisk(rec, target);
        if (risk === 'cancel') return { outcome: 'cancelled' };
        const newer = risk === 'saveCopy' ? 'saveCopy' : await overwriteNewerChoice(rec, target);
        if (newer === 'cancel') return { outcome: 'cancelled' };
        if (newer === 'saveCopy') {
          const copy = await copyTarget();
          if (!copy) return { outcome: 'cancelled' };
          target = copy;
          copyOnly = true;
        }
      } catch (err) {
        return failed(err, 'pdf.errors.saveFailed');
      }
      // Two tabs bound to one file would overwrite each other's saves (office saves refuse this too).
      if (openElsewhere(docId, target)) return { outcome: 'failed', errorKey: 'errors.save.targetOpen' };
      const written = target;
      registry.emit({ type: 'busy', docId, busy: true, reason: 'saving' });
      try {
        await writeUserFile(
          docId,
          written,
          copyOnly
            ? undefined
            : async () => {
                const stamp = stampOf(await statOrNull(written));
                const doc = registry.update(docId, { path: written, title: basename(written), modified: false, format: 'pdf', readOnly: false });
                registry.setDiskStamp?.(docId, stamp);
                registry.emit({ type: 'updated', doc });
              },
        );
        if (copyOnly) return { outcome: 'savedCopy', path: written, format: 'pdf' };
        return { outcome: 'saved', path: written, format: 'pdf' };
      } catch (err) {
        log.error('pdf save failed', { docId, error: errorMessage(err) });
        return failed(err, 'pdf.errors.saveFailed');
      } finally {
        registry.emit({ type: 'busy', docId, busy: false });
      }
    },

    insertText(docId: string, items: PdfTextInsert[]) {
      return transform(docId, 'text inserted', (bytes) => insertTextItems(bytes, items, fonts));
    },

    insertImage(docId: string, item: PdfImageInsert) {
      return transform(docId, 'image inserted', (bytes) => insertImageItem(bytes, item));
    },

    pages(docId: string, ops: PdfPageOp[]) {
      return transform(docId, 'pages changed', (bytes) => applyPageOps(bytes, ops));
    },

    async merge(docId, paths, win) {
      requireRecord(docId);
      const files = paths && paths.length > 0 ? paths : await dialogs.openPdfs(win);
      if (files.length === 0) throw new PdfServiceError('pdf.errors.cancelled');
      const sources: MergeSource[] = [];
      for (const path of files) {
        try {
          sources.push({ name: basename(path), bytes: await readBytes(path) });
        } catch (err) {
          throw new PdfServiceError('pdf.errors.mergeParse', `${basename(path)}: ${errorMessage(err)}`);
        }
      }
      return transform(docId, 'documents merged', (bytes) => appendDocuments(bytes, sources));
    },

    async extract(docId, pageIndices, win) {
      try {
        requireRecord(docId);
        // The extracted pages include edits pdf.js has not pushed yet.
        await registry.requestFlush?.(docId);
        const rec = requireRecord(docId);
        const out = await lock.run(docId, async () => {
          const bytes = await readBytes(requireRecord(docId).workingCopyPath);
          return extractDocument(bytes, pageIndices);
        });
        const chosen = await dialogs.saveAs(win, `${stem(rec.descriptor)}_${pageRangeLabel(pageIndices)}.pdf`);
        if (!chosen) return { outcome: 'cancelled' };
        const target = ensurePdfExtension(chosen);
        if (rec.descriptor.path && samePath(rec.descriptor.path, target)) {
          throw new PdfServiceError('pdf.errors.extractSameFile');
        }
        if (openElsewhere(docId, target)) return { outcome: 'failed', errorKey: 'errors.save.targetOpen' };
        await safeWrite(target, (tmp) => writeFile(tmp, out), {
          verify: async (tmp) => {
            await verifyPdfFile(tmp, { pageCount: pageIndices.length });
          },
        });
        log.info('pdf pages extracted', { docId, pages: pageIndices.length, bytes: out.length });
        return { outcome: 'savedCopy', path: target, format: 'pdf' };
      } catch (err) {
        log.warn('pdf extract failed', { docId, error: errorMessage(err) });
        return failed(err, 'pdf.errors.extractFailed');
      }
    },

    async print(docId: string, win: BrowserWindow | null, pages?: PdfPrintPage[]) {
      const rec = requireRecord(docId);
      await printRenderedPages(validatePrintPages(pages), rec.descriptor.title, win, log);
    },

    markModified(docId: string) {
      // Not under the lock: it must count at once, even while a pdf:update or a save of the document runs.
      if (!requireRecord(docId).descriptor.modified) markModified(docId);
    },
  };
}
