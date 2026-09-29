/**
 * Allow-list of LibreOffice `.uno:` commands the renderer may use, per office module.
 *
 * Every name below exists in the LibreOffice 26.8.0.3 UI command registry
 * (org.openoffice.Office.UI GenericCommands + WriterCommands / CalcCommands / DrawImpressCommands in
 * share/registry/{main,writer,calc}.xcd); tests/unit/renderer/commands.test.ts re-checks this whenever
 * vendor/libreoffice is present. Every command also has a dispatch in a new document of its module
 * (headless probe, see docs/dev/shell-ui.md §4 and §12). Commands that open files, save, quit, run macros
 * or show LibreOffice's own options/about/help are deliberately absent: those flows belong to the shell.
 *
 * - `dispatch` commands may be executed through `engine:dispatch` (and subscribed to).
 * - `status` commands are status-only items (status bar fields) that may only be subscribed to.
 */
import type { OfficeKind } from './modules';

/** Commands used by all three office modules (all defined in GenericCommands). */
const COMMON = [
  // Clipboard
  '.uno:Paste', '.uno:PasteUnformatted', '.uno:Cut', '.uno:Copy', '.uno:FormatPaintbrush',
  // Font
  '.uno:CharFontName', '.uno:FontHeight', '.uno:Grow', '.uno:Shrink', '.uno:Bold', '.uno:Italic', '.uno:Underline',
  '.uno:UnderlineDouble', '.uno:Strikeout', '.uno:Shadowed', '.uno:Color', '.uno:CharBackColor', '.uno:FontDialog',
  '.uno:ChangeCaseToSentenceCase', '.uno:ChangeCaseToLower', '.uno:ChangeCaseToUpper', '.uno:ChangeCaseToTitleCase',
  '.uno:ChangeCaseToToggleCase',
  // Editing and view
  '.uno:Undo', '.uno:Redo', '.uno:SearchDialog', '.uno:SelectAll', '.uno:Zoom', '.uno:Zoom100Percent', '.uno:ZoomPage',
  // Insert
  '.uno:InsertGraphic', '.uno:InsertObjectChart', '.uno:HyperlinkDialog', '.uno:InsertAnnotation', '.uno:FontworkGalleryFloater',
  '.uno:InsertObject', '.uno:InsertSymbol', '.uno:InsertSignatureLine', '.uno:Line',
  '.uno:BasicShapes.rectangle', '.uno:BasicShapes.round-rectangle', '.uno:BasicShapes.ellipse', '.uno:BasicShapes.isosceles-triangle',
  '.uno:BasicShapes.right-triangle', '.uno:BasicShapes.diamond', '.uno:BasicShapes.pentagon', '.uno:BasicShapes.hexagon',
  '.uno:ArrowShapes.right-arrow', '.uno:ArrowShapes.left-right-arrow', '.uno:ArrowShapes.up-arrow', '.uno:StarShapes.star5',
  '.uno:CalloutShapes.round-rectangular-callout', '.uno:CalloutShapes.cloud-callout',
  // Objects
  '.uno:BringToFront', '.uno:SendToBack', '.uno:FormatGroup', '.uno:FormatUngroup', '.uno:ObjectAlignLeft', '.uno:AlignCenter',
  '.uno:ObjectAlignRight', '.uno:AlignUp', '.uno:AlignMiddle', '.uno:AlignDown', '.uno:FlipVertical', '.uno:FlipHorizontal',
  '.uno:TransformDialog', '.uno:FormatArea', '.uno:FormatLine',
  // Review
  '.uno:SpellOnline', '.uno:ThesaurusDialog', '.uno:ShowAnnotations',
] as const;

