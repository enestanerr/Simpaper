/**
 * PDF ribbon: Home / Annotate / Pages / Forms / View. All actions are `shell` actions implemented in
 * ./actions (ModuleDefinition.actions); toggle states come from the `pdf:*` entries this module publishes
 * to the shell's command store (see ./state/commandBridge).
 */
import {
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconArrowBackUp,
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconArrowForwardUp,
  IconArrowMoveDown,
  IconArrowMoveUp,
  IconBallpen,
  IconBook,
  IconBook2,
  IconChevronDown,
  IconChevronUp,
  IconClipboardCopy,
  IconCopyPlus,
  IconDeviceFloppy,
  IconFileExport,
  IconFilePlus,
  IconFiles,
  IconFileText,
  IconFocus2,
  IconHighlight,
  IconLayoutColumns,
  IconLayoutRows,
  IconLayoutSidebar,
  IconListNumbers,
  IconMessagePlus,
  IconPhoto,
  IconPhotoPlus,
  IconPointer,
  IconPrinter,
  IconRotate,
  IconRotate2,
  IconRotateClockwise,
  IconRotateClockwise2,
  IconSearch,
  IconSelect,
  IconSquareCheck,
  IconTextPlus,
  IconTrash,
  IconTypography,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
} from '@tabler/icons-react';
import type { UnoPlain } from '@shared/engine-protocol';
import { SHELL_ACTIONS, type ModuleRibbon, type RibbonAction, type RibbonControl, type RibbonStateBinding } from '@renderer/ribbon/types';
import { PDF_ACTIONS } from './actions';
import { PageNumberBox, TextSizeChooser, ThicknessChooser, ZoomBox } from './components/RibbonControls';
import { PDF_STATE } from './state/commandBridge';

const shell = (id: string, payload?: unknown): RibbonAction => (payload === undefined ? { type: 'shell', id } : { type: 'shell', id, payload });
const is =
  (expected: UnoPlain): RibbonStateBinding['pressed'] =>
  (value) =>
    value === expected;

function tool(id: string, toolName: string, labelKey: string, icon: RibbonControl['icon'], keytip: string, size: 'large' | 'small' = 'large'): RibbonControl {
  return {
    id,
    type: 'toggle',
    size,
    labelKey,
    tipKey: `${labelKey}Tip`,
    icon,
    keytip,
    action: shell(PDF_ACTIONS.tool, toolName),
    state: { command: PDF_STATE.tool, pressed: is(toolName) },
  };
}

const zoomBox: RibbonControl = { id: 'zoomBox', type: 'custom', labelKey: 'pdf.ribbon.zoom', render: ZoomBox, estimatedWidth: 150, keytip: 'Z' };

