/**
 * Presentations (Impress) ribbon: Home, Insert, Design, Transitions, Animations, Slide Show, Review, View
 * + contextual Table/Picture/Shape tabs. Slide commands use the Page variants (.uno:InsertPage,
 * DuplicatePage, DeletePage): the *Slide variants have no dispatch in the normal view (verified).
 */
import {
  IconAlignBoxBottomCenter,
  IconAlignBoxCenterMiddle,
  IconAlignBoxTopCenter,
  IconArrowBigLeft,
  IconArrowBigRight,
  IconArrowsJoin,
  IconArrowsSplit,
  IconBackground,
  IconBoxMultiple,
  IconCalendarTime,
  IconClock,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconCopy,
  IconCrop,
  IconDeviceFloppy,
  IconEye,
  IconEyeOff,
  IconFileImport,
  IconGridDots,
  IconHash,
  IconIndentDecrease,
  IconIndentIncrease,
  IconLayout,
  IconLayoutDistributeHorizontal,
  IconLayoutGrid,
  IconLayoutList,
  IconLineHeight,
  IconList,
  IconListNumbers,
  IconMathFunction,
  IconMessageX,
  IconMovie,
  IconNote,
  IconNotes,
  IconPaint,
  IconPalette,
  IconPhoto,
  IconPhotoEdit,
  IconPhotoMinus,
  IconPlayerPlay,
  IconPresentation,
  IconPresentationAnalytics,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconRuler,
  IconSelectAll,
  IconSettings,
  IconSlideshow,
  IconSparkles,
  IconSquarePlus,
  IconStackBack,
  IconStackFront,
  IconStackPop,
  IconStackPush,
  IconTableOptions,
  IconTemplate,
  IconTextSize,
  IconTextSpellcheck,
  IconTimeline,
  IconTransitionRight,
  IconTrash,
  IconWand,
  IconX,
  IconZoomIn,
  IconAspectRatio,
  IconBorderStyle,
  IconShadow,
  IconLayoutDashboard,
  IconContrast,
} from '@tabler/icons-react';
import type { GalleryControl, MenuItem, ModuleRibbon, RibbonGroup, RibbonTab } from '../../ribbon/types';
import { unoNumber } from '../../services/unoValues';
import {
  alignObjectsMenu,
  autoSpell,
  bold,
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
  growFont,
  highlightColor,
  insertChart,
  insertComment,
  insertFontwork,
  insertLink,
  insertObject,
  insertPicture,
  insertSymbol,
  italic,
  item,
  lineColor,
  lineSpacingItems,
  menu,
  positionAndSize,
  selectAll,
  shapesMenu,
  showComments,
  shrinkFont,
  split,
  strikethrough,
  thesaurus,
  toggle,
  underlineSplit,
  uno,
  alignToggles,
} from '../common/controls';
import { tableGridControl } from '../common/TableGridControl';

/** AutoLayout ids for `.uno:AssignLayout` (WhatLayout); the mapping was verified on LibreOffice 26.8. */
export const SLIDE_LAYOUTS: { id: number; key: string }[] = [
  { id: 0, key: 'impress.layout.titleSlide' },
  { id: 1, key: 'impress.layout.titleContent' },
  { id: 3, key: 'impress.layout.twoContent' },
  { id: 19, key: 'impress.layout.titleOnly' },
  { id: 32, key: 'impress.layout.centeredText' },
  { id: 20, key: 'impress.layout.blank' },
  { id: 12, key: 'impress.layout.contentTwoContent' },
  { id: 15, key: 'impress.layout.twoContentContent' },
  { id: 14, key: 'impress.layout.contentOverContent' },
  { id: 16, key: 'impress.layout.twoContentOverContent' },
  { id: 18, key: 'impress.layout.fourContent' },
  { id: 34, key: 'impress.layout.sixContent' },
];

