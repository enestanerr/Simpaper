/**
 * Ribbon controls shared by the office modules. Argument forms were verified on LibreOffice 26.8
 * (see docs/dev/shell-ui.md): CharFontName.FamilyName, FontHeight.Height (float), Color / CharBackColor /
 * BackgroundColor as long with -1 = automatic, StyleApply(Style, FamilyName), Zoom.Value.
 */
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowRight,
  IconBold,
  IconBoxMultiple,
  IconBrush,
  IconChartBar,
  IconCircle,
  IconClearFormatting,
  IconClipboard,
  IconClipboardText,
  IconCopy,
  IconFlipHorizontal,
  IconFlipVertical,
  IconHighlight,
  IconItalic,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLetterCase,
  IconLine,
  IconLink,
  IconMessage,
  IconMessagePlus,
  IconOmega,
  IconPhoto,
  IconBox,
  IconScissors,
  IconSearch,
  IconSelectAll,
  IconShape,
  IconSignature,
  IconSquare,
  IconStackBack,
  IconStackFront,
  IconStar,
  IconStrikethrough,
  IconTextColor,
  IconTextDecrease,
  IconTextIncrease,
  IconTriangle,
  IconTypography,
  IconUnderline,
  IconZoomIn,
  IconAbc,
  IconVocabulary,
  IconMessages,
  IconDimensions,
  IconBucketDroplet,
  IconBorderOuter,
} from '@tabler/icons-react';
import type { UnoArg } from '@shared/engine-protocol';
import type {
  ButtonControl,
  ColorControl,
  ComboControl,
  MenuControl,
  MenuItem,
  RibbonAction,
  RibbonControl,
  RibbonStateBinding,
  SplitButtonControl,
  ToggleControl,
} from '../../ribbon/types';

// ------------------------------------------------------------------ action helpers

export function uno(command: string, args?: Record<string, UnoArg>): RibbonAction {
  return args ? { type: 'uno', command, args } : { type: 'uno', command };
}

export function shell(id: string, payload?: unknown): RibbonAction {
  return payload === undefined ? { type: 'shell', id } : { type: 'shell', id, payload };
}

export function toggleState(command: string): RibbonStateBinding {
  return { command };
}

export const AUTOMATIC_COLOR = -1;

export function colorArg(color: number | null): UnoArg {
  return { type: 'long', value: color === null ? AUTOMATIC_COLOR : color & 0xffffff };
}

export function fontNameAction(name: string): RibbonAction {
  return uno('.uno:CharFontName', { 'CharFontName.FamilyName': name });
}

export function fontSizeAction(size: string): RibbonAction {
  return uno('.uno:FontHeight', { 'FontHeight.Height': { type: 'float', value: Number(size) } });
}

export function styleAction(style: string, family: 'ParagraphStyles' | 'CellStyles'): RibbonAction {
  return uno('.uno:StyleApply', { Style: style, FamilyName: family });
}

type Opt<T> = Partial<Omit<T, 'type' | 'id' | 'labelKey'>>;

export function button(id: string, labelKey: string, action: RibbonAction, o: Opt<ButtonControl> = {}): ButtonControl {
  return { type: 'button', id, labelKey, action, ...o };
}

/** Toggle whose pressed state follows the command it executes. */
export function toggle(id: string, labelKey: string, command: string, o: Opt<ToggleControl> = {}): ToggleControl {
  return { type: 'toggle', id, labelKey, action: uno(command), state: toggleState(command), ...o };
}

export function menu(id: string, labelKey: string, items: MenuItem[], o: Opt<MenuControl> = {}): MenuControl {
  return { type: 'menu', id, labelKey, items, ...o };
}

export function split(id: string, labelKey: string, action: RibbonAction, items: MenuItem[], o: Opt<SplitButtonControl> = {}): SplitButtonControl {
  return { type: 'split', id, labelKey, action, items, ...o };
}

export function item(id: string, labelKey: string, action: RibbonAction, o: Partial<Omit<MenuItem, 'id' | 'labelKey' | 'action'>> = {}): MenuItem {
  return { id, labelKey, action, ...o };
}

/** Menu item reflecting a checked state (e.g. freeze first row). */
export function checkItem(id: string, labelKey: string, command: string, o: Partial<Omit<MenuItem, 'id' | 'labelKey' | 'action'>> = {}): MenuItem {
  return { id, labelKey, action: uno(command), state: toggleState(command), ...o };
}

