/** Spreadsheets (Calc) ribbon: Home, Insert, Page Layout, Formulas, Data, Review, View + contextual Picture/Shape tabs. */
import {
  IconAlignBoxBottomCenter,
  IconAlignBoxCenterMiddle,
  IconAlignBoxTopCenter,
  IconAlignJustified,
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconArrowsJoin,
  IconArrowDown,
  IconCalculator,
  IconCalendar,
  IconChartArrows,
  IconChartLine,
  IconCheckbox,
  IconClearAll,
  IconClock,
  IconColumns,
  IconCopy,
  IconCrop,
  IconCurrencyLira,
  IconDatabaseImport,
  IconDecimal,
  IconDeviceFloppy,
  IconEraser,
  IconEye,
  IconFileSettings,
  IconFilter,
  IconFilterOff,
  IconFunction,
  IconGridDots,
  IconIndentDecrease,
  IconIndentIncrease,
  IconLayoutColumns,
  IconLayoutNavbar,
  IconLayoutRows,
  IconListDetails,
  IconMathFunction,
  IconMessageX,
  IconMessages,
  IconMinus,
  IconPageBreak,
  IconPercentage,
  IconPhotoEdit,
  IconPhotoMinus,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSeparator,
  IconShieldLock,
  IconSortAscending,
  IconSortDescending,
  IconStackPop,
  IconStackPush,
  IconSum,
  IconTable,
  IconTableOptions,
  IconTag,
  IconTextSpellcheck,
  IconTextWrap,
  IconTimeline,
  IconTransform,
  IconEdit,
  IconChecks,
  IconSitemap,
  IconX,
  IconZoomIn,
  IconTextSize,
  IconPaint,
  IconLineHeight,
  IconTableShortcut,
  IconChevronsDown,
  IconChevronsUp,
  IconLock,
} from '@tabler/icons-react';
import type { ComboControl, ModuleRibbon, RibbonGroup, RibbonTab } from '../../ribbon/types';
import { unoNumber } from '../../services/unoValues';
import {
  alignObjectsMenu,
  autoSpell,
  bold,
  bringToFront,
  button,
  checkItem,
  clipboardControls,
  fillColor,
  findReplace,
  flipMenu,
  fontColor,
  fontNameCombo,
  fontSizeCombo,
  groupMenu,
  growFont,
  insertChart,
  insertComment,
  insertFontwork,
  insertLink,
  insertObject,
  insertPicture,
  insertSignature,
  insertSymbol,
  italic,
  item,
  menu,
  positionAndSize,
  sendToBack,
  shapesMenu,
  shrinkFont,
  split,
  styleAction,
  thesaurus,
  toggle,
  underlineSplit,
  uno,
} from '../common/controls';
import { formulaBarToggle } from './FormulaBarToggle';

/** Number format box: option value → command; state `.uno:NumberFormatType` (css::util::NumberFormat bits). */
const NUMBER_FORMATS: { value: string; labelKey: string; command: string }[] = [
  { value: 'standard', labelKey: 'calc.numfmt.standard', command: '.uno:NumberFormatStandard' },
  { value: 'number', labelKey: 'calc.numfmt.number', command: '.uno:NumberFormatDecimal' },
  { value: 'currency', labelKey: 'calc.numfmt.currency', command: '.uno:NumberFormatCurrency' },
  { value: 'percent', labelKey: 'calc.numfmt.percent', command: '.uno:NumberFormatPercent' },
  { value: 'date', labelKey: 'calc.numfmt.date', command: '.uno:NumberFormatDate' },
  { value: 'time', labelKey: 'calc.numfmt.time', command: '.uno:NumberFormatTime' },
  { value: 'scientific', labelKey: 'calc.numfmt.scientific', command: '.uno:NumberFormatScientific' },
];

export function numberFormatFromType(type: number | null): string {
  if (type === null) return 'standard';
  const t = type & ~1; // drop DEFINED
  if (t === 16) return 'number';
  if (t === 8) return 'currency';
  if (t === 128) return 'percent';
  if (t === 2 || t === 6) return 'date';
  if (t === 4) return 'time';
  if (t === 32) return 'scientific';
  return 'standard';
}

const numberFormatCombo: ComboControl = {
  type: 'combo',
  id: 'numberFormat',
  labelKey: 'calc.cmd.numberFormat',
  tipKey: 'calc.tip.numberFormat',
  keytip: 'N',
  width: 13,
  editable: false,
  options: NUMBER_FORMATS.map((f) => ({ value: f.value, labelKey: f.labelKey })),
  state: { command: '.uno:NumberFormatType', display: (v) => numberFormatFromType(unoNumber(v)) },
  toAction: (value) => uno(NUMBER_FORMATS.find((f) => f.value === value)?.command ?? '.uno:NumberFormatStandard'),
};

