/**
 * PDF fixtures written with @cantoo/pdf-lib + @cantoo/fontkit: multi-page Turkish text, an AcroForm,
 * an AES-256 encrypted document and an image-only ("scanned") page. A Unicode TrueType font is embedded
 * (subset) because the standard-14 fonts cannot encode ğ, ş, ı, İ.
 */
import { readFileSync } from 'node:fs';
import fontkit from '@cantoo/fontkit';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { AUTHOR, FIXED_DATE, TR, prng, withSeededRandom } from './constants.mjs';

const A4 = [595.28, 841.89];
const MARGIN = 56.7; // 2 cm
const PRODUCER = 'Varak corpus generator (@cantoo/pdf-lib 2.11.1)';
const INK = rgb(0x1d / 255, 0x2b / 255, 0x53 / 255);

export const PDF_PASSWORD = 'varak123';

async function newDocument(fontPath, title, seedMeta = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(fontPath), { subset: true });
  doc.setTitle(title);
  doc.setAuthor(AUTHOR);
  doc.setSubject(seedMeta.subject ?? 'Varak PDF test dosyası');
  doc.setKeywords(['varak', 'test', 'türkçe']);
  doc.setCreator('Varak');
  doc.setProducer(PRODUCER);
  doc.setLanguage('tr-TR');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return { doc, font };
}