// ------------------------------------------------------------------ clipboard

export function pasteSplit(extra: MenuItem[] = []): SplitButtonControl {
  return split(
    'paste',
    'common.cmd.paste',
    uno('.uno:Paste'),
    [
      item('paste.default', 'common.cmd.paste', uno('.uno:Paste'), { icon: IconClipboard, shortcut: 'Ctrl+V' }),
      item('paste.special', 'common.cmd.pasteSpecial', uno('.uno:PasteSpecial'), { shortcut: 'Ctrl+Alt+V' }),
      item('paste.unformatted', 'common.cmd.pasteUnformatted', uno('.uno:PasteUnformatted'), { icon: IconClipboardText }),
      ...extra,
    ],
    { size: 'large', icon: IconClipboard, keytip: 'V', shortcut: 'Ctrl+V', tipKey: 'common.tip.paste' },
  );
}

export function clipboardControls(pasteExtra: MenuItem[] = []): RibbonControl[] {
  return [
    pasteSplit(pasteExtra),
    button('cut', 'common.cmd.cut', uno('.uno:Cut'), { icon: IconScissors, keytip: 'X', shortcut: 'Ctrl+X', tipKey: 'common.tip.cut' }),
    button('copy', 'common.cmd.copy', uno('.uno:Copy'), { icon: IconCopy, keytip: 'C', shortcut: 'Ctrl+C', tipKey: 'common.tip.copy' }),
    toggle('formatPainter', 'common.cmd.formatPainter', '.uno:FormatPaintbrush', { icon: IconBrush, keytip: 'FP', tipKey: 'common.tip.formatPainter' }),
  ];
}

// ------------------------------------------------------------------ font

export function fontNameCombo(): ComboControl {
  return {
    type: 'combo',
    id: 'fontName',
    labelKey: 'common.cmd.fontName',
    tipKey: 'common.tip.fontName',
    icon: IconTypography,
    keytip: 'FF',
    width: 17,
    options: 'fonts',
    editable: true,
    state: { command: '.uno:CharFontName' },
    toAction: fontNameAction,
  };
}

export function fontSizeCombo(): ComboControl {
  return {
    type: 'combo',
    id: 'fontSize',
    labelKey: 'common.cmd.fontSize',
    tipKey: 'common.tip.fontSize',
    keytip: 'FS',
    width: 5,
    options: 'fontSizes',
    editable: true,
    state: { command: '.uno:FontHeight' },
    toAction: fontSizeAction,
  };
}

export const growFont = (): ButtonControl =>
  button('growFont', 'common.cmd.growFont', uno('.uno:Grow'), { icon: IconTextIncrease, keytip: 'FG', shortcut: 'Ctrl+]', tipKey: 'common.tip.growFont' });
export const shrinkFont = (): ButtonControl =>
  button('shrinkFont', 'common.cmd.shrinkFont', uno('.uno:Shrink'), { icon: IconTextDecrease, keytip: 'FK', shortcut: 'Ctrl+[', tipKey: 'common.tip.shrinkFont' });

export function changeCaseMenu(extra: MenuItem[] = []): MenuControl {
  return menu(
    'changeCase',
    'common.cmd.changeCase',
    [
      item('case.sentence', 'common.cmd.caseSentence', uno('.uno:ChangeCaseToSentenceCase')),
      item('case.lower', 'common.cmd.caseLower', uno('.uno:ChangeCaseToLower')),
      item('case.upper', 'common.cmd.caseUpper', uno('.uno:ChangeCaseToUpper')),
      item('case.title', 'common.cmd.caseTitle', uno('.uno:ChangeCaseToTitleCase')),
      item('case.toggle', 'common.cmd.caseToggle', uno('.uno:ChangeCaseToToggleCase')),
      ...extra,
    ],
    { icon: IconLetterCase, keytip: '7', tipKey: 'common.tip.changeCase' },
  );
}

export function clearFormatting(command: '.uno:ResetAttributes' | '.uno:SetDefault'): ButtonControl {
  return button('clearFormatting', 'common.cmd.clearFormatting', uno(command), { icon: IconClearFormatting, keytip: 'E', tipKey: 'common.tip.clearFormatting' });
}

