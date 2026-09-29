# Office-familiar UX (ribbon tabs/groups, keyboard shortcuts, KeyTips) mapped to LibreOffice UNO commands, verified against a LibreOffice 25.8.7.3 installation and the 26.8.0.3 sources

> Research notes of 2026-09-28 on an Office-familiar ribbon and keyboard mapped to LibreOffice commands, prepared before the architecture decision and published
> with details about the research machine removed. Findings age quickly: check the linked sources before relying
> on a version number, a price, a bug status or a release date. Decisions are recorded in [docs/adr](../adr/README.md).

## Summary
**Sources.** A LibreOffice 25.8.7.3 installation (en-US + tr langpack) was inspected read-only: main.xcd, res\registry_tr.xcd and the soffice.cfg notebookbar/menubar/toolbar files. The LibreOffice sources at tag **libreoffice-26.8.0.3** (Accelerators.xcu, UI *Commands.xcu, .sdi slot files, sfx2/svtools code) were also checked.

The 25.8.7.3 accelerators match the libreoffice-25-8 branch exactly (0 differences for Global/Writer/Calc/Impress), which validates the extraction method. The 26.8.0.3 tag differs from 25.8 in six bindings:
- Writer Ctrl+Shift+R now inserts a cross-reference.
- Alt+P (EditStyle) moved from Global to Writer.
- Impress gets Shift+F12 = bullets.
- The Writer F9 command changed.
- Writer Alt+PgUp/PgDn changed.
- Ctrl+Alt+E now uses the ExtensionManager command.

Office tab and group structure comes from Microsoft's Fluent UI command-ID lists (Microsoft 365 Current Channel) and Microsoft's shortcut pages.

**Ribbon to UNO.** Almost every daily-use command on these tabs maps to one verified `.uno:` command (see tables):
- **Word:** Home, Insert, Layout, References, Review, View.
- **Excel:** Home, Insert, Page Layout, Formulas, Data, Review, View.
- **PowerPoint:** Home, Insert, Slide Show, Review, View.

