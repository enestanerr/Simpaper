import type { OfficeKind } from './modules';

/**
 * Wire protocol between the Electron main process and the engine bridge
 * (engine/bridge/simpaper_bridge, running on LibreOffice's bundled Python).
 *
 * Transport: newline-delimited JSON (one JSON-RPC 2.0 message per line, UTF-8) over the
 * bridge process' stdin (requests) and stdout (responses + notifications). stderr is for logs only.
 * The bridge talks UNO to its own soffice instance over a random, per-instance named pipe.
 *
 * Every method that touches a document or view is executed on LibreOffice's main thread
 * (com.sun.star.awt.AsyncCallback) so that UNO calls never race with VCL/Skia painting.
 */
export const ENGINE_PROTOCOL_VERSION = 1;

export interface RpcRequest<M extends EngineMethod = EngineMethod> {
  jsonrpc: '2.0';
  id: number;
  method: M;
  params: EngineMethods[M]['params'];
}

export interface RpcErrorObject {
  code: number;
  message: string;
  data?: { type?: string; trace?: string; [k: string]: unknown };
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: RpcErrorObject;
}

export interface RpcNotification {
  jsonrpc: '2.0';
  method: 'event';
  params: EngineEvent;
}

export const RPC_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  ENGINE_UNAVAILABLE: 1001,
  DOC_NOT_FOUND: 1002,
  LOAD_FAILED: 1003,
  PASSWORD_REQUIRED: 1004,
  WRONG_PASSWORD: 1005,
  STORE_FAILED: 1006,
  TIMEOUT: 1007,
  BUSY: 1008,
  UNSUPPORTED: 1009,
} as const;

/**
 * JSON-friendly representation of UNO values.
 * Plain JSON numbers are sent as `long` when integral and `double` otherwise; use the typed form
 * when LibreOffice expects a specific type (e.g. FontHeight.Height is a float).
 */
export type UnoTyped =
  | { type: 'float' | 'double'; value: number }
  | { type: 'byte' | 'short' | 'long' | 'hyper'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean };
export type UnoArg = string | number | boolean | null | UnoTyped | UnoArg[];

/** UNO values converted back to JSON: structs become plain objects (with `__type` holding the UNO type name). */
export type UnoPlain = string | number | boolean | null | UnoPlain[] | { [key: string]: UnoPlain };

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How the LibreOffice frame is attached to our window (see docs/adr/0003-document-surface.md):
 *  - `child`:  WS_CHILD of `parentHwnd` (createSystemChild).
 *  - `owned`:  borderless top-level window owned by `parentHwnd` (positioned in screen coordinates).
 *  - `hidden`: no visible window (tests, conversion, recovery snapshots).
 */
export type ViewMode = 'child' | 'owned' | 'hidden';

export interface ViewParams {
  mode: ViewMode;
  /** HWND of the host (decimal string; 64-bit safe). Required for `child` and `owned`. */
  parentHwnd?: string;
  /** Physical pixels. `child`: relative to the parent's client area. `owned`: screen coordinates. */
  bounds?: Bounds;
  /**
   * `child`/`owned`: keep the frame window hidden after loading (MediaDescriptor Hidden) until
   * `view.setVisible(true)`, e.g. to set the owner and position before the window appears.
   * Such a frame must be shown through the engine (`view.setVisible`), not only natively: LibreOffice
   * paints only windows it considers visible and does not notice a native ShowWindow/SetWindowPos.
   */
  startHidden?: boolean;
}

export interface DocLoadResult {
  docId: string;
  kind: OfficeKind | 'draw';
  title: string;
  /** Filter LibreOffice used to load the file (reused on save to keep the same flavour). */
  filterName: string;
  readOnly: boolean;
  /** Native window handle of the frame container (unsigned decimal string), when a view exists. */
  hwnd?: string;
  hasMacros: boolean;
  pageCount?: number;
  sheetNames?: string[];
  slideCount?: number;
}