const CELL_STYLES: { id: string; key: string; preview: Record<string, string | number> }[] = [
  { id: 'Default', key: 'calc.cellStyle.default', preview: {} },
  { id: 'Good', key: 'calc.cellStyle.good', preview: { background: '#ccffcc', color: '#006600' } },
  { id: 'Neutral', key: 'calc.cellStyle.neutral', preview: { background: '#ffffcc', color: '#996600' } },
  { id: 'Bad', key: 'calc.cellStyle.bad', preview: { background: '#ffcccc', color: '#cc0000' } },
  { id: 'Heading 1', key: 'calc.cellStyle.heading1', preview: { fontWeight: 700, fontSize: 14 } },
  { id: 'Heading 2', key: 'calc.cellStyle.heading2', preview: { fontWeight: 700, fontStyle: 'italic' } },
  { id: 'Note', key: 'calc.cellStyle.note', preview: { background: '#ffffc0', border: '1px solid #808080' } },
  { id: 'Warning', key: 'calc.cellStyle.warning', preview: { color: '#cc0000' } },
  { id: 'Accent', key: 'calc.cellStyle.accent', preview: { fontWeight: 700 } },
];

const forwardOne = (keytip: string) => button('forwardOne', 'common.cmd.bringForward', uno('.uno:ObjectForwardOne'), { icon: IconStackPush, keytip });
const backOne = (keytip: string) => button('backOne', 'common.cmd.sendBackward', uno('.uno:ObjectBackOne'), { icon: IconStackPop, keytip });

// ------------------------------------------------------------------ Home

