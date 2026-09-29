import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCfb, readCfb } from '../../tools/cfb';
import { openPackage } from '../../tools/opc';
import { THIRD_PARTY_DIR } from '../../tools/paths';
import { isEncryptedOoxml, readText, rtfText, sniffContainer } from '../../tools/text';
import { decompressVba, vbaModules, vbaProject } from '../../tools/vba';

const poi = (f: string) => join(THIRD_PARTY_DIR, 'apache-poi', f);

describe('readCfb', () => {
  it('lists the streams of legacy and encrypted containers', () => {
    const doc = readCfb(readFileSync(poi('SampleDoc.doc')));
    expect([...doc.keys()]).toEqual(expect.arrayContaining(['WordDocument', '1Table']));
    const enc = readCfb(readFileSync(poi('protected_passtika.xlsx')));
    expect([...enc.keys()]).toEqual(expect.arrayContaining(['EncryptionInfo', 'EncryptedPackage']));
    expect(isCfb(readFileSync(poi('SimpleMacro.docm')))).toBe(false);
  });
});

describe('vbaModules', () => {
  it.each([
    ['SimpleMacro.docm', 'word/vbaProject.bin'],
    ['SimpleMacro.xlsm', 'xl/vbaProject.bin'],
    ['SimpleMacro.pptm', 'ppt/vbaProject.bin'],
  ])('reads the module sources of %s', async (file, part) => {
    const bin = await (await openPackage(poi(file))).bytes(part);
    const modules = vbaModules(bin!);
    expect(modules.length).toBeGreaterThan(0);
    const code = modules.map((m) => m.source).join('\n');
    expect(code).toMatch(/Attribute VB_Name = "/);
    expect(code).toMatch(/\b(Sub|Function)\b/);
  });

  it('reads project name, module types, PROJECT declarations and the project ID', async () => {
    const bin = async (file: string, part: string) => (await (await openPackage(poi(file))).bytes(part))!;
    const xlsm = vbaProject(await bin('SimpleMacro.xlsm', 'xl/vbaProject.bin'));
    expect(xlsm.name).toBe('VBAProject');
    expect(xlsm.codePage).toBe(1252);
    expect(xlsm.id).toBe('{C812BC5D-3DF7-4BA1-922A-65CF6CDF45FB}');
    expect(xlsm.modules.map((m) => `${m.name}:${m.type}`)).toEqual([
      'Module1:procedural',
      'ThisWorkbook:document-or-class',
      'Sheet1:document-or-class',
      'Sheet2:document-or-class',
      'Sheet3:document-or-class',
    ]);
    expect(xlsm.declarations).toEqual(['Module=Module1', 'Document=ThisWorkbook/&H00000000', 'Document=Sheet1/&H00000000', 'Document=Sheet2/&H00000000', 'Document=Sheet3/&H00000000']);
    expect(xlsm.modules[0]!.source).toMatch(/^Attribute TestMacro\.VB_Description = "This is a test macro"$/m);
    // Compiled-code caches of an Office-written project: __SRP_* streams and a _VBA_PROJECT with p-code.
    expect([...xlsm.streams.keys()].filter((k) => k.includes('__SRP_'))).toHaveLength(4);
    expect(xlsm.streams.get('VBA/_VBA_PROJECT')!.subarray(0, 2).toString('hex')).toBe('cc61');

    const docm = vbaProject(await bin('SimpleMacro.docm', 'word/vbaProject.bin'));
    expect(docm.name).toBe('Project');
    expect(docm.declarations).toEqual(['Document=ThisDocument/&H00000000', 'Module=Module1']);
    expect(docm.modules.map((m) => m.type)).toEqual(['document-or-class', 'procedural']);
  });

  it('decompresses literal and copy tokens ([MS-OVBA] 3.2.3 example)', () => {
    // CompressedContainer of "#aaabcdefaaaaghijaaaaaklaaamnopqaaaaaaaaaaaarstuvwxyzaaa" from the spec
    const hex = '01 2F B0 00 23 61 61 61 62 63 64 65 82 66 00 70 61 67 68 69 6A 01 38 08 61 6B 6C 00 30 6D 6E 6F 70 06 71 02 70 04 10 72 73 74 75 76 10 77 78 79 7A 00 3C';
    const bytes = Uint8Array.from(hex.split(' ').map((h) => parseInt(h, 16)));
    expect(decompressVba(bytes).toString('latin1')).toBe('#aaabcdefaaaaghijaaaaaklaaamnopqaaaaaaaaaaaarstuvwxyzaaa');
  });
});

describe('text helpers', () => {
  it('sniffs containers and detects encrypted OOXML', () => {
    expect(sniffContainer(readFileSync(poi('SampleDoc.doc')))).toBe('ole2');
    expect(sniffContainer(readFileSync(poi('SmartArt.pptx')))).toBe('zip');
    expect(isEncryptedOoxml(readFileSync(poi('bug53475-password-is-pass.docx')))).toBe(true);
    expect(isEncryptedOoxml(readFileSync(poi('protected_passtika.xlsx')))).toBe(true);
    expect(isEncryptedOoxml(readFileSync(poi('SampleDoc.doc')))).toBe(false);
  });

  it('decodes BOM, line endings and RTF escapes', () => {
    const t = readText(Buffer.from('﻿a;b\r\nç;ğ\r\n', 'utf8'));
    expect(t).toMatchObject({ bom: true, lines: ['a;b', 'ç;ğ'], lineEnding: 'CRLF' });
    const rtf = String.raw`{\rtf1\ansi\ansicpg1254{\fonttbl{\f0 Arial;}}{\*\generator X;}\uc1 Pijamal\u305\'fd hasta \'fe\par \u350?ofer\tab x}`;
    expect(rtfText(rtf)).toBe('Pijamalı hasta ş\nŞofer\tx');
  });
});
