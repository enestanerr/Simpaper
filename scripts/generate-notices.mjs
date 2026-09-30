#!/usr/bin/env node
/**
 * Generates THIRD_PARTY_NOTICES.md.
 *
 * - npm production dependencies: the packages listed in package.json "dependencies" and their
 *   transitive production dependencies, resolved from node_modules the way Node resolves them;
 *   name, version, license, repository and the license/notice files shipped in each package.
 * - Electron/Chromium runtime (packaged by electron-builder, which also ships LICENSES.chromium.html).
 * - The LibreOffice engine: components and licenses listed in its LICENSE.html, fonts it ships
 *   (read from the font files' name tables), source-code location from scripts/engine/engine.lock.json.
 *
 * The engine sections need the engine image (npm run engine:fetch, npm run engine:prepare); without it
 * they fall back to a short description. Run: npm run notices
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUTPUT = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._ ].*)?$/i;
/** Installed as optional dependencies but excluded from the package by electron-builder.yml (never shipped). */
const NOT_SHIPPED = ['@napi-rs/canvas'];
/** Notices for code inside shipped packages that the package's own license file does not state (re-check on upgrades). */
const SUPPLEMENTS = {
  '@cantoo/pdf-lib': [
    '`core/crypto.js` and `core/streams/*.js` are ports of Mozilla pdf.js ("Copyright 2012 Mozilla Foundation"),',
    '`core/streams/FlateStream.js` also of XPDF ("Copyright 1996-2003 Glyph & Cog, LLC"), both under the Apache License,',
    'Version 2.0 (license text in the pdfjs-dist section).',
  ],
  brotli: [
    'The decoder in `dec/` (used by @cantoo/fontkit for WOFF2 fonts) is a port of Google Brotli; its files state',
    '"Copyright 2013 Google Inc. All Rights Reserved. Licensed under the Apache License, Version 2.0" (license text in the',
    'pdfjs-dist section).',
  ],
};
/** Copyright holder of a package that ships no license file (package.json "author"). */
function authorOf(pkg) {
  const a = pkg.author;
  const name = typeof a === 'string' ? a.replace(/\s*[<(].*$/, '') : a?.name;
  return name || `the ${pkg.name} authors`;
}
const MIT_PERMISSION = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const SKIP_DIRS = new Set(['node_modules', 'test', 'tests', '__tests__', 'example', 'examples', 'docs', 'doc', '.github']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function repositoryOf(pkg) {
  let url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!url) return pkg.homepage ?? '';
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  url = url.replace(/^github:/, 'https://github.com/').replace(/^git\+/, '').replace(/^git:\/\//, 'https://');
  url = url.replace(/^ssh:\/\/git@/, 'https://').replace(/^git@github\.com:/, 'https://github.com/');
  return url.replace(/\.git$/, '');
}

/** Resolves `name` as Node would when required from a package located in `fromDir`. */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.resolve(dir) === repoRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Production dependency closure of the root package. */
function collectPackages() {
  const root = readJson(path.join(repoRoot, 'package.json'));
  const found = new Map();
  const queue = Object.keys(root.dependencies ?? {}).map((name) => ({ name, from: repoRoot, optional: false }));
  while (queue.length) {
    const { name, from, optional } = queue.shift();
    if (NOT_SHIPPED.some((prefix) => name.startsWith(prefix))) continue;
    const dir = resolvePackageDir(name, from);
    if (!dir) {
      if (!optional) throw new Error(`Cannot resolve ${name} from ${path.relative(repoRoot, from) || '.'} - run npm ci`);
      continue; // optional dependency for another platform
    }
    const real = fs.realpathSync(dir);
    if (found.has(real)) continue;
    const pkg = readJson(path.join(dir, 'package.json'));
    found.set(real, { dir, pkg });
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, from: dir, optional: false });
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: dep, from: dir, optional: true });
  }
  // A fixed collation: the machine's default (tr-TR here, en-US on CI) would reorder the output.
  return [...found.values()].sort((a, b) => a.pkg.name.localeCompare(b.pkg.name, 'en-US') || a.pkg.version.localeCompare(b.pkg.version, 'en-US'));
}

/** License and notice files anywhere in the package (vendored code included), outside node_modules, tests and docs. */
function licenseFiles(dir) {
  const result = [];
  const scan = (d, rel, depth) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en-US'))) {
      if (entry.isFile() && LICENSE_FILE.test(entry.name) && !/\.(svg|png)$/i.test(entry.name)) result.push(rel ? `${rel}/${entry.name}` : entry.name);
      else if (entry.isDirectory() && depth < 4 && !SKIP_DIRS.has(entry.name)) scan(path.join(d, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
    }
  };
  scan(dir, '', 0);
  return result;
}

function fence(text) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(longest + 1);
}

