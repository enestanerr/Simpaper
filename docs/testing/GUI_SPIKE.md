# GUI spike: native document views on the desktop

Everything in this plan opens windows or sends keyboard/mouse input, so it runs **only with the owner's
explicit permission**, on a desktop session nobody else is using (no game or other full-screen app
running). Headless parts of the platform layer are already verified (`docs/dev/platform.md` §9); this plan
covers what only a real desktop can show, and decides the open questions of ADR 0003 (owned vs child
hosting) and roadmap M2 (high DPI).

## 0. Preparation

| Item | Value |
|---|---|
| Build | `npm run build`, then `npm start` (or `npm run dev` for DevTools) |
| Engine | `vendor/libreoffice` (26.8.0.3) |
| Logs | `VARAK_DEBUG=1`: the view host logs `Owned view ready {windowDpi, hostDpi}`, attach/detach and failures |
| Mode switch | `settings.json` → `"engine": { "viewMode": "child" }` (default) or `"owned"` (development only); read at start-up, so restart Varak |
| Guard mode | default `adopt`; `VARAK_PROCESS_GUARD=self` for test J3 only |
| Test files | `tests/corpus` (Writer DOCX with images/tables, Calc XLSX with 3 sheets, Impress PPTX with 10 slides) |
| Tools | Windows Settings → Display (scale), a second monitor, Process Explorer (suspend/kill), NVDA or Narrator, Snipping Tool |
| Record | one row per test and mode: pass/fail, notes, screenshot name, measured numbers |

Display configurations to run: **D1** both monitors 100 % (this PC today) · **D2** primary 125 % ·
**D3** primary 150 % · **D4** mixed: primary 100 %, secondary 150 % · **D5** mixed: primary 150 % at
sign-in, secondary 100 % (system DPI 144). After changing the primary's scale, sign out and back in
(the system DPI is fixed at sign-in). Run A–H in **both** modes on D1 and D4; the rest where noted.

Common pass rule for placement: the LibreOffice surface covers the document area to **±1 physical pixel**
on every edge (check with a screenshot at 400 % zoom), no black, white or stale regions, no flicker longer
than one frame.

## A. Visibility and placement