const layoutGallery: GalleryControl = {
  type: 'gallery',
  id: 'slideLayout',
  labelKey: 'impress.cmd.layout',
  tipKey: 'impress.tip.layout',
  icon: IconLayout,
  keytip: 'L',
  inlineCount: 0,
  items: SLIDE_LAYOUTS.map((l) => ({ id: String(l.id), labelKey: l.key, action: uno('.uno:AssignLayout', { WhatLayout: l.id }) })),
  state: { command: '.uno:AssignLayout', display: (v) => String(unoNumber(v) ?? '') },
};

function arrangeItems(): MenuItem[] {
  return [
    item('arr.front', 'common.cmd.bringToFront', uno('.uno:BringToFront'), { icon: IconStackFront, shortcut: 'Ctrl+Shift++' }),
    item('arr.forward', 'common.cmd.bringForward', uno('.uno:Forward'), { icon: IconStackPush, shortcut: 'Ctrl++' }),
    item('arr.backward', 'common.cmd.sendBackward', uno('.uno:Backward'), { icon: IconStackPop, shortcut: 'Ctrl+-' }),
    item('arr.back', 'common.cmd.sendToBack', uno('.uno:SendToBack'), { icon: IconStackBack, shortcut: 'Ctrl+Shift+-' }),
    item('arr.group', 'common.cmd.group', uno('.uno:FormatGroup'), { icon: IconBoxMultiple, separatorBefore: true }),
    item('arr.ungroup', 'common.cmd.ungroup', uno('.uno:FormatUngroup')),
    item('arr.distribute', 'impress.cmd.distribute', uno('.uno:DistributeSelection'), { icon: IconLayoutDistributeHorizontal, separatorBefore: true }),
  ];
}

const arrangeMenu = (keytip: string) => menu('arrange', 'common.cmd.arrange', arrangeItems(), { size: 'large', icon: IconStackFront, keytip });

function objectArrangeGroup(id: string, k: { front: string; back: string; forward: string; backward: string; align: string; group: string; flip: string }): RibbonGroup {
  return {
    id,
    labelKey: 'common.group.arrange',
    controls: [
      button(`${id}.front`, 'common.cmd.bringToFront', uno('.uno:BringToFront'), { icon: IconStackFront, keytip: k.front }),
      button(`${id}.back`, 'common.cmd.sendToBack', uno('.uno:SendToBack'), { icon: IconStackBack, keytip: k.back }),
      button(`${id}.forward`, 'common.cmd.bringForward', uno('.uno:Forward'), { icon: IconStackPush, keytip: k.forward }),
      button(`${id}.backward`, 'common.cmd.sendBackward', uno('.uno:Backward'), { icon: IconStackPop, keytip: k.backward }),
      alignObjectsMenu(k.align),
      menu(`${id}.group`, 'common.cmd.group', [
        item(`${id}.group.do`, 'common.cmd.group', uno('.uno:FormatGroup'), { icon: IconBoxMultiple }),
        item(`${id}.group.undo`, 'common.cmd.ungroup', uno('.uno:FormatUngroup')),
      ], { icon: IconBoxMultiple, keytip: k.group }),
      flipMenu([], k.flip),
    ],
  };
}

// ------------------------------------------------------------------ Home