LibreOffice's own Tabbed notebookbar confirms which commands LO uses per group:
- `.uno:Color` for font colour in all three apps (Writer's `.uno:FontColor` exists but no shipped UI uses it).
- `.uno:CharBackColor` for highlight.
- `.uno:BackgroundColor` for cell fill and paragraph shading.
- `.uno:ToggleMergeCells` for merge and centre.
- `.uno:InsertSlide`, `.uno:DuplicateSlide` and `.uno:DeleteSlide` for slide commands.

Arguments verified from .sdi or the shipped config:
- `StyleApply?Style:string=…&FamilyName:string=ParagraphStyles|CellStyles`
- `AssignLayout?WhatLayout:long=N`
- FontHeight(Height, Prop, Diff)
- CharFontName(FamilyName…)
- InsertTable(Columns, Rows…)
- InsertContents Flags letters (A, S, V, D, F, N, T, O)
- Presentation(StartingSlide)

Corrections to the draft names:
- Freeze first row/column is `.uno:FreezePanesRow` / `.uno:FreezePanesColumn`.
- The Impress slide-number field is `.uno:InsertSlideField`.
- Word's "Normal" style corresponds to LO "Standard".

LO 26.8 adds commands that close Office gaps:
- `.uno:InsertCalcTable` (Excel Table / Ctrl+T)
- `.uno:DraftView`
- slide sections: `.uno:AddSlideSection` and related commands
- `.uno:ThemeSelectorPanel` / `.uno:AddTheme`
- `.uno:NewSheetView`
- `.uno:InsertLandscapePage`

Transitions and animations have only sidebar-deck commands, so our galleries must set slide and animation properties through the API. Real gaps: SmartArt, Icons/3D, Designer, Flash Fill, Power Query, threaded comments, Read Aloud, offline Translate, Quick Styles/text effects, Word Outline view, PowerPoint Reading view.

**Shortcuts.** Many core keys already match:
- **Writer and Impress:** Ctrl+B/I/U/E/L/R/J, Ctrl+K, and Shift+F3 (change case, Writer).
- **Writer:** Ctrl+Enter (page break).
- **Everywhere:** F7.
- **Calc:** F2, F4, Ctrl+D, Ctrl+Shift+L, Ctrl+1, Ctrl+Space, Shift+Space, Ctrl+;, Ctrl+[ ].
- **Impress:** F5, Shift+F5, Ctrl+M, Alt+Shift+arrows.

Old concerns are resolved in 26.8:
- Calc F4 = ToggleRelative (Shift+F4 is unbound).
- Calc Ctrl+D = FillDown.
- The selection list moved to Alt+Down.

Dangerous conflicts that must be overridden:
- Ctrl+Q = Quit (closes all of LibreOffice).
- In Calc, Alt+Enter fills the whole selection and Ctrl+Enter inserts a line break. This is the reverse of Excel and hard-coded, not in Accelerators.xcu.
- The F12 family is numbering/bullets/table in Writer and Group/Ungroup in Calc (Office: Save As/Save/Open/Print).
- Impress Ctrl+Shift+G = Group, the opposite of PowerPoint.
- Writer Ctrl+Shift+D = right-to-left paragraph; Ctrl+Shift+A = left-to-right paragraph.
- Writer Ctrl+1/2/5 apply Heading styles; Ctrl+D = double underline; Ctrl+M = clear formatting.
- Ctrl+Shift+M toggles read-only mode.
- Shift+F7 toggles automatic spellcheck.
- Calc Ctrl+R/E/L align text; Shift+F11 = Save as Template; F11 = Styles.
- F4 opens dialogs in Writer and Impress.

**Override mechanism (all verified in code or API docs).** LO resolves a key by checking document, then module, then global configuration. Use three layers:
1. Per-module `XAcceleratorConfiguration` (`getShortCutManager`) in our private user profile, to remove or replace defaults.
2. `XUserInputInterception.addKeyHandler` on each controller. Handlers run in `SfxFrameWindow_Impl::PreNotify`, before the view's accelerators, and can consume events. Use this for context-dependent keys, Calc's hard-coded Enter combinations and shell keys (Ctrl+F1, F6, KeyTips).
3. An `XDispatchProviderInterceptor`, so Save/SaveAs/Open/New/Close/Quit/Options/Macros/Help always route to the shell.

**Turkish specifics.**
- LO's Turkish UI adds only two Calc bindings: Ctrl+, = date and Ctrl+Shift+, = time. On Turkish-Q, Excel users press Ctrl+Shift+, for the date, so LO would insert the time.
- Turkish-Q AltGr+1/2/3/E/Q/T/I type > £ # € @ ₺ i (verified with a ToUnicodeEx probe on Windows 11). This collides with Ctrl+Alt+1..3 headings and with LO's Ctrl+Alt+E, which LO disabled for fr and hu but not for tr.
- Secondary sources and a Microsoft Q&A say Turkish-UI Office localizes some Ctrl shortcuts (Ctrl+K bold, Ctrl+T italic, Ctrl+Shift+A underline; Excel AutoSum is not Alt+=). Microsoft's tr-TR pages, however, show the US shortcuts and the US KeyTips (Alt,H = Giriş) and say they assume the US layout. This is unverified and needs a real Turkish Office check.
- LO's Turkish UI terms differ from Microsoft's (Eğik vs İtalik, Süzgeç vs Filtre, Canlandırma vs Animasyonlar).

**KeyTips.**
- Use Microsoft's letters (F/H/N/G/P/S/R/W/Q; Excel P/M/A; PowerPoint G/K/A/S). Microsoft's Turkish documentation shows the same letters.
- Use ASCII letters only, never I/İ/ı, with a uniqueness check per tab.
- Match on the typed character, so the Turkish-F layout works.
- Only Left Alt or F10 activates KeyTips; AltGr must not.

## Tables
Legend for Status:
- **V** = the command is defined in LibreOffice 26.8.0.3 officecfg UI command definitions and in 25.8.7.3.
- **V26** = new in 26.8.
- **Vui** = the command only appears as a control in shipped soffice.cfg UI files.
- **Va** = argument names verified in 26.8 .sdi or the shipped UI config.
- **U** = unverified (behaviour or arguments must be tested).
- **GAP** = no LibreOffice command found.

In shortcut rows, LO defaults are taken from the 26.8.0.3 Accelerators.xcu (identical to 25.8.7.3 except where noted). "–" means unbound.

### A. Tabs and KeyTips
| App | Office tab and KeyTip (EN, Microsoft docs) | Proposed TR tab and KeyTip | LO Tabbed-UI analogue |
|---|---|---|---|
| Word | File F · Home H · Insert N · Design G · Layout P · References S · Mailings M · Review R · View W · Developer L · Search Q (Draw: J,I per the PowerPoint doc) | Dosya F · Giriş H · Ekle N · Tasarım G · Düzen P · Başvurular S · (Postalar M, later) · Gözden Geçir R · Görünüm W · Yardım Y · Arama Q | File, Home, Insert, Layout, References, Review, View, Table, Image, Draw, Object, Media, Print, Form, Tools |
| Excel | Home H · Insert N · Page Layout P · Formulas M · Data A · Review R · View W · Search Q (File F) | Dosya F · Giriş H · Ekle N · Sayfa Düzeni P · Formüller M · Veri A · Gözden Geçir R · Görünüm W · Arama Q | File, Home, Insert, Layout, Data, Review, View, Image, Draw, Object, Media, Print, Form, Tools |
| PowerPoint | File F · Home H · Insert N · Design G · Transitions K · Animations A · Slide Show S · Recording E · Review R · View W · Help Y,2 · Search Q | Dosya F · Giriş H · Ekle N · Tasarım G · Geçişler K · Animasyonlar A · Slayt Gösterisi S · Gözden Geçir R · Görünüm W · Arama Q | File, Home, Insert, Layout, Slide Show, Review, View, Table, Image, Draw, Object, Media, Master, Outline, Tools |
| PDF (ours) | – | Dosya F · Giriş H · Açıklama C · Düzenle E · Sayfalar P · Form/Koruma O · Görünüm W · Arama Q | – |
| Rules (proposal) | Microsoft tr-TR docs show the same letters as English | ASCII letters only; no I/İ/ı; unique within each tab (build-time test); group commands get 1–2 letters (numbers 1–9 for the Quick Access Toolbar); contextual tabs start with J (JT, JL, JP, JD) (U); match on the typed character with I/ı/İ/i normalised; activate only on Left Alt or F10, never on AltGr; Esc steps back | – |

### B. Word ribbon to UNO
| Tab and group | Office controls (idMso) | LibreOffice UNO (arguments) | Status | Gaps / notes |
|---|---|---|---|---|
| Home › Clipboard | PasteMenu, Cut, Copy, FormatPainter | .uno:Paste · .uno:PasteSpecial · .uno:PasteUnformatted (Keep Text Only) · .uno:Cut · .uno:Copy · .uno:FormatPaintbrush | V | Clipboard pane: GAP |
| Home › Font | Font, FontSize, FontSizeIncrease/DecreaseWord, ChangeCaseGallery, ClearFormatting, Bold, Italic, UnderlineGallery, Strikethrough, Subscript, Superscript, TextEffectsGallery, TextHighlightColorPicker, FontColorPicker | .uno:CharFontName?CharFontName.FamilyName:string=Calibri · .uno:FontHeight?FontHeight.Height:float=11 · .uno:Grow / .uno:Shrink · .uno:ChangeCaseToSentenceCase / ToLower / ToUpper / ToTitleCase / ToToggleCase · .uno:ResetAttributes · .uno:Bold · .uno:Italic · .uno:Underline / .uno:UnderlineDouble · .uno:Strikeout · .uno:SubScript · .uno:SuperScript · .uno:Shadowed / .uno:OutlineFont · .uno:CharBackColor · .uno:Color (.uno:FontColor exists, unused by LO UI) · .uno:FontDialog | V; Va (member names; dotted "Slot.Member" form U) | Glow/reflection effects: GAP. Colour argument form (Color:long vs Color.Color + ComplexColor): U |
| Home › Paragraph | Bullets, Numbering, MultilevelList, IndentDecrease/Increase, SortDialog, ParagraphMarks, AlignLeft/Center/Right/Justify, LineSpacingGallery, ShadingColorPicker, Borders | .uno:DefaultBullet · .uno:DefaultNumbering · .uno:SetOutline · .uno:DecrementIndent / .uno:IncrementIndent · .uno:SortDialog · .uno:ControlCodes · .uno:LeftPara / .uno:CenterPara / .uno:RightPara / .uno:JustifyPara · .uno:LineSpacing, .uno:SpacePara1 / .uno:SpacePara15 / .uno:SpacePara2, .uno:ParaspaceIncrease / Decrease · .uno:BackgroundColor · .uno:SetBorderStyle · .uno:ParagraphDialog | V | Bullet/number libraries: build our own gallery on list styles (U) |
| Home › Styles | QuickStylesGallery, StylesPane | .uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles (Standard, Title, Subtitle, Heading n, Quotations…) · .uno:StylesPreview · .uno:DesignerDialog · .uno:StyleNewByExample · .uno:StyleUpdateByExample | V, Va | Style names are programmatic English names; Word "Normal" = LO "Standard" (U) |
| Home › Editing | FindPopup, ReplaceDialog, SelectMenu, GoTo | vnd.sun.star.findbar:FocusToFindbar · .uno:SearchDialog · .uno:SelectAll · .uno:GotoPage | V | The find bar is an LO toolbar, so build our own find UI; Select Objects: GAP |
| Insert › Pages | CoverPage, BlankPage, PageBreak | .uno:TitlePageDialog · .uno:InsertPagebreak · .uno:InsertLandscapePage | V; V26 | Cover gallery: GAP |
| Insert › Tables | TableInsertGallery | .uno:InsertTable?Columns:short=3&Rows:short=3 (also TableName, Flags, AutoFormat) | V, Va | Quick Tables: GAP |
| Insert › Illustrations | Pictures, Shapes, Icons, 3D, SmartArt, Chart, Screenshot | .uno:InsertGraphic · .uno:BasicShapes(.rectangle, .ellipse…) · .uno:ArrowShapes · .uno:FlowChartShapes · .uno:CalloutShapes · .uno:StarShapes · .uno:Line · .uno:InsertObjectChart | V | Icons, 3D, SmartArt, Screenshot: GAP |
| Insert › Links, Comments | Hyperlink, Bookmark, CrossReference, NewComment | .uno:HyperlinkDialog · .uno:InsertBookmark · .uno:InsertReferenceField · .uno:InsertAnnotation | V | |
| Insert › Header & Footer | Header, Footer, PageNumber | .uno:InsertPageHeader · .uno:InsertPageFooter · .uno:PageNumberWizard · .uno:InsertPageNumberField · .uno:InsertPageCountField | V (header/footer arguments U) | Galleries: GAP |
| Insert › Text | TextBox, QuickParts, WordArt, DropCap, SignatureLine, DateAndTime, Object | .uno:DrawText · .uno:EditGlossary · .uno:FontworkGalleryFloater · .uno:FormatDropcap · .uno:InsertSignatureLine · .uno:InsertDateFieldVar / .uno:InsertDateField (fixed) / .uno:InsertTimeField · .uno:InsertFieldCtrl / .uno:InsertField · .uno:InsertObject | V | |
| Insert › Symbols | Equation, Symbol | .uno:InsertObjectStarMath · .uno:CharmapControl (popup) / .uno:InsertSymbol (dialog) | V | LO Math is not Office Math (OMML round trip U) |
| Design | Themes, StyleSets, Colors/Fonts, ParagraphSpacing, Watermark, PageColor, PageBorders | .uno:ThemeDialog · .uno:ThemeSelectorPanel / .uno:AddTheme · .uno:Watermark · .uno:PageDialog (Area/Borders tabs) | V; V26 | Style sets: GAP. Page colour has no command (use the dialog or API). Writer theme support: U |
| Layout › Page Setup | Margins, Orientation, Size, Columns, Breaks, LineNumbers, Hyphenation | .uno:PageMargin · .uno:Orientation · .uno:AttributePageSize · .uno:PageColumnType / .uno:FormatColumns · .uno:InsertBreak · .uno:InsertColumnBreak · .uno:LineNumberingDialog · .uno:Hyphenate · .uno:PageDialog | V | Word section breaks have no 1:1 command (LO uses page styles/sections) |
| Layout › Paragraph | IndentLeft/Right, SpacingBefore/After | .uno:LeftParaMargin · .uno:RightParaMargin · .uno:AboveSpacing · .uno:BelowSpacing · .uno:ParagraphDialog | Vui (arguments U) | Prefer setting paragraph properties through the API |
| Layout › Arrange | Position, TextWrap, Forward/Backward, SelectionPane, Align, Group, Rotate | .uno:SetAnchorToChar (In line) · .uno:WrapOff / WrapOn / WrapIdeal / WrapLeft / WrapRight / WrapThrough · .uno:ObjectForwardOne / .uno:ObjectBackOne / .uno:BringToFront / .uno:SendToBack · .uno:ObjectAlignLeft / .uno:AlignCenter / .uno:ObjectAlignRight / .uno:AlignUp / .uno:AlignMiddle / .uno:AlignDown · .uno:FormatGroup / .uno:FormatUngroup · .uno:RotateLeft / .uno:RotateRight / .uno:FlipVertical / .uno:FlipHorizontal | V | Selection Pane: GAP |
| References | TOC, Update, Footnote, Endnote, Citation, Bibliography, Caption, TableOfFigures, CrossRef, MarkEntry, Index | .uno:InsertMultiIndex · .uno:UpdateCurIndex / .uno:UpdateAllIndexes · .uno:InsertFootnote · .uno:InsertEndnote · .uno:FootnoteDialog · .uno:InsertAuthoritiesEntry · .uno:BibliographyComponent · .uno:InsertCaptionDialog · .uno:InsertReferenceField · .uno:InsertIndexesEntry · .uno:UpdateAll | V | TOC "Add Text": GAP. Citation-source round trip: U |
| Review › Proofing, Language | SpellingAndGrammar, Thesaurus, WordCount, ReadAloud, Translate, Language, Accessibility | .uno:SpellingAndGrammarDialog · .uno:ThesaurusDialog · .uno:WordCountDialog · .uno:SpellOnline · .uno:LanguageStatus / .uno:SetLanguageAllTextMenu · .uno:AccessibilityCheck | V | Read Aloud and offline Translate: GAP |
| Review › Comments | NewComment, Delete, Prev/Next, Show | .uno:InsertAnnotation · .uno:ReplyComment · .uno:DeleteComment · .uno:DeleteAllNotes · .uno:ResolveComment · .uno:ShowAnnotations | V | Previous/next comment in Writer: no command found (U) |
| Review › Tracking, Changes, Compare | TrackChanges, DisplayForReview, ReviewingPane, Accept/Reject, Prev/Next, Compare | .uno:TrackChanges · .uno:ShowTrackedChanges · .uno:AcceptTrackedChanges / .uno:SidebarDeck.SwManageChangesDeck · .uno:AcceptTrackedChange / …ToNext / .uno:AcceptAllTrackedChanges · .uno:RejectTrackedChange / …ToNext / .uno:RejectAllTrackedChanges · .uno:PreviousTrackedChange / .uno:NextTrackedChange · .uno:CompareDocuments / .uno:MergeDocuments · .uno:ProtectTraceChangeMode | V | Simple/All Markup modes and Restrict Editing: GAP |
| View | ReadMode, PrintLayout, WebLayout, Outline, Draft, Ruler, Gridlines, NavigationPane, Zoom, 100%, OnePage, MultiplePages, PageWidth, NewWindow, Split | .uno:FullScreen (close to Read Mode) · .uno:PrintLayout · .uno:BrowseView · .uno:DraftView · .uno:ShowWhitespace · .uno:Ruler · .uno:GridVisible · .uno:Navigator / .uno:SidebarDeck.NavigatorDeck · .uno:Zoom · .uno:Zoom100Percent · .uno:ZoomPage · .uno:BookView · .uno:ZoomPageWidth · .uno:ZoomOptimal · .uno:NewWindow | V; DraftView V26 | Outline view, Split, Side-by-side: GAP. NewWindow opens an LO window, so route it to the shell or disable it |
| File / QAT | New, Open, Save, SaveAs, Print, ExportPDF, Info, Close, Undo/Redo | .uno:AddDirect · .uno:Open · .uno:Save · .uno:SaveAs · .uno:Print / .uno:PrintDefault · .uno:PrintPreview · .uno:ExportToPDF / .uno:ExportDirectToPDF · .uno:SetDocumentProperties · .uno:CloseDoc · .uno:Undo / .uno:Redo / .uno:Repeat | V | Implement file operations in the shell (storeToURL + filter) and intercept these commands |

### C. Excel ribbon to UNO (Calc)
| Tab and group | Office controls | LibreOffice UNO (arguments) | Status | Gaps / notes |
|---|---|---|---|---|
| Home › Clipboard | Paste (Values, Transpose, Special), Cut, Copy, FormatPainter | .uno:Paste · .uno:InsertContents?Flags:string=SVD (values) · .uno:PasteTransposed · .uno:PasteSpecial · .uno:PasteUnformatted · .uno:PasteOnlyValue (numbers only) · .uno:Cut · .uno:Copy · .uno:FormatPaintbrush | V, Va | |
| Home › Font | Font, Size, Increase/Decrease, B/I/U, Borders, Fill, Font colour | .uno:CharFontName · .uno:FontHeight · .uno:Grow / .uno:Shrink · .uno:Bold / .uno:Italic / .uno:Underline / .uno:UnderlineDouble · .uno:SetBorderStyle · .uno:BackgroundColor · .uno:Color · .uno:FormatCellDialog | V (border arguments U) | |
| Home › Alignment | Top/Middle/Bottom, Orientation, Left/Center/Right, Indent, WrapText, MergeCenter | .uno:AlignTop / .uno:AlignVCenter / .uno:AlignBottom · .uno:AlignLeft / .uno:AlignHorizontalCenter / .uno:AlignRight / .uno:AlignBlock · .uno:DecrementIndent / .uno:IncrementIndent · .uno:WrapText · .uno:ToggleMergeCells · .uno:MergeCells · .uno:SplitCell (unmerge) | V | Text angle only through the dialog or API; Merge Across: GAP |
| Home › Number | Format list, Accounting, %, Comma, Inc/Dec decimals | .uno:NumberFormatType (Vui) · .uno:NumberFormatStandard / Decimal / Currency / Percent / Date / Time / Scientific · .uno:NumberFormatThousands · .uno:NumberFormatIncDecimals / .uno:NumberFormatDecDecimals | V | Accounting format needs a format code through the API (U) |
| Home › Styles | ConditionalFormatting, FormatAsTable, CellStyles | .uno:ConditionalFormatMenu · .uno:ConditionalFormatEasy?FormatRule:short=N · .uno:ConditionalFormatDialog / .uno:ColorScaleFormatDialog / .uno:DataBarFormatDialog / .uno:IconSetFormatDialog / .uno:ConditionalFormatManagerDialog · .uno:InsertCalcTable / .uno:AutoFormat / .uno:DefineDBName · .uno:StyleApply?Style:string=Good&FamilyName:string=CellStyles | V; InsertCalcTable V26; Easy Vui | FormatRule id meanings: U. Excel table-style parity: U |
| Home › Cells | Insert/Delete cells, rows, columns, sheet; Format | .uno:InsertCell · .uno:InsertRowsBefore / After · .uno:InsertColumnsBefore / After · .uno:Insert (sheet dialog) · .uno:DeleteCell · .uno:DeleteRows · .uno:DeleteColumns · .uno:Remove · .uno:RowHeight · .uno:SetOptimalRowHeight · .uno:ColumnWidth · .uno:SetOptimalColumnWidthDirect · .uno:HideRow / .uno:ShowRow / .uno:HideColumn / .uno:ShowColumn / .uno:Hide / .uno:Show · .uno:RenameTable · .uno:Move · .uno:DuplicateSheet · .uno:SetTabBgColor · .uno:Protect | V | Insert a sheet without a dialog through the API (XSpreadsheets.insertNewByName) |
| Home › Editing | AutoSum, Fill, Clear, Sort & Filter, Find & Select | .uno:AutoSum · .uno:FillDown / Right / Up / Left · .uno:FillSeries · .uno:ClearContents · .uno:Delete (arguments U; letters from cellsh1) · .uno:SortAscending / .uno:SortDescending / .uno:DataSort · .uno:DataFilterAutoFilter / .uno:DataFilterRemoveFilter · .uno:SearchDialog · .uno:FocusCellAddress · .uno:SelectVisibleRows / Columns | V | Flash Fill, Go To Special: GAP |
| Insert | PivotTable, Table, Pictures, Shapes, Charts, Sparklines, Link, Note, TextBox, Header&Footer, WordArt, Signature, Object, Equation, Symbol | .uno:DataDataPilotRun · .uno:InsertCalcTable · .uno:InsertGraphic · .uno:BasicShapes… · .uno:InsertObjectChart · .uno:InsertSparkline · .uno:HyperlinkDialog · .uno:InsertAnnotation · .uno:DrawText · .uno:EditHeaderAndFooter · .uno:FontworkGalleryFloater · .uno:InsertSignatureLine · .uno:InsertObject · .uno:InsertObjectStarMath · .uno:CharmapControl / .uno:InsertSymbol | V; V26 | Icons, SmartArt, 3D, Slicer, Timeline, in-cell checkbox/picture, Recommended charts/pivots: GAP. LO comments = Excel notes; threaded comments: GAP |
| Page Layout | Themes, Margins/Orientation/Size, PrintArea, Breaks, Background, PrintTitles, ScaleToFit, Gridlines/Headings, Arrange | .uno:PageFormatDialog · .uno:DefinePrintArea / .uno:DeletePrintArea / .uno:AddPrintArea · .uno:EditPrintArea (repeat rows/columns) · .uno:InsertRowBreak / .uno:InsertColumnBreak / .uno:DeleteRowbreak / .uno:DeleteColumnbreak / .uno:DeleteAllBreaks · .uno:ToggleSheetGrid · .uno:ViewRowColumnHeaders · .uno:BringToFront / .uno:SendToBack / .uno:ObjectForwardOne / .uno:ObjectBackOne | V | Calc themes: GAP. One-click margin/orientation/scale presets need page-style API calls (U) |
| Formulas | InsertFunction, AutoSum, Library, Names, Auditing, Calculation | .uno:FunctionDialog · .uno:AutoSum · .uno:FunctionBox / .uno:SidebarDeck.ScFunctionsDeck · .uno:InsertFunction (V26, U) · .uno:DefineName · .uno:AddName · .uno:InsertName · .uno:CreateNames · .uno:ShowPrecedents / .uno:ShowDependents · .uno:ClearArrows (+Precedents/Dependents) · .uno:ToggleFormula · .uno:ShowErrors · .uno:AutomaticCalculation · .uno:Calculate · .uno:CalculateHard | V | Evaluate Formula, Watch Window, Calculate Sheet: GAP |
| Data | GetData/Text, RefreshAll, Sort, Filter, Advanced, TextToColumns, RemoveDuplicates, Validation, Consolidate, WhatIf, Outline | CSV opened by the shell through filters · .uno:InsertExternalDataSource · .uno:DataAreaRefresh · .uno:DataSort · .uno:DataFilterAutoFilter / .uno:DataFilterRemoveFilter / .uno:DataFilterSpecialFilter / .uno:DataFilterStandardFilter · .uno:TextToColumns · .uno:HandleDuplicateRecords · .uno:Validation · .uno:DataConsolidate · .uno:ScenarioManager / .uno:GoalSeekDialog / .uno:TableOperationDialog / .uno:SolverDialog · .uno:Group / .uno:Ungroup / .uno:DataSubTotals / .uno:ShowDetail / .uno:HideDetail | V | Power Query, Data Types, Forecast Sheet: GAP |
| Review | Spelling, Thesaurus, Notes/Comments, Protect | .uno:SpellDialog · .uno:ThesaurusDialog · .uno:InsertAnnotation / .uno:EditAnnotation / .uno:DeleteNote / .uno:ShowNote / .uno:HideNote / .uno:ShowAllNotes / .uno:HideAllNotes / .uno:DeleteAllNotes · .uno:Protect · .uno:ToolProtectionDocument · .uno:TraceChangeMode / .uno:AcceptChanges | V | Allow Edit Ranges: GAP |
| View | Normal, PageBreakPreview, PageLayout, Gridlines, FormulaBar, Headings, Zoom, NewWindow, Freeze, Split, SheetView | .uno:NormalViewMode · .uno:PagebreakMode · .uno:PrintPreview (close to Page Layout view) · .uno:ToggleSheetGrid · .uno:InputLineVisible · .uno:ViewRowColumnHeaders · .uno:Zoom / .uno:Zoom100Percent / .uno:ZoomOptimal (U: zoom to selection) · .uno:NewWindow · .uno:FreezePanes / .uno:FreezePanesRow / .uno:FreezePanesColumn · .uno:SplitWindow · .uno:NewSheetView | V; V26 | Page Layout view, Custom Views, Arrange All: GAP |

### D. PowerPoint ribbon to UNO (Impress)
| Tab and group | Office controls | LibreOffice UNO (arguments) | Status | Gaps / notes |
|---|---|---|---|---|
| Home › Clipboard | Paste, Cut, Copy, FormatPainter | .uno:Paste / .uno:PasteSpecial / .uno:PasteUnformatted · .uno:Cut · .uno:Copy · .uno:FormatPaintbrush | V | |
| Home › Slides | SlideNewGallery, Duplicate, ReuseSlides, Layout, Reset, Section | .uno:InsertSlide (menu) / .uno:InsertPage (Ctrl+M) · .uno:DuplicateSlide / .uno:DuplicatePage · .uno:ImportSlideFromFile · .uno:AssignLayout?WhatLayout:long=N · .uno:DeleteSlide · .uno:AddSlideSection / .uno:RenameSlideSection / .uno:RemoveSlideSection | V, Va; sections V26 | Mapping from N to layout names: U. Reset slide: GAP |
| Home › Font | Font, Size, Inc/Dec, Clear, B/I/U, Shadow, Strike, Spacing, Case, Highlight, Colour, dialog | .uno:CharFontName · .uno:FontHeight · .uno:Grow / .uno:Shrink · .uno:SetDefault · .uno:Bold / .uno:Italic / .uno:Underline · .uno:Shadowed · .uno:Strikeout · .uno:Spacing · .uno:ChangeCaseTo… · .uno:CharBackColor · .uno:Color · .uno:FontDialog | V | |
| Home › Paragraph | Bullets, Numbering, ListLevel, LineSpacing, Align, Columns, TextDirection, AlignText, SmartArt | .uno:DefaultBullet · .uno:DefaultNumbering · .uno:OutlineLeft / .uno:OutlineRight · .uno:LineSpacing / .uno:SpacePara1 / 15 / 2 · .uno:LeftPara / CenterPara / RightPara / JustifyPara · .uno:CellVertTop / .uno:CellVertCenter / .uno:CellVertBottom · .uno:ParagraphDialog | V | Text-box columns, text rotation, Convert to SmartArt: GAP/U |
| Home › Drawing | Shapes, Arrange, QuickStyles, Fill, Outline, Effects | .uno:BasicShapes… · .uno:Text · .uno:BringToFront / .uno:Forward / .uno:Backward / .uno:SendToBack · .uno:FormatGroup / .uno:FormatUngroup · .uno:ObjectAlignLeft… / .uno:DistributeSelection · .uno:FillColor · .uno:XLineColor · .uno:FillShadow · .uno:FormatArea / .uno:FormatLine / .uno:TransformDialog | V | Quick Styles, glow/soft-edge/3D effects: GAP |
| Home › Editing | Find, Replace, Select | .uno:SearchDialog · .uno:SelectAll | V | Selection Pane: GAP |
| Insert | NewSlide, Table, Pictures, PhotoAlbum, Shapes, Chart, Link, Action, Comment, TextBox, Header&Footer, WordArt, Date&Time, SlideNumber, Object, Equation, Symbol, Video/Audio | .uno:InsertSlide · .uno:InsertTable?Columns:short=5&Rows:short=2 · .uno:InsertGraphic · .uno:PhotoAlbumDialog · .uno:BasicShapes… · .uno:InsertObjectChart · .uno:HyperlinkDialog · .uno:AnimationEffects (Interaction) · .uno:InsertAnnotation · .uno:Text · .uno:HeaderAndFooter · .uno:FontworkGalleryFloater · .uno:InsertDateFieldFix / .uno:InsertDateFieldVar · .uno:InsertSlideField · .uno:InsertObject · .uno:InsertMath · .uno:CharmapControl · .uno:InsertAVMedia | V, Va | Icons, SmartArt, 3D, Zoom, Screenshot, screen recording: GAP |
| Design | Themes, Variants, SlideSize, FormatBackground, Designer | .uno:SidebarDeck.SdMasterPagesDeck · .uno:ThemeDialog / .uno:ThemeSelectorPanel / .uno:AddTheme · .uno:SlideSetup (slide size and background) · .uno:SelectBackground | V; V26 | Variants, Designer: GAP |
| Transitions | Gallery, EffectOptions, Sound, Duration, ApplyToAll, Advance | .uno:SlideChangeWindow / .uno:SidebarDeck.SdSlideTransitionDeck | V | No per-effect commands; set slide properties through the API (TransitionType / Subtype / Duration, Change…) (U) |
| Animations | Gallery, EffectOptions, Add, Pane, Timing, Painter | .uno:CustomAnimation / .uno:SidebarDeck.SdCustomAnimationDeck | V | Build on the css::animations API. Animation Painter: GAP |
| Slide Show | FromBeginning, FromCurrent, Custom, SetUp, HideSlide, Rehearse, PresenterView | .uno:Presentation (StartingSlide) · .uno:PresentationCurrentSlide · .uno:CustomShowDialog · .uno:PresentationDialog · .uno:HideSlide / .uno:ShowSlide · .uno:RehearseTimings | V, Va | Presenter Console starts automatically with two displays; forcing it: U. Record and subtitles: GAP |
| Review | Spelling, Thesaurus, Language, Comments, Compare | .uno:SpellDialog · .uno:ThesaurusDialog · .uno:LanguageStatus · .uno:InsertAnnotation / .uno:DeleteAnnotation / .uno:DeleteAllAnnotation / .uno:PreviousAnnotation / .uno:NextAnnotation / .uno:ShowAnnotations | V | Compare: GAP |
| View | Normal, Outline, SlideSorter, NotesPage, Masters, Ruler, Gridlines, Guides, Zoom, Fit, Colour/Grayscale, NewWindow | .uno:NormalMultiPaneGUI · .uno:OutlineMode · .uno:DiaMode · .uno:NotesMode · .uno:SlideMasterPage / .uno:HandoutMode / .uno:NotesMasterPage / .uno:CloseMasterView · .uno:ShowRuler · .uno:GridVisible · .uno:HelplinesVisible · .uno:Zoom · .uno:ZoomPage · .uno:OutputQualityColor / Grayscale / BlackWhite · .uno:NewWindow | V | Reading view and notes-pane toggle: no command found (GAP/U) |

### E. Shortcuts (US key names; LO default shown as Writer / Calc / Impress)
| Keys | Office action | LO 26.8 default (W / C / I) | Map to | Action |
|---|---|---|---|---|
| Ctrl+B / I / U | Bold / italic / underline | Bold / Italic / Underline in all three | same | None. A Turkish Office profile would use Ctrl+K / Ctrl+T / Ctrl+Shift+A (unverified) |
| Ctrl+E | W/P centre; X Flash Fill | CenterPara / AlignHorizontalCenter / CenterPara | X: GAP | Calc: decide (keep centre, or no-op with a hint) |
| Ctrl+L, Ctrl+T | X create table; W/P Ctrl+L left; P Ctrl+T Font dialog | LeftPara / AlignLeft / LeftPara; Ctrl+T unbound (de/es only) | X: .uno:InsertCalcTable (V26); P Ctrl+T: .uno:FontDialog | Override in Calc; add in Impress |
| Ctrl+R | W/P right align; X fill right | RightPara / AlignRight / RightPara | X: .uno:FillRight | Override in Calc |
| Ctrl+J | Justify | JustifyPara / AlignBlock / JustifyPara | same | None |
| Ctrl+Shift+> / < | Grow / shrink font | – / – (Turkish UI: Ctrl+Shift+, = time) / – | .uno:Grow / .uno:Shrink | Add; match by character (on Turkish-Q the <> key is OEM_102) |
| Ctrl+] / [ | W ±1 pt; X dependents/precedents; P font size (text) or forward/backward (object) | Grow / Shrink · MarkDependents / MarkPrecedents · Grow / Shrink | P with object selected: .uno:Forward / .uno:Backward | Context-dependent override in Impress; on Turkish-Q [ ] need AltGr+8/9 |
| Ctrl+Shift+] / [ | P bring to front / send to back | – (LO uses Ctrl+Shift++ / Ctrl+Shift+-) | .uno:BringToFront / .uno:SendToBack | Add |
| Ctrl+K | Hyperlink | HyperlinkDialog (global) | same | None |
| Ctrl+Enter | W page break; X fill selection | InsertPagebreak / hard-coded line break in cell / – | Calc: fill selection | Calc: intercept with XKeyHandler |
| Alt+Enter | X new line in cell | – / hard-coded fill of the whole selection / – | Calc: line break | Dangerous in Calc: intercept and swap with Ctrl+Enter |
| Ctrl+Alt+1..3 | W Heading 1–3 | unbound (LO uses Ctrl+1..5) | .uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles | Add, but Turkish-Q AltGr+1/2/3 types > £ #: avoid or detect AltGr |
| Ctrl+1 / 2 / 5 | W spacing 1 / 2 / 1.5; X Ctrl+1 Format Cells, Ctrl+2 bold, Ctrl+5 strikethrough | Heading 1 / 2 / 5 · FormatCellDialog, SpacePara2, SpacePara15 · SpacePara1 / 2 / 15 | W: .uno:SpacePara1 / 2 / 15; X: Ctrl+2 .uno:Bold, Ctrl+3 .uno:Italic, Ctrl+4 .uno:Underline, Ctrl+5 .uno:Strikeout | Override in Writer and Calc |
| Ctrl+0 | W ±12 pt space before; X hide columns | Text body style / – / – | W: paragraph API (U); X: .uno:HideColumn | Override |
| Ctrl+9, Ctrl+Shift+( ) | X hide rows; unhide rows / columns | – | .uno:HideRow / .uno:ShowRow / .uno:ShowColumn | Add |
| Ctrl+Shift+N | W Normal style | NewDoc (Templates dialog) | .uno:StyleApply?Style:string=Standard&FamilyName:string=ParagraphStyles | Override |
| Ctrl+Shift+L | W bullets; X filter | – / DataFilterAutoFilter / – | W: .uno:DefaultBullet | Add in Writer |
| F12, Shift+F12, Ctrl+F12, Ctrl+Shift+F12 | Save As, Save, Open, Print | DefaultNumbering, DefaultBullet, InsertTable, RemoveBullets / Group, –, Ungroup, – / –, DefaultBullet (26.8), –, – | shell commands | Override all |
| Ctrl+S, Ctrl+Shift+S, Ctrl+N, Ctrl+O, Ctrl+W, Ctrl+F4 | Save, (none), New, Open, Close | Save, SaveAs, AddDirect, OpenFrom…, CloseWin, CloseDoc | shell commands | Intercept through the dispatch interceptor |
| Ctrl+Q | W remove paragraph formatting | Quit (global + Impress): closes all of LibreOffice | W: paragraph reset (U); X/P: no-op | Dangerous: override |
| Ctrl+F2, Ctrl+Alt+I | Print preview | InsertField / FunctionDialog / – (LO preview is Ctrl+Shift+O) | .uno:PrintPreview or shell preview | Override |
| Ctrl+F / Ctrl+H | Find / Replace | findbar / SearchDialog | our find UI / .uno:SearchDialog | Override Ctrl+F |
| Ctrl+G | W/X Go To; P group | GotoPage / RepeatSearch / – | X: .uno:FocusCellAddress or own dialog; P: .uno:FormatGroup | Override in Calc; add in Impress |
| F5 / Shift+F5 / Alt+F5 | W/X Go To (Shift+F5: W last edit, X Find); P slide show from start / current / presenter view | Navigator, RestoreEditingView / Navigator, ShowDependents / Presentation, PresentationCurrentSlide, – | W F5 .uno:GotoPage; X F5 Go To, Shift+F5 .uno:SearchDialog; P Alt+F5 (U) | Override in Writer/Calc; add in Impress |
| Ctrl+Z / Ctrl+Y | Undo / Redo (repeat if nothing to redo) | Undo / Redo (Ctrl+Shift+Y = Repeat) | Ctrl+Y: Redo if possible, else .uno:Repeat (XUndoManager) | Refine |
| F4 | W/P repeat; X cycle $ references | GraphicDialog / ToggleRelative / TransformDialog | W/P: .uno:Repeat | Override in Writer/Impress |
| F2 / Shift+F2 / Ctrl+Shift+F2 | X edit cell / note / threaded comment; P edit text | InsertFormula, – / SetInputMode, –, FocusInputLine / Text | Shift+F2: .uno:InsertAnnotation or .uno:EditAnnotation; threaded comments: GAP | Add |
| Alt+= | X AutoSum; W equation | – | X: .uno:AutoSum; W: .uno:InsertObjectStarMath | Add |
| Ctrl+; / Ctrl+Shift+: | X date / time | – / InsertCurrentDate, InsertCurrentTime / – ; Turkish UI adds Ctrl+, = date, Ctrl+Shift+, = time | .uno:InsertCurrentDate / .uno:InsertCurrentTime | Turkish-Q Excel users press Ctrl+Shift+, (date) and Ctrl+Shift+. (time): override |
| Ctrl+D | X fill down; W Font dialog; P duplicate | UnderlineDouble / FillDown / – | W: .uno:FontDialog; P: .uno:DuplicateSlide (slide pane) or duplicate object through the API | Override in Writer; add in Impress |
| Ctrl+Shift+D | W double underline | ParaRightToLeft (!) | .uno:UnderlineDouble | Override |
| Ctrl+Space | X select column; W/P clear character formatting | – / SelectColumn / – | W: .uno:ResetAttributes (U: also clears paragraph formatting); P: .uno:SetDefault | Add |
| Shift+Space, Ctrl+Shift+Space, Ctrl+A | X row / all; W/P non-breaking space; select all | – / SelectRow · InsertNonBreakingSpace / SelectAll / InsertNonBreakingSpace · SelectAll | same | None |
| Ctrl+PgUp / PgDn | X previous / next sheet | JumpToHeader, JumpToFooter / JumpToPrevTable, JumpToNextTable / PreviousPage, NextPage | same | None (Writer optional) |
| Ctrl+M / Ctrl+Shift+M | W indent / remove indent; P new slide | ResetAttributes, EditDoc (!) / ResetAttributes, EditDoc (!) / InsertPage, SetDefault | W: .uno:IncrementIndent / .uno:DecrementIndent | Override; neutralise EditDoc |
| Ctrl+G, Ctrl+Shift+G, Ctrl+Shift+J | P group, ungroup, regroup | – , FormatGroup (!), FullScreen (Writer/Calc) | .uno:FormatGroup / .uno:FormatUngroup / GAP | Override (group and ungroup are inverted in LO) |
| Ctrl+= / Ctrl+Shift+= | W/P subscript / superscript; X Ctrl+Shift+= insert cells | – (LO uses Ctrl+Shift+B / Ctrl+Shift+P) | .uno:SubScript / .uno:SuperScript; X: .uno:InsertCell | Add (on Turkish-Q '=' is Shift+0) |
| Ctrl+- | X delete cells; W optional hyphen | InsertSoftHyphen / DeleteCell / Backward | same | None |
| Ctrl+Alt+V | Paste Special | – | .uno:PasteSpecial | Add |
| Ctrl+Shift+V | W paste text only; X paste values; P paste formatting | PasteSpecial dialog in all three | W: .uno:PasteUnformatted; X: .uno:InsertContents?Flags:string=SVD; P: GAP | Override |
| Ctrl+Alt+M | New comment (W/P) | – (LO uses Ctrl+Alt+C = InsertAnnotation) | .uno:InsertAnnotation | Add |
| Ctrl+Shift+E | W track changes | JumpToFootnoteOrAnchor | .uno:TrackChanges | Override |
| F7 / Shift+F7 | Spelling / thesaurus | spelling dialogs / SpellOnline toggle (global) | Shift+F7: .uno:ThesaurusDialog | Override Shift+F7 |
| Shift+F3 | W/P change case; X insert function | ChangeCaseRotateCase / ChangeCaseRotateCase / CopyObjects (Duplicate dialog) | X: .uno:FunctionDialog; P: .uno:ChangeCaseRotateCase | Override in Calc and Impress |
| F9, Shift+F9, Ctrl+Alt+F9 | X calculate all, sheet, full | Calculate, ShowPrecedents, – (Ctrl+Shift+F9 = CalculateHard) | .uno:Calculate, .uno:Calculate, .uno:CalculateHard | Override Shift+F9; add Ctrl+Alt+F9 |
| F11 / Shift+F11 | X chart sheet / new sheet | DesignerDialog / SaveAsTemplate | .uno:InsertObjectChart / insert sheet through the API | Override |
| Ctrl+Shift+1…6, ~ | X number, time, date, currency, percent, scientific, general | Decimal, Scientific (!), Date, Currency, Percent, Standard (!), – | 2: .uno:NumberFormatTime; 6: .uno:NumberFormatScientific; ~: .uno:NumberFormatStandard | Override (Turkish-Q: match digit keys, U) |
| Ctrl+Shift+& / _ | X outline border / remove borders | – | .uno:SetBorderStyle (arguments U) or API | Add |
| Ctrl+` / Alt+Down / Ctrl+' | X show formulas / pick list / copy formula from above | ToggleFormula / DataSelect / FillSingleEdit | same | None (on Turkish-Q, ` needs an AltGr dead key) |
| Alt+Shift+Right / Left / Up / Down | X group / ungroup; P/W promote, demote, move | – / – / OutlineRight, Left, Up, Down; Writer MoveUp / MoveDown | X: .uno:Group / .uno:Ungroup | Add in Calc |
| Alt+Shift+D / T | W date / time field | – | .uno:InsertDateFieldVar / .uno:InsertTimeField | Add |
| Alt+X | W Unicode toggle | UnicodeNotationToggle | same | None |
| Ctrl+Shift+8 | W show ¶ | – (LO uses Ctrl+F10) | .uno:ControlCodes | Add |
| Ctrl+Shift+K / Ctrl+Shift+A | W small caps / all caps | SmallCaps / ParaLeftToRight (!) (Impress: Combine) | Ctrl+Shift+A: character-case API (U) | Override Ctrl+Shift+A |
| Ctrl+F1, F6 / Shift+F6, Alt, F10, F1 | Ribbon toggle, pane cycling, KeyTips, help | unbound, VCL task-pane cycling (U), VCL menubar (hidden), LO help | shell | Intercept with the key handler; detecting a bare Alt press needs a spike |
| LO-only keys to neutralise | – | Shift+Esc CommandPopup · Ctrl+Shift+J FullScreen · Alt+F11 macros · Alt+F12 options · Ctrl+Alt+E extensions (also collides with AltGr+E = €) · Ctrl+Shift+Q · Ctrl+Shift+F4 data sources · F11 styles · Ctrl+F5 sidebar · F5 navigator · Alt+1…9 decks · Alt+C font dialog · Alt+P EditStyle (Writer 26.8) | remove or redirect | removeKeyEvent plus dispatch interceptor |

