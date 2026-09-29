/** Non-blocking message bars (errors, notices, compatibility hints) for the active document and global ones. */
import { useTranslation } from 'react-i18next';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import { translateExternal } from '../i18n';
import { dismissMessage, useApp, type MessageBarItem } from '../state/appStore';

const ICONS = {
  error: IconAlertCircle,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
  success: IconCircleCheck,
} as const;

export function MessageBars() {
  const activeDocId = useApp((s) => s.activeDocId);
  const messages = useApp((s) => s.messages);
  const visible = messages.filter((m) => m.docId === null || m.docId === activeDocId);
  if (visible.length === 0) return null;
  return (
    <div className="vr-msgbars">
      {visible.slice(-3).map((m) => (
        <MessageBar key={m.id} message={m} />
      ))}
    </div>
  );
}

function MessageBar({ message }: { message: MessageBarItem }) {
  const { t } = useTranslation();
  const Icon = ICONS[message.kind];
  const text = translateExternal(message.key, message.values, message.kind === 'error' ? 'shell.messages.genericError' : 'shell.messages.genericNotice');
  return (
    <div className={`vr-msgbar vr-msgbar--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} stroke={1.75} aria-hidden="true" className="vr-msgbar__icon" />
      <span className="vr-msgbar__text">
        {text}
        {message.detail && <span className="vr-msgbar__detail"> ({message.detail})</span>}
      </span>
      {message.action && (
        <button
          type="button"
          className="vr-btn vr-btn--small"
          onClick={() => {
            message.action?.run();
            dismissMessage(message.id);
          }}
        >
          {t(message.action.labelKey)}
        </button>
      )}
      <button type="button" className="vr-msgbar__close" aria-label={t('common.actions.dismiss')} onClick={() => dismissMessage(message.id)}>
        <IconX size={14} stroke={2} aria-hidden="true" />
      </button>
    </div>
  );
}