const home: RibbonTab = {
  id: 'home',
  labelKey: 'common.tab.home',
  keytip: 'H',
  groups: [
    {
      id: 'clipboard',
      labelKey: 'common.group.clipboard',
      controls: clipboardControls([
        item('paste.values', 'calc.cmd.pasteValues', uno('.uno:InsertContents', { Flags: 'SVD' }), { separatorBefore: true }),
        item('paste.transposed', 'calc.cmd.pasteTransposed', uno('.uno:PasteTransposed')),
      ]),
    },
    {
      id: 'font',
      labelKey: 'common.group.font',
      layout: 'rows',
      launcher: uno('.uno:FormatCellDialog'),
      launcherLabelKey: 'calc.cmd.formatCells',
      controls: [
        fontNameCombo(),
        fontSizeCombo(),
        growFont(),
        shrinkFont(),
        bold(),
        italic(),
        underlineSplit(),
        fillColor('fillColor', 'calc.cmd.fillColor', '.uno:BackgroundColor', 'H', 'calc.tip.fillColor'),
        fontColor(),
      ],
    },
    {
      id: 'alignment',
      labelKey: 'common.group.alignment',
      layout: 'rows',
      launcher: uno('.uno:FormatCellDialog'),
      launcherLabelKey: 'calc.cmd.formatCells',
      controls: [
        toggle('alignTop', 'calc.cmd.alignTop', '.uno:AlignTop', { icon: IconAlignBoxTopCenter, keytip: 'AT' }),
        toggle('alignMiddle', 'calc.cmd.alignMiddle', '.uno:AlignVCenter', { icon: IconAlignBoxCenterMiddle, keytip: 'AM' }),
        toggle('alignBottom', 'calc.cmd.alignBottom', '.uno:AlignBottom', { icon: IconAlignBoxBottomCenter, keytip: 'AB' }),
        toggle('wrapText', 'calc.cmd.wrapText', '.uno:WrapText', { icon: IconTextWrap, keytip: 'W', tipKey: 'calc.tip.wrapText' }),
        toggle('alignLeft', 'common.cmd.alignLeft', '.uno:AlignLeft', { icon: IconAlignLeft, keytip: 'AL', newRow: true }),
        toggle('alignCenter', 'common.cmd.alignCenter', '.uno:AlignHorizontalCenter', { icon: IconAlignCenter, keytip: 'AC' }),
        toggle('alignRight', 'common.cmd.alignRight', '.uno:AlignRight', { icon: IconAlignRight, keytip: 'AR' }),
        toggle('alignJustify', 'common.cmd.justify', '.uno:AlignBlock', { icon: IconAlignJustified, keytip: 'AJ' }),
        button('decreaseIndent', 'common.cmd.decreaseIndent', uno('.uno:DecrementIndent'), { icon: IconIndentDecrease, keytip: '5' }),
        button('increaseIndent', 'common.cmd.increaseIndent', uno('.uno:IncrementIndent'), { icon: IconIndentIncrease, keytip: '6' }),
        split('mergeCenter', 'calc.cmd.mergeCenter', uno('.uno:ToggleMergeCells'), [
          checkItem('merge.toggle', 'calc.cmd.mergeCenter', '.uno:ToggleMergeCells'),
          item('merge.cells', 'common.cmd.mergeCells', uno('.uno:MergeCells')),
          item('merge.unmerge', 'calc.cmd.unmerge', uno('.uno:SplitCell')),
        ], { icon: IconArrowsJoin, keytip: 'M', state: { command: '.uno:ToggleMergeCells' }, tipKey: 'calc.tip.mergeCenter' }),
      ],
    },
    {
      id: 'number',
      labelKey: 'calc.group.number',
      layout: 'rows',
      launcher: uno('.uno:FormatCellDialog'),
      launcherLabelKey: 'calc.cmd.formatCells',
      controls: [
        numberFormatCombo,
        toggle('currency', 'calc.cmd.currency', '.uno:NumberFormatCurrency', { icon: IconCurrencyLira, keytip: 'AN', newRow: true }),
        toggle('percent', 'calc.cmd.percent', '.uno:NumberFormatPercent', { icon: IconPercentage, keytip: 'P', shortcut: 'Ctrl+Shift+5' }),
        toggle('thousands', 'calc.cmd.thousands', '.uno:NumberFormatThousands', { icon: IconSeparator, keytip: 'K' }),
        button('incDecimals', 'calc.cmd.incDecimals', uno('.uno:NumberFormatIncDecimals'), { icon: IconDecimal, keytip: '0' }),
        button('decDecimals', 'calc.cmd.decDecimals', uno('.uno:NumberFormatDecDecimals'), { icon: IconMinus, keytip: '9' }),
      ],
    },
    {
      id: 'styles',
      labelKey: 'common.group.styles',
      controls: [
        menu('conditional', 'calc.cmd.conditionalFormatting', [
          item('cond.condition', 'calc.cmd.condCondition', uno('.uno:ConditionalFormatDialog')),
          item('cond.colorScale', 'calc.cmd.condColorScale', uno('.uno:ColorScaleFormatDialog')),
          item('cond.dataBar', 'calc.cmd.condDataBar', uno('.uno:DataBarFormatDialog')),
          item('cond.iconSet', 'calc.cmd.condIconSet', uno('.uno:IconSetFormatDialog')),
          item('cond.manage', 'calc.cmd.condManage', uno('.uno:ConditionalFormatManagerDialog'), { separatorBefore: true }),
        ], { size: 'large', icon: IconChartArrows, keytip: 'L', tipKey: 'calc.tip.conditionalFormatting' }),
        split('formatAsTable', 'calc.cmd.formatAsTable', uno('.uno:InsertCalcTable'), [
          item('table.insert', 'calc.cmd.formatAsTable', uno('.uno:InsertCalcTable')),
          item('table.autoFormat', 'calc.cmd.autoFormat', uno('.uno:AutoFormat')),
        ], { size: 'large', icon: IconTable, keytip: 'T', shortcut: 'Ctrl+T' }),
        {
          type: 'gallery',
          id: 'cellStyles',
          labelKey: 'calc.cmd.cellStyles',
          icon: IconPaint,
          keytip: 'J',
          inlineCount: 3,
          items: CELL_STYLES.map((s) => ({ id: s.id, labelKey: s.key, action: styleAction(s.id, 'CellStyles'), previewStyle: s.preview })),
        },
      ],
    },
    {
      id: 'cells',
      labelKey: 'calc.group.cells',
      controls: [
        menu('insertCells', 'calc.cmd.insert', [
          item('ins.cells', 'calc.cmd.insertCells', uno('.uno:InsertCell')),
          item('ins.rowsAbove', 'calc.cmd.insertRowsAbove', uno('.uno:InsertRowsBefore')),
          item('ins.rowsBelow', 'calc.cmd.insertRowsBelow', uno('.uno:InsertRowsAfter')),
          item('ins.colsBefore', 'calc.cmd.insertColumnsBefore', uno('.uno:InsertColumnsBefore')),
          item('ins.colsAfter', 'calc.cmd.insertColumnsAfter', uno('.uno:InsertColumnsAfter')),
          item('ins.sheet', 'calc.cmd.insertSheet', uno('.uno:Insert'), { separatorBefore: true }),
        ], { size: 'large', icon: IconPlus, keytip: 'Y' }),
        menu('deleteCells', 'common.cmd.delete', [
          item('del.cells', 'calc.cmd.deleteCells', uno('.uno:DeleteCell'), { shortcut: 'Ctrl+-' }),
          item('del.rows', 'common.cmd.deleteRows', uno('.uno:DeleteRows')),
          item('del.columns', 'common.cmd.deleteColumns', uno('.uno:DeleteColumns')),
          item('del.sheet', 'calc.cmd.deleteSheet', uno('.uno:Remove'), { separatorBefore: true }),
        ], { size: 'large', icon: IconMinus, keytip: 'D' }),
        menu('formatCells', 'calc.cmd.format', [
          item('fmt.rowHeight', 'calc.cmd.rowHeight', uno('.uno:RowHeight')),
          item('fmt.optimalRow', 'common.cmd.optimalRowHeight', uno('.uno:SetOptimalRowHeight'), { icon: IconArrowAutofitHeight }),
          item('fmt.columnWidth', 'calc.cmd.columnWidth', uno('.uno:ColumnWidth')),
          item('fmt.optimalColumn', 'common.cmd.optimalColumnWidth', uno('.uno:SetOptimalColumnWidth'), { icon: IconArrowAutofitWidth }),
          item('fmt.hideRows', 'calc.cmd.hideRows', uno('.uno:HideRow'), { separatorBefore: true }),
          item('fmt.showRows', 'calc.cmd.showRows', uno('.uno:ShowRow')),
          item('fmt.hideColumns', 'calc.cmd.hideColumns', uno('.uno:HideColumn')),
          item('fmt.showColumns', 'calc.cmd.showColumns', uno('.uno:ShowColumn')),
          item('fmt.renameSheet', 'calc.cmd.renameSheet', uno('.uno:RenameTable'), { separatorBefore: true }),
          item('fmt.moveSheet', 'calc.cmd.moveSheet', uno('.uno:Move')),
          item('fmt.tabColor', 'calc.cmd.tabColor', uno('.uno:SetTabBgColor')),
          item('fmt.protect', 'calc.cmd.protectSheet', uno('.uno:Protect'), { separatorBefore: true }),
          item('fmt.cells', 'calc.cmd.formatCells', uno('.uno:FormatCellDialog'), { shortcut: 'Ctrl+1' }),
        ], { size: 'large', icon: IconTableOptions, keytip: 'O' }),
      ],
    },
    {
      id: 'editing',
      labelKey: 'common.group.editing',
      controls: [
        button('autoSum', 'calc.cmd.autoSum', uno('.uno:AutoSum'), { icon: IconSum, keytip: 'U', shortcut: 'Alt+=', tipKey: 'calc.tip.autoSum' }),
        menu('fill', 'calc.cmd.fill', [
          item('fill.down', 'calc.cmd.fillDown', uno('.uno:FillDown'), { shortcut: 'Ctrl+D' }),
          item('fill.right', 'calc.cmd.fillRight', uno('.uno:FillRight')),
          item('fill.up', 'calc.cmd.fillUp', uno('.uno:FillUp')),
          item('fill.left', 'calc.cmd.fillLeft', uno('.uno:FillLeft')),
          item('fill.series', 'calc.cmd.fillSeries', uno('.uno:FillSeries'), { separatorBefore: true }),
        ], { icon: IconArrowDown, keytip: 'FL' }),
        menu('clear', 'calc.cmd.clear', [
          item('clear.contents', 'calc.cmd.clearContents', uno('.uno:Delete'), { icon: IconEraser, shortcut: 'Delete' }),
          item('clear.formats', 'calc.cmd.clearFormats', uno('.uno:ResetAttributes')),
          item('clear.dialog', 'calc.cmd.clearDialog', uno('.uno:ClearContents'), { shortcut: 'Backspace' }),
        ], { icon: IconClearAll, keytip: 'E' }),
        menu('sortFilter', 'calc.cmd.sortFilter', [
          item('sort.asc', 'calc.cmd.sortAscending', uno('.uno:SortAscending'), { icon: IconSortAscending }),
          item('sort.desc', 'calc.cmd.sortDescending', uno('.uno:SortDescending'), { icon: IconSortDescending }),
          item('sort.custom', 'calc.cmd.customSort', uno('.uno:DataSort')),
          checkItem('filter.auto', 'calc.cmd.filter', '.uno:DataFilterAutoFilter', { icon: IconFilter, separatorBefore: true, shortcut: 'Ctrl+Shift+L' }),
          item('filter.clear', 'calc.cmd.clearFilter', uno('.uno:DataFilterRemoveFilter'), { icon: IconFilterOff }),
        ], { size: 'large', icon: IconSortAscending, keytip: 'S' }),
        findReplace('FD'),
      ],
    },
  ],
};

