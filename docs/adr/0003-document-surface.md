# ADR 0003: Document surface — LibreOffice's editing window hosted in the Varak window

- **Status:** Accepted, amended 2026-09-29 after the first GUI spike: the **child** embedding (in a layered
  container) is the default for M1; the owned overlay is kept as an experimental option (see the amendment
  at the end).
- **Date:** 2026-09-29
- **Related:** [ARCHITECTURE.md](../ARCHITECTURE.md#4-document-surface-on-windows),
  [ADR 0001](0001-engine.md), [ADR 0002](0002-shell.md), research: [engine](../research/engine.md),
  [shell](../research/shell.md), contract: `src/main/platform/types.ts` (`ViewHost`)

## Context

LibreOffice's editing view is a native Win32 window in another process (`soffice.bin`). It has to appear
inside the Varak window, exactly in the document area below the ribbon, and follow moves, resizes,
minimise/maximise and DPI changes.

Findings from the research and from a feasibility prototype (September 2026, LibreOffice 26.2/26.8,
Electron 44):

- Embedding through UNO works: frame creation in about 11 ms, documents load in 0.4–1.7 s, command state is
  streamed through status listeners, Save and Print can be intercepted, DOCX/XLSX/PPTX save correctly and
  Turkish text renders correctly.
- In an **Electron** host a GDI/raster-painted `WS_CHILD` window is **invisible**: since Chromium 139 top-level
  windows have `WS_EX_NOREDIRECTIONBITMAP`. The child still received input (Ctrl+B and Ctrl+S reached it).
- Microsoft's rule: all windows of one parent/child tree share one DPI awareness mode; Electron is Per-Monitor
  v1, LibreOffice is System aware. Cross-process parent/child (and owner/owned) relations also attach the input
  queues of the two threads, so a hung `soffice.bin` can freeze the host.
- HTML cannot be drawn over a native window (airspace), so ribbon drop-downs, galleries and dialogs that
  overlap the document area would be hidden behind it.
- Intermittent `soffice.bin` crashes when closing remotely driven Calc/Impress documents match open upstream
  bugs (tdf#172048, tdf#172304).

## Decision

All hosting goes through the `ViewHost` interface (`src/main/platform/types.ts`), implemented for Windows in
`src/main/platform/win32/`, with three modes (`ViewMode` in `src/shared/engine-protocol.ts`):

1. **`owned` (default):** LibreOffice's frame is a borderless top-level window **owned** by the Varak window
   and positioned in screen coordinates exactly over the document area. Being a top-level window it has its
   own redirection surface (visible) and its own DPI context. Varak re-applies the position after every move,
   resize, maximise, restore and DPI change of the host (`syncAll`).
2. **`child`:** the classic `createSystemChild` `WS_CHILD` embedding, kept for comparison and for hosts that
   do not have the Chromium limitation.
3. **`hidden`:** no visible window, for tests, conversions and recovery snapshots.

Supporting rules:

- **Freeze-frame for popups:** before HTML UI overlaps the document area (drop-downs, galleries, backstage,
  dialogs), the native view is captured (`PrintWindow`), shown as an image and hidden; it is restored when the
  popup closes (`freeze` / `unfreeze` in the IPC contract).
- **Never block the UI thread:** Win32 calls on LibreOffice windows run asynchronously (koffi `.async` or a
  worker); a watchdog uses `SendMessageTimeout(WM_NULL, SMTO_ABORTIFHUNG)` from a worker thread to detect a
  hung engine (`HangDetector`) and offers recovery.
- **Commands go through Varak:** file commands (New, Open, Save, Save As, Print, Close, Quit, Options,
  Macros, Help) are intercepted in the engine with a dispatch interceptor and routed to the shell; LibreOffice's
  menus, toolbars and status bar are hidden.
- **Closing:** documents are closed through UNO before their window is destroyed; closing a document ends its
  engine instance ([ADR 0001](0001-engine.md)).

## Alternatives considered

| Alternative | Why not chosen as default |
|---|---|
| `WS_CHILD` inside the Electron window | Invisible under Chromium ≥ 139; one DPI mode per window tree; kept as `child` mode |
| Layered intermediate child window (`WS_EX_LAYERED`) or `--disable-features=RemoveRedirectionBitmap` | Relies on behaviour Chromium may change or remove; the flag is documented as temporary |
| LibreOfficeKit tile rendering into a canvas | Removes airspace and DPI problems, but JSDialog is gone in 26.8 and stock builds are unproven for editing |
| LibreOffice's own top-level windows with its NotebookBar | No integrated shell; kept as the last-resort fallback |
| WPF host with `HwndHost` | Needs the .NET SDK and a second UI stack ([ADR 0002](0002-shell.md)) |

## Consequences

- Positive: the document is visible and interactive in an Electron host; each window keeps its own DPI mode.
- Negative: position synchronisation is our responsibility; during fast window moves the overlay can lag by a
  frame, and window activation/z-order between the owner and the owned window must be managed.
- Negative: popups over the document area show a still image of the document while they are open.
- Negative: input-queue coupling still exists for owned windows; a hang in the engine must be detected and
  handled.
- Open: behaviour at 125/150/200 % scaling and with mixed-DPI monitors has not been verified (the development
  machine runs both monitors at 100 %); the final choice between `owned` and `child` is scheduled for M2.
- Portability: this surface is Windows-specific. Linux/X11 could reuse the child strategy; macOS and Wayland
  need a different surface (for example a LibreOfficeKit build).

## Amendment (2026-09-29): results of the first GUI spike

The GUI spike (`scripts/gui/gui-spike.mjs`, packaged app, real mouse and keyboard, this PC at 100 %) showed:

- **owned:** Varak stopped responding about 3 s after the first Writer document appeared, in the spike and in a
  run without any input. Electron's UI thread was blocked inside `NtUserPeekMessage` while soffice's main
  thread idled in `GetMessage` (stacks in `test-output/gui/*-stacks.txt`). At that moment LibreOffice had
  shown the frame and made it the foreground window itself (`LoadEnv`, `ShowFlags::ForegroundTask`), and the
  host then hid, restyled and owned that active window from a koffi worker thread.
- **child** (layered `STATIC` container, Chromium started with `--disable-features=RemoveRedirectionBitmap`):
  the whole spike passed — document visible and placed exactly, keyboard input, ribbon commands, Ctrl+S with an
  independent check of the saved DOCX, backstage, a Calc formula typed in Turkish syntax, a new Impress slide,
  PDFs, window moves and theme changes, no hang.

Decision:

1. **child is the default** (settings v2 migrates the old default `owned` to `child`). The view mode is read
   once at start-up, because the Chromium switch it needs can only be set then.
2. **owned is kept for development only.** The first trigger is removed — the engine now owns the frame
   *before* loading into it, while it is hidden and inactive (`engine/bridge/varak_bridge/owned.py`), so the host
   never converts a shown or active window (`makeOwned` changes nothing). In the second GUI run Varak stayed
   responsive, but **soffice** stopped responding about 4 s after the first click into the document. Owned mode is
   therefore not offered in Options; `settings.json` can still select it for further investigation.

Second and third GUI runs (child, same day): the Impress slide pane, the 1-based slide number and the ribbon
layout fixes were confirmed on screen, and typing at 40 ms per key reached Writer completely (see
docs/dev/platform.md §10 for synthetic bursts).

Remaining risks of the child default: it depends on Chromium keeping either the switch or the layered child
window's own redirection surface working (checked on every Electron upgrade by the GUI spike); hiding the
container while the LibreOffice child has the keyboard focus still sends `WM_KILLFOCUS` synchronously to
soffice; and scaling above 100 % and mixed-DPI monitors are not verified (the forced DPI-awareness reset of
cross-process children, docs/dev/engine.md §10).

Later runs the same day (runs 10–13 of docs/testing/GUI_SPIKE.md) measured two consequences of the shared input
queue of the child hosting and changed the code accordingly:

- The keyboard focus stays in the LibreOffice child when the user clicks Varak's web content. The shell now asks
  for it (`view:focusShell`) for its own text boxes, dialogs, the File view and PDFs, and gives it back to the
  document; ribbon tabs and commands leave it in the document as before.
- While soffice hangs, the Varak window gets no mouse or keyboard input at all (its UI thread keeps running). A hang
  that lasts 8 s therefore brings a message box without a parent window (its own input queue) that offers to
  restart the engine, and a hung engine is killed before its view is detached. Isolating the input completely
  would need a different surface (for example rendering the document off-screen), which is out of scope for M1.
