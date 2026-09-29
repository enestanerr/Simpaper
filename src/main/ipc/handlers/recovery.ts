/** `recovery:*` handlers. */
import type { RecoveryChannels } from '@shared/api/recovery';
import type { Handler } from '../router';
import type { IpcServices } from '../services';
import { none, obj, req, str } from '../validate';

const idReq = obj({ id: req(str({ min: 3, max: 129, pattern: /^[A-Za-z0-9-]{1,64}\.[A-Za-z0-9-]{1,64}$/ })) });

export function recoveryHandlers(s: IpcServices): Record<keyof RecoveryChannels, Handler> {
  return {
    'recovery:list': (p) => {
      none(p, 'req');
      return s.recovery.list();
    },
    'recovery:restore': (p) => s.recovery.restore(idReq(p, 'req').id),
    'recovery:discard': (p) => s.recovery.discard(idReq(p, 'req').id),
  };
}