export const bold = (): ToggleControl =>
  toggle('bold', 'common.cmd.bold', '.uno:Bold', { icon: IconBold, keytip: '1', shortcut: 'Ctrl+B', tipKey: 'common.tip.bold', newRow: true });
export const italic = (): ToggleControl => toggle('italic', 'common.cmd.italic', '.uno:Italic', { icon: IconItalic, keytip: '2', shortcut: 'Ctrl+I', tipKey: 'common.tip.italic' });

export function underlineSplit(): SplitButtonControl {
  return split(
    'underline',
    'common.cmd.underline',
    uno('.uno:Underline'),
    [
      item('underline.single', 'common.cmd.underline', uno('.uno:Underline'), { state: toggleState('.uno:Underline') }),
      item('underline.double', 'common.cmd.doubleUnderline', uno('.uno:UnderlineDouble'), { state: toggleState('.uno:UnderlineDouble') }),
    ],
    { icon: IconUnderline, keytip: '3', shortcut: 'Ctrl+U', state: toggleState('.uno:Underline'), tipKey: 'common.tip.underline' },
  );
}

export const strikethrough = (): ToggleControl =>
  toggle('strikethrough', 'common.cmd.strikethrough', '.uno:Strikeout', { icon: IconStrikethrough, keytip: '4', tipKey: 'common.tip.strikethrough' });

export function fontColor(): ColorControl {
  return {
    type: 'color',
    id: 'fontColor',
    labelKey: 'common.cmd.fontColor',
    tipKey: 'common.tip.fontColor',
    icon: IconTextColor,
    keytip: 'FC',
    defaultColor: 0xc0303f,
    state: { command: '.uno:Color' },
    toAction: (color) => uno('.uno:Color', { Color: colorArg(color) }),
  };
}

export function highlightColor(): ColorControl {
  return {
    type: 'color',
    id: 'highlight',
    labelKey: 'common.cmd.highlight',
    tipKey: 'common.tip.highlight',
    icon: IconHighlight,
    keytip: 'HL',
    defaultColor: 0xffff00,
    palette: 'highlight',
    noneLabelKey: 'shell.color.noColor',
    state: { command: '.uno:CharBackColor' },
    toAction: (color) => uno('.uno:CharBackColor', { CharBackColor: colorArg(color) }),
  };
}

export function fillColor(id: string, labelKey: string, command: '.uno:BackgroundColor' | '.uno:FillColor', keytip: string, tipKey?: string): ColorControl {
  const arg = command === '.uno:BackgroundColor' ? 'BackgroundColor' : 'FillColor';
  return {
    type: 'color',
    id,
    labelKey,
    tipKey,
    icon: IconBucketDroplet,
    keytip,
    defaultColor: 0xfcc419,
    noneLabelKey: 'shell.color.noColor',
    state: { command },
    toAction: (color) => uno(command, { [arg]: colorArg(color) }),
  };
}

export function lineColor(): ColorControl {
  return {
    type: 'color',
    id: 'lineColor',
    labelKey: 'common.cmd.lineColor',
    icon: IconBorderOuter,
    keytip: 'SO',
    defaultColor: 0x1d2b53,
    noneLabelKey: 'shell.color.noLine',
    state: { command: '.uno:XLineColor' },
    toAction: (color) => uno('.uno:XLineColor', { XLineColor: colorArg(color) }),
  };
}

// ------------------------------------------------------------------ paragraph alignment

export function alignToggles(): ToggleControl[] {
  return [
    toggle('alignLeft', 'common.cmd.alignLeft', '.uno:LeftPara', { icon: IconAlignLeft, keytip: 'AL', shortcut: 'Ctrl+L', newRow: true }),
    toggle('alignCenter', 'common.cmd.alignCenter', '.uno:CenterPara', { icon: IconAlignCenter, keytip: 'AC', shortcut: 'Ctrl+E' }),
    toggle('alignRight', 'common.cmd.alignRight', '.uno:RightPara', { icon: IconAlignRight, keytip: 'AR', shortcut: 'Ctrl+R' }),
    toggle('justify', 'common.cmd.justify', '.uno:JustifyPara', { icon: IconAlignJustified, keytip: 'AJ', shortcut: 'Ctrl+J' }),
  ];
}

