# Test corpus

Documents the tests open, edit, convert and verify. Two kinds, with different licences and rules:

| Folder | Content | Licence | In git? |
|---|---|---|---|
| `generated/` | Deterministic fixtures written by `scripts/corpus/generate.mjs` (+ `derived/` files converted by LibreOffice) and `manifest.json` with the expected facts | CC0-1.0 (self-authored) | no — regenerated on demand |
| `third_party/<source>/` | Unmodified copies of files from other open-source projects, with the upstream `LICENSE`/`NOTICE` and an `ATTRIBUTION.md` | licence of the source (Apache-2.0; delins.docx also quotes Wikipedia text, CC BY-SA 3.0) | yes |

What each file exercises and which tests use it: [tests/README.md](../README.md#the-corpus). Findings from
round trips of these files: [docs/dev/testing-corpus.md](../../docs/dev/testing-corpus.md#findings).

## Generated corpus

```powershell
npm run corpus:generate                 # primary files + LibreOffice-derived formats when an engine is found
node scripts/corpus/generate.mjs --no-derived --out test-output/corpus/gen   # without LibreOffice, elsewhere
node scripts/corpus/generate.mjs --large    # adds 100k-row / 300-page / 200-slide files (large/, never commit)
```

Tests call `ensureGeneratedCorpus()` (`tests/tools/corpus.ts`), which regenerates the folder when it is missing,
incomplete or written by an older `GENERATOR_VERSION`. `manifest.json` is the contract between generator and
tests: for every file its id, path, format, features, SHA-256 and the **facts** (texts, formula results,
formats, slide contents …) computed by the generator from its source data. Tests compare what they read back
against these facts, never against output of the engine under test.

Primary files are byte-reproducible (fixed zip timestamps and document dates, seeded randomness), except
`pdf-encrypted.pdf` (random encryption salts). LibreOffice-derived files contain timestamps and are checked by
content only.

## Third-party corpus

Everything in `third_party/` is pinned in `scripts/corpus/third-party.mjs` (repository, commit, raw URL,
SHA-256, licence, producing application, what the file exercises, password if any). `manifest.json` and every
`ATTRIBUTION.md` are generated from that list.

```powershell
node scripts/corpus/third-party.mjs          # offline check: hashes, no unpinned files, docs in sync
node scripts/corpus/third-party.mjs --fetch  # download missing files from the pinned URLs (hash-checked)
node scripts/corpus/third-party.mjs --docs   # rewrite manifest.json and ATTRIBUTION.md
```

The offline check also runs in the unit tests (`tests/unit/tools/third-party.test.ts`), so a file cannot be
committed here without its URL, licence and hash. `third_party/.gitattributes` switches off line-ending
conversion so that the pinned bytes survive every checkout.

Current sources:

- [`apache-poi/`](third_party/apache-poi/ATTRIBUTION.md) — 14 Office-made documents from the Apache POI test data
  (macros, SmartArt, charts and chartEx, pivot tables, tracked changes, encrypted DOCX/XLSX, legacy DOC/XLS/PPT,
  speaker notes), Apache-2.0 (delins.docx also quotes Wikipedia, CC BY-SA 3.0).
- [`apache-pdfbox/`](third_party/apache-pdfbox/ATTRIBUTION.md) — an AcroForm made with Adobe Acrobat (26 widgets of
  all field types), Apache-2.0.

## Adding a file

1. **Prefer generating it**: extend `scripts/corpus/lib/*.mjs` (and the facts) instead of committing a binary.
2. Only files with a licence that allows redistribution (CC0, MIT, Apache-2.0, BSD, CC BY …) and a known origin;
   never personal, confidential or customer documents, not even "anonymised" ones; no files from bug reports
   without a clear licence. Share-alike files stay unmodified in their own source folder.
3. Add the source to `SOURCES` (with its licence files) and the file to `SAMPLES` in
   `scripts/corpus/third-party.mjs`, then run `--fetch` and `--docs`, and state in `expect` the facts a test can
   assert (page/slide/sheet counts, texts, part names).
4. Keep files small (the whole vendored corpus is about 0.8 MB); large or reference corpora are fetched on
   demand into a cache outside the repository.

The full policy is in [docs/TESTING.md](../../docs/TESTING.md#adding-corpus-files); the survey of usable sources
and their licences in [docs/research/corpus.md](../../docs/research/corpus.md).
