# Platform layer (Windows): developer notes

Code: `src/main/platform/**`. Tests: `tests/unit/platform/**`. GUI test plan: [`docs/testing/GUI_SPIKE.md`](../testing/GUI_SPIKE.md).
Status (2026-09-29): implemented and verified headless. The behaviour of real LibreOffice windows on
screen (visibility, focus, DPI at 125/150 %) is **not** verified yet: it needs the GUI spike.

## 1. What it provides

`createPlatform()` (`src/main/platform/index.ts`) returns

| Member | Windows implementation | Other platforms / koffi missing |
|---|---|---|
| `viewHost: ViewHost` | `ViewHostCore<BrowserWindow>` + Win32 ops (owned/child hosting, freeze-frame) | `supported = false`, `viewParamsFor()` → `{ mode: 'hidden' }` |
| `processGuard: ProcessGuard` | Job Object (`KILL_ON_JOB_CLOSE`, no breakaway) + `killTree` via Toolhelp | `taskkill /T /F` (Windows) or `ps` + `SIGKILL`, `supported = false` |
| `hangDetector: HangDetector` | `IsHungAppWindow` + `SendMessageTimeoutW(WM_NULL)` on a worker thread | always `true` (no native windows) |
| `shellKeys?: ShellKeys` | experimental Alt/F10 detector (low-level hook, foreground-gated) | absent |

| File | Role |
|---|---|
| `types.ts` | contracts (`ViewHost`, `ProcessGuard`, `HangDetector`, `ShellKeys`, `Platform`, `KillTreeOptions`) |
| `hwnd.ts` | HWND ↔ decimal string / BigInt / `getNativeWindowHandle()` Buffer |
| `geometry.ts` | CSS → physical mapping, DPI virtualisation formulas (pure) |
| `view-host-core.ts` | all view-host logic over an injected `NativeViewOps` (pure, unit-tested with fakes) |
| `process-tree.ts` | PID-reuse-safe descendant walk (pure) |
| `key-state.ts` | bare-Alt / F10 state machine (pure) |
| `fallback.ts` | non-Windows platform |
| `win32/ffi.ts` | lazy koffi bindings (user32, gdi32, kernel32, shcore) |
| `win32/view-ops.ts`, `win32/capture.ts`, `win32/view-host.ts` | Win32 `NativeViewOps`, PrintWindow capture, Electron adapter |
| `win32/process-guard.ts`, `win32/hang-detector.ts`, `win32/shell-keys.ts` | the other services |
| `win32/styles.ts`, `win32/constants.ts` | window-style computations, SDK constants |

## 2. Wiring it into the app (integrator checklist)

1. **Startup.** Call `createPlatform()` once, early in the main process (before any engine process is
   spawned). It is synchronous and does not touch `screen` until a view is used.
2. **Engine processes.** Right after spawning `soffice.exe` or the bridge's `python.exe`, call
   `processGuard.adopt(child.pid)`. Adoption also picks up children that already exist (snapshot), and
   everything they start later joins the job automatically. On shutdown, after the graceful
   `XDesktop.terminate`, call `processGuard.killTree(pid, { imageDir: <LibreOffice program dir>, timeoutMs })`.
   `imageDir` keeps programs LibreOffice started for the user (e.g. a browser opened from a hyperlink)
   alive. `killTree` rejects if a process survives the timeout; catch and log it.
3. **Loading with a view.** `const view = viewHost.viewParamsFor(win, settings.engine.viewMode, rect)`
   goes into `doc.load`/`doc.new`. When `DocLoadResult.hwnd` arrives:
   `viewHost.attach(docId, win, result.hwnd, view.mode)`. A view becomes visible once it has a rect
   (`setBounds`) and is not hidden (`setVisible(false)`) or frozen. `setBounds`/`setVisible` calls that
   arrive before `attach` are kept and applied at attach time.
4. **IPC handlers** (`src/shared/api/engine.ts`): `view:setBounds` → `setBounds`, `view:setVisible` →
   `setVisible`, `view:freeze` → `freeze` (returns the PNG data URL or null), `view:unfreeze` →
   `unfreeze`, `view:focus` → `viewHost.focus(docId)` **and** the engine call `view.focus` (keyboard focus
   inside LibreOffice is set by VCL; natively we can only activate the owned window). Validate the
   sender; the view host validates rects itself and ignores invalid ones.