## Risks
- Static verification used a 25.8.7.3 installation and the 26.8.0.3 source tag. No runtime test was done (the GUI could not be launched during the research), so the 26.8 behaviour of new commands (InsertCalcTable, DraftView, slide sections) is unverified.
- Keyboard interception in the embedded createSystemChild window is unproven. XKeyHandler covers only windows inside the frame (not LO dialogs). A bare Alt press (KeyTips) does not reach UNO as a key event, and F6/F10 may be consumed by VCL. The order relative to Calc's input handler for Alt+Enter is inferred from PreNotify code, not tested.
- Data loss: in Calc, Alt+Enter overwrites the whole selection with the current entry. Ctrl+Q quits all of LibreOffice. Ctrl+Shift+M toggles read-only mode. All three must be neutralised before any user test.
- Saving through LO paths (.uno:Save or .uno:SaveAs from keys or context menus) bypasses our shell and may show LO's alien-format warning ('Keep current format') dialog. All file operations must go through a dispatch interceptor.
- Turkish shortcut expectations are unresolved. Secondary sources and a Microsoft Q&A say Turkish-UI Office localizes shortcuts (Ctrl+K bold, Ctrl+T italic, Ctrl+Shift+A underline; Excel AutoSum not Alt+=), while Microsoft's tr-TR docs list US shortcuts and US KeyTips. Choosing the wrong default annoys users, and a Turkish profile with Ctrl+K = bold conflicts with the international Ctrl+K = hyperlink.
- Keyboard-layout traps on Turkish-Q and Turkish-F: AltGr is reported as Ctrl+Alt, so Ctrl+Alt+1/2/3/E/Q/T/I shortcuts collide with typing > £ # € @ ₺ i. Ctrl+[ ], Ctrl+` and Ctrl+; need AltGr or Shift. LO's Turkish UI puts TIME on Ctrl+Shift+, where Excel users expect the date. LO maps punctuation keys to its own key names in ways that were not verified here.
- KeyTips letter matching can break on Turkish I/ı/İ/i and on the Turkish-F layout unless we match on the typed character with normalisation, avoid I entirely, and ignore AltGr.
- Version drift: accelerators and commands differ between LO 25.8 and 26.8 (six bindings changed; about 50 commands added and 7 label entries removed). Pin the engine version and run a start-up self-test (queryDispatch plus FeatureStateEvent) for every mapped command.
- Office-parity gaps users will look for on the ribbon: SmartArt, Icons/3D, Designer, Flash Fill, Power Query, threaded comments, Read Aloud, Translate, Quick Styles/text effects, Outline and Reading views. Transitions and animations need our own galleries on the API because LO offers only sidebar decks.
- Mapped commands open native LO (VCL) dialogs that use LO's Turkish terminology (Eğik, Süzgeç, Canlandırma) rather than Microsoft's (İtalik, Filtre, Animasyonlar), so the look and wording will be inconsistent.
- Microsoft keeps changing shortcuts: Word's Ctrl+Shift+V became Paste Text Only and Excel's became Paste Values in 2024–25, and format-painter keys moved to Ctrl+Alt+C/V. 'Office-compatible' is a moving target and the shortcut profile needs periodic review.

