import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS } from '@shared/api/app';
import './theme/tokens.css';
import './theme/base.css';
import './styles/shell.css';
import './styles/ribbon.css';
import './styles/popups.css';
import './styles/backstage.css';
import './styles/modules.css';
import { App } from './App';
import { initI18n } from './i18n';
import { preloadModules } from './modules';
import { loadInitialState, wireEvents } from './services/bootstrap';
import { useApp } from './state/appStore';
import { applyBrandColors, applyTheme, watchSystemTheme } from './theme/theme';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

initI18n(DEFAULT_SETTINGS.language);
applyBrandColors();
applyTheme(DEFAULT_SETTINGS.theme);
watchSystemTheme(() => useApp.getState().settings.theme);
wireEvents();
void loadInitialState();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
preloadModules();
