# Shell UI, ribbon framework, i18n and module UIs (developer notes)

Code: `src/renderer/**` (except `src/renderer/modules/pdf/**`, owned by the PDF module — see [`pdf.md`](pdf.md)) and
the `.uno:` allow-list `src/shared/commands.ts`. Tests: `tests/unit/renderer/**`.
Status (2026-09-29): implemented and verified with unit tests (jsdom, fake IPC bridge), a throw-away production
bundle build and headless engine probes. The app was used on screen in the GUI runs of 2026-09-29 (child hosting,
100 %; [GUI_SPIKE.md](../testing/GUI_SPIKE.md), Results); see "Known gaps".

## 1. Structure

| Path | What it is |
|---|---|
| `main.tsx`, `App.tsx`, `index.html` | Entry: i18n, theme, event wiring, initial state, `<Shell/>`, idle preload of code-split module parts. CSP in `index.html`. |
| `shell/Shell.tsx` | Layout: title bar, document tabs, ribbon, module toolstrip, message bars, workspaces / start screen, status bar, backstage, prompts. |
| `shell/TitleBar.tsx`, `shell/qat.ts` | Title (document, modified marker, read-only badge), active/inactive look, Quick Access Toolbar (+ customize menu). |
| `shell/DocumentTabs.tsx`, `shell/WorkspaceHost.tsx` | One tab and one always-mounted workspace per open document (native views and pdf.js survive tab switches). |
| `shell/StartScreen.tsx`, `shell/backstage/*` | Home screen; File backstage: Info (compatibility report), New, Open (+recent), Save As (formats + known losses), Export PDF, Print, Recover, Options (with File types on Windows, §5), About. |
| `shell/prompts/*` | Main-process prompts: password, save risk (save a copy), unsaved changes, file changed on disk, CSV import with live preview. |
| `shell/StatusBar.tsx`, `shell/MessageBars.tsx` | Status bar frame (module items, view buttons, zoom slider); non-blocking message bars. |
| `shell/keyboard.ts` | Global shortcuts, KeyTip keys (bare left Alt, F10), F6 region cycling. |
| `ribbon/*` | Ribbon framework: `types.ts` (declarative model), `Ribbon.tsx`, `GroupView.tsx`, `ControlView.tsx`, `controls/*`, `runtime.ts` (state/enablement/execution), `layout.ts` + `measure.ts` (adaptive sizes), `keytips.ts` + `keytipStore.ts`, `model.ts`, `palette.ts`. |
| `modules/{writer,calc,impress}/*` | Office modules: `ribbon.ts`, status bars, Calc formula bar/workspace. Shared builders in `modules/common/controls.ts`, native view placeholder `modules/common/DocumentSurface.tsx`. |
| `modules/index.ts`, `modules/registry.ts`, `modules/pdfLazy.tsx` | Module registry; the PDF module with its workspace (pdf.js) loaded on demand. |
| `services/*` | IPC access (`ipc.ts`), documents lifecycle, engine (dispatch, subscriptions, queries), shell actions, settings, overlay (freeze-frame), window activity, fonts, zoom, UNO value parsing, bootstrap/event routing. |
| `state/*` | zustand stores: `appStore` (settings, documents, backstage, messages, prompts, busy), `commandStore` (per-document command state + context), `viewStore` (freeze snapshots, surface elements). |
| `i18n/*` | i18next setup, bundled resources, Turkish text helpers. |
| `theme/*`, `styles/*` | Design tokens (light/dark/forced colours), base CSS, component CSS. |
| `ui/*` | Primitives: `Popup` (anchored, overlay-aware), `Menu` (APG menu), `Dialog` (modal, focus trap), `ScreenTip`. |

## 2. Data flow

- The preload exposes `window.simpaperIpc` (`SimpaperIpcBridge`). `services/ipc.ts` is the only direct user; everything
  checks `hasBridge()` so components render in tests and previews.