## Recommendation
1. **Build one declarative command registry (JSON)** from tables B to E. Each ribbon control and shortcut entry holds: module, UNO URL and arguments, context predicate (text selected, shape selected, cell edit mode, slide pane focused), and state source.
   - Drive the ribbon enabled and checked states from `XDispatch` status listeners.
   - At start-up, `queryDispatch` every entry and log anything missing. This catches differences between LO 25.8 and 26.8.
   - Target LibreOffice 26.8.x: it adds `InsertCalcTable`, `DraftView`, slide sections and theme commands.

2. **Implement shortcuts in three layers.** All APIs below are verified.
   - **(a) Module shortcut managers.** In our private LO user profile, use `XAcceleratorConfiguration` per module (`getUIConfigurationManager(module).getShortCutManager()`):
     - `removeKeyEvent` for LO defaults that expose LO chrome or are dangerous: Ctrl+Q, Ctrl+Shift+M, Shift+Esc, Alt+F11/F12, Ctrl+Alt+E, Alt+C, Alt+P, Alt+1..9, F11, the F12 family, Ctrl+Shift+J.
     - `setKeyEvent` for Office equivalents that need no context.
     - Then `store()`.
   - **(b) Per-controller key handler.** Register an `XKeyHandler` through `XUserInputInterception.addKeyHandler` on every controller. Use it for:
     - context-dependent keys: Impress Ctrl+D and Ctrl+[ ] when an object is selected, and Ctrl+Y redo-or-repeat;
     - Calc's hard-coded Alt+Enter / Ctrl+Enter swap;
     - forwarding shell keys to Electron: Ctrl+F1, F6, F10/Alt+letter KeyTips, F1, Ctrl+F.
   - **(c) Dispatch interceptor.** Register an `XDispatchProviderInterceptor` on each frame. Route these to the shell: `.uno:Save`, `SaveAs`, `Open`, `OpenFromWriter`/`OpenFromCalc`, `AddDirect`, `NewDoc`, `CloseDoc`, `CloseWin`, `Quit`, `Print`, `HelpIndex`, `OptionsTreeDialog`, `MacroDialog`, `ExtensionManager`, `EditDoc`, `FullScreen`, `NewWindow`.

