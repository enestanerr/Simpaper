/** Application shell layout: title bar, document tabs, ribbon, toolstrip, message bars, workspaces, status bar. */
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getModule } from '../modules/registry';
import { Ribbon } from '../ribbon/Ribbon';
import { stateCommandOf } from '../ribbon/model';
import { installKeyboardClaims } from '../services/keyboardFocus';
import { trackWindowFocus } from '../services/windowActivity';
import { selectActiveDocument, useApp } from '../state/appStore';
import { Backstage } from './backstage/Backstage';
import { DocumentTabs } from './DocumentTabs';
import { installGlobalKeyboard } from './keyboard';
import { MessageBars } from './MessageBars';
import { PromptHost } from './prompts/PromptHost';
import { StartScreen } from './StartScreen';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import { WorkspaceHost } from './WorkspaceHost';

/** Commands the shell itself needs streamed (QAT gates, zoom). */
const SHELL_COMMANDS = ['.uno:Undo', '.uno:Redo', '.uno:Zoom'];

export function Shell() {
  const { t } = useTranslation();
  const ready = useApp((s) => s.ready);
  const doc = useApp(selectActiveDocument);
  const docCount = useApp((s) => s.documents.length);
  const backstageOpen = useApp((s) => s.backstage.open);
  const showStatus = useApp((s) => s.settings.ui.showStatusBar);
  const module = doc ? getModule(doc.kind) : undefined;
  const kind = doc?.kind ?? 'home';

  useEffect(() => installGlobalKeyboard(), []);
  useEffect(() => installKeyboardClaims(), []);
  useEffect(() => trackWindowFocus(), []);
  // Dialogs, menus and screen tips render into <body>: <html> carries the module too, so they share its accent.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset['module'] = kind;
    return () => {
      delete root.dataset['module'];
    };
  }, [kind]);

  const extraCommands = useMemo(() => {
    const views = (module?.statusViews ?? []).map((v) => stateCommandOf(v)).filter((c): c is string => !!c);
    return [...SHELL_COMMANDS, ...views];
  }, [module]);

  if (!ready) return <div className="vr-app vr-app--loading" aria-busy="true" aria-label={t('shell.loading')} />;

  const Toolstrip = module?.Toolstrip;
  return (
    <div className="vr-app" data-module={kind}>
      <TitleBar />
      {docCount > 1 && <DocumentTabs />}
      <div className="vr-body">
        <div className="vr-main" aria-hidden={backstageOpen || undefined} inert={backstageOpen}>
          {doc && module && <Ribbon key={doc.kind} module={module} doc={doc} extraCommands={extraCommands} />}
          {doc && Toolstrip && <Toolstrip key={doc.docId} doc={doc} />}
          <MessageBars />
          {docCount > 0 ? <WorkspaceHost /> : <StartScreen />}
          {doc && module && showStatus && <StatusBar doc={doc} module={module} />}
        </div>
        {backstageOpen && <Backstage />}
      </div>
      <PromptHost />
    </div>
  );
}
