/** Dialogs of the PDF module, built on the shell's accessible Dialog (focus trap, Esc, scrim). */
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@renderer/ui/Dialog';
import { controllerFor } from '../controller/registry';
import { parsePageRanges, planDelete } from '../logic/pages';
import { patchDoc, pushNotice, usePdfDoc, type PdfDialog } from '../state/store';
import { TEXT_SIZES } from './RibbonControls';

const TEXT_COLORS = ['#000000', '#1d2b53', '#c0303f', '#1e6b3a', '#1d4f91', '#8a5a00'];

function close(docId: string): void {
  patchDoc(docId, { dialog: null });
}

function PasswordDialog({ docId, retry }: { docId: string; retry: boolean }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const id = useId();
  const submit = () => controllerFor(docId)?.submitPassword(password);
  const cancel = () => controllerFor(docId)?.submitPassword(null);
  return (
    <Dialog
      title={t('pdf.dialogs.password.title')}
      onCancel={cancel}
      size="small"
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--primary" onClick={submit}>
            {t('pdf.dialogs.ok')}
          </button>
          <button type="button" className="vr-btn" onClick={cancel}>
            {t('pdf.dialogs.cancel')}
          </button>
        </>
      }
    >
      <form
        className="vpdf-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p>{t('pdf.dialogs.password.message')}</p>
        {retry && (
          <p className="vpdf-form__error" role="alert">
            {t('pdf.dialogs.password.wrong')}
          </p>
        )}
        <label htmlFor={id}>{t('pdf.dialogs.password.label')}</label>
        <input id={id} data-autofocus="" type="password" className="vr-input" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </form>
    </Dialog>
  );
}