5. **Closing.** Call `viewHost.detach(docId)` when a document closes, and close documents before the
   BrowserWindow is destroyed. If a window closes with views still attached they are hidden on
   `closed` (Windows un-owns, but does not destroy, another process' owned windows). `viewHost.dispose()`
   on quit.
6. **Hang watchdog.** Poll `hangDetector.isResponding(hwnd, 1000)` for visible views (every 2–3 s).
   The recovery policy (kill + restore) belongs to the engine layer. Caveat: with attached input queues,
   some window-manager operations of Chromium itself (focus changes) can still block the UI thread while
   soffice hangs; a watchdog that must fire even then has to run off the UI thread (utility process).
7. **KeyTips.** Optional: `platform.shellKeys?.start(win, (key) => …)`; `stop()` when disabled. F10 may
   also arrive as an engine `key` event; de-duplicate.
8. **Active look.** In owned mode, typing in a document activates the LibreOffice window, so the
   BrowserWindow emits `blur`. `viewHost.isForeground?.(win)` tells whether the foreground is still ours
   (host, attached view or one of their dialogs).
9. **Window-message hooks.** The view host hooks `WM_DPICHANGED` and `WM_WINDOWPOSCHANGED` on each host
   window. Electron keeps **one** callback per message per window, so no other module may hook these two.
10. **Packaging.** koffi is a native module: unpack `node_modules/koffi/**` and
    `node_modules/@koromix/koffi-win32-x64/**` from the asar; only the win32-x64 binary is needed.
11. **Process guard mode.** Default `adopt`. `VARAK_PROCESS_GUARD=self` puts the app process itself into
    the job (see §7 for why that is not the default).

### Requirements for the engine bridge

- **Owned mode:** create the frame as a *hidden top-level* window (not `createSystemChild` on our
  HWND), not maximized/minimized, **own it before loading into it** (borderless tool window, owner =
  `parentHwnd`; `engine/bridge/varak_bridge/owned.py`, between two main-thread jobs) and report its HWND.
  The view host then only places and shows it; `makeOwned` converts a frame itself only when the engine
  did not (no `parentHwnd`). Converting a frame that LibreOffice had already shown and made the foreground
  window hung Electron's UI thread (§6, GUI spike 2026-09-29). Reason: a cross-process `CreateWindow` under a parent
  with a different DPI awareness makes Windows force-reset the *creating* process' DPI awareness
  (Windows 10 1703+, Microsoft "High DPI Desktop Application Development on Windows"); owned top-level
  windows may differ in DPI awareness. `ViewParams.bounds` is a physical-pixel hint only.
  (`createSystemChild` frames are converted too — `SetParent(NULL)` + styles — but that path is the
  one Windows documents as a forced reset.)
- **Child mode:** `createSystemChild` on `parentHwnd` (our container, not the BrowserWindow) with the
  given `bounds` (`0,0,w,h`). Give the frame `WS_EX_NOPARENTNOTIFY` if possible (fewer synchronous
  cross-process messages).
- HWNDs are exchanged as decimal strings; `parseHwnd` accepts signed (sal_Int64) and unsigned values.

## 3. koffi 3.3.2 (verified on this PC, Node 22.20 and Electron 44.4.5)

- Pointer/handle results are **BigInt** (`null` for NULL); pointer arguments accept BigInt, Number or
  null, never strings. `intptr_t` results are Numbers.
- `user32` ignores the upper 32 bits of an HWND (`IsWindow(0xFFFFFFFF_00010168n)` is true for
  `0x00010168`), so handles are canonicalised to their low 32 bits (`hwnd.ts`).
- Buffers/TypedArrays passed as `void *` are passed by reference, also to `.async` calls.
- `.async` runs on a koffi worker thread. In Electron both the UI thread and the koffi worker threads
  report `DPI_AWARENESS_PER_MONITOR_AWARE` (2), so Win32 coordinates there are physical pixels.
- A `koffi.register`ed callback is invoked from Electron's message loop (WinEvent test).
- koffi's named-type registry is process-global: the bindings use anonymous types only.
- `koffi.view` (external buffers) is forbidden in Electron; not used.

## 4. Coordinates and DPI

Electron is Per-Monitor v1, LibreOffice is System-aware. Formula (also in `geometry.ts`):

```
s       = webContents zoomFactor × display scaleFactor          (CSS px → DIP → physical px)
edges   = round(css.x·s), round(css.y·s), round((css.x+css.w)·s), round((css.y+css.h)·s)   (half away from zero)
client  = edges ∩ host client area                              (child mode: container rect)
screen  = client + ClientToScreen(host, 0,0)                    (owned mode)
```

- The client origin comes from `ClientToScreen` (physical, exact). `win.getContentBounds()` (DIP) ×
  scale factor would be wrong on non-primary monitors of a mixed-DPI desktop, because Chromium lays out
  each display's DIP rectangle separately (`Display.nativeOrigin` is X11-only).
- The scale factor is Electron's `screen.getDisplayMatching(win.getBounds()).scaleFactor` (what
  Chromium renders with), falling back to `GetDpiForWindow(host)/96`.