- `services/bootstrap.ts`: `wireEvents()` subscribes to `documents:event`, `app:settingsChanged`, `app:windowState`;
  `loadInitialState()` loads settings, app info, open documents, window state. `handleDocumentEvent()` routes
  events into the stores (state → `commandStore`, context → contextual tabs, busy → `appStore.busy` + closes
  popups/KeyTips while an engine dialog is open, prompts → `PromptHost`, `shellKey`/`intercept` → shell actions).
- Command state: the ribbon subscribes the `.uno:` commands of the visible tab (plus QAT/status bar needs) with
  `ensureSubscribed` (batched per tick, de-duplicated, filtered by `isSubscribableUnoCommand`); the engine streams
  `state` events. Modules may publish their own entries into the command store (the PDF module's `pdf:*`).

## 3. How ribbons are defined

A module ribbon is data (`ModuleRibbon` in `ribbon/types.ts`): tabs → groups → controls. Controls are `button`,
`toggle`, `split`, `menu`, `combo`, `color`, `gallery` and `custom`; every control has an `id`, a `labelKey`
(also its accessible name), optional `tipKey`, `icon`, `keytip`, `shortcut`, and an action:

- `{ type: 'uno', command, args? }` — executed in the active office document (`engine:dispatch`); the command must
  be on the module's allow-list, which the main process enforces as well.
- `{ type: 'shell', id, payload? }` — a shell/module action (see §5).

`state` bindings (`{ command, pressed?, display? }`) drive pressed state/values; without a binding a control
follows the state of the `.uno:` command it executes. Contextual tabs set `contexts` (LibreOffice context names
from `context` events, e.g. `Table`, `Graphic`, `Draw`) and `contextualColor`. Groups use the `columns` layout
(large controls, small ones stacked in threes) or `rows` (Font/Paragraph style, `newRow` starts a row) and may have a
dialog `launcher`. Builders for common controls (clipboard, font, colours, alignment, shapes, arrange …) are in
`modules/common/controls.ts`; argument forms there were verified on the engine (§12).

Runtime (`ribbon/runtime.ts`): `useControlRuntime(action, binding)` gives `enabled`/`pressed`/`value`:
disabled without an active document, while LibreOffice shows a modal dialog, for `.uno:` actions when the document
is not `ready` or the engine reports the command disabled; `shell` actions are enabled by
`isShellActionEnabled` **and** — when bound to a module-published state entry such as `pdf:tool` — by that entry's
`enabled` flag.

## 4. Adding a command (checklist)

1. **Find the command in the registry**:
   `vendor/libreoffice/program/python.exe tests/unit/renderer/engine-probe/probe_commands.py --labels <Name> …`
   prints the `*Commands` component and label (no engine start). GenericCommands and DrawImpressCommands live in
   `share/registry/main.xcd`, WriterCommands in `writer.xcd`, CalcCommands in `calc.xcd`. A command belongs to a module
   when it is generic or in that module's component. Prefer the command LibreOffice's own menus use for the module.
2. **Allow it** in `src/shared/commands.ts` (`dispatch` list of the module, or `STATUS` for status-only items).
   Never add file/quit/macro/options/help commands (`INTERCEPTED_COMMANDS`): those flows belong to the shell.
3. **Check that it dispatches** in the module — registry presence is not enough (`.uno:InsertSlideField` is registered
   but has no dispatch in Impress): `vendor/libreoffice/program/python.exe tests/unit/renderer/engine-probe/probe_commands.py`
   reads the allow-list from `commands.ts`, checks `frame.queryDispatch` for every command in hidden new documents
   (headless, own profile under `test-output/shell-ui/`, process tree killed at the end) and prints the missing ones.
   Commands without a dispatch would be permanently disabled controls — do not ship them.
4. **Add the control** to the module's `ribbon.ts` with a KeyTip (unique and prefix-free in its tab, ASCII, no `I`,
   not the single letter `Z`), an icon from `@tabler/icons-react`, and `labelKey`/`tipKey`.
