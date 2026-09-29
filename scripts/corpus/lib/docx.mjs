/**
 * Hand-authored WordprocessingML (DOCX) generator. Element order follows the ECMA-376 transitional schema.
 * The returned `facts` are the expectations the tests check after a round trip.
 */
import { AUTHOR, AUTHOR_INITIALS, FIXED_DATE_ISO, LINK_URL, TR } from './constants.mjs';
import { testPicture } from './png.mjs';
import { NS, REL, XML_DECL, appPropsXml, contentTypesXml, corePropsXml, el, esc, relsXml } from './xml.mjs';
import { buildPackage } from './zip.mjs';

const FONT = 'Carlito';
const EMU_PER_PX = 9525;
/** A4 in twips and 2.5 cm margins. */
export const DOCX_PAGE = { width: 11906, height: 16838, margin: 1417, header: 708, footer: 708 };
const TEXT_WIDTH = DOCX_PAGE.width - 2 * DOCX_PAGE.margin;

const W_NS = { 'xmlns:w': NS.w, 'xmlns:r': NS.r };

// ---------------------------------------------------------------------------------------------- runs
/**
 * @param {string} text
 * @param {{ b?: boolean, i?: boolean, u?: boolean, style?: string }} [fmt]
 */
function run(text, fmt = {}) {
  const rPr = [
    fmt.style ? el('w:rStyle', { 'w:val': fmt.style }) : '',
    fmt.b ? el('w:b') + el('w:bCs') : '',
    fmt.i ? el('w:i') + el('w:iCs') : '',
    fmt.u ? el('w:u', { 'w:val': 'single' }) : '',
  ].join('');
  const space = /^\s|\s$/.test(text) ? { 'xml:space': 'preserve' } : {};
  return el('w:r', {}, rPr ? el('w:rPr', {}, rPr) : '', el('w:t', space, esc(text)));
}

/**
 * @param {string | string[]} content runs or plain text
 * @param {{ style?: string, jc?: string, numId?: number, pageBreakBefore?: boolean }} [opts]
 */
function para(content, opts = {}) {
  const pPr = [
    opts.style ? el('w:pStyle', { 'w:val': opts.style }) : '',
    opts.pageBreakBefore ? el('w:pageBreakBefore') : '',
    opts.numId ? el('w:numPr', {}, el('w:ilvl', { 'w:val': 0 }), el('w:numId', { 'w:val': opts.numId })) : '',
    opts.jc ? el('w:jc', { 'w:val': opts.jc }) : '',
  ].join('');
  const runs = typeof content === 'string' ? run(content) : content.join('');
  return el('w:p', {}, pPr ? el('w:pPr', {}, pPr) : '', runs);
}

function field(instr, cached) {
  return [
    el('w:r', {}, el('w:fldChar', { 'w:fldCharType': 'begin' })),
    el('w:r', {}, el('w:instrText', { 'xml:space': 'preserve' }, ` ${instr} `)),
    el('w:r', {}, el('w:fldChar', { 'w:fldCharType': 'separate' })),
    run(cached),
    el('w:r', {}, el('w:fldChar', { 'w:fldCharType': 'end' })),
  ].join('');
}

// ---------------------------------------------------------------------------------------------- parts
function table(rows) {
  const colW = Math.floor(TEXT_WIDTH / rows[0].length);
  const cell = (text, header) =>
    el('w:tc', {}, el('w:tcPr', {}, el('w:tcW', { 'w:w': colW, 'w:type': 'dxa' })), para([run(text, { b: header })]));
  return el(
    'w:tbl',
    {},
    el(
      'w:tblPr',
      {},
      el('w:tblStyle', { 'w:val': 'TableGrid' }),
      el('w:tblW', { 'w:w': colW * rows[0].length, 'w:type': 'dxa' }),
      el('w:tblLook', { 'w:val': '04A0', 'w:firstRow': 1, 'w:lastRow': 0, 'w:firstColumn': 1, 'w:lastColumn': 0, 'w:noHBand': 0, 'w:noVBand': 1 }),
    ),
    el('w:tblGrid', {}, rows[0].map(() => el('w:gridCol', { 'w:w': colW }))),
    rows.map((cells, r) => el('w:tr', {}, r === 0 ? el('w:trPr', {}, el('w:tblHeader')) : '', cells.map((c) => cell(c, r === 0)))),
  );
}

