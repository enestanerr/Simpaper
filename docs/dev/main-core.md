# Main-process core

Composition root, main window, IPC router, document lifecycle, safe save, compatibility analysis,
crash recovery, settings and recent files. Everything here runs in Electron's main process.

## Review fixes (review of 2026-09-29, vendor/research-raw/review-2026-09-29.md)

Checkpoint list of this area's findings (ticked when code + regression test are in):

- [x] #2 settings `engine.programDir` over IPC — `handlers/app.ts` rejects a changed value (unchanged passes),
  `settings/schema.ts` refuses UNC/device/drive-relative paths, `app/settingsEffects.ts` never applies it at runtime.
- [x] #4 edits during save verification marked as saved (main part: `markSaved`, `doc.info`) — `writeOfficeFile`
  stores with `markSaved: true` (real saves only), `modified: false` events are ignored while `saving`, `afterSave`
  takes `doc.info.modified`, a failure after the store sets the flag again.
- [x] #5 renderer-supplied target paths (documents:save/exportPdf `path`, pdf:merge `paths`) — removed from the IPC
  validators (service-level parameters stay for tests); explicit export paths get `.pdf`.
- [x] #10 PDF flush protocol (main part: `pdf:markModified`, `documents:flushDone`, `requestFlush`) — see "PDF flush
  protocol" below.
- [x] #11 VBA passthrough tracking (DOCM/PPTM from ODF snapshots) — `DocRecord.vbaPassthrough`, `savePlan.ts`
  `isVbaPassthroughFormat`.
- [x] #12 text import encoding decided over the whole file — `textImport.ts` `isValidUtf8File` (streamed).
- [x] #13 PDF save guards (targetOpen, overwriteNewer, diskStamp) — `pdf/index.ts` save/extract;
  `DocumentRegistry.diskStampOf/setDiskStamp`.
- [x] #15 re-attached views keep their visibility — `attachView` applies `viewVisible ?? active` before the bounds;
  `ViewHostCore` remembers the visibility of detached views.
- [x] #17 bounded freeze capture, `UV_THREADPOOL_SIZE` — `ViewHostCore.freeze` settles after
  captureTimeout + hideWait at most; `app/threadpool.ts` (first import of the entry) sets 16 threads.
- [x] #18 no shell keys while the BrowserWindow itself is focused — `app/shellKeys.ts`.
- [x] #19 load parameters recomputed after a save — `savePlan.ts` `reloadParams` in `afterSave`.
- [x] #20 recovery snapshots store links absolute (`baseUrl: ''`).
- [x] #21 no unencrypted verification PDF for encrypted documents — no engine re-open for password-protected
  targets (structural checks only).
- [x] #22 engine exits during/after restore loads — `DocRecord.engineLoads`, instance checks before `ready`,
  no kill of ended instances.
- [x] #23 `engine:dispatch` argument allow-list — `UNO_COMMAND_ARGS`/`isAllowedUnoArgs` in `src/shared/commands.ts`,
  no `?` commands.
- [x] #24 recovery entry forgotten only after a protective snapshot — `RecoveryService.unprotected`.

## Progress (session 2, 2026-09-29)

Completion pass after the interrupted first pass — all items done:

1. [x] Real-engine tests `tests/engine/documents-{office,recovery,writer}.test.ts` + harness
   `tests/unit/main/helpers/realEngine.ts` (replace the old scratch runs in `test-output/main-core/integration`).
2. [x] Platform checklist (see "Platform integration"): `view:focus` → engine `view.focus`; hang watchdog per visible
   view; `WindowState.active`; shell keys behind `settings.ui.documentKeyTips`; `documents:restartEngine`; hung
   documents close with a kill; redundant host-event syncs removed.
3. [x] PDF integration: `pdf:print` pages validated and forwarded; `pdf.errors.*` keys reach the renderer; font
   folders `share/fonts/truetype` + admin image `Fonts`; `dialogs.pdf` for saveAs/openPdfs.
4. [x] Smoke boot: `src/main/app/{testMode,smoke}.ts`, `scripts/smoke-boot.mjs`.
5. [x] Lint/type clean in this area, unit tests green, this document.

## Layout