// ------------------------------------------------------------------ Insert

const insert: RibbonTab = {
  id: 'insert',
  labelKey: 'common.tab.insert',
  keytip: 'N',
  groups: [
    {
      id: 'tables',
      labelKey: 'common.group.tables',
      controls: [
        button('pivotTable', 'calc.cmd.pivotTable', uno('.uno:DataDataPilotRun'), { size: 'large', icon: IconTableShortcut, keytip: 'V', tipKey: 'calc.tip.pivotTable' }),
        button('insertTable', 'calc.cmd.table', uno('.uno:InsertCalcTable'), { size: 'large', icon: IconTable, keytip: 'T', shortcut: 'Ctrl+T' }),
      ],
    },
    { id: 'illustrations', labelKey: 'common.group.illustrations', controls: [insertPicture('P'), shapesMenu('SH')] },
    {
      id: 'charts',
      labelKey: 'calc.group.charts',
      controls: [insertChart('C'), button('sparkline', 'calc.cmd.sparkline', uno('.uno:InsertSparkline'), { icon: IconChartLine, keytip: 'SL' })],
    },
    { id: 'links', labelKey: 'common.group.links', controls: [insertLink('K')] },
    { id: 'comments', labelKey: 'common.group.comments', controls: [insertComment('M')] },
    {
      id: 'text',
      labelKey: 'common.group.text',
      controls: [
        button('textBox', 'common.cmd.textBox', uno('.uno:DrawText'), { size: 'large', icon: IconTextSize, keytip: 'X' }),
        button('headerFooter', 'calc.cmd.headerFooter', uno('.uno:EditHeaderAndFooter'), { icon: IconLayoutNavbar, keytip: 'H' }),
        insertFontwork('W'),
        insertSignature('G'),
        insertObject('J'),
        button('insertDate', 'calc.cmd.insertDate', uno('.uno:InsertCurrentDate'), { icon: IconCalendar, keytip: 'D', shortcut: 'Ctrl+;' }),
        button('insertTime', 'calc.cmd.insertTime', uno('.uno:InsertCurrentTime'), { icon: IconClock, keytip: 'Q', shortcut: 'Ctrl+Shift+:' }),
      ],
    },
    {
      id: 'symbols',
      labelKey: 'common.group.symbols',
      controls: [button('equation', 'common.cmd.equation', uno('.uno:InsertObjectStarMath'), { size: 'large', icon: IconMathFunction, keytip: 'E' }), insertSymbol('U')],
    },
  ],
};

