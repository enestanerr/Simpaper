/** Documents (Writer) ribbon: Home, Insert, Layout, References, Review, View + contextual Table/Picture/Shape tabs. */
import {
  IconAccessible,
  IconArrowBigLeft,
  IconArrowBigRight,
  IconArrowsSplit,
  IconArrowsJoin,
  IconBook,
  IconBookmark,
  IconBorderAll,
  IconBracketsContain,
  IconCalendarTime,
  IconCheck,
  IconChecks,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconColumns,
  IconCrop,
  IconDeviceFloppy,
  IconEdit,
  IconEye,
  IconFile,
  IconFileHorizontal,
  IconFileSettings,
  IconFileText,
  IconGitCompare,
  IconIndentDecrease,
  IconIndentIncrease,
  IconLayoutAlignBottom,
  IconLayoutAlignMiddle,
  IconLayoutAlignTop,
  IconLayoutBottombar,
  IconLayoutNavbar,
  IconLetterA,
  IconLineHeight,
  IconList,
  IconListNumbers,
  IconMathFunction,
  IconMessageCircle,
  IconMessageReply,
  IconMessageX,
  IconNavigation,
  IconNotes,
  IconNumber,
  IconPageBreak,
  IconPaint,
  IconPhotoCog,
  IconPhotoMinus,
  IconPhotoEdit,
  IconPilcrow,
  IconQuote,
  IconRefresh,
  IconRotate,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconRuler,
  IconSelectAll,
  IconShieldLock,
  IconSortAscendingLetters,
  IconSpacingVertical,
  IconStackPop,
  IconStackPush,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconTableOptions,
  IconTag,
  IconTextSize,
  IconTextSpellcheck,
  IconTextWrap,
  IconWorldWww,
  IconX,
  IconZoomIn,
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconLayoutDistributeVertical,
  IconLayoutDistributeHorizontal,
  IconArrowRampRight,
  IconBraces,
  IconFileCertificate,
  IconSquare,
} from '@tabler/icons-react';
import type { GalleryItem, MenuItem, ModuleRibbon, RibbonGroup, RibbonTab } from '../../ribbon/types';
import { styleNameFromState } from '../../services/unoValues';
import {
  alignObjectsMenu,
  alignToggles,
  autoSpell,
  bold,
  bringToFront,
  button,
  changeCaseMenu,
  checkItem,
  clearFormatting,
  clipboardControls,
  fillColor,
  findReplace,
  flipMenu,
  fontColor,
  fontNameCombo,
  fontSizeCombo,
  groupMenu,
  growFont,
  highlightColor,
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
  lineSpacingItems,
  menu,
  positionAndSize,
  sendToBack,
  shapesMenu,
  showComments,
  shrinkFont,
  split,
  strikethrough,
  styleAction,
  thesaurus,
  toggle,
  underlineSplit,
  uno,
} from '../common/controls';
import { tableGridControl } from '../common/TableGridControl';