function AddTextDialog({ docId, dialog }: { docId: string; dialog: Extract<PdfDialog, { kind: 'addText' }> }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [size, setSize] = useState(12);
  const [color, setColor] = useState(TEXT_COLORS[0]!);
  const textId = useId();
  const sizeId = useId();
  const valid = text.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    close(docId);
    void controllerFor(docId)?.insertText({ pageIndex: dialog.pageIndex, x: dialog.x, y: dialog.y, text, fontSize: size, color });
  };
  return (
    <Dialog
      title={t('pdf.dialogs.addText.title')}
      onCancel={() => close(docId)}
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--primary" disabled={!valid} onClick={submit}>
            {t('pdf.dialogs.addText.insert')}
          </button>
          <button type="button" className="vr-btn" onClick={() => close(docId)}>
            {t('pdf.dialogs.cancel')}
          </button>
        </>
      }
    >
      <div className="vpdf-form">
        <p className="vpdf-form__hint">{t('pdf.dialogs.addText.hint', { page: dialog.pageIndex + 1 })}</p>
        <label htmlFor={textId}>{t('pdf.dialogs.addText.text')}</label>
        <textarea
          id={textId}
          data-autofocus=""
          className="vr-input vpdf-form__textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="vpdf-form__row">
          <label htmlFor={sizeId}>{t('pdf.dialogs.addText.size')}</label>
          <select id={sizeId} className="vr-select" value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {TEXT_SIZES.map((s) => (
              <option key={s} value={s}>
                {t('pdf.units.pt', { value: s })}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="vpdf-swatches">
          <legend>{t('pdf.dialogs.addText.color')}</legend>
          {TEXT_COLORS.map((c) => (
            <label key={c} className="vpdf-swatch" title={t(`pdf.colors.${c.slice(1)}`)}>
              <input type="radio" name={`${textId}-color`} value={c} checked={color === c} onChange={() => setColor(c)} aria-label={t(`pdf.colors.${c.slice(1)}`)} />
              <span className="vpdf-swatch__chip" style={{ background: c }} aria-hidden="true" />
            </label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}

function CommentDialog({ docId, initial }: { docId: string; initial: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  const id = useId();
  const apply = (value: string) => {
    close(docId);
    if (!controllerFor(docId)?.setSelectedComment(value)) pushNotice(docId, { kind: 'info', key: 'pdf.notices.selectAnnotationFirst' });
  };
  return (
    <Dialog
      title={t(initial ? 'pdf.dialogs.comment.editTitle' : 'pdf.dialogs.comment.title')}
      onCancel={() => close(docId)}
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--primary" onClick={() => apply(text)}>
            {t('pdf.dialogs.save')}
          </button>
          {initial && (
            <button type="button" className="vr-btn vr-btn--danger" onClick={() => apply('')}>
              {t('pdf.dialogs.comment.remove')}
            </button>
          )}
          <button type="button" className="vr-btn" onClick={() => close(docId)}>
            {t('pdf.dialogs.cancel')}
          </button>
        </>
      }
    >
      <div className="vpdf-form">
        <label htmlFor={id}>{t('pdf.dialogs.comment.label')}</label>
        <textarea id={id} data-autofocus="" className="vr-input vpdf-form__textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    </Dialog>
  );
}

function ConfirmDeleteDialog({ docId, pages }: { docId: string; pages: number[] }) {
  const { t } = useTranslation();
  const pageCount = usePdfDoc(docId, (s) => s.pageCount);
  const confirm = () => {
    close(docId);
    const ops = planDelete(pages, pageCount);
    if (ops.length > 0) void controllerFor(docId)?.applyPageOps(ops, []);
  };
  return (
    <Dialog
      title={t('pdf.dialogs.deletePages.title')}
      role="alertdialog"
      size="small"
      onCancel={() => close(docId)}
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--danger" onClick={confirm}>
            {t('pdf.dialogs.deletePages.confirm')}
          </button>
          {/* Destructive dialog: the safe choice has the initial focus. */}
          <button type="button" className="vr-btn" data-autofocus="" onClick={() => close(docId)}>
            {t('pdf.dialogs.cancel')}
          </button>
        </>
      }
    >
      <p>{t('pdf.dialogs.deletePages.message', { count: pages.length, pages: pages.map((p) => p + 1).join(', ') })}</p>
    </Dialog>
  );
}

function ExtractDialog({ docId, initial }: { docId: string; initial: string }) {
  const { t } = useTranslation();
  const pageCount = usePdfDoc(docId, (s) => s.pageCount);
  const [value, setValue] = useState(initial);
  const id = useId();
  const hintId = useId();
  const pages = parsePageRanges(value, pageCount);
  const submit = () => {
    if (!pages) return;
    close(docId);
    void controllerFor(docId)?.extract(pages);
  };
  return (
    <Dialog
      title={t('pdf.dialogs.extract.title')}
      size="small"
      onCancel={() => close(docId)}
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--primary" disabled={!pages} onClick={submit}>
            {t('pdf.dialogs.extract.confirm')}
          </button>
          <button type="button" className="vr-btn" onClick={() => close(docId)}>
            {t('pdf.dialogs.cancel')}
          </button>
        </>
      }
    >
      <form
        className="vpdf-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id}>{t('pdf.dialogs.extract.label')}</label>
        <input id={id} data-autofocus="" className="vr-input" value={value} aria-invalid={!pages} aria-describedby={hintId} onChange={(e) => setValue(e.target.value)} />
        <p id={hintId} className="vpdf-form__hint">
          {t('pdf.dialogs.extract.hint', { count: pageCount })}
        </p>
      </form>
    </Dialog>
  );
}

function GoToPageDialog({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const pageCount = usePdfDoc(docId, (s) => s.pageCount);
  const current = usePdfDoc(docId, (s) => s.currentPage);
  const [value, setValue] = useState(String(current));
  const id = useId();
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= pageCount;
  const submit = () => {
    if (!valid) return;
    close(docId);
    controllerFor(docId)?.goToPage(n);
  };
  return (
    <Dialog
      title={t('pdf.dialogs.goToPage.title')}
      size="small"
      onCancel={() => close(docId)}
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--primary" disabled={!valid} onClick={submit}>
            {t('pdf.dialogs.goToPage.go')}
          </button>
          <button type="button" className="vr-btn" onClick={() => close(docId)}>
            {t('pdf.dialogs.cancel')}
          </button>
        </>
      }
    >
      <form
        className="vpdf-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id}>{t('pdf.dialogs.goToPage.label', { count: pageCount })}</label>
        <input id={id} data-autofocus="" className="vr-input" inputMode="numeric" value={value} aria-invalid={!valid} onChange={(e) => setValue(e.target.value)} />
      </form>
    </Dialog>
  );
}

function ExternalLinkDialog({ docId, url }: { docId: string; url: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <Dialog
      title={t('pdf.dialogs.link.title')}
      size="small"
      onCancel={() => close(docId)}
      footer={
        <>
          <button type="button" className="vr-btn vr-btn--primary" onClick={copy}>
            {t('pdf.dialogs.link.copy')}
          </button>
          <button type="button" className="vr-btn" onClick={() => close(docId)}>
            {t('pdf.dialogs.close')}
          </button>
        </>
      }
    >
      <div className="vpdf-form">
        <p>{t('pdf.dialogs.link.message')}</p>
        <input className="vr-input vpdf-form__url" readOnly value={url} aria-label={t('pdf.dialogs.link.address')} onFocus={(e) => e.currentTarget.select()} />
        <p className="vpdf-form__hint" role="status">
          {copied ? t('pdf.dialogs.link.copied') : ''}
        </p>
      </div>
    </Dialog>
  );
}

export function PdfDialogs({ docId }: { docId: string }) {
  const dialog = usePdfDoc(docId, (s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'password':
      return <PasswordDialog docId={docId} retry={dialog.retry} />;
    case 'addText':
      return <AddTextDialog docId={docId} dialog={dialog} />;
    case 'comment':
      return <CommentDialog docId={docId} initial={dialog.initial} />;
    case 'confirmDelete':
      return <ConfirmDeleteDialog docId={docId} pages={dialog.pages} />;
    case 'extract':
      return <ExtractDialog docId={docId} initial={dialog.initial} />;
    case 'goToPage':
      return <GoToPageDialog docId={docId} />;
    case 'externalLink':
      return <ExternalLinkDialog docId={docId} url={dialog.url} />;
  }
}
