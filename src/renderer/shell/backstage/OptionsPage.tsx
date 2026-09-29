/** Options: language, theme, saving, CSV defaults, document view mode, interface and Quick Access Toolbar. */
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import type { Settings, ThemePreference, UiLanguage } from '@shared/api/app';
import type { DocumentDescriptor } from '@shared/api/documents';
import { updateSettings } from '../../services/settings';
import { useApp } from '../../state/appStore';
import { moveQatItem, normalizeQat, QAT_COMMANDS, toggleQatItem } from '../qat';

type Separator = Settings['csv']['importSeparator'];
const SEPARATORS: Separator[] = ['auto', ';', ',', '\t'];
const SEPARATOR_KEYS: Record<Separator, string> = { auto: 'shell.options.sepAuto', ';': 'shell.options.sepSemicolon', ',': 'shell.options.sepComma', '\t': 'shell.options.sepTab' };

export function clampInt(text: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="vr-opt-section" aria-labelledby={id}>
      <h2 id={id} className="vr-bs-subtitle">
        {title}
      </h2>
      {children}
    </section>
  );
}

function NumberSetting({ label, hint, value, min, max, onCommit }: { label: string; hint?: string; value: number; min: number; max: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const id = useId();
  const invalid = text !== null && clampInt(text, min, max) === null;
  const commit = () => {
    if (text === null) return;
    const n = clampInt(text, min, max);
    if (n !== null && n !== value) onCommit(n);
    if (n !== null) setText(null);
  };
  return (
    <div className="vr-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="vr-input vr-input--narrow"
        inputMode="numeric"
        value={text ?? String(value)}
        aria-invalid={invalid || undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {hint && (
        <span id={`${id}-hint`} className="vr-option__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

export function OptionsPage(_props: { doc: DocumentDescriptor | null }) {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const qat = normalizeQat(settings.ui.quickAccess);
  const langId = useId();
  const importId = useId();
  const exportId = useId();
  const keyTipsHintId = useId();
  const verifyHintId = useId();
  const csvHintId = useId();

  return (
    <div className="vr-bs-content vr-options-page">
      <h1 className="vr-bs-title">{t('shell.backstage.options')}</h1>

      <Section title={t('shell.options.general')}>
        <div className="vr-field">
          <label htmlFor={langId}>{t('shell.options.language')}</label>
          <select
            id={langId}
            className="vr-select"
            value={settings.language}
            onChange={(e) => void updateSettings({ language: e.target.value as UiLanguage })}
          >
            <option value="tr" lang="tr">
              Türkçe
            </option>
            <option value="en" lang="en">
              English
            </option>
          </select>
        </div>
        <fieldset className="vr-radios">
          <legend>{t('shell.options.theme')}</legend>
          {(['system', 'light', 'dark'] as ThemePreference[]).map((th) => (
            <label key={th} className="vr-checkbox">
              <input type="radio" name="vr-theme" checked={settings.theme === th} onChange={() => void updateSettings({ theme: th })} />
              <span>{t(`shell.options.theme_${th}`)}</span>
            </label>
          ))}
        </fieldset>
      </Section>

      <Section title={t('shell.options.saving')}>
        <NumberSetting
          label={t('shell.options.autosave')}
          hint={t('shell.options.autosaveHint')}
          value={settings.autosaveMinutes}
          min={0}
          max={60}
          onCommit={(n) => void updateSettings({ autosaveMinutes: n })}
        />
        <label className="vr-checkbox vr-field">
          <input
            type="checkbox"
            checked={settings.verifyAfterSave}
            aria-describedby={verifyHintId}
            onChange={(e) => void updateSettings({ verifyAfterSave: e.target.checked })}
          />
          <span>{t('shell.options.verifyAfterSave')}</span>
        </label>
        <p id={verifyHintId} className="vr-option__hint">
          {t('shell.options.verifyAfterSaveHint')}
        </p>
        <NumberSetting label={t('shell.options.recentLimit')} value={settings.recentLimit} min={0} max={50} onCommit={(n) => void updateSettings({ recentLimit: n })} />
      </Section>

      <Section title={t('shell.options.csv')}>
        <div className="vr-field">
          <label htmlFor={importId}>{t('shell.options.csvImport')}</label>
          <select id={importId} className="vr-select" value={settings.csv.importSeparator} onChange={(e) => void updateSettings({ csv: { importSeparator: e.target.value as Separator } })}>
            {SEPARATORS.map((s) => (
              <option key={s} value={s}>
                {t(SEPARATOR_KEYS[s])}
              </option>
            ))}
          </select>
        </div>
        <div className="vr-field">
          <label htmlFor={exportId}>{t('shell.options.csvExport')}</label>
          <select id={exportId} className="vr-select" value={settings.csv.exportSeparator} onChange={(e) => void updateSettings({ csv: { exportSeparator: e.target.value as Separator } })}>
            {SEPARATORS.map((s) => (
              <option key={s} value={s}>
                {t(SEPARATOR_KEYS[s])}
              </option>
            ))}
          </select>
        </div>
        <label className="vr-checkbox vr-field">
          <input
            type="checkbox"
            checked={settings.csv.exportBom}
            aria-describedby={csvHintId}
            onChange={(e) => void updateSettings({ csv: { exportBom: e.target.checked } })}
          />
          <span>{t('shell.options.csvBom')}</span>
        </label>
        <p id={csvHintId} className="vr-option__hint">
          {t('shell.options.csvHint')}
        </p>
      </Section>

      <Section title={t('shell.options.interface')}>
        <label className="vr-checkbox vr-field">
          <input type="checkbox" checked={settings.ui.showStatusBar} onChange={(e) => void updateSettings({ ui: { showStatusBar: e.target.checked } })} />
          <span>{t('shell.options.showStatusBar')}</span>
        </label>
        <label className="vr-checkbox vr-field">
          <input type="checkbox" checked={settings.ui.ribbonCollapsed} onChange={(e) => void updateSettings({ ui: { ribbonCollapsed: e.target.checked } })} />
          <span>{t('shell.options.ribbonCollapsed')}</span>
        </label>
        <label className="vr-checkbox vr-field">
          <input
            type="checkbox"
            checked={settings.ui.documentKeyTips === true}
            aria-describedby={keyTipsHintId}
            onChange={(e) => void updateSettings({ ui: { documentKeyTips: e.target.checked } })}
          />
          <span>{t('shell.options.documentKeyTips')}</span>
        </label>
        <p id={keyTipsHintId} className="vr-option__hint">
          {t('shell.options.documentKeyTipsHint')}
        </p>
      </Section>

      <Section title={t('shell.options.qat')}>
        <p className="vr-option__hint">{t('shell.options.qatHint')}</p>
        <ul className="vr-qat-list">
          {QAT_COMMANDS.map((c) => {
            const on = qat.includes(c.id);
            const pos = qat.indexOf(c.id);
            const Icon = c.icon;
            return (
              <li key={c.id} className="vr-qat-list__item">
                <label className="vr-checkbox">
                  <input type="checkbox" checked={on} onChange={() => void updateSettings({ ui: { quickAccess: toggleQatItem(qat, c.id) } })} />
                  <Icon size={16} stroke={1.75} aria-hidden="true" />
                  <span>{t(c.labelKey)}</span>
                </label>
                {on && (
                  <span className="vr-qat-list__order">
                    <button
                      type="button"
                      className="vr-icon-btn"
                      disabled={pos <= 0}
                      aria-label={t('shell.options.moveUp', { name: t(c.labelKey) })}
                      onClick={() => void updateSettings({ ui: { quickAccess: moveQatItem(qat, c.id, -1) } })}
                    >
                      <IconArrowUp size={14} stroke={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="vr-icon-btn"
                      disabled={pos === qat.length - 1}
                      aria-label={t('shell.options.moveDown', { name: t(c.labelKey) })}
                      onClick={() => void updateSettings({ ui: { quickAccess: moveQatItem(qat, c.id, 1) } })}
                    >
                      <IconArrowDown size={14} stroke={2} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