| Path | What it does |
|---|---|
| `src/main/index.ts` | Entry: passes the engine/platform/PDF factories and the ribbon allow-list to `bootstrap()`. Its first import is `app/threadpool.ts`. |
| `src/main/app/threadpool.ts` | `UV_THREADPOOL_SIZE=16` (unless set) before anything queues work on libuv's pool (see "Thread pool"). |
| `src/main/app/bootstrap.ts` | Composition root: logger → settings → platform → engine manager → documents → recovery → PDF → IPC → window. |
| `src/main/app/settingsEffects.ts` | What a settings change does at runtime (theme, engine profile options, autosave, recent list, shell keys). |
| `src/main/app/shellKeys.ts` | Forwards hook-reported Alt/F10 only while a document window (not the Varak window) has the focus. |
| `src/main/app/window.ts`, `theme.ts` | Main window (1280×800, min 900×600, `titleBarStyle: 'hidden'` + `titleBarOverlay`, theme background). |
| `src/main/app/security.ts` | Permission handlers, navigation/new-window blocking, allow-listed external links. |
| `src/main/app/quit.ts` | Graceful quit: unsaved-changes prompts, dispose, clean-shutdown marker, hard timeout. |
| `src/main/app/dialogs.ts`, `strings.ts` | Native open/save dialogs (format filters in Turkish/English). |
| `src/main/app/appController.ts` | `app:*` services (info, settings, window controls, external links). |
| `src/main/app/paths.ts`, `argv.ts` | Data folders; files from the command line / second instance. |
| `src/main/app/activeState.ts` | `WindowState` incl. `active` (ViewHost.isForeground), pushed as `app:windowState`. |
| `src/main/app/testMode.ts`, `smoke.ts` | Test-only switches (`VARAK_VIEW_MODE=hidden`, `VARAK_DATA_DIR`, `VARAK_SMOKE`); smoke boot script. |
| `src/main/app/engineDirs.ts` | Engine font folders (font check; PDF text insertion). |
| `src/main/ipc/` | Router (`router.ts`), sender check (`sender.ts`), payload validators (`validate.ts`), one handler module per namespace. |
| `src/main/documents/service.ts` | `DocumentService` = `DocumentRegistry` + open/create/save/export/close/print, engine events, crash restore, hang watch, engine restart. |
| `src/main/documents/hangWatch.ts` | Watchdog over the visible native views (HangDetector). |
| `src/main/documents/savePlan.ts` | Target format, engine filter + options, loss-risk assessment. |
| `src/main/documents/textImport.ts` | CSV/TSV/TXT: encoding detection, preview, separator guess, FilterOptions. |
| `src/main/documents/verify.ts` | Written-file verification (zip + CRC, compound file, PDF, optional engine re-open). |
| `src/main/documents/prompts.ts` | Prompt round trips (`documents:event` prompt → `documents:answerPrompt`). |
| `src/main/documents/recentFiles.ts` | Recent files (bounded, existence check with timeout). |
| `src/main/files/safeWrite.ts` | SafeWriter: temp sibling → write → fsync → verify → `ReplaceFileW` (koffi) / rename, retries. |
| `src/main/files/workingCopies.ts`, `cfb.ts` | Working copies; compound-file (OLE2) reader. |
| `src/main/compat/` | CompatAnalyzer: container/format sniffing and findings for OOXML, ODF and legacy files; font catalogue. |
| `src/main/recovery/` | RecoveryService: autosave snapshots, manifests, previous-session scan, restore/discard, crash entries. |
| `src/main/settings/` | SettingsStore (validation, migration, atomic writes, change events). |
| `src/main/log.ts` | Logger + rotating file sink (`<local>\logs\varak.log`, 1 MiB × 5). |

## Data locations