function codeBlock(text) {
  const f = fence(text);
  return `${f}text\n${text.replace(/\r\n/g, '\n').trimEnd()}\n${f}`;
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function engineDir() {
  for (const d of ['vendor/engine-dist', 'vendor/libreoffice']) {
    const dir = path.join(repoRoot, ...d.split('/'));
    if (fs.existsSync(path.join(dir, 'LICENSE.html'))) return { dir, rel: d };
  }
  return null;
}

/** Component → license references from the engine's LICENSE.html, grouped by its sections. */
function engineComponents(dir) {
  const html = fs.readFileSync(path.join(dir, 'LICENSE.html'), 'utf8');
  const sections = [];
  for (const id of ['Libraries', 'Extensions', 'Fonts', 'Dictionaries', 'Artwork']) {
    const start = html.indexOf(`id="a__${id}"`);
    if (start < 0) continue;
    const next = html.indexOf('<h1', start + 1);
    const body = html.slice(start, next < 0 ? undefined : next);
    const items = [];
    for (const part of body.split('<h2>').slice(1)) {
      const name = decodeEntities(part.slice(0, part.indexOf('</h2>')).replace(/<[^>]+>/g, '').trim());
      if (!name) continue;
      const licenses = [...new Set([...part.matchAll(/Jump to ([^<]+)<\/a>/g)].map((m) => decodeEntities(m[1].trim())))];
      items.push({ name, licenses: licenses.length ? licenses : ['license text in LICENSE.html'] });
    }
    sections.push({ id, items });
  }
  return sections;
}

function classifyFontLicense(text) {
  if (/open font license|scripts\.sil\.org\/ofl|openfontlicense/i.test(text)) return 'SIL Open Font License 1.1';
  if (/apache license/i.test(text)) return 'Apache License 2.0';
  if (/general public license|gnu gpl|\bgpl\b/i.test(text)) return 'GNU GPL (with font exception where stated)';
  if (/bitstream vera|dejavu/i.test(text)) return 'Bitstream Vera / DejaVu license';
  if (/public domain/i.test(text)) return 'Public domain';
  return 'see the font file / LICENSE.html';
}

/** Font families shipped with the engine, with the license stated in each font's name table. */
async function engineFonts(dir) {
  const fontDir = [path.join(dir, 'share', 'fonts', 'truetype'), path.join(dir, 'Fonts')].find((d) => fs.existsSync(d));
  if (!fontDir) return [];
  const fontkit = require('@cantoo/fontkit');
  const families = new Map();
  for (const file of fs.readdirSync(fontDir).filter((f) => /\.(ttf|otf|ttc)$/i.test(f)).sort()) {
    let font;
    try {
      font = fontkit.openSync(path.join(fontDir, file));
    } catch {
      continue;
    }
    const records = font.name?.records ?? {};
    const pick = (key) => {
      const r = records[key];
      return r ? String(r.en ?? Object.values(r)[0] ?? '') : '';
    };
    const family = pick('fontFamily') || font.familyName || file;
    const licenseText = `${pick('license')} ${pick('licenseURL')} ${pick('copyright')}`;
    const f = families.get(family) ?? { family, files: 0, license: classifyFontLicense(licenseText), copyright: pick('copyright') };
    f.files++;
    families.set(family, f);
  }
  return [...families.values()].sort((a, b) => a.family.localeCompare(b.family, 'en-US'));
}

async function main() {
  const packages = collectPackages();
  const lock = readJson(path.join(repoRoot, 'scripts', 'engine', 'engine.lock.json'));
  const out = [];
  const push = (...lines) => out.push(...lines);

  push(
    '# Third-party notices',
    '',
    'Varak is licensed under the [Mozilla Public License 2.0](LICENSE). The distributed application also',
    'contains the third-party software listed below, each under its own license. This file is generated by',
    '`npm run notices` ([scripts/generate-notices.mjs](scripts/generate-notices.mjs)); regenerate it whenever',
    'dependencies or the engine version change.',
    '',
    '## Contents',
    '',
    '1. [LibreOffice engine](#libreoffice-engine)',
    '2. [Electron and Chromium](#electron-and-chromium)',
    '3. [npm packages (production dependencies)](#npm-packages-production-dependencies)',
    '4. [License texts of the npm packages](#license-texts-of-the-npm-packages)',
    '',
  );

  // ------------------------------------------------------------------ engine
  const engine = engineDir();
  push(
    '## LibreOffice engine',
    '',
    `Varak ships **LibreOffice ${lock.version}** (Windows x64) as its document engine. The LibreOffice files are`,
    'redistributed **unmodified** (byte-identical to the official MSI of The Document Foundation); optional parts',
    'such as other user-interface languages, spelling dictionaries of other languages and the offline help are left',
    'out (see `resources/engine/VARAK-ENGINE.json` in an installed copy).',
    '',
    '- LibreOffice is licensed under the Mozilla Public License 2.0; it contains third-party components under their',
    '  own licenses, including GNU GPL and LGPL components (for example the Poppler-based PDF import helper',
    '  `xpdfimport`), Apache, BSD, MIT and other licenses, fonts under the SIL Open Font License and other font',
    '  licenses, and the Microsoft Visual C++ runtime.',
    '- The complete license texts and notices ship with the engine unchanged: `LICENSE.html`, `license.txt`, `NOTICE`,',
    '  `CREDITS.fodt` and `readmes/` in the `engine` folder of the installation.',
    `- **Source code:** the corresponding source code of this exact release is available from The Document Foundation at`,
    `  <${lock.sourceUrl}> (\`libreoffice-${lock.version}.tar.xz\` plus the dictionaries, help and translations`,
    '  tarballs; external libraries are listed in `download.lst` of the source tree). See also',
    '  [docs/PACKAGING.md](docs/PACKAGING.md#source-code-of-the-engine).',
    `- Installer that was verified: SHA-256 \`${lock.sha256}\`, signed with the LibreOffice build key`,
    `  \`${lock.gpgFingerprint}\`.`,
    '- LibreOffice® is a registered trademark of The Document Foundation. Varak is not affiliated with or endorsed by',
    '  The Document Foundation.',
    '',
  );
  if (engine) {
    const sections = engineComponents(engine.dir);
    push(`Components listed in the engine's \`LICENSE.html\` (read from \`${engine.rel}\`):`, '');
    for (const s of sections) {
      push(`<details><summary>${s.id} (${s.items.length})</summary>`, '', '| Component | License (as referenced in LICENSE.html) |', '|---|---|');
      for (const item of s.items) push(`| ${escapeCell(item.name)} | ${escapeCell(item.licenses.join('; '))} |`);
      push('', '</details>', '');
    }
    const fonts = await engineFonts(engine.dir);
    if (fonts.length) {
      push(
        '### Fonts shipped with the engine',
        '',
        'The engine registers these fonts privately (they are not installed into Windows). License as stated in each',
        'font file; the full texts are in `LICENSE.html`.',
        '',
        '| Family | Files | License |',
        '|---|---:|---|',
      );
      for (const f of fonts) push(`| ${escapeCell(f.family)} | ${f.files} | ${escapeCell(f.license)} |`);
      push('');
    }
  } else {
    push('_The engine image was not available when this file was generated; run `npm run engine:fetch` and regenerate._', '');
  }

  // ------------------------------------------------------------------ electron
  const electronPkg = readJson(path.join(repoRoot, 'node_modules', 'electron', 'package.json'));
  push(
    '## Electron and Chromium',
    '',
    `The application runtime is **Electron ${electronPkg.version}** (MIT License), which contains Chromium, Node.js and`,
    'their third-party components. electron-builder places `LICENSE.electron.txt` and `LICENSES.chromium.html` (the',
    'complete Chromium third-party license list) next to `Varak.exe`.',
    '',
    codeBlock(fs.readFileSync(path.join(repoRoot, 'node_modules', 'electron', 'LICENSE'), 'utf8')),
    '',
  );

  // ------------------------------------------------------------------ npm packages
  push(
    '## npm packages (production dependencies)',
    '',
    `${packages.length} packages: the \`dependencies\` of package.json and everything they depend on at run time.`,
    'Some are bundled into the application code by Vite, the others are shipped in `resources/app.asar`.',
    '',
    '| Package | Version | License | Repository |',
    '|---|---|---|---|',
  );
  for (const { pkg } of packages) {
    push(`| ${escapeCell(pkg.name)} | ${pkg.version} | ${escapeCell(licenseOf(pkg))} | ${escapeCell(repositoryOf(pkg))} |`);
  }
  push('', 'pdf.js (`pdfjs-dist`) includes further components with their own licenses: CMaps (Adobe), ICC profiles,');
  push('the Foxit and Liberation standard fonts, and WebAssembly builds of OpenJPEG, JBIG2 and qcms. Their license files');
  push('are reproduced in the pdfjs-dist section below.', '');

  push('## License texts of the npm packages', '');
  for (const { dir, pkg } of packages) {
    const files = licenseFiles(dir);
    push(`### ${pkg.name} ${pkg.version}`, '', `License: ${licenseOf(pkg)}${repositoryOf(pkg) ? ` - ${repositoryOf(pkg)}` : ''}`, '');
    if (SUPPLEMENTS[pkg.name]) push(...SUPPLEMENTS[pkg.name], '');
    if (!files.length) {
      push(`_The package does not include a license file; its package.json declares "${licenseOf(pkg)}"._`, '');
      if (licenseOf(pkg) === 'MIT') push(codeBlock(`MIT License\n\nCopyright (c) ${authorOf(pkg)}\n\n${MIT_PERMISSION}`), '');
      continue;
    }
    const seen = new Set();
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, ...f.split('/')), 'utf8');
      const key = text.replace(/\s+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      push(`<details><summary>${f}</summary>`, '', codeBlock(text), '', '</details>', '');
    }
  }

  fs.writeFileSync(OUTPUT, `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`);
  console.log(`Wrote ${path.relative(repoRoot, OUTPUT)}: ${packages.length} npm packages, engine ${engine ? `from ${engine.rel}` : 'not available'}.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
