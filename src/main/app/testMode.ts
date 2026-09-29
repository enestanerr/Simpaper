/**
 * Test-only switches read from the environment. The installed app never sets them; each one only makes the
 * app more restricted or more isolated (no native windows, separate data folder, scripted smoke run).
 *
 *  - `VARAK_VIEW_MODE=hidden`  documents are loaded without a native window and every engine instance runs
 *                              `--headless`: nothing but the (possibly hidden) main window can appear.
 *  - `VARAK_DATA_DIR=<dir>`    absolute folder that receives all app data (settings, recent files, engine
 *                              profiles, working copies, recovery, logs, Chromium session data).
 *  - `VARAK_SMOKE=1`           smoke boot (src/main/app/smoke.ts, scripts/smoke-boot.mjs): the main window is
 *                              never shown, no dialogs, scripted checks, exit code 0/1. Implies hidden views;
 *                              without VARAK_DATA_DIR a fresh folder in the system temp folder is used.
 *  - `VARAK_SMOKE_REPORT=<file>` where the smoke run writes its JSON report.
 *  - `VARAK_SMOKE_KIND=calc`   module of the document the smoke run creates (writer | calc | impress; default calc).
 */
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { OFFICE_KINDS, type OfficeKind } from '@shared/modules';

export interface SmokeOptions {
  reportFile: string | null;
  kind: OfficeKind;
}

export interface TestMode {
  /** Load documents with `hidden` views and start engine instances headless. */
  hiddenViews: boolean;
  /** Root folder for all app data, or null for the normal locations. */
  dataDir: string | null;
  smoke: SmokeOptions | null;
}

const truthy = (v: string | undefined) => v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());

export function readTestMode(env: NodeJS.ProcessEnv = process.env, pid = process.pid): TestMode {
  const smokeOn = truthy(env['VARAK_SMOKE']);
  const kind = env['VARAK_SMOKE_KIND']?.trim() ?? '';
  const smoke: SmokeOptions | null = smokeOn
    ? {
        reportFile: env['VARAK_SMOKE_REPORT'] && isAbsolute(env['VARAK_SMOKE_REPORT']) ? env['VARAK_SMOKE_REPORT'] : null,
        kind: (OFFICE_KINDS as readonly string[]).includes(kind) ? (kind as OfficeKind) : 'calc',
      }
    : null;
  const requested = env['VARAK_DATA_DIR']?.trim();
  const dataDir = requested && isAbsolute(requested) && !requested.includes('\0') ? requested : smoke ? join(tmpdir(), `varak-smoke-${pid}`) : null;
  return {
    hiddenViews: smoke !== null || env['VARAK_VIEW_MODE']?.trim().toLowerCase() === 'hidden',
    dataDir,
    smoke,
  };
}
