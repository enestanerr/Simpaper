/**
 * Smoke boot (SIMPAPER_SMOKE=1, see testMode.ts and scripts/smoke-boot.mjs): the real app starts with a main
 * window that is never shown, loads the renderer, and a script drives it through the real preload bridge
 * (`window.simpaperIpc`, i.e. contextBridge → ipcMain → sender check → validators → services):
 * app:info, app:settings:get, app:window:state, documents:list, documents:create (engine instance with a hidden
 * view), engine:query doc.info, documents:close. Renderer console errors, renderer/preload failures and
 * main-process error log records are collected. The run ends the app through the normal quit flow with exit
 * code 0 (everything passed) or 1, after writing a JSON report.
 *
 * Nothing here runs unless SIMPAPER_SMOKE is set.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrowserWindow } from 'electron';
import { BRAND } from '@shared/brand';
import type { OfficeKind } from '@shared/modules';
import type { Logger } from '../log';
import type { SmokeOptions } from './testMode';

export interface SmokeStep {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface SmokeReport {
  ok: boolean;
  startedAt: string;
  durationMs: number;
  kind: OfficeKind;
  steps: SmokeStep[];
  /** Console messages of level `error`, renderer crashes, preload and load failures. */
  rendererErrors: string[];
  /** Records the main process logged at level `error`. */
  mainErrors: string[];
  versions: Record<string, string>;
}

function metaText(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  try {
    return ` ${JSON.stringify(meta, (_k, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message } : v)).slice(0, 400)}`;
  } catch {
    return '';
  }
}

/** Collects main-process error records (the app wraps its log sink with it in smoke mode). */
export class SmokeErrorCollector {
  readonly errors: string[] = [];

  record(scope: string, message: string, meta?: Record<string, unknown>): void {
    if (this.errors.length >= 100) return;
    this.errors.push(`${scope}: ${message}${metaText(meta)}`);
  }
}

export interface SmokeDeps {
  win: BrowserWindow;
  options: SmokeOptions;
  mainErrors: SmokeErrorCollector;
  log: Logger;
  /** Ends the app through the quit flow with this exit code. */
  finish: (exitCode: number) => void;
  /** Budget for the whole run (default 4 minutes). */
  timeoutMs?: number;
}

const MAX_TEXT = 500;
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type InvokeOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Starts listening at once (so that errors during the page load are seen) and runs the scripted checks
 * after `did-finish-load`. Returns the report promise (resolved before `finish` is called).
 */
