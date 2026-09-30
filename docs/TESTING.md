# Testing

This document explains how Simpaper is tested, what the automated tests can and cannot prove, and the rules every
contributor follows when reporting results. The compatibility claims that depend on these tests are in
[COMPATIBILITY.md](COMPATIBILITY.md).

## Ground rules

1. **Never report an untested result as passing.** A pull request or a status update says exactly what was run and
   what the output was. "Should work" is not a test result.
2. **Nothing is verified in Microsoft Office.** The project does not use Microsoft Office in its tests. Every
   compatibility statement is worded as "tested with LibreOffice 26.8.0.3 and independent open-source tools; not
   tested in Microsoft Office".
3. **Tests never open windows unless a person has agreed to it.** Unit and engine tests are headless. Tests that open
   windows or send keyboard/mouse input (GUI tests, `npm run dev`, screenshots) run only with the permission of
   the person who owns the machine, on a desktop session nobody else is using.
4. **Test files must be license-clean** (see [Adding corpus files](#adding-corpus-files)). Never commit personal,
   confidential or copyrighted documents.
5. Every process a test starts is stopped with its whole process tree (LibreOffice's `soffice.exe` starts
   `soffice.bin`; its `python.exe` starts a second Python).

## Test layers and commands

| Layer | Command | What it checks | Needs |
|---|---|---|---|
| Lint | `npm run lint` | ESLint rules for TypeScript, React hooks and scripts | — |
| Types | `npm run typecheck` | Strict TypeScript for the main/preload (`tsconfig.node.json`) and renderer (`tsconfig.web.json`) projects | — |
| Unit | `npm test` (Vitest project `unit`) | `src/**/*.test.ts(x)` and `tests/unit/**`: services, IPC validation, safe save with fault injection, compatibility analyzer, recovery, settings, ribbon definitions (every control has a real action, i18n keys exist in Turkish and English, KeyTips are unique), PDF logic, platform helpers | — |
| Engine | `npm run test:engine` (Vitest project `engine`) | `tests/engine/**`: real LibreOffice instances, headless, one at a time: lifecycle, open → edit → save → close → reopen round trips, results checked by the engine **and** by independent parsers | `vendor/libreoffice` (`npm run engine:fetch`) or `SIMPAPER_ENGINE_DIR` pointing to a LibreOffice `program` folder |
| Bridge (Python) | `vendor/libreoffice/program/python.exe -m unittest discover -s engine/bridge/tests -t engine/bridge` | `engine/bridge/tests`: framing, protocol, values, listeners, documents, owned windows, connection loss with a real URP peer (CI: job `engine-tests`) | `vendor/libreoffice` |
| Smoke boot | `node scripts/smoke-boot.mjs [--kind calc\|writer\|impress]` | The real app starts with a hidden window and creates, queries and closes a document through the preload bridge | `vendor/libreoffice` |
| Packaged engine smoke test | `npm run engine:prepare -- --verify` or `node scripts/engine/verify-engine.mjs` | The prepared engine folder converts a Turkish test document to PDF and DOCX headlessly; the text is read back and the bundled fonts are embedded | `vendor/libreoffice` |
| GUI | plan and results in [docs/testing/GUI_SPIKE.md](testing/GUI_SPIKE.md); automated runs on the packaged app (`npm run dist:dir`): `node scripts/gui/gui-spike.mjs`, `node scripts/gui/screenshots.mjs`, `scripts/gui/checks/*.mjs` | Native document views on a real desktop: placement, focus and Turkish typing, shortcuts, popups, DPI | **Owner's permission**, a free desktop session |
| All | `npm run test:all` | Unit and engine projects together | as above |

Test output (profiles, converted files, diffs) goes to `test-output/`, which is git-ignored. CI uploads it as an
artifact when the engine-test job fails.

### Independent verification tools

Results are never checked only by the engine that produced them. `tests/tools/` contains readers that do not use
LibreOffice:

- OPC/ZIP package integrity (unique part names, relationships, content types, well-formed XML),
- OOXML and ODF readers for text, tables, sheets, formulas and slides,
- VBA project extraction from compound files (to prove macros were preserved byte for byte),
- PDF text extraction with pdf.js,
- visual comparison of rendered pages with pixelmatch.

Planned additions: schema validation with the Open XML SDK validator, and a part-inventory diff that lists every
part dropped by a round trip.

## What is verified automatically

When the test suites of milestone v0.1 are complete, CI verifies on every push:

- lint, type checks, unit tests and a production build (`.github/workflows/ci.yml`, job `build`);
- headless engine tests, the unit tests that need the engine image and the Python bridge tests, with a cached,
  verified engine (job `engine-tests`);
- that the safe-save pipeline leaves the original file intact under injected failures;
- round trips of DOCX, XLSX and PPTX from the test corpus: the change made by the test is present after reopening,
  the original content (headers/footers, tables, images, formulas and cached results, slide count, texts and
  images) is still there, checked by the engine and by the independent readers above;
- PDF operations (annotations, form filling, page operations) re-opened with pdf.js.

The exact list of passing tests is whatever the latest CI run reports; [COMPATIBILITY.md](COMPATIBILITY.md) names a
test only after it has passed. CI runs on GitHub Actions since the first push; a result quoted without a CI run is a
local run of the same commands, stated with its date.

## What is not verified

- **Microsoft Office:** how Word, Excel and PowerPoint open, lay out or recalculate files saved by Simpaper; whether
  Office shows a repair prompt; VBA behaviour; acceptance of passwords and signatures; SmartArt and chart
  appearance. Schema validation and LibreOffice rendering are proxies, not proof.
- **Display scaling:** 125/150/200 % and mixed-DPI setups (the development machine runs both monitors at 100 %).
- **Anything that needs a desktop session** (the GUI plan) unless the owner has run it and recorded the results.
- **Other platforms:** macOS and Linux are not supported.
- **Assistive technology:** NVDA and Narrator checks are planned for milestone M4.
- **Printing** on physical printers.
- **Layout with fonts that are not installed**, such as Aptos (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).

If a maintainer spot-checks a file in Microsoft Office by hand, the note names the Office version, build and date,
and the result is kept out of automated claims.

## Adding corpus files

The test corpus lives in `tests/corpus/`:

- `tests/corpus/generated/`: files generated deterministically by `npm run corpus:generate`
  (`scripts/corpus/generate.mjs`), including Turkish text, formula oracles and, with `--large`, big files. They
  are self-authored (CC0) and can always be regenerated; large files are never committed.
- `tests/corpus/third_party/<source>/`: unmodified copies of permissively licensed files, each source folder with
  its `LICENSE`, `NOTICE` and `ATTRIBUTION.md`, all pinned by URL, commit and SHA-256 in
  `scripts/corpus/third-party.mjs` (verify with `node scripts/corpus/third-party.mjs`, download with `--fetch`,
  rewrite the manifest with `--docs`).

Before adding a file:

1. **Prefer generating it.** If a library or the engine can author the feature, add it to the generator instead of
   committing a binary.
2. **Check the license and provenance.** Only files whose license allows redistribution (for example CC0,
   Apache-2.0, MIT, CC BY) and whose origin is known. No files crawled from the web, taken from bug reports without
   a clear license, or containing personal data. Share-alike files stay unmodified in their own source folder.
3. **Pin it:** source repository, commit, URL, SHA-256, license, what it tests, password (if any).
4. **Describe the expected facts** (page/slide/sheet counts, texts, formula results) so tests can assert them.
5. **Keep it small.** Large or reference corpora are fetched on demand into a cache outside the repository.

Never add documents from your own work, customers or other people, even "anonymised". If a bug needs such a file,
reproduce it with a generated or license-clean file.
