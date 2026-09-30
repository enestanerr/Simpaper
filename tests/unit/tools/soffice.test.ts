import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { convertArgs, expectedOutputPath, findProgramDir, profileXcu, sofficeEnv } from '../../../scripts/corpus/lib/soffice.mjs';
import { CORPUS_OUTPUT } from '../../tools/paths';
import { convertTarget, pdfFilterData, pdfFilterFor, sameFormatFilter } from '../../tools/soffice';
import { parseXml, textContent, type XElement } from '../../tools/xml';

// Pure parts of the runner only: no LibreOffice process is started here (see tests/engine for that).

function xcuValues(xml: string): Map<string, string> {
  const root = parseXml(xml);
  const out = new Map<string, string>();
  for (const item of root.children as XElement[]) {
    if (!('local' in item) || item.local !== 'item') continue;
    const prop = item.children.find((c): c is XElement => 'local' in c && c.local === 'prop')!;
    out.set(`${item.attrs['oor:path']}/${prop.attrs['oor:name']}`, textContent(prop));
  }
  return out;
}

describe('profileXcu', () => {
  it('forces an English UI, applies the document locale and disables macros, locking and stale caches', () => {
    const v = xcuValues(profileXcu({ locale: 'tr-TR' }));
    expect(v.get('/org.openoffice.Setup/L10N/ooLocale')).toBe('en-US');
    expect(v.get('/org.openoffice.Office.Linguistic/General/UILocale')).toBe('en-US');
    expect(v.get('/org.openoffice.Setup/L10N/ooSetupSystemLocale')).toBe('tr-TR');
    expect(v.get('/org.openoffice.Office.Linguistic/General/DefaultLocale')).toBe('tr-TR');
    expect(v.get('/org.openoffice.Office.Common/Security/Scripting/DisableMacrosExecution')).toBe('true');
    expect(v.get('/org.openoffice.Office.Common/Security/Scripting/MacroSecurityLevel')).toBe('3');
    expect(v.get('/org.openoffice.Office.Calc/Formula/Load/OOXMLRecalcMode')).toBe('0');
    expect(v.get('/org.openoffice.Office.Calc/Formula/Load/ODFRecalcMode')).toBe('0');
    expect(v.get('/org.openoffice.Office.Common/Misc/UseDocumentOOoLockFile')).toBe('false');
    expect(v.get('/org.openoffice.Office.Linguistic/SpellChecking/IsSpellAuto')).toBe('false');
    expect(v.get('/org.openoffice.Setup/Office/MigrationCompleted')).toBe('true');
    expect(xcuValues(profileXcu()).get('/org.openoffice.Setup/L10N/ooSetupSystemLocale')).toBe('en-US');
  });
});

describe('command line', () => {
  it('builds a headless --convert-to invocation with an isolated profile', () => {
    const args = convertArgs({ profileUrl: 'file:///C:/p', target: 'pdf', outDir: 'C:\\out', inputs: ['C:\\a.docx', 'C:\\b.docx'] });
    expect(args[0]).toBe('-env:UserInstallation=file:///C:/p');
    expect(args).toEqual(expect.arrayContaining(['--headless', '--invisible', '--nologo', '--nodefault', '--norestore', '--nolockcheck']));
    expect(args.slice(-6)).toEqual(['--convert-to', 'pdf', '--outdir', 'C:\\out', 'C:\\a.docx', 'C:\\b.docx']);
  });

  it('removes leaking variables and disables OpenCL/migration', () => {
    const env = sofficeEnv({ ELECTRON_RUN_AS_NODE: '1', PYTHONPATH: 'x', UNO_PATH: 'y', PATH: 'p' });
    expect(env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
    expect(env['PYTHONPATH']).toBeUndefined();
    expect(env['UNO_PATH']).toBeUndefined();
    expect(env['PATH']).toBe('p');
    expect(env['SAL_DISABLE_OPENCL']).toBe('1');
    expect(env['SAL_DISABLE_USERMIGRATION']).toBe('1');
  });

  it('derives output names and targets', () => {
    expect(expectedOutputPath('C:\\x\\Şehir listesi.xlsx', 'csv:Text - txt - csv (StarCalc):59,34,76', 'C:\\o')).toBe(join('C:\\o', 'Şehir listesi.csv'));
    expect(convertTarget('odt')).toBe('odt');
    expect(convertTarget('doc', 'MS Word 97')).toBe('doc:MS Word 97');
    const json = convertTarget('pdf', 'writer_pdf_Export', pdfFilterData({ PageRange: '1' }));
    expect(json.startsWith('pdf:writer_pdf_Export:{')).toBe(true);
    expect(JSON.parse(json.slice('pdf:writer_pdf_Export:'.length))).toMatchObject({
      UseLosslessCompression: { type: 'boolean', value: 'true' },
      EmbedStandardFonts: { type: 'boolean', value: 'true' },
      PageRange: { type: 'string', value: '1' },
    });
  });

  it('chooses filters from the shared format registry', () => {
    expect(pdfFilterFor('a.docx')).toBe('writer_pdf_Export');
    expect(pdfFilterFor('a.xlsx')).toBe('calc_pdf_Export');
    expect(pdfFilterFor('a.pptx')).toBe('impress_pdf_Export');
    expect(sameFormatFilter('a.docx')).toBe('MS Word 2007 XML');
    expect(sameFormatFilter('a.xlsx')).toBe('Calc MS Excel 2007 XML');
    expect(sameFormatFilter('a.pptx')).toBe('Impress MS PowerPoint 2007 XML');
    expect(() => pdfFilterFor('a.pdf')).toThrow();
  });
});

describe('findProgramDir', () => {
  mkdirSync(CORPUS_OUTPUT, { recursive: true });
  const tmp = mkdtempSync(join(CORPUS_OUTPUT, 'unit-soffice-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('accepts an explicit or SIMPAPER_ENGINE_DIR install root and rejects folders without soffice', () => {
    const program = join(tmp, 'engine', 'program');
    mkdirSync(program, { recursive: true });
    writeFileSync(join(program, process.platform === 'win32' ? 'soffice.exe' : 'soffice'), '');
    expect(findProgramDir({ explicit: program, env: {} })).toBe(program);
    expect(findProgramDir({ env: { SIMPAPER_ENGINE_DIR: join(tmp, 'engine') } })).toBe(program);
    expect(findProgramDir({ explicit: tmp, env: {}, repoRoot: tmp })).toBeNull();
    expect(pathToFileURL(program).href.startsWith('file:///')).toBe(true);
  });
});