- `%APPDATA%\Varak` (roaming): `settings.json`, `recent.json` only (Chromium's session data is kept locally).
- `%LOCALAPPDATA%\Varak`: `engine\` (profiles), `work\<session>\<docId>\` (working copies), `recovery\<session>\`,
  `logs\`, `session\` (Chromium session data), `tmp\` (verification PDFs).
- Unpackaged runs use `Varak-dev` so development never touches real user data.
- `VARAK_DATA_DIR=<absolute dir>` (tests, smoke run) puts all of the above under `<dir>\Varak[-dev]`.

## Document lifecycle

**Open** — `CompatAnalyzer.inspect` reads the magic bytes (zip / compound file / PDF / RTF / text) and the package
(content types, parts, XML markers) and decides the format (the extension wins unless the content contradicts
it). IRM files and password-protected PPT are refused with a clear message. A descriptor is registered in state
`loading` (the renderer can show the tab at once), a working copy is made (read-only attribute cleared), then:
CSV/TSV → `csvImport` prompt (preview, locale-dependent default separator, formula evaluation off);
TXT → `Text (encoded)` options with the detected charset (UTF-8 only when the *whole* file is valid UTF-8 — a
legacy CSV often has thousands of ASCII rows first; the preview shows the first 64 KiB); PPS/PPSX/PPSM →
`editImportFilter`;
encrypted packages → `password` prompt first, and `PASSWORD_REQUIRED`/`WRONG_PASSWORD` from the engine
re-prompt with `retry: true`. `doc.load` gets `baseUrl` = the user's file and view params from
`ViewHost.viewParamsFor(win, settings.engine.viewMode, lastWorkspaceRect)` (or `{ mode: 'hidden' }` with the
`viewMode` override of tests and smoke runs, `VARAK_VIEW_MODE=hidden`); the returned hwnd is attached and gets
the visibility the renderer asked for last (`viewVisible`, else "is the active document") before any bounds —
an engine restart of a background tab must not show its new window over the active one.
Read-only files open for editing but Save becomes Save As.

**Save** — serialised per document:
1. `decideSaveTarget` (Save As for new/read-only documents, format changes, import-only formats → `saveFallback`).
2. `assessSaveRisk`: compat findings whose rule says the target may lose them (`compat/findings.ts`),
   macro loss (target not macro-enabled; ODF→ODF and legacy→legacy keep them; DOCM/PPTM targets keep them only
   while the model still carries the VBA project of the DOCM/PPTM/DOTM/PPSM/POTM it was loaded from —
   `DocRecord.vbaPassthrough`, false after an ODF recovery snapshot and for ODT/ODP Basic or DOC macros; XLSM
   regenerates its project), password protection the target cannot carry, and the target's `knownLosses`.
   Any result → `saveRisk` prompt:
   `saveCopy` (Save As with “<name> (kopya)” / “<name> (copy)”; the document then continues on the copy),
   `saveAnyway` (remembered per path+format for the session), `saveOdf`, `cancel`.
3. `overwriteNewer` prompt when the file changed on disk since it was opened/saved.
4. `chooseFilter`: same format as loaded → reuse the load filter (keeps ECMA vs ISO); else `exportFilter`;
   CSV/TSV/TXT options from settings and the import separator.
5. SafeWriter with `doc.store` (`markSaved: true`: the bridge clears LibreOffice's modified flag in the same
   main-thread job, right after the store) to the hidden temp sibling, verification (zip + CRC ≤ 64 MiB, compound
   file for encrypted OOXML and legacy formats; password-protected ODF from LibreOffice 26.8 has a single
   `encrypted-package` entry instead of `content.xml`) and — when `settings.verifyAfterSave`, < 50 MiB and the
   document has **no password** — a re-open through `EngineManager.convert` to a throwaway PDF (an encrypted
   document would be rendered into an unencrypted PDF, so it gets the structural checks only). Only then
   `ReplaceFileW` replaces the user's file. The `modified: false` event of the store is not applied while the
   document is `saving`; when verification or the replace fails after the store, `doc.setModified(true)` restores
   the flag (the user's file does not have these changes).
6. Descriptor update with the engine's real state (`doc.info.modified`: an edit made during verification keeps
   the document modified, so closing/quitting still asks), `loadParams` recomputed for the written file (a crash
   before the next snapshot reloads it with the target's import filter and UTF-8 text options, not with the
   options of the file it came from), recent files, recovery snapshot removed, compat report refreshed from the
   new file.

**Export PDF** — `PDF_EXPORT_FILTER[kind]`, FilterData `SelectPdfVersion` (2 = PDF/A-2b), `UseTaggedPDF`
(default on), `ExportBookmarks`, `IsAddStream` (hybrid); SafeWriter + PDF header/trailer check; optional open.
The target always ends in `.pdf`.

**Close** — PDFs first get a flush request (below); `unsavedChanges` prompt (save/discard/cancel), `doc.close`
(5 s), `releaseDocumentInstance`, `ViewHost.detach`, working copy removed, recovery snapshot removed. Crashed or
hung (`busy`) documents can't be saved, so a modified one gets the `closeStuck` prompt instead of `unsavedChanges`:
file name and `snapshotAt` (`DocumentLifecycleHooks.lastSnapshotAt` → `RecoveryService.lastSnapshotAt`: the
session manifest whose snapshot file exists, else the restored entry it came from; `null` = no autosave), Cancel
is the default. `QuitController` asks the same for each such document and aborts the quit on Cancel. On "close"
(and for unmodified ones without a prompt) they keep their snapshot for `recovery:list`; a hung engine is killed at
once (`ProcessGuard.killTree` of its soffice.bin) instead of waiting for `doc.close` and the graceful shutdown. The
PID of an instance that already ended (`crashed`/`stopped`) is never killed: Windows may have reused it.

**PDF flush protocol** — pdf.js keeps form and annotation edits in the renderer until its debounced byte sync
(`pdf:update`). The first edit after load or save sends `pdf:markModified` (descriptor `modified` at once).
Before a PDF is saved or extracted (`PdfService.save/extract`), closed without `force`, and before the quit lists
the modified documents (`QuitController` → `DocumentService.flushPdfEdits`), `DocumentService.requestFlush`
emits `{ type: 'flushRequest', docId, requestId }`; the renderer pushes its pending edits and answers
`documents:flushDone { requestId }`. Main waits up to 10 s (`flushTimeoutMs`), then logs a warning and goes on —
it never rejects, and no lock is held while waiting (the renderer's `pdf:update` needs the document's lock).
No window → no request; pending requests end when the window closes or the renderer reloads (nobody is left to
answer, and a reloaded renderer has no pdf.js edits).

**PDF save guards** (`pdf/index.ts`) — like office saves: a target that is another open document's file is
refused (`errors.save.targetOpen`, also for extracts); saving over the document's own file asks `overwriteNewer`
when the file changed on disk since it was opened/saved (overwrite / save a copy — the document stays bound to its
file and modified — / cancel); the disk stamp is refreshed after every write to the document's file.

**Intercepted commands** (`intercepts.ts`): Save/SaveAs/SaveAll/ExportDirectToPDF/Open/NewDoc/AddDirect/
CloseDoc/CloseWin/Quit are handled by the main process; Help/SendMail/templates → `errors.command.unavailable`
notice; macro commands → `errors.command.macrosDisabled`; everything else — including About, Options and
ExportToPDF, which the shell answers with its backstage pages — is forwarded as an `intercept` event.

**Engine crash** — the descriptor becomes `crashed`, an `errors.engine.crashed` error is emitted, the instance is
released and the document is reloaded into a new instance from the newest recovery snapshot (modified,
`recoveredAt` set) or, without one, from the last saved file. At most 2 automatic restarts per 10 minutes.
A frame that closes on its own is treated the same way. Exits are left to the load flow only while a load into
that instance runs (`DocRecord.engineLoads`: doc.load with its password prompts, doc.new, a crash restore, a
recovery restore); those flows check the instance (`record.instance` and `ready`/`busy`) before the document
becomes `ready` and do not ignore `ENGINE_UNAVAILABLE` from `doc.setModified`. A crash restore whose new engine
ended runs the crash path again (restart limit included); a recovery restore fails with
`errors.recovery.restoreFailed` and keeps its entry.

**Hang watch** (`hangWatch.ts`) — every 2.5 s each *visible* native view (last `view:setVisible`, else the active
document) is probed with `HangDetector.isResponding(hwnd, 1000)`; documents that are loading, saving or being
snapshotted are skipped. After 2 failed probes in a row the state becomes `busy` with
`errors.engine.notResponding`; it returns to `ready` (`errors.engine.responding`) when the window answers again
(a hung view stays a probe target even when hidden). The engine is never killed automatically — a long operation
also stops the message loop. Recovery paths for the user: wait; close the document (no prompt, snapshot kept and
listed); or `documents:restartEngine`.

**Engine restart** (`documents:restartEngine`, `DocumentService.restartEngine`) — only for `busy` (hung) or
`crashed` documents: kills soffice.bin through the ProcessGuard, releases the instance and runs the crash-restore
path (newest snapshot, else the last saved file) with the automatic-restart limit reset. Other states reject with
`errors.engine.restartNotNeeded`.

## Recovery

Every `settings.autosaveMinutes` (0 = off) each modified, idle document is stored as ODF (`writer8`/`calc8`/
`impress8`, with the document's password if it has one) into `recovery\<session>\<docId>.odt|ods|odp` (PDFs:
copy of the working copy), plus an atomically written `<docId>.json` manifest. A clean shutdown writes
`clean-shutdown` and removes the folder (unless unrestored crash snapshots must survive). At startup, earlier
session folders without the marker become `recovery:list` entries (`<session>.<docId>`); `recovery:restore` opens
the snapshot as a new document tied to the original path/format.

Snapshots are stored with `baseUrl: ''` (DocumentBaseURL empty): links are written absolute, like LibreOffice's own
AutoRecovery does (#i66598). Relative to the recovery folder they would point elsewhere once the snapshot is
loaded with the document's own path as base URL (crash restore, `recovery:restore`), and the next save would
write the broken links into the user's file. Chosen over "the document's own file URL as base" because it does not
depend on how or from where the snapshot is loaded later, and works for documents without a path; the next real
save relativizes the links against the user's file again. Real saves pass no `baseUrl` (their temp sibling is in
the target folder).

`recovery:restore` removes the entry it restored only after a snapshot and manifest of the restored document were
written (a protective snapshot right after the restore). When that fails (disk full, store error), the entry stays:
hidden from `recovery:list` and not restorable a second time while the restored document is open, forgotten with
the document's first successful snapshot, its save or its close; if the restored document crashes before that, it
is reloaded from that entry's snapshot, and a crashed document that is closed leaves the entry listed.

Encrypted documents: the snapshot is written with the document's password (LibreOffice 26.8 ODF "wholesome"
encryption: one `encrypted-package` entry, no readable `content.xml`), the manifest says `encrypted: true`, and
restoring asks for the password again (`password` prompt; cancel keeps the entry and the snapshot; wrong
passwords re-prompt with `retry`). The password itself is never written anywhere. Saving the restored document
keeps the protection (OOXML: agile-encrypted compound file). Snapshots are background engine work
(`DocumentService.runBackground`): the hang watch leaves the view alone meanwhile.

## Platform integration (docs/dev/platform.md §2)

| Checklist item | Where |
|---|---|
| `createPlatform()` once, before any engine process | `bootstrap.ts` (platform, then engine manager) |
| Engine processes adopted into the job (`ProcessGuard`, default mode `adopt`) | engine layer, through `createEngineManager(opts, { processGuard })` |
| `viewParamsFor` for `doc.load`/`doc.new`; `attach` with the returned hwnd; `detach` on close/crash | `DocumentService.viewParams/attachView/detachView` |
| `view:setBounds` / `setVisible` / `freeze` / `unfreeze` | `ipc/handlers/engine.ts` (sender and payload validated; the view host validates rects) |
| `view:focus`: `viewHost.focus(docId)` **and** engine `view.focus` | `DocumentService.focusView` (engine call only for ready, non-hung documents with a view) |
| Views follow the window (move/resize/DPI) | the view host itself (window events, `WM_DPICHANGED`, `WM_WINDOWPOSCHANGED`); bootstrap only adds `display-metrics-changed` and hooks **no** window messages |
| Hang watchdog | `hangWatch.ts` + `DocumentService.watchHangs` (above) |
| Active look while a document window has the foreground | `activeState.ts`: `WindowState.active` = focused or `viewHost.isForeground(win)`; re-checked 60/250 ms after window events and polled while blurred with document windows open (400 ms while active, 1 s while inactive; `GetForegroundWindow` only) |
| KeyTips from document windows (`ShellKeys`) | off by default; `settings.ui.documentKeyTips` starts/stops the hook; `Alt`/`F10` become `shellKey` events (F10 de-duplicated against the engine's key event within 400 ms) — only while the BrowserWindow itself is *not* focused (`app/shellKeys.ts`): the renderer handles Alt/F10 in its own window |
| Views re-attached after an engine restart | `attachView` sets the last requested visibility before the bounds; `ViewHostCore` keeps the visibility of a detached view for its next attach |
| Freeze-frames never hang the renderer | `ViewHostCore.freeze` resolves after captureTimeout + 2 × hideWait at most, even when a native call of the view blocks (`null` image then) |
| `viewHost.dispose()` on quit; documents closed before the window is destroyed | `QuitController`: `closeAll`, then `disposeServices` |
| Entry point without top-level await | `src/main/index.ts` |

## IPC

`router.ts` registers exactly `INVOKE_CHANNELS`. Each request must come from the main frame of our window
showing our page (dev-server origin or the bundled `index.html` path) and pass the channel's validator
(unknown keys rejected, sizes bounded, `.uno:` commands well formed, dispatch checked against
`isAllowedUnoCommand`, subscriptions filtered by `isSubscribableUnoCommand`, queries limited to `EngineQueries`
with per-query params and document kind). Failures reject with an i18n key as the error message
(`errors.ipc.invalidRequest`, `errors.open.notFound`, …); unexpected exceptions become `errors.generic` and are
logged, never sent.

The renderer is untrusted (a pdf.js or script-injection bug must not reach files or executables):
- `engine:dispatch` accepts only `.uno:Name` (no `?Name:type=value` form: `errors.ipc.invalidRequest`) and only the
  arguments of `UNO_COMMAND_ARGS` (`src/shared/commands.ts`: names and value types the ribbons and the zoom slider
  send; everything else, e.g. `FileName`/`URL` for InsertGraphic, InsertExternalDataSource, ImportFromFile,
  CompareDocuments, MergeDocuments, InsertAVMedia, is `errors.command.notAllowed`), so file- and URL-taking
  commands always show LibreOffice's own dialog. `tests/unit/renderer/dispatch-args.test.ts` checks every ribbon
  action against the list: a new argument in a ribbon needs an entry there.
- Target files come from the native dialogs only: `documents:save`/`documents:exportPdf` options have no `path`,
  `pdf:merge` has no `paths` (the service-level parameters stay for tests and internal callers).
- `app:settings:update` rejects a changed `engine.programDir` (`errors.ipc.invalidRequest`; the unchanged value is
  accepted, the settings page sends the whole `engine` group); the folder is set in settings.json or with
  VARAK_ENGINE_DIR, must be a local drive path (no UNC/device paths) and takes effect at the next start.

Renderer expectations:
- Subscribe to `documents:event` first, then call `documents:list` (documents opened from the command line may
  already exist). The first IPC request marks the renderer as ready (pending files open then).
- Prompts arrive as `{ type: 'prompt' }` events and must be answered with `documents:answerPrompt` (answers of the
  wrong kind are ignored). Pending prompts are re-sent after a renderer reload.
- `documents:open`/`create`/`openDialog` reject with `errors.open.cancelled` when the user cancelled a prompt: show nothing.
- Error/notice keys are `errors.*`/`compat.*` (namespaces `errors`/`compat`, files
  `src/renderer/i18n/locales/{tr,en}/errors.json` and `compat.json`); `detail` is extra, non-content information
  (file name, error code, count, ISO time).
- `shellKey` events carry `Alt`/`F10` from the platform keyboard hook (only with `settings.ui.documentKeyTips`)
  while an office document is active.
- `app:windowState` / `app:window:state` include `active` (see above): use it for the title bar's active look.
- `documents:restartEngine { docId }` is the "restart" action for `errors.engine.notResponding` /
  `errors.engine.restartLimit` messages.
- `pdf:print` takes the rendered `pages` (validated: PNG/JPEG bytes, 1 to 14 400 pt, at most 20 000 pages and
  2 GiB); PDF service failures reject with their `pdf.errors.*` key.
- PDF flush protocol (above): `pdf:markModified { docId }` on the first pdf.js edit while the document is clean;
  on `{ type: 'flushRequest', docId, requestId }` push pending edits (pdf:update) and then *always* answer
  `documents:flushDone { requestId }` — without waiting for the controller's own save/busy work, because
  `pdf:save` itself sends a flush request. PDF save results may carry `errors.save.targetOpen`; saving over a
  changed file sends the `overwriteNewer` prompt for PDFs too.
- Window chrome colours are shared through `WINDOW_CHROME` (`src/shared/api/app.ts`); the title bar is 40 px.

## Thread pool

`src/main/app/threadpool.ts` is the entry's first import and sets `UV_THREADPOOL_SIZE=16` unless the environment
sets a value. koffi `.async` calls of the platform layer (window placement, PrintWindow, process-guard waits) run
on libuv's pool, and a call into a LibreOffice window that stops pumping messages blocks its thread until the
engine pumps again or ends; with the default 4 threads two such engines could stall every `fs.promises` call of
the main process (saves, snapshots, settings). Checked with Electron 44 on this machine: with six pool tasks
blocked, `fs.promises.stat` answered after 28 ms with the setting in the first imported module, 1512 ms without.

## Smoke boot (hidden window)

`node scripts/smoke-boot.mjs [--kind calc|impress|writer] [--out <build dir>] [--no-build] [--timeout <s>]`

- Uses the shared `out/` only when it is complete, contains smoke support (the `VARAK_SMOKE` marker) and is newer
  than everything in `src/{main,preload,renderer,shared}`, `electron.vite.config.ts` and `package.json`; otherwise it
  builds into `test-output/main-core/out` (`electron-vite build --outDir <absolute dir>`). The shared build is never
  run or written by the script.
- Starts Electron (ELECTRON_RUN_AS_NODE removed) with `VARAK_SMOKE=1`, `VARAK_VIEW_MODE=hidden`,
  `VARAK_DATA_DIR=test-output/main-core/smoke/data-<pid>`, `VARAK_SMOKE_REPORT=test-output/main-core/smoke/report.json`.
- In the app (`src/main/app/smoke.ts`): the main window is created with `show: false` and never shown (no
  `ready-to-show` show, no fallback timer, no error dialog, no DevTools key, no shell-key hook, no command-line
  files); the engine runs `--headless` without a warm spare; documents get `hidden` views. After `did-finish-load`
  the script calls the real preload bridge through `webContents.executeJavaScript` (so contextBridge, ipcMain,
  sender check and validators are all exercised): `app:info` (engine available), `app:settings:get`,
  `app:window:state`, `documents:list`, `documents:create` (engine instance, hidden view), `documents:list`,
  `engine:query doc.info`, `documents:close`, `documents:list`. Renderer console errors, preload errors, renderer
  crashes, load failures and main-process `error` log records fail the run. The app then shuts down through the
  normal quit path (`QuitController.shutdown`) with exit code 0/1; a 5.5-minute safety timer exits with 1.
- The runner kills the app after `--timeout` (default 420 s), then looks for processes whose command line contains
  the data folder (engine profiles live there): any survivor is killed and fails the run. The data folder is removed
  after a passing run and kept (with its log) otherwise.

## Tests

- `npx vitest run --project unit tests/unit/main` — safe-save fault injection (write/fsync/verify/replace, real
  `ReplaceFileW` on Windows), compat analyzer with synthetic packages (incl. compound files with mini streams),
  document service with fake engine/view host/dialogs (open→edit→save→risk→save a copy, passwords, CSV, crash →
  restore, close prompts, intercepts, export), platform integration (view-mode override, focus, hang targets,
  restart, closing hung documents, F10 de-duplication, active window state, test-mode switches, font folders),
  recovery, IPC validation (incl. `pdf:print` pages, `pdf.errors.*` pass-through, `documents:restartEngine`),
  settings, recent files, log rotation, quit flow, i18n key coverage. Review fixes of 2026-09-29: programDir over
  IPC/schema/runtime (`ipc`, `settings`), no renderer-supplied target paths (`ipc`), dispatch argument allow-list
  (`ipc`), edits during save verification and `markSaved` (`documentService`), reload parameters after Save As
  (`documentService`), VBA passthrough (`savePlan`, `documentService`, `recovery`), whole-file encoding check
  (`savePlan`, `documentService`), PDF flush protocol and PDF save guards (`pdfDocuments` — real DocumentService +
  PdfService with a scripted renderer), re-attached view visibility and PID-safe kills (`platformIntegration`),
  engine exits during restores (`lifecycleEdges`, `recovery`), `baseUrl: ''` snapshots and kept recovery entries
  (`recovery`), no verification PDF for encrypted documents (`documentService`), thread pool and shell-key focus
  (`app`). Fakes: `FakeInstance` models LibreOffice's modified flag (`doc.info`, `markSaved`) and crashed instances;
  the harness answers `flushRequest` events like the renderer (`onFlush` replaces the responder).
- `npx vitest run --project unit tests/unit/platform/view-host-core.test.ts` — includes the visibility of re-attached
  views and a freeze that settles while a native call blocks.
- `npx vitest run --project unit tests/unit/renderer/dispatch-args.test.ts` — every ribbon/status-bar `.uno:` action
  of the three office modules (combos, colours, table grid, zoom included) passes `isAllowedUnoCommand` and
  `isAllowedUnoArgs`; loads the renderer modules at run time so the node typecheck does not follow `.tsx` files.
- `npx vitest run --project engine tests/engine/documents-office.test.ts tests/engine/documents-recovery.test.ts
  tests/engine/documents-writer.test.ts` — the real engine (headless, `hidden` views; the view-host stub fails
  the test if a native view were attached), harness `tests/unit/main/helpers/realEngine.ts`: own folder and
  profiles under `test-output/main-core/engine/<suite>-<random>/`, files from `tests/corpus/generated` (or
  created by the engine when the corpus was not generated), and after each suite every process whose command line
  contains the suite folder must already be gone (asserted; survivors are killed).
  - office: XLSX edit → save (temp sibling, zip/CRC, re-open by the conversion instance, `ReplaceFileW`) → reopen
    (values, formulas, cross-sheet recalculation; the engine's own modified flag is false after the save,
    `markSaved`); an edit made while the conversion instance verifies the file keeps the document modified
    (`doc.info`), is not in the saved file, and closing asks; PPTX slide duplication + text change → save → reopen;
    save-risk prompt: `cancel` writes nothing, `saveCopy` writes “<name> (kopya).xlsx” while the original stays
    byte-identical (SHA-256) and the document continues on the copy; PDF/A-2b tagged export.
  - recovery: snapshot of an unclean session restored in the next session and saved to the original XLSX; a DOCX
    with a relative hyperlink → snapshot (the link is absolute in the ODF, `baseUrl: ''`) → restore → save: the
    user's DOCX links to the same file;
    encrypted document (password prompt with retry) → encrypted ODF snapshot without plain content → restore
    asks for the password (cancel keeps the entry) → saved file is again an encrypted compound file; soffice killed
    while editing → `crashed` → automatic restore from the snapshot in a new instance (later edits lost, nothing
    else).
  - writer: DOCX insert text → save → reopen; table, header, footer and image parts survive.
- `node scripts/smoke-boot.mjs` — see above.

## Known limitations / TODO

- The renderer page is loaded from `file://` (a custom protocol would be stricter; see the Electron security checklist).
- Font availability uses the Windows font registry (koffi) and file-name heuristics as a fallback; font files are
  not parsed. In the development image the engine's fonts live in `vendor/libreoffice/Fonts`, which LibreOffice does
  not load, so the font check may report fonts as missing that the packaged engine has.
- Save As of PDFs, merging and printing are the PDF service's (`src/main/pdf`).
- `settings.engine.viewMode = 'child'` needs a restart (Chromium switch).
- Not verified on screen (needs the GUI spike, docs/testing/GUI_SPIKE.md): owned/child views with a visible window,
  `view.focus`, the active-look polling, the shell-key hook, the hang watchdog against a really hung view.
- The hang watchdog runs on Electron's main thread (the probes themselves run on koffi worker threads); platform.md
  §2.6 notes that a watchdog that must fire even while Chromium's UI thread is blocked by a hung, input-attached
  soffice would need a utility process.
- The shell does not use `WindowState.active`, `documents:restartEngine` or `settings.ui.documentKeyTips` yet
  (renderer work).
- Engine bridge (reported to its owner): `impress.setShapeText` changes the text but leaves LibreOffice's
  modified flag false, so no `modified` event follows (UI edits and dispatched commands do set it; the renderer does
  not use this RPC). The PPTX engine test therefore edits with `.uno:DuplicatePage` first.
- Electron prints "Error occurred in handler for '<channel>'" to stderr for every rejected `ipcMain.handle`
  (e.g. `engine:query` for a document that was just closed); the renderer receives the i18n key as usual.
- VBA passthrough (#11) has unit tests only: the corpus has no DOCM with a VBA project and LibreOffice cannot
  create one, so there is no engine test of "DOCM → snapshot → restore → save loses vbaProject.bin".
- Password-protected documents get the structural verification only (#21); a deep check would need an engine RPC
  that loads a file and writes nothing (engine layer).
- The PDF flush protocol (#10) needs the renderer's side (`pdf:markModified`, answering `flushRequest`); without it
  every PDF save/close/quit waits for the 10 s timeout.

## Verified (review fixes, 2026-09-29, this machine)

- `npx vitest run --project unit tests/unit/main tests/unit/platform tests/unit/renderer/dispatch-args.test.ts` →
  27 files, 341 tests passed; whole unit project 61 files, 732 tests passed. Every regression test of the review
  fixes was also run against the code with the fix taken out and failed there.
- `npx vitest run --project engine tests/engine/documents-office.test.ts tests/engine/documents-recovery.test.ts
  tests/engine/documents-writer.test.ts` → 3 files, 10 tests passed in 129.8 s (headless, hidden views, no process
  left); the new hyperlink test fails without `baseUrl: ''` (the snapshot then holds a relative link).
- Electron 44 thread-pool check (no window): see "Thread pool".
- `tsc` clean for `tsconfig.node.json`, `tsconfig.web.json`, `tests/unit/renderer/tsconfig.renderer-tests.json` and
  `tests/unit/pdf/tsconfig.renderer-tests.json`; `eslint` clean for the changed files.

## Verified (2026-09-29, this machine)

- `npx vitest run --project unit tests/unit/main` → 14 files, 184 tests passed (whole unit project: 54 files,
  626 tests passed).
- `npx vitest run --project engine tests/engine/documents-office.test.ts tests/engine/documents-recovery.test.ts
  tests/engine/documents-writer.test.ts` → 3 files, 8 tests passed in 130.5 s (LibreOffice 26.8.0.3 headless, with
  the engine layer's start-up change "in-process Python disabled (URE_MORE_SERVICES without pyuno.rdb)"). Before
  that change Writer loads and some Impress edits hung the headless engine (engine-layer deadlock, see
  docs/dev/engine.md); the spreadsheet and recovery paths passed already then.
- `node scripts/smoke-boot.mjs` with `--kind calc`, `writer` and `impress` → PASSED each (≈10 s, app exit code 0,
  no process left). The window was never shown; the build came from `test-output/main-core/out`.
- `npx tsc -p tsconfig.node.json --noEmit` and `-p tsconfig.web.json` clean; `npx eslint` clean for this area's files.