export const pdfRibbon: ModuleRibbon = {
  module: 'pdf',
  tabs: [
    {
      id: 'home',
      labelKey: 'pdf.ribbon.tabs.home',
      keytip: 'H',
      groups: [
        {
          id: 'document',
          labelKey: 'pdf.ribbon.groups.document',
          controls: [
            { id: 'save', type: 'button', size: 'large', labelKey: 'pdf.ribbon.save', tipKey: 'pdf.ribbon.saveTip', icon: IconDeviceFloppy, keytip: 'S', shortcut: 'Ctrl+S', action: shell(SHELL_ACTIONS.save) },
            { id: 'print', type: 'button', size: 'large', labelKey: 'pdf.ribbon.print', tipKey: 'pdf.ribbon.printTip', icon: IconPrinter, keytip: 'P', shortcut: 'Ctrl+P', action: shell(SHELL_ACTIONS.print) },
            { id: 'copy', type: 'button', size: 'small', labelKey: 'pdf.ribbon.copy', tipKey: 'pdf.ribbon.copyTip', icon: IconClipboardCopy, keytip: 'C', shortcut: 'Ctrl+C', action: shell(PDF_ACTIONS.copy) },
          ],
        },
        {
          id: 'tools',
          labelKey: 'pdf.ribbon.groups.tools',
          controls: [
            tool('toolSelect', 'none', 'pdf.ribbon.select', IconPointer, 'E'),
            tool('toolHighlight', 'highlight', 'pdf.ribbon.highlight', IconHighlight, 'H'),
            { id: 'addText', type: 'button', size: 'large', labelKey: 'pdf.ribbon.addText', tipKey: 'pdf.ribbon.addTextTip', icon: IconTextPlus, keytip: 'T', action: shell(PDF_ACTIONS.addText) },
            { id: 'find', type: 'button', size: 'large', labelKey: 'pdf.ribbon.find', tipKey: 'pdf.ribbon.findTip', icon: IconSearch, keytip: 'F', shortcut: 'Ctrl+F', action: shell(SHELL_ACTIONS.find) },
          ],
        },
        {
          id: 'navigate',
          labelKey: 'pdf.ribbon.groups.navigate',
          controls: [
            { id: 'pageBox', type: 'custom', labelKey: 'pdf.ribbon.page', render: PageNumberBox, estimatedWidth: 118, keytip: 'G' },
            { id: 'previousPage', type: 'button', size: 'small', labelKey: 'pdf.ribbon.previousPage', icon: IconChevronUp, keytip: 'V', shortcut: 'PgUp', action: shell(PDF_ACTIONS.previousPage) },
            { id: 'nextPage', type: 'button', size: 'small', labelKey: 'pdf.ribbon.nextPage', icon: IconChevronDown, keytip: 'N', shortcut: 'PgDn', action: shell(PDF_ACTIONS.nextPage) },
            { id: 'firstPage', type: 'button', size: 'small', labelKey: 'pdf.ribbon.firstPage', icon: IconArrowBarToUp, keytip: 'B', shortcut: 'Home', action: shell(PDF_ACTIONS.firstPage) },
            { id: 'lastPage', type: 'button', size: 'small', labelKey: 'pdf.ribbon.lastPage', icon: IconArrowBarToDown, keytip: 'L', shortcut: 'End', action: shell(PDF_ACTIONS.lastPage) },
          ],
        },
        {
          id: 'zoom',
          labelKey: 'pdf.ribbon.groups.zoom',
          controls: [
            zoomBox,
            { id: 'zoomIn', type: 'button', size: 'small', labelKey: 'pdf.ribbon.zoomIn', icon: IconZoomIn, keytip: 'U', shortcut: 'Ctrl++', action: shell(SHELL_ACTIONS.zoomIn) },
            { id: 'zoomOut', type: 'button', size: 'small', labelKey: 'pdf.ribbon.zoomOut', icon: IconZoomOut, keytip: 'O', shortcut: 'Ctrl+-', action: shell(SHELL_ACTIONS.zoomOut) },
            { id: 'fitWidth', type: 'button', size: 'small', labelKey: 'pdf.ribbon.fitWidth', icon: IconArrowAutofitWidth, keytip: 'W', action: shell(PDF_ACTIONS.fitWidth) },
            { id: 'fitPage', type: 'button', size: 'small', labelKey: 'pdf.ribbon.fitPage', icon: IconArrowAutofitHeight, keytip: 'D', action: shell(PDF_ACTIONS.fitPage) },
          ],
        },
      ],
    },
    {
      id: 'annotate',
      labelKey: 'pdf.ribbon.tabs.annotate',
      keytip: 'C',
      groups: [
        {
          id: 'annotationTools',
          labelKey: 'pdf.ribbon.groups.annotationTools',
          controls: [
            tool('aSelect', 'none', 'pdf.ribbon.select', IconPointer, 'S'),
            tool('aHighlight', 'highlight', 'pdf.ribbon.highlight', IconHighlight, 'H'),
            tool('aFreeText', 'freetext', 'pdf.ribbon.freeText', IconTypography, 'T'),
            tool('aInk', 'ink', 'pdf.ribbon.draw', IconBallpen, 'D'),
            tool('aStamp', 'stamp', 'pdf.ribbon.stamp', IconPhoto, 'G'),
            { id: 'highlightSelection', type: 'button', size: 'small', labelKey: 'pdf.ribbon.highlightSelection', tipKey: 'pdf.ribbon.highlightSelectionTip', icon: IconSelect, keytip: 'L', action: shell(PDF_ACTIONS.highlightSelection) },
          ],
        },
        {
          id: 'style',
          labelKey: 'pdf.ribbon.groups.style',
          controls: [
            {
              id: 'annotationColor',
              type: 'color',
              labelKey: 'pdf.ribbon.color',
              tipKey: 'pdf.ribbon.colorTip',
              keytip: 'C',
              defaultColor: 0xe03131,
              noneLabelKey: 'pdf.ribbon.defaultColor',
              toAction: (color) => shell(PDF_ACTIONS.color, color),
            },
            { id: 'textSize', type: 'custom', labelKey: 'pdf.ribbon.textSize', render: TextSizeChooser, estimatedWidth: 118, keytip: 'Z' },
            { id: 'thickness', type: 'custom', labelKey: 'pdf.ribbon.thickness', render: ThicknessChooser, estimatedWidth: 118, keytip: 'K' },
          ],
        },
        {
          id: 'comments',
          labelKey: 'pdf.ribbon.groups.comments',
          controls: [
            { id: 'comment', type: 'button', size: 'large', labelKey: 'pdf.ribbon.comment', tipKey: 'pdf.ribbon.commentTip', icon: IconMessagePlus, keytip: 'M', action: shell(PDF_ACTIONS.comment) },
          ],
        },
        {
          id: 'edit',
          labelKey: 'pdf.ribbon.groups.edit',
          controls: [
            { id: 'undo', type: 'button', size: 'small', labelKey: 'pdf.ribbon.undo', icon: IconArrowBackUp, keytip: 'U', shortcut: 'Ctrl+Z', action: shell(SHELL_ACTIONS.undo) },
            { id: 'redo', type: 'button', size: 'small', labelKey: 'pdf.ribbon.redo', icon: IconArrowForwardUp, keytip: 'R', shortcut: 'Ctrl+Y', action: shell(SHELL_ACTIONS.redo) },
            { id: 'deleteAnnotation', type: 'button', size: 'small', labelKey: 'pdf.ribbon.deleteAnnotation', tipKey: 'pdf.ribbon.deleteAnnotationTip', icon: IconTrash, keytip: 'X', shortcut: 'Del', action: shell(PDF_ACTIONS.deleteAnnotation) },
          ],
        },
      ],
    },
    {
      id: 'pages',
      labelKey: 'pdf.ribbon.tabs.pages',
      keytip: 'P',
      groups: [
        {
          id: 'organize',
          labelKey: 'pdf.ribbon.groups.organize',
          controls: [
            { id: 'deletePages', type: 'button', size: 'large', labelKey: 'pdf.ribbon.deletePages', tipKey: 'pdf.ribbon.deletePagesTip', icon: IconTrash, keytip: 'D', action: shell(PDF_ACTIONS.deletePages) },
            { id: 'rotateLeft', type: 'button', size: 'small', labelKey: 'pdf.ribbon.rotateLeft', tipKey: 'pdf.ribbon.rotatePagesTip', icon: IconRotate2, keytip: 'L', action: shell(PDF_ACTIONS.rotatePagesCcw) },
            { id: 'rotateRight', type: 'button', size: 'small', labelKey: 'pdf.ribbon.rotateRight', tipKey: 'pdf.ribbon.rotatePagesTip', icon: IconRotateClockwise2, keytip: 'R', action: shell(PDF_ACTIONS.rotatePagesCw) },
            { id: 'duplicatePages', type: 'button', size: 'small', labelKey: 'pdf.ribbon.duplicatePages', tipKey: 'pdf.ribbon.duplicatePagesTip', icon: IconCopyPlus, keytip: 'U', action: shell(PDF_ACTIONS.duplicatePages) },
            { id: 'movePagesUp', type: 'button', size: 'small', labelKey: 'pdf.ribbon.movePagesUp', icon: IconArrowMoveUp, keytip: 'K', shortcut: 'Alt+↑', action: shell(PDF_ACTIONS.movePagesUp) },
            { id: 'movePagesDown', type: 'button', size: 'small', labelKey: 'pdf.ribbon.movePagesDown', icon: IconArrowMoveDown, keytip: 'J', shortcut: 'Alt+↓', action: shell(PDF_ACTIONS.movePagesDown) },
            { id: 'selectAllPages', type: 'button', size: 'small', labelKey: 'pdf.ribbon.selectAllPages', icon: IconListNumbers, keytip: 'A', action: shell(PDF_ACTIONS.selectAllPages) },
          ],
        },
        {
          id: 'insert',
          labelKey: 'pdf.ribbon.groups.insert',
          controls: [
            { id: 'insertBlank', type: 'button', size: 'large', labelKey: 'pdf.ribbon.insertBlank', tipKey: 'pdf.ribbon.insertBlankTip', icon: IconFilePlus, keytip: 'B', action: shell(PDF_ACTIONS.insertBlank) },
            { id: 'pAddText', type: 'button', size: 'large', labelKey: 'pdf.ribbon.addText', tipKey: 'pdf.ribbon.addTextTip', icon: IconTextPlus, keytip: 'T', action: shell(PDF_ACTIONS.addText) },
            { id: 'pAddImage', type: 'button', size: 'large', labelKey: 'pdf.ribbon.addImage', tipKey: 'pdf.ribbon.addImageTip', icon: IconPhotoPlus, keytip: 'G', action: shell(PDF_ACTIONS.addImage) },
          ],
        },
        {
          id: 'combine',
          labelKey: 'pdf.ribbon.groups.combine',
          controls: [
            { id: 'merge', type: 'button', size: 'large', labelKey: 'pdf.ribbon.merge', tipKey: 'pdf.ribbon.mergeTip', icon: IconFiles, keytip: 'M', action: shell(PDF_ACTIONS.merge) },
            { id: 'extract', type: 'button', size: 'large', labelKey: 'pdf.ribbon.extract', tipKey: 'pdf.ribbon.extractTip', icon: IconFileExport, keytip: 'X', action: shell(PDF_ACTIONS.extract) },
          ],
        },
      ],
    },
    {
      id: 'forms',
      labelKey: 'pdf.ribbon.tabs.forms',
      keytip: 'O',
      groups: [
        {
          id: 'fields',
          labelKey: 'pdf.ribbon.groups.fields',
          controls: [
            { id: 'previousField', type: 'button', size: 'large', labelKey: 'pdf.ribbon.previousField', tipKey: 'pdf.ribbon.previousFieldTip', icon: IconChevronUp, keytip: 'P', action: shell(PDF_ACTIONS.previousField) },
            { id: 'nextField', type: 'button', size: 'large', labelKey: 'pdf.ribbon.nextField', tipKey: 'pdf.ribbon.nextFieldTip', icon: IconChevronDown, keytip: 'N', action: shell(PDF_ACTIONS.nextField) },
            {
              id: 'highlightFields',
              type: 'toggle',
              size: 'large',
              labelKey: 'pdf.ribbon.highlightFields',
              tipKey: 'pdf.ribbon.highlightFieldsTip',
              icon: IconSquareCheck,
              keytip: 'H',
              action: shell(PDF_ACTIONS.highlightFields),
              state: { command: PDF_STATE.fieldsHighlighted, pressed: is(true) },
            },
          ],
        },
        {
          id: 'formFile',
          labelKey: 'pdf.ribbon.groups.document',
          controls: [
            { id: 'fSave', type: 'button', size: 'large', labelKey: 'pdf.ribbon.save', tipKey: 'pdf.ribbon.saveFormTip', icon: IconDeviceFloppy, keytip: 'S', action: shell(SHELL_ACTIONS.save) },
          ],
        },
      ],
    },
    {
      id: 'view',
      labelKey: 'pdf.ribbon.tabs.view',
      keytip: 'W',
      groups: [
        {
          id: 'show',
          labelKey: 'pdf.ribbon.groups.show',
          controls: [
            {
              id: 'thumbnails',
              type: 'toggle',
              size: 'large',
              labelKey: 'pdf.ribbon.thumbnails',
              tipKey: 'pdf.ribbon.thumbnailsTip',
              icon: IconLayoutSidebar,
              keytip: 'T',
              action: shell(PDF_ACTIONS.thumbnails),
              state: { command: PDF_STATE.sidebar, pressed: is(true) },
            },
          ],
        },
        {
          id: 'vZoom',
          labelKey: 'pdf.ribbon.groups.zoom',
          controls: [
            zoomBox,
            { id: 'vZoomIn', type: 'button', size: 'small', labelKey: 'pdf.ribbon.zoomIn', icon: IconZoomIn, keytip: 'U', action: shell(SHELL_ACTIONS.zoomIn) },
            { id: 'vZoomOut', type: 'button', size: 'small', labelKey: 'pdf.ribbon.zoomOut', icon: IconZoomOut, keytip: 'O', action: shell(SHELL_ACTIONS.zoomOut) },
            { id: 'actualSize', type: 'button', size: 'small', labelKey: 'pdf.ribbon.actualSize', icon: IconZoomReset, keytip: 'A', action: shell(PDF_ACTIONS.actualSize) },
            { id: 'vFitWidth', type: 'button', size: 'small', labelKey: 'pdf.ribbon.fitWidth', icon: IconArrowAutofitWidth, keytip: 'W', action: shell(PDF_ACTIONS.fitWidth) },
            { id: 'vFitPage', type: 'button', size: 'small', labelKey: 'pdf.ribbon.fitPage', icon: IconArrowAutofitHeight, keytip: 'F', action: shell(PDF_ACTIONS.fitPage) },
          ],
        },
        {
          id: 'rotateView',
          labelKey: 'pdf.ribbon.groups.rotateView',
          controls: [
            { id: 'rotateViewLeft', type: 'button', size: 'large', labelKey: 'pdf.ribbon.rotateViewLeft', tipKey: 'pdf.ribbon.rotateViewTip', icon: IconRotate, keytip: 'L', action: shell(PDF_ACTIONS.rotateViewCcw) },
            { id: 'rotateViewRight', type: 'button', size: 'large', labelKey: 'pdf.ribbon.rotateViewRight', tipKey: 'pdf.ribbon.rotateViewTip', icon: IconRotateClockwise, keytip: 'R', action: shell(PDF_ACTIONS.rotateViewCw) },
          ],
        },
        {
          id: 'layout',
          labelKey: 'pdf.ribbon.groups.layout',
          controls: [
            { id: 'scrollVertical', type: 'toggle', size: 'small', labelKey: 'pdf.ribbon.scrollVertical', icon: IconLayoutRows, keytip: 'V', action: shell(PDF_ACTIONS.scrollMode, 'vertical'), state: { command: PDF_STATE.scroll, pressed: is('vertical') } },
            { id: 'scrollWrapped', type: 'toggle', size: 'small', labelKey: 'pdf.ribbon.scrollWrapped', icon: IconLayoutColumns, keytip: 'E', action: shell(PDF_ACTIONS.scrollMode, 'wrapped'), state: { command: PDF_STATE.scroll, pressed: is('wrapped') } },
            { id: 'scrollPage', type: 'toggle', size: 'small', labelKey: 'pdf.ribbon.scrollPage', icon: IconFileText, keytip: 'P', action: shell(PDF_ACTIONS.scrollMode, 'page'), state: { command: PDF_STATE.scroll, pressed: is('page') } },
            { id: 'spreadNone', type: 'toggle', size: 'small', labelKey: 'pdf.ribbon.spreadNone', icon: IconFocus2, keytip: 'N', action: shell(PDF_ACTIONS.spreadMode, 'none'), state: { command: PDF_STATE.spread, pressed: is('none') } },
            { id: 'spreadOdd', type: 'toggle', size: 'small', labelKey: 'pdf.ribbon.spreadOdd', icon: IconBook, keytip: 'D', action: shell(PDF_ACTIONS.spreadMode, 'odd'), state: { command: PDF_STATE.spread, pressed: is('odd') } },
            { id: 'spreadEven', type: 'toggle', size: 'small', labelKey: 'pdf.ribbon.spreadEven', icon: IconBook2, keytip: 'G', action: shell(PDF_ACTIONS.spreadMode, 'even'), state: { command: PDF_STATE.spread, pressed: is('even') } },
          ],
        },
      ],
    },
  ],
};