export interface DocInfo {
  docId: string;
  modified: boolean;
  title: string;
  pageCount?: number;
  currentPage?: number;
  wordCount?: number;
  characterCount?: number;
  sheetNames?: string[];
  activeSheet?: string;
  slideCount?: number;
  /** 0-based index of the slide in the view (the index `impress.gotoSlide` takes); shown to people as index + 1. */
  currentSlide?: number;
  zoom?: number;
}

export interface CommandState {
  command: string;
  enabled: boolean;
  value: UnoPlain;
}

export interface CellInfo {
  address: string;
  sheet: string;
  /** Formula in English/API grammar (`;` separates parameters), e.g. `=IF(A1>0;"a";"b")`; empty for constants. */
  formula: string;
  /** Localised formula as shown in the formula bar (e.g. `=TOPLA(A1:A2)` in Turkish). */
  localFormula: string;
  value: number | string | null;
  display: string;
  type: 'empty' | 'value' | 'text' | 'formula';
  error?: string;
}

export interface SlideInfo {
  index: number;
  name: string;
  layout?: number;
  hidden: boolean;
  notes: string;
  /** Text of every shape on the slide in z-order ('' for shapes without text); index = shape index. */
  texts?: string[];
}

/** Method map: every RPC method with its params and result. */
export interface EngineMethods {
  'engine.hello': {
    params: { protocol: number };
    /** `bridgePid`: the bridge's Python interpreter (child of the python.exe launcher). */
    result: { protocol: number; bridgeVersion: string; officeVersion: string; pythonVersion: string; officePid?: number; bridgePid?: number };
  };
  'engine.shutdown': { params: Record<string, never>; result: { ok: true } };
  /**
   * Effective keyboard shortcuts of a module (module configuration first, then global), keyed by
   * LibreOffice accelerator key names such as `F12_SHIFT_MOD1` (MOD1 = Ctrl, MOD2 = Alt). `null` = unbound.
   */
  'engine.shortcuts': { params: { kind: OfficeKind; keys: string[] }; result: { bindings: Record<string, string | null> } };
  /** Reads configuration values of the running engine (diagnostics, profile verification). `nodepath` must start with /org.openoffice. */
  'engine.config': { params: { nodepath: string; names: string[] }; result: { values: Record<string, UnoPlain> } };

  'doc.load': {
    params: {
      docId: string;
      /** file:// URL of the working copy. */
      url: string;
      /** file:// URL of the user's original file; resolves relative links. */
      baseUrl?: string;
      filter?: string;
      filterOptions?: string;
      password?: string;
      readOnly?: boolean;
      view: ViewParams;
    };
    result: DocLoadResult;
  };
  'doc.new': { params: { docId: string; kind: OfficeKind; view: ViewParams }; result: DocLoadResult };
  /** storeToURL: writes a copy, keeps the document's location and does not reset the modified flag. */
  'doc.store': {
    params: {
      docId: string;
      url: string;
      filter: string;
      filterOptions?: string;
      filterData?: Record<string, UnoArg>;
      password?: string;
      /**
       * Real save (not a recovery snapshot or export): clear the document's modified flag in the same main-thread
       * job right after storeToURL succeeded, so edits made later (e.g. during verification) set it again.
       */
      markSaved?: boolean;
      /**
       * DocumentBaseURL for the export. `''` stores links absolute (recovery snapshots in a different folder than
       * the document, like LibreOffice's own AutoRecovery); omitted = LibreOffice's default (relative to `url`).
       */
      baseUrl?: string;
    };
    result: { ok: true };
  };
  'doc.info': { params: { docId: string }; result: DocInfo };
  'doc.setModified': { params: { docId: string; modified: boolean }; result: { ok: true } };
  'doc.close': { params: { docId: string }; result: { ok: true } };

