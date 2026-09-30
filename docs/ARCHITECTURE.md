# Architecture

This document records **why** Simpaper is built the way it is and **how** the pieces fit together.
Individual decisions are in [`docs/adr/`](adr/); the research behind them (with sources) is in
[`docs/research/`](research/).

## 1. Priorities

Technology choices follow this order (from the project brief):

1. Real editing and file compatibility (DOCX/XLSX/PPTX/PDF first).
2. Stability and data integrity.
3. Distributability and license compliance.
4. User experience and performance.
5. Ease of development.

The application must work offline with local files, without paid APIs, cloud accounts or subscriptions.

## 2. Options that were evaluated

| Option | What it means | Compatibility (1) | Stability (2) | Distribution & license (3) | UX (4) | Verdict |
|---|---|---|---|---|---|---|
| **A1. Fork LibreOffice itself** | Rebuild LibreOffice with a new UI | Excellent (same engine) | Good | MPL-2.0 OK, but a full C++ build (hours, 40+ GB, VS + Cygwin) for every change | Hard: VCL UI toolkit, huge codebase | Rejected: cost of ownership far too high for the gain |
| **A2. Fork ONLYOFFICE Desktop Editors / Euro-Office** | Re-brand an AGPL suite whose native model is OOXML | Very good (reputed best OSS OOXML fidelity) | Good | AGPL-3.0 + ONLYOFFICE attribution terms for the whole app; license dispute history (2025–2026); Windows build undocumented | Good, but not ours | Rejected for now; kept as the fidelity-driven plan B |
| **A3. Fork Collabora Office desktop (CODA)** | Web UI + LibreOfficeKit in-process | Very good | Good | MPL-2.0 source, but needs Collabora's own engine build; binaries are Store-only with proprietary conditions | Good | Rejected as a base; used as a reference design |
| **B. Integrate an unmodified engine into our own shell** | Bundle the official LibreOffice build, drive it through its public UNO API, host its editing window inside our Office-like UI; separate PDF stack | Excellent for DOCX/XLSX/PPTX (same engine as LibreOffice) | Good, with engineering around process isolation | MPL-2.0 engine redistributed unmodified; our code under MPL-2.0 | Our own ribbon/backstage/QAT; LibreOffice dialogs inside documents | **Chosen** |
| **C. Build our own editors (pure JS/TS)** | e.g. SuperDoc (DOCX), Univer (sheets), no mature PPTX editor | Poor–medium; XLSX/DOCX import/export of Univer is commercial; no real PPTX editor | Unknown | Mixed (AGPL/commercial parts) | Full control | Rejected: fails priority 1 |

Key facts behind the table (details and sources in `docs/research/`):

- LibreOffice 26.8 opens, edits, recalculates and saves DOCX/XLSX/PPTX and 20+ further formats, and
  since 26.8 preserves Excel's newer chart types (chartex) on round-trip.
- LibreOfficeKit (tile rendering) is **not** usable with stock builds for a full editor: TDF removed the
  JSDialog layer in 26.8, so all dialogs would have to be rebuilt.
- pdf.js cannot edit existing page content; pdf-lib upstream is unmaintained; MuPDF is AGPL.

## 3. System overview

```
┌─────────────────────────── Simpaper (Electron) ───────────────────────────┐
│ Renderer (React, sandboxed)                                               │
│  title bar · QAT · tabs · ribbon · backstage · status bar · dialogs       │
│  PDF module (pdf.js viewer + annotation editor)                           │
│        ▲ typed, allow-listed IPC (src/shared/ipc.ts)                      │
│ Main process (Node)                                                       │
│  DocumentService ─ SafeWriter ─ CompatAnalyzer ─ RecoveryService          │
│  EngineManager ── EngineInstance (one per office document) ───┐           │
│  PdfService (@cantoo/pdf-lib)   ViewHost (Win32 via koffi)    │           │
└───────────────────────────────────────────────────────────────┼───────────┘
                                   NDJSON JSON-RPC over stdio   │
                  ┌─────────────────────────────────────────────▼──┐
                  │ simpaper_bridge (LibreOffice's bundled Python) │
                  │  UNO: load/store, dispatch, status listeners,  │
                  │  dispatch interception, context events         │
                  └──────────────┬─────────────────────────────────┘
                                 │ URP over a random named pipe
                  ┌──────────────▼─────────────────────────────────┐
                  │ soffice.bin (unmodified LibreOffice 26.8)      │
                  │  own profile per instance; macros disabled     │
                  │  editing window hosted in Simpaper's window    │
                  └────────────────────────────────────────────────┘
```

### Process model

- **One engine instance per open office document** (soffice.bin + bridge). A crash or a long operation in
  one document cannot freeze or kill the others; closing a document ends its process. A warm spare
  instance keeps "open" fast.
