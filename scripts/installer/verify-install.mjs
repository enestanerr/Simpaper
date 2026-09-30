#!/usr/bin/env node
/**
 * REAL installation check on this PC, for the current user. It CHANGES THE SYSTEM for a few minutes: installs
 * Simpaper silently from release/Simpaper-Setup-<version>-x64.exe, opens documents with it, starts the installed app,
 * uninstalls it again and removes the data the test created (with --keep it installs it once more and leaves it).
 * It opens windows: run it only with the machine owner's permission, while nobody uses the PC. Only Simpaper's own
 * window is captured; other windows are neither captured nor logged.
 *
 * Checks (report: test-output/install-check/report.json):
 *  - the entries build/installer.nsh writes to the real HKCU (ProgIDs, "Open with", Capabilities,
 *    RegisteredApplications) and the type names Explorer shows;
 *  - which types Windows now opens with Simpaper (AssocQueryString, i.e. with the user's own choices applied) and
 *    the icon Windows draws for each file-type group (compared with resources/fileicons);
 *  - a double-click (ShellExecute "open") of a document, then every other test type alone (it reaches the running
 *    instance, or Windows asks "How do you want to open this file?", as it may do until the user chose for a type
 *    that another app registered as well; the prompt is cancelled without a choice), then a multi-selection (one
 *    process per file, all at once) of the types Windows opens directly: every file reaches the running instance;
 *  - Options › File types in the installed app (isolated data folder, remote debugging) and a capture of it;
 *  - after uninstalling: none of Simpaper's entries left, every type opens as before.
 *
 * Usage: node scripts/installer/verify-install.mjs [--keep] [--idle-ms 60000]
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { launchSimpaper, requireIdle, settingsPreset, sleep } from '../gui/harness.mjs';
import * as W from '../gui/win32.mjs';
import { parseFileTypes, registry } from './check-associations.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const keep = process.argv.includes('--keep');
const out = path.join(repoRoot, 'test-output', 'install-check');

const HKCU = 0xffff_ffff_8000_0001n;
const REG_NONE = 0;
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const yml = readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8');
const appId = /^appId:\s*(\S+)\s*$/m.exec(yml)?.[1];
const { UUID } = require('builder-util-runtime');
/** electron-builder's product GUID: UUID v5 of the appId (NsisTarget.js). */
const guid = UUID.v5(appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
const installer = path.join(repoRoot, 'release', `${pkg.productName}-Setup-${pkg.version}-x64.exe`);
const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', pkg.productName);
const installedExe = path.join(installDir, `${pkg.productName}.exe`);
const uninstallKey = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`;
const dataFolders = [path.join(process.env.APPDATA, pkg.productName), path.join(process.env.LOCALAPPDATA, pkg.productName)];
const rows = parseFileTypes(readFileSync(path.join(repoRoot, 'build', 'installer.nsh'), 'utf8'));
const reg = registry();
const report = { startedAt: new Date().toISOString(), installer: path.basename(installer), appId, guid, keep, steps: [], failures: [] };
const step = (msg, extra) => {
  console.log(`[install-check] ${msg}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}`);
  report.steps.push({ at: new Date().toISOString(), msg, ...(extra === undefined ? {} : { extra }) });
};
const check = (ok, message) => {
  if (!ok) {
    report.failures.push(message);
    console.log(`[install-check] FAIL ${message}`);
  }
  return ok;
};

// ------------------------------------------------------------------ Windows' view of an association (read only)
const koffi = require('koffi');
const shlwapi = koffi.load('shlwapi.dll');
const AssocQueryStringW = shlwapi.func('__stdcall', 'AssocQueryStringW', 'int32', ['uint32', 'int', 'str16', 'str16', 'void *', koffi.inout(koffi.pointer('uint32'))]);
const ASSOC = { executable: 2, typeName: 3, icon: 15, progId: 20 };
function assoc(assocName, what) {
  const buf = new Uint16Array(2048);
  const chars = [buf.length];
  if (AssocQueryStringW(0, ASSOC[what], assocName, null, buf, chars) !== 0) return null;
  return String.fromCharCode(...buf.subarray(0, Math.max(0, chars[0] - 1)));
}
const canonical = (p) => (p ?? '').replace(/\//g, '\\').toLowerCase();
function handlerOf(ext) {
  const userChoice = reg.value(HKCU, `Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}\\UserChoice`, 'ProgId')?.text ?? null;
  return { progId: assoc(`.${ext}`, 'progId'), executable: assoc(`.${ext}`, 'executable'), userChoice };
}

// ------------------------------------------------------------------ helpers
const installed = () => reg.keyExists(HKCU, uninstallKey);
async function waitFor(what, predicate, timeoutMs, everyMs = 500) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await sleep(everyMs);
  }
  step(`timed out waiting for ${what}`);
  return false;
}
/** Processes started from the installation folder (Simpaper.exe and its engines). */
function processesFromInstall() {
  const csv = execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${installDir.replace(/'/g, "''")}', 'OrdinalIgnoreCase') } | ForEach-Object { "$($_.ProcessId)|$($_.Name)" }`], { encoding: 'utf8' });
  return csv.split(/\r?\n/).filter(Boolean).map((l) => ({ pid: Number(l.split('|')[0]), name: l.split('|')[1] }));
}
/** Windows' "How do you want to open this file?" prompts (OpenWith.exe) that are running. */
function openWithPids() {
  // Get-CimInstance exits with 0 when nothing matches (Get-Process -ErrorAction SilentlyContinue would exit with 1).
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='OpenWith.exe'" | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).map(Number);
}
/** The visible main window of the installed app (its own window: title may be read). */
function installedAppWindow() {
  const pids = new Set(processesFromInstall().filter((p) => /^simpaper\.exe$/i.test(p.name)).map((p) => p.pid));
  return W.topLevelWindows().find((w) => pids.has(w.pid) && w.visible && w.cls.startsWith('Chrome_WidgetWin') && w.rect.width > 400) ?? null;
}
function shellOpen(file) {
  // ShellExecute with the default verb: what a double-click in Explorer does.
  spawn('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath '${file.replace(/'/g, "''")}'`], { stdio: 'ignore', windowsHide: true });
}
function snapshotOurEntries() {
  const classes = 'Software\\Classes';
  const left = [];
  for (const row of rows) {
    if (reg.keyExists(HKCU, `${classes}\\${row.progId}`)) left.push(`ProgID ${row.progId}`);
    if (reg.value(HKCU, `${classes}\\.${row.ext}\\OpenWithProgids`, row.progId)) left.push(`.${row.ext} OpenWithProgids ${row.progId}`);
    if (reg.value(HKCU, `${classes}\\.${row.ext}`, '')?.text === row.progId) left.push(`.${row.ext} default`);
  }
  if (reg.value(HKCU, 'Software\\RegisteredApplications', 'Simpaper')) left.push('RegisteredApplications\\Simpaper');
  if (reg.keyExists(HKCU, 'Software\\Simpaper')) left.push('Software\\Simpaper');
  if (reg.keyExists(HKCU, `${classes}\\Applications\\${pkg.productName}.exe`)) left.push(`Applications\\${pkg.productName}.exe`);
  return [...new Set(left)];
}
/** PNG pixels of the 32 px entry of one of our ICO files. */
function icoEntry32(file) {
  const buf = readFileSync(file);
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const base = 6 + 16 * i;
    if ((buf.readUInt8(base) || 256) !== 32) continue;
    return PNG.sync.read(buf.subarray(buf.readUInt32LE(base + 12), buf.readUInt32LE(base + 12) + buf.readUInt32LE(base + 8)));
  }
  throw new Error(`${file}: no 32 px entry`);
}
/** Share of visible pixels that differ by more than 24 in a colour channel. */
function iconDifference(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let differing = 0;
  let visible = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] < 128 && b.data[i + 3] < 128) continue;
    visible++;
    if (Math.abs(a.data[i + 3] - b.data[i + 3]) > 64 || [0, 1, 2].some((c) => Math.abs(a.data[i + c] - b.data[i + c]) > 24)) differing++;
  }
  return visible ? differing / visible : 1;
}

/** Files of the user's own data folder to restore after the double-click test (bytes null: did not exist). */
const userFiles = [];
function restoreUserFiles() {
  for (const { file, bytes } of userFiles.splice(0)) {
    if (bytes) writeFileSync(file, bytes);
    else rmSync(file, { force: true });
  }
}

async function install() {
  step('installing silently', { installer: path.basename(installer) });
  const r = spawnSync(installer, ['/S'], { windowsHide: true, timeout: 600_000 });
  check(r.status === 0, `installer exit code ${r.status}`);
  check(await waitFor('the installation', () => installed() && existsSync(installedExe), 60_000), 'Simpaper is not installed after the installer finished');
}
async function uninstall() {
  const uninstaller = path.join(installDir, `Uninstall ${pkg.productName}.exe`);
  step('uninstalling silently');
  // NSIS uninstallers copy themselves to %TEMP% and return at once; wait for the result instead.
  spawnSync(uninstaller, ['/S', '/currentuser'], { windowsHide: true, timeout: 120_000 });
  check(await waitFor('the uninstallation', () => !installed() && !existsSync(installedExe), 180_000), 'Simpaper is still installed');
}

async function main() {
  requireIdle(Number(arg('--idle-ms', '60000')), 'install-check');
  if (process.platform !== 'win32') throw new Error('Windows only');
  if (!existsSync(installer)) throw new Error(`${installer} is missing: run npm run dist:win`);
  if (installed() || existsSync(installDir)) throw new Error(`${pkg.productName} is already installed (${installDir}); uninstall it first`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, 'icons'), { recursive: true });
  const dataBefore = dataFolders.filter((d) => existsSync(d));
  if (dataBefore.length) step('data folders exist before the test and will be kept', dataBefore);
  // The double-click test runs the installed app on the real data folder: the user's settings and recent list come
  // back byte for byte afterwards (or are removed again if the test created them).
  for (const d of dataBefore) {
    for (const name of ['settings.json', 'recent.json']) {
      const file = path.join(d, name);
      userFiles.push({ file, bytes: existsSync(file) ? readFileSync(file) : null });
    }
  }

  // ------------------------------------------------ baseline
  const baseline = Object.fromEntries(rows.map((r) => [r.ext, handlerOf(r.ext)]));
  check(snapshotOurEntries().length === 0, `Simpaper entries before the installation: ${snapshotOurEntries().join(', ')}`);
  step('baseline recorded', { types: rows.length });

  // ------------------------------------------------ install
  await install();
  const exeKey = canonical(installedExe);
  const classes = 'Software\\Classes';
  const lang = reg.value(HKCU, `${classes}\\Simpaper.docx`, '')?.text === 'Word Belgesi' ? 'tr' : 'en';
  for (const row of rows) {
    const name = lang === 'tr' ? row.tr : row.en;
    check(reg.value(HKCU, `${classes}\\${row.progId}`, '')?.text === name, `${row.progId}: type name is not "${name}"`);
    check(canonical(reg.value(HKCU, `${classes}\\${row.progId}\\shell\\open\\command`, '')?.text) === `"${exeKey}" "%1"`, `${row.progId}: open command`);
    check(reg.value(HKCU, `${classes}\\.${row.ext}\\OpenWithProgids`, row.progId)?.type === REG_NONE, `.${row.ext}: "Open with" entry missing`);
    check(assoc(row.progId, 'icon')?.toLowerCase().includes(`\\resources\\fileicons\\${row.icon}.ico`) ?? false, `${row.progId}: DefaultIcon`);
  }
  check(reg.value(HKCU, 'Software\\RegisteredApplications', 'Simpaper')?.text === 'Software\\Simpaper\\Capabilities', 'RegisteredApplications');
  check(reg.value(HKCU, uninstallKey, 'DisplayName')?.text === `${pkg.productName} ${pkg.version}`, 'uninstall entry name');

  // Which types open with Simpaper now, and why the others do not.
  const types = rows.filter((r) => r.claim).map((row) => {
    const now = handlerOf(row.ext);
    const ours = canonical(now.executable) === exeKey;
    const reason = ours ? null : now.userChoice ? `user's choice: ${now.userChoice}` : 'another registered app';
    return { ext: row.ext, ours, ...(reason ? { reason } : {}), typeName: assoc(`.${row.ext}`, 'typeName') };
  });
  report.types = types;
  step('types that open with Simpaper', { ours: types.filter((t) => t.ours).map((t) => t.ext), others: types.filter((t) => !t.ours) });
  for (const t of types) if (!t.ours) check(Boolean(baseline[t.ext].userChoice) || Boolean(baseline[t.ext].progId && baseline[t.ext].progId !== 'Unknown'), `.${t.ext} does not open with Simpaper although nothing else owned it`);
  // Plain-text types keep the program they had. Two cases are expected and only reported: a type with no app before
  // now opens with Simpaper (its only handler), and a type whose only handler was an optional one (an app package
  // with AllowSilentDefaultTakeOver) now makes Windows ask, because both handlers are optional.
  const openWith = (exe) => canonical(exe).endsWith('\\openwith.exe');
  report.plainText = rows.filter((r) => !r.claim).map((r) => {
    const before = baseline[r.ext];
    const now = handlerOf(r.ext);
    const program = before.executable !== null && !openWith(before.executable);
    const kept = canonical(before.executable) === canonical(now.executable);
    check(!program || kept, `.${r.ext}: plain-text type changed its program (${before.executable} -> ${now.executable})`);
    return { ext: r.ext, before: before.executable ?? before.progId, now: now.executable ?? now.progId, kept };
  });
  step('plain-text types', report.plainText);

  // The icons Windows draws for one file of each group.
  const samples = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Documents', 'Simpaper Kurulum Testi');
  rmSync(samples, { recursive: true, force: true });
  mkdirSync(samples, { recursive: true });
  const corpus = path.join(repoRoot, 'tests', 'corpus', 'generated');
  const files = {
    docx: [path.join(corpus, 'docx-basic.docx'), 'Rapor.docx', 'document'],
    pptx: [path.join(corpus, 'pptx-basic.pptx'), 'Sunum.pptx', 'presentation'],
    odt: [path.join(corpus, 'derived', 'docx-basic.odt'), 'Not.odt', 'document'],
    ods: [path.join(corpus, 'derived', 'xlsx-basic.ods'), 'Tablo.ods', 'spreadsheet'],
    pdf: [path.join(corpus, 'pdf-text.pdf'), 'Belge.pdf', 'pdf'],
  };
  const target = {};
  for (const [ext, [src, name]] of Object.entries(files)) {
    target[ext] = path.join(samples, name);
    copyFileSync(src, target[ext]);
  }
  // -File passes each path as one argument (-Command would split them at the spaces).
  const iconScript = path.join(out, 'extract-icons.ps1');
  writeFileSync(iconScript, `Add-Type -AssemblyName System.Drawing\r\nforeach ($p in $args) { $i = [System.Drawing.Icon]::ExtractAssociatedIcon($p); $i.ToBitmap().Save($p + '.png', [System.Drawing.Imaging.ImageFormat]::Png) }\r\n`);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', iconScript, ...Object.values(target)], { stdio: 'ignore' });
  report.icons = {};
  for (const [ext, [, , icon]] of Object.entries(files)) {
    const drawn = PNG.sync.read(readFileSync(`${target[ext]}.png`));
    copyFileSync(`${target[ext]}.png`, path.join(out, 'icons', `${ext}.png`));
    rmSync(`${target[ext]}.png`);
    const ours = types.find((t) => t.ext === ext)?.ours;
    const diff = iconDifference(drawn, icoEntry32(path.join(repoRoot, 'resources', 'fileicons', `${icon}.ico`)));
    report.icons[ext] = { ours, difference: Number(diff.toFixed(3)) };
    if (ours) check(diff < 0.05, `.${ext}: Windows draws another icon (difference ${diff.toFixed(3)})`);
  }
  step('icons Windows draws', report.icons);

  // ------------------------------------------------ double-click, then a multi-selection (one process per file)
  // The first time a type is opened after a new app registered for it, Windows may ask "How do you want to open
  // this file?" (OpenWith.exe) instead of starting the default, when another app had registered the type as well.
  // That answer is Windows' and counts as a result: the prompt is cancelled without a choice.
  const recentFile = path.join(dataFolders[0], 'recent.json');
  const inRecent = (file) => {
    try {
      return readFileSync(recentFile, 'utf8').toLowerCase().includes(path.basename(file).toLowerCase());
    } catch {
      return false;
    }
  };
  const openWithBefore = new Set(openWithPids());
  const newPrompts = () => openWithPids().filter((pid) => !openWithBefore.has(pid));
  report.shellOpens = {};
  shellOpen(target.docx);
  let win = null;
  await waitFor('the Simpaper window or Windows asking', () => (win = installedAppWindow()) !== null || newPrompts().length > 0, 60_000);
  if (!win && newPrompts().length) {
    report.shellOpens.docx = 'Windows asked';
    for (const pid of newPrompts()) execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
    openWithBefore.clear();
    for (const pid of openWithPids()) openWithBefore.add(pid);
    // Continue with Simpaper started directly on the document (what the user's choice in the prompt does).
    spawn(installedExe, [target.docx], { stdio: 'ignore', detached: true }).unref();
    await waitFor('the Simpaper window', () => (win = installedAppWindow()) !== null, 60_000);
  }
  check(Boolean(win), 'opening the .docx neither started Simpaper nor made Windows ask');
  if (win) {
    await waitFor('Rapor.docx in the title', () => W.windowInfo(win.hwnd).title.includes('Rapor.docx'), 60_000);
    check(W.windowInfo(win.hwnd).title.includes('Rapor.docx'), `window title "${W.windowInfo(win.hwnd).title}"`);
    report.shellOpens.docx ??= 'opened in Simpaper';
    step('double-click', { result: report.shellOpens.docx, title: W.windowInfo(win.hwnd).title });
    // Every other type alone first: Windows opens it in the running Simpaper, or asks once.
    for (const ext of ['pptx', 'odt', 'ods']) {
      const prompted = new Set(openWithPids());
      const asked = () => openWithPids().filter((pid) => !prompted.has(pid));
      shellOpen(target[ext]);
      await waitFor(`.${ext} in Simpaper or Windows asking`, () => inRecent(target[ext]) || asked().length > 0, 60_000);
      await sleep(1000);
      const prompts = asked();
      report.shellOpens[ext] = inRecent(target[ext]) ? 'opened in Simpaper' : prompts.length ? 'Windows asked' : 'nothing happened';
      for (const pid of prompts) execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      check(report.shellOpens[ext] !== 'nothing happened', `.${ext}: opened neither in Simpaper nor did Windows ask`);
    }
    // A multi-selection (one process per file, all at once) of fresh copies of the types Windows opens directly.
    // A type Windows still asks about is left out: its prompt closes when Simpaper comes to the front for the others.
    const direct = ['docx', 'pptx', 'odt', 'ods'].filter((ext) => report.shellOpens[ext] === 'opened in Simpaper');
    const copies = direct.map((ext) => {
      const copy = target[ext].replace(/(\.[a-z]+)$/i, ' (2)$1');
      copyFileSync(target[ext], copy);
      return copy;
    });
    if (copies.length >= 2) {
      for (const copy of copies) shellOpen(copy);
      check(await waitFor('the multi-selection in the recent list', () => copies.every(inRecent), 120_000, 1000), `not all of ${copies.length} files of a multi-selection reached Simpaper`);
      report.shellOpens.multiSelection = { files: copies.length, reached: copies.filter(inRecent).length };
    } else {
      report.shellOpens.multiSelection = 'skipped: fewer than two types open directly on this PC';
    }
    step('shell opens', { ...report.shellOpens, title: W.windowInfo(win.hwnd).title });
    execFileSync('taskkill', ['/PID', String(win.pid)], { stdio: 'ignore' });
    check(await waitFor('Simpaper to quit', () => processesFromInstall().length === 0, 60_000), 'Simpaper did not quit after WM_CLOSE');
  }
  restoreUserFiles();

  // ------------------------------------------------ Options › File types in the installed app
  const s = await launchSimpaper({ exe: installedExe, out: path.join(out, 'options'), port: 9360, settings: settingsPreset({ language: 'tr' }), tag: 'install-check' });
  try {
    await sleep(2500);
    await s.cdp.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Seçenekler')?.click()`);
    await waitFor('Options › File types', async () => (await s.cdp.eval(`document.querySelectorAll('.vr-filetypes__item').length`)) === 4, 20_000);
    const section = await s.cdp.eval(`(() => {
      const items = [...document.querySelectorAll('.vr-filetypes__item')].map((li) => li.textContent);
      const section = document.querySelector('.vr-filetypes')?.closest('section');
      section?.scrollIntoView();
      return { items, notes: [...(section?.querySelectorAll('.vr-option__hint') ?? [])].map((p) => p.textContent), button: Boolean(section?.querySelector('button')) };
    })()`);
    report.options = section;
    step('Options › File types', section);
    check(section.items.length === 4 && section.button, 'Options › File types does not show the registered state');
    check(!section.notes.some((n) => n.includes('kaydetmedi') || n.includes('başka bir Simpaper')), 'Options › File types shows a note for an unregistered copy');
    await sleep(800);
    await s.shot(out, 'options-file-types');
  } finally {
    s.close();
    await waitFor('the Options check to quit', () => processesFromInstall().length === 0, 30_000);
  }

  // ------------------------------------------------ uninstall
  await uninstall();
  const left = snapshotOurEntries();
  report.leftAfterUninstall = left;
  check(left.length === 0, `left after uninstalling: ${left.join(', ')}`);
  const changed = rows
    .map((r) => ({ ext: r.ext, before: baseline[r.ext], after: handlerOf(r.ext) }))
    .filter((x) => canonical(x.before.executable) !== canonical(x.after.executable) || (x.before.progId ?? '') !== (x.after.progId ?? ''));
  report.changedAfterUninstall = changed;
  check(changed.length === 0, `types that open differently than before: ${changed.map((c) => `.${c.ext}`).join(', ')}`);
  for (const d of dataFolders) {
    if (dataBefore.includes(d) || !existsSync(d)) continue;
    step('removing the data the test created', { folder: d, entries: readdirSync(d) });
    rmSync(d, { recursive: true, force: true });
  }
  rmSync(samples, { recursive: true, force: true });

  if (keep) {
    await install();
    check(snapshotOurEntries().length > 0, 'the final installation registered nothing');
    step('installed again and left installed (--keep)');
  }
}

try {
  await main();
} catch (error) {
  report.failures.push(`error: ${error?.stack ?? error}`);
  console.error(error?.stack ?? error);
} finally {
  try {
    restoreUserFiles();
  } catch (error) {
    report.failures.push(`could not restore the user's files: ${error?.message ?? error}`);
  }
  report.finishedAt = new Date().toISOString();
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(report.failures.length ? `[install-check] FAILED (${report.failures.length})` : '[install-check] all checks passed');
  process.exitCode = report.failures.length ? 1 : 0;
}
