/**
 * Derived formats produced by headless LibreOffice from the generated primary files
 * (ODF, legacy binary, RTF/TXT, CSV/TSV, templates, slideshow). Output bytes are not reproducible
 * (LibreOffice writes timestamps), their content is checked by the engine tests.
 */
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SofficeRunner, convertTarget } from './soffice.mjs';

const CSV_FILTER = 'Text - txt - csv (StarCalc)';

/**
 * CSV/TSV export FilterOptions: separator, quote, UTF-8, first line, (no column formats), language,
 * quote-all=false, detect-special=true, save-as-shown=true, formulas=false, trim=false, sheet 1,
 * evaluate=false, BOM.
 */
export function delimitedOptions(separatorCode, lcid, bom) {
  return `${separatorCode},34,76,1,,${lcid},false,true,true,false,false,1,false,${bom}`;
}

/** @type {Array<{ id: string, from: string, format: string, file: string, target: string, locale: 'en-US' | 'tr-TR', features: string[] }>} */
export const DERIVED_SPECS = [
  { id: 'docx-basic-odt', from: 'docx-basic', format: 'odt', file: 'derived/docx-basic.odt', target: convertTarget('odt', 'writer8'), locale: 'en-US', features: ['odf'] },
  { id: 'docx-basic-doc', from: 'docx-basic', format: 'doc', file: 'derived/docx-basic.doc', target: convertTarget('doc', 'MS Word 97'), locale: 'en-US', features: ['legacy-binary'] },
  { id: 'docx-basic-rtf', from: 'docx-basic', format: 'rtf', file: 'derived/docx-basic.rtf', target: convertTarget('rtf', 'Rich Text Format'), locale: 'en-US', features: ['rtf'] },
  {
    id: 'docx-basic-txt',
    from: 'docx-basic',
    format: 'txt',
    file: 'derived/docx-basic.txt',
    target: convertTarget('txt', 'Text (encoded)', 'UTF8,CRLF,,tr-TR,true,false'),
    locale: 'en-US',
    features: ['plain-text', 'utf8-bom'],
  },
  { id: 'docx-basic-dotx', from: 'docx-basic', format: 'dotx', file: 'derived/docx-basic.dotx', target: convertTarget('dotx', 'MS Word 2007 XML Template'), locale: 'en-US', features: ['template'] },
  { id: 'xlsx-basic-ods', from: 'xlsx-basic', format: 'ods', file: 'derived/xlsx-basic.ods', target: convertTarget('ods', 'calc8'), locale: 'en-US', features: ['odf'] },
  { id: 'xlsx-basic-xls', from: 'xlsx-basic', format: 'xls', file: 'derived/xlsx-basic.xls', target: convertTarget('xls', 'MS Excel 97'), locale: 'en-US', features: ['legacy-binary'] },
  {
    id: 'xlsx-basic-csv-tr',
    from: 'xlsx-basic',
    format: 'csv',
    file: 'derived/xlsx-basic.tr-TR.csv',
    target: convertTarget('csv', CSV_FILTER, delimitedOptions(59, 1055, true)),
    locale: 'tr-TR',
    features: ['csv', 'semicolon', 'decimal-comma', 'utf8-bom'],
  },
  {
    id: 'xlsx-basic-csv-en',
    from: 'xlsx-basic',
    format: 'csv',
    file: 'derived/xlsx-basic.en-US.csv',
    target: convertTarget('csv', CSV_FILTER, delimitedOptions(44, 1033, false)),
    locale: 'en-US',
    features: ['csv', 'comma', 'decimal-point'],
  },
  {
    id: 'xlsx-basic-tsv-en',
    from: 'xlsx-basic',
    format: 'tsv',
    file: 'derived/xlsx-basic.en-US.tsv',
    target: convertTarget('tsv', CSV_FILTER, delimitedOptions(9, 1033, false)),
    locale: 'en-US',
    features: ['tsv'],
  },
  { id: 'xlsx-basic-xltx', from: 'xlsx-basic', format: 'xltx', file: 'derived/xlsx-basic.xltx', target: convertTarget('xltx', 'Calc MS Excel 2007 XML Template'), locale: 'en-US', features: ['template'] },
  { id: 'pptx-basic-odp', from: 'pptx-basic', format: 'odp', file: 'derived/pptx-basic.odp', target: convertTarget('odp', 'impress8'), locale: 'en-US', features: ['odf'] },
  { id: 'pptx-basic-ppt', from: 'pptx-basic', format: 'ppt', file: 'derived/pptx-basic.ppt', target: convertTarget('ppt', 'MS PowerPoint 97'), locale: 'en-US', features: ['legacy-binary'] },
  { id: 'pptx-basic-potx', from: 'pptx-basic', format: 'potx', file: 'derived/pptx-basic.potx', target: convertTarget('potx', 'Impress MS PowerPoint 2007 XML Template'), locale: 'en-US', features: ['template'] },
  {
    id: 'pptx-basic-ppsx',
    from: 'pptx-basic',
    format: 'ppsx',
    file: 'derived/pptx-basic.ppsx',
    target: convertTarget('ppsx', 'Impress MS PowerPoint 2007 XML AutoPlay'),
    locale: 'en-US',
    features: ['slideshow'],
  },
];

/**
 * Runs the conversions of `specs` for sources found in `sources` (id → absolute path).
 * One runner per locale; each runner is disposed (process tree + profile) afterwards.
 * @returns {Promise<Array<{ spec: typeof DERIVED_SPECS[number], path: string }>>}
 */
export async function deriveFormats({ programDir, outDir, workDir, sources, specs = DERIVED_SPECS, log = () => {} }) {
  const results = [];
  const tmp = join(workDir, 'derive-tmp');
  mkdirSync(join(outDir, 'derived'), { recursive: true });
  const locales = [...new Set(specs.map((s) => s.locale))];
  for (const locale of locales) {
    const runner = new SofficeRunner({ programDir, workDir, locale, name: `corpus-${locale}` });
    try {
      for (const spec of specs.filter((s) => s.locale === locale)) {
        const input = sources[spec.from];
        if (!input) throw new Error(`source ${spec.from} missing for ${spec.id}`);
        const started = Date.now();
        const [out] = await runner.convert(input, spec.target, { outDir: join(tmp, spec.id) });
        const final = join(outDir, spec.file);
        rmSync(final, { force: true });
        renameSync(out, final);
        log(`  derived ${spec.file} (${Date.now() - started} ms)`);
        results.push({ spec, path: final });
      }
    } finally {
      await runner.dispose();
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  return results;
}
