/**
 * Keeps every open document's workspace mounted (native views and pdf.js viewers survive tab
 * switches); only the active one is displayed. Each workspace is the tab panel of its document tab.
 */
import { getModule } from '../modules/registry';
import { useApp } from '../state/appStore';

export function WorkspaceHost() {
  const docs = useApp((s) => s.documents);
  const activeId = useApp((s) => s.activeDocId);
  const tabsShown = docs.length > 1;
  return (
    <div className="vr-workspaces">
      {docs.map((doc) => {
        const module = getModule(doc.kind);
        if (!module) return null;
        const active = doc.docId === activeId;
        const Workspace = module.Workspace;
        return (
          <div
            key={doc.docId}
            id={`workspace-${doc.docId}`}
            className="vr-workspace-slot"
            role={tabsShown ? 'tabpanel' : undefined}
            aria-labelledby={tabsShown ? `doctab-${doc.docId}` : undefined}
            hidden={!active}
          >
            <Workspace doc={doc} active={active} />
          </div>
        );
      })}
    </div>
  );
}
