/** Shows prompts from the main process (documents:event 'prompt') one at a time and sends the answers back. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconLock } from '@tabler/icons-react';
import type { Prompt, PromptAnswer } from '@shared/api/documents';
import { getFormat } from '@shared/formats';
import { answerPrompt } from '../../services/documents';
import { useApp } from '../../state/appStore';
import { Dialog } from '../../ui/Dialog';
import { FindingList } from '../backstage/InfoPage';
import { CsvImportDialog } from './CsvImportDialog';

export function PromptHost() {
  const prompt = useApp((s) => s.prompts[0]);
  if (!prompt) return null;
  return <PromptView key={prompt.id} prompt={prompt} />;
}

function PromptView({ prompt }: { prompt: Prompt }) {
  const answer = (a: PromptAnswer) => void answerPrompt(prompt.id, a);
  switch (prompt.kind) {
    case 'password':
      return <PasswordDialog fileName={prompt.fileName} retry={prompt.retry} onAnswer={answer} />;
    case 'saveRisk':
      return <SaveRiskDialog prompt={prompt} onAnswer={answer} />;
    case 'unsavedChanges':
      return <UnsavedChangesDialog fileName={prompt.fileName} onAnswer={answer} />;
    case 'overwriteNewer':
      return <OverwriteNewerDialog fileName={prompt.fileName} onAnswer={answer} />;
    case 'closeStuck':
      return <CloseStuckDialog fileName={prompt.fileName} snapshotAt={prompt.snapshotAt} onAnswer={answer} />;
    case 'csvImport':
      return <CsvImportDialog prompt={prompt} onAnswer={answer} />;
  }
}

function PasswordDialog({ fileName, retry, onAnswer }: { fileName: string; retry: boolean; onAnswer: (a: PromptAnswer) => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const submit = () => onAnswer({ kind: 'password', password });
  const cancel = () => onAnswer({ kind: 'password', password: null });
  return (
    <Dialog
      title={t('shell.prompts.password.title')}
      icon={<IconLock size={22} stroke={1.75} />}
      onCancel={cancel}
      size="small"
      footer={
        <>
          <button type="button" className="vr-btn" onClick={cancel}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className="vr-btn vr-btn--primary" disabled={password.length === 0} onClick={submit}>
            {t('common.actions.ok')}
          </button>
        </>
      }
    >
      <p>{t('shell.prompts.password.body', { fileName })}</p>
      {retry && (
        <p className="vr-error-text" role="alert">
          {t('shell.prompts.password.wrong')}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password) submit();
        }}
      >
        <label className="vr-field">
          <span>{t('shell.prompts.password.label')}</span>
          <input
            className="vr-input"
            type="password"
            autoComplete="off"
            data-autofocus=""
            value={password}
            aria-invalid={retry || undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </form>
    </Dialog>
  );
}

function SaveRiskDialog({ prompt, onAnswer }: { prompt: Extract<Prompt, { kind: 'saveRisk' }>; onAnswer: (a: PromptAnswer) => void }) {
  const { t } = useTranslation();
  const choose = (choice: 'saveCopy' | 'saveAnyway' | 'saveOdf' | 'cancel') => onAnswer({ kind: 'saveRisk', choice });
  const format = getFormat(prompt.format);
  return (
    <Dialog
      title={t('shell.prompts.saveRisk.title')}
      icon={<IconAlertTriangle size={22} stroke={1.75} />}
      role="alertdialog"
      onCancel={() => choose('cancel')}
      size="large"
      footer={
        <>
          <button type="button" className="vr-btn" onClick={() => choose('cancel')}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className="vr-btn" onClick={() => choose('saveOdf')}>
            {t('shell.prompts.saveRisk.saveOdf')}
          </button>
          <button type="button" className="vr-btn vr-btn--danger" onClick={() => choose('saveAnyway')}>
            {t('shell.prompts.saveRisk.saveAnyway')}
          </button>
          <button type="button" className="vr-btn vr-btn--primary" data-autofocus="" onClick={() => choose('saveCopy')}>
            {t('shell.prompts.saveRisk.saveCopy')}
          </button>
        </>
      }
    >
      <p>{t('shell.prompts.saveRisk.body', { fileName: prompt.fileName, format: t(format.labelKey) })}</p>
      <FindingList findings={prompt.findings} />
      <p className="vr-muted">{t('shell.prompts.saveRisk.explain')}</p>
    </Dialog>
  );
}

function UnsavedChangesDialog({ fileName, onAnswer }: { fileName: string; onAnswer: (a: PromptAnswer) => void }) {
  const { t } = useTranslation();
  const choose = (choice: 'save' | 'discard' | 'cancel') => onAnswer({ kind: 'unsavedChanges', choice });
  return (
    <Dialog
      title={t('shell.prompts.unsaved.title')}
      role="alertdialog"
      onCancel={() => choose('cancel')}
      size="small"
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--primary" data-autofocus="" onClick={() => choose('save')}>
            {t('shell.prompts.unsaved.save')}
          </button>
          <button type="button" className="vr-btn" onClick={() => choose('discard')}>
            {t('shell.prompts.unsaved.discard')}
          </button>
          <button type="button" className="vr-btn" onClick={() => choose('cancel')}>
            {t('common.actions.cancel')}
          </button>
        </>
      }
    >
      <p>{t('shell.prompts.unsaved.body', { fileName })}</p>
    </Dialog>
  );
}

function OverwriteNewerDialog({ fileName, onAnswer }: { fileName: string; onAnswer: (a: PromptAnswer) => void }) {
  const { t } = useTranslation();
  const choose = (choice: 'overwrite' | 'saveCopy' | 'cancel') => onAnswer({ kind: 'overwriteNewer', choice });
  return (
    <Dialog
      title={t('shell.prompts.newer.title')}
      icon={<IconAlertTriangle size={22} stroke={1.75} />}
      role="alertdialog"
      onCancel={() => choose('cancel')}
      footer={
        <>
          <button type="button" className="vr-btn" onClick={() => choose('cancel')}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className="vr-btn vr-btn--danger" onClick={() => choose('overwrite')}>
            {t('shell.prompts.newer.overwrite')}
          </button>
          <button type="button" className="vr-btn vr-btn--primary" data-autofocus="" onClick={() => choose('saveCopy')}>
            {t('shell.prompts.newer.saveCopy')}
          </button>
        </>
      }
    >
      <p>{t('shell.prompts.newer.body', { fileName })}</p>
    </Dialog>
  );
}

/** A modified document whose engine hangs or stopped: closing it loses the edits after the newest recovery snapshot. */
function CloseStuckDialog({ fileName, snapshotAt, onAnswer }: { fileName: string; snapshotAt: string | null; onAnswer: (a: PromptAnswer) => void }) {
  const { t, i18n } = useTranslation();
  const choose = (choice: 'close' | 'cancel') => onAnswer({ kind: 'closeStuck', choice });
  const time = snapshotAt ? new Date(snapshotAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <Dialog
      title={t('shell.prompts.stuck.title')}
      icon={<IconAlertTriangle size={22} stroke={1.75} />}
      role="alertdialog"
      onCancel={() => choose('cancel')}
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--danger" onClick={() => choose('close')}>
            {t('shell.prompts.stuck.close')}
          </button>
          <button type="button" className="vr-btn vr-btn--primary" data-autofocus="" onClick={() => choose('cancel')}>
            {t('common.actions.cancel')}
          </button>
        </>
      }
    >
      <p>{t('shell.prompts.stuck.body', { fileName })}</p>
      <p>{time ? t('shell.prompts.stuck.snapshot', { time }) : t('shell.prompts.stuck.noSnapshot')}</p>
    </Dialog>
  );
}
