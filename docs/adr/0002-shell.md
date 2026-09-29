# ADR 0002: Electron, React and TypeScript for the application shell

- **Status:** Accepted
- **Date:** 2026-09-28
- **Related:** [ARCHITECTURE.md](../ARCHITECTURE.md), [ADR 0003](0003-document-surface.md),
  research: [shell](../research/shell.md), [ux](../research/ux.md)

## Context

Varak needs its own Office-like interface: title bar, Quick Access Toolbar, ribbon with tabs and groups,
File backstage, document tabs, status bar, dialogs, Turkish and English UI, light and dark themes, keyboard
access (KeyTips) and good accessibility. The PDF module needs a web renderer anyway (pdf.js). The shell must
host LibreOffice's native editing window ([ADR 0003](0003-document-surface.md)).

Constraints and findings:

- The shell must build on a Windows development machine without a C++ compiler or the .NET SDK;
  Node.js 22 is available.
- Electron 44.4.5 (Chromium 152, Node 24) is the current stable release; the latest three majors are
  supported and a new major ships every eight weeks.
- Electron has no API for hosting a foreign window, but exposes the native window handle; Win32 calls are
  possible from Node through koffi 3 (MIT, prebuilt binaries, no compiler needed).
- Chromium ≥ 139 gives top-level windows `WS_EX_NOREDIRECTIONBITMAP`, which makes GDI-painted child
  windows invisible; HTML can never paint over a native window ("airspace").
- Electron's windows are Per-Monitor v1 DPI aware; LibreOffice is System DPI aware.

## Decision

- **Electron 44** (move to the next major after its stable release and a regression pass) with
  **React 19**, **TypeScript 6** in strict mode, **electron-vite 5 / Vite 7** for building and
  **Vitest** for tests. State management with zustand, translations with i18next/react-i18next,
  icons from Tabler Icons (MIT).
- Our own ribbon framework (`src/renderer/ribbon/`): every control is declared in data, bound to a command
  from an allow-list, labelled in Turkish and English, reachable by keyboard (APG tab and toolbar patterns
  plus KeyTips), and enabled only when the command really works.
- Security baseline: `contextIsolation`, `sandbox`, no Node integration in renderers, a strict Content
  Security Policy, typed and allow-listed IPC channels (`src/shared/ipc.ts`), navigation and new-window
  requests blocked, Electron fuses set at packaging time ([ADR 0008](0008-packaging.md)).
- Native Windows calls (window hosting, DPI, hang detection, Job Objects) go through koffi from the main
  process and never block the UI thread.
- Turkish text handling uses locale-aware APIs (`toLocaleUpperCase('tr-TR')`, `Intl.Collator('tr')`)
  and never relies on the regular-expression `i` flag for Turkish case folding.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Tauri 2 | Needs the MSVC C++ build tools and a Rust toolchain (not available); WebView2 is itself a cross-process child window, so hosting LibreOffice gains nothing |
| WPF + Fluent.Ribbon (MIT) | Mature ribbon and `HwndHost`, but needs the .NET SDK, is Windows-only and would need a second UI stack for the PDF module; kept as the fallback host if native embedding in Electron fails |
| Qt 6 / PySide6 + SARibbon | Workable, but LGPL obligations for Qt, large runtime, weaker web/PDF story; accessibility not verified |
| LibreOffice's own Tabbed NotebookBar | No shell of our own (backstage, PDF module, recovery UI); kept as the last-resort fallback |

## Consequences

- Positive: full control over an Office-familiar UI, one code base for the shell and the PDF module, a large
  ecosystem, and a UI that can move to macOS/Linux later together with a different document surface.
- Positive: good accessibility baseline (Chromium uses native UI Automation on Windows).
- Negative: a large runtime (about 360 MB unpacked for Electron alone) and regular Electron major upgrades.
- Negative: native windows cannot be overlapped by HTML; popups over the document area need the
  freeze-frame technique of [ADR 0003](0003-document-surface.md).
- Negative: DPI handling differs between Electron (PMv1) and LibreOffice (System aware); mixed-DPI
  behaviour must be verified on real hardware.
