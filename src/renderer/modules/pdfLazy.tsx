/**
 * The PDF module with its workspace loaded on demand.
 *
 * pdf.js (≈1.2 MB) is needed only once a PDF is open. Of the PDF module, only the workspace
 * (PdfWorkspace → PdfController → pdf.js) imports it; the ribbon, actions, status bar and the command
 * bridge do not, so they stay in the main bundle and the workspace becomes its own chunk. This mirrors
 * src/renderer/modules/pdf/index.ts (tests/unit/renderer/modules.test.tsx keeps both in sync).
 */
import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconLoader2 } from '@tabler/icons-react';
// pdf.js' viewer CSS first, then the module's own CSS: the same cascade order as a static import of the module.
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf/pdf.css';
import { closeDocument } from '../services/documents';
import { flushPdf, pdfActions } from './pdf/actions';
import { PdfStatusBar } from './pdf/components/StatusBar';
import { pdfRibbon } from './pdf/ribbon';
import { startCommandBridge } from './pdf/state/commandBridge';
import type { ModuleDefinition, WorkspaceProps } from './types';

/** Loads the PDF workspace chunk (also used to preload it when the app is idle). */
export const loadPdfWorkspace = () => import('./pdf/components/Workspace');

const LazyPdfWorkspace = lazy(() => loadPdfWorkspace().then((m) => ({ default: m.PdfWorkspace })));

function WorkspaceLoading({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <div className="vr-workspace">
      <div className="vr-surface-overlay" role="status" aria-live="polite">
        <IconLoader2 className="vr-spin" size={28} stroke={1.75} aria-hidden="true" />
        <div>{t('shell.workspace.loading', { title })}</div>
      </div>
    </div>
  );
}

function WorkspaceLoadFailed({ docId }: { docId: string }) {
  const { t } = useTranslation();
  return (
    <div className="vr-workspace">
      <div className="vr-surface-overlay vr-surface-overlay--error" role="alert">
        <IconAlertTriangle size={32} stroke={1.6} aria-hidden="true" />
        <p>{t('shell.workspace.moduleLoadFailed')}</p>
        <div className="vr-surface-overlay__actions">
          <button type="button" className="vr-btn" onClick={() => void closeDocument(docId, true)}>
            {t('shell.workspace.closeDocument')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shows a message instead of an empty area if the workspace chunk cannot be loaded (damaged installation). */
class ChunkBoundary extends Component<{ docId: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // No document content here: the error comes from loading program code.
    console.error('[simpaper] PDF workspace failed to load', error instanceof Error ? error.message : error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? <WorkspaceLoadFailed docId={this.props.docId} /> : this.props.children;
  }
}

function PdfWorkspaceLoader(props: WorkspaceProps) {
  return (
    <ChunkBoundary docId={props.doc.docId}>
      <Suspense fallback={props.active ? <WorkspaceLoading title={props.doc.title} /> : null}>
        <LazyPdfWorkspace {...props} />
      </Suspense>
    </ChunkBoundary>
  );
}

startCommandBridge();

export const pdfModule: ModuleDefinition = {
  kind: 'pdf',
  ribbon: pdfRibbon,
  Workspace: PdfWorkspaceLoader,
  StatusBar: PdfStatusBar,
  actions: pdfActions,
  flush: flushPdf,
};
