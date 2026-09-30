# ADR 0010: Windows file associations and file-type icons

- **Status:** Accepted (amends item 4 of [ADR 0008](0008-packaging.md))
- **Date:** 2026-09-30
- **Related:** `build/installer.nsh`, `src/shared/fileAssociations.ts`, `scripts/brand/filetype-icons.mjs`,
  `scripts/installer/check-associations.mjs`, `src/main/app/fileTypes.ts`, [ADR 0009](0009-product-name-simpaper.md),
  [PACKAGING.md](../PACKAGING.md#file-types-and-icons)

## Context

After installing Simpaper, documents should open in it with a double-click and show Simpaper's own icons: a
document icon for Word-type files, a spreadsheet icon for Excel-type files, a presentation icon for
PowerPoint-type files and a PDF icon.

What Windows 10 and 11 allow (Microsoft Learn: "Default apps platform", "File types", "Default programs";
measured read-only on the development PC, Windows 11 build 26200):

- The user's default app per type (`FileExts\.<ext>\UserChoice`, and `UserChoiceLatest` on current Windows 11) is
  protected by a hash and, since 2024, by the UCPD driver. **No installer can set it**, with or without
  administrator rights; only Windows' own UI writes it (the "How do you want to open this file?" prompt, Open with
  › Always, Settings › Apps › Default apps).
- Without a user choice, Windows uses the only registered handler of a type silently, its icon included. When two
  or more handlers compete (the extension's default ProgID plus further `OpenWithProgids` entries), the type
  becomes "choose an app": a generic icon, and Windows asks on the next open. ProgIDs marked
  `AllowSilentDefaultTakeOver` never compete; they are only offered.
- Without administrator rights an installer may write, per user: ProgIDs, `OpenWithProgids` entries, the
  extension's default value, a `Capabilities` key plus `Software\RegisteredApplications` (Simpaper's page in
  Settings › Apps › Default apps) and `SHChangeNotify`. Settings opens that page with
  `ms-settings:defaultapps?registeredAppUser=<name>` (Windows 11 21H2/22H2 with the 2023-04 update, 23H2 and later;
  older versions open the list of default apps).
- electron-builder's own `fileAssociations` works for per-user installs as well (the documentation's "perMachine
  only" is outdated), but it writes the program path unquoted, overwrites other apps' defaults, uses an English-only
  verb name, registers nothing for Default apps and refreshes Explorer before it writes the associations.

## Decision

1. **Own NSIS include** `build/installer.nsh` (electron-builder includes it automatically) instead of
   `fileAssociations`. It writes below `SHELL_CONTEXT` (HKCU for the default "only for me" install, HKLM when an
   administrator chooses "all users"):
   - one ProgID per format, `Simpaper.<format>` (27 ProgIDs; `.tsv` and `.tab` share `Simpaper.tsv`), with the type
     name of the file dialogs in the installer's language, the matching icon, `AppUserModelID` and the command
     `"<install folder>\Simpaper.exe" "%1"`;
   - an `OpenWithProgids` entry for each of the 28 extensions the app opens, so "Open with" lists Simpaper;
   - `Software\Simpaper\Capabilities` and `Software\RegisteredApplications\Simpaper`, so Simpaper has its own
     page under Default apps;
   - the extension's default value, only for the office and PDF types, and only where no installed app owns the
     type yet (the default named in HKCR, and the one in the key about to be written, is empty or names a ProgID
     that does not exist). Office's or LibreOffice's registration is never replaced;
   - `SHChangeNotify(SHCNE_ASSOCCHANGED)` at the end, so Explorer shows the icons at once.

   When an administrator switches an "only for me" installation to "all users", electron-builder removes the
   per-user copy first (as an update, so its uninstaller keeps the registration); the include then removes that
   user's per-user registration, which would otherwise win over the machine-wide one in HKCR and start the deleted
   program.
2. **Plain text stays where it is:** TXT, CSV, TSV and TAB are offered in "Open with" and on Simpaper's Default
   apps page, but their ProgIDs carry `AllowSilentDefaultTakeOver`, so Notepad, spreadsheet apps and code editors
   keep them.