- **One shared headless conversion instance** for PDF export verification, format conversion and
  save verification.
- Engine processes are placed in a Windows Job Object so they never outlive the app.

### Separation of concerns (source layout)

| Concern | Location |
|---|---|
| Shared contracts (formats, IPC, engine protocol, brand) | `src/shared/` |
| Engine lifecycle, RPC, profiles, conversion | `src/main/engine/`, `engine/bridge/`, `engine/profile/` |
| Document lifecycle (open/save/close), working copies | `src/main/documents/`, `src/main/files/` |
| Compatibility analysis (loss-risk detection) | `src/main/compat/` |
| Crash recovery and autosave | `src/main/recovery/` |
| PDF file operations | `src/main/pdf/` |
| Native window hosting, DPI, process guard, file-association queries (Windows) | `src/main/platform/` |
| Printing | engine (office documents), pdf.js / Chromium (PDF) |
| UI shell, ribbon framework, i18n, themes | `src/renderer/shell/`, `src/renderer/ribbon/`, `src/renderer/i18n/`, `src/renderer/theme/` |
| Module UIs | `src/renderer/modules/{writer,calc,impress,pdf}/` |

## 4. Document surface on Windows

LibreOffice's editing window is a native Win32 window in another process. Two hosting strategies are
implemented behind `ViewHost` (`src/main/platform/`):

- **child** (default): LibreOffice's `createSystemChild` WS_CHILD window inside a layered `STATIC` container
  of the Simpaper window. The container has its own redirection surface and Chromium runs with
  `--disable-features=RemoveRedirectionBitmap`, so the GDI-painted view is visible although Chromium ≥ 139
  creates top-level windows with `WS_EX_NOREDIRECTIONBITMAP`. Passed the first GUI spike.
- **owned** (development only): a borderless top-level LibreOffice window owned by the Simpaper window and kept
  exactly over the document area; own redirection surface and DPI mode. It hung Simpaper's UI thread in the first
  GUI spike; with the engine owning the frame before loading into it, Simpaper stayed responsive in the second run,
  but soffice stopped responding after the first click into the document ([ADR 0003](adr/0003-document-surface.md),
  amendment).

The mode is read once at start-up from `settings.json` (`engine.viewMode`; Options does not offer it), so a change
takes effect after a restart.

Because HTML can never paint over a native window ("airspace"), popups that overlap the document area
use a freeze-frame: the native view is captured (PrintWindow), shown as an image and hidden while the
popup is open.

Measured on a feasibility prototype (Sept 2026, LibreOffice 26.2/26.8, Electron 44): embedding works
(11 ms window creation, ~0.5–1.7 s document load), command state is streamed, Save/Print are intercepted,
Turkish text renders correctly. Open issues are tracked in `docs/STATUS.md`.

## 5. Data integrity

- The engine edits a **working copy**; the user's file is written only by the save pipeline:
  write to a temp file in the same folder → flush → verify (package check and optional re-open) →
  atomic replace (`ReplaceFileW`) → the previous version is never left half-written.
- Before saving into a format that can lose content (macros, SmartArt, chartex …), the user sees what is at
  risk and can **save a copy** instead of overwriting the original.
- Autosave writes ODF recovery snapshots of modified documents; after a crash the app offers to restore them.
- Macros are never executed (`DisableMacrosExecution`); VBA is preserved where the format allows.

## 6. Security and privacy

- Renderer: `contextIsolation`, `sandbox`, strict CSP, no Node integration, allow-listed IPC channels.
- Engine pipes use random per-instance names; no TCP listeners.
- No telemetry. Logs never contain document content.
- PDFs are parsed by pdf.js 6.3.289 in the sandboxed renderer; PDF scripting is not loaded (no scripting manager,
  QuickJS not bundled) and XFA is off (`enableXfa: false`); pdf.js 6.3 no longer has an `isEvalSupported` option
  ([dev/pdf.md](dev/pdf.md)).

## 7. Cross-platform outlook

The shell (Electron/React), the bridge (Python/UNO), the PDF module and the data-integrity services are
portable. Native window hosting is Windows-specific; Linux/X11 can reuse the child strategy, while macOS
and Wayland need a different document surface (e.g. a LibreOffice build with LibreOfficeKit). The
`ViewHost` interface is the seam for that work.

File types are Windows-specific as well: the installer (`build/installer.nsh`) registers them with Simpaper's icons
and gives Simpaper its own page under Settings › Apps › Default apps. The app only reads which types open with it
(Options › File types) and never writes the registry, because Windows leaves the choice of the default app to the
user ([ADR 0010](adr/0010-file-associations.md)).