const WRITER = [
  ...COMMON,
  '.uno:PasteSpecial', '.uno:ResetAttributes', '.uno:SubScript', '.uno:SuperScript', '.uno:BackgroundColor',
  '.uno:DefaultBullet', '.uno:DefaultNumbering', '.uno:DecrementIndent', '.uno:IncrementIndent', '.uno:SortDialog', '.uno:ControlCodes',
  '.uno:LeftPara', '.uno:CenterPara', '.uno:RightPara', '.uno:JustifyPara', '.uno:SpacePara1', '.uno:SpacePara15', '.uno:SpacePara2',
  '.uno:ParaspaceIncrease', '.uno:ParaspaceDecrease', '.uno:ParagraphDialog', '.uno:BorderDialog',
  '.uno:StyleApply', '.uno:DesignerDialog', '.uno:StyleNewByExample', '.uno:StyleUpdateByExample', '.uno:GotoPage',
  // Insert
  '.uno:TitlePageDialog', '.uno:InsertPagebreak', '.uno:InsertLandscapePage', '.uno:InsertTable', '.uno:InsertBookmark',
  '.uno:InsertReferenceField', '.uno:InsertPageHeader', '.uno:InsertPageFooter', '.uno:PageNumberWizard', '.uno:DrawText',
  '.uno:FormatDropcap', '.uno:InsertDateField', '.uno:InsertTimeField', '.uno:InsertField', '.uno:InsertObjectStarMath',
  // Layout
  '.uno:PageDialog', '.uno:FormatColumns', '.uno:InsertBreak', '.uno:InsertColumnBreak', '.uno:LineNumberingDialog', '.uno:Hyphenate',
  '.uno:SetAnchorToChar', '.uno:WrapOff', '.uno:WrapOn', '.uno:WrapIdeal', '.uno:WrapLeft', '.uno:WrapRight', '.uno:WrapThrough',
  '.uno:ObjectForwardOne', '.uno:ObjectBackOne', '.uno:RotateLeft', '.uno:RotateRight',
  // References
  '.uno:InsertMultiIndex', '.uno:UpdateCurIndex', '.uno:UpdateAllIndexes', '.uno:InsertFootnote', '.uno:InsertEndnote',
  '.uno:FootnoteDialog', '.uno:InsertAuthoritiesEntry', '.uno:InsertCaptionDialog', '.uno:InsertIndexesEntry', '.uno:UpdateAll',
  // Review
  '.uno:SpellingAndGrammarDialog', '.uno:WordCountDialog', '.uno:SidebarDeck.A11yCheckDeck', '.uno:ReplyComment', '.uno:DeleteComment',
  '.uno:DeleteAllNotes', '.uno:ResolveComment', '.uno:TrackChanges', '.uno:ShowTrackedChanges', '.uno:AcceptTrackedChanges',
  '.uno:AcceptTrackedChange', '.uno:AcceptTrackedChangeToNext', '.uno:AcceptAllTrackedChanges', '.uno:RejectTrackedChange',
  '.uno:RejectTrackedChangeToNext', '.uno:RejectAllTrackedChanges', '.uno:PreviousTrackedChange', '.uno:NextTrackedChange',
  '.uno:CompareDocuments', '.uno:MergeDocuments', '.uno:ProtectTraceChangeMode',
  // View
  '.uno:PrintLayout', '.uno:BrowseView', '.uno:ShowWhitespace', '.uno:Ruler', '.uno:Navigator', '.uno:ZoomPageWidth',
  '.uno:ZoomOptimal', '.uno:BookView',
  // Table (contextual)
  '.uno:InsertRowsBefore', '.uno:InsertRowsAfter', '.uno:InsertColumnsBefore', '.uno:InsertColumnsAfter', '.uno:DeleteRows',
  '.uno:DeleteColumns', '.uno:DeleteTable', '.uno:EntireRow', '.uno:EntireColumn', '.uno:EntireCell', '.uno:SelectTable',
  '.uno:MergeCells', '.uno:SplitCell', '.uno:SplitTable', '.uno:CellVertTop', '.uno:CellVertCenter', '.uno:CellVertBottom',
  '.uno:SetOptimalRowHeight', '.uno:SetOptimalColumnWidth', '.uno:DistributeRows', '.uno:DistributeColumns', '.uno:TableSort',
  '.uno:TableNumberFormatDialog', '.uno:TableDialog',
  // Picture (contextual)
  '.uno:Crop', '.uno:GraphicDialog', '.uno:CompressGraphic', '.uno:ChangePicture', '.uno:SaveGraphic',
] as const;

