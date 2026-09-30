// @vitest-environment jsdom
// @jsxRuntime automatic
/**
 * Shell smoke tests with a fake preload bridge (`window.simpaperIpc`): start screen, new/open/recent/recovery,
 * document tabs, File backstage pages, prompt dialogs from the main process, message bars and shortcuts.
 * Nothing here opens windows or starts the engine.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInfo, FileTypesStatus, Settings } from '@shared/api/app';
import type { CompatReport, DocumentDescriptor, Prompt, RecentFile } from '@shared/api/documents';
import type { RecoveryEntry } from '@shared/api/recovery';
import { initI18n, setLanguage } from '../../../src/renderer/i18n';
import { calcModule } from '../../../src/renderer/modules/calc';
import { impressModule } from '../../../src/renderer/modules/impress';
import { pdfActions } from '../../../src/renderer/modules/pdf/actions';
import { pdfRibbon } from '../../../src/renderer/modules/pdf/ribbon';
import { registerModules } from '../../../src/renderer/modules/registry';
import type { ModuleDefinition } from '../../../src/renderer/modules/types';
import { writerModule } from '../../../src/renderer/modules/writer';
import { handleDocumentEvent } from '../../../src/renderer/services/bootstrap';
import { activateDocument } from '../../../src/renderer/services/documents';
import { Shell } from '../../../src/renderer/shell/Shell';
import { closeBackstage, enqueuePrompt, openBackstage, setActiveDocId, upsertDocument, useApp } from '../../../src/renderer/state/appStore';
import { descriptor, FakeIpc, flush, installIpc, removeIpc, resetRendererState } from './helpers';

const pdfModule = { kind: 'pdf', ribbon: pdfRibbon, actions: pdfActions, Workspace: () => <div>pdf</div> } as unknown as ModuleDefinition;

const APP_INFO: AppInfo = {
  productName: 'Simpaper',
  version: '0.1.0',
  electronVersion: '44.4.5',
  chromeVersion: '152',
  platform: 'win32',
  locale: 'tr-TR',
  engine: { available: true, programDir: 'C:\\LO\\program', officeVersion: '26.8.0.3' },
  isPackaged: false,
};

let ipc: FakeIpc;

beforeAll(() => {
  registerModules([writerModule, calcModule, impressModule, pdfModule]);
});

beforeEach(async () => {
  resetRendererState();
  initI18n('tr');
  await setLanguage('tr');
  ipc = installIpc(new FakeIpc());
  ipc.handle('documents:recent', () => []);
  ipc.handle('recovery:list', () => []);
  ipc.handle('documents:activate', () => undefined);
  ipc.handle('engine:subscribe', () => []);
  ipc.handle('engine:query', () => ({ docId: 'x', modified: false, title: 'x' }));
  ipc.handle('view:setBounds', () => undefined);
  ipc.handle('view:setVisible', () => undefined);
  ipc.handle('view:focus', () => undefined);
  ipc.handle('app:info', () => APP_INFO);
  ipc.handle('app:settings:update', (req) => ({ ...useApp.getState().settings, ...req }) as Settings);
  ipc.handle('documents:answerPrompt', () => undefined);
});

afterEach(() => {
  cleanup();
  removeIpc();
});

function open(doc: DocumentDescriptor): DocumentDescriptor {
  upsertDocument(doc);
  setActiveDocId(doc.docId);
  return doc;
}

async function renderShell() {
  const view = render(<Shell />);
  await act(flush);
  return view;
}

const answers = () => ipc.callsTo('documents:answerPrompt').map((c) => c.req);

describe('start screen', () => {
  it('offers blank documents, opening files and the recent list, and opens a new document', async () => {
    ipc.handle('documents:create', ({ kind }) => descriptor('c1', kind, { title: 'Hesap Tablosu1' }));
    await renderShell();
    expect(screen.getByRole('heading', { level: 1, name: 'Simpaper' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Boş belge/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Boş sunu/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dosya aç…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PDF aç…' })).toBeTruthy();
    expect(screen.getByText('Henüz dosya açmadınız.')).toBeTruthy();
    expect(ipc.channels()).toEqual(expect.arrayContaining(['documents:recent', 'recovery:list']));

    fireEvent.click(screen.getByRole('button', { name: /Boş hesap tablosu/ }));
    await act(flush);
    expect(ipc.callsTo('documents:create').map((c) => c.req)).toEqual([{ kind: 'calc' }]);
    expect(ipc.callsTo('documents:activate').map((c) => c.req)).toEqual([{ docId: 'c1' }]);
    // The Calc UI replaced the start screen: ribbon, formula bar, document area.
    expect(screen.queryByRole('heading', { level: 1, name: 'Simpaper' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Formüller' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Formül çubuğu' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Belge alanı: Hesap Tablosu1' })).toBeTruthy();
    expect(document.title).toBe('Hesap Tablosu1 — Simpaper');
  });

  it('opens recent files, disables missing ones and offers recovery', async () => {
    const recent: RecentFile[] = [
      { path: 'C:\\Belgeler\\Rapor.docx', title: 'Rapor.docx', kind: 'writer', format: 'docx', openedAt: '2026-09-28T10:00:00Z', exists: true },
      { path: 'D:\\Arşiv\\Eski.xlsx', title: 'Eski.xlsx', kind: 'calc', format: 'xlsx', openedAt: '2026-09-01T10:00:00Z', exists: false },
    ];
    const recovery: RecoveryEntry[] = [
      { id: 's1.d1', kind: 'writer', title: 'Belge1', originalPath: null, originalFormat: null, snapshotAt: '2026-09-29T01:00:00Z', reason: 'engine-crash', sizeBytes: 20480 },
    ];
    ipc.handle('documents:recent', () => recent);
    ipc.handle('recovery:list', () => recovery);
    ipc.handle('documents:open', ({ path }) => descriptor('w1', 'writer', { title: 'Rapor.docx', path }));
    ipc.handle('recovery:restore', () => descriptor('w2', 'writer', { title: 'Belge1', recoveredAt: '2026-09-29T01:00:00Z', modified: true }));
    await renderShell();

    const list = screen.getByRole('list', { name: 'Son kullanılan dosyalar' });
    const missing = within(list).getByRole('button', { name: /Eski\.xlsx/ }) as HTMLButtonElement;
    expect(missing.disabled).toBe(true);
    expect(within(missing).getByText('Dosya bulunamadı')).toBeTruthy();

    expect(screen.getByText('Kaydedilmemiş 1 belge kurtarılabilir.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Göster' }));
    await act(flush);
    const backstage = screen.getByRole('dialog', { name: 'Dosya' });
    expect(within(backstage).getByRole('button', { name: 'Kurtar', current: 'page' })).toBeTruthy();
    expect(within(backstage).getByText('Belge1')).toBeTruthy();
    expect(within(backstage).getByText(/Belge motoru durdu/)).toBeTruthy();
    fireEvent.click(within(backstage).getByRole('button', { name: 'Geri yükle' }));
    await act(flush);
    expect(ipc.callsTo('recovery:restore').map((c) => c.req)).toEqual([{ id: 's1.d1' }]);
    expect(useApp.getState().activeDocId).toBe('w2');
    expect(screen.queryByRole('dialog', { name: 'Dosya' })).toBeNull();

    // Recent files are also on the Open page of the backstage.
    fireEvent.click(screen.getByRole('button', { name: 'Dosya' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Dosya' })).getByRole('button', { name: 'Aç' }));
    fireEvent.click(within(screen.getByRole('list', { name: 'Son kullanılan dosyalar' })).getByRole('button', { name: /Rapor\.docx/ }));
    await act(flush);
    expect(ipc.callsTo('documents:open').map((c) => c.req)).toEqual([{ path: 'C:\\Belgeler\\Rapor.docx' }]);
  });
});

describe('document tabs', () => {
  it('lists open documents as tabs: arrows activate, the close button and Delete close', async () => {
    ipc.handle('documents:close', () => 'closed' as const);
    open(descriptor('w1', 'writer', { title: 'Rapor.docx', modified: true }));
    open(descriptor('p1', 'pdf', { title: 'Sözleşme.pdf' }));
    setActiveDocId('w1');
    await renderShell();
    const tablist = screen.getByRole('tablist', { name: 'Açık belgeler' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['Rapor.docx, Kaydedilmemiş değişiklikler var', 'Sözleşme.pdf']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    await act(flush);
    expect(useApp.getState().activeDocId).toBe('p1');
    expect(ipc.callsTo('documents:activate').map((c) => c.req)).toContainEqual({ docId: 'p1' });
    // The PDF module's ribbon is shown for the PDF tab.
    expect(screen.getByRole('tab', { name: 'Açıklama' })).toBeTruthy();

    fireEvent.click(within(tablist).getByRole('button', { name: 'Rapor.docx belgesini kapat' }));
    await act(flush);
    expect(ipc.callsTo('documents:close').map((c) => c.req)).toEqual([{ docId: 'w1' }]);

    const pdfTab = within(tablist).getAllByRole('tab')[1]!;
    fireEvent.keyDown(pdfTab, { key: 'Delete' });
    await act(flush);
    expect(ipc.callsTo('documents:close').map((c) => c.req)).toEqual([{ docId: 'w1' }, { docId: 'p1' }]);

    fireEvent.keyDown(pdfTab, { key: 'PageUp', ctrlKey: true, shiftKey: true });
    expect(useApp.getState().documents.map((d) => d.docId)).toEqual(['p1', 'w1']);
  });

  it('removes a tab when the main process reports the document closed', async () => {
    open(descriptor('w1', 'writer'));
    open(descriptor('c1', 'calc'));
    await renderShell();
    expect(screen.getAllByRole('tab', { name: /^(w1|c1)\./ })).toHaveLength(2);
    act(() => handleDocumentEvent({ type: 'closed', docId: 'c1' }));
    await act(flush);
    expect(screen.queryByRole('tablist', { name: 'Açık belgeler' })).toBeNull(); // one document: no tab strip
    expect(useApp.getState().activeDocId).toBe('w1');
  });
});

describe('File backstage', () => {
  const compat: CompatReport = {
    format: 'docx',
    analyzedAt: '2026-09-29T00:00:00Z',
    findings: [{ id: 'macros', severity: 'risk', messageKey: 'compat.finding.macros' }],
  };

  it('shows file facts and compatibility, saves as another format and exports PDF', async () => {
    ipc.handle('documents:save', () => ({ outcome: 'saved' as const, path: 'C:\\a\\Rapor.odt', format: 'odt' as const }));
    ipc.handle('documents:exportPdf', () => ({ outcome: 'saved' as const, path: 'C:\\a\\Rapor.pdf' }));
    open(descriptor('w1', 'writer', { title: 'Rapor.docx', path: 'C:\\a\\Rapor.docx', format: 'docx', compat }));
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Dosya' }));
    const backstage = screen.getByRole('dialog', { name: 'Dosya' });
    expect(within(backstage).getByRole('heading', { name: 'Bilgi' })).toBeTruthy();
    expect(within(backstage).getByText('Word Belgesi')).toBeTruthy();
    expect(within(backstage).getByText(/Makro \(VBA\) içeriyor/)).toBeTruthy();
    expect(within(backstage).getByText('Veri kaybı riski:')).toBeTruthy();

    fireEvent.click(within(backstage).getByRole('button', { name: 'Farklı Kaydet' }));
    const docx = within(backstage).getByRole('radio', { name: /^Word Belgesi/ }) as HTMLInputElement;
    expect(docx.checked).toBe(true);
    fireEvent.click(within(backstage).getByRole('radio', { name: /^OpenDocument Metni/ }));
    fireEvent.click(within(backstage).getByRole('button', { name: 'Farklı Kaydet…' }));
    await act(flush);
    expect(ipc.callsTo('documents:save').map((c) => c.req)).toEqual([{ docId: 'w1', options: { saveAs: true, format: 'odt' } }]);
    expect(screen.queryByRole('dialog', { name: 'Dosya' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dosya' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Dosya' })).getByRole('button', { name: 'PDF Olarak Dışa Aktar' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Arşivleme için PDF/A' }));
    fireEvent.click(screen.getByRole('button', { name: 'PDF Olarak Dışa Aktar…' }));
    await act(flush);
    expect(ipc.callsTo('documents:exportPdf').map((c) => c.req)).toEqual([
      { docId: 'w1', options: { openAfter: false, taggedPdf: true, bookmarks: true, pdfA: true, hybrid: false } },
    ]);
    // Success message bar.
    expect(screen.getByText('PDF oluşturuldu: C:\\a\\Rapor.pdf').closest('[role="status"]')).toBeTruthy();
  });

  it('closes with Esc, hides PDF export for PDFs and switches the UI language from Options', async () => {
    open(descriptor('p1', 'pdf', { title: 'Sözleşme.pdf', format: 'pdf' }));
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Dosya' }));
    let backstage = screen.getByRole('dialog', { name: 'Dosya' });
    expect(within(backstage).queryByRole('button', { name: 'PDF Olarak Dışa Aktar' })).toBeNull();
    fireEvent.keyDown(backstage, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Dosya' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dosya' }));
    backstage = screen.getByRole('dialog', { name: 'Dosya' });
    fireEvent.click(within(backstage).getByRole('button', { name: 'Hakkında' }));
    await act(flush);
    expect(within(backstage).getByText('Sürüm 0.1.0')).toBeTruthy();
    expect(within(backstage).getByText('LibreOffice 26.8.0.3')).toBeTruthy();

    fireEvent.click(within(backstage).getByRole('button', { name: 'Seçenekler' }));
    fireEvent.change(within(backstage).getByRole('combobox', { name: 'Arayüz dili' }), { target: { value: 'en' } });
    await act(flush);
    expect(ipc.callsTo('app:settings:update').map((c) => c.req)).toEqual([{ language: 'en' }]);
    expect(document.documentElement.lang).toBe('en');
    expect(within(screen.getByRole('dialog', { name: 'File' })).getByRole('heading', { name: 'Options' })).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /KeyTips while working in a document/ }));
    await act(flush);
    expect(ipc.callsTo('app:settings:update').at(-1)?.req).toEqual({ ui: expect.objectContaining({ documentKeyTips: true }) });
  });

  async function openOptions() {
    closeBackstage();
    open(descriptor('w1', 'writer'));
    await renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Dosya' }));
    const backstage = screen.getByRole('dialog', { name: 'Dosya' });
    fireEvent.click(within(backstage).getByRole('button', { name: 'Seçenekler' }));
    await act(flush);
    return backstage;
  }

  it('Options › File types shows which registered types open with Simpaper and opens Windows Settings', async () => {
    const status: FileTypesStatus = {
      supported: true,
      registration: 'user',
      thisCopy: true,
      groups: [
        { kind: 'writer', extensions: ['docx', 'doc'], withSimpaper: ['docx', 'doc'] },
        { kind: 'calc', extensions: ['xlsx', 'xls'], withSimpaper: ['xls'] },
        { kind: 'impress', extensions: ['pptx'], withSimpaper: [] },
        { kind: 'pdf', extensions: ['pdf'], withSimpaper: [] },
      ],
    };
    ipc.handle('app:fileTypes', () => structuredClone(status));
    ipc.handle('app:openDefaultApps', () => true);
    const backstage = await openOptions();
    const section = within(backstage).getByRole('region', { name: 'Dosya türleri' });
    expect(within(section).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Belgeler.docx .docSimpaper ile açılıyor',
      'Hesap tabloları.xlsx .xls1 / 2 tür Simpaper ile açılıyor',
      'Sunular.pptxBaşka bir uygulamayla açılıyor',
      'PDF dosyaları.pdfBaşka bir uygulamayla açılıyor',
    ]);
    expect(within(section).queryByText(/başka bir Simpaper kurulumunu/)).toBeNull();

    fireEvent.click(within(section).getByRole('button', { name: 'Varsayılan uygulamaları seç…' }));
    await act(flush);
    expect(ipc.callsTo('app:openDefaultApps').map((c) => c.req)).toEqual([undefined]);
    expect(within(section).queryByRole('alert')).toBeNull();

    // Back from Windows Settings: the state is read again.
    status.groups[3]!.withSimpaper = ['pdf'];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(flush);
    expect(within(section).getAllByRole('listitem')[3]!.textContent).toBe('PDF dosyaları.pdfSimpaper ile açılıyor');
  });

  it('Options › File types: a failed Settings launch, another installation, an unregistered copy, no Windows', async () => {
    const status: FileTypesStatus = { supported: true, registration: 'machine', thisCopy: false, groups: [{ kind: 'pdf', extensions: ['pdf'], withSimpaper: [] }] };
    ipc.handle('app:fileTypes', () => structuredClone(status));
    ipc.handle('app:openDefaultApps', () => false);
    let backstage = await openOptions();
    let section = within(backstage).getByRole('region', { name: 'Dosya türleri' });
    expect(within(section).getByText(/başka bir Simpaper kurulumunu başlatıyor/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Varsayılan uygulamaları seç…' }));
    await act(flush);
    expect(within(section).getByRole('alert').textContent).toBe('Windows Ayarları açılamadı.');
    cleanup();

    ipc.handle('app:fileTypes', () => ({ ...status, registration: null }));
    backstage = await openOptions();
    section = within(backstage).getByRole('region', { name: 'Dosya türleri' });
    expect(within(section).getByText(/dosya türlerini Windows'a kaydetmedi/)).toBeTruthy();
    expect(within(section).queryByRole('button')).toBeNull();
    cleanup();

    ipc.handle('app:fileTypes', () => ({ ...status, supported: false }));
    backstage = await openOptions();
    expect(within(backstage).queryByRole('region', { name: 'Dosya türleri' })).toBeNull();
  });
});

describe('prompts from the main process', () => {
  async function prompt(p: Prompt) {
    act(() => handleDocumentEvent({ type: 'prompt', prompt: p }));
    await act(flush);
  }

  it('asks for a password (and says when it was wrong)', async () => {
    await renderShell();
    await prompt({ id: 'p1', kind: 'password', fileName: 'Gizli.xlsx', retry: true });
    const dialog = screen.getByRole('dialog', { name: 'Parola gerekli' });
    expect(within(dialog).getByRole('alert').textContent).toBe('Parola yanlış. Yeniden deneyin.');
    const input = within(dialog).getByLabelText('Parola') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    const ok = within(dialog).getByRole('button', { name: 'Tamam' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'şifre' } });
    fireEvent.click(ok);
    await act(flush);
    expect(answers()).toEqual([{ promptId: 'p1', answer: { kind: 'password', password: 'şifre' } }]);
    expect(screen.queryByRole('dialog', { name: 'Parola gerekli' })).toBeNull();
  });

  it('shows one prompt at a time; Esc answers "cancel"', async () => {
    open(descriptor('w1', 'writer'));
    await renderShell();
    await prompt({ id: 'u1', kind: 'unsavedChanges', docId: 'w1', fileName: 'Rapor.docx' });
    await prompt({ id: 'n1', kind: 'overwriteNewer', docId: 'w1', fileName: 'Rapor.docx' });
    const unsaved = screen.getByRole('alertdialog', { name: 'Değişiklikler kaydedilsin mi?' });
    expect(within(unsaved).getByText('"Rapor.docx" içindeki değişiklikleri kaydetmek istiyor musunuz?')).toBeTruthy();
    expect(document.activeElement).toBe(within(unsaved).getByRole('button', { name: 'Kaydet' }));
    expect(screen.queryByRole('alertdialog', { name: 'Dosya başka bir yerde değiştirildi' })).toBeNull();
    fireEvent.keyDown(unsaved, { key: 'Escape' });
    await act(flush);
    const newer = screen.getByRole('alertdialog', { name: 'Dosya başka bir yerde değiştirildi' });
    fireEvent.click(within(newer).getByRole('button', { name: 'Kopya kaydet…' }));
    await act(flush);
    expect(answers()).toEqual([
      { promptId: 'u1', answer: { kind: 'unsavedChanges', choice: 'cancel' } },
      { promptId: 'n1', answer: { kind: 'overwriteNewer', choice: 'saveCopy' } },
    ]);
  });

  it('blocks the Quick Access Toolbar and the File tab while LibreOffice shows a dialog for the document', async () => {
    // Save or Close from there would run inside LibreOffice's modal dialog (the ribbon was already blocked).
    open(descriptor('w1', 'writer', { modified: true }));
    await renderShell();
    const save = () => screen.getByRole('button', { name: 'Kaydet' });
    const fileTab = () => document.querySelector<HTMLButtonElement>('.rb-filetab')!;
    act(() => useApp.setState({ busy: { w1: { busy: true, reason: 'dialog' } } }));
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(fileTab().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(fileTab());
    await act(flush);
    expect(document.querySelector('.vr-backstage')).toBeNull();
    act(() => useApp.setState({ busy: {} }));
    expect(save().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(fileTab());
    await act(flush);
    expect(document.querySelector('.vr-backstage')).not.toBeNull();
  });

  it('says what is lost before closing a document whose engine hangs; the safe answer is the default', async () => {
    open(descriptor('w1', 'writer'));
    await renderShell();
    const at = new Date(2026, 8, 29, 14, 2).toISOString();
    await prompt({ id: 's1', kind: 'closeStuck', docId: 'w1', fileName: 'Rapor.docx', snapshotAt: at });
    const dialog = screen.getByRole('alertdialog', { name: 'Belge kaydedilemiyor' });
    expect(within(dialog).getByText('"Rapor.docx" belgesinin motoru yanıt vermiyor ya da durdu; belge şu an kaydedilemez.')).toBeTruthy();
    expect(within(dialog).getByText(/^Kapatırsanız saat 14:02 otomatik kaydından sonraki değişiklikler kaybolur\./)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'İptal' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yine de kapat' }));
    await act(flush);
    await prompt({ id: 's2', kind: 'closeStuck', docId: 'w1', fileName: 'Rapor.docx', snapshotAt: null });
    const none = screen.getByRole('alertdialog', { name: 'Belge kaydedilemiyor' });
    expect(within(none).getByText('Kapatırsanız kaydedilmemiş değişiklikler kaybolur; bu belgenin otomatik kaydı yok.')).toBeTruthy();
    fireEvent.keyDown(none, { key: 'Escape' });
    await act(flush);
    expect(answers()).toEqual([
      { promptId: 's1', answer: { kind: 'closeStuck', choice: 'close' } },
      { promptId: 's2', answer: { kind: 'closeStuck', choice: 'cancel' } },
    ]);
  });

  it('explains loss risks before saving and defaults to "save a copy"', async () => {
    open(descriptor('w1', 'writer'));
    await renderShell();
    await prompt({
      id: 'r1',
      kind: 'saveRisk',
      docId: 'w1',
      fileName: 'Rapor.docm',
      format: 'docx',
      findings: [
        { id: 'macros', severity: 'risk', messageKey: 'compat.finding.macros' },
        { id: 'missingFonts', severity: 'warning', messageKey: 'compat.finding.missingFonts', detail: ['Calibri', 'Cambria'] },
      ],
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Bazı içerikler bu biçimde korunamayabilir' });
    expect(within(dialog).getByText(/"Rapor\.docm" Word Belgesi biçiminde kaydedilirse/)).toBeTruthy();
    expect(within(dialog).getByText('Calibri, Cambria')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Kopya kaydet…' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yine de kaydet' }));
    await act(flush);
    expect(answers()).toEqual([{ promptId: 'r1', answer: { kind: 'saveRisk', choice: 'saveAnyway' } }]);
  });

  it('imports CSV with a separator and locale chosen on a live preview', async () => {
    await renderShell();
    await prompt({ id: 'c1', kind: 'csvImport', fileName: 'satışlar.csv', defaultSeparator: ';', preview: ['Ürün;Tutar', '"Çay; demlik";1.234,50', 'Şeker;99,9'] });
    const dialog = screen.getByRole('dialog', { name: 'Metin içe aktarma' });
    const preview = within(dialog).getByRole('region', { name: 'Önizleme' });
    const cells = () => [...preview.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(cells()).toEqual([
      ['Ürün', 'Tutar'],
      ['Çay; demlik', '1.234,50'],
      ['Şeker', '99,9'],
    ]);
    expect((within(dialog).getByRole('combobox', { name: 'Sayı ve tarih biçimleri' }) as HTMLSelectElement).value).toBe('tr-TR');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Virgül ( , )' }));
    expect(cells()[2]).toEqual(['Şeker;99', '9']);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Noktalı virgül ( ; )' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'İçe aktar' }));
    await act(flush);
    expect(answers()).toEqual([{ promptId: 'c1', answer: { kind: 'csvImport', separator: ';', locale: 'tr-TR' } }]);
  });
});

describe('message bars and shortcuts', () => {
  it('shows translated errors from the main process and dismisses them', async () => {
    open(descriptor('w1', 'writer'));
    await renderShell();
    act(() => handleDocumentEvent({ type: 'error', docId: 'w1', errorKey: 'shell.messages.saveFailed', detail: 'E_ACCESS' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Belge kaydedilemedi. Özgün dosyanız değiştirilmedi.');
    expect(alert.textContent).toContain('(E_ACCESS)');
    fireEvent.click(within(alert).getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => handleDocumentEvent({ type: 'error', docId: null, errorKey: 'errors.unknown.thing' }));
    expect(screen.getByRole('alert').textContent).toContain('Bir hata oluştu (errors.unknown.thing).');
  });

  it('offers to restart the engine of a document that stopped responding', async () => {
    ipc.handle('documents:restartEngine', () => undefined);
    open(descriptor('w1', 'writer'));
    await renderShell();
    act(() => handleDocumentEvent({ type: 'error', docId: 'w1', errorKey: 'errors.engine.notResponding' }));
    const alert = screen.getByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Motoru yeniden başlat' }));
    await act(flush);
    expect(ipc.callsTo('documents:restartEngine').map((c) => c.req)).toEqual([{ docId: 'w1' }]);
    expect(screen.queryByRole('alert')).toBeNull();
    // Other errors carry no restart action.
    act(() => handleDocumentEvent({ type: 'error', docId: 'w1', errorKey: 'shell.messages.saveFailed' }));
    expect(within(screen.getByRole('alert')).queryByRole('button', { name: 'Motoru yeniden başlat' })).toBeNull();
  });

  it('keeps one "not responding" bar per document and removes it once the document no longer hangs', async () => {
    open(descriptor('w1', 'writer'));
    await renderShell();
    act(() => handleDocumentEvent({ type: 'updated', doc: descriptor('w1', 'writer', { state: 'busy' }) }));
    const bars = () => [...document.querySelectorAll('.vr-msgbar')].map((b) => b.textContent ?? '');
    act(() => handleDocumentEvent({ type: 'error', docId: 'w1', errorKey: 'errors.engine.notResponding' }));
    act(() => handleDocumentEvent({ type: 'error', docId: 'w1', errorKey: 'errors.engine.notResponding' }));
    expect(bars()).toEqual([expect.stringContaining('Belge motoru yanıt vermiyor')]);
    // Restarted from the rescue box (busy → crashed → restored): the bar and its restart button go away.
    act(() => handleDocumentEvent({ type: 'updated', doc: descriptor('w1', 'writer', { state: 'crashed' }) }));
    expect(bars()).toEqual([]);
    // Answering again (busy → ready) as well; other errors stay.
    act(() => handleDocumentEvent({ type: 'updated', doc: descriptor('w1', 'writer', { state: 'busy' }) }));
    act(() => handleDocumentEvent({ type: 'error', docId: 'w1', errorKey: 'errors.engine.notResponding' }));
    act(() => handleDocumentEvent({ type: 'error', docId: 'w1', errorKey: 'shell.messages.saveFailed' }));
    act(() => handleDocumentEvent({ type: 'updated', doc: descriptor('w1', 'writer', { state: 'ready' }) }));
    expect(bars()).toEqual([expect.stringContaining('Belge kaydedilemedi')]);
  });

  it('Ctrl+S saves the active office document; Ctrl+Z in a text field stays native', async () => {
    ipc.handle('documents:save', () => ({ outcome: 'saved' as const }));
    ipc.handle('engine:dispatch', () => undefined);
    open(descriptor('w1', 'writer'));
    await renderShell();
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    await act(flush);
    expect(ipc.callsTo('documents:save').map((c) => c.req)).toEqual([{ docId: 'w1' }]);
    expect(screen.getByRole('status').textContent).toContain('Kaydedildi.');

    const combo = screen.getByRole('combobox', { name: 'Yazı tipi' });
    fireEvent.keyDown(combo, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await act(flush);
    expect(ipc.callsTo('engine:dispatch')).toEqual([]);
    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await act(flush);
    expect(ipc.callsTo('engine:dispatch').map((c) => c.req)).toEqual([{ docId: 'w1', command: '.uno:Undo' }]);
  });
});

describe('keyboard between Simpaper and the document (GUI check 2026-09-29: a letter for the font box went into the document)', () => {
  it('a press into a text box claims the keyboard; switching ribbon tabs or a focus change without a press does not', async () => {
    ipc.handle('view:focusShell', () => true);
    open(descriptor('w1', 'writer'));
    await renderShell();
    const tab = document.querySelector<HTMLElement>('[data-tab-id="insert"]');
    if (!tab) throw new Error('no Insert tab');
    fireEvent.pointerDown(tab);
    fireEvent.focusIn(tab);
    await act(flush);
    expect(ipc.callsTo('view:focusShell')).toEqual([]);
    const box = screen.getByRole('combobox', { name: 'Yazı tipi' });
    fireEvent.pointerDown(box);
    fireEvent.focusIn(box);
    await act(flush);
    expect(ipc.callsTo('view:focusShell')).toHaveLength(1);
    // Later focus changes that no press started (a component focusing itself) leave the keyboard alone.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 5_000);
    try {
      fireEvent.focusIn(box);
      await act(flush);
      expect(ipc.callsTo('view:focusShell')).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('prompts and the backstage hold the keyboard; the document gets it back when the last one closes', async () => {
    ipc.handle('view:focusShell', () => true);
    open(descriptor('w1', 'writer'));
    await renderShell();
    act(() => openBackstage('info'));
    await act(flush);
    expect(ipc.callsTo('view:focusShell')).toHaveLength(1);
    act(() => enqueuePrompt({ id: 'p1', kind: 'unsavedChanges', docId: 'w1', fileName: 'w1.docx' }));
    await act(flush);
    expect(ipc.callsTo('view:focusShell')).toHaveLength(2);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'İptal' }));
    await act(flush);
    // The backstage is still open: the keyboard stays with it.
    expect(ipc.callsTo('view:focus')).toEqual([]);
    act(() => closeBackstage());
    await act(flush);
    expect(ipc.callsTo('view:focus').map((c) => c.req)).toContainEqual({ docId: 'w1' });
  });

  it('closing the backstage always returns the keyboard to the document, as in Office', async () => {
    // The focus was in Simpaper already (e.g. the font box): nothing was taken, yet the document gets the keyboard.
    ipc.handle('view:focusShell', () => false);
    open(descriptor('w1', 'writer'));
    await renderShell();
    act(() => openBackstage('info'));
    await act(flush);
    expect(ipc.callsTo('view:focus')).toEqual([]);
    act(() => closeBackstage());
    await act(flush);
    expect(ipc.callsTo('view:focus').map((c) => c.req)).toContainEqual({ docId: 'w1' });
  });

  it('gives nothing back when the keyboard was not taken from the document; a PDF tab claims it', async () => {
    ipc.handle('view:focusShell', () => false);
    open(descriptor('w1', 'writer'));
    upsertDocument(descriptor('p1', 'pdf'));
    await renderShell();
    act(() => enqueuePrompt({ id: 'p2', kind: 'unsavedChanges', docId: 'w1', fileName: 'w1.docx' }));
    await act(flush);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'İptal' }));
    await act(flush);
    expect(ipc.callsTo('view:focus')).toEqual([]);
    const before = ipc.callsTo('view:focusShell').length;
    act(() => activateDocument('p1'));
    await act(flush);
    expect(ipc.callsTo('view:focusShell')).toHaveLength(before + 1);
    act(() => activateDocument('w1'));
    await act(flush);
    expect(ipc.callsTo('view:focusShell')).toHaveLength(before + 1);
  });
});
