#!/usr/bin/env node
/**
 * Builds the engine folder that ships with the app (vendor/engine-dist) from the extracted
 * LibreOffice image (vendor/libreoffice, see fetch-engine.ps1).
 *
 * LibreOffice files are taken byte for byte (hard links when possible, otherwise copies). Only
 * optional parts are left out, the same way a custom MSI installation would leave them out:
 *   - UI languages other than the configured ones (program/resource/<lang>, Langpack-<lang>.xcd,
 *     share/registry/res/*_<lang>.xcd, share/autotext/<lang>, extension help pages),
 *   - spelling dictionaries (share/extensions/dict-*) and word lists (share/wordbook) of other languages,
 *   - the offline help viewer (help/), the admin-image MSI copy, the 32-bit runtime (System/),
 *   - Python bytecode caches created by earlier runs (__pycache__).
 * Two folders are relocated to where a portable LibreOffice looks for them:
 *   - Fonts/*            -> share/fonts/truetype/ (privately registered by LibreOffice at start-up),
 *   - System64/*.dll     -> program/ (Visual C++ runtime; the MSI normally installs it system-wide).
 * License files (LICENSE.html, license.txt, NOTICE, CREDITS.fodt, readmes/) are kept unchanged.
 * A summary is written to SIMPAPER-ENGINE.json in the output folder.
 *
 * Usage:
 *   node scripts/engine/prepare-engine.mjs [--source DIR] [--out DIR] [--ui-langs en-US,tr]
 *        [--dicts en,tr] [--copy] [--dry-run] [--verify] [--work-dir DIR]
 * Environment: SIMPAPER_ENGINE_UI_LANGS, SIMPAPER_ENGINE_DICTIONARIES override the language defaults.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyEngine } from './verify-engine.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_UI_LANGS = ['en-US', 'tr'];
const DEFAULT_DICTIONARIES = ['en', 'tr'];
const LICENSE_FILES = ['LICENSE.html', 'license.txt', 'NOTICE', 'CREDITS.fodt', 'readmes'];

/** `bn_IN` → `bn-IN`, `sr@latin` → `sr-Latn`, `ca@valencia` → `ca-valencia` (program/resource naming). */
export function resourceDirToTag(name) {
  return name.replace('@latin', '-Latn').replace('@valencia', '-valencia').replace(/_/g, '-');
}

/** `pt-BR` → `pt`, `hu_AkH11` → `hu`. */
export function baseLanguage(name) {
  return name.split(/[-_@]/)[0].toLowerCase();
}