const home: RibbonTab = {
  id: 'home',
  labelKey: 'common.tab.home',
  keytip: 'H',
  groups: [
    { id: 'clipboard', labelKey: 'common.group.clipboard', controls: clipboardControls() },
    {
      id: 'slides',
      labelKey: 'impress.group.slides',
      controls: [
        split('newSlide', 'impress.cmd.newSlide', uno('.uno:InsertPage'), [
          item('slide.new', 'impress.cmd.newSlide', uno('.uno:InsertPage'), { icon: IconSquarePlus, shortcut: 'Ctrl+M' }),
          item('slide.duplicate', 'impress.cmd.duplicateSlide', uno('.uno:DuplicatePage'), { icon: IconCopy }),
          item('slide.fromFile', 'impress.cmd.slidesFromFile', uno('.uno:ImportFromFile'), { icon: IconFileImport, separatorBefore: true }),
        ], { size: 'large', icon: IconSquarePlus, keytip: 'NS', shortcut: 'Ctrl+M', tipKey: 'impress.tip.newSlide' }),
        layoutGallery,
        button('deleteSlide', 'impress.cmd.deleteSlide', uno('.uno:DeletePage'), { icon: IconTrash, keytip: 'D' }),
      ],
    },
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
        clearFormatting('.uno:SetDefault'),
        bold(),
        italic(),
        underlineSplit(),
        strikethrough(),
        toggle('shadow', 'common.cmd.shadow', '.uno:Shadowed', { icon: IconShadow, keytip: '5' }),
        changeCaseMenu(),
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
        toggle('bullets', 'common.cmd.bullets', '.uno:DefaultBullet', { icon: IconList, keytip: 'U' }),
        toggle('numbering', 'common.cmd.numbering', '.uno:DefaultNumbering', { icon: IconListNumbers, keytip: 'NU' }),
        button('demote', 'impress.cmd.decreaseListLevel', uno('.uno:OutlineLeft'), { icon: IconIndentDecrease, keytip: 'AO' }),
        button('promote', 'impress.cmd.increaseListLevel', uno('.uno:OutlineRight'), { icon: IconIndentIncrease, keytip: 'AU' }),
        menu('lineSpacing', 'common.cmd.lineSpacing', lineSpacingItems(), { icon: IconLineHeight, keytip: 'K' }),
        ...alignToggles(),
        toggle('textTop', 'impress.cmd.textTop', '.uno:CellVertTop', { icon: IconAlignBoxTopCenter, keytip: 'AT' }),
        toggle('textMiddle', 'impress.cmd.textMiddle', '.uno:CellVertCenter', { icon: IconAlignBoxCenterMiddle, keytip: 'AM' }),
        toggle('textBottom', 'impress.cmd.textBottom', '.uno:CellVertBottom', { icon: IconAlignBoxBottomCenter, keytip: 'AB' }),
      ],
    },
    {
      id: 'drawing',
      labelKey: 'impress.group.drawing',
      controls: [
        shapesMenu('SH'),
        button('textBox', 'common.cmd.textBox', uno('.uno:Text'), { size: 'large', icon: IconTextSize, keytip: 'TB', tipKey: 'common.tip.textBox' }),
        arrangeMenu('G'),
        fillColor('shapeFill', 'impress.cmd.shapeFill', '.uno:FillColor', 'SF'),
        lineColor(),
      ],
    },
    {
      id: 'editing',
      labelKey: 'common.group.editing',
      controls: [findReplace('FD'), selectAll('SL')],
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
      id: 'slides',
      labelKey: 'impress.group.slides',
      controls: [button('ins.newSlide', 'impress.cmd.newSlide', uno('.uno:InsertPage'), { size: 'large', icon: IconSquarePlus, keytip: 'NS', shortcut: 'Ctrl+M' })],
    },
    { id: 'tables', labelKey: 'common.group.tables', controls: [tableGridControl('T')] },
    {
      id: 'images',
      labelKey: 'impress.group.images',
      controls: [insertPicture('P'), button('photoAlbum', 'impress.cmd.photoAlbum', uno('.uno:PhotoAlbumDialog'), { icon: IconPhoto, keytip: 'A' })],
    },
    { id: 'illustrations', labelKey: 'common.group.illustrations', controls: [shapesMenu('SH'), insertChart('C')] },
    {
      id: 'links',
      labelKey: 'common.group.links',
      controls: [insertLink('K'), button('interaction', 'impress.cmd.interaction', uno('.uno:AnimationEffects'), { icon: IconWand, keytip: 'Q' })],
    },
    { id: 'comments', labelKey: 'common.group.comments', controls: [insertComment('M')] },
    {
      id: 'text',
      labelKey: 'common.group.text',
      controls: [
        button('ins.textBox', 'common.cmd.textBox', uno('.uno:Text'), { size: 'large', icon: IconTextSize, keytip: 'X' }),
        button('headerFooter', 'impress.cmd.headerFooter', uno('.uno:HeaderAndFooter'), { icon: IconTemplate, keytip: 'H' }),
        insertFontwork('W'),
        menu('dateTime', 'impress.cmd.dateTime', [
          item('dt.fixed', 'impress.cmd.dateFixed', uno('.uno:InsertDateFieldFix')),
          item('dt.variable', 'impress.cmd.dateVariable', uno('.uno:InsertDateFieldVar')),
          item('dt.timeFixed', 'impress.cmd.timeFixed', uno('.uno:InsertTimeFieldFix'), { icon: IconClock, separatorBefore: true }),
          item('dt.timeVariable', 'impress.cmd.timeVariable', uno('.uno:InsertTimeFieldVar')),
        ], { icon: IconCalendarTime, keytip: 'D' }),
        menu('slideNumber', 'impress.cmd.slideNumber', [
          item('sn.number', 'impress.cmd.slideNumberField', uno('.uno:InsertPageField')),
          item('sn.count', 'impress.cmd.slideCountField', uno('.uno:InsertPagesField')),
        ], { icon: IconHash, keytip: 'SN' }),
        insertObject('J'),
      ],
    },
    {
      id: 'symbols',
      labelKey: 'common.group.symbols',
      controls: [button('equation', 'common.cmd.equation', uno('.uno:InsertMath'), { size: 'large', icon: IconMathFunction, keytip: 'E' }), insertSymbol('U')],
    },
    {
      id: 'media',
      labelKey: 'impress.group.media',
      controls: [button('media', 'impress.cmd.media', uno('.uno:InsertAVMedia'), { size: 'large', icon: IconMovie, keytip: 'O' })],
    },
  ],
};