const CALC = [
  ...COMMON,
  '.uno:PasteSpecial', '.uno:InsertContents', '.uno:PasteTransposed', '.uno:ResetAttributes', '.uno:BackgroundColor',
  '.uno:FormatCellDialog', '.uno:AlignTop', '.uno:AlignVCenter', '.uno:AlignBottom', '.uno:AlignLeft', '.uno:AlignHorizontalCenter',
  '.uno:AlignRight', '.uno:AlignBlock', '.uno:DecrementIndent', '.uno:IncrementIndent', '.uno:WrapText', '.uno:ToggleMergeCells',
  '.uno:MergeCells', '.uno:SplitCell',
  // Number
  '.uno:NumberFormatStandard', '.uno:NumberFormatDecimal', '.uno:NumberFormatCurrency', '.uno:NumberFormatPercent',
  '.uno:NumberFormatDate', '.uno:NumberFormatTime', '.uno:NumberFormatScientific', '.uno:NumberFormatThousands',
  '.uno:NumberFormatIncDecimals', '.uno:NumberFormatDecDecimals', '.uno:NumberFormatType',
  // Styles
  '.uno:ConditionalFormatDialog', '.uno:ColorScaleFormatDialog', '.uno:DataBarFormatDialog', '.uno:IconSetFormatDialog',
  '.uno:ConditionalFormatManagerDialog', '.uno:InsertCalcTable', '.uno:AutoFormat', '.uno:StyleApply',
  // Cells
  '.uno:InsertCell', '.uno:InsertRowsBefore', '.uno:InsertRowsAfter', '.uno:InsertColumnsBefore', '.uno:InsertColumnsAfter',
  '.uno:Insert', '.uno:DeleteCell', '.uno:DeleteRows', '.uno:DeleteColumns', '.uno:Remove', '.uno:RowHeight', '.uno:SetOptimalRowHeight',
  '.uno:ColumnWidth', '.uno:SetOptimalColumnWidth', '.uno:HideRow', '.uno:ShowRow', '.uno:HideColumn', '.uno:ShowColumn',
  '.uno:RenameTable', '.uno:Move', '.uno:SetTabBgColor', '.uno:Protect',
  // Editing
  '.uno:AutoSum', '.uno:FillDown', '.uno:FillRight', '.uno:FillUp', '.uno:FillLeft', '.uno:FillSeries', '.uno:Delete',
  '.uno:ClearContents', '.uno:SortAscending', '.uno:SortDescending', '.uno:DataSort', '.uno:DataFilterAutoFilter',
  '.uno:DataFilterRemoveFilter',
  // Insert
  '.uno:DataDataPilotRun', '.uno:InsertSparkline', '.uno:DrawText', '.uno:EditHeaderAndFooter', '.uno:InsertObjectStarMath',
  '.uno:InsertCurrentDate', '.uno:InsertCurrentTime',
  // Page layout
  '.uno:PageFormatDialog', '.uno:DefinePrintArea', '.uno:AddPrintArea', '.uno:DeletePrintArea', '.uno:EditPrintArea',
  '.uno:InsertRowBreak', '.uno:InsertColumnBreak', '.uno:DeleteRowbreak', '.uno:DeleteColumnbreak', '.uno:DeleteAllBreaks',
  '.uno:ToggleSheetGrid', '.uno:ViewRowColumnHeaders', '.uno:ObjectForwardOne', '.uno:ObjectBackOne',
  // Formulas
  '.uno:FunctionDialog', '.uno:DefineName', '.uno:AddName', '.uno:InsertName', '.uno:CreateNames', '.uno:ShowPrecedents',
  '.uno:ShowDependents', '.uno:ClearArrows', '.uno:ClearArrowPrecedents', '.uno:ClearArrowDependents', '.uno:ToggleFormula',
  '.uno:ShowErrors', '.uno:AutomaticCalculation', '.uno:Calculate', '.uno:CalculateHard',
  // Data
  '.uno:InsertExternalDataSource', '.uno:DataAreaRefresh', '.uno:DataFilterStandardFilter', '.uno:DataFilterSpecialFilter',
  '.uno:TextToColumns', '.uno:HandleDuplicateRecords', '.uno:Validation', '.uno:DataConsolidate', '.uno:ScenarioManager',
  '.uno:GoalSeekDialog', '.uno:TableOperationDialog', '.uno:SolverDialog', '.uno:Group', '.uno:Ungroup', '.uno:DataSubTotals',
  '.uno:ShowDetail', '.uno:HideDetail',
  // Review
  '.uno:SpellDialog', '.uno:EditAnnotation', '.uno:DeleteNote', '.uno:ShowNote', '.uno:HideNote', '.uno:ShowAllNotes',
  '.uno:HideAllNotes', '.uno:DeleteAllNotes', '.uno:ToolProtectionDocument', '.uno:TraceChangeMode', '.uno:AcceptChanges',
  // View
  '.uno:NormalViewMode', '.uno:PagebreakMode', '.uno:ZoomOptimal', '.uno:FreezePanes', '.uno:FreezePanesRow',
  '.uno:FreezePanesColumn', '.uno:SplitWindow', '.uno:InputLineVisible',
  // Picture (contextual)
  '.uno:Crop', '.uno:CompressGraphic', '.uno:ChangePicture', '.uno:SaveGraphic',
] as const;