| # | Steps | Pass criteria |
|---|---|---|
| A1 | Open one DOCX, one XLSX, one PPTX. | Each renders in its document area; no taskbar button or Alt+Tab entry for the LibreOffice window; no border/caption. |
| A2 | Resize the window from each edge and corner, slowly and fast (20 s). | The view follows; during a fast drag it may trail by ≤ 1 frame, then settles exactly (placement rule). |
| A3 | Maximize, restore, maximize via double-click on the title bar; F11 full screen and back. | Placement rule after each step; nothing of LibreOffice outside the client area. |
| A4 | Aero Snap: Win+←, Win+→, Win+↑, snap layouts (Win+Z), drag to a screen edge. | Placement rule after each snap. |
| A5 | Minimize and restore (taskbar click, Win+D twice). | View hidden while minimized; back in place after restore; the document keeps its scroll position. |
| A6 | Switch document tabs 20 times quickly. | Only the active tab's view is visible; no view of another tab flashes. |
| A7 | Collapse/expand the ribbon, hide/show the status bar. | View resizes to the new area (placement rule). |
| A8 (child) | 500 random resize/maximize/snap cycles (script or manual 2 min), then click and scroll in the document. | Every click and wheel event reaches LibreOffice (the container stays above Chromium's legacy window). |
| A9 (child) | Repeat A1 with `SAL_SKIA=raster` and with the default Skia backend. | Content visible in both (layered container works). |

## B. Focus and typing (Turkish)

| # | Steps | Pass criteria |
|---|---|---|
| B1 | Turkish Q layout: click into Writer, type `ığüşöçİĞÜŞÖÇ ı i I İ`. | Exact characters appear; no character goes to the ribbon. |
| B2 | Turkish F layout (add it in Settings → Language): type the same line. | Same as B1. |
| B3 | AltGr on Turkish Q: AltGr+Q (@), AltGr+E (€), AltGr+< (\|), AltGr+ş (´ dead key) then e. | Characters inserted; **no KeyTips appear**; LibreOffice menus do not open. |
| B4 | Click the ribbon (e.g. Bold), then click back into the document and type. | Typing continues in the document after one click; caret visible. |
| B5 | `view:focus` path: use a ribbon control that returns focus to the document (e.g. font size box + Enter). | Keyboard focus is back in the document without a click. |
| B6 | Alt+Tab to another app and back (3×), and click the taskbar button. | Focus returns to the document; the Varak title bar looks active while typing in the document (`isForeground`). |
| B7 | Emoji panel (Win+.) and clipboard history (Win+V) while typing in Writer. | Inserted into the document. |
| B8 | Calc: type a formula `=TOPLA(A1:A3)` in a cell and in the formula bar; Enter, Tab, arrow keys. | Behaves like LibreOffice standalone. |

## C. Shortcuts and interception

| # | Steps | Pass criteria |
|---|---|---|
| C1 | In the document: Ctrl+S, Ctrl+Shift+S, Ctrl+O, Ctrl+N, Ctrl+P, Ctrl+W, Ctrl+Q. | Each reaches Varak (engine `intercept` event → Varak UI); no LibreOffice dialog opens. |
| C2 | Ctrl+B/I/U, Ctrl+Z/Y, Ctrl+C/V, Ctrl+A, Ctrl+F. | Handled by LibreOffice; ribbon state updates within 100 ms. |
| C3 | F6, Shift+F6, Ctrl+F1, Ctrl+Tab. | Engine `key` events arrive; Varak moves focus as designed. |

## D. KeyTips trigger (ShellKeys, when enabled)

| # | Steps | Pass criteria |
|---|---|---|
| D1 | Tap Alt with focus in the document, then in the ribbon. | `Alt` reported once per tap in both cases. |
| D2 | Alt+Tab, Alt+F4 (cancel the close), Alt+Shift (layout switch), Ctrl+Alt, AltGr+Q. | Nothing reported. |
| D3 | Writer: hold Alt and drag with the mouse (block selection), release Alt. | Nothing reported. |
| D4 | F10; Shift+F10; Ctrl+F10. | `F10` only for the plain F10. |
| D5 | Switch to another app (Notepad), type and tap Alt there; return. | Nothing reported while Notepad is in front; no typing lag in Notepad (hook installed only while Varak is in front). |
| D6 | Open a LibreOffice dialog (Format → Character) and tap Alt in it. | Nothing reported; the dialog's mnemonics work. |

## E. Popups and freeze-frame

| # | Steps | Pass criteria |
|---|---|---|
| E1 | Open a ribbon gallery/dropdown that overlaps the document area. | The frozen image matches the live view (pixel diff < 1 % of pixels, no offset); the popup renders above it; `freeze` → image shown in < 150 ms at 1920×1080 (measure with DevTools performance mark). |
| E2 | Close the popup (Esc, click outside, choose an item). | The live view returns within one frame, at the right place; keyboard focus goes where the action puts it. |
| E3 | Nested: open a dropdown, then a sub-menu/dialog from it; close both in either order. | View stays hidden until the last one closes; same image reused. |
| E4 | File → Backstage; resize the window while Backstage is open; close Backstage. | No native view over Backstage; view back at the new size. |
| E5 | D3/D4: repeat E1 at 150 % and on the mixed setup. | Frozen image has no black border and the correct size (checks the PrintWindow surface-size formula for System-aware windows). |
| E6 | While a popup is open, trigger a document change from the engine (autosave). | View stays hidden; no flash. |

## F. Multi-monitor and DPI (D2–D5)

| # | Steps | Pass criteria |
|---|---|---|
| F1 | Start Varak on each monitor; open a document. | Placement rule; LibreOffice text size matches the scale (bitmap-stretched = slightly blurry is accepted on non-system-DPI monitors, tdf#145710). |
| F2 | Drag the window slowly across the monitor boundary and back (D4, D5). | After the DPI switch (window centre crosses), placement rule within 200 ms; no crash; no runaway resize loop. |
| F3 | Change the scale of the current monitor in Settings while Varak runs. | View re-placed after `WM_DPICHANGED`; placement rule. |
| F4 | Log `Owned view ready` values on each monitor. | `windowDpi` = system DPI (LibreOffice is System-aware), `hostDpi` = monitor DPI. Record for ADR 0003. |
| F5 | LibreOffice dialogs (Format → Paragraph) on each monitor. | Readable, correctly sized, fully on screen. |
| F6 (child) | Repeat F1–F2 in child mode; note whether LibreOffice's process DPI awareness was force-reset (`windowDpi`). | Record the difference between the modes. |

## G. LibreOffice dialogs

| # | Steps | Pass criteria |
|---|---|---|
| G1 | Open Format → Character via the ribbon. | Dialog above Varak, modal, keyboard focus in the dialog; our ribbon does not act while it is open (engine `dialog` event). |
| G2 | Move Varak behind another app, then click Varak's taskbar button. | The dialog comes back in front with Varak. |
| G3 | Close the dialog (OK/Cancel/Esc). | Focus back in the document; no stray window. |
| G4 | Open a file-picker from inside a LibreOffice dialog (e.g. Insert → Image if not intercepted). | Picker works and is owned correctly. |

## H. Hung and crashed engine

| # | Steps | Pass criteria |
|---|---|---|
| H1 | Process Explorer → Suspend `soffice.bin` of the active document. Click the ribbon, other tabs, the PDF module. | Varak's own UI stays responsive (owned mode). Child mode: record how input behaves (attached queues). |
| H2 | Keep it suspended 10 s. | Watchdog reports not responding within 5 s; the recovery UI appears. |
| H3 | Resume, or let recovery kill it. | Document restored from the working copy/recovery snapshot; no orphan `soffice.bin`/`python.exe`. |
| H4 | Kill `soffice.bin` while editing. | View disappears cleanly (no frozen image left), recovery offered; other documents unaffected. |

## J. Shutdown and process lifetime

| # | Steps | Pass criteria |
|---|---|---|
| J1 | Close Varak with three documents open (answer the save prompts). | No LibreOffice window remains visible at any moment; all engine processes gone within 3 s. |
| J2 | Kill `electron.exe` (main process) in Process Explorer. | Every `soffice.exe`, `soffice.bin` and bridge `python.exe` is gone within 2 s (job, adopt mode). |
| J3 | With `VARAK_PROCESS_GUARD=self`: start Varak, open documents, open a link via `shell.openExternal` with the browser closed beforehand, then quit; repeat J2. | The UI (sandboxed renderer) and documents work inside the job; J2 passes; record that the browser is killed with Varak (known trade-off of self mode). |
| J4 | If the app uses `app.relaunch()` (e.g. after a language change): trigger it. | App restarts (adopt mode). |

## K. Accessibility

| # | Steps | Pass criteria |
|---|---|---|
| K1 | NVDA and Narrator: Tab from the ribbon into the document, read a paragraph, move by line. | The document is announced; reading works in both modes. |
| K2 | Windows high-contrast theme on. | Document area readable; no view mispositioned. |

## L. Automation (`scripts/gui/gui-spike.mjs`)

`node scripts/gui/gui-spike.mjs [--view-mode child|owned] [--out test-output/gui] [--idle-ms 60000]` runs the
packaged app (`release/win-unpacked`) with an isolated data folder, drives it with real mouse and keyboard input
(koffi `SendInput`) and the renderer's DevTools protocol, checks the saved DOCX independently, watches for hangs
after every step (stack dumps of Varak and soffice when it hangs) and captures Varak's window only. Safety rules:
it does not start unless keyboard and mouse have been idle for `--idle-ms`, it never clicks or types while another
window is in front of Varak, and it logs other windows without their titles. It types at 40 ms per key: keys
injected within milliseconds right after a document's first modification are lost inside LibreOffice.

### Results (2026-09-29, D1, this PC)

| Run | Mode | Result |
|---|---|---|
| 1 | owned | **Hang:** Varak's UI thread blocked in `NtUserPeekMessage` ~3 s after the Writer view appeared (also without input); soffice idle |
| 2 | child | Passed: placement, ribbon Bold, Ctrl+S with the DOCX checked on disk, backstage, Calc `=TOPLA(1,5;2,25)` → 3,75, new Impress slide, text/form PDFs, window move, light theme. Found: no Impress slide pane, "Slayt 0 / 3", Slides group overlap; typed text lost (burst injection) |
| 3 | child | Fixes confirmed on screen (slide pane, "Slayt 1 / 3" → "Slayt 2 / 4", ribbon layout, font-size drop-down with freeze-frame) |
| 4 | owned | Engine owns the frame before loading: Varak stays responsive, but **soffice** stops responding ~4 s after the first click into the document → owned is development-only |
| 5 | child | With the `doc.info` page-count fix: burst-typed text still lost → separate typing experiments: at 40 ms per key every character arrives, bursts right after the first modification lose keys inside LibreOffice |
| 6 | child | Typing at 40 ms per key: 53/53 characters, the saved DOCX contains the Turkish sentence (AutoCorrect turns " - " into an en dash) |
| 7 | child | `screenshots.mjs` tr/en: all README shots; PDF highlight + free text saved and read back; loss warning; KeyTips; quit prompts. Found: a LibreOffice dialog opened from the ribbon has no keyboard focus |
| 8 | child | `quitcheck.mjs`: unsaved PDF and DOCX → one "Save your changes?" per document, "Don't save" → files unchanged, app exits |
| 9 | child | `dialogcheck.mjs` after the `AllowSetForegroundWindow` fix: Paragraph and Font dialogs have the focus, a real Esc closes them, the ribbon is disabled while they are open and enabled afterwards |


## L2. Automation later

Parts of A, E and F can run unattended in a dedicated VM or a second Windows user session (never on the
owner's active desktop): Playwright for Electron drives the renderer; `SendInput` (koffi) produces
keyboard/mouse input for B–D; `PrintWindow` + `pixelmatch` compares the native view with the expected
rect for A/E; display scale changes via `SetDisplayConfig` or a pre-configured VM per scale. The pass
criteria above are the assertions.

## M. Decision record

Decided on D1 (2026-09-29, ADR 0003 amendment): **child** is the default — it passed runs 2, 3, 5 and 6, while owned
hung (Varak in run 1, soffice in run 4). Still to fill in: D2–D5 (DPI), freeze latency, H1 (hung engine by hand).
