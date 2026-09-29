/** `engine:*` and `view:*` handlers: allow-listed commands and queries for office documents. */
import type { EngineChannels, EngineQuery } from '@shared/api/engine';
import { isAllowedUnoArgs } from '@shared/commands';
import type { EngineMethod } from '@shared/engine-protocol';
import { isOfficeKind, type OfficeKind } from '@shared/modules';
import { DocumentError } from '../../documents/errors';
import type { EngineInstance } from '../../engine/types';
import type { Handler } from '../router';
import type { IpcServices } from '../services';
import { arr, bool, cssRect, docId, int, obj, oneOf, opt, plainObject, req, str, unoArgs, unoCommand, unoDispatchCommand, type Validator } from '../validate';

interface QuerySpec {
  kinds: readonly OfficeKind[];
  params: Validator<Record<string, unknown>>;
}

const noParams = obj({});

/** Mirrors EngineQueries (src/shared/api/engine.ts); anything else is rejected. */
export const QUERY_SPECS: Record<EngineQuery, QuerySpec> = {
  'doc.info': { kinds: ['writer', 'calc', 'impress'], params: noParams },
  'calc.activeCell': { kinds: ['calc'], params: noParams },
  'calc.gotoCell': { kinds: ['calc'], params: obj({ reference: req(str({ min: 1, max: 256 })) }) },
  'calc.setActiveCellContent': { kinds: ['calc'], params: obj({ content: req(str({ max: 32_767 })) }) },
  'impress.slides': { kinds: ['impress'], params: noParams },
  'impress.gotoSlide': { kinds: ['impress'], params: obj({ index: req(int(0, 100_000)) }) },
};

const QUERIES = Object.keys(QUERY_SPECS) as EngineQuery[];

export function engineHandlers(s: IpcServices): Record<keyof EngineChannels, Handler> {
  /** Office document that is loaded and has a running engine instance. */
  const officeDoc = (id: string): { kind: OfficeKind; instance: EngineInstance } => {
    const record = s.documents.get(id);
    if (!record) throw new DocumentError('errors.ipc.unknownDocument');
    const kind = record.descriptor.kind;
    if (!isOfficeKind(kind)) throw new DocumentError('errors.ipc.invalidRequest');
    const instance = s.documents.instanceOf(id);
    if (!instance || record.descriptor.state !== 'ready') throw new DocumentError('errors.save.notReady');
    return { kind, instance };
  };
  /** View calls race with closing documents; unknown documents are ignored. */
  const known = (id: string) => s.documents.get(id) !== undefined;

  return {
    'engine:dispatch': async (p) => {
      const r = obj({ docId: req(docId), command: req(unoDispatchCommand), args: opt(unoArgs) })(p, 'req');
      const { kind, instance } = officeDoc(r.docId);
      if (!s.isAllowedUnoCommand(kind, r.command)) {
        s.log.warn('blocked command', { kind, command: r.command });
        throw new DocumentError('errors.command.notAllowed');
      }
      // Only the arguments the ribbons send: file/URL arguments would load resources without the user's choice.
      if (!isAllowedUnoArgs(r.command, r.args)) {
        s.log.warn('blocked command arguments', { kind, command: r.command, args: Object.keys(r.args ?? {}).slice(0, 10) });
        throw new DocumentError('errors.command.notAllowed');
      }
      // A command may open a LibreOffice dialog: let soffice activate it (it is not the foreground process).
      const officePid = instance.info().officePid;
      if (officePid) s.allowEngineForeground?.(officePid);
      await instance.call('cmd.dispatch', { docId: r.docId, command: r.command, ...(r.args ? { args: r.args } : {}) });
    },
    'engine:subscribe': async (p) => {
      const r = obj({ docId: req(docId), commands: req(arr(unoCommand, 500)) })(p, 'req');
      const { kind, instance } = officeDoc(r.docId);
      // State observation is read-only: commands outside the allow-list are dropped, not fatal.
      const allowed = s.isSubscribableUnoCommand ? r.commands.filter((c) => s.isSubscribableUnoCommand?.(kind, c)) : r.commands;
      if (allowed.length < r.commands.length) s.log.warn('state subscription filtered', { kind, dropped: r.commands.length - allowed.length });
      if (!allowed.length) return [];
      const res = await instance.call('cmd.subscribe', { docId: r.docId, commands: allowed });
      return res.states;
    },
    'engine:query': async (p) => {
      const r = obj({ docId: req(docId), query: req(oneOf(QUERIES)), params: opt(plainObject) })(p, 'req');
      const spec = QUERY_SPECS[r.query];
      const params = spec.params(r.params ?? {}, 'req.params');
      const { kind, instance } = officeDoc(r.docId);
      if (!spec.kinds.includes(kind)) throw new DocumentError('errors.ipc.invalidRequest');
      const method = r.query as EngineMethod;
      return (instance.call as (m: EngineMethod, params: unknown) => Promise<unknown>)(method, { ...params, docId: r.docId });
    },
    'view:setBounds': (p) => {
      const r = obj({ docId: req(docId), rect: req(cssRect) })(p, 'req');
      if (!known(r.docId)) return;
      s.documents.noteViewRect(r.docId, r.rect);
      try {
        s.viewHost.setBounds(r.docId, r.rect);
      } catch {
        // view not attached yet: applied when the document finishes loading
      }
    },
    'view:setVisible': (p) => {
      const r = obj({ docId: req(docId), visible: req(bool) })(p, 'req');
      if (!known(r.docId)) return;
      s.documents.noteViewVisible(r.docId, r.visible);
      try {
        s.viewHost.setVisible(r.docId, r.visible);
      } catch {
        // not attached
      }
    },
    'view:focus': (p) => {
      const r = obj({ docId: req(docId) })(p, 'req');
      if (!known(r.docId)) return;
      // Native activation (owned mode) and the engine's own keyboard focus (docs/dev/platform.md §2.4).
      s.documents.focusView(r.docId);
    },
    'view:freeze': async (p) => {
      const r = obj({ docId: req(docId) })(p, 'req');
      if (!known(r.docId)) return null;
      try {
        return await s.viewHost.freeze(r.docId);
      } catch (err) {
        s.log.warn('view freeze failed', { docId: r.docId, error: err });
        return null;
      }
    },
    'view:unfreeze': (p) => {
      const r = obj({ docId: req(docId) })(p, 'req');
      if (!known(r.docId)) return;
      try {
        s.viewHost.unfreeze(r.docId);
      } catch {
        // not attached
      }
    },
  };
}
