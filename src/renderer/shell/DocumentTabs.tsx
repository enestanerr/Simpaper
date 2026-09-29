/** Tabs of the open documents (APG tabs: arrows move, Enter/Space or focus activates, Delete closes). */
import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconX } from '@tabler/icons-react';
import type { DocumentDescriptor } from '@shared/api/documents';
import { activateDocument, closeDocument } from '../services/documents';
import { moveDocument, openBackstage, useApp } from '../state/appStore';
import { ModuleIcon } from './brand';

export function DocumentTabs() {
  const { t } = useTranslation();
  const docs = useApp((s) => s.documents);
  const activeId = useApp((s) => s.activeDocId);
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const docId = tabs[i]?.dataset['docId'];
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else if (e.key === 'Delete' && docId) {
      e.preventDefault();
      void closeDocument(docId);
      return;
    } else if ((e.key === 'PageUp' || e.key === 'PageDown') && e.ctrlKey && e.shiftKey && docId) {
      e.preventDefault();
      moveDocument(docId, e.key === 'PageUp' ? -1 : 1);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    const el = tabs[next];
    el?.focus();
    const id = el?.dataset['docId'];
    if (id) activateDocument(id);
  };

  return (
    <div className="vr-doctabs">
      <div ref={listRef} role="tablist" aria-label={t('shell.tabs.label')} className="vr-doctabs__list" onKeyDown={onKeyDown}>
        {docs.map((d) => (
          <DocTab key={d.docId} doc={d} active={d.docId === activeId} />
        ))}
      </div>
      <button type="button" className="vr-doctabs__new" aria-label={t('shell.tabs.new')} title={t('shell.tabs.new')} onClick={() => openBackstage('new')}>
        <IconPlus size={14} stroke={2} aria-hidden="true" />
      </button>
    </div>
  );
}

function DocTab({ doc, active }: { doc: DocumentDescriptor; active: boolean }) {
  const { t } = useTranslation();
  const title = doc.title;
  const label = [title, doc.modified ? t('shell.title.modified') : null, doc.readOnly ? t('shell.title.readOnly') : null].filter(Boolean).join(', ');
  return (
    <div
      role="tab"
      id={`doctab-${doc.docId}`}
      data-doc-id={doc.docId}
      aria-selected={active}
      aria-controls={`workspace-${doc.docId}`}
      aria-label={label}
      tabIndex={active ? 0 : -1}
      title={doc.path ?? title}
      className={`vr-doctab${active ? ' vr-doctab--active' : ''}`}
      data-kind={doc.kind}
      onClick={() => activateDocument(doc.docId)}
      onAuxClick={(e) => {
        if (e.button === 1) void closeDocument(doc.docId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateDocument(doc.docId);
        }
      }}
    >
      <ModuleIcon kind={doc.kind} size={14} />
      <span className="vr-doctab__title">{title}</span>
      {doc.modified && (
        <span className="vr-doctab__dot" aria-hidden="true">
          •
        </span>
      )}
      <button
        type="button"
        className="vr-doctab__close"
        tabIndex={-1}
        aria-label={t('shell.tabs.close', { title })}
        title={`${t('shell.tabs.close', { title })} (Ctrl+W)`}
        onClick={(e) => {
          e.stopPropagation();
          void closeDocument(doc.docId);
        }}
      >
        <IconX size={12} stroke={2} aria-hidden="true" />
      </button>
    </div>
  );
}