const IMPRESS = [
  ...COMMON,
  '.uno:PasteSpecial', '.uno:SetDefault', '.uno:ChangeCaseRotateCase',
  '.uno:DefaultBullet', '.uno:DefaultNumbering', '.uno:OutlineLeft', '.uno:OutlineRight', '.uno:LeftPara', '.uno:CenterPara',
  '.uno:RightPara', '.uno:JustifyPara', '.uno:SpacePara1', '.uno:SpacePara15', '.uno:SpacePara2', '.uno:ParagraphDialog',
  '.uno:CellVertTop', '.uno:CellVertCenter', '.uno:CellVertBottom', '.uno:Text', '.uno:Forward', '.uno:Backward',
  '.uno:DistributeSelection', '.uno:FillColor', '.uno:XLineColor',
  // Slides
  '.uno:InsertPage', '.uno:DuplicatePage', '.uno:DeletePage', '.uno:ImportFromFile', '.uno:AssignLayout',
  // Insert
  '.uno:InsertTable', '.uno:PhotoAlbumDialog', '.uno:AnimationEffects', '.uno:HeaderAndFooter', '.uno:InsertDateFieldFix',
  '.uno:InsertDateFieldVar', '.uno:InsertTimeFieldFix', '.uno:InsertTimeFieldVar', '.uno:InsertPageField', '.uno:InsertPagesField',
  '.uno:InsertMath', '.uno:InsertAVMedia',
  // Design, transitions, animations
  '.uno:ThemeDialog', '.uno:PageSetup', '.uno:SelectBackground', '.uno:SlideChangeWindow', '.uno:CustomAnimation',
  // Slide show
  '.uno:Presentation', '.uno:PresentationCurrentSlide', '.uno:CustomShowDialog', '.uno:PresentationDialog', '.uno:HideSlide',
  '.uno:ShowSlide', '.uno:RehearseTimings',
  // Review
  '.uno:SpellDialog', '.uno:DeleteAnnotation', '.uno:DeleteAllAnnotation', '.uno:PreviousAnnotation', '.uno:NextAnnotation',
  // View
  '.uno:NormalMultiPaneGUI', '.uno:OutlineMode', '.uno:DiaMode', '.uno:NotesMode', '.uno:SlideMasterPage', '.uno:HandoutMode',
  '.uno:NotesMasterPage', '.uno:CloseMasterView', '.uno:ShowRuler', '.uno:GridVisible', '.uno:HelplinesVisible',
  '.uno:OutputQualityColor', '.uno:OutputQualityGrayscale', '.uno:OutputQualityBlackWhite',
  // Table and picture (contextual)
  '.uno:InsertRowsBefore', '.uno:InsertRowsAfter', '.uno:InsertColumnsBefore', '.uno:InsertColumnsAfter', '.uno:DeleteRows',
  '.uno:DeleteColumns', '.uno:DeleteTable', '.uno:SelectTable', '.uno:EntireRow', '.uno:EntireColumn', '.uno:MergeCells',
  '.uno:SplitCell', '.uno:TableDialog', '.uno:Crop', '.uno:CompressGraphic', '.uno:ChangePicture', '.uno:SaveGraphic',
] as const;

/** Status bar items that may be subscribed to but never dispatched. */
const STATUS: Record<OfficeKind, readonly string[]> = {
  writer: ['.uno:StatePageNumber', '.uno:LanguageStatus', '.uno:ModifiedStatus', '.uno:PageStyleName'],
  calc: ['.uno:StateTableCell', '.uno:StatusDocPos', '.uno:LanguageStatus', '.uno:ModifiedStatus', '.uno:StatusPageStyle'],
  impress: ['.uno:PageStatus', '.uno:LayoutStatus', '.uno:LanguageStatus', '.uno:ModifiedStatus'],
};

export const UNO_COMMANDS: Record<OfficeKind, ReadonlySet<string>> = {
  writer: new Set(WRITER),
  calc: new Set(CALC),
  impress: new Set(IMPRESS),
};

