/**
 * Composition root of the main process:
 * logger → settings → platform → engine manager → document service → recovery → PDF service → IPC → window.
 * Factories of the engine, platform and PDF layers and the ribbon command allow-list are injected
 * (src/main/index.ts), which keeps this module testable and free of layer-specific imports.
 *
 * Platform integration (docs/dev/platform.md §2): the platform is created before any engine process; the
 * engine layer adopts its processes into the ProcessGuard (default mode `adopt`); document views are
 * attached/detached by the DocumentService; the view host follows the window itself (window events and
 * WM_DPICHANGED/WM_WINDOWPOSCHANGED hooks — no other module may hook those two messages); the hang watchdog
 * probes visible views; `WindowState.active` uses ViewHost.isForeground; the experimental shell-key hook
 * runs only when `settings.ui.documentKeyTips` is on.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, session, shell } from 'electron';
import type { UiLanguage } from '@shared/api/app';
import { BRAND } from '@shared/brand';
import type { OfficeKind } from '@shared/modules';
import { createCompatAnalyzer } from '../compat/analyzer';
import { createFontCatalog } from '../compat/fonts';
import { RecentFilesStore } from '../documents/recentFiles';
import { documentLocale, DocumentService } from '../documents/service';
import type { DocumentRegistry, SafeWriter } from '../documents/types';
import type { EngineManager, EngineManagerOptions } from '../engine/types';
import { randomToken, removeQuietly } from '../files/fsUtil';
import { createSafeWriter } from '../files/safeWrite';
import { WorkingCopyStore } from '../files/workingCopies';
import { createEventSender } from '../ipc/events';
import { createHandlers, createIpcRouter } from '../ipc/router';
import { createSenderValidator, isAppUrl } from '../ipc/sender';
import { createLogger, createRotatingFileSink, setLogSink, type Logger } from '../log';
import type { PdfService } from '../pdf/types';
import type { Platform, ProcessGuard, ShellKey } from '../platform/types';
import { RecoveryService } from '../recovery/service';
import { SettingsStore } from '../settings/store';
import { trackActiveState, type ActiveStateTracker, type TrackedWindow } from './activeState';
import { createAppController, createEngineProbe } from './appController';
import { filesFromArgv, isSecondInstanceData, type SecondInstanceData } from './argv';
import { createDialogs, type PdfDialogs } from './dialogs';
import { engineFontFolders } from './engineDirs';
import { resolveAppPaths } from './paths';
import { QuitController } from './quit';
import { hardenSession, hardenWebContents } from './security';
import { applySettingsChange } from './settingsEffects';
import { forwardShellKey } from './shellKeys';
import { SmokeErrorCollector, startSmoke } from './smoke';
import { readTestMode } from './testMode';
import { applyChromeTheme, createMainWindow, loadApp, resolveAppEntry } from './window';

export interface PdfServiceFactoryDeps {
  registry: DocumentRegistry;
  safeWrite: SafeWriter;
  log: Logger;
  fontFiles: () => string[];
  dialogs: PdfDialogs;
}

/** Layer factories implemented outside the main-process core. */
export interface Factories {
  createEngineManager(opts: EngineManagerOptions, deps: { processGuard: ProcessGuard; log: Logger }): EngineManager;
  createPlatform(): Platform;
  createPdfService(deps: PdfServiceFactoryDeps): PdfService;
  isAllowedUnoCommand(kind: OfficeKind, command: string): boolean;
  isSubscribableUnoCommand?(kind: OfficeKind, command: string): boolean;
}

const STARTUP_FAILED: Record<UiLanguage, [string, string]> = {
  tr: ['Varak başlatılamadı', 'Uygulama başlatılırken beklenmeyen bir hata oluştu. Ayrıntılar günlük dosyasındadır:'],
  en: ['Varak could not start', 'An unexpected error occurred while starting. Details are in the log file:'],
};

/** UI language for a first run, from the OS locale (Turkish systems get Turkish, others English). */
function systemLanguage(): UiLanguage {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  } catch {
    return 'tr';
  }
}

function listFontFiles(dirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    try {
      for (const f of readdirSync(d)) if (/\.(ttf|otf|ttc)$/i.test(f)) out.push(join(d, f));
    } catch {
      // folder missing
    }
  }
  return out;
}