export function readEngineInfo(sourceDir) {
  const versionIni = fs.readFileSync(path.join(sourceDir, 'program', 'version.ini'), 'utf8');
  const allLanguages = (/^AllLanguages=(.*)$/m.exec(versionIni)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
  const buildId = (/^buildid=(.*)$/m.exec(versionIni)?.[1] ?? '').trim();
  const mainXcd = fs.readFileSync(path.join(sourceDir, 'share', 'registry', 'main.xcd'), 'utf8');
  const version = /oor:name="ooSetupVersionAboutBox"><value>([^<]+)</.exec(mainXcd)?.[1] ?? null;
  if (!allLanguages.length || !version) throw new Error(`${sourceDir} does not look like a LibreOffice image`);
  return { version, buildId, allLanguages };
}

/**
 * Decides what happens to one file of the image. `rel` is a POSIX path relative to the image root.
 * @returns {{ action: 'keep', to: string } | { action: 'drop', group: string, reason: string }}
 */
export function classify(rel, ctx) {
  const parts = rel.split('/');
  const [top] = parts;
  const drop = (group, reason, category) => ({ action: 'drop', group, reason, category: category ?? reason });
  const keep = (to = rel) => ({ action: 'keep', to });

  if (parts.includes('__pycache__') || rel.endsWith('.pyc')) {
    return drop(`${parts.slice(0, parts.indexOf('__pycache__') + 1).join('/') || rel}`, 'Python bytecode cache created at run time', 'Python bytecode caches');
  }
  if (top === 'help') return drop('help', 'offline help (the app opens its own help)', 'offline help');
  if (parts.length === 1 && rel.toLowerCase().endsWith('.msi')) return drop(rel, 'copy of the MSI left by the administrative installation', 'admin-image MSI copy');
  if (top === 'System') return drop('System', '32-bit Visual C++ runtime (not used by the x64 engine)', '32-bit runtime');
  if (top === 'Fonts') return keep(['share', 'fonts', 'truetype', ...parts.slice(1)].join('/'));
  if (top === 'System64') {
    const to = ['program', ...parts.slice(1)].join('/');
    return ctx.sourceFiles.has(to) ? drop(rel, 'already present in program/', 'duplicate runtime DLLs') : keep(to);
  }
  if (LICENSE_FILES.includes(top)) return keep();

  // UI languages
  if (top === 'program' && parts[1] === 'resource' && parts.length > 3 && parts[2] !== 'common') {
    const tag = resourceDirToTag(parts[2]);
    if (ctx.allLanguages.has(tag) && !ctx.uiLangs.has(tag)) return drop(parts.slice(0, 3).join('/'), `UI language ${tag}`, 'other UI languages');
  }
  if (top === 'share' && parts[1] === 'registry') {
    const m = /^(?:Langpack-|fcfg_langpack_|registry_)(.+)\.xcd$/.exec(parts[parts.length - 1]);
    if (m && ctx.allLanguages.has(m[1]) && !ctx.uiLangs.has(m[1])) return drop(rel, `UI language ${m[1]}`, 'other UI languages');
  }
  if (top === 'share' && parts[1] === 'autotext' && parts.length > 3 && ctx.allLanguages.has(parts[2]) && !ctx.uiLangs.has(parts[2])) {
    return drop(parts.slice(0, 3).join('/'), `AutoText ${parts[2]}`, 'AutoText of other languages');
  }

  // Spelling, hyphenation and thesaurus data (checked before the extension help pages)
  if (top === 'share' && parts[1] === 'extensions' && parts[2]?.startsWith('dict-') && parts.length > 3) {
    const lang = baseLanguage(parts[2].slice('dict-'.length));
    if (!ctx.dictionaries.has(lang)) return drop(parts.slice(0, 3).join('/'), `dictionary ${parts[2].slice(5)}`, 'spelling dictionaries of other languages');
  }
  if (top === 'share' && parts[1] === 'extensions' && parts[3] === 'help' && parts.length > 5) {
    const tag = parts[4];
    if (ctx.allLanguages.has(tag) && !ctx.uiLangs.has(tag)) return drop(parts.slice(0, 5).join('/'), `extension help ${tag}`, 'extension help of other languages');
  }
  if (top === 'share' && parts[1] === 'wordbook' && parts.length === 3) {
    const lang = baseLanguage(parts[2].replace(/\.dic$/i, ''));
    if (ctx.languageCodes.has(lang) && !ctx.dictionaries.has(lang)) return drop(rel, `word list ${parts[2]}`, 'word lists of other languages');
  }
  return keep();
}

/** Files (relative POSIX path → size) and empty directories of an image. */
function walkImage(root) {
  const files = new Map();
  const emptyDirs = [];
  const walk = (dir, rel) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (rel && entries.length === 0) emptyDirs.push(rel);
    for (const entry of entries) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, r);
      else if (entry.isFile()) files.set(r, fs.statSync(full).size);
    }
  };
  walk(root, '');
  return { files, emptyDirs };
}