5. **Translate**: add the keys to `i18n/locales/tr/<ns>.json` **and** `en/<ns>.json` (same structure).
6. **Test**: `npx vitest run --project unit tests/unit/renderer` — `ribbons` (ids, KeyTips, allow-list, state
   bindings, translations), `commands` (registry, IPC validator), `i18n` (identical tr/en keys, all used keys).

A new shell action: add an id (to `SHELL_ACTIONS` if generic) and a built-in in `services/shellActions.ts`, or implement
it in the module's `ModuleDefinition.actions`.

## 5. Shell actions and modules

`runShellAction(id, payload, doc)` (`services/shellActions.ts`) is used by ribbon `shell` actions, the QAT, keyboard
shortcuts, the backstage and intercepted engine commands. It runs the **active module's**
`ModuleDefinition.actions[id]` first, then the shell built-in (save, save as, export PDF, print, backstage, new, open,
close, undo, redo, find, replace, toggle ribbon, zoom in/out). The PDF module overrides `file.save`, `file.saveAs`,
`file.print`, `edit.undo/redo/find/replace` and `view.zoomIn/Out` for PDFs; built-ins that make no sense for a
document kind report themselves unavailable (`exportPdf` for PDFs). Built-ins gated by an engine command (undo, redo)
follow its enabled state.

The PDF module publishes its view state (tool, sidebar, fields, scroll/spread mode, zoom, page) as `pdf:*` entries
(`modules/pdf/state/commandBridge.ts`); ordinary `state` bindings read them, and their `enabled` flag (document
ready) disables the bound controls while a PDF loads.

`modules/pdfLazy.tsx` defines the PDF `ModuleDefinition` for the registry: ribbon, actions, status bar and command
bridge are imported statically (they do not import pdf.js); the workspace (`PdfWorkspace` → `PdfController` →
pdf.js) is a `React.lazy` chunk with a loading state, an error boundary ("component could not be loaded" + close)
and an idle preload (`preloadModules()`, 2.5 s after start). `tests/unit/renderer/modules.test.tsx` keeps it in sync
with `modules/pdf/index.ts` (same members). pdf.js' viewer CSS is imported before the module CSS to keep the cascade.

**Edits held by the renderer** (`ModuleDefinition.flush(docId)`, implemented by the PDF module: pdf.js' annotation
storage → `pdf:update`). `closeDocument()` (tab ×, middle click, Delete on a tab, Ctrl+W, File › Close) awaits
`flushDocument(docId)` before `documents:close` (at most 10 s; forced closes skip it; a second close of the same
document while one is in flight returns the pending one). A `flushRequest` event (main is about to save/close/quit
a PDF) is answered by `answerFlushRequest()`: flush, then **always** `documents:flushDone { requestId }`, also when
the push failed or no module holds anything for that id.

