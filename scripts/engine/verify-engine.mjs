#!/usr/bin/env node
/**
 * Headless smoke test of an engine folder (vendor/libreoffice or vendor/engine-dist).
 *
 * Converts a small Turkish Flat ODF text document to PDF and to DOCX with
 * `soffice.exe --headless --convert-to`, using a throw-away profile, and checks that:
 *  - the PDF contains the Turkish text (read back with pdf.js) and embeds the bundled
 *    Carlito and Liberation Serif fonts (proves share/fonts/truetype is picked up);
 *  - the DOCX is a valid package whose word/document.xml contains the text.
 * No window is opened. Every process started here is killed with its process tree afterwards.
 *
 * Usage: node scripts/engine/verify-engine.mjs [--engine DIR] [--work-dir DIR] [--keep]
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PANGRAM = 'Pijamalı hasta yağız şoföre çabucak güvendi.';
const PANGRAM_UPPER = 'PİJAMALI HASTA YAĞIZ ŞOFÖRE ÇABUCAK GÜVENDİ.';
const EXPECTED_FONTS = ['Carlito', 'LiberationSerif'];
const CONVERSION_TIMEOUT_MS = 180_000;

const SAMPLE_FODT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
  <office:font-face-decls>
    <style:font-face style:name="Carlito" svg:font-family="Carlito"/>
    <style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'"/>
  </office:font-face-decls>
  <office:automatic-styles>
    <style:style style:name="P1" style:family="paragraph">
      <style:text-properties style:font-name="Carlito" fo:font-size="14pt" fo:language="tr" fo:country="TR"/>
    </style:style>
    <style:style style:name="P2" style:family="paragraph">
      <style:text-properties style:font-name="Liberation Serif" fo:font-size="12pt" fo:language="tr" fo:country="TR"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      <text:p text:style-name="P1">${PANGRAM}</text:p>
      <text:p text:style-name="P2">${PANGRAM_UPPER}</text:p>
    </office:text>
  </office:body>
</office:document>
`;

/** Environment for soffice: drop variables that would leak into LibreOffice's own Python/UNO setup. */
function engineEnv() {
  const env = { ...process.env };
  for (const key of ['UNO_PATH', 'URE_BOOTSTRAP', 'PYTHONPATH', 'PYTHONHOME', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  env.PYTHONDONTWRITEBYTECODE = '1';
  // Never import settings from a LibreOffice profile the user may have in %APPDATA%.
  env.SAL_DISABLE_USERMIGRATION = '1';
  return env;
}

function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Kills soffice processes whose command line contains `token` (orphans of this run only). */
function killByCommandLineToken(token) {
  if (process.platform !== 'win32') return [];
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='soffice.exe' OR Name='soffice.bin'\" | " +
    `Where-Object { $_.CommandLine -like '*${token}*' } | ForEach-Object { $_.ProcessId }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const pids = (r.stdout ?? '').split(/\r?\n/).map((s) => Number.parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0);
  for (const pid of pids) killTree(pid);
  return pids;
}

function runSoffice(soffice, args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(soffice, args, { env: engineEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => {
      killTree(child.pid);
      resolve({ code: null, timedOut: true, output, ms: Date.now() - started, pid: child.pid });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, timedOut: false, output: `${output}\n${error.message}`, ms: Date.now() - started, pid: child.pid });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, output, ms: Date.now() - started, pid: child.pid });
    });
  });
}

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const parts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
    }
    return { pages: doc.numPages, text: parts.join('\n') };
  } finally {
    await task.destroy();
  }
}

/** Names of embedded fonts (subset prefix removed), read from the uncompressed font dictionaries. */
function pdfFontNames(file) {
  const latin1 = fs.readFileSync(file).toString('latin1');
  const names = new Set();
  for (const m of latin1.matchAll(/\/(?:BaseFont|FontName)\s*\/(?:[A-Z]{6}\+)?([A-Za-z0-9-]+)/g)) names.add(m[1]);
  return [...names].sort();
}

async function docxText(file) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('word/document.xml missing');
  return xml.replace(/<[^>]+>/g, '');
}

/**
 * @param {{ engineDir: string, workDir: string, keep?: boolean, timeoutMs?: number, log?: (msg: string) => void }} options
 * @returns {Promise<{ ok: boolean, checks: { name: string, ok: boolean, detail: string }[], newFiles: string[] }>}
 */
export async function verifyEngine({ engineDir, workDir, keep = false, timeoutMs = CONVERSION_TIMEOUT_MS, log = console.log }) {
  const soffice = path.join(engineDir, 'program', process.platform === 'win32' ? 'soffice.exe' : 'soffice');
  if (!fs.existsSync(soffice)) throw new Error(`soffice not found: ${soffice}`);
  const token = `varak-verify-${randomBytes(6).toString('hex')}`;
  const runDir = path.join(workDir, token);
  const profileDir = path.join(runDir, 'profile');
  const outDir = path.join(runDir, 'out');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const input = path.join(runDir, 'varak-smoke.fodt');
  fs.writeFileSync(input, SAMPLE_FODT, 'utf8');
  const before = listFiles(engineDir);

  const common = [
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    // English UI for the throw-away profile: with a Turkish UI (the default on a Turkish Windows)
    // headless conversions of LibreOffice 26.8.0.3 hang (docs/KNOWN_LIMITATIONS.md). The document
    // language stays Turkish.
    '--language=en-US',
    '--headless',
    '--invisible',
    '--nologo',
    '--nodefault',
    '--norestore',
    '--nolockcheck',
  ];
  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  };

  try {
    for (const [ext, filter] of [
      ['pdf', 'writer_pdf_Export'],
      ['docx', 'MS Word 2007 XML'],
    ]) {
      // --outdir is only accepted after --convert-to; placed before it, soffice waits on an invisible error box.
      const r = await runSoffice(soffice, [...common, '--convert-to', `${ext}:${filter}`, '--outdir', outDir, input], timeoutMs);
      const target = path.join(outDir, `varak-smoke.${ext}`);
      const produced = fs.existsSync(target) && fs.statSync(target).size > 0;
      const status = r.timedOut ? `timed out after ${r.ms} ms` : `exit code ${r.code}, ${r.ms} ms`;
      record(`convert to ${ext}`, !r.timedOut && r.code === 0 && produced, `${status}${produced ? `, ${fs.statSync(target).size} bytes` : ', no output'}`);
      if (!produced) {
        if (r.output.trim()) log(r.output.trim());
        continue;
      }
      if (ext === 'pdf') {
        const header = fs.readFileSync(target).subarray(0, 5).toString('latin1');
        record('PDF header', header === '%PDF-', JSON.stringify(header));
        const { pages, text } = await pdfText(target);
        const normalized = text.replace(/\s+/g, ' ');
        record('PDF text (Turkish)', normalized.includes(PANGRAM) && normalized.includes(PANGRAM_UPPER), `${pages} page(s)`);
        const fonts = pdfFontNames(target);
        const missing = EXPECTED_FONTS.filter((f) => !fonts.some((name) => name.startsWith(f)));
        record('bundled fonts embedded', missing.length === 0, `fonts: ${fonts.join(', ') || 'none'}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
      } else {
        const text = await docxText(target);
        record('DOCX text (Turkish)', text.includes(PANGRAM) && text.includes(PANGRAM_UPPER), 'word/document.xml read back with JSZip');
      }
    }
  } finally {
    const orphans = killByCommandLineToken(token);
    if (orphans.length) log(`  killed leftover engine processes: ${orphans.join(', ')}`);
  }

  const newFiles = [...listFiles(engineDir)].filter((f) => !before.has(f));
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  if (ok && !keep) fs.rmSync(runDir, { recursive: true, force: true });
  else log(`  work files kept in ${runDir}`);
  return { ok, checks, newFiles };
}

function listFiles(root) {
  const files = new Set();
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else files.add(r);
    }
  };
  walk(root, '');
  return files;
}

async function main() {
  const { values } = parseArgs({
    options: {
      engine: { type: 'string', default: path.join(repoRoot, 'vendor', 'engine-dist') },
      'work-dir': { type: 'string', default: path.join(repoRoot, 'test-output', 'engine-verify') },
      keep: { type: 'boolean', default: false },
      timeout: { type: 'string', default: String(CONVERSION_TIMEOUT_MS / 1000) },
    },
  });
  const engineDir = path.resolve(values.engine);
  console.log(`Verifying engine at ${engineDir}`);
  const result = await verifyEngine({
    engineDir,
    workDir: path.resolve(values['work-dir']),
    keep: values.keep,
    timeoutMs: Number(values.timeout) * 1000,
  });
  if (result.newFiles.length) console.log(`  files created inside the engine folder by the run: ${result.newFiles.length}`);
  console.log(result.ok ? 'Engine verification passed.' : 'Engine verification FAILED.');
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
