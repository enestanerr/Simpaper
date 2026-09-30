# Office-like keyboard shortcuts of the engine

LibreOffice handles the keyboard while a document has the focus, so the shortcuts users know from
Microsoft Office must be LibreOffice's own accelerators. This file documents the overrides Simpaper applies
to the engine profile.

**Source of truth:** [`accelerators.json`](accelerators.json). The tables below are generated from it
(Office meaning and LibreOffice 26.8.0.3 default included); when they disagree, the JSON wins.

## How they are applied

1. Before every engine start, `ProfileStore.prepare()` (`src/main/engine/profiles.ts`) rewrites
   `<profile slot>/user/registrymodifications.xcu` from `registrymodifications.xcu.template`. Its
   `{{ACCELERATORS}}` placeholder becomes one configuration item per entry (`renderAccelerators()`), in the
   format configmgr writes itself:

   ```xml
   <item oor:path="/org.openoffice.Office.Accelerators/PrimaryKeys/Modules/org.openoffice.Office.Accelerators:Module['com.sun.star.text.TextDocument']">
     <node oor:name="F12" oor:op="replace"><prop oor:name="Command" oor:op="fuse"><value xml:lang="en-US">.uno:SaveAs</value></prop></node>
   </item>
   <item oor:path="/org.openoffice.Office.Accelerators/PrimaryKeys/Global"><node oor:name="M_SHIFT_MOD1" oor:op="remove"/></item>
   ```

2. `set` entries replace the key node (`oor:op="replace"`): LibreOffice's values for **all** UI languages
   of that key are dropped and ours applies. Without a `lang`, the value is written for `en-US`, which every
   UI language falls back to. With `"lang": "tr"` the value exists for the Turkish UI only; under the
   English UI such a key is then unbound (read back in `tests/engine/profile.test.ts`).
3. `remove` entries delete LibreOffice's binding in that scope (`Global` or a module). A module key that is
   also set in the module keeps the module's new command (Writer's Ctrl+Shift+M is Decrease indent although
   the global `.uno:EditDoc` binding is removed); other modules fall back to their own module binding, if
   any (Impress keeps `.uno:SetDefault` on Ctrl+Shift+M).
4. File commands that Simpaper handles itself (`.uno:Save`, `.uno:SaveAs`, `.uno:Open` …) are intercepted by
   the bridge's dispatch interceptor (`INTERCEPTED_COMMANDS` in `src/shared/engine-protocol.ts`) and
   reported as `intercept` events, so F12 opens Simpaper's Save As, not LibreOffice's. `.uno:Print` is not
   intercepted: office documents are printed by the engine (its print dialog).

Key names are LibreOffice's accelerator names (`framework/source/accelerators/keymapping.cxx`): the key,
then the modifiers `SHIFT`, `MOD1` (Ctrl), `MOD2` (Alt). Modules: `writer` =
`com.sun.star.text.TextDocument`, `calc` = `com.sun.star.sheet.SpreadsheetDocument`, `impress` =
`com.sun.star.presentation.PresentationDocument`, `global` = all modules.

## Verification

`tests/engine/profile.test.ts` starts a headless engine with the rendered profile and reads every binding
back through UNO (`engine.shortcuts`: module configuration first, then global):

- every `set` entry resolves to its command in its module;
- no `remove` entry still resolves to LibreOffice's default;
- every target command has a dispatch (`cmd.available`) in a new document of that module;
- the Turkish-keyboard entries are active under the Turkish UI and unbound under the English UI.

`src/main/engine/profiles.test.ts` checks the rendering (XML format, escaping, validation) and that this
file lists every key of the JSON.

## Adding or changing a shortcut

1. Look up LibreOffice's current binding (`engine.shortcuts`, or `share/registry/main.xcd`) and the command
   name; prefer commands that exist in LibreOffice 26.8 for the module.