// ------------------------------------------------------------------ Design / Transitions / Animations / Slide Show

const design: RibbonTab = {
  id: 'design',
  labelKey: 'impress.tab.design',
  keytip: 'G',
  groups: [
    {
      id: 'themes',
      labelKey: 'impress.group.themes',
      controls: [button('themes', 'impress.cmd.themes', uno('.uno:ThemeDialog'), { size: 'large', icon: IconPalette, keytip: 'H', tipKey: 'impress.tip.themes' })],
    },
    {
      id: 'customize',
      labelKey: 'impress.group.customize',
      controls: [
        button('slideSize', 'impress.cmd.slideProperties', uno('.uno:PageSetup'), { size: 'large', icon: IconAspectRatio, keytip: 'S', tipKey: 'impress.tip.slideProperties' }),
        button('background', 'impress.cmd.backgroundImage', uno('.uno:SelectBackground'), { size: 'large', icon: IconBackground, keytip: 'B' }),
        toggle('design.master', 'impress.cmd.slideMaster', '.uno:SlideMasterPage', { size: 'large', icon: IconLayoutDashboard, keytip: 'M' }),
      ],
    },
  ],
};

const transitions: RibbonTab = {
  id: 'transitions',
  labelKey: 'impress.tab.transitions',
  keytip: 'K',
  groups: [
    {
      id: 'transition',
      labelKey: 'impress.group.transitionToSlide',
      controls: [button('transitionsPane', 'impress.cmd.transitions', uno('.uno:SlideChangeWindow'), { size: 'large', icon: IconTransitionRight, keytip: 'T', tipKey: 'impress.tip.transitions' })],
    },
  ],
};

const animations: RibbonTab = {
  id: 'animations',
  labelKey: 'impress.tab.animations',
  keytip: 'A',
  groups: [
    {
      id: 'animation',
      labelKey: 'impress.group.animation',
      controls: [
        button('animationPane', 'impress.cmd.animationPane', uno('.uno:CustomAnimation'), { size: 'large', icon: IconSparkles, keytip: 'C', tipKey: 'impress.tip.animationPane' }),
        button('anim.interaction', 'impress.cmd.interaction', uno('.uno:AnimationEffects'), { size: 'large', icon: IconWand, keytip: 'Q' }),
      ],
    },
  ],
};