// ------------------------------------------------------------------ Page Layout

const pageLayout: RibbonTab = {
  id: 'pageLayout',
  labelKey: 'calc.tab.pageLayout',
  keytip: 'P',
  groups: [
    {
      id: 'pageSetup',
      labelKey: 'calc.group.pageSetup',
      launcher: uno('.uno:PageFormatDialog'),
      launcherLabelKey: 'calc.cmd.pageSetup',
      controls: [
        button('pageSetup', 'calc.cmd.pageSetup', uno('.uno:PageFormatDialog'), { size: 'large', icon: IconFileSettings, keytip: 'M', tipKey: 'calc.tip.pageSetup' }),
        menu('printArea', 'calc.cmd.printArea', [
          item('pa.define', 'calc.cmd.printAreaDefine', uno('.uno:DefinePrintArea')),
          item('pa.add', 'calc.cmd.printAreaAdd', uno('.uno:AddPrintArea')),
          item('pa.clear', 'calc.cmd.printAreaClear', uno('.uno:DeletePrintArea')),
          item('pa.edit', 'calc.cmd.printTitles', uno('.uno:EditPrintArea'), { separatorBefore: true }),
        ], { size: 'large', icon: IconPrinter, keytip: 'R' }),
        menu('breaks', 'calc.cmd.breaks', [
          item('br.row', 'calc.cmd.insertRowBreak', uno('.uno:InsertRowBreak')),
          item('br.col', 'calc.cmd.insertColumnBreak', uno('.uno:InsertColumnBreak')),
          item('br.delRow', 'calc.cmd.deleteRowBreak', uno('.uno:DeleteRowbreak'), { separatorBefore: true }),
          item('br.delCol', 'calc.cmd.deleteColumnBreak', uno('.uno:DeleteColumnbreak')),
          item('br.delAll', 'calc.cmd.deleteAllBreaks', uno('.uno:DeleteAllBreaks')),
        ], { size: 'large', icon: IconPageBreak, keytip: 'BR' }),
        button('pl.headerFooter', 'calc.cmd.headerFooter', uno('.uno:EditHeaderAndFooter'), { icon: IconLayoutNavbar, keytip: 'H' }),
      ],
    },
    {
      id: 'sheetOptions',
      labelKey: 'calc.group.sheetOptions',
      controls: [
        toggle('gridlines', 'calc.cmd.gridlines', '.uno:ToggleSheetGrid', { icon: IconGridDots, keytip: 'VG' }),
        toggle('headings', 'calc.cmd.headings', '.uno:ViewRowColumnHeaders', { icon: IconLayoutColumns, keytip: 'VH' }),
      ],
    },
    {
      id: 'arrange',
      labelKey: 'common.group.arrange',
      controls: [forwardOne('AF'), backOne('AE'), bringToFront('BF'), sendToBack('BS')],
    },
  ],
};

// ------------------------------------------------------------------ Formulas