3. **Ship an "Office (standart)" shortcut profile as the default,** following table E. Also define an optional "Office Türkçe" profile (Ctrl+K/T/Shift+A and so on), but enable it only after someone verifies it on a real Turkish-UI Word/Excel/PowerPoint installation. Microsoft Office was not available for this research.
   - Replace LO's Turkish Calc date/time bindings: Ctrl+Shift+, gives the date and Ctrl+Shift+. gives the time.
   - Avoid Ctrl+Alt bindings on keys that produce AltGr characters on Turkish-Q or Turkish-F, unless the Right-Alt (AltGr) state can be detected.

4. **KeyTips.**
   - Use Microsoft's tab letters (table A). They are the ones Microsoft's own Turkish documentation shows.
   - Use ASCII letters only, never I/İ/ı, and add a build-time uniqueness test.
   - Match on the typed character with Turkish-i normalisation so Turkish-F works.
   - Activate only on Left Alt or F10, never on AltGr.
   - Show Turkish tab names (Giriş, Ekle, Tasarım, Düzen, Başvurular, Gözden Geçir, Görünüm, Sayfa Düzeni, Formüller, Veri, Geçişler, Animasyonlar, Slayt Gösterisi) using Microsoft terminology, not LO's Turkish labels.

5. **Run a one-day spike** with LibreOffice 26.8.0.3 before building the ribbon. Check:
   - that the `XKeyHandler` receives keys in the `createSystemChild`-embedded window, including Calc Alt+Enter in edit mode;
   - bare Alt detection (Win32 low-level hook in the shell vs `SC_KEYMENU`);
   - F6 interception;
   - AltGr+E (€) and AltGr+Q (@) typing on Turkish-Q with LO's default Ctrl+Alt+E;
   - punctuation shortcuts on Turkish-Q and Turkish-F;
   - `.uno:Color` / `.uno:CharBackColor` argument forms.