const STYLE_ITEMS: { id: string; key: string; preview: Record<string, string | number> }[] = [
  { id: 'Standard', key: 'writer.style.standard', preview: { fontSize: 12 } },
  { id: 'Title', key: 'writer.style.title', preview: { fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' } },
  { id: 'Subtitle', key: 'writer.style.subtitle', preview: { fontSize: 13, color: 'var(--fg-muted)' } },
  { id: 'Heading 1', key: 'writer.style.heading1', preview: { fontSize: 15, fontWeight: 600, color: 'var(--accent-text)' } },
  { id: 'Heading 2', key: 'writer.style.heading2', preview: { fontSize: 13.5, fontWeight: 600, color: 'var(--accent-text)' } },
  { id: 'Heading 3', key: 'writer.style.heading3', preview: { fontSize: 12.5, fontWeight: 600 } },
  { id: 'Quotations', key: 'writer.style.quotations', preview: { fontSize: 12, fontStyle: 'italic', color: 'var(--fg-muted)' } },
];

const styleGallery: GalleryItem[] = STYLE_ITEMS.map((s) => ({ id: s.id, labelKey: s.key, action: styleAction(s.id, 'ParagraphStyles'), previewStyle: s.preview }));

function wrapItems(): MenuItem[] {
  return [
    checkItem('wrap.inline', 'writer.cmd.wrapInline', '.uno:SetAnchorToChar'),
    checkItem('wrap.off', 'writer.cmd.wrapOff', '.uno:WrapOff'),
    checkItem('wrap.page', 'writer.cmd.wrapPage', '.uno:WrapOn'),
    checkItem('wrap.optimal', 'writer.cmd.wrapOptimal', '.uno:WrapIdeal'),
    checkItem('wrap.left', 'writer.cmd.wrapLeft', '.uno:WrapLeft'),
    checkItem('wrap.right', 'writer.cmd.wrapRight', '.uno:WrapRight'),
    checkItem('wrap.through', 'writer.cmd.wrapThrough', '.uno:WrapThrough'),
  ];
}

const wrapMenu = (keytip: string) => menu('wrapText', 'writer.cmd.wrapText', wrapItems(), { size: 'large', icon: IconTextWrap, keytip });
const forwardOne = (keytip: string) => button('forwardOne', 'common.cmd.bringForward', uno('.uno:ObjectForwardOne'), { icon: IconStackPush, keytip });
const backOne = (keytip: string) => button('backOne', 'common.cmd.sendBackward', uno('.uno:ObjectBackOne'), { icon: IconStackPop, keytip });
const rotateItems = (): MenuItem[] => [
  item('rotate.left', 'writer.cmd.rotateLeft', uno('.uno:RotateLeft'), { icon: IconRotate }),
  item('rotate.right', 'writer.cmd.rotateRight', uno('.uno:RotateRight')),
];

// ------------------------------------------------------------------ Home

const home: RibbonTab = {
  id: 'home',
  labelKey: 'common.tab.home',
  keytip: 'H',
  groups: [
    { id: 'clipboard', labelKey: 'common.group.clipboard', controls: clipboardControls() },
    {
      id: 'font',
      labelKey: 'common.group.font',
      layout: 'rows',
      launcher: uno('.uno:FontDialog'),
      launcherLabelKey: 'common.cmd.fontDialog',
      controls: [
        fontNameCombo(),
        fontSizeCombo(),
        growFont(),
        shrinkFont(),
        changeCaseMenu(),
        clearFormatting('.uno:ResetAttributes'),
        bold(),
        italic(),
        underlineSplit(),
        strikethrough(),
        toggle('subscript', 'common.cmd.subscript', '.uno:SubScript', { icon: IconSubscript, keytip: '5', shortcut: 'Ctrl+Shift+B' }),
        toggle('superscript', 'common.cmd.superscript', '.uno:SuperScript', { icon: IconSuperscript, keytip: '6', shortcut: 'Ctrl+Shift+P' }),
        highlightColor(),
        fontColor(),
      ],
    },
    {
      id: 'paragraph',
      labelKey: 'common.group.paragraph',
      layout: 'rows',
      launcher: uno('.uno:ParagraphDialog'),
      launcherLabelKey: 'common.cmd.paragraphDialog',
      controls: [
        toggle('bullets', 'common.cmd.bullets', '.uno:DefaultBullet', { icon: IconList, keytip: 'U', tipKey: 'common.tip.bullets' }),
        toggle('numbering', 'common.cmd.numbering', '.uno:DefaultNumbering', { icon: IconListNumbers, keytip: 'N', tipKey: 'common.tip.numbering' }),
        button('decreaseIndent', 'common.cmd.decreaseIndent', uno('.uno:DecrementIndent'), { icon: IconIndentDecrease, keytip: 'AO' }),
        button('increaseIndent', 'common.cmd.increaseIndent', uno('.uno:IncrementIndent'), { icon: IconIndentIncrease, keytip: 'AU' }),
        button('sort', 'common.cmd.sort', uno('.uno:SortDialog'), { icon: IconSortAscendingLetters, keytip: 'SO' }),
        toggle('formattingMarks', 'writer.cmd.formattingMarks', '.uno:ControlCodes', { icon: IconPilcrow, keytip: '8', shortcut: 'Ctrl+F10', tipKey: 'writer.tip.formattingMarks' }),
        ...alignToggles(),
        menu('lineSpacing', 'common.cmd.lineSpacing', [
          ...lineSpacingItems().slice(0, 3),
          item('spacing.addBefore', 'writer.cmd.paraSpaceIncrease', uno('.uno:ParaspaceIncrease'), { separatorBefore: true }),
          item('spacing.removeBefore', 'writer.cmd.paraSpaceDecrease', uno('.uno:ParaspaceDecrease')),
          ...lineSpacingItems().slice(3),
        ], { icon: IconLineHeight, keytip: 'K' }),
        fillColor('shading', 'writer.cmd.shading', '.uno:BackgroundColor', 'SH', 'writer.tip.shading'),
        button('borders', 'writer.cmd.borders', uno('.uno:BorderDialog'), { icon: IconBorderAll, keytip: 'B' }),
      ],
    },
    {
      id: 'styles',
      labelKey: 'common.group.styles',
      launcher: uno('.uno:DesignerDialog'),
      launcherLabelKey: 'writer.cmd.stylesPane',
      controls: [
        {
          type: 'gallery',
          id: 'styleGallery',
          labelKey: 'writer.cmd.styles',
          tipKey: 'writer.tip.styles',
          icon: IconLetterA,
          keytip: 'L',
          inlineCount: 4,
          items: styleGallery,
          state: { command: '.uno:StyleApply', display: (v) => styleNameFromState(v) ?? '' },
        },
        menu('styleActions', 'writer.cmd.styleActions', [
          item('style.new', 'writer.cmd.styleNew', uno('.uno:StyleNewByExample')),
          item('style.update', 'writer.cmd.styleUpdate', uno('.uno:StyleUpdateByExample')),
          item('style.pane', 'writer.cmd.stylesPane', uno('.uno:DesignerDialog'), { separatorBefore: true }),
        ], { icon: IconTag, keytip: 'Y' }),
      ],
    },
    {
      id: 'editing',
      labelKey: 'common.group.editing',
      controls: [
        findReplace('FD'),
        button('selectAll', 'common.cmd.selectAll', uno('.uno:SelectAll'), { icon: IconSelectAll, keytip: 'SL', shortcut: 'Ctrl+A' }),
        button('gotoPage', 'writer.cmd.gotoPage', uno('.uno:GotoPage'), { icon: IconArrowRampRight, keytip: 'GO', shortcut: 'Ctrl+G' }),
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
      id: 'pages',
      labelKey: 'writer.group.pages',
      controls: [
        button('coverPage', 'writer.cmd.titlePage', uno('.uno:TitlePageDialog'), { icon: IconFileCertificate, keytip: 'NP' }),
        button('pageBreak', 'writer.cmd.pageBreak', uno('.uno:InsertPagebreak'), { icon: IconPageBreak, keytip: 'NB', shortcut: 'Ctrl+Enter' }),
        button('landscapePage', 'writer.cmd.landscapePage', uno('.uno:InsertLandscapePage'), { icon: IconFileHorizontal, keytip: 'NL' }),
      ],
    },
    { id: 'tables', labelKey: 'common.group.tables', controls: [tableGridControl('T')] },
    { id: 'illustrations', labelKey: 'common.group.illustrations', controls: [insertPicture('P'), shapesMenu('SH'), insertChart('C')] },
    {
      id: 'links',
      labelKey: 'common.group.links',
      controls: [
        insertLink('K'),
        button('bookmark', 'writer.cmd.bookmark', uno('.uno:InsertBookmark'), { icon: IconBookmark, keytip: 'BK' }),
        button('crossReference', 'writer.cmd.crossReference', uno('.uno:InsertReferenceField'), { icon: IconBracketsContain, keytip: 'RF' }),
      ],
    },
    { id: 'comments', labelKey: 'common.group.comments', controls: [insertComment('M')] },
    {
      id: 'headerFooter',
      labelKey: 'writer.group.headerFooter',
      controls: [
        toggle('header', 'writer.cmd.header', '.uno:InsertPageHeader', { icon: IconLayoutNavbar, keytip: 'H', tipKey: 'writer.tip.header' }),
        toggle('footer', 'writer.cmd.footer', '.uno:InsertPageFooter', { icon: IconLayoutBottombar, keytip: 'O', tipKey: 'writer.tip.footer' }),
        button('pageNumber', 'writer.cmd.pageNumber', uno('.uno:PageNumberWizard'), { icon: IconNumber, keytip: 'NU' }),
      ],
    },
    {
      id: 'text',
      labelKey: 'common.group.text',
      controls: [
        button('textBox', 'common.cmd.textBox', uno('.uno:DrawText'), { size: 'large', icon: IconSquare, keytip: 'X', tipKey: 'common.tip.textBox' }),
        insertFontwork('W'),
        button('dropCap', 'writer.cmd.dropCap', uno('.uno:FormatDropcap'), { icon: IconLetterA, keytip: 'RC' }),
        insertSignature('G'),
        menu('dateTime', 'writer.cmd.dateTime', [
          item('dateTime.date', 'writer.cmd.dateField', uno('.uno:InsertDateField')),
          item('dateTime.time', 'writer.cmd.timeField', uno('.uno:InsertTimeField')),
        ], { icon: IconCalendarTime, keytip: 'D' }),
        button('field', 'writer.cmd.field', uno('.uno:InsertField'), { icon: IconBraces, keytip: 'Q', shortcut: 'Ctrl+F2' }),
        insertObject('J'),
      ],
    },
    {
      id: 'symbols',
      labelKey: 'common.group.symbols',
      controls: [
        button('equation', 'common.cmd.equation', uno('.uno:InsertObjectStarMath'), { size: 'large', icon: IconMathFunction, keytip: 'E' }),
        insertSymbol('U'),
      ],
    },
  ],
};

// ------------------------------------------------------------------ Layout

const arrangeGroup = (): RibbonGroup => ({
  id: 'arrange',
  labelKey: 'common.group.arrange',
  controls: [
    wrapMenu('TW'),
    forwardOne('FW'),
    backOne('BW'),
    bringToFront('AF'),
    sendToBack('AE'),
    alignObjectsMenu('AA'),
    groupMenu('G'),
    flipMenu(rotateItems(), 'AY'),
  ],
});

const layout: RibbonTab = {
  id: 'layout',
  labelKey: 'common.tab.layout',
  keytip: 'P',
  groups: [
    {
      id: 'pageSetup',
      labelKey: 'writer.group.pageSetup',
      launcher: uno('.uno:PageDialog'),
      launcherLabelKey: 'writer.cmd.pageSetup',
      controls: [
        button('pageSetup', 'writer.cmd.pageSetup', uno('.uno:PageDialog'), { size: 'large', icon: IconFileSettings, keytip: 'M', tipKey: 'writer.tip.pageSetup' }),
        button('columns', 'writer.cmd.columns', uno('.uno:FormatColumns'), { size: 'large', icon: IconColumns, keytip: 'O' }),
        menu('breaks', 'writer.cmd.breaks', [
          item('break.page', 'writer.cmd.pageBreak', uno('.uno:InsertPagebreak'), { shortcut: 'Ctrl+Enter' }),
          item('break.column', 'writer.cmd.columnBreak', uno('.uno:InsertColumnBreak'), { shortcut: 'Ctrl+Shift+Enter' }),
          item('break.more', 'writer.cmd.moreBreaks', uno('.uno:InsertBreak'), { separatorBefore: true }),
        ], { icon: IconPageBreak, keytip: 'BR' }),
        button('lineNumbers', 'writer.cmd.lineNumbers', uno('.uno:LineNumberingDialog'), { icon: IconListNumbers, keytip: 'LN' }),
        button('hyphenation', 'writer.cmd.hyphenation', uno('.uno:Hyphenate'), { icon: IconTextSpellcheck, keytip: 'H' }),
      ],
    },
    {
      id: 'paragraphSpacing',
      labelKey: 'common.group.paragraph',
      launcher: uno('.uno:ParagraphDialog'),
      launcherLabelKey: 'common.cmd.paragraphDialog',
      controls: [
        button('layout.decreaseIndent', 'common.cmd.decreaseIndent', uno('.uno:DecrementIndent'), { icon: IconIndentDecrease, keytip: 'AO' }),
        button('layout.increaseIndent', 'common.cmd.increaseIndent', uno('.uno:IncrementIndent'), { icon: IconIndentIncrease, keytip: 'AU' }),
        button('layout.spaceBefore', 'writer.cmd.paraSpaceIncrease', uno('.uno:ParaspaceIncrease'), { icon: IconSpacingVertical, keytip: 'SB' }),
        button('layout.spaceAfter', 'writer.cmd.paraSpaceDecrease', uno('.uno:ParaspaceDecrease'), { icon: IconLineHeight, keytip: 'SA' }),
      ],
    },
    arrangeGroup(),
  ],
};

// ------------------------------------------------------------------ References

const references: RibbonTab = {
  id: 'references',
  labelKey: 'writer.tab.references',
  keytip: 'S',
  groups: [
    {
      id: 'toc',
      labelKey: 'writer.group.toc',
      controls: [
        button('toc', 'writer.cmd.toc', uno('.uno:InsertMultiIndex'), { size: 'large', icon: IconList, keytip: 'T', tipKey: 'writer.tip.toc' }),
        button('updateIndex', 'writer.cmd.updateIndex', uno('.uno:UpdateCurIndex'), { icon: IconRefresh, keytip: 'U' }),
        button('updateAllIndexes', 'writer.cmd.updateAllIndexes', uno('.uno:UpdateAllIndexes'), { icon: IconRefresh, keytip: 'Y' }),
      ],
    },
    {
      id: 'footnotes',
      labelKey: 'writer.group.footnotes',
      launcher: uno('.uno:FootnoteDialog'),
      launcherLabelKey: 'writer.cmd.footnoteSettings',
      controls: [
        button('footnote', 'writer.cmd.footnote', uno('.uno:InsertFootnote'), { size: 'large', icon: IconNotes, keytip: 'F' }),
        button('endnote', 'writer.cmd.endnote', uno('.uno:InsertEndnote'), { icon: IconNotes, keytip: 'E' }),
      ],
    },
    {
      id: 'citations',
      labelKey: 'writer.group.citations',
      controls: [button('citation', 'writer.cmd.citation', uno('.uno:InsertAuthoritiesEntry'), { size: 'large', icon: IconQuote, keytip: 'C' })],
    },
    {
      id: 'captions',
      labelKey: 'writer.group.captions',
      controls: [
        button('caption', 'writer.cmd.caption', uno('.uno:InsertCaptionDialog'), { size: 'large', icon: IconFileText, keytip: 'P' }),
        button('refs.crossReference', 'writer.cmd.crossReference', uno('.uno:InsertReferenceField'), { icon: IconBracketsContain, keytip: 'R' }),
      ],
    },
    {
      id: 'index',
      labelKey: 'writer.group.index',
      controls: [button('markEntry', 'writer.cmd.markEntry', uno('.uno:InsertIndexesEntry'), { size: 'large', icon: IconTag, keytip: 'N' })],
    },
    {
      id: 'fields',
      labelKey: 'writer.group.fields',
      controls: [button('updateAll', 'writer.cmd.updateAll', uno('.uno:UpdateAll'), { size: 'large', icon: IconRefresh, keytip: 'A' })],
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
        button('spelling', 'common.cmd.spelling', uno('.uno:SpellingAndGrammarDialog'), { size: 'large', icon: IconTextSpellcheck, keytip: 'SP', shortcut: 'F7', tipKey: 'common.tip.spelling' }),
        thesaurus('E'),
        button('wordCount', 'writer.cmd.wordCount', uno('.uno:WordCountDialog'), { icon: IconNumber, keytip: 'W' }),
        autoSpell('O'),
      ],
    },
    {
      id: 'accessibility',
      labelKey: 'common.group.accessibility',
      controls: [button('a11yCheck', 'writer.cmd.accessibilityCheck', uno('.uno:SidebarDeck.A11yCheckDeck'), { size: 'large', icon: IconAccessible, keytip: 'L' })],
    },
    {
      id: 'reviewComments',
      labelKey: 'common.group.comments',
      controls: [
        insertComment('C'),
        button('replyComment', 'writer.cmd.replyComment', uno('.uno:ReplyComment'), { icon: IconMessageReply, keytip: 'RP' }),
        split('deleteComment', 'common.cmd.deleteComment', uno('.uno:DeleteComment'), [
          item('deleteComment.one', 'common.cmd.deleteComment', uno('.uno:DeleteComment')),
          item('deleteComment.all', 'common.cmd.deleteAllComments', uno('.uno:DeleteAllNotes')),
        ], { icon: IconMessageX, keytip: 'D' }),
        button('resolveComment', 'writer.cmd.resolveComment', uno('.uno:ResolveComment'), { icon: IconMessageCircle, keytip: 'RS' }),
        showComments('SC'),
      ],
    },
    {
      id: 'tracking',
      labelKey: 'writer.group.tracking',
      controls: [
        toggle('trackChanges', 'writer.cmd.trackChanges', '.uno:TrackChanges', { size: 'large', icon: IconEdit, keytip: 'G', shortcut: 'Ctrl+Shift+C', tipKey: 'writer.tip.trackChanges' }),
        toggle('showChanges', 'writer.cmd.showChanges', '.uno:ShowTrackedChanges', { icon: IconEye, keytip: 'TD' }),
        button('manageChanges', 'writer.cmd.manageChanges', uno('.uno:AcceptTrackedChanges'), { icon: IconChecks, keytip: 'TM' }),
      ],
    },
    {
      id: 'changes',
      labelKey: 'writer.group.changes',
      controls: [
        split('accept', 'writer.cmd.accept', uno('.uno:AcceptTrackedChange'), [
          item('accept.one', 'writer.cmd.accept', uno('.uno:AcceptTrackedChange')),
          item('accept.next', 'writer.cmd.acceptNext', uno('.uno:AcceptTrackedChangeToNext')),
          item('accept.all', 'writer.cmd.acceptAll', uno('.uno:AcceptAllTrackedChanges')),
        ], { size: 'large', icon: IconCheck, keytip: 'AC' }),
        split('reject', 'writer.cmd.reject', uno('.uno:RejectTrackedChange'), [
          item('reject.one', 'writer.cmd.reject', uno('.uno:RejectTrackedChange')),
          item('reject.next', 'writer.cmd.rejectNext', uno('.uno:RejectTrackedChangeToNext')),
          item('reject.all', 'writer.cmd.rejectAll', uno('.uno:RejectAllTrackedChanges')),
        ], { size: 'large', icon: IconX, keytip: 'J' }),
        button('previousChange', 'writer.cmd.previousChange', uno('.uno:PreviousTrackedChange'), { icon: IconArrowBigLeft, keytip: 'F' }),
        button('nextChange', 'writer.cmd.nextChange', uno('.uno:NextTrackedChange'), { icon: IconArrowBigRight, keytip: 'H' }),
      ],
    },
    {
      id: 'compare',
      labelKey: 'writer.group.compare',
      controls: [
        menu('compare', 'writer.cmd.compare', [
          item('compare.compare', 'writer.cmd.compareDocuments', uno('.uno:CompareDocuments')),
          item('compare.merge', 'writer.cmd.mergeDocuments', uno('.uno:MergeDocuments')),
        ], { size: 'large', icon: IconGitCompare, keytip: 'M' }),
      ],
    },
    {
      id: 'protect',
      labelKey: 'common.group.protect',
      controls: [toggle('protectChanges', 'writer.cmd.protectChanges', '.uno:ProtectTraceChangeMode', { size: 'large', icon: IconShieldLock, keytip: 'PT' })],
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
      labelKey: 'common.group.views',
      controls: [
        toggle('printLayout', 'writer.cmd.printLayout', '.uno:PrintLayout', { size: 'large', icon: IconFile, keytip: 'P', exclusive: true }),
        toggle('webLayout', 'writer.cmd.webLayout', '.uno:BrowseView', { size: 'large', icon: IconWorldWww, keytip: 'L', exclusive: true }),
      ],
    },
    {
      id: 'show',
      labelKey: 'common.group.show',
      controls: [
        toggle('ruler', 'writer.cmd.ruler', '.uno:Ruler', { icon: IconRuler, keytip: 'R' }),
        toggle('view.formattingMarks', 'writer.cmd.formattingMarks', '.uno:ControlCodes', { icon: IconPilcrow, keytip: 'FM' }),
        toggle('showWhitespace', 'writer.cmd.showWhitespace', '.uno:ShowWhitespace', { icon: IconSpacingVertical, keytip: 'HW' }),
        button('navigator', 'writer.cmd.navigator', uno('.uno:Navigator'), { icon: IconNavigation, keytip: 'K', shortcut: 'F5' }),
      ],
    },
    {
      id: 'zoom',
      labelKey: 'common.group.zoom',
      controls: [
        button('zoom', 'common.cmd.zoom', uno('.uno:Zoom'), { size: 'large', icon: IconZoomIn, keytip: 'Q', tipKey: 'common.tip.zoom' }),
        button('zoom100', 'common.cmd.zoom100', uno('.uno:Zoom100Percent'), { size: 'large', icon: IconTextSize, keytip: 'J' }),
        button('zoomPage', 'writer.cmd.onePage', uno('.uno:ZoomPage'), { icon: IconFile, keytip: '1' }),
        toggle('bookView', 'writer.cmd.multiplePages', '.uno:BookView', { icon: IconBook, keytip: 'M' }),
        button('zoomPageWidth', 'writer.cmd.pageWidth', uno('.uno:ZoomPageWidth'), { icon: IconFileHorizontal, keytip: 'W' }),
        button('zoomOptimal', 'common.cmd.zoomOptimal', uno('.uno:ZoomOptimal'), { icon: IconZoomIn, keytip: 'O' }),
      ],
    },
  ],
};

// ------------------------------------------------------------------ Contextual

const tableLayout: RibbonTab = {
  id: 'tableLayout',
  labelKey: 'common.tab.tableLayout',
  keytip: 'JL',
  contexts: ['Table'],
  contextualColor: 'table',
  groups: [
    {
      id: 'rowsColumns',
      labelKey: 'common.group.rowsColumns',
      controls: [
        button('insertAbove', 'common.cmd.insertRowAbove', uno('.uno:InsertRowsBefore'), { size: 'large', icon: IconRowInsertTop, keytip: 'A' }),
        button('insertBelow', 'common.cmd.insertRowBelow', uno('.uno:InsertRowsAfter'), { size: 'large', icon: IconRowInsertBottom, keytip: 'BE' }),
        button('insertLeft', 'common.cmd.insertColumnLeft', uno('.uno:InsertColumnsBefore'), { icon: IconColumnInsertLeft, keytip: 'L' }),
        button('insertRight', 'common.cmd.insertColumnRight', uno('.uno:InsertColumnsAfter'), { icon: IconColumnInsertRight, keytip: 'R' }),
        menu('tableDelete', 'common.cmd.delete', [
          item('tdel.rows', 'common.cmd.deleteRows', uno('.uno:DeleteRows')),
          item('tdel.columns', 'common.cmd.deleteColumns', uno('.uno:DeleteColumns')),
          item('tdel.table', 'common.cmd.deleteTable', uno('.uno:DeleteTable')),
        ], { icon: IconX, keytip: 'D' }),
        menu('tableSelect', 'common.cmd.select', [
          item('tsel.cell', 'writer.cmd.selectCell', uno('.uno:EntireCell')),
          item('tsel.row', 'common.cmd.selectRow', uno('.uno:EntireRow')),
          item('tsel.column', 'common.cmd.selectColumn', uno('.uno:EntireColumn')),
          item('tsel.table', 'common.cmd.selectTable', uno('.uno:SelectTable')),
        ], { icon: IconSelectAll, keytip: 'K' }),
      ],
    },
    {
      id: 'merge',
      labelKey: 'common.group.merge',
      controls: [
        button('mergeCells', 'common.cmd.mergeCells', uno('.uno:MergeCells'), { size: 'large', icon: IconArrowsJoin, keytip: 'M' }),
        button('splitCells', 'common.cmd.splitCells', uno('.uno:SplitCell'), { icon: IconArrowsSplit, keytip: 'P' }),
        button('splitTable', 'writer.cmd.splitTable', uno('.uno:SplitTable'), { icon: IconTable, keytip: 'T' }),
      ],
    },
    {
      id: 'cellSize',
      labelKey: 'common.group.cellSize',
      controls: [
        button('optimalRow', 'common.cmd.optimalRowHeight', uno('.uno:SetOptimalRowHeight'), { icon: IconArrowAutofitHeight, keytip: 'H' }),
        button('optimalColumn', 'common.cmd.optimalColumnWidth', uno('.uno:SetOptimalColumnWidth'), { icon: IconArrowAutofitWidth, keytip: 'W' }),
        button('distributeRows', 'common.cmd.distributeRows', uno('.uno:DistributeRows'), { icon: IconLayoutDistributeVertical, keytip: 'U' }),
        button('distributeColumns', 'common.cmd.distributeColumns', uno('.uno:DistributeColumns'), { icon: IconLayoutDistributeHorizontal, keytip: 'O' }),
      ],
    },
    {
      id: 'cellAlignment',
      labelKey: 'common.group.alignment',
      controls: [
        toggle('cellTop', 'common.cmd.cellTop', '.uno:CellVertTop', { icon: IconLayoutAlignTop, keytip: 'CT' }),
        toggle('cellMiddle', 'common.cmd.cellMiddle', '.uno:CellVertCenter', { icon: IconLayoutAlignMiddle, keytip: 'CC' }),
        toggle('cellBottom', 'common.cmd.cellBottom', '.uno:CellVertBottom', { icon: IconLayoutAlignBottom, keytip: 'CB' }),
      ],
    },
    {
      id: 'tableData',
      labelKey: 'common.group.data',
      controls: [
        button('tableSort', 'common.cmd.sort', uno('.uno:TableSort'), { icon: IconSortAscendingLetters, keytip: 'S' }),
        button('tableNumberFormat', 'writer.cmd.numberFormat', uno('.uno:TableNumberFormatDialog'), { icon: IconNumber, keytip: 'N' }),
        button('tableProperties', 'common.cmd.tableProperties', uno('.uno:TableDialog'), { icon: IconTableOptions, keytip: 'Q' }),
      ],
    },
  ],
};

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
      ],
    },
    { ...arrangeGroup(), id: 'pictureArrange' },
    {
      id: 'pictureProps',
      labelKey: 'common.group.properties',
      controls: [button('pictureProperties', 'common.cmd.properties', uno('.uno:GraphicDialog'), { size: 'large', icon: IconPhotoCog, keytip: 'O' })],
    },
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
    {
      id: 'shapeArrange',
      labelKey: 'common.group.arrange',
      controls: [
        wrapMenu('TW'),
        bringToFront('F'),
        sendToBack('B'),
        forwardOne('U'),
        backOne('D'),
        alignObjectsMenu('AA'),
        groupMenu('G'),
        flipMenu([], 'AY'),
      ],
    },
  ],
};

export const writerRibbon: ModuleRibbon = {
  module: 'writer',
  tabs: [home, insert, layout, references, review, view, tableLayout, pictureFormat, shapeFormat],
};