export function lineSpacingItems(): MenuItem[] {
  return [
    checkItem('spacing.1', 'common.cmd.spacing1', '.uno:SpacePara1'),
    checkItem('spacing.15', 'common.cmd.spacing15', '.uno:SpacePara15'),
    checkItem('spacing.2', 'common.cmd.spacing2', '.uno:SpacePara2'),
    item('spacing.options', 'common.cmd.paragraphOptions', uno('.uno:ParagraphDialog'), { separatorBefore: true }),
  ];
}

// ------------------------------------------------------------------ insert

export function shapesMenu(keytip = 'SH'): MenuControl {
  return menu(
    'shapes',
    'common.cmd.shapes',
    [
      item('shape.rect', 'common.shape.rectangle', uno('.uno:BasicShapes.rectangle'), { icon: IconSquare }),
      item('shape.roundRect', 'common.shape.roundedRectangle', uno('.uno:BasicShapes.round-rectangle')),
      item('shape.ellipse', 'common.shape.ellipse', uno('.uno:BasicShapes.ellipse'), { icon: IconCircle }),
      item('shape.triangle', 'common.shape.triangle', uno('.uno:BasicShapes.isosceles-triangle'), { icon: IconTriangle }),
      item('shape.rightTriangle', 'common.shape.rightTriangle', uno('.uno:BasicShapes.right-triangle')),
      item('shape.diamond', 'common.shape.diamond', uno('.uno:BasicShapes.diamond')),
      item('shape.pentagon', 'common.shape.pentagon', uno('.uno:BasicShapes.pentagon')),
      item('shape.hexagon', 'common.shape.hexagon', uno('.uno:BasicShapes.hexagon')),
      item('shape.line', 'common.shape.line', uno('.uno:Line'), { icon: IconLine, separatorBefore: true }),
      item('shape.rightArrow', 'common.shape.rightArrow', uno('.uno:ArrowShapes.right-arrow'), { icon: IconArrowRight }),
      item('shape.leftRightArrow', 'common.shape.leftRightArrow', uno('.uno:ArrowShapes.left-right-arrow')),
      item('shape.upArrow', 'common.shape.upArrow', uno('.uno:ArrowShapes.up-arrow')),
      item('shape.star', 'common.shape.star', uno('.uno:StarShapes.star5'), { icon: IconStar, separatorBefore: true }),
      item('shape.callout', 'common.shape.callout', uno('.uno:CalloutShapes.round-rectangular-callout'), { icon: IconMessage }),
      item('shape.cloud', 'common.shape.cloud', uno('.uno:CalloutShapes.cloud-callout')),
    ],
    { size: 'large', icon: IconShape, keytip, tipKey: 'common.tip.shapes' },
  );
}

export const insertPicture = (keytip = 'P'): ButtonControl =>
  button('picture', 'common.cmd.picture', uno('.uno:InsertGraphic'), { size: 'large', icon: IconPhoto, keytip, tipKey: 'common.tip.picture' });
export const insertChart = (keytip = 'C'): ButtonControl =>
  button('chart', 'common.cmd.chart', uno('.uno:InsertObjectChart'), { size: 'large', icon: IconChartBar, keytip, tipKey: 'common.tip.chart' });
export const insertLink = (keytip = 'K'): ButtonControl =>
  button('link', 'common.cmd.link', uno('.uno:HyperlinkDialog'), { size: 'large', icon: IconLink, keytip, shortcut: 'Ctrl+K', tipKey: 'common.tip.link' });
export const insertComment = (keytip = 'M'): ButtonControl =>
  button('comment', 'common.cmd.comment', uno('.uno:InsertAnnotation'), { size: 'large', icon: IconMessagePlus, keytip, shortcut: 'Ctrl+Alt+C', tipKey: 'common.tip.comment' });
export const insertSymbol = (keytip = 'U'): ButtonControl =>
  button('symbol', 'common.cmd.symbol', uno('.uno:InsertSymbol'), { size: 'large', icon: IconOmega, keytip, tipKey: 'common.tip.symbol' });
export const insertObject = (keytip = 'J'): ButtonControl =>
  button('object', 'common.cmd.object', uno('.uno:InsertObject'), { icon: IconBox, keytip });
export const insertSignature = (keytip = 'G'): ButtonControl =>
  button('signatureLine', 'common.cmd.signatureLine', uno('.uno:InsertSignatureLine'), { icon: IconSignature, keytip });
export const insertFontwork = (keytip = 'W'): ButtonControl =>
  button('fontwork', 'common.cmd.fontwork', uno('.uno:FontworkGalleryFloater'), { icon: IconTypography, keytip });