export function startSmoke(deps: SmokeDeps): Promise<SmokeReport> {
  const { win, options, log } = deps;
  const wc = win.webContents;
  const started = Date.now();
  const rendererErrors: string[] = [];
  const steps: SmokeStep[] = [];
  const pushRendererError = (text: string) => {
    if (rendererErrors.length < 100) rendererErrors.push(clip(text));
  };

  wc.on('console-message', (details) => {
    if (details.level === 'error') pushRendererError(`console: ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  wc.on('preload-error', (_event, preloadPath, error) => pushRendererError(`preload failed (${preloadPath}): ${error.message}`));
  wc.on('render-process-gone', (_event, details) => pushRendererError(`renderer process gone: ${details.reason} (exit ${details.exitCode})`));

  const loaded = new Promise<void>((resolve, reject) => {
    wc.once('did-finish-load', () => resolve());
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame) reject(new Error(`did-fail-load ${code} ${description} ${url}`));
    });
  });
  loaded.catch(() => undefined);

  const step = async <T>(name: string, fn: () => Promise<T>, check?: (value: T) => string | null): Promise<T | undefined> => {
    const t0 = Date.now();
    try {
      const value = await fn();
      const problem = check ? check(value) : null;
      steps.push({ name, ok: problem === null, ms: Date.now() - t0, ...(problem ? { detail: clip(problem) } : {}) });
      return problem === null ? value : undefined;
    } catch (err) {
      steps.push({ name, ok: false, ms: Date.now() - t0, detail: clip(err instanceof Error ? err.message : String(err)) });
      return undefined;
    }
  };

  /** Calls the IPC bridge exactly like the renderer does. */
  const invoke = async (channel: string, payload?: unknown): Promise<unknown> => {
    const code = `window.simpaperIpc.invoke(${JSON.stringify(channel)}, ${payload === undefined ? 'undefined' : JSON.stringify(payload)}).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: String((error && error.message) || error) }))`;
    const out = (await wc.executeJavaScript(code, false)) as InvokeOutcome;
    if (!out.ok) throw new Error(`${channel} rejected: ${out.error}`);
    return out.value;
  };

  const script = async (): Promise<void> => {
    await step('renderer loaded (did-finish-load)', () => Promise.race([loaded, delay(90_000).then(() => Promise.reject(new Error('no did-finish-load within 90 s')))]));
    if (!steps.at(-1)?.ok) return;
    const bridge = await step('preload bridge (window.simpaperIpc)', () => wc.executeJavaScript('typeof window.simpaperIpc', false) as Promise<string>, (t) => (t === 'object' ? null : `typeof window.simpaperIpc = ${t}`));
    if (bridge === undefined) return;
    await step('app:info', () => invoke('app:info'), (v) => {
      const info = v as { productName?: string; engine?: { available?: boolean; officeVersion?: string | null; error?: string } };
      if (info.productName !== BRAND.productName) return `productName ${String(info.productName)}`;
      if (!info.engine?.available) return `engine unavailable: ${info.engine?.error ?? 'unknown'}`;
      return null;
    });
    await step('app:settings:get', () => invoke('app:settings:get'), (v) => (['tr', 'en'].includes((v as { language?: string }).language ?? '') ? null : 'unexpected settings'));
    // A window that is never shown is neither focused nor active.
    await step('app:window:state', () => invoke('app:window:state'), (v) => {
      const state = v as { maximized?: unknown; focused?: unknown; active?: unknown };
      return typeof state.maximized === 'boolean' && state.focused === false && state.active === false ? null : `unexpected window state ${JSON.stringify(v)}`;
    });
    await step('documents:list (initial)', () => invoke('documents:list'), (v) => (Array.isArray(v) ? null : 'not an array'));
    const doc = (await step(`documents:create (${options.kind}, hidden view)`, () => invoke('documents:create', { kind: options.kind }), (v) => {
      const d = v as { kind?: string; state?: string; docId?: string };
      return d.kind === options.kind && d.state === 'ready' && typeof d.docId === 'string' ? null : `unexpected descriptor ${JSON.stringify(v)}`;
    })) as { docId: string } | undefined;
    if (doc) {
      await step('documents:list (with the new document)', () => invoke('documents:list'), (v) =>
        Array.isArray(v) && v.some((d) => (d as { docId?: string }).docId === doc.docId) ? null : 'document missing from the list',
      );
      await step('engine:query doc.info', () => invoke('engine:query', { docId: doc.docId, query: 'doc.info' }), (v) =>
        (v as { docId?: string }).docId === doc.docId ? null : `unexpected doc.info ${JSON.stringify(v)}`,
      );
      await step('documents:close', () => invoke('documents:close', { docId: doc.docId, force: true }), (v) => (v === 'closed' ? null : `outcome ${String(v)}`));
      await step('documents:list (after close)', () => invoke('documents:list'), (v) => (Array.isArray(v) && v.length === 0 ? null : 'documents left open'));
    }
    // Late errors (effects that run after the last request) still count.
    await delay(1_000);
  };

  const budget = deps.timeoutMs ?? 240_000;
  return (async () => {
    let timedOut = false;
    await Promise.race([
      script(),
      delay(budget).then(() => {
        timedOut = true;
      }),
    ]);
    if (timedOut) steps.push({ name: 'time budget', ok: false, ms: budget, detail: `smoke run exceeded ${budget} ms` });
    const report: SmokeReport = {
      ok: steps.length > 0 && steps.every((s) => s.ok) && rendererErrors.length === 0 && deps.mainErrors.errors.length === 0,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      kind: options.kind,
      steps,
      rendererErrors,
      mainErrors: [...deps.mainErrors.errors],
      versions: {
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node,
      },
    };
    if (options.reportFile) {
      try {
        mkdirSync(dirname(options.reportFile), { recursive: true });
        writeFileSync(options.reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      } catch (err) {
        log.error('smoke report could not be written', { error: err });
      }
    }
    const summary = steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'} ${s.name} (${s.ms} ms)${s.detail ? ` — ${s.detail}` : ''}`).join('\n');
    // stdout is read by scripts/smoke-boot.mjs; this is the only place the app prints on purpose.
    console.log(`[simpaper-smoke] ${report.ok ? 'PASSED' : 'FAILED'} in ${report.durationMs} ms\n${summary}`);
    for (const e of rendererErrors) console.log(`[simpaper-smoke] renderer error: ${e}`);
    for (const e of report.mainErrors) console.log(`[simpaper-smoke] main error: ${e}`);
    deps.finish(report.ok ? 0 : 1);
    return report;
  })();
}