const slideShow: RibbonTab = {
  id: 'slideShow',
  labelKey: 'impress.tab.slideShow',
  keytip: 'S',
  groups: [
    {
      id: 'start',
      labelKey: 'impress.group.startSlideShow',
      controls: [
        button('fromBeginning', 'impress.cmd.fromBeginning', uno('.uno:Presentation'), { size: 'large', icon: IconPlayerPlay, keytip: 'B', shortcut: 'F5', tipKey: 'impress.tip.fromBeginning' }),
        button('fromCurrent', 'impress.cmd.fromCurrent', uno('.uno:PresentationCurrentSlide'), { size: 'large', icon: IconPresentation, keytip: 'C', shortcut: 'Shift+F5' }),
        button('customShow', 'impress.cmd.customShow', uno('.uno:CustomShowDialog'), { size: 'large', icon: IconSlideshow, keytip: 'W' }),
      ],
    },
    {
      id: 'setup',
      labelKey: 'impress.group.setUp',
      controls: [
        button('setupShow', 'impress.cmd.setUpShow', uno('.uno:PresentationDialog'), { size: 'large', icon: IconSettings, keytip: 'S' }),
        button('hideSlide', 'impress.cmd.hideSlide', uno('.uno:HideSlide'), { icon: IconEyeOff, keytip: 'H' }),
        button('showSlide', 'impress.cmd.showSlide', uno('.uno:ShowSlide'), { icon: IconEye, keytip: 'U' }),
        button('rehearse', 'impress.cmd.rehearseTimings', uno('.uno:RehearseTimings'), { icon: IconTimeline, keytip: 'T' }),
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
        button('spelling', 'common.cmd.spelling', uno('.uno:SpellDialog'), { size: 'large', icon: IconTextSpellcheck, keytip: 'SP', shortcut: 'F7' }),
        thesaurus('E'),
        autoSpell('O'),
      ],
    },
    {
      id: 'comments',
      labelKey: 'common.group.comments',
      controls: [
        insertComment('C'),
        split('deleteComment', 'common.cmd.deleteComment', uno('.uno:DeleteAnnotation'), [
          item('delComment.one', 'common.cmd.deleteComment', uno('.uno:DeleteAnnotation')),
          item('delComment.all', 'common.cmd.deleteAllComments', uno('.uno:DeleteAllAnnotation')),
        ], { icon: IconMessageX, keytip: 'D' }),
        button('prevComment', 'impress.cmd.previousComment', uno('.uno:PreviousAnnotation'), { icon: IconArrowBigLeft, keytip: 'V' }),
        button('nextComment', 'impress.cmd.nextComment', uno('.uno:NextAnnotation'), { icon: IconArrowBigRight, keytip: 'N' }),
        showComments('SC'),
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
      id: 'presentationViews',
      labelKey: 'impress.group.presentationViews',
      controls: [
        toggle('normalView', 'impress.cmd.normalView', '.uno:NormalMultiPaneGUI', { size: 'large', icon: IconPresentation, keytip: 'N', exclusive: true }),
        toggle('outlineView', 'impress.cmd.outlineView', '.uno:OutlineMode', { size: 'large', icon: IconLayoutList, keytip: 'O', exclusive: true }),
        toggle('sorterView', 'impress.cmd.sorterView', '.uno:DiaMode', { size: 'large', icon: IconLayoutGrid, keytip: 'D', exclusive: true }),
        toggle('notesView', 'impress.cmd.notesView', '.uno:NotesMode', { size: 'large', icon: IconNotes, keytip: 'T', exclusive: true }),
      ],
    },
    {
      id: 'masterViews',
      labelKey: 'impress.group.masterViews',
      controls: [
        toggle('slideMaster', 'impress.cmd.slideMaster', '.uno:SlideMasterPage', { icon: IconLayoutDashboard, keytip: 'M', exclusive: true }),
        toggle('handoutMaster', 'impress.cmd.handoutMaster', '.uno:HandoutMode', { icon: IconPresentationAnalytics, keytip: 'H', exclusive: true }),
        toggle('notesMaster', 'impress.cmd.notesMaster', '.uno:NotesMasterPage', { icon: IconNote, keytip: 'G', exclusive: true }),
        button('closeMaster', 'impress.cmd.closeMaster', uno('.uno:CloseMasterView'), { icon: IconX, keytip: 'C' }),
      ],
    },
    {
      id: 'show',
      labelKey: 'common.group.show',
      controls: [
        toggle('ruler', 'impress.cmd.ruler', '.uno:ShowRuler', { icon: IconRuler, keytip: 'R' }),
        toggle('grid', 'impress.cmd.grid', '.uno:GridVisible', { icon: IconGridDots, keytip: 'L' }),
        toggle('guides', 'impress.cmd.guides', '.uno:HelplinesVisible', { icon: IconBorderStyle, keytip: 'U' }),
      ],
    },
    {
      id: 'zoom',
      labelKey: 'common.group.zoom',
      controls: [
        button('zoom', 'common.cmd.zoom', uno('.uno:Zoom'), { size: 'large', icon: IconZoomIn, keytip: 'Q' }),
        button('fitWindow', 'impress.cmd.fitToWindow', uno('.uno:ZoomPage'), { size: 'large', icon: IconAspectRatio, keytip: 'F' }),
      ],
    },
    {
      id: 'colorMode',
      labelKey: 'impress.group.colorMode',
      controls: [
        menu('colorMode', 'impress.cmd.colorMode', [
          checkItem('cm.color', 'impress.cmd.color', '.uno:OutputQualityColor'),
          checkItem('cm.grayscale', 'impress.cmd.grayscale', '.uno:OutputQualityGrayscale'),
          checkItem('cm.bw', 'impress.cmd.blackWhite', '.uno:OutputQualityBlackWhite'),
        ], { size: 'large', icon: IconContrast, keytip: 'K' }),
      ],
    },
  ],
};

// ------------------------------------------------------------------ Contextual

const table: RibbonTab = {
  id: 'tableLayout',
  labelKey: 'common.tab.tableLayout',
  keytip: 'JT',
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
      ],
    },
    {
      id: 'cellAlignment',
      labelKey: 'common.group.alignment',
      controls: [
        toggle('cellTop', 'common.cmd.cellTop', '.uno:CellVertTop', { icon: IconAlignBoxTopCenter, keytip: 'CT' }),
        toggle('cellMiddle', 'common.cmd.cellMiddle', '.uno:CellVertCenter', { icon: IconAlignBoxCenterMiddle, keytip: 'CC' }),
        toggle('cellBottom', 'common.cmd.cellBottom', '.uno:CellVertBottom', { icon: IconAlignBoxBottomCenter, keytip: 'CB' }),
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
        button('changePicture', 'common.cmd.changePicture', uno('.uno:ChangePicture'), { icon: IconPhotoEdit, keytip: 'G' }),
        button('savePicture', 'common.cmd.savePicture', uno('.uno:SaveGraphic'), { icon: IconDeviceFloppy, keytip: 'SV' }),
        positionAndSize('SZ'),
      ],
    },
    objectArrangeGroup('pictureArrange', { front: 'AF', back: 'AE', forward: 'FW', backward: 'BW', align: 'AA', group: 'U', flip: 'AY' }),
  ],
};

