# Screenshots and demo recordings

The README shows **real** screenshots of the running application, never mock-ups or edited images. This page
explains how to capture them and how to name the files in [`docs/screenshots/`](screenshots/).

> Capturing screenshots opens the application's windows. Do it only on a machine and a desktop session where you
> are allowed to, with no confidential documents or notifications on screen.

## Before capturing

1. Build and start the app: `npm run build` then `npm start` (or `npm run dev`). Use a version from `main` and write
   down the commit (`git rev-parse --short HEAD`).
2. Use **sample documents from the test corpus** (`tests/corpus/generated/` or `tests/corpus/third_party/`) or
   documents you created yourself for the demo. Never show real personal or business documents.
3. Windows display scaling 100 %, window size **1600 × 1000** (logical pixels), light theme unless the shot is about
   the dark theme. Close other windows that could appear in the capture.
4. Set the UI language for the shot (Settings → Language). Capture the main screens in **both Turkish and English**.
5. Hide personal data: the Windows user name in paths, recent-file lists and the title bar.

## Automated capture

`node scripts/gui/screenshots.mjs --lang both` produces every required shot below from the packaged app
(`release/win-unpacked`): light theme, window 1600 × 1000, the corpus documents copied to
`%PUBLIC%\Documents\Varak Örnekleri` / `Varak Samples` (no user name in any path; the folder is removed
afterwards), an isolated data folder, and captures of Varak's window only, 1 px inside its frame. It also checks on
screen that the PDF annotations are saved, that KeyTips and a LibreOffice dialog work and that quitting with
unsaved changes asks first. It opens windows and sends real input, so it refuses to start unless the PC has been
idle for a minute. The images land in `test-output/screenshots/<lang>/shots/`: look at every one before copying it
into `docs/screenshots/`.

## Capturing screenshots by hand

- Use **Snipping Tool → Window mode** (Win+Shift+S, then click the Varak window) so only the Varak window is captured,
  or Alt+PrtScn.
- Save as **PNG**. Do not crop into the window chrome and do not retouch content. Resizing the whole image down is
  fine.
- Keep each file below about 500 KB (use a PNG optimiser such as `oxipng` if needed).

### Required shots for v0.1

| File name | Content |
|---|---|
| `writer-home-tr.png`, `writer-home-en.png` | A DOCX with Turkish text open in the documents module, Home tab |
| `calc-formulas-tr.png`, `calc-formulas-en.png` | An XLSX with formulas, formula bar visible |
| `impress-slides-tr.png`, `impress-slides-en.png` | A PPTX with the slide panel and a selected slide |
| `pdf-annotate-tr.png`, `pdf-annotate-en.png` | A PDF with highlight, free text and thumbnails |
| `backstage-open-tr.png`, `backstage-open-en.png` | File backstage with recent files (demo files only) |
| `loss-warning-tr.png`, `loss-warning-en.png` | The "content may be lost" warning with "save a copy" |
| `theme-dark-en.png` | Any module in the dark theme |

### Naming rules

`<module>-<topic>-<lang>.png`, lower case, words separated by hyphens:

- `module`: `writer`, `calc`, `impress`, `pdf`, `backstage`, `settings`, `theme`, `loss`, `recovery`, `start`;
- `topic`: a short noun (`home`, `formulas`, `annotate` …);
- `lang`: `tr` or `en`.

Add every screenshot to the table in [`docs/screenshots/README.md`](screenshots/README.md) with the date, the
commit and the Windows version it was taken on.

## Demo GIF or video

A short (30–60 s) recording showing: opening a DOCX → typing Turkish text and applying bold → saving; entering a
formula in an XLSX; adding a slide in a PPTX; highlighting text in a PDF.

- Record with the Snipping Tool's **video** mode (Windows 11) or [ScreenToGif](https://www.screentogif.com/)
  (open source). Record the Varak window only, at 1600 × 1000, 15 fps is enough.
- Export as **MP4** (H.264) for the release page and as an optimised **GIF** (≤ 8 MB, ≤ 960 px wide) for the README.
- Name the files `demo-v<version>-<lang>.mp4` / `demo-v<version>-<lang>.gif`, for example `demo-v0.1.0-tr.gif`.
- No audio, no personal data, no notifications.

## Updating the README

Replace the "Screenshots" placeholder in [README.md](../README.md) and [README.tr.md](../README.tr.md) with the images
(Turkish images in README.tr.md, English in README.md) and give each image a descriptive `alt` text.
