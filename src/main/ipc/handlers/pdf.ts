/** `pdf:*` handlers: validation, then delegation to the PDF service (src/main/pdf). */
import type { PdfChannels, PdfPrintPage } from '@shared/api/pdf';
import { DocumentError } from '../../documents/errors';
import type { PdfService } from '../../pdf/types';
import type { Handler } from '../router';
import type { IpcServices } from '../services';
import { arr, bool, bytes, docId, int, IpcValidationError, num, obj, oneOf, opt, req, str, type Validator } from '../validate';

const MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024 - 1;
const MAX_IMAGE_BYTES = 200 * 1024 * 1024;
const MAX_PRINT_PAGES = 20_000;
/** PDF limits page sizes to 14 400 user units (200 in). */
const MAX_PAGE_PT = 14_400;

const textItem = obj({
  pageIndex: req(int(0, 1_000_000)),
  x: req(num(-1e6, 1e6)),
  y: req(num(-1e6, 1e6)),
  text: req(str({ max: 100_000 })),
  fontSize: req(num(0.5, 1000)),
  color: req(str({ min: 1, max: 64 })),
});

const imageItem = obj({
  pageIndex: req(int(0, 1_000_000)),
  x: req(num(-1e6, 1e6)),
  y: req(num(-1e6, 1e6)),
  width: req(num(0, 1e6)),
  height: req(num(0, 1e6)),
  data: req(bytes(MAX_IMAGE_BYTES)),
  mime: req(oneOf(['image/png', 'image/jpeg'] as const)),
});

const printPage = obj({
  data: req(bytes(MAX_IMAGE_BYTES)),
  mime: req(oneOf(['image/png', 'image/jpeg'] as const)),
  widthPt: req(num(1, MAX_PAGE_PT)),
  heightPt: req(num(1, MAX_PAGE_PT)),
});

/** Rendered pages of `pdf:print`, at most MAX_PDF_BYTES in total. */
const printPages: Validator<PdfPrintPage[]> = (v, path) => {
  const pages = arr(printPage, MAX_PRINT_PAGES)(v, path);
  let total = 0;
  for (const page of pages) total += page.data.byteLength;
  if (total > MAX_PDF_BYTES) throw new IpcValidationError(path);
  return pages;
};

const pageOp = obj({
  op: req(oneOf(['rotate', 'delete', 'move', 'insertBlank', 'duplicate'] as const)),
  pageIndex: req(int(0, 1_000_000)),
  value: opt(int(-1_000_000, 1_000_000)),
});

export function pdfHandlers(s: IpcServices): Record<keyof PdfChannels, Handler> {
  /** The PDF service, for a document that is open in the PDF module. */
  const pdfDoc = (id: string): PdfService => {
    const record = s.documents.get(id);
    if (!record) throw new DocumentError('errors.ipc.unknownDocument');
    if (record.descriptor.kind !== 'pdf') throw new DocumentError('errors.ipc.invalidRequest');
    const service = s.pdf();
    if (!service) throw new DocumentError('errors.pdf.unavailable');
    return service;
  };
  const win = () => s.getWindow();

  return {
    'pdf:read': (p) => {
      const r = obj({ docId: req(docId) })(p, 'req');
      return pdfDoc(r.docId).read(r.docId);
    },
    'pdf:update': (p) => {
      const r = obj({ docId: req(docId), bytes: req(bytes(MAX_PDF_BYTES)) })(p, 'req');
      return pdfDoc(r.docId).update(r.docId, r.bytes);
    },
    'pdf:save': (p) => {
      const r = obj({ docId: req(docId), saveAs: opt(bool) })(p, 'req');
      return pdfDoc(r.docId).save(r.docId, r.saveAs ?? false, win());
    },
    'pdf:insertText': (p) => {
      const r = obj({ docId: req(docId), items: req(arr(textItem, 10_000)) })(p, 'req');
      return pdfDoc(r.docId).insertText(r.docId, r.items);
    },
    'pdf:insertImage': (p) => {
      const r = obj({ docId: req(docId), item: req(imageItem) })(p, 'req');
      return pdfDoc(r.docId).insertImage(r.docId, r.item);
    },
    'pdf:pages': (p) => {
      const r = obj({ docId: req(docId), ops: req(arr(pageOp, 100_000)) })(p, 'req');
      return pdfDoc(r.docId).pages(r.docId, r.ops);
    },
    'pdf:merge': (p) => {
      // The files to append are always chosen in the open dialog (no renderer-supplied paths).
      const r = obj({ docId: req(docId) })(p, 'req');
      return pdfDoc(r.docId).merge(r.docId, undefined, win());
    },
    'pdf:extract': (p) => {
      const r = obj({ docId: req(docId), pageIndices: req(arr(int(0, 1_000_000), 1_000_000)) })(p, 'req');
      return pdfDoc(r.docId).extract(r.docId, r.pageIndices, win());
    },
    'pdf:print': (p) => {
      const r = obj({ docId: req(docId), pages: opt(printPages) })(p, 'req');
      return pdfDoc(r.docId).print(r.docId, win(), r.pages);
    },
    // The first pdf.js edit after load or save: the document counts as modified at once (close and quit
    // prompts), before the debounced byte sync (pdf:update) arrives.
    'pdf:markModified': (p) => {
      const r = obj({ docId: req(docId) })(p, 'req');
      pdfDoc(r.docId).markModified(r.docId);
    },
  };
}