const formulas: RibbonTab = {
  id: 'formulas',
  labelKey: 'calc.tab.formulas',
  keytip: 'M',
  groups: [
    {
      id: 'functionLibrary',
      labelKey: 'calc.group.functionLibrary',
      controls: [
        button('insertFunction', 'calc.cmd.insertFunction', uno('.uno:FunctionDialog'), { size: 'large', icon: IconFunction, keytip: 'F', shortcut: 'Ctrl+F2', tipKey: 'calc.tip.insertFunction' }),
        button('f.autoSum', 'calc.cmd.autoSum', uno('.uno:AutoSum'), { size: 'large', icon: IconSum, keytip: 'U', shortcut: 'Alt+=' }),
      ],
    },
    {
      id: 'definedNames',
      labelKey: 'calc.group.definedNames',
      controls: [
        button('manageNames', 'calc.cmd.manageNames', uno('.uno:DefineName'), { size: 'large', icon: IconTag, keytip: 'MN', shortcut: 'Ctrl+F3' }),
        button('addName', 'calc.cmd.addName', uno('.uno:AddName'), { icon: IconPlus, keytip: 'MA' }),
        button('pasteName', 'calc.cmd.pasteName', uno('.uno:InsertName'), { icon: IconCopy, keytip: 'MS' }),
        button('createNames', 'calc.cmd.createNames', uno('.uno:CreateNames'), { icon: IconListDetails, keytip: 'MC' }),
      ],
    },
    {
      id: 'auditing',
      labelKey: 'calc.group.auditing',
      controls: [
        button('precedents', 'calc.cmd.tracePrecedents', uno('.uno:ShowPrecedents'), { icon: IconSitemap, keytip: 'P' }),
        button('dependents', 'calc.cmd.traceDependents', uno('.uno:ShowDependents'), { icon: IconSitemap, keytip: 'D' }),
        split('removeArrows', 'calc.cmd.removeArrows', uno('.uno:ClearArrows'), [
          item('arrows.all', 'calc.cmd.removeArrows', uno('.uno:ClearArrows')),
          item('arrows.precedents', 'calc.cmd.removePrecedentArrows', uno('.uno:ClearArrowPrecedents')),
          item('arrows.dependents', 'calc.cmd.removeDependentArrows', uno('.uno:ClearArrowDependents')),
        ], { icon: IconX, keytip: 'A' }),
        toggle('showFormulas', 'calc.cmd.showFormulas', '.uno:ToggleFormula', { icon: IconEye, keytip: 'H', shortcut: 'Ctrl+`' }),
        button('traceError', 'calc.cmd.traceError', uno('.uno:ShowErrors'), { icon: IconCheckbox, keytip: 'K' }),
      ],
    },
    {
      id: 'calculation',
      labelKey: 'calc.group.calculation',
      controls: [
        toggle('autoCalc', 'calc.cmd.autoCalculate', '.uno:AutomaticCalculation', { size: 'large', icon: IconCalculator, keytip: 'X' }),
        button('calcNow', 'calc.cmd.calculateNow', uno('.uno:Calculate'), { icon: IconRefresh, keytip: 'B', shortcut: 'F9' }),
        button('calcHard', 'calc.cmd.recalculateHard', uno('.uno:CalculateHard'), { icon: IconRefresh, keytip: 'J', shortcut: 'Ctrl+Shift+F9' }),
      ],
    },
  ],
};

// ------------------------------------------------------------------ Data