export const UNO_STATUS_COMMANDS: Record<OfficeKind, ReadonlySet<string>> = {
  writer: new Set(STATUS.writer),
  calc: new Set(STATUS.calc),
  impress: new Set(STATUS.impress),
};

/** `.uno:StyleApply?Style:string=Heading 1` → `.uno:StyleApply`. Dotted names such as `.uno:BasicShapes.rectangle` stay intact. */
export function unoBaseCommand(command: string): string {
  const q = command.indexOf('?');
  return (q >= 0 ? command.slice(0, q) : command).trim();
}

/** True when the renderer may execute `command` (arguments are matched by the base name) in a document of `kind`. */
export function isAllowedUnoCommand(kind: OfficeKind, command: string): boolean {
  return UNO_COMMANDS[kind]?.has(unoBaseCommand(command)) ?? false;
}

/** True when the renderer may subscribe to the state of `command` (dispatchable commands and status items). */
export function isSubscribableUnoCommand(kind: OfficeKind, command: string): boolean {
  const base = unoBaseCommand(command);
  return isAllowedUnoCommand(kind, base) || (UNO_STATUS_COMMANDS[kind]?.has(base) ?? false);
}

/**
 * Type of one dispatch argument: a plain JSON string/number, a typed UNO value (`{ type, value }`, see
 * engine-protocol.ts UnoArg) or one of a fixed set of strings.
 */
export type UnoArgSpec = 'string' | 'number' | 'float' | 'short' | 'long' | { oneOf: readonly string[] };

/**
 * Dispatch arguments the shell may send, per command: exactly what the ribbons and the status bar use
 * (tests/unit/renderer/dispatch-args.test.ts checks every ribbon action against this list). Every other
 * command is dispatched without arguments, so commands that load files or URLs (.uno:InsertGraphic,
 * .uno:InsertExternalDataSource, .uno:ImportFromFile, .uno:CompareDocuments, .uno:MergeDocuments,
 * .uno:InsertAVMedia ...) always show LibreOffice's own dialog: the user picks the file.
 */
export const UNO_COMMAND_ARGS: Readonly<Record<string, Readonly<Record<string, UnoArgSpec>>>> = {
  '.uno:CharFontName': { 'CharFontName.FamilyName': 'string' },
  '.uno:FontHeight': { 'FontHeight.Height': 'float' },
  '.uno:StyleApply': { Style: 'string', FamilyName: { oneOf: ['ParagraphStyles', 'CellStyles'] } },
  '.uno:Color': { Color: 'long' },
  '.uno:CharBackColor': { CharBackColor: 'long' },
  '.uno:BackgroundColor': { BackgroundColor: 'long' },
  '.uno:FillColor': { FillColor: 'long' },
  '.uno:XLineColor': { XLineColor: 'long' },
  '.uno:InsertTable': { Columns: 'short', Rows: 'short' },
  // Paste Special > Values only (Calc): content flags, e.g. 'SVD'.
  '.uno:InsertContents': { Flags: 'string' },
  '.uno:AssignLayout': { WhatLayout: 'number' },
  // Status bar zoom (src/renderer/services/zoom.ts).
  '.uno:Zoom': { 'Zoom.Value': 'number' },
};

function argMatches(spec: UnoArgSpec, value: unknown): boolean {
  if (typeof spec === 'object') return typeof value === 'string' && spec.oneOf.includes(value);
  if (spec === 'string') return typeof value === 'string';
  if (spec === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const typed = value as { type?: unknown; value?: unknown };
  return typed.type === spec && typeof typed.value === 'number' && Number.isFinite(typed.value);
}

/**
 * True when `args` may be sent with `command` (in addition to isAllowedUnoCommand): no arguments at all, or only
 * names and value types listed in UNO_COMMAND_ARGS. URL-style arguments (`.uno:X?Name:string=…`) are never
 * accepted.
 */
export function isAllowedUnoArgs(command: string, args: Readonly<Record<string, unknown>> | undefined): boolean {
  if (command.includes('?')) return false;
  const names = args ? Object.keys(args) : [];
  if (names.length === 0) return true;
  const spec = Object.hasOwn(UNO_COMMAND_ARGS, command) ? UNO_COMMAND_ARGS[command] : undefined;
  if (!spec) return false;
  return names.every((name) => {
    const s = Object.hasOwn(spec, name) ? spec[name] : undefined;
    return s !== undefined && argMatches(s, args?.[name]);
  });
}