// ------------------------------------------------------------------ objects

export function alignObjectsMenu(keytip = 'AA'): MenuControl {
  return menu(
    'alignObjects',
    'common.cmd.alignObjects',
    [
      item('objAlign.left', 'common.cmd.objAlignLeft', uno('.uno:ObjectAlignLeft'), { icon: IconLayoutAlignLeft }),
      item('objAlign.center', 'common.cmd.objAlignCenter', uno('.uno:AlignCenter'), { icon: IconLayoutAlignCenter }),
      item('objAlign.right', 'common.cmd.objAlignRight', uno('.uno:ObjectAlignRight'), { icon: IconLayoutAlignRight }),
      item('objAlign.top', 'common.cmd.objAlignTop', uno('.uno:AlignUp'), { icon: IconLayoutAlignTop, separatorBefore: true }),
      item('objAlign.middle', 'common.cmd.objAlignMiddle', uno('.uno:AlignMiddle'), { icon: IconLayoutAlignMiddle }),
      item('objAlign.bottom', 'common.cmd.objAlignBottom', uno('.uno:AlignDown'), { icon: IconLayoutAlignBottom }),
    ],
    { icon: IconLayoutAlignLeft, keytip },
  );
}

export function groupMenu(keytip = 'G'): MenuControl {
  return menu(
    'groupObjects',
    'common.cmd.group',
    [
      item('group.group', 'common.cmd.group', uno('.uno:FormatGroup'), { icon: IconBoxMultiple }),
      item('group.ungroup', 'common.cmd.ungroup', uno('.uno:FormatUngroup')),
    ],
    { icon: IconBoxMultiple, keytip },
  );
}

export function flipMenu(extra: MenuItem[] = [], keytip = 'AY'): MenuControl {
  return menu(
    'rotate',
    'common.cmd.rotate',
    [
      ...extra,
      item('flip.vertical', 'common.cmd.flipVertical', uno('.uno:FlipVertical'), { icon: IconFlipVertical }),
      item('flip.horizontal', 'common.cmd.flipHorizontal', uno('.uno:FlipHorizontal'), { icon: IconFlipHorizontal }),
    ],
    { icon: IconFlipHorizontal, keytip },
  );
}

export const bringToFront = (keytip = 'AF'): ButtonControl => button('bringToFront', 'common.cmd.bringToFront', uno('.uno:BringToFront'), { icon: IconStackFront, keytip });
export const sendToBack = (keytip = 'AE'): ButtonControl => button('sendToBack', 'common.cmd.sendToBack', uno('.uno:SendToBack'), { icon: IconStackBack, keytip });
export const positionAndSize = (keytip = 'SZ'): ButtonControl =>
  button('positionSize', 'common.cmd.positionSize', uno('.uno:TransformDialog'), { icon: IconDimensions, keytip });

// ------------------------------------------------------------------ editing & review

export const findReplace = (keytip = 'FD'): ButtonControl =>
  button('findReplace', 'common.cmd.findReplace', uno('.uno:SearchDialog'), { icon: IconSearch, keytip, shortcut: 'Ctrl+H', tipKey: 'common.tip.findReplace' });
export const selectAll = (keytip = 'SL'): ButtonControl =>
  button('selectAll', 'common.cmd.selectAll', uno('.uno:SelectAll'), { icon: IconSelectAll, keytip, shortcut: 'Ctrl+A' });
export const thesaurus = (keytip = 'E'): ButtonControl =>
  button('thesaurus', 'common.cmd.thesaurus', uno('.uno:ThesaurusDialog'), { icon: IconVocabulary, keytip, shortcut: 'Ctrl+F7' });
export const autoSpell = (keytip = 'AS'): ToggleControl => toggle('autoSpell', 'common.cmd.autoSpell', '.uno:SpellOnline', { icon: IconAbc, keytip, tipKey: 'common.tip.autoSpell' });
export const showComments = (keytip = 'SC'): ToggleControl => toggle('showComments', 'common.cmd.showComments', '.uno:ShowAnnotations', { icon: IconMessages, keytip });

// ------------------------------------------------------------------ undo/redo (QAT)

export const UNDO_ICON = IconArrowBackUp;
export const REDO_ICON = IconArrowForwardUp;
export const ZOOM_ICON = IconZoomIn;