- Edges are rounded independently so adjacent areas never gap or overlap.
- All `SetWindowPos` calls come from per-monitor-aware threads, so they are physical and Windows
  converts them for the System-aware LibreOffice window, which it then bitmap-stretches (blurry, but
  correctly placed) on monitors whose DPI differs from the system DPI (tdf#145710).
- What LibreOffice itself sees (DPI virtualisation):
  `virtual = round(physical × systemDpi / monitorDpi)`, scaled from the virtual-screen origin
  (observed on Windows 8.1, Mozilla bug 890156 comment 5; re-verify on Windows 11 in the spike). Used
  for the PrintWindow surface size: a DPI-virtualised window renders `physical × windowDpi / monitorDpi`.
- Unit tests cover 100/125/150/175/200 %, zoom factors, mixed monitors (right/left of the primary,
  negative coordinates), clipping, and the virtualisation examples. This PC has two 96-DPI monitors,
  so nothing above 100 % has been observed on screen.

## 5. Threading rules

LibreOffice's windows belong to another process whose UI thread is input-attached to Electron's
(owner/owned or parent/child across threads). A hung soffice must never block Electron's UI thread:

| Operation | Where | Why |
|---|---|---|
| `SetWindowPos`, `ShowWindow`, `SetWindowLongPtrW`, `SetParent`, `SetForegroundWindow`, `PrintWindow`, `SendMessageTimeoutW` on LibreOffice windows | koffi `.async` (worker), one at a time per view, after an `IsHungAppWindow` check | these send messages to the soffice UI thread |
| `IsWindow`, `IsHungAppWindow`, `GetWindowLongPtrW`, `GetWindowRect`, `GetParent`, `GetForegroundWindow`, `GetAncestor` | sync | answered without sending messages |
| `CreateWindowExW`/`SetWindowPos` on our child container, `ClientToScreen` on the host | sync, UI thread | our own windows; `CreateWindowExW` must run on the host's thread |

Per view there is a promise queue: at most one native operation in flight; bursts (window drags)
coalesce to the latest state. Operations on a window that is not responding are retried every 500 ms.

## 6. Hosting modes

**Owned (experimental since 2026-09-29, see ADR 0003).** Normally the engine has already owned the frame
(requirements above) and `makeOwned` returns without a single call that could hide, restyle or re-own it —
the loaded frame may be shown and active at that moment, and doing that from a koffi worker is what left
Electron's UI thread blocked in `NtUserPeekMessage` in the first GUI spike. Fallback for a frame the engine
did not own: `attach` hides the frame, drops `WS_CHILD` (via `SetParent(NULL)`), removes caption,
frame, system menu and min/max boxes, adds `WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS`, adds
`WS_EX_TOOLWINDOW`, removes `WS_EX_APPWINDOW` and the 3-D edges, sets the owner
(`GWLP_HWNDPARENT`) and applies `SWP_FRAMECHANGED` (verified on hidden cross-process windows). The
host is followed through `move`, `resize`, `maximize`, `unmaximize`, `restore`, `minimize`, `show`, `hide`,
`enter/leave-full-screen`, `WM_DPICHANGED` and `WM_WINDOWPOSCHANGED`. Views are hidden while the host is
minimized/hidden, the tab is inactive (`setVisible(false)`), frozen, or the area is empty.
Showing and hiding use `SetWindowPos` (`SWP_SHOWWINDOW`/`SWP_HIDEWINDOW` + `SWP_NOACTIVATE`) together with
the move, from the view's worker queue: one message, in order with the rest (`ShowWindowAsync` would be
overtaken by sent messages). A view that appears is inserted directly above its owner in the z-order;
setting the owner afterwards does not reorder windows, so a frame created before the host was last
activated (e.g. a warm spare engine) would otherwise appear behind it. Moves use `SWP_NOZORDER`.
Limits: an owned window trails the host by a few milliseconds while it is dragged; clicking into the
document activates the LibreOffice window (host `blur`); `focus()` only activates while Varak is in the
foreground (Windows foreground lock) and calls `AllowSetForegroundWindow` for the engine process so its
dialogs can come to the front.

