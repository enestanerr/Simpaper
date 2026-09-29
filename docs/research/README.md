# Research

Research carried out on **2026-09-28**, before the architecture was decided. Each note lists its facts with a
confidence level (high/medium/low) and a source, followed by risks and a recommendation. The decisions that
came out of it are recorded in [docs/adr](../adr/README.md) and summarised in
[ARCHITECTURE.md](../ARCHITECTURE.md).

> **Findings age quickly.** Version numbers, release dates, bug states, prices and license terms in these notes
> were correct on the research date and may be outdated when you read them. Check the linked source before you
> rely on a detail, and prefer the ADRs for what the project actually decided.

These are the published copies of the notes: details about the machine the research was done on (paths,
installed software, disk space, local checks) were removed; the sourced facts, tables and recommendations are
unchanged.

| Note | Topic | Main outcome |
|---|---|---|
| [engine.md](engine.md) | LibreOffice as an embeddable, redistributable engine on Windows: releases, licensing and trademark, UNO embedding APIs, LibreOfficeKit, bundled Python, configuration keys | Unmodified LibreOffice 26.8 embedded via UNO is the only no-compile route; gate it on a spike; pin via TDF's download archive |
| [formats.md](formats.md) | Per-format capabilities of the engine (27 formats): filters, OOXML dialects, macros, passwords, feature fidelity, CSV/TXT options | What opens, saves and gets lost; filter policy and loss scanner needed |
| [alternatives.md](alternatives.md) | Collabora CODA, ONLYOFFICE/Euro-Office, other OSS engines; product-name conflicts | Keep LibreOffice; ONLYOFFICE only as an AGPL plan B; name proposals Varak, Tezhip, Tomar |
| [webeditors.md](webeditors.md) | Pure JavaScript/TypeScript OOXML editors (SuperDoc, Eigenpal, Univer, PPTist, …) | None can replace LibreOffice; use JS only for verification tooling |
| [shell.md](shell.md) | Desktop shell (Electron, Tauri, WPF, Qt) and hosting `soffice.bin`'s window: redirection surface, z-order, DPI, input queues, airspace, packaging | Electron 44 with a spike on window hosting; five Windows hazards and their mitigations |
| [ux.md](ux.md) | Office-familiar ribbon tabs, groups, shortcuts and KeyTips mapped to verified `.uno:` commands; Turkish keyboard specifics | Declarative command registry; three-layer shortcut handling; dangerous defaults to override |
| [pdf.md](pdf.md) | PDF stack: pdf.js, pdf-lib forks, qpdf, PDFium/EmbedPDF, MuPDF, LibreOffice Draw import, OCR | pdf.js + @cantoo/pdf-lib (+ qpdf, PDFium later); reject AGPL MuPDF; Turkish appearance-stream defect |
| [corpus.md](corpus.md) | A legally redistributable test corpus and offline verification tooling | 87 license-clean files plus generated Turkish fixtures; layered verification; what cannot be verified without Microsoft Office |

Nothing in these notes was verified in Microsoft Office; see [TESTING.md](../TESTING.md).