const shapeFormat: RibbonTab = {
  id: 'shapeFormat',
  labelKey: 'common.tab.shapeFormat',
  keytip: 'JD',
  contexts: ['Draw', 'DrawText', 'DrawFontwork', 'DrawLine', 'TextObject', 'MultiObject', '3DObject'],
  contextualColor: 'drawing',
  groups: [
    {
      id: 'shapeStyles',
      labelKey: 'common.group.shapeStyles',
      controls: [
        fillColor('ctx.shapeFill', 'impress.cmd.shapeFill', '.uno:FillColor', 'SF'),
        lineColor(),
        button('formatArea', 'common.cmd.formatArea', uno('.uno:FormatArea'), { icon: IconPaint, keytip: 'R' }),
        button('formatLine', 'common.cmd.formatLine', uno('.uno:FormatLine'), { icon: IconLineHeight, keytip: 'L' }),
        positionAndSize('SZ'),
      ],
    },
    objectArrangeGroup('shapeArrange', { front: 'AF', back: 'AE', forward: 'FW', backward: 'BW', align: 'AA', group: 'G', flip: 'AY' }),
  ],
};

export const impressRibbon: ModuleRibbon = {
  module: 'impress',
  tabs: [home, insert, design, transitions, animations, slideShow, review, view, table, pictureFormat, shapeFormat],
};