const data: RibbonTab = {
  id: 'data',
  labelKey: 'calc.tab.data',
  keytip: 'A',
  groups: [
    {
      id: 'getData',
      labelKey: 'calc.group.getData',
      controls: [
        button('externalData', 'calc.cmd.externalData', uno('.uno:InsertExternalDataSource'), { size: 'large', icon: IconDatabaseImport, keytip: 'X' }),
        button('refreshData', 'calc.cmd.refreshData', uno('.uno:DataAreaRefresh'), { icon: IconRefresh, keytip: 'R' }),
      ],
    },
    {
      id: 'sortFilter',
      labelKey: 'calc.group.sortFilter',
      controls: [
        button('d.sortAsc', 'calc.cmd.sortAscending', uno('.uno:SortAscending'), { icon: IconSortAscending, keytip: 'SA' }),
        button('d.sortDesc', 'calc.cmd.sortDescending', uno('.uno:SortDescending'), { icon: IconSortDescending, keytip: 'SD' }),
        button('d.sort', 'calc.cmd.customSort', uno('.uno:DataSort'), { size: 'large', icon: IconSortAscending, keytip: 'SS' }),
        toggle('d.filter', 'calc.cmd.filter', '.uno:DataFilterAutoFilter', { size: 'large', icon: IconFilter, keytip: 'T', shortcut: 'Ctrl+Shift+L' }),
        button('d.clearFilter', 'calc.cmd.clearFilter', uno('.uno:DataFilterRemoveFilter'), { icon: IconFilterOff, keytip: 'C' }),
        button('d.standardFilter', 'calc.cmd.standardFilter', uno('.uno:DataFilterStandardFilter'), { icon: IconFilter, keytip: 'SF' }),
        button('d.advancedFilter', 'calc.cmd.advancedFilter', uno('.uno:DataFilterSpecialFilter'), { icon: IconFilter, keytip: 'Q' }),
      ],
    },
    {
      id: 'dataTools',
      labelKey: 'calc.group.dataTools',
      controls: [
        button('textToColumns', 'calc.cmd.textToColumns', uno('.uno:TextToColumns'), { size: 'large', icon: IconColumns, keytip: 'E' }),
        button('removeDuplicates', 'calc.cmd.removeDuplicates', uno('.uno:HandleDuplicateRecords'), { icon: IconCopy, keytip: 'M' }),
        button('validation', 'calc.cmd.validation', uno('.uno:Validation'), { icon: IconChecks, keytip: 'V' }),
        button('consolidate', 'calc.cmd.consolidate', uno('.uno:DataConsolidate'), { icon: IconTransform, keytip: 'N' }),
        menu('whatIf', 'calc.cmd.whatIf', [
          item('whatIf.scenarios', 'calc.cmd.scenarioManager', uno('.uno:ScenarioManager')),
          item('whatIf.goalSeek', 'calc.cmd.goalSeek', uno('.uno:GoalSeekDialog')),
          item('whatIf.multipleOps', 'calc.cmd.multipleOperations', uno('.uno:TableOperationDialog')),
          item('whatIf.solver', 'calc.cmd.solver', uno('.uno:SolverDialog')),
        ], { icon: IconTimeline, keytip: 'W' }),
      ],
    },
    {
      id: 'outline',
      labelKey: 'calc.group.outline',
      controls: [
        button('group', 'calc.cmd.group', uno('.uno:Group'), { size: 'large', icon: IconLayoutRows, keytip: 'G', shortcut: 'F12' }),
        button('ungroup', 'calc.cmd.ungroup', uno('.uno:Ungroup'), { size: 'large', icon: IconLayoutRows, keytip: 'U' }),
        button('subtotals', 'calc.cmd.subtotals', uno('.uno:DataSubTotals'), { size: 'large', icon: IconSum, keytip: 'B' }),
        button('showDetail', 'calc.cmd.showDetail', uno('.uno:ShowDetail'), { icon: IconChevronsDown, keytip: 'J' }),
        button('hideDetail', 'calc.cmd.hideDetail', uno('.uno:HideDetail'), { icon: IconChevronsUp, keytip: 'H' }),
      ],
    },
  ],
};

// ------------------------------------------------------------------ Review

const review: RibbonTab = {
  id: 'review',
  labelKey: 'common.tab.review',
  keytip: 'R',
  groups: [
    {
      id: 'proofing',
      labelKey: 'common.group.proofing',
      controls: [
        button('spelling', 'common.cmd.spelling', uno('.uno:SpellDialog'), { size: 'large', icon: IconTextSpellcheck, keytip: 'S', shortcut: 'F7' }),
        thesaurus('E'),
        autoSpell('O'),
      ],
    },
    {
      id: 'notes',
      labelKey: 'calc.group.notes',
      controls: [
        insertComment('C'),
        button('editNote', 'calc.cmd.editNote', uno('.uno:EditAnnotation'), { icon: IconEdit, keytip: 'T' }),
        split('deleteNote', 'common.cmd.deleteComment', uno('.uno:DeleteNote'), [
          item('deleteNote.one', 'common.cmd.deleteComment', uno('.uno:DeleteNote')),
          item('deleteNote.all', 'common.cmd.deleteAllComments', uno('.uno:DeleteAllNotes')),
        ], { icon: IconMessageX, keytip: 'D' }),
        menu('noteVisibility', 'calc.cmd.showNotes', [
          item('notes.show', 'calc.cmd.showNote', uno('.uno:ShowNote')),
          item('notes.hide', 'calc.cmd.hideNote', uno('.uno:HideNote')),
          item('notes.showAll', 'calc.cmd.showAllNotes', uno('.uno:ShowAllNotes'), { separatorBefore: true }),
          item('notes.hideAll', 'calc.cmd.hideAllNotes', uno('.uno:HideAllNotes')),
        ], { icon: IconMessages, keytip: 'A' }),
      ],
    },
    {
      id: 'protect',
      labelKey: 'common.group.protect',
      controls: [
        toggle('protectSheet', 'calc.cmd.protectSheet', '.uno:Protect', { size: 'large', icon: IconShieldLock, keytip: 'PS' }),
        toggle('protectWorkbook', 'calc.cmd.protectWorkbook', '.uno:ToolProtectionDocument', { size: 'large', icon: IconLock, keytip: 'PW' }),
      ],
    },
    {
      id: 'changes',
      labelKey: 'calc.group.changes',
      controls: [
        toggle('trackChanges', 'calc.cmd.trackChanges', '.uno:TraceChangeMode', { size: 'large', icon: IconEdit, keytip: 'G' }),
        button('manageChanges', 'calc.cmd.manageChanges', uno('.uno:AcceptChanges'), { icon: IconChecks, keytip: 'M' }),
      ],
    },
  ],
};

// ------------------------------------------------------------------ View

