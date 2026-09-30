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
| `focuscheck.mjs` | After a click into the document, the ribbon's text boxes and the File view get the keyboard; a ribbon tab switch leaves it in the document |
| `rescuecheck.mjs` | A hung engine (soffice.bin suspended) is offered for restart in a separate message box; the box withdraws itself when the engine answers again |
| `stuckcheck.mjs` | Measurements: a background document's engine killed; input to the Simpaper window while an engine hangs |
| `hangprobe.mjs` | Measurement: does detaching the input queues let clicks reach Simpaper while an engine hangs? (it does not) |

`node scripts/gui/checks/<script>` writes `report.json` (and screenshots of Simpaper's window) to
`test-output/gui/<name>/`. Build the app first (`npm run dist:dir`). The scripts that suspend soffice.bin resume or
end it before they exit.