2. Add the entry to `accelerators.json` with `office` (what the key does in Microsoft Office) and `default`
   (LibreOffice's binding, `null` if none).
3. Regenerate the tables below and run `npx vitest run --project engine tests/engine/profile.test.ts`.

## Overrides

### Writer

| Key | LibreOffice key name | Command | Office meaning | LibreOffice 26.8 default |
|---|---|---|---|---|
| F4 | `F4` | `.uno:Repeat` | Repeat last action | `.uno:GraphicDialog` |
| F5 | `F5` | `.uno:GotoPage` | Go To | `.uno:Navigator` |
| F12 | `F12` | `.uno:SaveAs` | Save As | `.uno:DefaultNumbering` |
| Shift+F12 | `F12_SHIFT` | `.uno:Save` | Save | `.uno:DefaultBullet` |
| Ctrl+F12 | `F12_MOD1` | `.uno:Open` | Open | `.uno:InsertTable` |
| Ctrl+Shift+F12 | `F12_SHIFT_MOD1` | `.uno:Print` | Print | `.uno:RemoveBullets` |
| Ctrl+Alt+1 | `1_MOD1_MOD2` | `.uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles` | Heading 1 | — |
| Ctrl+Alt+2 | `2_MOD1_MOD2` | `.uno:StyleApply?Style:string=Heading 2&FamilyName:string=ParagraphStyles` | Heading 2 | — |
| Ctrl+Alt+3 | `3_MOD1_MOD2` | `.uno:StyleApply?Style:string=Heading 3&FamilyName:string=ParagraphStyles` | Heading 3 | — |
| Ctrl+1 | `1_MOD1` | `.uno:SpacePara1` | Single line spacing | `.uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles` |
| Ctrl+2 | `2_MOD1` | `.uno:SpacePara2` | Double line spacing | `.uno:StyleApply?Style:string=Heading 2&FamilyName:string=ParagraphStyles` |
| Ctrl+5 | `5_MOD1` | `.uno:SpacePara15` | 1.5 line spacing | `.uno:StyleApply?Style:string=Heading 5&FamilyName:string=ParagraphStyles` |
| Ctrl+Shift+L | `L_SHIFT_MOD1` | `.uno:DefaultBullet` | Bullets | — |
| Ctrl+Shift+N | `N_SHIFT_MOD1` | `.uno:StyleApply?Style:string=Standard&FamilyName:string=ParagraphStyles` | Normal style | `.uno:NewDoc` (global) |
| Ctrl+D | `D_MOD1` | `.uno:FontDialog` | Font dialog | `.uno:UnderlineDouble` |
| Ctrl+Shift+D | `D_SHIFT_MOD1` | `.uno:UnderlineDouble` | Double underline | `.uno:ParaRightToLeft` |
| Ctrl+M | `M_MOD1` | `.uno:IncrementIndent` | Increase indent | `.uno:ResetAttributes` |
| Ctrl+Shift+M | `M_SHIFT_MOD1` | `.uno:DecrementIndent` | Decrease indent | `.uno:EditDoc` (global) |
| Ctrl+Shift+E | `E_SHIFT_MOD1` | `.uno:TrackChanges` | Track changes | `.uno:JumpToFootnoteOrAnchor` |
| Ctrl+Alt+M | `M_MOD1_MOD2` | `.uno:InsertAnnotation` | New comment | — |
| Ctrl+Shift+8 | `8_SHIFT_MOD1` | `.uno:ControlCodes` | Show formatting marks | — |
| Shift+F7 | `F7_SHIFT` | `.uno:ThesaurusDialog` | Thesaurus | `.uno:SpellOnline` (global) |
| Ctrl+F2 | `F2_MOD1` | `.uno:PrintPreview` | Print preview | `.uno:InsertField` |
| Ctrl+Alt+I | `I_MOD1_MOD2` | `.uno:PrintPreview` | Print preview | — |
| Ctrl+= | `EQUAL_MOD1` | `.uno:SubScript` | Subscript | — |
| Ctrl+Shift+= | `EQUAL_SHIFT_MOD1` | `.uno:SuperScript` | Superscript | — |
| Ctrl+Alt+V | `V_MOD1_MOD2` | `.uno:PasteSpecial` | Paste Special | — |
| Ctrl+F | `F_MOD1` | `.uno:SearchDialog` | Find | `vnd.sun.star.findbar:FocusToFindbar` (global) |
| Alt+Shift+D | `D_SHIFT_MOD2` | `.uno:InsertDateField` | Insert date | — |
| Alt+Shift+T | `T_SHIFT_MOD2` | `.uno:InsertTimeField` | Insert time | — |

### Calc

| Key | LibreOffice key name | Command | Office meaning | LibreOffice 26.8 default |
|---|---|---|---|---|
| F12 | `F12` | `.uno:SaveAs` | Save As | `.uno:Group` |
| Shift+F12 | `F12_SHIFT` | `.uno:Save` | Save | — |
| Ctrl+F12 | `F12_MOD1` | `.uno:Open` | Open | `.uno:Ungroup` |
| Ctrl+Shift+F12 | `F12_SHIFT_MOD1` | `.uno:Print` | Print | — |
| Ctrl+R | `R_MOD1` | `.uno:FillRight` | Fill right | `.uno:AlignRight` |
| Ctrl+T | `T_MOD1` | `.uno:InsertCalcTable` | Create table | — |
| Ctrl+L | `L_MOD1` | `.uno:InsertCalcTable` | Create table | `.uno:AlignLeft` |
| Ctrl+2 | `2_MOD1` | `.uno:Bold` | Bold | `.uno:SpacePara2` |
| Ctrl+3 | `3_MOD1` | `.uno:Italic` | Italic | — |
| Ctrl+4 | `4_MOD1` | `.uno:Underline` | Underline | — |
| Ctrl+5 | `5_MOD1` | `.uno:Strikeout` | Strikethrough | `.uno:SpacePara15` |
| Ctrl+9 | `9_MOD1` | `.uno:HideRow` | Hide rows | — |
| Ctrl+0 | `0_MOD1` | `.uno:HideColumn` | Hide columns | — |
| Ctrl+Shift+9 | `9_SHIFT_MOD1` | `.uno:ShowRow` | Unhide rows | — |
| Ctrl+Shift+0 | `0_SHIFT_MOD1` | `.uno:ShowColumn` | Unhide columns | — |
| Ctrl+Shift+2 | `2_SHIFT_MOD1` | `.uno:NumberFormatTime` | Time format | `.uno:NumberFormatScientific` |
| Ctrl+Shift+6 | `6_SHIFT_MOD1` | `.uno:NumberFormatScientific` | Scientific format | `.uno:NumberFormatStandard` |
| F11 | `F11` | `.uno:InsertObjectChart` | Insert chart | `.uno:DesignerDialog` |
| Shift+F3 | `F3_SHIFT` | `.uno:FunctionDialog` | Insert function | `.uno:ChangeCaseRotateCase` |
| Shift+F2 | `F2_SHIFT` | `.uno:InsertAnnotation` | Insert note | — |
| Alt+= | `EQUAL_MOD2` | `.uno:AutoSum` | AutoSum | — |
| Shift+F9 | `F9_SHIFT` | `.uno:Calculate` | Calculate | `.uno:ShowPrecedents` |
| Ctrl+Alt+F9 | `F9_MOD1_MOD2` | `.uno:CalculateHard` | Recalculate all | — |
| Ctrl+Alt+V | `V_MOD1_MOD2` | `.uno:PasteSpecial` | Paste Special | — |
| Alt+Shift+Right | `RIGHT_SHIFT_MOD2` | `.uno:Group` | Group | — |
| Alt+Shift+Left | `LEFT_SHIFT_MOD2` | `.uno:Ungroup` | Ungroup | — |
| Ctrl+F | `F_MOD1` | `.uno:SearchDialog` | Find | `vnd.sun.star.findbar:FocusToFindbar` (global) |
| Ctrl+Shift+, (tr UI only) | `COMMA_SHIFT_MOD1` | `.uno:InsertCurrentDate` | Current date (Ctrl+; on Turkish Q) | `.uno:InsertCurrentTime` (tr) |
| Ctrl+Shift+. (tr UI only) | `POINT_SHIFT_MOD1` | `.uno:InsertCurrentTime` | Current time (Ctrl+Shift+: on Turkish Q) | — |

### Impress

| Key | LibreOffice key name | Command | Office meaning | LibreOffice 26.8 default |
|---|---|---|---|---|
| F4 | `F4` | `.uno:Repeat` | Repeat last action | `.uno:TransformDialog` |
| F12 | `F12` | `.uno:SaveAs` | Save As | — |
| Shift+F12 | `F12_SHIFT` | `.uno:Save` | Save | `.uno:DefaultBullet` |
| Ctrl+F12 | `F12_MOD1` | `.uno:Open` | Open | — |
| Ctrl+Shift+F12 | `F12_SHIFT_MOD1` | `.uno:Print` | Print | — |
| Ctrl+G | `G_MOD1` | `.uno:FormatGroup` | Group | — |
| Ctrl+Shift+G | `G_SHIFT_MOD1` | `.uno:FormatUngroup` | Ungroup | `.uno:FormatGroup` |
| Ctrl+T | `T_MOD1` | `.uno:FontDialog` | Font dialog | — |
| Shift+F3 | `F3_SHIFT` | `.uno:ChangeCaseRotateCase` | Change case | `.uno:CopyObjects` |
| Ctrl+Alt+M | `M_MOD1_MOD2` | `.uno:InsertAnnotation` | New comment | — |
| Ctrl+= | `EQUAL_MOD1` | `.uno:SubScript` | Subscript | — |
| Ctrl+Shift+= | `EQUAL_SHIFT_MOD1` | `.uno:SuperScript` | Superscript | — |
| Ctrl+Alt+V | `V_MOD1_MOD2` | `.uno:PasteSpecial` | Paste Special | — |
| Shift+F7 | `F7_SHIFT` | `.uno:ThesaurusDialog` | Thesaurus | `.uno:SpellOnline` (global) |
| Ctrl+F | `F_MOD1` | `.uno:SearchDialog` | Find | `vnd.sun.star.findbar:FocusToFindbar` (global) |

### Removed bindings

| Scope | Key | LibreOffice key name | LibreOffice 26.8 default | Why |
|---|---|---|---|---|
| global | Ctrl+Shift+M | `M_SHIFT_MOD1` | `.uno:EditDoc` | Toggles read-only mode behind the shell's back (Writer maps the key to Decrease indent). |
| global | Ctrl+Alt+E | `E_MOD1_MOD2` | `.uno:ExtensionManager` | Opens the extension manager (installs code into the engine). |
| global | Shift+Esc | `ESCAPE_SHIFT` | `.uno:CommandPopup` | LibreOffice command search built on the hidden menu bar. |
| global | Alt+1 | `1_MOD2` | `.uno:SidebarDeck.PropertyDeck` | Shows LibreOffice's sidebar, which Simpaper hides. |
| writer | Ctrl+Shift+J | `J_SHIFT_MOD1` | `.uno:FullScreen` | Full-screen mode of the engine frame breaks the embedded layout. |
| calc | Ctrl+Shift+J | `J_SHIFT_MOD1` | `.uno:FullScreen` | Full-screen mode of the engine frame breaks the embedded layout. |
| writer | Ctrl+F5 | `F5_MOD1` | `.uno:Sidebar` | Toggles LibreOffice's sidebar, which Simpaper hides. |
| calc | Ctrl+F5 | `F5_MOD1` | `.uno:Sidebar` | Toggles LibreOffice's sidebar, which Simpaper hides. |
| impress | Ctrl+F5 | `F5_MOD1` | `.uno:Sidebar` | Toggles LibreOffice's sidebar, which Simpaper hides. |
| writer | F11 | `F11` | `.uno:DesignerDialog` | Opens the styles deck of LibreOffice's hidden sidebar. |
| impress | F11 | `F11` | `.uno:DesignerDialog` | Opens the styles deck of LibreOffice's hidden sidebar. |