function linkOrCopy(src, dst, mode) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (mode === 'link') {
    try {
      fs.linkSync(src, dst);
      return 'link';
    } catch (error) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EACCES', 'EMLINK'].includes(error.code)) throw error;
    }
  }
  fs.copyFileSync(src, dst);
  return 'copy';
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function mib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function summarizeByCategory(entries) {
  const byCategory = new Map();
  for (const e of entries) {
    const c = byCategory.get(e.category) ?? { category: e.category, entries: 0, files: 0, bytes: 0 };
    c.entries++;
    c.files += e.files;
    c.bytes += e.bytes;
    byCategory.set(e.category, c);
  }
  return [...byCategory.values()].sort((a, b) => b.bytes - a.bytes);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function listOption(value, envName, fallback) {
  const raw = value ?? process.env[envName];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function prepareEngine({ sourceDir, outDir, uiLangs, dictionaries, mode = 'link', dryRun = false, log = console.log }) {
  if (isInside(outDir, sourceDir) || isInside(sourceDir, outDir)) throw new Error('--out must not overlap --source');
  const info = readEngineInfo(sourceDir);
  const allLanguages = new Set(info.allLanguages);
  const unknown = uiLangs.filter((l) => !allLanguages.has(l));
  if (unknown.length) throw new Error(`Unknown UI language(s): ${unknown.join(', ')}. Available: ${info.allLanguages.join(' ')}`);
  const ui = new Set(['en-US', ...uiLangs]);
  const dictDirs = fs.readdirSync(path.join(sourceDir, 'share', 'extensions')).filter((d) => d.startsWith('dict-'));
  const dictLangs = new Set(dictDirs.map((d) => baseLanguage(d.slice(5))));
  for (const d of dictionaries) if (!dictLangs.has(d)) log(`warning: no spelling dictionary for "${d}" in this engine`);

  const { files: sourceFiles, emptyDirs } = walkImage(sourceDir);
  const ctx = {
    uiLangs: ui,
    dictionaries: new Set(dictionaries.map((d) => d.toLowerCase())),
    allLanguages,
    languageCodes: new Set([...info.allLanguages.map(baseLanguage), ...dictLangs]),
    sourceFiles,
  };

  const removed = new Map();
  const moved = new Map();
  const plan = [];
  for (const [rel, size] of [...sourceFiles].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const decision = classify(rel, ctx);
    if (decision.action === 'drop') {
      const r = removed.get(decision.group) ?? { path: decision.group, reason: decision.reason, category: decision.category, files: 0, bytes: 0 };
      r.files++;
      r.bytes += size;
      removed.set(decision.group, r);
      continue;
    }
    if (decision.to !== rel) {
      const from = rel.split('/')[0];
      const to = path.posix.dirname(decision.to);
      const key = `${from}->${to}`;
      const m = moved.get(key) ?? { from, to, files: 0, bytes: 0 };
      m.files++;
      m.bytes += size;
      moved.set(key, m);
    }
    plan.push({ rel, to: decision.to, size });
  }
  // Empty folders (e.g. share/uno_packages/cache/uno_packages) are recreated when their content would be kept.
  const dirs = emptyDirs
    .map((d) => classify(`${d}/.keep`, ctx))
    .filter((d) => d.action === 'keep')
    .map((d) => path.posix.dirname(d.to));

  const sourceBytes = [...sourceFiles.values()].reduce((a, b) => a + b, 0);
  const distBytes = plan.reduce((a, f) => a + f.size, 0);
  const lock = readJson(path.join(repoRoot, 'scripts', 'engine', 'engine.lock.json'));
  const provenance = readJson(path.join(path.dirname(sourceDir), 'engine-image.json'));
  if (lock && lock.version !== info.version) log(`warning: image version ${info.version} differs from engine.lock.json (${lock.version})`);

  const summary = {
    engine: 'LibreOffice',
    version: info.version,
    buildId: info.buildId,
    msiSha256: lock?.sha256 ?? null,
    sourceUrl: lock?.sourceUrl ?? null,
    provenance: provenance ?? 'unknown (image not extracted by scripts/engine/fetch-engine.ps1)',
    unmodified: 'LibreOffice files are byte-identical to the administrative installation of the MSI; optional parts are omitted and two folders are relocated (see removed/moved).',
    uiLanguages: [...ui].sort(),
    dictionaries: [...ctx.dictionaries].sort(),
    layout: { fonts: 'share/fonts/truetype', visualCppRuntime: 'program' },
    sizes: { sourceFiles: sourceFiles.size, sourceBytes, distFiles: plan.length, distBytes, emptyDirs: dirs.length },
    removedByCategory: summarizeByCategory(removed.values()),
    removed: [...removed.values()].sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1)),
    moved: [...moved.values()],
    generator: 'scripts/engine/prepare-engine.mjs',
  };

  log(`LibreOffice ${info.version} (build ${info.buildId.slice(0, 12)}): ${sourceFiles.size} files, ${mib(sourceBytes)}`);
  log(`UI languages: ${summary.uiLanguages.join(', ')}; dictionaries: ${summary.dictionaries.join(', ')}`);
  log(`Result: ${plan.length} files, ${mib(distBytes)} (${mib(sourceBytes - distBytes)} left out)`);
  if (dryRun) return summary;

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const used = { link: 0, copy: 0 };
  for (const f of plan) used[linkOrCopy(path.join(sourceDir, ...f.rel.split('/')), path.join(outDir, ...f.to.split('/')), mode)]++;
  for (const d of dirs) fs.mkdirSync(path.join(outDir, ...d.split('/')), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'SIMPAPER-ENGINE.json'), `${JSON.stringify(summary, null, 2)}\n`);
  log(`Wrote ${outDir} (${used.link} hard links, ${used.copy} copies) and SIMPAPER-ENGINE.json`);
  return summary;
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: path.join(repoRoot, 'vendor', 'libreoffice') },
      out: { type: 'string', default: path.join(repoRoot, 'vendor', 'engine-dist') },
      'ui-langs': { type: 'string' },
      dicts: { type: 'string' },
      copy: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      'work-dir': { type: 'string', default: path.join(repoRoot, 'test-output', 'engine-verify') },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/engine/prepare-engine.mjs [--source DIR] [--out DIR] [--ui-langs en-US,tr] [--dicts en,tr] [--copy] [--dry-run] [--verify] [--work-dir DIR]');
    return;
  }
  const sourceDir = path.resolve(values.source);
  const outDir = path.resolve(values.out);
  if (!fs.existsSync(path.join(sourceDir, 'program', 'version.ini'))) {
    throw new Error(`No engine image at ${sourceDir}. Run "npm run engine:fetch" first.`);
  }
  const summary = prepareEngine({
    sourceDir,
    outDir,
    uiLangs: listOption(values['ui-langs'], 'SIMPAPER_ENGINE_UI_LANGS', DEFAULT_UI_LANGS),
    dictionaries: listOption(values.dicts, 'SIMPAPER_ENGINE_DICTIONARIES', DEFAULT_DICTIONARIES),
    mode: values.copy ? 'copy' : 'link',
    dryRun: values['dry-run'],
  });
  for (const c of summary.removedByCategory) console.log(`  - ${c.category}: ${mib(c.bytes)} (${c.entries} entries, ${c.files} files)`);
  for (const m of summary.moved) console.log(`  > ${m.from}/ -> ${m.to}/: ${m.files} files, ${mib(m.bytes)}`);

  if (values.verify && !values['dry-run']) {
    console.log('Verifying the prepared engine (headless conversion) ...');
    const result = await verifyEngine({ engineDir: outDir, workDir: path.resolve(values['work-dir']) });
    for (const f of result.newFiles) fs.rmSync(path.join(outDir, ...f.split('/')), { force: true });
    if (result.newFiles.length) console.log(`  removed ${result.newFiles.length} file(s) the engine created in its own folder during the run`);
    if (!result.ok) throw new Error('Engine verification failed.');
    console.log('Engine verification passed.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