const view: RibbonTab = {
  id: 'view',
  labelKey: 'common.tab.view',
  keytip: 'W',
  groups: [
    {
      id: 'views',
      labelKey: 'calc.group.workbookViews',
      controls: [
        toggle('normalView', 'calc.cmd.normalView', '.uno:NormalViewMode', { size: 'large', icon: IconTable, keytip: 'L', exclusive: true }),
        toggle('pageBreakView', 'calc.cmd.pageBreakView', '.uno:PagebreakMode', { size: 'large', icon: IconPageBreak, keytip: 'B', exclusive: true }),
      ],
    },
    {
      id: 'show',
      labelKey: 'common.group.show',
      controls: [
        toggle('v.gridlines', 'calc.cmd.gridlines', '.uno:ToggleSheetGrid', { icon: IconGridDots, keytip: 'VG' }),
        toggle('v.headings', 'calc.cmd.headings', '.uno:ViewRowColumnHeaders', { icon: IconLayoutColumns, keytip: 'VH' }),
        formulaBarToggle('VF'),
      ],
    },
    {
      id: 'zoom',
      labelKey: 'common.group.zoom',
      controls: [
        button('zoom', 'common.cmd.zoom', uno('.uno:Zoom'), { size: 'large', icon: IconZoomIn, keytip: 'Q' }),
        button('zoom100', 'common.cmd.zoom100', uno('.uno:Zoom100Percent'), { size: 'large', icon: IconTextSize, keytip: 'J' }),
        button('zoomOptimal', 'common.cmd.zoomOptimal', uno('.uno:ZoomOptimal'), { icon: IconZoomIn, keytip: 'G' }),
      ],
    },
    {
      id: 'window',
      labelKey: 'calc.group.window',
      controls: [
        menu('freeze', 'calc.cmd.freezePanes', [
          checkItem('freeze.panes', 'calc.cmd.freezePanes', '.uno:FreezePanes'),
          item('freeze.row', 'calc.cmd.freezeFirstRow', uno('.uno:FreezePanesRow')),
          item('freeze.column', 'calc.cmd.freezeFirstColumn', uno('.uno:FreezePanesColumn')),
        ], { size: 'large', icon: IconTableOptions, keytip: 'F', tipKey: 'calc.tip.freezePanes' }),
        toggle('split', 'calc.cmd.split', '.uno:SplitWindow', { icon: IconLayoutColumns, keytip: 'S' }),
      ],
    },
  ],
};

// ------------------------------------------------------------------ Contextual

const pictureFormat: RibbonTab = {
  id: 'pictureFormat',
  labelKey: 'common.tab.pictureFormat',
  keytip: 'JP',
  contexts: ['Graphic'],
  contextualColor: 'picture',
  groups: [
    {
      id: 'adjust',
      labelKey: 'common.group.adjust',
      controls: [
        toggle('crop', 'common.cmd.crop', '.uno:Crop', { size: 'large', icon: IconCrop, keytip: 'C' }),
        button('compress', 'common.cmd.compressPicture', uno('.uno:CompressGraphic'), { icon: IconPhotoMinus, keytip: 'M' }),
        button('changePicture', 'common.cmd.changePicture', uno('.uno:ChangePicture'), { icon: IconPhotoEdit, keytip: 'P' }),
        button('savePicture', 'common.cmd.savePicture', uno('.uno:SaveGraphic'), { icon: IconDeviceFloppy, keytip: 'SV' }),
        positionAndSize('SZ'),
      ],
    },
    arrangeFor('pictureArrange'),
  ],
};

const shapeFormat: RibbonTab = {
  id: 'shapeFormat',
  labelKey: 'common.tab.shapeFormat',
  keytip: 'JD',
  contexts: ['Draw', 'DrawText', 'DrawFontwork', 'DrawLine'],
  contextualColor: 'drawing',
  groups: [
    {
      id: 'shapeStyles',
      labelKey: 'common.group.shapeStyles',
      controls: [
        button('formatArea', 'common.cmd.formatArea', uno('.uno:FormatArea'), { size: 'large', icon: IconPaint, keytip: 'R' }),
        button('formatLine', 'common.cmd.formatLine', uno('.uno:FormatLine'), { icon: IconLineHeight, keytip: 'L' }),
        positionAndSize('SZ'),
      ],
    },
    arrangeFor('shapeArrange'),
  ],
};

function arrangeFor(id: string): RibbonGroup {
  return {
    id,
    labelKey: 'common.group.arrange',
    controls: [forwardOne('AF'), backOne('AE'), bringToFront('BF'), sendToBack('BS'), alignObjectsMenu('AA'), groupMenu('G'), flipMenu([], 'AY')],
  };
}


export const calcRibbon: ModuleRibbon = {
  module: 'calc',
  tabs: [home, insert, pageLayout, formulas, data, review, view, pictureFormat, shapeFormat],
};

