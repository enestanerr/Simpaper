/**
 * Contract between the shell and a module workspace.
 * The shell owns title bar, tabs, backstage, ribbon rendering and status bar layout; a module provides
 * its ribbon definition, its document surface and its status bar items.
 */
import type { ComponentType } from 'react';
import type { DocumentDescriptor } from '@shared/api/documents';
import type { ModuleKind } from '@shared/modules';
import type { IconComponent, ModuleRibbon, RibbonAction, RibbonStateBinding } from '../ribbon/types';

/** Zoom source of a module (drives the status bar zoom slider). */
export interface ZoomState {
  /** Current zoom in percent; null while unknown. */
  value: number | null;
  min: number;
  max: number;
  set(value: number): void;
  step(direction: 1 | -1): void;
  /** Opens the module's zoom dialog (optional). */
  openDialog?(): void;
}

/** View switch button in the status bar (e.g. Normal / Page break preview). */
export interface StatusViewButton {
  id: string;
  labelKey: string;
  icon: IconComponent;
  action: RibbonAction;
  state?: RibbonStateBinding;
}

export interface WorkspaceProps {
  doc: DocumentDescriptor;
  /** True while this document is the active tab. Inactive workspaces must hide native views. */
  active: boolean;
}

export interface ModuleDefinition {
  kind: ModuleKind;
  ribbon: ModuleRibbon;
  /** Renders the editing area (native LibreOffice view placeholder, or the pdf.js viewer). */
  Workspace: ComponentType<WorkspaceProps>;
  /** Status bar content for the active document. */
  StatusBar?: ComponentType<{ doc: DocumentDescriptor }>;
  /** Optional strip rendered between ribbon and workspace (Calc formula bar). */
  Toolstrip?: ComponentType<{ doc: DocumentDescriptor }>;
  /** Shell actions implemented by the module (ribbon `shell` actions with this module's ids). */
  actions?: Record<string, (doc: DocumentDescriptor | null, payload?: unknown) => void | Promise<void>>;
  /**
   * Pushes edits the renderer holds for a document of this module to the main process (the PDF module's
   * pdf.js annotation storage → working copy). Called for every open document id before it is closed and when
   * the main process asks (`flushRequest` before save/close/quit); must resolve at once for unknown ids.
   */
  flush?: (docId: string) => Promise<void>;
  /**
   * React hook providing the zoom of a document; the status bar shows the zoom slider only when set.
   * Called unconditionally inside a component keyed by module kind, so it may use other hooks.
   */
  useZoom?: (doc: DocumentDescriptor) => ZoomState;
  /** View buttons shown in the status bar next to the zoom slider. */
  statusViews?: StatusViewButton[];
}