**Child (default since 2026-09-29; passed the GUI spike).** The view mode is read once at start-up
(`bootstrap.ts`): child hosting also needs Chromium's `--disable-features=RemoveRedirectionBitmap`, which can
only be set before the app is ready. One `STATIC` container per BrowserWindow (no JS window procedure), created hidden with
`WS_EX_LAYERED` + `SetLayeredWindowAttributes(255, LWA_ALPHA)` so GDI/raster content is visible despite
Chromium's `WS_EX_NOREDIRECTIONBITMAP`; the LibreOffice child fills it (`0,0,w,h`). The container is moved
in client coordinates and re-raised to `HWND_TOP` after resizes (immediately and once more 150 ms after
the burst) because Chromium re-raises its legacy window. When a view appears, the child is shown before
the container; when it hides, the container goes first (instant). Caveats (inherent to cross-process
children): the forced DPI reset above, and hiding the container while the LibreOffice child has keyboard
focus sends `WM_KILLFOCUS` synchronously to soffice.

**LibreOffice dialogs.** soffice is never the foreground process, so Windows' foreground lock would keep a dialog
it opens (Paragraph…, Font…) inactive, without the keyboard focus. Before every `engine:dispatch` the main process
calls `Platform.allowForeground(officePid)` (`AllowSetForegroundWindow`); the dialog then activates itself (checked
on screen: focus, a real Esc closes it, the ribbon is disabled while it is open).

**Freeze-frame.** `freeze` captures with `PrintWindow(PW_RENDERFULLCONTENT)` on a worker thread (1.5 s
budget; GDI objects are freed only when the call returns), converts BGRA → alpha 255 →
`nativeImage.createFromBitmap` (BGRA verified) → PNG data URL, then hides the view. Calls nest; the view
reappears when the last `unfreeze` arrives. Captures larger than 8K are refused. Hidden, hung or
non-existent views return null (the view is hidden anyway).

## 7. Process guard

Job: `CreateJobObjectW` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, breakaway **not** allowed, the only handle
held by the app. Experiments on this PC (Node 22.20, Windows 11 26200):