  'view.setBounds': { params: { docId: string; bounds: Bounds }; result: { ok: true } };
  'view.setVisible': { params: { docId: string; visible: boolean }; result: { ok: true } };
  'view.focus': { params: { docId: string }; result: { ok: true } };

  'cmd.dispatch': { params: { docId: string; command: string; args?: Record<string, UnoArg> }; result: { ok: true } };
  'cmd.subscribe': { params: { docId: string; commands: string[] }; result: { states: CommandState[] } };
  'cmd.unsubscribe': { params: { docId: string; commands: string[] }; result: { ok: true } };
  /** Whether the document's frame has a dispatch for each command at all (queryDispatch), independent of its enabled state. */
  'cmd.available': { params: { docId: string; commands: string[] }; result: { available: Record<string, boolean> } };

  'writer.getText': { params: { docId: string }; result: { text: string } };
  'writer.insertText': { params: { docId: string; text: string }; result: { ok: true } };
  'calc.getCell': { params: { docId: string; sheet?: number | string; address: string }; result: CellInfo };
  /** `formula` in the API grammar of CellInfo.formula (English names, `;` separators); `value`: number or text. */
  'calc.setCell': { params: { docId: string; sheet?: number | string; address: string; formula?: string; value?: number | string }; result: { ok: true } };
  'calc.activeCell': { params: { docId: string }; result: CellInfo };
  'calc.gotoCell': { params: { docId: string; reference: string }; result: { ok: true } };
  'calc.setActiveCellContent': { params: { docId: string; content: string }; result: { ok: true } };
  'impress.slides': { params: { docId: string }; result: { slides: SlideInfo[] } };
  'impress.gotoSlide': { params: { docId: string; index: number }; result: { ok: true } };
  /** Replaces the text of shape `shape` (index into SlideInfo.texts) on slide `slide`. */
  'impress.setShapeText': { params: { docId: string; slide: number; shape: number; text: string }; result: { ok: true } };

  /** Headless conversion on a conversion-worker instance (no view). */
  'convert.file': {
    params: {
      input: string;
      output: string;
      filter: string;
      filterOptions?: string;
      importFilter?: string;
      importFilterOptions?: string;
      password?: string;
      filterData?: Record<string, UnoArg>;
    };
    result: { ok: true };
  };
}

export type EngineMethod = keyof EngineMethods;

/** Commands the bridge intercepts in every frame and reports as `intercept` events instead of executing. */
export const INTERCEPTED_COMMANDS = [
  '.uno:Save',
  '.uno:SaveAs',
  '.uno:SaveAll',
  '.uno:Open',
  '.uno:OpenRemote',
  '.uno:AddDirect',
  '.uno:NewDoc',
  '.uno:CloseDoc',
  '.uno:CloseWin',
  '.uno:Quit',
  '.uno:ExportToPDF',
  '.uno:ExportDirectToPDF',
  '.uno:SendMail',
  '.uno:SaveAsTemplate',
  '.uno:OpenTemplate',
  '.uno:OptionsTreeDialog',
  '.uno:About',
  '.uno:HelpIndex',
  '.uno:ExtendedHelp',
  '.uno:RunMacro',
  '.uno:MacroDialog',
  '.uno:ScriptOrganizer',
] as const;

export type EngineEvent =
  | { type: 'state'; docId: string; command: string; enabled: boolean; value: UnoPlain }
  | { type: 'intercept'; docId: string; command: string; args?: Record<string, UnoPlain> }
  | { type: 'modified'; docId: string; modified: boolean }
  | { type: 'context'; docId: string; application: string; context: string }
  | { type: 'selection'; docId: string }
  | { type: 'dialog'; open: boolean; title?: string }
  | { type: 'key'; docId: string; key: 'F6' | 'F10' | 'ShiftF6' | 'CtrlF1' | 'CtrlTab' | 'CtrlShiftTab' }
  | { type: 'closed'; docId: string }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string };