**Results of open/create/restore** (`services/documents.ts`): the `opened`/`updated` events deliver every document
with its current state, so `openWithDialog()` only activates the last document of the answer, and `createDocument`,
`openPath`, `restoreRecovery` add their result only when no event delivered that id and it was not reported `closed`
(`noteDocumentClosed()` in bootstrap's `closed` handler; a late `updated` for a closed id is ignored as well).

**Options › File types** (Windows only; `FileTypesSection` in `shell/backstage/OptionsPage.tsx`, the last section of
File › Options, keys `shell.options.fileTypes*`) — shows which of the types the installer registered open with
Simpaper today. The main process reads that from Windows (`app:fileTypes`, main-core.md "File types (Windows)");
the app never changes a default itself ([ADR 0010](../adr/0010-file-associations.md)). It lists one row per module
(Documents, Spreadsheets, Presentations, PDF files), each with the module icon, the extensions and a chip: "Opens with
Simpaper", "Simpaper opens n of m types" or, muted, "Opens with another app" (the English "Some" text is worded so it
needs no plural form). Notes explain that only the user decides in Windows which app opens a type, and that setup
leaves the default apps of plain text, CSV and TSV alone (Simpaper is only offered for them). The
button "Choose default apps…" calls `app:openDefaultApps` (no argument; main opens Settings › Apps › Default apps on
Simpaper's page); when it answers false, an alert says that Windows Settings could not be opened. The state is read
when the page opens and again on every window `focus` event, so the rows change when the user comes back from
Settings. A copy that registered nothing (`registration: null`: a development run or the ZIP archive) shows only a
note, without rows or button; `thisCopy: false` adds a note that the registered types start another Simpaper
installation. Without Windows (`supported: false`, also when the Win32 bindings failed to load), without the IPC
bridge and until the first answer arrives, the section is not rendered.

## 6. KeyTips

- Scopes: `root` (File `F`, tabs, QAT `1…9`, `09…`), `tab:<id>` (controls of the selected tab), `popup:<groupId>`
  (controls of an opened collapsed group). Selecting a tab enters its scope; Esc clears the typed prefix, then steps
  back, then leaves; a click, window blur, Alt or F10 leaves.
- Shown by a bare **left** Alt (press and release without another key), F10, or `shellKey` events (Alt/F10 while a
  native document window has the focus — main's experimental keyboard hook, Options › "KeyTips while working in a
  document", `settings.ui.documentKeyTips`). AltGr (Ctrl+Alt, e.g. `@` on Turkish Q) never triggers KeyTips or
  Ctrl shortcuts.
- Matching normalises typed characters: ASCII letters/digits upper-cased; every I variant (i, ı, İ, I) becomes `I`,
  which is why no KeyTip uses the letter I. Unknown keys are swallowed while KeyTips are shown.
- Collapsed groups get `Z` + letter (`ZA`, `ZB` …), skipping tips already used; when a tab uses `Z` itself (the PDF
  ribbon's zoom box), `Y?`, `X?`, `Q?` are used.

## 7. Adaptive layout

Each group has four levels: 0 full, 1 large → small with labels, 2 icon-only, 3 collapsed into one button opening the
group in a popup. `groupWidth()` estimates widths (canvas text measurement with the UI font, approximation in
jsdom); `computeGroupLevels()` reduces groups from the right, one level at a time (Office order), **skipping steps that
would not make a group narrower** (Clipboard: Paste large + three labelled buttons is wider at level 1; tiny groups are
narrower than their collapsed button). After rendering, measured overflow is taken off the available width
(`nextCorrection`, monotonic and bounded by the width, reset when the ribbon grows), so estimates never overflow.

## 8. Popups over the native document view (freeze-frame)

HTML cannot paint over LibreOffice's window (airspace). `services/overlay.ts`:

- `acquireOverlay(rect, { persistent? })` — if the rect overlaps the surface of the office document whose native
  view is shown (active tab, no backstage, engine `ready`/`busy`), the view is frozen (`view:freeze` → PNG snapshot
  shown by `DocumentSurface`, native window hidden). Without a rect (a dialog scrim) the overlay is held even while
  no native view is shown. Holders nest; the view is unfrozen (`view:unfreeze`) 150 ms after the last release, so
  moving between menus/tooltips does not flicker. A capture still running delays the unfreeze.
- **The freeze follows the shown document**: a store subscription re-targets on every change of the active document,
  the backstage or the document state. A frozen view that is no longer shown is unfrozen at once (after its pending
  capture — the view host counts freezes — and one task later, so its hide reaches main first), and while holders
  remain the newly shown view is frozen (quit prompts for several documents, Ctrl+Tab with an open menu). A document
  whose engine stops responding keeps an existing freeze but is never asked for a new capture.
- `releaseAllOverlays()` (window blur, LibreOffice dialog — `bootstrap.ts`) drops only **transient** holders (menus,
  galleries, tips close themselves then); `Dialog` holds persistently, so an open prompt stays over a frozen document
  across Alt+Tab. Bootstrap also closes the peeking ribbon there (`setRibbonPeek(false)`), since its panel would
  otherwise stay open under the uncovered document window.
- `Popup`, `Dialog`, `ScreenTip` and the peeking ribbon panel acquire the overlay in a layout effect and are
  **painted only once the freeze-frame is in place** (`whenOverlayReady()`, at most 250 ms — a hung engine never
  blocks the UI); until then they are laid out and focusable but transparent.
- Nothing is frozen for PDF documents (pdf.js is HTML), while the backstage is open (it hides the native views) or
  when no document is open.

## 9. Title bar active look

In `owned` hosting mode, typing in a document activates LibreOffice's window and the BrowserWindow reports `blur`
(platform.md, "Active look"). `services/windowActivity.ts`: when `WindowState.active` is reported by the main process
(focused, or `viewHost.isForeground`), it decides. Otherwise the title bar stays active while the window is focused or
a document view most likely has the focus: the shell handed the keyboard to it (`view:focus`) up to 1.5 s before the
blur, or the active office document reported activity (state/context/selection/keys, an engine dialog) while
blurred. Inactive: muted title, QAT and logo (`vr-titlebar--inactive`; `GrayText` in forced colours). The caption
buttons are painted by Windows (`titleBarOverlay`) and follow the BrowserWindow's own activation.

## 10. Theming

`theme/tokens.css` defines all colours as custom properties for light and dark (`<html data-theme>`, set by
`theme.ts` from `settings.theme`, following the OS for `system`) and maps them to system colours in forced-colours
mode. Brand colours come from `src/shared/brand.ts`, title bar colours from `WINDOW_CHROME` (`src/shared/api/app.ts`),
which the main process also uses for the window background and the caption-button overlay, so they always match.
Contextual tabs use `--ctx-table|picture|drawing|chart`; each module has an accent (`data-module` on the app root,
mirrored on `<html>` by `Shell` for dialogs, menus and screen tips, which render into `<body>`). The derived
tokens (`--accent-text`, `--accent-soft`, `--accent-softer`) are declared on the same elements as `--accent`: a
custom property resolves `var()` where it is declared, so on `:root` alone they resolved to nothing (fixed
2026-09-30; `tests/unit/renderer/styles.test.ts`, GUI check `themecheck.mjs` for contrast ≥ 4.5:1). Without an
open document the dark theme uses gold as the accent.

## 11. i18n rules

- i18next with bundled JSON (`i18n/resources.ts`), no runtime loading. Namespaces: `common`, `shell`, `writer`,
  `calc`, `impress`, `formats` (this area), `pdf` (PDF module), `compat`, `errors` (main process). Keys are always
  written with the namespace (`shell.backstage.save`); `nsSeparator = keySeparator = '.'` so keys from the main
  process (`errors.*`, `compat.*`) resolve as they are. `translateExternal()` falls back to a generic message.
- Every key exists in `tr` and `en` with the same structure and the same `{{variables}}`; plurals use `_one`/`_other`
  (Turkish uses both forms). Keys built at runtime (colour hues/shades, severities, themes, view modes, CSV locales,
  busy reasons, format labels, file-type groups and states) are listed in `tests/unit/renderer/i18n.test.tsx`.
- Turkish: familiar ribbon terms (Giriş, Ekle, Tasarım, Düzen, Başvurular, Gözden Geçir, Görünüm, Sayfa Düzeni,
  Formüller, Veri, Geçişler, Animasyonlar, Slayt Gösterisi …) without Microsoft branding; format names follow the
  names Windows users know (as in the main process' dialog filters).
- Text handling: `i18n/turkish.ts` — `upper`/`lower` with `tr-TR`, `fold()` for case-insensitive matching (all I
  variants), `Intl.Collator('tr', { numeric: true })` for sorting; never the regex `i` flag. Numbers/dates via
  `Intl` (`shell/format.ts`, font sizes accept `10,5`).

## 12. Tests and verification

```powershell
npx vitest run --project unit tests/unit/renderer                 # 14 files (whole unit project on 2026-09-29: 63 files, 763 tests, docs/STATUS.md)
npx tsc -p tests/unit/renderer/tsconfig.renderer-tests.json      # type-check the tests (.tsx stay out of tsconfig.node.json)
npx tsc -p tsconfig.web.json --noEmit; npx eslint src/renderer src/shared
npx vite build --config test-output/shell-ui/vite.bundle.config.mts [--mode minified]   # temporary config (git-ignored), own outDir
vendor/libreoffice/program/python.exe tests/unit/renderer/engine-probe/probe_commands.py # headless engine probe (~25 s)
```

Test files: `ribbons` (all four module ribbons incl. PDF), `statusbars` (Impress status bar), `dispatch-args` (every
ribbon `.uno:` action passes the IPC checks), `commands` (allow-list rules, registry, IPC validator),
`i18n`, `keytips` (rules, state machine, global keyboard), `layout`, `turkish`, `overlay` (freeze-frame service and
components; the freeze following the shown document; dialogs across blur; the ribbon peek), `popup` (nested popups
in collapsed groups), `lifecycle` (closing notice, open/create/restore results, pushing PDF edits before a close and
on `flushRequest`, Calc input line after an engine restart), `integration` (action routing, `pdf:*` states in the ribbon, engine state, contextual tabs, KeyTips,
title bar), `shell` (start screen, recent/recovery, tabs, backstage, Options › File types, prompts, message bars,
shortcuts — jsdom with a fake `window.simpaperIpc`), `modules` (registry, lazy PDF workspace). JSX in test files
needs the `// @jsxRuntime automatic` pragma (the test files are outside `tsconfig.web.json`, so esbuild would use
the classic runtime).

Verified results (2026-09-29):

- Registry: writer 202/202, calc 225/225, impress 164/164 allowed commands (incl. status items) found; 0 rejected.
- Engine (LibreOffice 26.8.0.3 headless, hidden new documents, `frame.queryDispatch`): writer 202/202, calc 225/225,
  impress 164/164 have a dispatch. Before the fixes of this session: impress 159/163 (`.uno:ImportSlideFromFile`,
  `.uno:InsertTimeField`, `.uno:InsertSlideField`, `.uno:InsertSlidesField` — replaced by `.uno:ImportFromFile`,
  `.uno:InsertTimeFieldFix/Var`, `.uno:InsertPageField`, `.uno:InsertPagesField`) and writer 201/202
  (`.uno:AccessibilityCheck` — replaced by `.uno:SidebarDeck.A11yCheckDeck`, the accessibility check deck).
- Argument forms, read back from the document model: Writer — `.uno:Bold` (CharWeight 150),
  `CharFontName.FamilyName`, `FontHeight.Height` as float, `Color`/`CharBackColor` as long, `StyleApply` with
  `Style` + `FamilyName=ParagraphStyles`, `Zoom.Value`, `InsertTable` with short `Columns`/`Rows` (3×2 table); table
  commands dispatchable inside the table. Impress — `InsertPage`/`DuplicatePage`/`DeletePage` (1→2→3→2 slides),
  `AssignLayout` `WhatLayout` 3 and 20 (Layout 3, 20). Calc — `StyleApply` with `FamilyName=CellStyles`.
- Status values as `services/unoValues.ts` parses them (first session's probe, Calc, kept in the git-ignored
  `test-output/shell-ui/probe-results.json`): `.uno:Zoom` → PropertyValue sequence `Value`/`ValueSet`/`Type`;
  `.uno:CharFontName` → `FontDescriptor`; `.uno:FontHeight` → `FontHeight { Height, Prop, Diff }`; `.uno:Color` and
  `.uno:BackgroundColor` → long, `-1` = automatic; `.uno:StateTableCell` → PropertyValue sequence whose `Value` is the
  function text; `.uno:NumberFormatType` → number; `.uno:Undo` → "Undo: <action>" text (engine UI language).
- Bundle (electron-vite renderer defaults: `chrome142`, no minification): main chunk 2,630 kB → **1,336 kB** after
  code-splitting the PDF workspace (1,297 kB chunk; pdf.js alone was 1,180 kB of the main chunk); pdf.worker
  1,768 kB; CSS 276 kB; 190 files, 8.0 MB. Minified for comparison: 675 kB main, 690 kB PDF workspace. Icons are
  tree-shaken named imports (232 distinct `@tabler/icons-react` icons = 129 kB of the unminified main chunk); the
  rest of the main chunk is mostly react-dom (654 kB), translations (108 kB) and i18next (83 kB).

## 13. Known gaps

- **Not seen on screen**: DPI > 100 %, the full keyboard focus order, the title bar look with a real owned document
  window (ribbon layout, KeyTips and the freeze-frame under a drop-down were seen in GUI runs 3 and 7), Options › File
  types in an installed copy and the Settings page its button opens (needs a real installation, ADR 0010).
- Calc cell-attribute dispatches (`Bold`, `BackgroundColor`, `NumberFormatPercent`, `Color`) had no effect on
  **hidden headless** Calc documents in this session's probe (an earlier probe with another sequence saw them apply);
  to be verified with a real view by the engine tests.
- In a fresh headless instance, `loadComponentFromURL('private:factory/swriter', Hidden)` as the **first** document
  did not return within 90 s; after a Calc/Impress document it loads in ~0.5 s (matches the Writer hang noted in
  main-core.md; engine layer).
- Title bar fallback (no `WindowState.active`): switching from a document window straight to another application is
  not observable; the title bar stays active until Simpaper regains and loses the focus.
- Status texts from the engine (`.uno:StateTableCell`, `.uno:PageStatus`, `.uno:LanguageStatus`) arrive in the engine's
  UI language (the first session's probe saw Turkish "Ortalama: …; Toplam: …" with an en-US profile locale).
- Sidebar decks (styles, transitions, animations, accessibility check, navigator) are LibreOffice's own UI inside the
  document window; the engine hides the sidebar by default and these commands show it.
- Engine dialogs (Paste Special, Format Cells …) are LibreOffice's; they are modal to the document window.

## Progress

Session 2 (2026-09-29): all items of the completion pass are done — translations (impress, formats, fixes), 10 test
files, allow-list registry + engine checks with fixes, shell ↔ module integration (routing, `pdf:*` states, title bar,
freeze-before-paint), `Ribbon.tsx` lint, bundling check + PDF workspace code-splitting, this document.

Changes found necessary by the new checks: KeyTip conflicts (Writer Picture Format `G`, Calc Page Layout `B`/`BF`/`BS`,
Calc Insert `Z`); collapsed-group KeyTips when a tab uses `Z`; adaptive layout choosing wider forms of a group; option
hints that were part of accessible names (now `aria-describedby`); five allow-listed commands without a dispatch
(replaced); `.uno:Crop`, `.uno:CompressGraphic`, `.uno:ChangePicture`, `.uno:SaveGraphic` added for Calc's Picture
Format tab (dispatch verified). Done by main-core since: `.uno:` names may contain `-` (`src/main/ipc/validate.ts`,
`UNO_NAME`), and `commands.test.ts` checks every allowed command, including the hyphenated shape names.

Review fixes (2026-09-29, review notes kept outside the repository, renderer findings) — done, each with a
regression test that was checked to fail against the previous code:

- **#3** freeze-frame follows the shown document (`services/overlay.ts`: `retarget()` from a store subscription and
  from `acquireOverlay`; `overlapsNativeView` measures the shown surface). Tests: `overlay.test.tsx` › "the freeze
  follows the shown document" and › "in the shell" (quit with two modified documents + "Don't save"; Ctrl+Tab with an
  open ribbon menu).
- **#6** `OfficeWorkspace`: crash screen only for `crashed`; `closed` shows a neutral `role=status` notice
  (`shell.workspace.closing`, tr/en). Test: `lifecycle.test.tsx` › "closing an office document".
- **#7** `openWithDialog` no longer upserts the (stale) answer; create/open/restore add unknown, not-closed ids only.
  Tests: `lifecycle.test.tsx` › "results of open, create and restore requests" (incl. the reviewer's two repros).
- **#8** `ui/Popup.tsx`: presses inside a popup whose anchor chain leads back into this one are not outside presses
  (`isInsidePopup`); choosing a menu item inside a collapsed group also closes the group popup. Test:
  `popup.test.tsx`.
- **#10** (renderer part of the PDF flush protocol) `closeDocument` awaits `ModuleDefinition.flush`; `flushRequest`
  → flush → `documents:flushDone` (always); `PdfController` sends `pdf:markModified` on the first edit while main has
  the document clean, and again when a save leaves unsynced edits. Tests: `lifecycle.test.tsx` › "pending PDF edits",
  `tests/unit/pdf/controller-sync.test.tsx`. The main-process handlers (`documents:flushDone`, `pdf:markModified`,
  `requestFlush`) belong to main-core.
- **#14** persistent overlay holders for `Dialog`; the ribbon peek closes on blur / LibreOffice dialogs. Tests:
  `overlay.test.tsx` › "in the shell" (dialog + blur/LibreOffice dialog, peek + busy:dialog/blur).
- **#16** `CalcWorkspace` resets its "input line handled" flag on `crashed`/`loading`; bootstrap drops a crashed
  document's command states. Test: `lifecycle.test.tsx` › "Calc input line".

Later in session 2 (found by the usage review and the GUI runs), each with a test that fails without the fix:

- While LibreOffice shows a modal dialog for the active document (`useDocBlocked`), the Quick Access Toolbar and
  the File tab are disabled like the ribbon (`TitleBar.tsx`, `Ribbon.tsx` `FileTab`, also its KeyTip). Test:
  `shell.test.tsx` › "blocks the Quick Access Toolbar and the File tab".
- `closeStuck` prompt (`PromptHost.tsx` `CloseStuckDialog`, `shell.prompts.stuck.*`): danger button "Close anyway",
  Cancel focused; the text names the autosave time (`toLocaleTimeString`) or says there is none. Test:
  `shell.test.tsx` › "says what is lost before closing a document whose engine hangs".
- CSV "Other" separator: the input drops quotes and line breaks; the main process accepts any single printable
  character (`isCsvSeparatorChar` in `@shared/formats`).
- Keyboard between the shell and LibreOffice (`services/keyboardFocus.ts`, GUI check `focuscheck.mjs`): Windows keeps
  the keyboard focus in LibreOffice's window when the web content is clicked. `installKeyboardClaims` (Shell) asks for
  it (`view:focusShell`) when a press moves the focus into a text box, or outside `.rb-ribbon`, `.vr-titlebar`,
  `.vr-doctabs`, `.vr-status`, `.vr-popup`; `holdKeyboard()` in `Dialog` and in every `Popup` that takes the
  focus (menus, galleries, collapsed groups; they give it back to the document if they took it) and
  `holdKeyboard('always')` in the backstage; `activateDocument` claims it for a PDF. Programmatic focus alone never
  claims it. The main process sends LibreOffice's focus request once the view is shown again (`ViewHost.whenShown`):
  sent while a freeze-frame still hid it, it was lost. Tests: `shell.test.tsx` › "keyboard between Simpaper and the
  document", `popup.test.tsx`, `platformIntegration.test.ts`, `view-host-core.test.ts`.
- Popups are transparent (`opacity: 0`), never `visibility: hidden`, until positioned: their focus moves in before
  the positioned render, and Chromium does not focus a hidden element (menus opened with the mouse kept no focus
  until 2026-09-30). The focus returns to the control that opened a popup (a split button anchors at its wrapper)
  from a ref cleanup, which runs before React removes the nodes; Tab in a menu closes it first.
- One "not responding" bar per document (`hang:<docId>`), dismissed when the document leaves `busy`. Test:
  `shell.test.tsx` › "keeps one "not responding" bar per document".
