# On-screen checks

Small scripts that drive the packaged app (`release/win-unpacked/Simpaper.exe`) with real mouse and keyboard input to
check one behaviour each. They use the launcher in `../harness.mjs` and follow the rules of the GUI spike
([docs/testing/GUI_SPIKE.md](../../../docs/testing/GUI_SPIKE.md)): they open windows and send input, so run them
only with the machine owner's permission and while nobody uses the PC (each refuses to start unless keyboard and
mouse have been idle for 60 s); they work in an isolated data folder under `test-output/gui/<name>/`, on copies of
the generated corpus, capture only Simpaper's own windows, and never log other windows' titles.

| Script | Checks |
|---|---|
| `dialogcheck.mjs` | A LibreOffice dialog opened from the ribbon has the keyboard focus; the ribbon is disabled meanwhile |
| `quitcheck.mjs` | PDF highlight saved and read back; closing the window with unsaved changes asks once per document |
| `focuscheck.mjs` | After a click into the document, the ribbon's text boxes, the File view, a ribbon menu and a prompt get the keyboard and give it back to the document; a ribbon tab switch leaves it in the document |
| `menucheck.mjs` | On the start screen, a menu opened with a real click takes the keyboard: arrows move in it, Esc closes it and returns the focus to its button, Enter opens it, Tab closes it |
| `themecheck.mjs` | The accent colours resolve in every module and theme (also for dialogs and menus in `<body>`) with at least 4.5:1 contrast; menu check marks use the accent; Options' checkboxes sit beside their labels (screenshots light and dark) |
| `rescuecheck.mjs` | A hung engine (soffice.bin suspended) is offered for restart in a separate message box; the box withdraws itself when the engine answers again |
| `stuckcheck.mjs` | Measurements: a background document's engine killed; input to the Simpaper window while an engine hangs |
| `hangprobe.mjs` | Measurement: does detaching the input queues let clicks reach Simpaper while an engine hangs? (it does not) |

`node scripts/gui/checks/<script>` writes `report.json` (and screenshots of Simpaper's window) to
`test-output/gui/<name>/`. Build the app first (`npm run dist:dir`). The scripts that suspend soffice.bin resume or
end it before they exit.