function inlinePicture(relId, widthPx, heightPx, alt) {
  const cx = widthPx * EMU_PER_PX;
  const cy = heightPx * EMU_PER_PX;
  return el(
    'w:r',
    {},
    el(
      'w:drawing',
      {},
      el(
        'wp:inline',
        { distT: 0, distB: 0, distL: 0, distR: 0, 'xmlns:wp': NS.wp },
        el('wp:extent', { cx, cy }),
        el('wp:effectExtent', { l: 0, t: 0, r: 0, b: 0 }),
        el('wp:docPr', { id: 1, name: 'Resim 1', descr: alt }),
        el('wp:cNvGraphicFramePr', {}, el('a:graphicFrameLocks', { 'xmlns:a': NS.a, noChangeAspect: 1 })),
        el(
          'a:graphic',
          { 'xmlns:a': NS.a },
          el(
            'a:graphicData',
            { uri: 'http://schemas.openxmlformats.org/drawingml/2006/picture' },
            el(
              'pic:pic',
              { 'xmlns:pic': NS.pic },
              el('pic:nvPicPr', {}, el('pic:cNvPr', { id: 0, name: 'image1.png', descr: alt }), el('pic:cNvPicPr')),
              el('pic:blipFill', {}, el('a:blip', { 'r:embed': relId }), el('a:stretch', {}, el('a:fillRect'))),
              el(
                'pic:spPr',
                {},
                el('a:xfrm', {}, el('a:off', { x: 0, y: 0 }), el('a:ext', { cx, cy })),
                el('a:prstGeom', { prst: 'rect' }, el('a:avLst')),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function stylesXml() {
  const rFonts = el('w:rFonts', { 'w:ascii': FONT, 'w:hAnsi': FONT, 'w:eastAsia': FONT, 'w:cs': FONT });
  const heading = (id, name, level, size) =>
    el(
      'w:style',
      { 'w:type': 'paragraph', 'w:styleId': id },
      el('w:name', { 'w:val': name }),
      el('w:basedOn', { 'w:val': 'Normal' }),
      el('w:next', { 'w:val': 'Normal' }),
      el('w:uiPriority', { 'w:val': 9 }),
      el('w:qFormat'),
      el('w:pPr', {}, el('w:keepNext'), el('w:keepLines'), el('w:spacing', { 'w:before': 240, 'w:after': 120 }), el('w:outlineLvl', { 'w:val': level })),
      el('w:rPr', {}, el('w:b'), el('w:bCs'), el('w:color', { 'w:val': '1D2B53' }), el('w:sz', { 'w:val': size }), el('w:szCs', { 'w:val': size })),
    );
  const border = (name) => el(`w:${name}`, { 'w:val': 'single', 'w:sz': 4, 'w:space': 0, 'w:color': 'auto' });
  return (
    XML_DECL +
    el(
      'w:styles',
      W_NS,
      el(
        'w:docDefaults',
        {},
        el(
          'w:rPrDefault',
          {},
          el('w:rPr', {}, rFonts, el('w:sz', { 'w:val': 22 }), el('w:szCs', { 'w:val': 22 }), el('w:lang', { 'w:val': 'tr-TR', 'w:eastAsia': 'en-US', 'w:bidi': 'ar-SA' })),
        ),
        el('w:pPrDefault', {}, el('w:pPr', {}, el('w:spacing', { 'w:after': 160, 'w:line': 259, 'w:lineRule': 'auto' }))),
      ),
      el('w:style', { 'w:type': 'paragraph', 'w:default': 1, 'w:styleId': 'Normal' }, el('w:name', { 'w:val': 'Normal' }), el('w:qFormat')),
      heading('Heading1', 'heading 1', 0, 32),
      heading('Heading2', 'heading 2', 1, 28),
      heading('Heading3', 'heading 3', 2, 24),
      el(
        'w:style',
        { 'w:type': 'character', 'w:default': 1, 'w:styleId': 'DefaultParagraphFont' },
        el('w:name', { 'w:val': 'Default Paragraph Font' }),
        el('w:uiPriority', { 'w:val': 1 }),
        el('w:semiHidden'),
        el('w:unhideWhenUsed'),
      ),
      el(
        'w:style',
        { 'w:type': 'character', 'w:styleId': 'Hyperlink' },
        el('w:name', { 'w:val': 'Hyperlink' }),
        el('w:basedOn', { 'w:val': 'DefaultParagraphFont' }),
        el('w:uiPriority', { 'w:val': 99 }),
        el('w:unhideWhenUsed'),
        el('w:rPr', {}, el('w:color', { 'w:val': '0563C1' }), el('w:u', { 'w:val': 'single' })),
      ),
      el(
        'w:style',
        { 'w:type': 'table', 'w:default': 1, 'w:styleId': 'TableNormal' },
        el('w:name', { 'w:val': 'Normal Table' }),
        el('w:uiPriority', { 'w:val': 99 }),
        el('w:semiHidden'),
        el('w:unhideWhenUsed'),
        el(
          'w:tblPr',
          {},
          el('w:tblInd', { 'w:w': 0, 'w:type': 'dxa' }),
          el(
            'w:tblCellMar',
            {},
            el('w:top', { 'w:w': 0, 'w:type': 'dxa' }),
            el('w:left', { 'w:w': 108, 'w:type': 'dxa' }),
            el('w:bottom', { 'w:w': 0, 'w:type': 'dxa' }),
            el('w:right', { 'w:w': 108, 'w:type': 'dxa' }),
          ),
        ),
      ),
      el(
        'w:style',
        { 'w:type': 'table', 'w:styleId': 'TableGrid' },
        el('w:name', { 'w:val': 'Table Grid' }),
        el('w:basedOn', { 'w:val': 'TableNormal' }),
        el('w:uiPriority', { 'w:val': 39 }),
        el('w:pPr', {}, el('w:spacing', { 'w:after': 0, 'w:line': 240, 'w:lineRule': 'auto' })),
        el('w:tblPr', {}, el('w:tblBorders', {}, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border))),
      ),
      el(
        'w:style',
        { 'w:type': 'paragraph', 'w:styleId': 'ListParagraph' },
        el('w:name', { 'w:val': 'List Paragraph' }),
        el('w:basedOn', { 'w:val': 'Normal' }),
        el('w:uiPriority', { 'w:val': 34 }),
        el('w:qFormat'),
        el('w:pPr', {}, el('w:ind', { 'w:left': 720 }), el('w:contextualSpacing')),
      ),
      ['Header', 'Footer'].map((id) =>
        el(
          'w:style',
          { 'w:type': 'paragraph', 'w:styleId': id },
          el('w:name', { 'w:val': id.toLowerCase() }),
          el('w:basedOn', { 'w:val': 'Normal' }),
          el('w:uiPriority', { 'w:val': 99 }),
          el('w:unhideWhenUsed'),
          el('w:pPr', {}, el('w:spacing', { 'w:after': 0 })),
        ),
      ),
    )
  );
}

function settingsXml() {
  return (
    XML_DECL +
    el(
      'w:settings',
      W_NS,
      el('w:zoom', { 'w:percent': 100 }),
      el('w:defaultTabStop', { 'w:val': 708 }),
      el('w:characterSpacingControl', { 'w:val': 'doNotCompress' }),
      el('w:compat', {}, el('w:compatSetting', { 'w:name': 'compatibilityMode', 'w:uri': 'http://schemas.microsoft.com/office/word', 'w:val': 15 })),
      el('w:themeFontLang', { 'w:val': 'tr-TR' }),
      el('w:decimalSymbol', { 'w:val': ',' }),
      el('w:listSeparator', { 'w:val': ';' }),
    )
  );
}

function numberingXml() {
  return (
    XML_DECL +
    el(
      'w:numbering',
      W_NS,
      el(
        'w:abstractNum',
        { 'w:abstractNumId': 0 },
        el('w:multiLevelType', { 'w:val': 'hybridMultilevel' }),
        el(
          'w:lvl',
          { 'w:ilvl': 0 },
          el('w:start', { 'w:val': 1 }),
          el('w:numFmt', { 'w:val': 'bullet' }),
          el('w:lvlText', { 'w:val': '•' }),
          el('w:lvlJc', { 'w:val': 'left' }),
          el('w:pPr', {}, el('w:ind', { 'w:left': 720, 'w:hanging': 360 })),
        ),
      ),
      el('w:num', { 'w:numId': 1 }, el('w:abstractNumId', { 'w:val': 0 })),
    )
  );
}

// ---------------------------------------------------------------------------------------------- builder
/**
 * @typedef {{ variant?: 'basic' | 'changed', pages?: number }} DocxOptions
 * `variant: 'changed'` alters one word (used to prove visual comparisons are sensitive);
 * `pages` > 0 appends that many extra pages separated by page breaks (large-file fixture).
 */

/** @param {DocxOptions} [opts] */
export async function buildDocx(opts = {}) {
  const variant = opts.variant ?? 'basic';
  const extraPages = opts.pages ?? 0;
  const picture = testPicture(320, 200);
  const alt = 'Varak test görseli: lacivert–altın degrade';
  const header = 'Varak Test Belgesi — Üstbilgi (çğıöşü)';
  const comment = `Yorum: ${TR.lower} ${TR.upper}`;
  const inserted = 'eklenen metin';
  const linkText = 'Varak örnek bağlantısı';
  const tableRows = [
    ['Şehir', 'Bölge', 'Plaka'],
    ['İstanbul', 'Marmara', '34'],
    ['Iğdır', 'Doğu Anadolu', '76'],
    ['Şırnak', 'Güneydoğu Anadolu', '73'],
  ];
  const bullets = ['Birinci madde: çay ve şeker', 'İkinci madde: ığdır değil Iğdır', 'Üçüncü madde: ÖĞRENCİ ve öğrenci'];
  const formatWord = variant === 'changed' ? 'değiştirilmiş' : 'kalın';
  const secondPage = `${TR.pangram} ${TR.pangramUpper} `.repeat(6).trim();

  const body = [
    para('Varak Test Belgesi', { style: 'Heading1' }),
    para(TR.pangram),
    para([run('Biçim denemesi: '), run(formatWord, { b: true }), run(', '), run('italik', { i: true }), run(', '), run('kalın italik', { b: true, i: true }), run(' ve '), run('altı çizili', { u: true }), run(' sözcükler.')]),
    para('Türkçe büyük/küçük harf', { style: 'Heading2' }),
    para(`${TR.casing} — ${TR.places.join(', ')}`),
    para(TR.pangramUpper),
    para(`Küçük: ${TR.lower} — Büyük: ${TR.upper}`),
    para('Tablo', { style: 'Heading3' }),
    table(tableRows),
    para('Görsel', { style: 'Heading3' }),
    para([inlinePicture('rId9', 320, 200, alt)], { jc: 'center' }),
    para([
      run('Bu paragrafta '),
      el('w:commentRangeStart', { 'w:id': 0 }),
      run('yorumlu metin'),
      el('w:commentRangeEnd', { 'w:id': 0 }),
      el('w:r', {}, el('w:commentReference', { 'w:id': 0 })),
      run(' bulunur.'),
    ]),
    para([run('İzlenen değişiklik: '), el('w:ins', { 'w:id': 1, 'w:author': AUTHOR, 'w:date': FIXED_DATE_ISO }, run(inserted)), run('.')]),
    para([run('Bağlantı: '), el('w:hyperlink', { 'r:id': 'rId10', 'w:history': 1 }, run(linkText, { style: 'Hyperlink' }))]),
    ...bullets.map((b) => para(b, { style: 'ListParagraph', numId: 1 })),
    para('İkinci sayfa', { style: 'Heading2', pageBreakBefore: true }),
    para(secondPage),
  ];
  for (let p = 0; p < extraPages; p++) {
    body.push(para(`Ek sayfa ${p + 1}`, { style: 'Heading2', pageBreakBefore: true }));
    for (let k = 0; k < 4; k++) body.push(para(`${p + 1}.${k + 1} — ${TR.pangram} ${TR.places[(p + k) % TR.places.length]} ${TR.lower}`));
  }
  const sectPr = el(
    'w:sectPr',
    {},
    el('w:headerReference', { 'w:type': 'default', 'r:id': 'rId7' }),
    el('w:footerReference', { 'w:type': 'default', 'r:id': 'rId8' }),
    el('w:pgSz', { 'w:w': DOCX_PAGE.width, 'w:h': DOCX_PAGE.height }),
    el('w:pgMar', {
      'w:top': DOCX_PAGE.margin,
      'w:right': DOCX_PAGE.margin,
      'w:bottom': DOCX_PAGE.margin,
      'w:left': DOCX_PAGE.margin,
      'w:header': DOCX_PAGE.header,
      'w:footer': DOCX_PAGE.footer,
      'w:gutter': 0,
    }),
    el('w:cols', { 'w:space': 708 }),
    el('w:docGrid', { 'w:linePitch': 360 }),
  );
  const documentXml = XML_DECL + el('w:document', W_NS, el('w:body', {}, body, sectPr));
  const headerXml = XML_DECL + el('w:hdr', W_NS, para(header, { style: 'Header', jc: 'center' }));
  const footerXml =
    XML_DECL +
    el('w:ftr', W_NS, el('w:p', {}, el('w:pPr', {}, el('w:pStyle', { 'w:val': 'Footer' }), el('w:jc', { 'w:val': 'center' })), run('Sayfa '), field('PAGE', '1'), run(' / '), field('NUMPAGES', '2')));
  const commentsXml =
    XML_DECL +
    el(
      'w:comments',
      W_NS,
      el(
        'w:comment',
        { 'w:id': 0, 'w:author': AUTHOR, 'w:date': FIXED_DATE_ISO, 'w:initials': AUTHOR_INITIALS },
        el('w:p', {}, el('w:r', {}, el('w:annotationRef')), run(comment)),
      ),
    );

  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const buffer = await buildPackage([
    [
      '[Content_Types].xml',
      contentTypesXml(
        { rels: 'application/vnd.openxmlformats-package.relationships+xml', xml: 'application/xml', png: 'image/png' },
        {
          '/word/document.xml': `${main}.document.main+xml`,
          '/word/styles.xml': `${main}.styles+xml`,
          '/word/settings.xml': `${main}.settings+xml`,
          '/word/numbering.xml': `${main}.numbering+xml`,
          '/word/header1.xml': `${main}.header+xml`,
          '/word/footer1.xml': `${main}.footer+xml`,
          '/word/comments.xml': `${main}.comments+xml`,
          '/docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
          '/docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
        },
      ),
    ],
    [
      '_rels/.rels',
      relsXml([
        ['rId1', REL.officeDocument, 'word/document.xml'],
        ['rId2', REL.coreProps, 'docProps/core.xml'],
        ['rId3', REL.extProps, 'docProps/app.xml'],
      ]),
    ],
    [
      'docProps/core.xml',
      corePropsXml({ title: 'Varak Test Belgesi', subject: 'Türkçe OOXML test belgesi', creator: AUTHOR, keywords: 'varak; test; çğıöşü', language: 'tr-TR', created: FIXED_DATE_ISO }),
    ],
    ['docProps/app.xml', appPropsXml({ application: 'Varak corpus generator' })],
    [
      'word/_rels/document.xml.rels',
      relsXml([
        ['rId1', REL.styles, 'styles.xml'],
        ['rId2', REL.settings, 'settings.xml'],
        ['rId3', REL.numbering, 'numbering.xml'],
        ['rId6', REL.comments, 'comments.xml'],
        ['rId7', REL.header, 'header1.xml'],
        ['rId8', REL.footer, 'footer1.xml'],
        ['rId9', REL.image, 'media/image1.png'],
        ['rId10', REL.hyperlink, LINK_URL, true],
      ]),
    ],
    ['word/document.xml', documentXml],
    ['word/styles.xml', stylesXml()],
    ['word/settings.xml', settingsXml()],
    ['word/numbering.xml', numberingXml()],
    ['word/header1.xml', headerXml],
    ['word/footer1.xml', footerXml],
    ['word/comments.xml', commentsXml],
    ['word/media/image1.png', picture],
  ]);

  const facts = {
    pages: 2 + extraPages,
    headings: [
      { level: 1, text: 'Varak Test Belgesi' },
      { level: 2, text: 'Türkçe büyük/küçük harf' },
      { level: 3, text: 'Tablo' },
      { level: 3, text: 'Görsel' },
      { level: 2, text: 'İkinci sayfa' },
    ],
    texts: [TR.pangram, TR.pangramUpper, `${TR.casing} — ${TR.places.join(', ')}`, `Küçük: ${TR.lower} — Büyük: ${TR.upper}`, ...bullets],
    bold: [formatWord, 'kalın italik'],
    italic: ['italik', 'kalın italik'],
    underline: ['altı çizili'],
    plain: ['Biçim denemesi: ', ' sözcükler.'],
    table: tableRows,
    header,
    footerPrefix: 'Sayfa',
    footerFields: ['PAGE', 'NUMPAGES'],
    comments: [{ author: AUTHOR, text: comment }],
    insertions: [{ author: AUTHOR, text: inserted }],
    hyperlinks: [{ text: linkText, target: LINK_URL }],
    images: [{ widthPx: 320, heightPx: 200, alt }],
    bullets,
    page: { width: DOCX_PAGE.width, height: DOCX_PAGE.height, margin: DOCX_PAGE.margin },
    language: 'tr-TR',
  };
  return { buffer, facts };
}