/** BrowserWindow → the event surface the active-state tracker needs (its typed overloads reject a union). */
function trackedWindow(win: BrowserWindow): TrackedWindow {
  const emitter = win as unknown as NodeJS.EventEmitter;
  return {
    isDestroyed: () => win.isDestroyed(),
    isFocused: () => win.isFocused(),
    isMinimized: () => win.isMinimized(),
    isVisible: () => win.isVisible(),
    isMaximized: () => win.isMaximized(),
    isFullScreen: () => win.isFullScreen(),
    on: (event, listener) => emitter.on(event, listener),
    removeListener: (event, listener) => emitter.removeListener(event, listener),
  };
}

export function bootstrap(factories: Factories): void {
  const testMode = readTestMode();
  const folder = app.isPackaged ? BRAND.dataFolder : `${BRAND.dataFolder}-dev`;
  const paths = resolveAppPaths(
    testMode.dataDir
      ? { appData: testMode.dataDir, localAppData: testMode.dataDir, folderName: folder }
      : { appData: app.getPath('appData'), ...(process.env['LOCALAPPDATA'] ? { localAppData: process.env['LOCALAPPDATA'] } : {}), folderName: folder },
  );
  app.setPath('userData', paths.userData);
  app.setPath('sessionData', paths.sessionData);

  const fileLog = createRotatingFileSink({ dir: paths.logs, minLevel: process.env['VARAK_DEBUG'] ? 'debug' : 'info', mirrorToConsole: !app.isPackaged });
  const smokeErrors = testMode.smoke ? new SmokeErrorCollector() : null;
  setLogSink(
    smokeErrors
      ? (level, scope, message, meta) => {
          fileLog.sink(level, scope, message, meta);
          if (level === 'error') smokeErrors.record(scope, message, meta);
        }
      : fileLog.sink,
  );
  const log = createLogger('main');
  process.on('uncaughtException', (err) => log.error('uncaught exception', { error: err }));
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { error: reason }));
  if (testMode.hiddenViews || testMode.dataDir) log.info('test mode', { hiddenViews: testMode.hiddenViews, isolatedData: testMode.dataDir !== null, smoke: testMode.smoke !== null });

  // The lock lives in userData, so an isolated data folder (tests) never collides with a running instance.
  const instanceData: SecondInstanceData = { argv: process.argv, cwd: process.cwd() };
  if (!app.requestSingleInstanceLock(instanceData)) {
    log.info('another instance is running; files were forwarded to it');
    app.quit();
    return;
  }
  app.setAppUserModelId(BRAND.appId);

  const safeWrite = createSafeWriter({ log: log.child('safeWrite') });
  const settings = new SettingsStore({ file: paths.settingsFile, safeWrite, log: log.child('settings'), initialLanguage: systemLanguage() });
  // The view mode is fixed for the whole run: child-window hosting needs GDI redirection in Chromium ≥ 139,
  // and that switch can only be set before the app is ready (docs/adr/0003-document-surface.md).
  const viewMode = settings.get().engine.viewMode;
  if (viewMode === 'child' && !testMode.hiddenViews) app.commandLine.appendSwitch('disable-features', 'RemoveRedirectionBitmap');

  // Command-line files are only honoured in normal runs (a smoke run has a fixed script).
  const pendingFiles = testMode.smoke ? [] : filesFromArgv(process.argv, process.cwd(), app.isPackaged);
  let openFiles: ((files: string[]) => void) | null = null;
  let getWindow: () => BrowserWindow | null = () => null;
  app.on('second-instance', (_event, argv, cwd, data) => {
    if (testMode.smoke) return;
    const src = isSecondInstanceData(data) ? data : { argv, cwd };
    const files = filesFromArgv(src.argv, src.cwd, app.isPackaged);
    const w = getWindow();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
    if (openFiles) openFiles(files);
    else pendingFiles.push(...files);
  });

  /** Exit code of the process (the smoke run sets 1 when a check failed). */
  let exitCode = 0;

  const start = async () => {
    Menu.setApplicationMenu(null);
    const s = settings.get();
    nativeTheme.themeSource = s.theme;
    if (settings.needsWrite) void settings.persist().catch(() => undefined);

    const sessionId = randomToken(6);
    const workingCopies = new WorkingCopyStore(paths.work, sessionId, log.child('work'));
    void workingCopies.cleanupStale();
    void removeQuietly(paths.scratch);
    const recent = new RecentFilesStore({ file: paths.recentFile, safeWrite, limit: () => settings.get().recentLimit, log: log.child('recent') });

    // Before any engine process exists: the engine layer adopts every process it starts into the guard's job.
    const platform = factories.createPlatform();
    const engine = factories.createEngineManager(
      {
        ...(s.engine.programDir ? { programDir: s.engine.programDir } : {}),
        profilesRoot: paths.engineProfiles,
        uiLanguage: s.language,
        documentLocale: documentLocale(s.language),
        appearance: s.theme,
        // Test runs: no windows at all, and no idle spare instance.
        warmSpare: !testMode.hiddenViews,
        ...(testMode.hiddenViews ? { headless: true } : {}),
      },
      { processGuard: platform.processGuard, log: log.child('engine') },
    );
    const probe = createEngineProbe(() => engine);
    let engineProgramDir: string | null = null;
    let engineFontDirs: string[] = [];
    let pdfFontDirs: string[] = [];
    const compat = createCompatAnalyzer({ fonts: createFontCatalog({ engineFontDirs: () => engineFontDirs }), log: log.child('compat') });
    const dialogs = createDialogs(() => settings.get().language);
    const entry = resolveAppEntry(import.meta.dirname);
    const appUrlOk = (url: string) => isAppUrl(url, entry.appUrl);

    let win: BrowserWindow | null = null;
    getWindow = () => (win && !win.isDestroyed() ? win : null);
    const sendEvent = createEventSender(getWindow);
    let quit: QuitController | null = null;

    const documents = new DocumentService({
      engine,
      viewHost: platform.viewHost,
      compat,
      safeWrite,
      workingCopies,
      recent,
      dialogs,
      settings: () => settings.get(),
      getWindow,
      send: (e) => sendEvent('documents:event', e),
      log: log.child('documents'),
      scratchDir: paths.scratch,
      defaultDir: () => app.getPath('documents'),
      requestQuit: () => void quit?.requestQuit(),
      viewMode: testMode.hiddenViews ? () => 'hidden' as const : () => viewMode,
      // Restarting a hung engine: kill soffice at once (LibreOffice's own helpers go with it; programs it
      // opened for the user, outside its program folder, survive).
      killProcessTree: (pid) => platform.processGuard.killTree(pid, { ...(engineProgramDir ? { imageDir: engineProgramDir } : {}), timeoutMs: 5_000 }),
    });
    const recovery = new RecoveryService({ root: paths.recovery, sessionId, documents, safeWrite, settings: () => settings.get(), log: log.child('recovery') });
    documents.setLifecycleHooks(recovery);
    const pdf = factories.createPdfService({ registry: documents, safeWrite, log: log.child('pdf'), fontFiles: () => listFontFiles(pdfFontDirs), dialogs: dialogs.pdf });
    documents.setPdfService(pdf);
    // Visible views every 2.5 s, 1 s per probe, hung after two failed probes (docs/dev/platform.md §2.6).
    const hangWatch = documents.watchHangs(platform.hangDetector);

    const openQueue = async (files: string[]) => {
      for (const f of files) {
        try {
          await documents.open(f);
        } catch (err) {
          const key = (err as { errorKey?: string }).errorKey ?? 'errors.open.failed';
          if (key !== 'errors.open.cancelled') sendEvent('documents:event', { type: 'error', docId: null, errorKey: key, detail: f.split(/[\\/]/).pop() ?? f });
        }
      }
    };
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      if (openFiles) return;
      openFiles = (files) => void openQueue(files);
      void openQueue(pendingFiles.splice(0));
      // Startup notices go out once the renderer listens.
      void recovery.list().then((entries) => {
        if (entries.length) sendEvent('documents:event', { type: 'notice', docId: null, noticeKey: 'errors.recovery.available', detail: String(entries.length) });
      });
      void probe.probe().then((p) => {
        if (!p.available) sendEvent('documents:event', { type: 'error', docId: null, errorKey: 'errors.engine.unavailable', ...(p.error ? { detail: p.error.slice(0, 300) } : {}) });
      });
    };

    const isForeground = platform.viewHost.supported ? platform.viewHost.isForeground?.bind(platform.viewHost) : undefined;
    const appController = createAppController({
      getWindow,
      settings,
      probeEngine: () => probe.probe(),
      log: log.child('app'),
      ...(isForeground ? { isForeground } : {}),
    });
    let rendererUp = false;
    const router = createIpcRouter({
      handlers: createHandlers({
        app: appController,
        documents,
        recent,
        viewHost: platform.viewHost,
        pdf: () => pdf,
        recovery,
        isAllowedUnoCommand: factories.isAllowedUnoCommand,
        ...(factories.isSubscribableUnoCommand ? { isSubscribableUnoCommand: factories.isSubscribableUnoCommand } : {}),
        allowEngineForeground: (pid) => platform.allowForeground(pid),
        getWindow,
        log: log.child('ipc'),
      }),
      isTrustedSender: createSenderValidator(getWindow, () => entry.appUrl),
      services: {
        log: log.child('ipc'),
        onRendererRequest: () => {
          if (rendererUp) return;
          rendererUp = true;
          flushPending();
        },
      },
    });
    router.register(ipcMain);

    hardenSession(session.defaultSession, appUrlOk, log.child('security'));
    app.on('web-contents-created', (_e, contents) =>
      hardenWebContents(contents, { isAppUrl: appUrlOk, openExternal: (url) => void shell.openExternal(url), log: log.child('security') }),
    );

    // Experimental KeyTips while a native document window has the focus (low-level keyboard hook).
    let shellKeysOn = false;
    // Only while a native document window has the focus (the renderer handles Alt/F10 in its own window).
    const onShellKey = (key: ShellKey) =>
      void forwardShellKey(key, {
        hostFocused: () => getWindow()?.isFocused() ?? false,
        activeDocId: documents.activeDocId,
        kindOf: (docId) => documents.get(docId)?.descriptor.kind,
        emit: (docId, k) => documents.emitShellKey(docId, k),
      });
    const applyShellKeys = () => {
      const keys = platform.shellKeys;
      const w = getWindow();
      const want = Boolean(keys && w && settings.get().ui.documentKeyTips && !testMode.hiddenViews);
      if (want === shellKeysOn || !keys) return;
      try {
        if (want && w) keys.start(w, onShellKey);
        else keys.stop();
        shellKeysOn = want;
        log.info('document key tips', { enabled: want });
      } catch (err) {
        log.warn('shell keys could not be switched', { enabled: want, error: err });
      }
    };

    // engine.programDir is not applied at runtime (settingsEffects.ts): it takes effect at the next start.
    settings.onChange((next, prev) =>
      applySettingsChange(next, prev, {
        setThemeSource: (theme) => (nativeTheme.themeSource = theme),
        engine,
        documentLocale,
        recovery,
        recent,
        applyShellKeys,
        notify: (s) => sendEvent('app:settingsChanged', s),
        log: log.child('settings'),
      }),
    );

    let tracker: ActiveStateTracker | null = null;
    quit = new QuitController({
      documents: {
        flushPending: () => documents.flushPdfEdits(),
        modifiedDocuments: () => documents.modifiedDocuments(),
        activate: (id) => documents.activate(id),
        prompt: (p) => documents.prompt(p),
        lastSnapshotAt: (id) => documents.lastSnapshotAt(id),
        save: (id) => documents.save(id),
        closeAll: () => documents.closeAll(),
        emit: (e) => documents.emit(e),
      },
      recovery,
      disposeServices: async () => {
        if (shellKeysOn) platform.shellKeys?.stop();
        tracker?.stop();
        hangWatch.stop();
        await engine.dispose().catch((err) => log.error('engine dispose failed', { error: err }));
        try {
          platform.viewHost.dispose();
        } catch (err) {
          log.warn('view host dispose failed', { error: err });
        }
        await settings.flush();
        await workingCopies.removeSession();
        await removeQuietly(paths.scratch);
        log.info('shutdown complete', { exitCode });
        fileLog.close();
      },
      exit: () => app.exit(exitCode),
      log: log.child('quit'),
    });
    const quitRef = quit;
    app.on('before-quit', (e) => {
      if (quitRef.state === 'done') return;
      e.preventDefault();
      void quitRef.requestQuit();
    });
    app.on('window-all-closed', () => {
      if (quitRef.state === 'done') app.quit();
    });

    await recovery.start();
    await recovery.scanPrevious();

    // Smoke runs never show the window (docs/dev/main-core.md, "Smoke boot").
    const created = createMainWindow(join(import.meta.dirname, '../preload/index.cjs'), { show: !testMode.smoke });
    win = created;
    tracker = trackActiveState({
      win: trackedWindow(created),
      ...(isForeground ? { isForeground: () => isForeground(created) } : {}),
      hasNativeViews: () => documents.hasNativeViews(),
      push: (state) => sendEvent('app:windowState', state),
    });
    // The view host follows the window itself (move/resize/…, WM_DPICHANGED, WM_WINDOWPOSCHANGED); display
    // configuration changes that do not move the window are passed on here.
    screen.on('display-metrics-changed', () => {
      try {
        if (!created.isDestroyed()) platform.viewHost.syncAll(created);
      } catch (err) {
        log.warn('view sync failed', { error: err });
      }
    });
    nativeTheme.on('updated', () => applyChromeTheme(created));
    created.on('close', (e) => {
      if (quitRef.state === 'done') return;
      e.preventDefault();
      void quitRef.requestQuit();
    });
    created.on('closed', () => {
      documents.cancelPrompts();
      tracker?.stop();
      win = null;
    });
    created.on('session-end', () => {
      // Windows is logging off/shutting down: no prompts are possible; take a last snapshot.
      log.warn('session ending');
      void recovery.snapshotAll();
    });
    let reloads = 0;
    created.webContents.on('render-process-gone', (_e, details) => {
      log.error('renderer process gone', { reason: details.reason, exitCode: details.exitCode });
      if (details.reason !== 'clean-exit' && reloads < 3 && !created.isDestroyed()) {
        reloads++;
        created.reload();
      }
    });
    created.webContents.on('did-finish-load', () => {
      documents.resendPrompts();
      // Fallback when the renderer never calls the main process (e.g. a broken build): open files anyway.
      if (!openFiles) flushTimer = setTimeout(flushPending, 5_000);
    });
    created.on('unresponsive', () => log.warn('window unresponsive'));
    if (!app.isPackaged && !testMode.smoke) {
      created.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') {
          created.webContents.toggleDevTools();
          e.preventDefault();
        }
      });
    }
    applyShellKeys();

    void probe.probe().then((p) => {
      // Fonts the engine loads privately (font check) and font files for the PDF module's text insertion.
      if (p.programDir) {
        engineProgramDir = p.programDir;
        const dirs = engineFontFolders(p.programDir);
        engineFontDirs = dirs.engine;
        pdfFontDirs = dirs.pdf;
      }
      log.info('engine probe', { available: p.available, officeVersion: p.officeVersion });
    });

    if (testMode.smoke && smokeErrors) {
      const smoke = testMode.smoke;
      void startSmoke({
        win: created,
        options: smoke,
        mainErrors: smokeErrors,
        log: log.child('smoke'),
        finish: (code) => {
          exitCode = code;
          // No prompts in a smoke run: documents were closed by the script (or are discarded here).
          void quitRef.shutdown();
        },
      });
      // Last resort: never outlive the budget, even if shutdown hangs (the process guard's job ends the engines).
      setTimeout(() => {
        log.error('smoke run did not finish; exiting');
        app.exit(1);
      }, 330_000).unref();
    }

    await loadApp(created, entry);
  };

  app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      log.error('startup failed', { error: err });
      if (testMode.smoke) {
        console.log(`[varak-smoke] FAILED: startup failed: ${err instanceof Error ? err.message : String(err)}`);
        app.exit(1);
        return;
      }
      const [title, body] = STARTUP_FAILED[settings.get().language];
      dialog.showErrorBox(title, `${body}\n${fileLog.path}`);
      app.exit(1);
    });
}
