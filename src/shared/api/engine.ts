/** `engine:*` and `view:*` — commands and native document views for office documents. Owner: main/engine + main/platform. */
import type { CellInfo, CommandState, DocInfo, SlideInfo, UnoArg } from '../engine-protocol';

/** Rectangle in CSS pixels, relative to the window's web content (getBoundingClientRect()). */
export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Allow-listed engine queries the renderer may call (no raw UNO access from the renderer). */
export interface EngineQueries {
  'doc.info': { params: Record<string, never>; result: DocInfo };
  'calc.activeCell': { params: Record<string, never>; result: CellInfo };
  'calc.gotoCell': { params: { reference: string }; result: { ok: true } };
  'calc.setActiveCellContent': { params: { content: string }; result: { ok: true } };
  'impress.slides': { params: Record<string, never>; result: { slides: SlideInfo[] } };
  'impress.gotoSlide': { params: { index: number }; result: { ok: true } };
}

export type EngineQuery = keyof EngineQueries;

export interface EngineChannels {
  /** Executes a `.uno:` command in the document's frame. Commands are validated against the ribbon registry allow-list. */
  'engine:dispatch': { req: { docId: string; command: string; args?: Record<string, UnoArg> }; res: void };
  'engine:subscribe': { req: { docId: string; commands: string[] }; res: CommandState[] };
  'engine:query': { req: { docId: string; query: EngineQuery; params?: Record<string, unknown> }; res: unknown };
  /** Position of the document area; the main process maps it to the native LibreOffice window. */
  'view:setBounds': { req: { docId: string; rect: CssRect }; res: void };
  'view:setVisible': { req: { docId: string; visible: boolean }; res: void };
  'view:focus': { req: { docId: string }; res: void };
  /**
   * Simpaper's own controls need the keyboard (a text box was clicked, a prompt or the File backstage opened): Windows
   * leaves the focus in LibreOffice's window when the web content is clicked. True when it was taken from there.
   */
  'view:focusShell': { req: void; res: boolean };
  /**
   * Airspace workaround: captures the native view into an image (data URL), then hides the native window
   * so HTML popups/dialogs can be drawn over the document area. Returns null if no native view is shown.
   */
  'view:freeze': { req: { docId: string }; res: string | null };
  'view:unfreeze': { req: { docId: string }; res: void };
}

export const ENGINE_CHANNELS = [
  'engine:dispatch',
  'engine:subscribe',
  'engine:query',
  'view:setBounds',
  'view:setVisible',
  'view:focus',
  'view:focusShell',
  'view:freeze',
  'view:unfreeze',
] as const;