6. **Hide real gaps rather than showing dead buttons.** For transitions and animations, build our own galleries on the `css::presentation` and `css::animations` properties, keeping the LO sidebar decks as the fallback.

## Facts
- [high] The 25.8.7.3 accelerator table equals the libreoffice-25-8 branch Accelerators.xcu (0 differences for Global, Writer, Calc and Impress, en-US on Windows), which validates the extraction method. (share/registry/main.xcd of a 25.8.7.3 installation; https://github.com/LibreOffice/core/blob/libreoffice-25-8/officecfg/registry/data/org/openoffice/Office/Accelerators.xcu)
- [high] Accelerators.xcu at tag libreoffice-26.8.0.3 is byte-identical to the libreoffice-26-8 branch head. Compared with 25.8: Global Alt+P EditStyle moved to Writer; Writer Ctrl+Shift+R changed from Ruler to InsertReferenceField; Writer F9 became .uno:UpdateFields?UnlockSoftFixed:bool=1; Writer Alt+PgUp/PgDn became GoToPrevPage/GoToNextPage; Impress Shift+F12 is new (DefaultBullet); Ctrl+Alt+E became .uno:ExtensionManager. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/Accelerators.xcu)
- [high] LibreOffice resolves a shortcut from the document accelerator config first, then the module config, then the global config (AcceleratorExecute::impl_ts_findCommand). (https://github.com/LibreOffice/core/blob/libreoffice-26-8/svtools/source/misc/acceleratorexecute.cxx)
- [high] The only Turkish-specific accelerator overrides are in Calc: Ctrl+, = .uno:InsertCurrentDate and Ctrl+Shift+, = .uno:InsertCurrentTime (xml:lang=tr). All other bindings fall back to en-US. (share/registry/res/registry_tr.xcd of a 25.8.7.3 installation; https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/Accelerators.xcu)
- [high] Global LO defaults (26.8): Ctrl+Q=.uno:Quit, Ctrl+W=CloseWin, Ctrl+N=AddDirect, Ctrl+Shift+N=NewDoc (Templates), Ctrl+Shift+M=EditDoc, Shift+Esc=CommandPopup, Alt+C=FontDialog (Windows en-US), Alt+X=UnicodeNotationToggle, Alt+1=Properties deck, Alt+F11=MacroDialog, Alt+F12=OptionsTreeDialog, Shift+F7=SpellOnline, Ctrl+F=findbar, Ctrl+H=SearchDialog, Ctrl+K=HyperlinkDialog, Ctrl+Shift+O=PrintPreview, Ctrl+Alt+C=InsertAnnotation. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/Accelerators.xcu)
- [high] Writer defaults: F12=DefaultNumbering, Shift+F12=DefaultBullet, Ctrl+F12=InsertTable, Ctrl+Shift+F12=RemoveBullets, F4=GraphicDialog, F5=Navigator, Ctrl+1..5=Heading 1..5, Ctrl+0=Text body, Ctrl+D=UnderlineDouble, Ctrl+Shift+D=ParaRightToLeft, Ctrl+Shift+A=ParaLeftToRight, Ctrl+M=ResetAttributes, Ctrl+Shift+E=JumpToFootnoteOrAnchor, Ctrl+]/[=Grow/Shrink, Ctrl+Enter=InsertPagebreak, Ctrl+G=GotoPage, Shift+F3=ChangeCaseRotateCase. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/Accelerators.xcu)
- [high] Calc defaults: F4=ToggleRelative (Shift+F4 unbound), Ctrl+D=FillDown, Ctrl+R=AlignRight, Ctrl+E=AlignHorizontalCenter, Ctrl+L=AlignLeft, Ctrl+Shift+L=DataFilterAutoFilter, Ctrl+1=FormatCellDialog, Alt+Down=DataSelect, F12=Group, Ctrl+F12=Ungroup, F11=Styles, Shift+F11=SaveAsTemplate, Ctrl+G=RepeatSearch, Ctrl+F2=FunctionDialog, Ctrl+Shift+2=NumberFormatScientific, Ctrl+Shift+6=NumberFormatStandard, Ctrl+2=SpacePara2, Ctrl+5=SpacePara15. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/Accelerators.xcu)
- [high] LibreOffice 26.8 Calc help: Alt+Enter fills the selected range with the formula entered on the input line, and Ctrl+Enter inserts a manual line break in a cell. This is the inverse of Excel, where Alt+Enter is a new line in the cell and Ctrl+Enter fills the selection. (https://help.libreoffice.org/latest/en-US/text/scalc/04/01020000.html)
- [high] Impress defaults: F5=Presentation, Shift+F5=PresentationCurrentSlide, Ctrl+M=InsertPage, Ctrl+Shift+G=FormatGroup, Ctrl+Alt+Shift+G=FormatUngroup, Ctrl+G unbound, Ctrl+D unbound, Ctrl++/-=Forward/Backward, Ctrl+Shift++/-=BringToFront/SendToBack, Ctrl+]/[=Grow/Shrink, F4=TransformDialog, Shift+F3=CopyObjects, Alt+Shift+Left/Right/Up/Down=OutlineLeft/Right/Up/Down. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/Accelerators.xcu)
- [high] SfxBaseController implements XUserInputInterception (addKeyHandler). SfxFrameWindow_Impl::PreNotify passes KEYINPUT/KEYUP to the registered key handlers and swallows the event when a handler consumes it, i.e. before the view's accelerator execution (SfxViewShell::KeyInput -> ExecKey_Impl). (https://github.com/LibreOffice/core/blob/libreoffice-26-8/sfx2/source/view/frame2.cxx)
- [high] XKeyHandler.keyPressed/keyReleased: returning TRUE means no other handler is called and the broadcaster takes no further action. (https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1awt_1_1XKeyHandler.html)
- [high] XAcceleratorConfiguration offers getAllKeyEvents, getCommandByKeyEvent, setKeyEvent, removeKeyEvent, getKeyEventsByCommand, removeCommandFromAllKeyEvents and inherits store()/reload() from XUIConfigurationPersistence. XUIConfigurationManager.getShortCutManager() returns it. (https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1ui_1_1XAcceleratorConfiguration.html)
- [high] XDispatchProviderInterception.registerDispatchProviderInterceptor makes an interceptor the first in the chain for all dispatch requests to the frame. (https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1frame_1_1XDispatchProviderInterception.html)
- [high] Slot arguments (26.8 .sdi): CharFontName=SvxFontItem{StyleName, Pitch, CharSet, Family, FamilyName}; FontHeight=SvxFontHeightItem{Height float, Prop, Diff}; Color/CharBackColor/BackgroundColor=SvxColorItem{Color INT32, ComplexColor string}; Writer FontColor=SID_ATTR_CHAR_COLOR2; InsertTable (Writer: TableName, Columns, Rows, Flags, AutoFormat; svx: Columns, Rows); InsertPage/DuplicatePage(PageName, WhatLayout, IsPageBack, IsPageObj, InsertPos); AssignLayout(WhatPage, WhatLayout); Presentation(StartingSlide); Calc InsertContents(Flags, FormulaCommand, SkipEmptyCells, Transpose, AsLink, MoveMode); StyleApply(Template, Family, FamilyName, Style). (https://github.com/LibreOffice/core/blob/libreoffice-26-8/svx/sdi/svx.sdi (also svxitems.sdi, sw/sdi/swriter.sdi, sc/sdi/scalc.sdi, sd/sdi/sdraw.sdi, sfx2/sdi/sfx.sdi))
- [high] Calc paste-special/delete flag letters: A=all, S=strings, V=values, D=date/time, F=formulas, N=notes, T=formats, O=objects (FlagsFromString). An Excel-style 'paste values' is therefore .uno:InsertContents?Flags:string=SVD. (https://github.com/LibreOffice/core/blob/libreoffice-26-8/sc/source/ui/view/cellsh1.cxx)
- [high] The shipped LibreOffice UI uses these argument strings: .uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles, ...&FamilyName:string=CellStyles (Good/Neutral/Bad/Heading 1…), .uno:AssignLayout?WhatLayout:long=N, .uno:ConditionalFormatEasy?FormatRule:short=N. (share/config/soffice.cfg/modules/simpress/menubar/menubar.xml, scalc/ui/notebookbar.ui and swriter/ui/notebookbar_compact.ui of a 25.8.7.3 installation)
- [high] LibreOffice's own Tabbed notebookbar uses .uno:Color (font colour), .uno:CharBackColor (highlight) and .uno:BackgroundColor (paragraph shading) in Writer Home; .uno:BackgroundColor (cell fill), .uno:ToggleMergeCells and .uno:NumberFormatType in Calc Home; .uno:InsertSlide, .uno:DuplicateSlide, .uno:DeleteSlide, .uno:SetDefault and .uno:CellVertTop/Center/Bottom in Impress Home. (share/config/soffice.cfg/modules/swriter/ui/notebookbar.ui, and the scalc and simpress equivalents, of a 25.8.7.3 installation)
- [high] Freeze first row / first column are .uno:FreezePanesRow and .uno:FreezePanesColumn; .uno:FreezePanesFirstRow/FirstColumn do not exist. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/UI/CalcCommands.xcu)
- [high] New in 26.8.0.3 (absent in 25.8.7.3): .uno:InsertCalcTable ('Table...'), .uno:RemoveCalcTable, .uno:InsertFunction, .uno:NewSheetView (Calc); .uno:DraftView, .uno:InsertLandscapePage (Writer); .uno:AddSlideSection/RenameSlideSection/RemoveSlideSection, .uno:CopySlide/PasteSlide (Impress); .uno:ThemeSelectorPanel, .uno:AddTheme, .uno:CommonAlignStart/End, .uno:DiagramToGroup (Generic). The .uno:Translate label entry was removed. (https://github.com/LibreOffice/core/tree/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/UI)
- [high] All UNO commands in the mapping tables marked V exist in the 26.8.0.3 UI command definitions (Generic/Writer/Calc/DrawImpressCommands.xcu). These have no definition and only appear as notebookbar controls: .uno:LeftParaMargin, .uno:RightParaMargin, .uno:AboveSpacing, .uno:BelowSpacing, .uno:ConditionalFormatEasy. These do not exist: PageColor, NotesPane, PresenterConsole, InsertSheetAtEnd, TextColumns, Duplicate. (https://github.com/LibreOffice/core/tree/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/UI)
- [high] Microsoft 365 Current Channel core tabs: Word = Home, Insert, Draw, Design, Layout, References, Mailings, Review, View (+Developer, Help); Excel = Home, Insert, Draw, Page Layout, Formulas, Data, Review, View, Automate; PowerPoint = Home, Insert, Draw, Design, Transitions, Animations, Slide Show, Record, Review, View. Group IDs are listed in the ribbon table. (https://github.com/OfficeDev/office-fluent-ui-command-identifiers/tree/master/Microsoft%20365/Current%20Channel (wordcontrols.xlsx, excelcontrols.xlsx, powerpointcontrols.xlsx))
- [high] Word tab KeyTips: Alt+F File, H Home, N Insert, G Design, P Layout, S References, M Mailings, R Review, W View, L Developer, Q Search. Word shortcuts include F12 Save As, Shift+F12 Save, Ctrl+F12 Open, Ctrl+Alt+1..3 headings, Ctrl+Shift+N Normal, Ctrl+Shift+L bullets, Ctrl+1/2/5 line spacing, Ctrl+Q remove paragraph formatting, Ctrl+D Font dialog, Ctrl+Shift+D double underline, Ctrl+M indent, Ctrl+Alt+M comment, Ctrl+Shift+E track changes, Shift+F7 thesaurus, F4 repeat, F5/Ctrl+G Go To, Ctrl+F2/Ctrl+Alt+I print preview, Ctrl+Shift+8 nonprinting characters, Ctrl+F1 ribbon, F6 panes, F10/Alt KeyTips. (https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-word-95ef89dd-7142-4b50-afb2-f762f663ceb2)
- [high] Excel tab KeyTips: Alt+H Home, N Insert, P Page Layout, M Formulas, A Data, R Review, W View, Q Search. Excel shortcuts: F2 edit, F4 cycle references/repeat, Alt+= AutoSum, Ctrl+; date, Ctrl+Shift+: time, Ctrl+D/Ctrl+R fill, Ctrl+Enter fill selection, Alt+Enter new line, Ctrl+Shift+L filter, Ctrl+1 Format Cells, Shift+F11 new sheet, F11 chart, Ctrl+T/Ctrl+L table, Ctrl+E Flash Fill, Ctrl+5 strikethrough, Ctrl+9/0 hide rows/columns, Ctrl+Shift+~/!/@/#/$/%/^ number formats, Shift+F3 insert function, Shift+F2 note, Ctrl+Alt+V Paste Special. (https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-excel-1798d9d5-842a-42b8-9c99-9b7213f0040f)
- [high] PowerPoint tab KeyTips: Alt+F, H, N, G Design, K Transitions, A Animations, S Slide Show, E Recording, R Review, W View, J,I Draw, Y,2 Help, Q Search. Shortcuts: Ctrl+M new slide, Ctrl+D duplicate, Ctrl+G group, Ctrl+Shift+G ungroup, Ctrl+Shift+J regroup, Ctrl+]/[ bring forward/send backward, Ctrl+Shift+]/[ bring to front/send to back, Ctrl+T Font dialog, Ctrl+Space remove manual formatting, Shift+F3 change case. (https://support.microsoft.com/en-us/office/use-keyboard-shortcuts-to-create-powerpoint-presentations-ebb3d20e-dcd4-444f-a38e-bb5c5ed180f4)
- [high] PowerPoint slide show: F5 from beginning, Shift+F5 from current slide, Alt+F5 Presenter View, B/period black screen, W/comma white screen, Ctrl+L laser, Ctrl+P pen, Esc end. (https://support.microsoft.com/en-us/office/use-keyboard-shortcuts-to-deliver-powerpoint-presentations-1524ffce-bd2a-45f4-9a7f-f18b992b93a0)
- [high] KeyTips mechanics: press Alt to show KeyTips, then one or two letters; Esc steps back; Ctrl+F1 collapses/expands the ribbon; Shift+F10 opens the context menu; F6 moves between regions; Ctrl+Left/Right moves between groups. (https://support.microsoft.com/en-US/Accessibility/windows/use-the-keyboard-to-work-with-the-ribbon)
- [high] Microsoft's tr-TR Word shortcuts page lists the same KeyTips as English (Alt, H for Giriş; Alt, N for Ekle …) and Ctrl+B/I/U, and states the shortcuts assume the US keyboard layout ('ABD klavye düzenine göredir'). (https://support.microsoft.com/tr-tr/office/word-deki-klavye-k%C4%B1sayollar%C4%B1-95ef89dd-7142-4b50-afb2-f762f663ceb2)
- [low] Turkish secondary sources say Turkish-UI Word uses Ctrl+K bold, Ctrl+T italic and Ctrl+Shift+A underline; one source also lists Ctrl+R center and Ctrl+G right align. (https://muhendistan.com/word-kisayol-tuslari/ ; https://zinzinzibidi.com/word_dersleri/temel_duzey/word_kisayollari)
- [medium] A Microsoft Q&A post (Nov 2022) reports that shortcuts in Microsoft's Turkish Excel documentation, such as Alt+=, do not work in Turkish-language Excel (the user needs Ctrl+M) and that no Turkish shortcut list exists. Localized Office builds do use localized shortcuts; for example Danish Word bold was Ctrl+F. (https://learn.microsoft.com/tr-tr/answers/questions/5160638/excel-i-in-t-rk-e-klavye-k-sayollar ; https://learn.microsoft.com/en-us/answers/questions/2101797/keyboard-shortcut-for-bold-suddenly-changed-from-c)
- [medium] Turkish Excel guides give date = Ctrl+Shift+; and time = Ctrl+Shift+:. On Turkish-Q the physical keys are Ctrl+Shift+comma (date) and Ctrl+Shift+period (time). LO with the Turkish UI maps Ctrl+Shift+comma to insert TIME. (https://officedersleri.com/microsoft/excel/tarih-ve-saat-ekleme-kisayoldan-ve-formullu/)
- [high] The Turkish-Q layout (041F041F) produces these AltGr characters: AltGr+1 '>', AltGr+2 '£', AltGr+3 '#', AltGr+4 '$', AltGr+5 '½', AltGr+7 '{', AltGr+8 '[', AltGr+9 ']', AltGr+0 '}', AltGr+Q '@', AltGr+E '€', AltGr+T '₺', AltGr+A 'æ', AltGr+S 'ß', AltGr+I key 'i', AltGr+'-' '|', AltGr+'*' key '\', AltGr+',' dead '`'. ';' is Shift+',', ':' is Shift+'.', '<' is unshifted; the I key types 'ı' and a separate key types 'i'. AltGr+C/M/V produce nothing. (ToUnicodeEx probe on Windows 11)
- [high] LibreOffice disables some Ctrl+Alt accelerators per language because of AltGr collisions (Ctrl+Alt+C for Hungarian, tdf#118269; Ctrl+Alt+E for French, tdf#119676), but not for Turkish, even though Turkish-Q AltGr+E types '€'. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/Accelerators.xcu)
- [medium] Excel M365 added Ctrl+Shift+V to paste values or match destination formatting (Insider blog, Aug 2024). (https://techcommunity.microsoft.com/blog/microsoft365insiderblog/new-paste-options-when-using-keyboard-shortcuts-in-excel/4216723)
- [medium] Word M365 made Ctrl+Shift+V 'Paste Text Only' (rolled out mid-2024 to early 2025) and moved copy/paste formatting to Ctrl+Alt+C / Ctrl+Alt+V. (https://techcommunity.microsoft.com/blog/microsoft365insiderblog/paste-text-only-shortcut-in-word/4218362 ; https://office-watch.com/2026/ctrl-shift-v-microsoft-365-paste-shortcut-changes-explained/)
- [high] LibreOffice's Turkish labels differ from Microsoft terminology: .uno:Italic = 'Eğik' (MS: İtalik), .uno:DataFilterAutoFilter = 'Otomatik Süzgeç' (MS: Filtre), .uno:CustomAnimation = 'Canlandırma' (MS tab: Animasyonlar); .uno:Bold = 'Kalın', .uno:Underline = 'Altı çizili'. (share/registry/res/registry_tr.xcd of a 25.8.7.3 installation)
- [medium] Writer 'In line with text' corresponds to .uno:SetAnchorToChar ('Anchor as Character'). .uno:AccessibilityCheck, .uno:BookView and .uno:FormatDropcap exist. Next/Previous comment commands (.uno:NextAnnotation/.uno:PreviousAnnotation) are defined only for Draw/Impress. (https://github.com/LibreOffice/core/tree/libreoffice-26.8.0.3/officecfg/registry/data/org/openoffice/Office/UI)
- [high] The LibreOffice 26.8 Writer help text says 'F4: Select next frame', but the 26.8 accelerator config binds Writer F4 to .uno:GraphicDialog and Shift+F4 to JumpToNextFrame. Use the config, not the help, as the source of truth. (https://help.libreoffice.org/latest/en-US/text/swriter/04/01020000.html)
