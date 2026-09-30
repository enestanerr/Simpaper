# Engine layer: developer notes

Code: `engine/bridge/simpaper_bridge` (Python, runs on LibreOffice's bundled interpreter), `engine/profile`
(profile template, keyboard shortcuts), `src/main/engine` (EngineManager, EngineInstance, RPC client,
profiles, start-up overrides). Tests: `tests/engine/**` (real headless LibreOffice), `engine/bridge/tests`
(Python unit tests), `src/main/engine/*.test.ts` (TypeScript unit tests). Diagnostics:
`tests/engine/diagnostics/` (stack dumper, minidump reader).

Status (2026-09-29): implemented and verified against LibreOffice 26.8.0.3 on Windows 11 (Turkish region),
headless and with hidden views. Visible child views (painting, focus, typing) passed the GUI runs of 2026-09-29
(docs/testing/GUI_SPIKE.md); owned views hung soffice there (run 4).

## Progress (checkpoint for resuming)

- [x] Start-up hang of Writer documents: reproduced, root cause found and fixed (§8). Evidence and scratch
      harness: `test-output/engine/hang/` (git-ignored: `repro.py`, `acp_repro.py`, `acp_probe*.py`,
      `release_race.py`, `logs/`).
- [x] Second bug found by the start-up loop: soffice.bin crash "release after close" (§9), fixed in the bridge.
- [x] Regression test `tests/engine/startup.test.ts` (short version always on; `SIMPAPER_ENGINE_LONG=1` loop).
- [x] Platform integration: `ProcessGuard.adopt` after every spawn, `killTree(pid, { imageDir, timeoutMs })`,
      `officePid` for orphans; owned/child view creation verified on a real, never-shown soffice (§10).
- [x] Integration tests: round trips, formulas tr/en, stale caches, CSV, PDF, password, performance (§12).
- [x] Python unit tests `engine/bridge/tests` (62 tests; 93 after the review fixes below).
- [x] `engine/profile/ACCELERATORS.md`, shortcut and profile read-back test.
- [x] This document.

Review 2026-09-29 (notes kept outside the repository, see STATUS.md), engine part — all done:

- [x] #1 dialog tracking keyed by the pyuno wrappers (UNO identity), cleared on shutdown (§3) —
      `engine/bridge/tests/test_documents.py` (4 of its 6 dialog tests fail with the old `id()` keys).
- [x] #4/#20 bridge part: `doc.store` `markSaved` and `baseUrl` (§3) — Python unit tests and
      `tests/engine/store.test.ts` (both engine tests fail against the old bridge).
- [x] Follow-up of the rejected "reply-encoding-error-kills-bridge": a lost URP connection ends the bridge with
      exit code 3 and the instance as `crashed` (§2, §3) — `engine/bridge/tests/test_connection.py` (real URP
      peer process) and `lifecycle.test.ts` (fails against the old bridge: no exit within 15 s).
- [x] #9 `updateProfileOptions` keeps the ProfileStore, ignores `''` vs. no programDir, and starts nothing
      because of a program folder change (§7, also the engine part of #2) — `src/main/engine/EngineManager.test.ts`
      (all 4 tests fail against the old manager).
- [x] Verified 2026-09-29: bridge 93/93, `src/main/engine` 21/21, engine suites of §12 38 passed + 3 skipped
      (long loop), `documents-{office,writer,recovery}` 8/8 against the new bridge; tsc (node: only the two
      pending main-process IPC handlers of the lead's new channels), eslint clean.

Lead follow-ups 2026-09-29 (after the first GUI spike):

- [x] Owned views are owned **before** the load shows them (§10, `simpaper_bridge/owned.py`): the GUI spike showed
      Simpaper's UI thread hung in `PeekMessage` after the host converted an already shown, foreground frame.
      Tests: `engine/bridge/tests/test_owned.py` (style vectors shared with `tests/unit/platform/styles.test.ts`,
      real hidden windows, guard paths, job order; 4 flow tests fail against the old single-job flow),
      `tests/unit/platform/win32-view-ops.test.ts` (makeOwned makes no hide/restyle/owner call on an engine-owned
      frame; fails without the early return), `tests/engine/views.test.ts` (real soffice). On screen (GUI run 4)
      Simpaper stayed responsive, but soffice stopped responding after the first click: docs/dev/platform.md §10.
- [x] Lone UTF-16 surrogates are replaced with U+FFFD right after decoding a request
      (`framing.scrub_surrogates`, §14): `test_framing.py` and `lifecycle.test.ts` 'replaces lone UTF-16
      surrogates…' (fails without the scrub: the connection drops). The lost-connection test now uses the
      test-only method `debug.dropConnection`, registered only when `SIMPAPER_BRIDGE_TEST_HOOKS=1`.
- [x] Impress slide pane (missing in the GUI spike): sfx2's work window hides all its child windows while the
      layout manager is invisible (`LayoutManagerListener`, sfx2/source/appl/workwin.cxx), and the slide pane is
      one of them. Impress now keeps the layout manager visible; every toolbar of the module and its status bar
      are switched off in the window state configuration (`Documents._switch_off_bars`), because Impress requests
      its object bars itself (sd `ToolBarManager` → `requestElement`) and sfx2 requests the status bar on every
      context change — `requestElement` honours the stored `Visible` state, while `hideElement` does nothing for
      a bar that does not exist yet. Test: `views.test.ts` 'impress: the slide pane stays available…' (test hook
      `debug.viewChrome`): no bar visible after load, after Select All and after Outline → Normal view; it failed
      while only `hideElement` was used (the status bar came back). Writer and Calc keep the invisible layout
      manager. Confirmed on screen in GUI run 3 (slide pane visible).
- [x] Writer page count without a layout run: `doc.info` and the load result read the page count from the
      document statistics (`ops.writer_page_count`, after `WordCount` has brought them up to date) instead of
      `controller.PageCount`, which formats the whole document with a progress bar (`SwViewShell::CalcLayout`);
      Writer ignores every key that arrives while a progress runs (`SwEditWin::KeyInput`), and the status bar asks
      for `doc.info` after changes. Tests: `engine/bridge/tests/test_ops.py` (fails with the old read) and
      `tests/engine/docinfo.test.ts` (the count follows inserted text on a real engine).
- [x] Verified: bridge 109/109, `lifecycle.test.ts` 11/11, `views.test.ts` 4/4, `docinfo.test.ts` 1/1.

## 1. Files

| Path | Role |
|---|---|
| `src/main/engine/index.ts` | `createEngineManager(opts, { processGuard, log })` |
| `src/main/engine/EngineManager.ts` | document instances (one per document), warm spare, serialised conversion instance, retries |
| `src/main/engine/EngineInstance.ts` | `OfficeInstance`: spawns soffice + bridge, handshake, crash detection, shutdown, tree kills |
| `src/main/engine/launch.ts` | start-up overrides (no in-process Python, no OpenCL) derived from the engine's `fundamental.ini` |
| `src/main/engine/rpc.ts` | NDJSON JSON-RPC client (`EngineRpcError`, timeouts, abort, log forwarding) |
| `src/main/engine/profiles.ts` | profile slots, template rendering, accelerators, crash-dump cleanup |
| `src/main/engine/locate.ts`, `version.ts`, `fallbackGuard.ts` | engine discovery, PE version read, taskkill guard for tests |
| `engine/bridge/simpaper_bridge/main.py`, `server.py`, `framing.py` | entry point, request loop, NDJSON framing |
| `engine/bridge/simpaper_bridge/methods.py` | the RPC methods (`EngineMethods` of `src/shared/engine-protocol.ts`) |
| `engine/bridge/simpaper_bridge/office.py` | UNO connection, main-thread executor, release barrier |
| `engine/bridge/simpaper_bridge/documents.py` | loading into hidden/owned/child views, listeners, two-phase close |
| `engine/bridge/simpaper_bridge/listeners.py` | dispatch interceptor, status/modify/close/context/selection/key listeners, interaction handler |
| `engine/bridge/simpaper_bridge/ops.py` | Writer/Calc/Impress operations and `doc.info` |
| `engine/bridge/simpaper_bridge/values.py`, `errors.py`, `addresses.py`, `keys.py`, `protocol.py` | pure helpers |
| `engine/profile/registrymodifications.xcu.template`, `accelerators.json`, `ACCELERATORS.md` | engine profile |

## 2. Process model and lifecycle

- **One soffice.bin + one bridge per open office document** (`acquireDocumentInstance(docId)`), a warm spare
  (`warmSpare`), and one serialised headless **conversion instance** (`convert()`; PDF export verification,
  save verification). Process trees on Windows: `soffice.exe` (launcher) → `soffice.bin`; `python.exe`
  (launcher) → `python-core-3.13.15/bin/python.exe` (the bridge).
- **Start** (`OfficeInstance.start`): render the profile slot (§7) → spawn soffice with
  `-env:UserInstallation=<slot> --accept=pipe,name=simpaper_<random>;urp;StarOffice.ComponentContext
  --norestore --nologo --nodefault --nolockcheck --pidfile=<slot>/soffice.pid [--headless]` plus the
  start-up overrides of §8 → spawn the bridge (`python.exe -m simpaper_bridge --pipe … --office-pid-file …`)
  → `engine.hello` (connects to the pipe with retries; returns `officeVersion`, `officePid` = soffice.bin's
  PID from the pid file, `bridgePid`). Two attempts per start; a slot whose soffice exits with 0 during
  start-up (another soffice owns the profile) is retired.
- **Shutdown** (`dispose`): `engine.shutdown` (detach listeners → release barrier → close documents →
  `XDesktop.terminate()`), wait up to 8 s for both launchers, then kill whatever is left.
- **Crash detection**: an unexpected exit of the soffice launcher or the bridge marks the instance
  `crashed`, rejects pending calls with `ENGINE_UNAVAILABLE`, kills the rest and emits `onExit({ crashed:
  true })`. Note that LibreOffice's crash handler (Breakpad) ends soffice.bin with exit code **0** after
  writing a dump, so "exit code 0" during use is a crash too.
- **Lost URP connection**: when the bridge's connection to soffice ends although nobody asked soffice to
  end, the bridge process exits with code **3** (`EXIT_CONNECTION_LOST` / `BRIDGE_EXIT_CONNECTION_LOST`,
  kept in sync by a Python test), so the instance ends as `crashed` and DocumentService restores the
  document into a new instance. This covers binaryurp giving up on a connection while soffice keeps running
  (e.g. a string with a lone UTF-16 surrogate sent to soffice: "Binary URP bridge disposed during call"),
  which used to leave a live bridge answering `ENGINE_UNAVAILABLE` forever and a document that looked ready
  but could not be saved. When soffice.bin dies, the bridge usually notices first (exit info `{ code: 3,
  crashed: true }`), otherwise the launcher's exit does; both are crashes. During `engine.shutdown` and
  after stdin EOF the loss is expected and the bridge exits with 0 as before. See §3.

### Platform integration (docs/dev/platform.md §2)

- `processGuard.adopt(pid)` right after spawning `soffice.exe` and the bridge's `python.exe`, and again for
  `officePid`/`bridgePid` after the handshake (children started later join the job automatically).
- Every kill is `processGuard.killTree(pid, { imageDir: <engine program dir>, timeoutMs: 10 000 })`;
  rejections are caught and logged. `imageDir` covers soffice.bin and the bridge interpreter
  (`program/python-core-*/bin`) and keeps programs LibreOffice opened for the user alive.
- Orphans (`officePid`, `bridgePid`) are killed through their own PID after checking the image name
  (`tasklist`), because the PID may have been reused.
- Views: see §10.

## 3. The bridge

The bridge is a separate Python process (LibreOffice's bundled CPython 3.13 with pyuno) that talks UNO to its
soffice over the named pipe and NDJSON JSON-RPC 2.0 with Electron's main process over stdio (stdout:
responses and `event` notifications; stderr: log lines `LEVEL logger: message`, never document content).

- `main.py` redirects `sys.stdout` to stderr (stray prints can never corrupt the protocol) and ends with
  `os._exit` (joining pyuno's bridge threads can hang after soffice is gone).
- `server.py`: a reader thread queues stdin lines; one worker executes requests **in order**. EOF on stdin
  (parent gone) terminates soffice instead of orphaning it. `Server.stop(code)` ends the loop after the
  request being executed was answered (queued requests are not answered; the parent fails them when the
  process ends).
- `methods.py`: parameter validation (`Params`), the method table, connection handling (`Connection` connects
  in the background; requests wait for it).
- Connection (`office.connect`): the steps of `UnoUrlResolver.resolve` (Connector → anonymous `urp` bridge →
  `getInstance('StarOffice.ComponentContext')`), but the URP bridge object is kept and an `XEventListener` is
  registered at it (`ConnectionLoss`). binaryurp calls `disposing()` on its reader thread within
  milliseconds when the connection ends — no request needs to be pending. A call that fails with a
  connection-loss error (`errors.is_connection_lost`) marks the loss too. The first report calls
  `Methods._connection_lost`, which (unless `engine.shutdown` or stdin EOF is ending soffice) makes
  `main.py` stop the request loop and exit with code 3; a watchdog exits after 5 s if the loop is stuck.
  Callers waiting for a main-thread job get `ENGINE_UNAVAILABLE` at once instead of after the job timeout.
- `documents.py`: `Documents.open()` loads into a hidden frame (`Desktop.loadComponentFromURL`, `Hidden`) or
  into a frame on our own window (owned/child, §10), registers the dispatch interceptor
  (`INTERCEPTED_COMMANDS`), modify/close/context/selection/key listeners, hides LibreOffice's menus,
  toolbars, status bar and sidebar for views. `InteractionHandler` never shows UI: passwords are answered
  once, warnings approved, everything else aborted; the outcome maps to `PASSWORD_REQUIRED`/`WRONG_PASSWORD`.
- Load arguments: `MacroExecutionMode=NEVER_EXECUTE`, `UpdateDocMode=NO_UPDATE`, `AsTemplate=false` for files
  (templates are edited, not instantiated), `DocumentBaseURL` = the user's file (the engine edits a working
  copy). `doc.store` is `storeToURL` (a copy: the document keeps its location and modified flag) with
  `Overwrite`, `FilterName`, optional `FilterOptions`, `FilterData` and `Password`, plus:
  - `markSaved: true` (real saves only): `setModified(False)` right after a successful `storeToURL`, **in the
    same main-thread job**, so no input is processed in between. Edits made afterwards (e.g. while the save
    is verified) set the flag again and emit `modified: true`. A failed store leaves the flag alone; a
    failing `setModified` is only logged (the file is written; the document just stays "modified").
  - `baseUrl` → `DocumentBaseURL` of the export. `''` stores links absolute — for recovery snapshots, which
    are written to another folder than the document (LibreOffice's AutoRecovery does the same, #i66598).
    Without it, `storeToURL` writes same-drive links relative to the *target* ("save URLs relative to file
    system" is on by default), and a snapshot restored with the user's file as base URL resolves them
    against the wrong folder; the next save then writes the broken links into the user's file. Measured
    (`tests/engine/store.test.ts`): link `veri.xlsx` next to the document → snapshot without `baseUrl`:
    `../../../../../../Belgeler/Plan%202026/veri.xlsx` → after restore + save:
    `../../../../../Belgeler/Plan%202026/veri.xlsx` (broken); with `baseUrl: ''`: absolute in the snapshot,
    `veri.xlsx` after restore + save.
- Dialog tracking (`Documents.on_top_window_*`): the `dialog` events follow LibreOffice's own dialogs through a
  toolkit top-window listener. The open dialogs are kept as the **pyuno wrappers** of their windows, never
  as `id()`: pyuno converts `event.Source` into a new wrapper for every callback (the one of `windowClosed`
  is another object, usually at another address), but hashes and compares wrappers by UNO identity, and
  holding the first wrapper keeps its proxy alive. With `id()` keys most `open: false` events were lost and
  the document stayed busy (no autosave, disabled ribbon). The set is cleared on `engine.shutdown`.

## 4. Threading model

UNO calls that touch documents or views run on **LibreOffice's main (VCL) thread**
(`office.MainThreadExecutor`): the worker posts a `com.sun.star.awt.AsyncCallback`; soffice calls our
`XCallback.notify()` from its main thread, and every UNO call made inside `notify()` carries that thread's
identity over URP, so soffice executes it on its main thread too. This avoids races with painting
(tdf#172048, tdf#172304). Rules:

- One job at a time. A job that did not start in time is cancelled (`TIMEOUT`, "main thread busy"); one that
  started but did not finish keeps the engine `BUSY` until it ends. `cmd.dispatch` that opens a modal
  LibreOffice dialog releases the caller early (`release` event of the top-window listener); later jobs run
  nested in the dialog's loop, like UI events. Once the connection is lost (§3) no job is posted any more,
  and a caller waiting for one gets `ENGINE_UNAVAILABLE` within 0.1 s.
- **Never call Win32 functions that send messages to soffice windows from inside a job**: soffice's main
  thread is blocked in the `notify()` call and cannot answer (e.g. `SetWindowLongPtrW` sends
  `WM_STYLECHANGING`). `set_no_parent_notify` therefore runs on a daemon thread after the load job.
- **Releases are asynchronous.** binaryurp sends every `release` of a remote reference on one dedicated
  logical thread (`releasehack`, `binaryurp/source/bridge.cxx`); soffice processes them in order but off its
  main thread, possibly after later calls. Before a document is closed the bridge therefore waits for the
  **release barrier** (§9).
- Errors of a job are converted to a plain `RpcError` inside the job (`errors.detached_error`): a raised
  exception's traceback would keep the job's frames (and the UNO proxies in their locals) alive; the job's
  closure is dropped when it finishes.
- Listener callbacks come from soffice threads; they only record state and emit events (the writer is
  thread-safe) and never block.

## 5. Protocol notes

- Error codes (`RPC_ERROR`): connection loss (`NoConnectException`, URP bridge disposed) →
  `ENGINE_UNAVAILABLE`; a `DisposedException` of a document object → `DOC_NOT_FOUND`;
  `IllegalArgumentException` & co. → `INVALID_PARAMS`; anything else → `INTERNAL` with `data.type` and
  `data.trace`. The Python constants are checked against the TypeScript ones by a unit test.
- `calc.setCell { formula }` takes the **API grammar**: English function names and `;` as the parameter
  separator (`=IF(A1>0;"a";"b")`, cross-sheet `=$Veri.B2`). `,` separators give Err:508/509. `CellInfo.formula`
  is in the same grammar; `localFormula` is what the formula bar shows (`=EĞER(A1>0;"a";"b")` in Turkish,
  `=IF(A1>0,"a","b")` in English). `calc.setActiveCellContent` parses like typing into the formula bar in the
  profile's language (Turkish: `TOPLA`, `1,5`, `29.09.2026`; English: `SUM`, `1.5`, `9/29/2026`).
  `CellInfo.error` is locale independent (`#NAME?`); `display` is localised (`#AD?`, `#BÖLÜ/0!`, `Hata:509`).
- A formula entered through the API does not get an automatic date format (`=DATE(2026;9;29)` displays
  `46294`); typed dates do.
- `DocLoadResult.hwnd` is an **unsigned** decimal string.
- `ViewParams.startHidden` loads with `Hidden`: such a frame must later be shown **through the engine**
  (`view.setVisible(true)`), not only natively. VCL paints only windows it considers visible, and its Win32
  frame procedure has no `WM_SHOWWINDOW` handler (`vcl/win/window/salframe.cxx`), so a frame shown by
  `ShowWindow`/`SetWindowPos` alone would stay blank. Without `startHidden`, LibreOffice shows the frame
  itself at the end of the load (at the `bounds` hint) and the view host then converts and places it.

## 6. Error handling in the main process

`EngineRpcError` (code, message, data, method) for bridge errors, local timeouts (`TIMEOUT`) and a closed
connection (`ENGINE_UNAVAILABLE`); `EngineStartError` for failed starts. `DEFAULT_CALL_TIMEOUT_MS` is 60 s;
the bridge uses 120 s per main-thread job and 900 s for load/store/convert.

## 7. Profiles

- Slots `doc-0`, `doc-1`, …, `conversion` under `profilesRoot` are reused across runs, so LibreOffice's slow
  first start (profile creation, registration of ~60 bundled dictionary extensions) happens once per slot.
- Before every start `ProfileStore.prepare()` rewrites `user/registrymodifications.xcu` from
  `engine/profile/registrymodifications.xcu.template` (UI language, locale, theme, macros off, VBA kept,
  updaters and first-start/crash/tip dialogs off, no backups or lock files, recovery off, no recent-file list,
  OpenCL off, OOXML/ODF always recalculated on load, default save filters, Office-like shortcuts from
  `accelerators.json`, see `engine/profile/ACCELERATORS.md`). Settings LibreOffice wrote in an earlier run are
  therefore discarded on purpose.
- It also deletes `soffice.pid` and the crash-dump folder `<slot>/crash` (dumps are never uploaded, may
  contain document memory and would pile up).
- One `ProfileStore` per manager, for its whole life. Its `used`/`retired` sets are what keeps a new instance
  off the slot of an instance that still runs: `prepare()` on a live slot would rewrite that engine's
  configuration and the new soffice would hand its command line to the running one and exit 0.
  `updateProfileOptions` therefore never replaces the store (it used to on the first theme/language change,
  because `''` and an absent `programDir` compared as different).
- `updateProfileOptions` (bootstrap: language/theme changes): a call that changes nothing is ignored (`''`
  and blanks mean auto-detect, like no setting). Changed language/theme: the idle spare and conversion
  instance are replaced (new spare at once); running document instances keep their settings until they end.
  A changed **program folder** is applied lazily and never starts an engine by itself: cached paths, start-up
  overrides and probe are dropped, the idle spare and conversion instance (old engine) end, and the new
  folder is used by the next instance a request needs (next document opened or created, next conversion).
  The folder is meant to come only from `settings.json` / `SIMPAPER_ENGINE_DIR`, read at start-up: the shipped
  UI never changes it and the main process is to reject renderer changes (review #2, main-process side), so
  in practice a changed folder takes effect after an explicit restart of the app. This manager rule is the
  defence in depth: a value that still reaches it at runtime never launches a program on its own.

## 8. Root cause: the start-up hang ("Writer document never loads")

**Symptom.** `doc.new`/`doc.load` of a Writer document hung forever (all later calls `BUSY`); Calc and
Impress worked. It happened in fresh and in reused profiles (the previous investigation saw it mostly from
the second session on and after waiting in the first one). Profiles contained 0-byte `crash/*.dmp` files.

**Reproduction** (`test-output/engine/hang/repro.py`, the product's soffice arguments, AsyncCallback like the
bridge): fresh profile, sessions "writer,calc,impress; writer; writer" → **3/3 sessions hung** on the first
Writer document (60 s timeout), including the fresh first session.

**Evidence: native stacks of the hung soffice.bin** (`tests/engine/diagnostics/stackdump.py`, export symbols):

```
VCL Main (main thread)
  KERNELBASE!WaitForSingleObjectEx           ← Breakpad: waits for its handler thread to write the dump
  mergedlo (Breakpad HandleInvalidParameter)
  ucrtbase (_invalid_parameter)
  ucrtbase!setlocale (4 frames)              ← holds the CRT locale lock
  MSVCP140!std::_Locinfo::_Locinfo_Addcats
  MSVCP140!std::_Locinfo::_Locinfo
  mergedlo (boost::locale / std::locale construction)
  mergedlo!Translate::Create, SfxResId, SfxObjectShell::GetTitle, SfxBaseModel::Notify …
  swlo!SwDocShell::InitNew ← SfxBaseModel::initNew ← framework::Desktop::loadComponentFromURL ← binaryurp
Breakpad handler thread
  ntdll!RtlEnterCriticalSection              ← waits for the CRT locale lock (held by the main thread)
  ucrtbase (_stdio_common_vswprintf …)
  dbgcore!MiniDumpWriteDump
modules: python313.dll, pyuno.pyd, pythonloaderlo.dll loaded; soffice's stderr:
  "Could not find platform independent libraries <prefix>" (an embedded Python started)
```

**Root cause (chain):**

1. soffice.bin runs with the UTF-8 active code page (`<activeCodePage>UTF-8</activeCodePage>` in its
   manifest).
2. Creating a Writer document creates the linguistic service manager. `LngSvcMgr`'s constructor calls
   `UpdateAll()` → `getAvailableLocales(Proofreader)` → `GetAvailableGrammarSvcs_Impl()`, which instantiates
   **every** registered grammar checker (`linguistic/source/lngsvcmgr.cxx`, 26.8), no configuration can
   prevent it. The bundled dictionaries `dict-en`, `-hu`, `-pt-BR`, `-ru` register **Lightproof**, a
   *Python* component → pyuno's loader starts an embedded Python inside soffice.bin (verified: creating the
   LinguServiceManager alone loads `python313.dll`; Calc and Impress documents do not).
3. `Py_Initialize()` calls `setlocale(LC_CTYPE, "")`. On Windows 11 with the Turkish region this yields
   `Turkish_Türkiye.utf8` (UTF-8 encoded, `T\xc3\xbcrkiye`): the process-global C locale now has a
   non-ASCII name.
4. Later, LibreOffice builds a `std::locale` for UI strings (`Translate::Create` → boost.locale → MSVC STL
   `std::_Locinfo`), which switches and restores the C locale by name. With names in two encodings in play
   (the Python-set UTF-8 one, cp1254 names from the locale lookup), UCRT's narrow `setlocale` fails its
   multibyte conversion and raises an **invalid parameter**.
5. LibreOffice's crash reporter (Breakpad, `CrashDumpEnable=true` in `soffice.ini`) handles invalid
   parameters by writing a minidump on its handler thread while the faulting thread waits.
   `MiniDumpWriteDump` formats strings with `vswprintf`, which needs the CRT locale lock — held by the
   faulting main thread inside `setlocale`. **Deadlock**: soffice.bin hangs forever and leaves a 0-byte dump.

Whether it strikes depends on the order of Python start-up and the first `std::locale` construction (and on
whether the bundled extensions are already registered), hence "second session", "after waiting", "only
Writer". It needs a Windows region whose English name is not ASCII: Türkiye (Windows 11, updated Windows 10),
also e.g. Norwegian Bokmål; CI runners with an English region never see it.

**Standalone reproduction without LibreOffice** (`test-output/engine/hang/acp_repro.py`, `acp_probe4.py`): a
copy of the bundled `python.exe` given soffice.bin's manifest setting (`activeCodePage=UTF-8`, set with
`UpdateResourceW`), then the STL calls `std::locale` makes:

| process state | `std::_Locinfo(LC_CTYPE, "Turkish_T\xfcrkiye.1254")` + restore |
|---|---|
| global locale `C` (soffice.bin without Python) | ok |
| after Python's `setlocale(LC_CTYPE, "")` (`Turkish_T\xc3\xbcrkiye.utf8`) | process killed with `0xC0000409` (invalid-parameter fast fail; Breakpad would deadlock instead) |

**Hypotheses ruled out** (each with the fix off, fresh profile, first Writer document):

| Hypothesis | Experiment | Result |
|---|---|---|
| OpenCL start-up check | `SAL_DISABLE_OPENCL=1` (OpenCL.dll not even loaded); the product template also sets `UseOpenCL=false` | still hangs, same `setlocale` deadlock |
| AsyncCallback marshalling / main thread busy | direct calls from a Python thread (`--via direct`) | still hangs; the deadlock moves to the URP request thread that runs `loadComponentFromURL` |
| Profile reuse / extension synchronisation | fresh profile, first session | hangs as well (3/3 sessions in `repro.py`) |
| Waiting for start-up to settle | earlier investigation: 30 s idle, then Writer | hangs |

**Fix** (`src/main/engine/launch.ts`): soffice gets `-env:URE_MORE_SERVICES=<value>` — the value of the
engine's own `fundamental.ini` with the `<$ORIGIN/services>*` wildcard replaced by the explicit list of
`program/services/*.rdb` **minus `pyuno.rdb` (the in-process Python loader) and
`scriptproviderforpython.rdb`**. Command-line `-env:` variables override the ini files; nothing in the
installation changes. Python components then fail to instantiate (LibreOffice catches that) and no
interpreter ever starts inside soffice.bin. The list is derived at start-up from the actual engine (dev image,
packaged image or a user-configured engine); an unknown layout leaves the engine untouched and logs why.
Also `SAL_DISABLE_OPENCL=1` (GPU driver DLLs stay out of soffice.bin even if the profile setting were lost).
The bridge is unaffected (its own `python.exe` process).

What is lost: Lightproof grammar checking (English, Hungarian, Portuguese, Russian), Python macros (macros
are disabled anyway), mail-merge e-mail and the Python wizards (not exposed). Spell checking (hunspell,
C++) is unaffected: verified Turkish "merhaba" ✓ / "merhabaa" ✗ / "Çağrı" ✓ and English "hello" ✓ /
"helo" ✗ with the fix active, and `getAvailableServices(Proofreader, en-US)` is empty instead of Lightproof.
`SIMPAPER_ENGINE_KEEP_PYTHON=1` restores the upstream behaviour for diagnostics only.

**Proof.** Same harness with the override: 6/6 sessions (fresh + reused, every module first), Writer
0.14–0.29 s, no `python313.dll` in soffice.bin. Through the product path: `tests/engine/startup.test.ts` with
`SIMPAPER_ENGINE_LONG=1` — for each module order a fresh profile plus 10 sessions on the reused profile —
passed three complete runs (36 sessions each, 108 + 9 short sessions in total), every session asserting that
soffice.bin has not loaded `python313.dll` (`tasklist /M`), so the regression is caught even on an English
CI runner. Control: the same short test with `SIMPAPER_ENGINE_KEEP_PYTHON=1` (fix off) fails — `doc.new` of the
first Writer document in the fresh profile times out after 60 s, `engine.shutdown` times out and the
processes are killed.

## 9. Root cause: soffice.bin crash "release after close"

**Found by** the first start-up loop: soffice exited with code 0 in the second session. The dump
(`tests/engine/diagnostics/minidump.py --scan`):

```
0xC0000005 reading 0x530 in mergedlo!SfxItemPool::CheckItemInfoFlag   (thread: URP worker, not main)
  SfxItemSet::ClearAllItemsImpl ← SfxItemSet::~SfxItemSet ← SdrObject::~SdrObject ← (sdlo)
  ← SvxShape::~SvxShape ← cppu::OWeakAggObject::release ← cppu/binaryurp (incoming release request)
```

A remote release of an Impress shape proxy was processed after its document had been closed: the `SvxShape`
held the last reference to its `SdrObject`, whose item pool died with the document. binaryurp sends every
release on the dedicated logical thread `releasehack` (to avoid deadlocks with the SolarMutex), so soffice
executes releases asynchronously; the destructor waits for the SolarMutex, which the main thread holds while
running our close job — the close wins the race. Reproduced without the bridge (`release_race.py`: new
Impress document, read the shapes' text, close; soffice died in round 11 of one run; intermittent).

**Fix** (bridge): closing is two main-thread jobs with a **release barrier** in between
(`Office.release_barrier`, `Documents.begin_close`/`finish_close`, also for `engine.shutdown`):

1. job: detach our listeners (the document stays open);
2. worker thread: `gc.collect()`, then create a soffice-side `com.sun.star.script.Invocation` adapter that
   holds a Python object of ours, and release it. Releases are processed in order on `releasehack`, so when
   soffice destroys the adapter (and releases our object back), every earlier release has been processed;
   the worker waits for that (≤ 3 s, typically < 1 ms);
3. job: close the model, dispose the view, drop our proxies.

With the barrier the race harness ran 40/40 rounds clean and the start-up loop never crashed again (three
long runs). Jobs also no longer let tracebacks carry proxies beyond the job (§4).

## 10. Views (owned and child)

- **owned**: `Toolkit.createWindow` with a `TOP` `workwindow` descriptor, no parent, no attributes (created
  hidden, not maximized) at the `bounds` hint → `Frame.initialize`, all in one main-thread job
  (`Documents.prepare_window`). Outside of any job (`Methods._open_document`), `owned.own_window` makes the
  still hidden window a borderless tool window owned by `parentHwnd` (same style arithmetic as
  `src/main/platform/win32/styles.ts`, then `GWLP_HWNDPARENT` and `SWP_FRAMECHANGED`); the Win32 calls wait for
  soffice's main thread, which would deadlock inside a job, so they run on a helper thread with a 10 s limit.
  A second job loads into the frame; LibreOffice then shows it and brings it to the front itself
  (`LoadEnv`, `ShowFlags::ForegroundTask`) — as an owned window of Simpaper. The view host's `makeOwned` finds
  nothing to change and only places the window. Before, the host converted the frame after the load, when it
  was already shown and the foreground window; hiding, restyling and owning it from a koffi worker left
  Electron's UI thread hung inside `PeekMessage` while soffice idled in `GetMessage` (GUI spike, stacks in
  `test-output/gui/*-stacks.txt`). Without `parentHwnd` the old path (host converts) still works. A stored
  window state could maximize a frame: the bridge restores it (`IsMaximized = False`).
- **child**: `Toolkit.createSystemChild(parentHwnd)` (the view host's container) at `0,0,w,h`; the bridge adds
  `WS_EX_NOPARENTNOTIFY` after the load (no synchronous `WM_PARENTNOTIFY` to our process on clicks/destroy).

Measured on a non-headless soffice with a never-shown host window in a per-monitor-aware helper process
(`tests/engine/views.test.ts`; every frame loaded `startHidden`, nothing ever shown):

| | style / ex-style | visible | DPI awareness (GetWindowDpiAwarenessContext) |
|---|---|---|---|
| owned frame (owned by the engine before the load) | `0x86000000` (POPUP, CLIPSIBLINGS, CLIPCHILDREN) / `0x80` (TOOLWINDOW), owner = host, not zoomed | no | 1 (system aware) |
| after `makeOwned` (platform code) | unchanged: no call that hides, restyles or re-owns | no | 1 |
| child frame | `0x40000000` (CHILD), parent = host, 640×480, + NOPARENTNOTIFY | no | 2 (per monitor, like the host) |
| owned frame created **after** a child view in the same soffice | not a child | no | **2** |

The last row confirms the forced DPI-awareness reset described in docs/dev/platform.md: once soffice has
created a child under a per-monitor-aware parent, its later top-level windows are per-monitor aware too,
although VCL is written for system awareness. Never mix child and owned views in one engine instance (the
product does not: one document and one view mode per instance).

## 11. Measured timings (this PC, Windows 11, LibreOffice 26.8.0.3, headless)

| Step | Time |
|---|---|
| Instance start, fresh profile slot (profile creation + extension registration) | 5.3–6.6 s (up to 8.4 s) |
| Instance start, reused slot (spawn → `engine.hello`) | 2.0–2.8 s, median 2.3 s |
| `doc.new` Writer / Calc / Impress | 50–260 / 45–134 / 60–174 ms (first Writer document of a session ~200 ms) |
| Instance dispose (`engine.shutdown` incl. barrier, terminate, exit) | 0.6–0.9 s |
| Restart after a killed soffice.bin | 2.3 s |
| DOCX store / load in a new instance | 230 / 451 ms |
| XLSX store / load; PPTX store / load | 24 / 143 ms; 36 / 229 ms |
| PDF export Writer (first in instance) / Calc / Impress | 553 / 239 / 30 ms |
| `convert()` DOCX → PDF/A-2b incl. starting the conversion instance | 5.7 s (fresh slot) / 2.8 s (reused slot) |
| Encrypted DOCX store / load | 63 / 250 ms |
| 20 000 × 5 CSV import / SUM over 20 000 cells / XLSX store / XLSX reload | 174 / 3 / 218 / 176 ms |

## 12. Tests

```powershell
npx vitest run --project unit src/main/engine                     # launch overrides, profiles, manager (21)
vendor\libreoffice\program\python.exe -m unittest discover -s engine/bridge/tests -t engine/bridge   # bridge (109)
npx vitest run --project engine tests/engine/startup.test.ts tests/engine/lifecycle.test.ts `
  tests/engine/roundtrip.test.ts tests/engine/calc.test.ts tests/engine/export.test.ts `
  tests/engine/store.test.ts tests/engine/views.test.ts tests/engine/profile.test.ts --silent=false   # real engine (~2 min)
$env:SIMPAPER_ENGINE_LONG='1'; npx vitest run --project engine tests/engine/startup.test.ts   # loop, ~170 s
```

The Python suite needs no soffice; `test_connection.py` starts a URP peer in a second bundled-Python
process (`engine/bridge/tests/urp_peer.py`) to test connection loss for real. `src/main/engine/EngineManager.test.ts`
runs the manager with a fake `OfficeInstance` (nothing is spawned).

Vitest 5 hides the console output of passing tests; `--silent=false` shows the timing tables.
`test-output/engine/startup-report.json` keeps the per-session timings of the last start-up run.

| Suite | Covers |
|---|---|
| `startup.test.ts` | fresh + reused profiles, all module orders, no Python in soffice.bin (hang regression) |
| `lifecycle.test.ts` | handshake, `.uno:Save` interception (no file written), `.uno:Bold` state events, undo/redo, error codes, crash (kill soffice.bin → `crashed: true` → new instance), lost URP connection while soffice runs (lone surrogate → bridge exit code 3 → `crashed: true`, soffice killed, new instance; ~0.4 s), clean disposal |
| `store.test.ts` | `doc.store` `markSaved` (flag cleared with the store, not by copies or a failed store; later edits set it again and are reported) and `baseUrl: ''` (snapshot links absolute; restore + save keeps a relative sibling link, control without it breaks it) |
| `roundtrip.test.ts` | new DOCX/XLSX/PPTX → Turkish text, bold, cells/formulas, slide texts, duplicated slide → store → reopen in a new instance; independent OOXML check |
| `calc.test.ts` | tr/en: stale cached results and unknown functions (`#NAME?`, never the cached 42), SUM/AVERAGE/IF/VLOOKUP/DATE/TEXT/cross-sheet/absolute refs with values, local formulas and displays, formula-bar input, CSV import/export exact bytes, 20 000-row smoke |
| `export.test.ts` | PDF export of all three modules (pdf.js finds the Turkish text), PDF/A conversion instance, password DOCX (`PASSWORD_REQUIRED`, `WRONG_PASSWORD`, content) |
| `views.test.ts` | owned/child frames on a non-headless soffice, nothing shown (§10) |
| `profile.test.ts` | every shortcut override and removal, target commands dispatchable, Turkish-only keys, template settings (tr/en) |

All suites skip cleanly without an engine and dispose their managers (all processes) in `afterAll`.

## 13. Diagnosing a hung or crashed engine

- Hung soffice.bin: `python tests/engine/diagnostics/stackdump.py <officePid>` (LibreOffice's Python works);
  look at "VCL Main". A main thread in `setlocale`/`_invalid_parameter` plus a thread in `MiniDumpWriteDump`
  is the §8 deadlock.
- Crash: soffice.bin exits with code 0 (Breakpad) and leaves `<slot>/crash/*.dmp` until the slot's next start;
  `python tests/engine/diagnostics/minidump.py <dmp> --scan` shows the faulting call chain.
- More log: `SIMPAPER_TEST_VERBOSE=1` for engine tests; the bridge log level is `info` (`--log-level debug`
  when started by hand).

## 14. Known issues and follow-ups

- English (and hu/pt-BR/ru) grammar checking by Lightproof is unavailable (§8). A C++ or out-of-process
  checker would be needed to offer it again.
- Breakpad can still deadlock if soffice.bin faults while holding a CRT lock for another reason (the known
  trigger is gone). The hang watchdog (`HangDetector`) catches such a hang for visible views; hidden
  conversions time out and the conversion instance is replaced.
- Upstream-bug class of §9 (objects outliving their document) can also be hit by LibreOffice-internal
  timing; the barrier only orders *our* releases.
- Fixed: a string with a lone UTF-16 surrogate in a request (JSON `\ud83d`, possible in JavaScript strings,
  e.g. text cut in the middle of an emoji) made binaryurp drop the connection. `framing.scrub_surrogates`
  now replaces lone surrogates with U+FFFD in every decoded request (keys too); valid pairs are unaffected
  because `json.loads` combines them. Content inside soffice never triggered it: a cell with
  `=UNICHAR(55357)` is read back as an empty string.
- A fresh profile slot needs 5–8 s for its first start; copying an initialised "golden" slot would make new
  slots start in ~2 s.
- Visible owned/child views (painting, focus, typing, DPI > 100 %) are only verifiable in the GUI spike.
