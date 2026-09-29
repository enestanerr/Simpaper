/** `documents:*` handlers. */
import type { DocumentChannels, PromptAnswer } from '@shared/api/documents';
import { FORMATS, type FormatId } from '@shared/formats';
import { MODULE_KINDS } from '@shared/modules';
import type { Handler } from '../router';
import type { IpcServices } from '../services';
import { absolutePath, bool, docId, none, nullable, obj, oneOf, opt, optionalObj, req, str, type Validator } from '../validate';

const FORMAT_IDS = FORMATS.map((f) => f.id) as FormatId[];
const kind = oneOf(MODULE_KINDS);

// No `path`: target files are chosen in the native dialogs only. SaveOptions.path / PdfExportOptions.path are
// for callers inside the main process (tests); a renderer-supplied path would bypass the dialog (and its
// overwrite confirmation) and let an untrusted renderer write any file.
const saveOptions = obj({ saveAs: opt(bool), format: opt(oneOf(FORMAT_IDS)) });
const pdfOptions = obj({
  openAfter: opt(bool),
  pdfA: opt(bool),
  taggedPdf: opt(bool),
  bookmarks: opt(bool),
  hybrid: opt(bool),
});

const answerByKind: Record<PromptAnswer['kind'], Validator<unknown>> = {
  password: obj({ kind: req(oneOf(['password'] as const)), password: req(nullable(str({ max: 1024 }))) }),
  saveRisk: obj({ kind: req(oneOf(['saveRisk'] as const)), choice: req(oneOf(['saveCopy', 'saveAnyway', 'saveOdf', 'cancel'] as const)) }),
  unsavedChanges: obj({ kind: req(oneOf(['unsavedChanges'] as const)), choice: req(oneOf(['save', 'discard', 'cancel'] as const)) }),
  overwriteNewer: obj({ kind: req(oneOf(['overwriteNewer'] as const)), choice: req(oneOf(['overwrite', 'saveCopy', 'cancel'] as const)) }),
  closeStuck: obj({ kind: req(oneOf(['closeStuck'] as const)), choice: req(oneOf(['close', 'cancel'] as const)) }),
  csvImport: obj({ kind: req(oneOf(['csvImport'] as const)), separator: req(nullable(str({ min: 1, max: 4 }))), locale: req(str({ max: 16 })) }),
};

const promptAnswer: Validator<PromptAnswer> = (v, path) => {
  const k = (v as { kind?: unknown } | null)?.kind;
  const validator = typeof k === 'string' ? answerByKind[k as PromptAnswer['kind']] : undefined;
  if (!validator) return oneOf(Object.keys(answerByKind))(k, `${path}.kind`) as never;
  return validator(v, path) as PromptAnswer;
};

const docReq = obj({ docId: req(docId) });

export function documentHandlers(s: IpcServices): Record<keyof DocumentChannels, Handler> {
  const d = s.documents;
  return {
    'documents:list': (p) => {
      none(p, 'req');
      return d.descriptors();
    },
    'documents:create': (p) => d.create(obj({ kind: req(kind) })(p, 'req').kind),
    'documents:openDialog': (p) => d.openDialog(optionalObj({ kind: opt(kind) })(p, 'req').kind),
    'documents:open': (p) => d.open(obj({ path: req(absolutePath) })(p, 'req').path),
    'documents:recent': (p) => {
      none(p, 'req');
      return s.recent.list();
    },
    'documents:save': (p) => {
      const r = obj({ docId: req(docId), options: opt(saveOptions) })(p, 'req');
      return d.save(r.docId, r.options ?? {});
    },
    'documents:exportPdf': (p) => {
      const r = obj({ docId: req(docId), options: opt(pdfOptions) })(p, 'req');
      return d.exportPdf(r.docId, r.options ?? {});
    },
    'documents:close': (p) => {
      const r = obj({ docId: req(docId), force: opt(bool) })(p, 'req');
      return d.close(r.docId, r.force ?? false);
    },
    'documents:activate': (p) => {
      d.activate(docReq(p, 'req').docId);
    },
    'documents:answerPrompt': (p) => {
      const r = obj({ promptId: req(str({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ })), answer: req(promptAnswer) })(p, 'req');
      d.answerPrompt(r.promptId, r.answer);
    },
    'documents:print': (p) => d.print(docReq(p, 'req').docId),
    'documents:restartEngine': (p) => d.restartEngine(docReq(p, 'req').docId),
    // Answer to a `flushRequest` event (pending pdf.js edits were pushed); unknown ids are ignored.
    'documents:flushDone': (p) => {
      d.flushDone(obj({ requestId: req(str({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ })) })(p, 'req').requestId);
    },
  };
}
