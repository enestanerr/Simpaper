# ADR 0001: Unmodified LibreOffice as the office document engine

- **Status:** Accepted
- **Date:** 2026-09-28
- **Related:** [ARCHITECTURE.md](../ARCHITECTURE.md), [ADR 0003](0003-document-surface.md),
  [ADR 0005](0005-data-integrity.md), [ADR 0008](0008-packaging.md),
  research: [engine](../research/engine.md), [formats](../research/formats.md),
  [alternatives](../research/alternatives.md), [web editors](../research/webeditors.md)

## Context

Varak must open, edit and save real DOCX, XLSX and PPTX files offline, without paid APIs or accounts.
The project priorities are, in order: (1) real editing and file compatibility, (2) stability and data
integrity, (3) distributability and license compliance, (4) user experience and performance, (5) ease of
development.

Findings from the research (September 2026):

- LibreOffice 26.8 opens, edits, recalculates and saves DOCX/XLSX/PPTX and more than 20 further formats.
  26.8 also preserves Excel's newer chart types (chartex) and threaded comments on round trips; 26.2
  does not, and 26.2 reaches end of life on 2026-11-30. 26.8 is supported until 2027-06-13.
- The official Windows MSI can be extracted with an administrative installation (`msiexec /a`) into a
  self-contained folder that registers nothing on the system. It bundles Python 3.13 with the UNO bridge.
- Embedding an unmodified LibreOffice frame into a foreign window through UNO
  (`createSystemChild` → `Frame.initialize` → `loadComponentFromURL`) is still supported on 26.8 and is the
  same pattern that LibreOffice's own OfficeBean and ActiveX control use.
- LibreOfficeKit (tile rendering) is not a viable base on stock builds: TDF removed the JSDialog layer in
  26.8, so every dialog would have to be rebuilt; Collabora's desktop app requires Collabora's own engine
  build.
- No pure JavaScript/TypeScript editor comes close to LibreOffice's breadth for all three formats; the
  strongest DOCX editors are young, AGPL-licensed or keep key features in proprietary packages.
- ONLYOFFICE/Euro-Office is reputed to have better OOXML fidelity, but it forces AGPL-3.0 plus attribution
  terms on the whole application and has no documented Windows build.
- Known upstream problems: rendering glitches and crashes when LibreOffice 26.x is driven by an external
  process on Windows (tdf#172048, tdf#172304), no per-monitor DPI awareness (tdf#145710).

## Decision

1. Use the **official, unmodified** LibreOffice build of The Document Foundation, pinned to
   **26.8.0.3 x64** in `scripts/engine/engine.lock.json` (archive URL, SHA-256, size, OpenPGP key
   fingerprint, source URL). The installer is verified by SHA-256 and by its OpenPGP signature before it is
   extracted (`scripts/engine/fetch-engine.ps1`).
2. Process model: **one `soffice.bin` plus one bridge process per open office document**, and one shared
   headless instance for conversions, PDF export and save verification. Every instance has its own user
   profile and a random named pipe; no TCP listener is ever opened. Processes are tied to the app with a
   Windows Job Object.
3. Control path: the bridge (`engine/bridge/varak_bridge`) runs on LibreOffice's bundled Python and talks
   UNO to its `soffice.bin` over the named pipe; the Electron main process talks to the bridge with
   newline-delimited JSON-RPC over stdio (`src/shared/engine-protocol.ts`). UNO calls that touch documents
   or views are marshalled to LibreOffice's main thread.
4. Engine profiles are pre-seeded (`engine/profile`): macro execution disabled, VBA kept, update checks and
   the MAR updater off, first-start and donation dialogs off, crash-report dialog off, "keep format"
   warning off (Varak shows its own loss-risk warning, see [ADR 0005](0005-data-integrity.md)).
5. Save and export always pass an explicit filter name; the filter used at load time is reused to keep the
   OOXML flavour (ECMA vs ISO) of the original file (`src/shared/formats.ts`).
6. Engine updates follow the 26.8 bug-fix releases: a new version is pinned by URL and hash, verified,
   and re-tested with the engine test suite before release.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Fork LibreOffice and rebuild it with a new UI | Hours-long C++ builds (40+ GB, Visual Studio, Cygwin) for every change; VCL UI toolkit; far too costly to own |
| ONLYOFFICE Desktop Editors / Euro-Office | AGPL-3.0 plus attribution terms for the whole app, license dispute (2026), Windows build undocumented; kept as the fidelity-driven plan B |
| Collabora Office desktop (CODA) | Source is MPL-2.0 but requires Collabora's own engine build; binaries are Microsoft Store only with proprietary conditions; used as a reference design |
| LibreOfficeKit tile rendering under our own UI | JSDialog removed in 26.8, so all dialogs would need rebuilding; unproven on stock Windows builds |
| Pure JS/TS editors (SuperDoc, Univer, PPTist, …) | Insufficient fidelity for priority 1; key XLSX features are commercial; several are AGPL |
| Calligra, AbiWord/Gnumeric, Apache OpenOffice | No usable Windows builds or no OOXML export |
| WPS Office, SoftMaker FreeOffice | Proprietary; not redistributable |

## Consequences

- Positive: the same engine as LibreOffice, with its broad format coverage, formula engine, print and PDF
  export, no C++ build in our tree, and a redistributable MPL-2.0 core.
- Positive: a crash or a long operation in one document cannot take down the others; closing a document
  ends its processes.
- Negative: memory use grows with the number of open documents (one engine instance each); a warm spare
  instance is kept to make opening fast.
- Negative: LibreOffice's own dialogs (with LibreOffice's Turkish terminology) appear for advanced
  features; upstream bugs in external driving must be mitigated in our code (see
  [KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md)).
- Negative: the engine is Windows x64 only in this architecture; macOS and Wayland need a different
  document surface (see [ADR 0003](0003-document-surface.md)).
- Obligation: redistribution requires keeping LibreOffice's license files and pointing to the exact
  source code, including GPL/LGPL components (see [ADR 0006](0006-license.md), [ADR 0008](0008-packaging.md)).
- Obligation: "LibreOffice" may not appear in our product name; attribution is text only
  ("Includes LibreOffice®, unmodified").
