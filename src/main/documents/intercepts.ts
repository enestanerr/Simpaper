/**
 * Commands the bridge intercepts inside a document frame (INTERCEPTED_COMMANDS) and how Varak
 * handles them: file commands go through our own safe pipelines and dialogs; commands with a shell page
 * (options, about, the PDF export page with its options) are forwarded to the renderer as `intercept`
 * events; help, mail, template and macro commands are refused with a notice (macros are never executed).
 */
import type { CloseOutcome, DocumentDescriptor, DocumentEvent, SaveOptions, SaveResult } from '@shared/api/documents';
import { isOfficeKind, type ModuleKind } from '@shared/modules';

export interface InterceptTarget {
  kindOf(docId: string): ModuleKind | undefined;
  save(docId: string, options?: SaveOptions): Promise<SaveResult>;
  exportPdf(docId: string): Promise<SaveResult>;
  openDialog(kind?: ModuleKind): Promise<DocumentDescriptor[]>;
  create(kind: ModuleKind): Promise<DocumentDescriptor>;
  close(docId: string): Promise<CloseOutcome>;
  modifiedDocIds(): string[];
  quit(): void;
  emit(event: DocumentEvent): void;
}

const MACRO_COMMANDS = new Set(['.uno:RunMacro', '.uno:MacroDialog', '.uno:ScriptOrganizer']);
// `.uno:About`, `.uno:OptionsTreeDialog` and `.uno:ExportToPDF` (the export page with its options) fall through
// to the renderer, which opens the matching backstage page (src/renderer/services/bootstrap.ts handleIntercept).
const UNAVAILABLE_COMMANDS = new Set([
  '.uno:HelpIndex',
  '.uno:ExtendedHelp',
  '.uno:SendMail',
  '.uno:SaveAsTemplate',
  '.uno:OpenTemplate',
]);

export async function handleIntercept(target: InterceptTarget, docId: string, command: string): Promise<void> {
  const reportSave = (r: SaveResult) => {
    if (r.outcome === 'failed') target.emit({ type: 'error', docId, errorKey: r.errorKey ?? 'errors.save.failed', ...(r.errorDetail ? { detail: r.errorDetail } : {}) });
  };
  const kind = target.kindOf(docId);
  switch (command) {
    case '.uno:Save':
      reportSave(await target.save(docId));
      return;
    case '.uno:SaveAs':
      reportSave(await target.save(docId, { saveAs: true }));
      return;
    case '.uno:SaveAll':
      for (const id of target.modifiedDocIds()) reportSave(await target.save(id));
      return;
    case '.uno:ExportDirectToPDF':
      reportSave(await target.exportPdf(docId));
      return;
    case '.uno:Open':
      await target.openDialog();
      return;
    case '.uno:NewDoc':
    case '.uno:AddDirect':
      if (kind && isOfficeKind(kind)) await target.create(kind);
      return;
    case '.uno:CloseDoc':
    case '.uno:CloseWin':
      await target.close(docId);
      return;
    case '.uno:Quit':
      target.quit();
      return;
    case '.uno:OpenRemote':
      target.emit({ type: 'notice', docId, noticeKey: 'errors.command.remoteUnsupported' });
      return;
    default:
      if (MACRO_COMMANDS.has(command)) target.emit({ type: 'notice', docId, noticeKey: 'errors.command.macrosDisabled' });
      else if (UNAVAILABLE_COMMANDS.has(command)) target.emit({ type: 'notice', docId, noticeKey: 'errors.command.unavailable' });
      else target.emit({ type: 'intercept', docId, command });
  }
}