/** Greedy word wrap using real glyph widths. */
function wrap(font, text, size, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws lines top-down; returns the drawn lines (for the manifest). */
function drawLines(page, font, lines, { size = 12, startY, gap = 1.45 } = {}) {
  let y = startY ?? page.getHeight() - MARGIN - size;
  for (const text of lines) {
    page.drawText(text, { x: MARGIN, y, size, font, color: INK });
    y -= size * gap;
  }
  return y;
}

const save = (doc) => doc.save({ useObjectStreams: false });

/** Three-page text document. */
export async function buildTextPdf({ fontPath, boldFontPath }) {
  return withSeededRandom(101, async () => {
    const { doc, font } = await newDocument(fontPath, 'Varak PDF Test Belgesi');
    const bold = boldFontPath ? await doc.embedFont(readFileSync(boldFontPath), { subset: true }) : font;
    const width = A4[0] - 2 * MARGIN;
    const pagesSpec = [
      {
        title: 'Varak PDF Test Belgesi',
        paragraphs: [TR.pangram, TR.pangramUpper, `Küçük harfler: ${TR.lower} — büyük harfler: ${TR.upper}`, `Noktalı ve noktasız i: ${TR.casing}`, `Yerler: ${TR.places.join(', ')}`],
      },
      {
        title: 'İkinci sayfa: şehirler',
        paragraphs: TR.places.map((p, i) => `${i + 1}. ${p} — ${TR.pangram}`),
      },
      {
        title: 'Üçüncü sayfa: uzun paragraf',
        paragraphs: [`${TR.pangram} ${TR.pangramUpper} `.repeat(5).trim()],
      },
    ];
    const facts = { pages: [] };
    pagesSpec.forEach((spec, index) => {
      const page = doc.addPage(A4);
      page.drawText(spec.title, { x: MARGIN, y: A4[1] - MARGIN - 20, size: 20, font: bold, color: INK });
      const lines = spec.paragraphs.flatMap((p) => wrap(font, p, 12, width));
      drawLines(page, font, lines, { startY: A4[1] - MARGIN - 56 });
      const footer = `Sayfa ${index + 1} / ${pagesSpec.length}`;
      page.drawText(footer, { x: A4[0] / 2 - font.widthOfTextAtSize(footer, 10) / 2, y: MARGIN / 2, size: 10, font, color: INK });
      facts.pages.push({ title: spec.title, paragraphs: spec.paragraphs, footer });
    });
    return { buffer: Buffer.from(await save(doc)), facts: { ...facts, title: 'Varak PDF Test Belgesi', author: AUTHOR, pageCount: pagesSpec.length } };
  });
}

/** AcroForm with a text field, a multi-line text field, a checkbox and a dropdown (Turkish values). */
export async function buildFormPdf({ fontPath }) {
  return withSeededRandom(202, async () => {
    const { doc, font } = await newDocument(fontPath, 'Varak Form Testi', { subject: 'AcroForm test dosyası' });
    const page = doc.addPage(A4);
    const form = doc.getForm();
    const top = A4[1] - MARGIN;
    page.drawText('Başvuru Formu', { x: MARGIN, y: top - 20, size: 20, font, color: INK });
    const label = (text, y) => page.drawText(text, { x: MARGIN, y, size: 12, font, color: INK });
    const fieldBox = { borderColor: INK, borderWidth: 1, backgroundColor: rgb(1, 1, 1), font };

    label('Ad Soyad:', top - 80);
    const name = form.createTextField('adSoyad');
    name.setText('Ayşe Yılmaz');
    name.addToPage(page, { x: MARGIN + 120, y: top - 86, width: 300, height: 22, ...fieldBox });

    label('Şehir:', top - 120);
    const city = form.createDropdown('sehir');
    const cities = ['İstanbul', 'Ankara', 'İzmir', 'Iğdır', 'Şırnak'];
    city.addOptions(cities);
    city.select('Iğdır');
    city.addToPage(page, { x: MARGIN + 120, y: top - 126, width: 200, height: 22, ...fieldBox });

    label('Onaylıyorum:', top - 160);
    const consent = form.createCheckBox('onay');
    consent.addToPage(page, { x: MARGIN + 120, y: top - 164, width: 16, height: 16, borderColor: INK, borderWidth: 1 });
    consent.check();

    label('Not:', top - 200);
    const note = form.createTextField('not');
    note.enableMultiline();
    note.addToPage(page, { x: MARGIN + 120, y: top - 280, width: 300, height: 90, ...fieldBox });

    form.updateFieldAppearances(font);
    const facts = {
      fields: [
        { name: 'adSoyad', type: 'text', value: 'Ayşe Yılmaz' },
        { name: 'sehir', type: 'dropdown', value: 'Iğdır', options: cities },
        { name: 'onay', type: 'checkbox', value: true },
        { name: 'not', type: 'text', value: '', multiline: true },
      ],
      labels: ['Başvuru Formu', 'Ad Soyad:', 'Şehir:', 'Onaylıyorum:', 'Not:'],
    };
    return { buffer: Buffer.from(await save(doc)), facts };
  });
}

/** Password-protected (AES-256) one-page document. Not byte-reproducible: encryption salts are random. */
export async function buildEncryptedPdf({ fontPath }) {
  const { doc, font } = await newDocument(fontPath, 'Varak Şifreli Belge');
  const page = doc.addPage(A4);
  const text = ['Şifreli belge', TR.pangram, `Parola korumalı içerik: ${TR.lower} ${TR.upper}`];
  drawLines(page, font, text, { size: 14 });
  doc.encrypt({ userPassword: PDF_PASSWORD, ownerPassword: 'varak-sahip-456', permissions: { printing: 'highResolution', copying: true, modifying: false } });
  return { buffer: Buffer.from(await save(doc)), facts: { password: PDF_PASSWORD, algorithm: 'AES-256', text } };
}

/**
 * One image-only A4 page that looks like a scan (150 dpi JPEG of rendered text, slight skew and noise,
 * no text layer). Needs @napi-rs/canvas (dev dependency).
 */
export async function buildScannedPdf({ fontPath }) {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
  GlobalFonts.registerFromPath(fontPath, 'VarakScan');
  const [w, h] = [1240, 1754];
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((0.6 * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = '#1b1b1b';
  const lines = ['TARANMIŞ SAYFA', TR.pangram, TR.pangramUpper, `${TR.places.slice(0, 4).join(', ')}`, `Küçük: ${TR.lower}  Büyük: ${TR.upper}`];
  ctx.font = 'bold 44px VarakScan';
  ctx.fillText(lines[0], 120, 200);
  ctx.font = '30px VarakScan';
  lines.slice(1).forEach((line, i) => ctx.fillText(line, 120, 300 + i * 60));
  ctx.restore();
  const img = ctx.getImageData(0, 0, w, h);
  const rand = prng(303);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 24;
    for (let c = 0; c < 3; c++) img.data[i + c] = Math.max(0, Math.min(255, img.data[i + c] + n));
  }
  ctx.putImageData(img, 0, 0);
  const jpeg = canvas.toBuffer('image/jpeg', 82);

  return withSeededRandom(304, async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.setTitle('Varak Taranmış Sayfa');
    doc.setAuthor(AUTHOR);
    doc.setProducer(PRODUCER);
    doc.setCreationDate(FIXED_DATE);
    doc.setModificationDate(FIXED_DATE);
    const image = await doc.embedJpg(jpeg);
    const page = doc.addPage(A4);
    page.drawImage(image, { x: 0, y: 0, width: A4[0], height: A4[1] });
    return { buffer: Buffer.from(await save(doc)), facts: { textLayer: false, imagePixels: [w, h], ocrText: lines } };
  });
}