| Scenario | Result |
|---|---|
| No job: kill parent of a detached grandchild | grandchild survives (baseline) |
| Adopt child right after `spawn` (child in libuv's silent-breakaway job), grandchild started later | grandchild is in our job; closing the job kills both |
| Adopt a child whose grandchild already runs | snapshot adoption puts both in the job |
| App process in the job, child spawned normally, grandchild detached; app exits | child and grandchild die |
| Nested job with UI restrictions (what Chromium's sandbox does) inside our job | assignment succeeds |
| Electron 44 app process in the job (`self`) | sandboxed GPU process and network service run inside it |

Why `adopt` is the default although `self` covers everything without calls: with the app process in a
no-breakaway kill-on-close job, **everything the app starts dies when it exits**: Electron's
`app.relaunch()` helper (it uses plain `base::LaunchProcess`, no breakaway, so the relaunch never
happens), an updater started before quitting, and programs opened via `shell.openExternal`/`openPath`
that were not already running (a PDF viewer the user keeps working in would be killed with Varak).
`VARAK_PROCESS_GUARD=self` enables it anyway; if it cannot join (enclosing job), it logs and falls back to
`adopt`. Programs LibreOffice itself starts (hyperlinks) are in the job in both modes; routing hyperlink
opening through the main process would avoid that.

`killTree(pid)`: Toolhelp snapshot → descendants whose creation time is not earlier than their parent's
(PIDs are reused; an older "child" belongs to a previous owner of the PID) → terminate leaves first,
root last, exit code 1 (LibreOffice's launcher restarts soffice.bin only for 79/81) → up to three passes
for children spawned meanwhile → `WaitForMultipleObjects` on a worker → reject if anything survives.
Refuses PID ≤ 0 (`process.kill(0)` terminates the calling process on Windows), 1, 4, itself and its
parent. Orphans whose parent already exited are not reachable by parent id; kill them through their own
PID (e.g. `officePid` from `engine.hello`).

## 8. Hang detection and shell keys

`isResponding(hwnd, timeout)`: false for a destroyed window or one Windows flags as hung
(`IsHungAppWindow`, 5 s without message retrieval), else `SendMessageTimeoutW(WM_NULL,
SMTO_ABORTIFHUNG|SMTO_BLOCK)` on a worker thread. Verified with message-only windows in child processes:
a pumping thread answers in ~70 ms; a blocked thread returns false after the timeout while the event loop
keeps running.

`ShellKeys` installs `WH_KEYBOARD_LL` only while the foreground window is the host or one of its views
(`EVENT_SYSTEM_FOREGROUND` WinEvent), and `WH_MOUSE_LL` only during an Alt/F10 gesture (a click cancels:
Alt+drag is block selection). It never swallows input (`CallNextHookEx`), reports via `setImmediate`,
ignores AltGr (Turkish Q/F: synthetic Left-Ctrl + Right-Alt) and any combination, and forgets keys whose
key-up it missed (2 s). The hooks themselves are not exercised by automated tests (they would affect the
real keyboard); the state machine is.

## 9. Tests

```powershell
npx vitest run --project unit tests/unit/platform          # 106 tests incl. real processes, headless
node tests/unit/platform/electron/run-headless-check.ts    # Electron 44 without windows, ~5 s
```

- Pure: HWND conversions, geometry/DPI (100–200 %, mixed monitors), style bits, process tree (PID reuse,
  cycles, filters), Alt/F10 state machine, view-host core with fake windows/ops (owned + child, freeze,
  coalescing, retries, host events, closing, dispose), fallback platform, pixel helpers.
- Real, headless: `killTree` on node → node trees (single and wide), `imageDir` filter, job adoption
  (before/after grandchildren), self mode, hang detection on message-only windows, owned-mode conversion of
  hidden cross-process windows (top-level and WS_CHILD frames).
- Headless Electron check: the bundled module in Electron's main process, DPI awareness of UI and worker
  threads, BGRA order, callback delivery, Chromium helpers inside the job.

## 10. Known gaps

- GUI spike 2026-09-29 (`scripts/gui/gui-spike.mjs`, 100 %): **child** passed (placement, typing, ribbon,
  Ctrl+S, backstage, Calc/Impress/PDF, window moves, themes); **owned** hung the UI thread about 3 s after
  the first document appeared (fix above, not yet re-run on screen). Still not observed: DPI > 100 %,
  mixed-DPI monitors, shell-key hooks, freeze fidelity in owned mode.
- **Owned mode, second run (with the engine owning the frame first):** Varak stayed responsive, but soffice
  stopped responding about 4 s after the first click into the document (hang detector: "engine window not
  responding"; `doc.info` timed out). Owned mode is therefore no longer offered in Options; it can only be set in
  `settings.json` (`"engine": { "viewMode": "owned" }`) for development.
- **Synthetic key bursts:** keys injected within a few milliseconds right after a document's first modification
  are lost inside LibreOffice before they reach the frame's key handlers (the bridge's `XKeyHandler` saw 71 of
  117 key presses; the OS focus stayed on the LibreOffice window and the renderer received nothing). The same
  text typed at 40 ms per key — faster than people type — arrives completely, as does every later burst. VK_PACKET
  (Unicode) input works too. The GUI spike therefore types at 40 ms per key. Cause inside VCL not identified.
- The DPI virtualisation anchor (virtual-screen origin) is from Windows 8.1 observations.
- A renderer (not only GPU/utility processes) inside a `self`-mode job was not started (needs a window).
- `killTree` cannot find orphans of an intermediate process that already exited.