3. **The user's choice is never read or written** by the installer or the app. Where another app is the default,
   the user switches: Windows offers Simpaper the next time such a file is opened, the installer's finish page
   has an (unchecked) box, "Make Simpaper the default in Windows Settings", that opens Simpaper's Default apps page
   (Modern UI draws it one line high, so the label stays short), and **Options › File types** shows which types
   open with Simpaper and opens the same page. The app reads the state with `AssocQueryStringW` and
   `RegGetValueW` only (`src/main/platform/win32/associations.ts`); the Settings link is built in the main process
   (`app:openDefaultApps` takes no argument).
4. **Uninstall** removes Simpaper's ProgIDs, its `OpenWithProgids` entries, the extension defaults that still name
   a Simpaper ProgID, the Default apps registration and the `Applications\Simpaper.exe` key Windows may have
   created, then notifies Explorer. Extension keys stay (other apps' values may live there). **Updates** (the old
   uninstaller runs with `--updated`) keep everything, so default-app choices stay valid.
5. **Icons:** four original icons, `resources/fileicons/{document,spreadsheet,presentation,pdf}.ico`, generated by
   `npm run icons` (`scripts/brand/filetype-icons.mjs`): a white sheet with the brand's leaf corners, a neutral
   outline, the logo's offset edge in the module colour and the module's glyph (lines, a grid of cells, a screen
   with a chart, a pen nib). Ten sizes from 16 to 256 px, drawn on their own pixel grids up to 48 px. No folded
   corner and no letters, so they resemble neither Microsoft Office's nor LibreOffice's icons. They ship through
   `extraResources` to `resources\fileicons`.
6. **One table, checked three ways:** `src/shared/fileAssociations.ts` derives the list from `FORMATS`;
   `tests/unit/main/fileAssociations.test.ts` checks the installer's table against it and against the dialog type
   names, and checks the icons; `scripts/installer/check-associations.mjs` compiles the include's install and
   uninstall macros with electron-builder's makensis (`-WX`), runs install, update, a switch to "all users" and
   uninstall against a scratch key and compares every value and the complete key tree (the release workflow runs it
   after building). The finish page and the HKLM root are compiled by the real build and need a real installation
   to be seen.
7. The ZIP archive registers nothing. Files from a multi-selection in Explorer (one process per file) open one
   after another through a single queue in the running instance.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| electron-builder `fileAssociations` | Unquoted program path, replaces other apps' defaults, no Default apps page, English-only verb (see Context) |
| Writing `UserChoice` (or "hash tools") | Blocked by Windows by design; working around a security boundary is not acceptable |
| One ProgID per module (four ProgIDs) | Explorer would show the same type name for DOCX and DOC; per-format ProgIDs keep the familiar names |
| Also taking the default for TXT/CSV | Would turn those types into "choose an app" for users of Notepad, Excel or code editors |
| Always opening Settings after setup | Microsoft's guidance is to ask in context; the finish page offers it, unchecked |
| Microsoft Store package (MSIX) | Not used for v0.1 ([ADR 0008](0008-packaging.md)) |

## Consequences

- On a PC without other office software, the office types open with Simpaper and show its icons right after
  installation. PDF usually stays with Microsoft Edge, which Windows sets as the default PDF app, until the user
  picks Simpaper. On a PC with Office, LibreOffice or another PDF reader, the types those apps own stay theirs until
  the user picks Simpaper. On the development PC the scratch-key check found that the installer can set the
  default of 23 of the 24 office and PDF types; the user's own choices still decide for `.xlsx` (a former
  "Open with › Always" choice) and `.pdf` (Edge).
- Templates (DOTX, XLTX, POTX …) open for editing, not as a new document based on the template, and slide shows
  (PPS, PPSX) open for editing; see [KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md#distribution).
- Type names are written in the installer's language and do not follow a later change of the app's language.
- Not verified yet on a real installation: that Explorer shows the icons and Windows' prompt offers Simpaper, and
  how Settings presents Simpaper's page. This needs an install on a test PC with someone at the screen.
