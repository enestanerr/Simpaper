/**
 * Declarative ribbon model. Module ribbons (writer/calc/impress/pdf) are data; the shell renders them.
 * Rule: every enabled control must perform a real action (see ribbon registry tests).
 */
import type { ComponentType } from 'react';
import type { UnoArg, UnoPlain } from '@shared/engine-protocol';
import type { ModuleKind } from '@shared/modules';

export type IconComponent = ComponentType<{ size?: number | string; stroke?: number | string; className?: string }>;

/** What happens when a control is activated. */
export type RibbonAction =
  /** `.uno:` command executed in the active office document (validated by the main process). */
  | { type: 'uno'; command: string; args?: Record<string, UnoArg> }
  /** Shell/module action implemented in the renderer (save, open backstage, PDF tools ...). */
  | { type: 'shell'; id: string; payload?: unknown };

/** How a control derives its checked/enabled/value state. */
export interface RibbonStateBinding {
  /** `.uno:` command whose FeatureStateEvent drives the control. */
  command: string;
  /** For toggles: map the UNO state to "pressed". Default: state === true. */
  pressed?: (value: UnoPlain) => boolean;
  /** For combo boxes/galleries: map the UNO state to the displayed value. */
  display?: (value: UnoPlain) => string;
}

interface ControlBase {
  id: string;
  /** i18n key of the label; also used as accessible name. */
  labelKey: string;
  /** i18n key of the tooltip/ScreenTip description. */
  tipKey?: string;
  icon?: IconComponent;
  /** Office-style key tip (1–2 characters); unique within its tab. */
  keytip?: string;
  /** Shortcut shown in the tooltip, e.g. "Ctrl+B". */
  shortcut?: string;
  state?: RibbonStateBinding;
  /** Hide in narrow layouts before other controls (higher = collapses earlier). */
  collapsePriority?: number;
  /** `rows` group layout only: this control starts a new row (Office Font/Paragraph groups). */
  newRow?: boolean;
}

export interface ButtonControl extends ControlBase {
  type: 'button';
  size?: 'large' | 'small';
  action: RibbonAction;
}

export interface ToggleControl extends ControlBase {
  type: 'toggle';
  size?: 'large' | 'small';
  action: RibbonAction;
  /** Radio-like (view modes): activating it while already pressed does nothing. */
  exclusive?: boolean;
}

export interface MenuItem {
  id: string;
  labelKey: string;
  icon?: IconComponent;
  action: RibbonAction;
  state?: RibbonStateBinding;
  shortcut?: string;
  /** Draws a separator line above this item. */
  separatorBefore?: boolean;
}

export interface SplitButtonControl extends ControlBase {
  type: 'split';
  size?: 'large' | 'small';
  action: RibbonAction;
  items: MenuItem[];
}

export interface MenuControl extends ControlBase {
  type: 'menu';
  size?: 'large' | 'small';
  items: MenuItem[];
}

export interface ComboControl extends ControlBase {
  type: 'combo';
  /** Width in characters. */
  width?: number;
  /** Static options, or `fonts` for the installed font list provided by the shell. */
  options: { value: string; labelKey?: string; label?: string }[] | 'fonts' | 'fontSizes';
  editable?: boolean;
  /** Builds the action from the chosen/typed value. */
  toAction: (value: string) => RibbonAction;
}

export interface ColorControl extends ControlBase {
  type: 'color';
  /** Builds the action for a chosen color (0xRRGGBB) or `null` for "automatic/none". */
  toAction: (color: number | null) => RibbonAction;
  defaultColor: number | null;
  /** `standard` (default): hue × shade grid; `highlight`: text highlighter colours. */
  palette?: 'standard' | 'highlight';
  /** i18n key of the `null` choice (default "Automatic"; e.g. "No Color" for fills). */
  noneLabelKey?: string;
}

export interface GalleryItem {
  id: string;
  label?: string;
  labelKey?: string;
  action: RibbonAction;
  /** Optional CSS preview (e.g. heading styles). */
  previewStyle?: Record<string, string | number>;
}

export interface GalleryControl extends ControlBase {
  type: 'gallery';
  items: GalleryItem[];
  /** Items visible inline before the "more" dropdown. */
  inlineCount?: number;
}

/** Custom control rendered by a module (e.g. Calc number format box, zoom slider). */
export interface CustomControl extends ControlBase {
  type: 'custom';
  render: ComponentType<{ docId: string | null }>;
  /** Width in CSS pixels used by the adaptive layout (default 64). */
  estimatedWidth?: number;
  /** Commands whose state the control reads (subscribed by the shell). */
  stateCommands?: string[];
}

export type RibbonControl =
  | ButtonControl
  | ToggleControl
  | SplitButtonControl
  | MenuControl
  | ComboControl
  | ColorControl
  | GalleryControl
  | CustomControl;

export interface RibbonGroup {
  id: string;
  labelKey: string;
  controls: RibbonControl[];
  /** Dialog launcher in the group's corner (e.g. Font dialog). */
  launcher?: RibbonAction;
  /** i18n key of the launcher's accessible name/tooltip (default: "<group> settings"). */
  launcherLabelKey?: string;
  /**
   * `columns` (default): large controls and stacks of up to three small controls.
   * `rows`: small controls flow into horizontal rows, a control with `newRow` starts the next row.
   */
  layout?: 'columns' | 'rows';
}

export interface RibbonTab {
  id: string;
  labelKey: string;
  keytip: string;
  groups: RibbonGroup[];
  /** Contextual tab: shown only while the engine reports one of these LibreOffice contexts (e.g. "Table", "Graphic"). */
  contexts?: string[];
  /** Accent color key for contextual tab headers. */
  contextualColor?: 'table' | 'picture' | 'drawing' | 'chart';
}

export interface ModuleRibbon {
  module: ModuleKind;
  tabs: RibbonTab[];
}

/** Shell action ids that every module can use. */
export const SHELL_ACTIONS = {
  save: 'file.save',
  saveAs: 'file.saveAs',
  exportPdf: 'file.exportPdf',
  print: 'file.print',
  openBackstage: 'file.backstage',
  newDocument: 'file.new',
  open: 'file.open',
  close: 'file.close',
  undo: 'edit.undo',
  redo: 'edit.redo',
  find: 'edit.find',
  replace: 'edit.replace',
  toggleRibbon: 'view.toggleRibbon',
  zoomIn: 'view.zoomIn',
  zoomOut: 'view.zoomOut',
} as const;
