/**
 * Hand-authored PresentationML (PPTX) generator: theme, one master with three layouts, notes master,
 * slides with speaker notes, a picture and a table. Element order follows the ECMA-376 transitional schema.
 */
import { AUTHOR, FIXED_DATE_ISO, TR } from './constants.mjs';
import { testPicture } from './png.mjs';
import { NS, REL, XML_DECL, appPropsXml, contentTypesXml, corePropsXml, el, esc, relsXml } from './xml.mjs';
import { buildPackage } from './zip.mjs';

const FONT = 'Carlito';
const SLIDE = { cx: 12_192_000, cy: 6_858_000 };
const NOTES = { cx: 6_858_000, cy: 9_144_000 };
const EMU_PER_PX = 9525;
const P_NS = { 'xmlns:a': NS.a, 'xmlns:r': NS.r, 'xmlns:p': NS.p };
const PML = 'application/vnd.openxmlformats-officedocument.presentationml';

const xfrm = (tag, x, y, cx, cy) => el(tag, {}, el('a:off', { x, y }), el('a:ext', { cx, cy }));
const rect = el('a:prstGeom', { prst: 'rect' }, el('a:avLst'));
const scheme = (val) => el('a:solidFill', {}, el('a:schemeClr', { val }));
const rgb = (val) => el('a:solidFill', {}, el('a:srgbClr', { val }));

function groupHeader() {
  return [
    el('p:nvGrpSpPr', {}, el('p:cNvPr', { id: 1, name: '' }), el('p:cNvGrpSpPr'), el('p:nvPr')),
    el('p:grpSpPr', {}, el('a:xfrm', {}, el('a:off', { x: 0, y: 0 }), el('a:ext', { cx: 0, cy: 0 }), el('a:chOff', { x: 0, y: 0 }), el('a:chExt', { cx: 0, cy: 0 }))),
  ].join('');
}

/** A text paragraph; `lvl` > 0 indents the bullet. */
function textPara(text, { lvl = 0 } = {}) {
  return el('a:p', {}, lvl ? el('a:pPr', { lvl }) : '', el('a:r', {}, el('a:rPr', { lang: 'tr-TR', dirty: 0 }), el('a:t', {}, esc(text))));
}

/**
 * A shape; with `ph` it is a placeholder (geometry inherited unless `box` is given).
 * @param {{ id: number, name: string, ph?: Record<string, string | number>, box?: number[], paras?: string[], locks?: Record<string, number> }} s
 */
function shape({ id, name, ph, box, paras, locks = { noGrp: 1 } }) {
  return el(
    'p:sp',
    {},
    el('p:nvSpPr', {}, el('p:cNvPr', { id, name }), el('p:cNvSpPr', {}, ph ? el('a:spLocks', locks) : ''), el('p:nvPr', {}, ph ? el('p:ph', ph) : '')),
    el('p:spPr', {}, box ? xfrm('a:xfrm', ...box) + rect : ''),
    paras ? el('p:txBody', {}, el('a:bodyPr'), el('a:lstStyle'), paras.length ? paras.join('') : el('a:p')) : '',
  );
}

function picture({ id, name, relId, box, alt }) {
  return el(
    'p:pic',
    {},
    el('p:nvPicPr', {}, el('p:cNvPr', { id, name, descr: alt }), el('p:cNvPicPr', {}, el('a:picLocks', { noChangeAspect: 1 })), el('p:nvPr')),
    el('p:blipFill', {}, el('a:blip', { 'r:embed': relId }), el('a:stretch', {}, el('a:fillRect'))),
    el('p:spPr', {}, xfrm('a:xfrm', ...box), rect),
  );
}

function tableFrame({ id, name, box, rows }) {
  const [x, y, cx] = box;
  const colW = Math.floor(cx / rows[0].length);
  const rowH = 457_200;
  const line = (tag) => el(tag, { w: 12_700 }, rgb('1D2B53'));
  const cell = (text, header) =>
    el(
      'a:tc',
      {},
      el('a:txBody', {}, el('a:bodyPr'), el('a:lstStyle'), el('a:p', {}, el('a:r', {}, el('a:rPr', { lang: 'tr-TR', sz: 1800, b: header ? 1 : undefined, dirty: 0 }), el('a:t', {}, esc(text))))),
      el('a:tcPr', {}, line('a:lnL'), line('a:lnR'), line('a:lnT'), line('a:lnB'), header ? rgb('C9A227') : ''),
    );
  return el(
    'p:graphicFrame',
    {},
    el('p:nvGraphicFramePr', {}, el('p:cNvPr', { id, name }), el('p:cNvGraphicFramePr', {}, el('a:graphicFrameLocks', { noGrp: 1 })), el('p:nvPr')),
    xfrm('p:xfrm', x, y, colW * rows[0].length, rowH * rows.length),
    el(
      'a:graphic',
      {},
      el(
        'a:graphicData',
        { uri: 'http://schemas.openxmlformats.org/drawingml/2006/table' },
        el(
          'a:tbl',
          {},
          el('a:tblPr', { firstRow: 1, bandRow: 1 }),
          el('a:tblGrid', {}, rows[0].map(() => el('a:gridCol', { w: colW }))),
          rows.map((cells, r) => el('a:tr', { h: rowH }, cells.map((c) => cell(c, r === 0)))),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------------- fixed parts
function themeXml(name) {
  const colors = { dk2: '1D2B53', lt2: 'EEECE1', accent1: '3B5BDB', accent2: '12876F', accent3: 'D5582A', accent4: 'C0303F', accent5: 'C9A227', accent6: '5F6B7A', hlink: '0563C1', folHlink: '954F72' };
  const font = el('a:latin', { typeface: FONT }) + el('a:ea', { typeface: '' }) + el('a:cs', { typeface: '' });
  const three = (make) => [1, 2, 3].map(make).join('');
  return (
    XML_DECL +
    el(
      'a:theme',
      { 'xmlns:a': NS.a, name },
      el(
        'a:themeElements',
        {},
        el(
          'a:clrScheme',
          { name: 'Simpaper' },
          el('a:dk1', {}, el('a:sysClr', { val: 'windowText', lastClr: '000000' })),
          el('a:lt1', {}, el('a:sysClr', { val: 'window', lastClr: 'FFFFFF' })),
          Object.entries(colors).map(([k, v]) => el(`a:${k}`, {}, el('a:srgbClr', { val: v }))),
        ),
        el('a:fontScheme', { name: 'Simpaper' }, el('a:majorFont', {}, font), el('a:minorFont', {}, font)),
        el(
          'a:fmtScheme',
          { name: 'Simpaper' },
          el('a:fillStyleLst', {}, three(() => scheme('phClr'))),
          el('a:lnStyleLst', {}, three((i) => el('a:ln', { w: 6350 * i }, scheme('phClr')))),
          el('a:effectStyleLst', {}, three(() => el('a:effectStyle', {}, el('a:effectLst')))),
          el('a:bgFillStyleLst', {}, three(() => scheme('phClr'))),
        ),
      ),
      el('a:objectDefaults'),
      el('a:extraClrSchemeLst'),
    )
  );
}

const CLR_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hlink: 'hlink', folHlink: 'folHlink' };
const TITLE_BOX = [838_200, 365_125, 10_515_600, 1_325_563];
const BODY_BOX = [838_200, 1_825_625, 10_515_600, 4_351_338];

function masterXml(layoutCount) {
  const defRPr = (sz, extra = {}) => el('a:defRPr', { sz, ...extra }, scheme('tx1'), el('a:latin', { typeface: '+mn-lt' }));
  return (
    XML_DECL +
    el(
      'p:sldMaster',
      P_NS,
      el(
        'p:cSld',
        {},
        el('p:bg', {}, el('p:bgRef', { idx: 1001 }, el('a:schemeClr', { val: 'bg1' }))),
        el(
          'p:spTree',
          {},
          groupHeader(),
          shape({ id: 2, name: 'Title Placeholder 1', ph: { type: 'title' }, box: TITLE_BOX, paras: [textPara('Başlık')] }),
          shape({ id: 3, name: 'Text Placeholder 2', ph: { type: 'body', idx: 1 }, box: BODY_BOX, paras: [textPara('Metin')] }),
        ),
      ),
      el('p:clrMap', CLR_MAP),
      el('p:sldLayoutIdLst', {}, Array.from({ length: layoutCount }, (_, i) => el('p:sldLayoutId', { id: 2_147_483_649 + i, 'r:id': `rId${i + 1}` }))),
      el(
        'p:txStyles',
        {},
        el('p:titleStyle', {}, el('a:lvl1pPr', { algn: 'l' }, el('a:defRPr', { sz: 4000, b: 1 }, scheme('tx2'), el('a:latin', { typeface: '+mj-lt' })))),
        el(
          'p:bodyStyle',
          {},
          el('a:lvl1pPr', { marL: 342_900, indent: -342_900 }, el('a:buFont', { typeface: 'Arial' }), el('a:buChar', { char: '•' }), defRPr(2400)),
          el('a:lvl2pPr', { marL: 742_950, indent: -285_750 }, el('a:buFont', { typeface: 'Arial' }), el('a:buChar', { char: '–' }), defRPr(2000)),
        ),
        el('p:otherStyle', {}, el('a:lvl1pPr', {}, defRPr(1800))),
      ),
    )
  );
}

const LAYOUTS = [
  {
    type: 'title',
    name: 'Title Slide',
    shapes: () => [
      shape({ id: 2, name: 'Title 1', ph: { type: 'ctrTitle' }, box: [1_524_000, 1_122_363, 9_144_000, 2_387_600], paras: [] }),
      shape({ id: 3, name: 'Subtitle 2', ph: { type: 'subTitle', idx: 1 }, box: [1_524_000, 3_602_038, 9_144_000, 1_655_762], paras: [] }),
    ],
  },
  {
    type: 'obj',
    name: 'Title and Content',
    shapes: () => [shape({ id: 2, name: 'Title 1', ph: { type: 'title' }, paras: [] }), shape({ id: 3, name: 'Content Placeholder 2', ph: { idx: 1 }, paras: [] })],
  },
  { type: 'titleOnly', name: 'Title Only', shapes: () => [shape({ id: 2, name: 'Title 1', ph: { type: 'title' }, paras: [] })] },
];

function layoutXml(layout) {
  return (
    XML_DECL +
    el(
      'p:sldLayout',
      { ...P_NS, type: layout.type, preserve: 1 },
      el('p:cSld', { name: layout.name }, el('p:spTree', {}, groupHeader(), layout.shapes())),
      el('p:clrMapOvr', {}, el('a:masterClrMapping')),
    )
  );
}

function notesMasterXml() {
  return (
    XML_DECL +
    el(
      'p:notesMaster',
      P_NS,
      el(
        'p:cSld',
        {},
        el('p:bg', {}, el('p:bgRef', { idx: 1001 }, el('a:schemeClr', { val: 'bg1' }))),
        el(
          'p:spTree',
          {},
          groupHeader(),
          shape({ id: 2, name: 'Slide Image Placeholder 1', ph: { type: 'sldImg', idx: 2 }, box: [685_800, 1_143_000, 5_486_400, 3_086_100], locks: { noGrp: 1, noRot: 1, noChangeAspect: 1 } }),
          shape({ id: 3, name: 'Notes Placeholder 2', ph: { type: 'body', idx: 3 }, box: [685_800, 4_400_550, 5_486_400, 3_600_450], paras: [textPara('Notlar')] }),
        ),
      ),
      el('p:clrMap', CLR_MAP),
      el('p:notesStyle', {}, el('a:lvl1pPr', { marL: 0 }, el('a:defRPr', { sz: 1200 }, scheme('tx1'), el('a:latin', { typeface: '+mn-lt' })))),
    )
  );
}

function notesSlideXml(text) {
  return (
    XML_DECL +
    el(
      'p:notes',
      P_NS,
      el(
        'p:cSld',
        {},
        el(
          'p:spTree',
          {},
          groupHeader(),
          shape({ id: 2, name: 'Slide Image Placeholder 1', ph: { type: 'sldImg' }, locks: { noGrp: 1, noRot: 1, noChangeAspect: 1 } }),
          shape({ id: 3, name: 'Notes Placeholder 2', ph: { type: 'body', idx: 1 }, paras: [textPara(text)] }),
        ),
      ),
      el('p:clrMapOvr', {}, el('a:masterClrMapping')),
    )
  );
}

function slideXml(shapes) {
  return XML_DECL + el('p:sld', P_NS, el('p:cSld', {}, el('p:spTree', {}, groupHeader(), shapes)), el('p:clrMapOvr', {}, el('a:masterClrMapping')));
}

// ---------------------------------------------------------------------------------------------- slides
function standardSlides(variant) {
  const picAlt = 'Simpaper test görseli';
  const table = [
    ['Ürün', 'Fiyat'],
    ['Çay', '12,50 ₺'],
    ['Şeker', '7,25 ₺'],
  ];
  const bullets = [
    { text: TR.pangram, lvl: 0 },
    { text: 'İstanbul, Iğdır, Şırnak', lvl: 0 },
    { text: 'Alt madde: ığdır → IĞDIR', lvl: 1 },
    { text: variant === 'changed' ? 'Değişen madde: ÇĞİÖŞÜ' : `Son madde: ${TR.upper}`, lvl: 0 },
  ];
  return [
    {
      layout: 1,
      title: 'Simpaper Sunum Testi',
      subtitle: `Türkçe karakterler: ${TR.lower} ${TR.upper} — ${TR.casing}`,
      notes: `Konuşmacı notu 1: ${TR.pangram}`,
    },
    { layout: 2, title: 'Madde İşaretleri', bullets, notes: 'Konuşmacı notu 2: madde işaretlerini sırayla anlatın (ğüşiöç).' },
    { layout: 3, title: 'Görsel ve Tablo', picture: { alt: picAlt }, table, notes: 'Konuşmacı notu 3: görsel ve tablo — Iğdır, İzmir, Şanlıurfa.' },
  ];
}

function largeSlides(count) {
  const slides = [{ layout: 1, title: 'Büyük Sunum', subtitle: `${count} slayt — ${TR.pangram}`, notes: 'Konuşmacı notu 1' }];
  for (let i = 2; i <= count; i++) {
    slides.push({
      layout: i % 10 === 0 ? 3 : 2,
      title: `Slayt ${i}: ${TR.places[i % TR.places.length]}`,
      bullets: i % 10 === 0 ? undefined : [{ text: `${i}. ${TR.pangram}`, lvl: 0 }, { text: `${TR.lower} ${TR.upper} ${i}`, lvl: 1 }],
      picture: i % 10 === 0 ? { alt: `Görsel ${i}` } : undefined,
      notes: `Konuşmacı notu ${i}`,
    });
  }
  return slides;
}

function slideShapes(s) {
  const shapes = [];
  if (s.layout === 1) {
    shapes.push(shape({ id: 2, name: 'Title 1', ph: { type: 'ctrTitle' }, paras: [textPara(s.title)] }));
    shapes.push(shape({ id: 3, name: 'Subtitle 2', ph: { type: 'subTitle', idx: 1 }, paras: [textPara(s.subtitle)] }));
  } else {
    shapes.push(shape({ id: 2, name: 'Title 1', ph: { type: 'title' }, paras: [textPara(s.title)] }));
  }
  if (s.bullets) shapes.push(shape({ id: 3, name: 'Content Placeholder 2', ph: { idx: 1 }, paras: s.bullets.map((b) => textPara(b.text, { lvl: b.lvl })) }));
  if (s.picture) {
    const w = 320 * EMU_PER_PX * 1.5;
    const h = 200 * EMU_PER_PX * 1.5;
    shapes.push(picture({ id: 4, name: 'Resim 3', relId: 'rId3', box: [838_200, 1_825_625, w, h], alt: s.picture.alt }));
  }
  if (s.table) shapes.push(tableFrame({ id: 5, name: 'Tablo 4', box: [6_400_800, 1_825_625, 4_572_000], rows: s.table }));
  return shapes;
}

/**
 * @param {{ variant?: 'basic' | 'changed', slides?: number }} [opts] `slides` builds a large deck with that many slides.
 */
export async function buildPptx(opts = {}) {
  const slides = opts.slides ? largeSlides(opts.slides) : standardSlides(opts.variant ?? 'basic');
  const picture = testPicture(320, 200);
  const overrides = {
    '/ppt/presentation.xml': `${PML}.presentation.main+xml`,
    '/ppt/presProps.xml': `${PML}.presProps+xml`,
    '/ppt/viewProps.xml': `${PML}.viewProps+xml`,
    '/ppt/tableStyles.xml': `${PML}.tableStyles+xml`,
    '/ppt/theme/theme1.xml': 'application/vnd.openxmlformats-officedocument.theme+xml',
    '/ppt/theme/theme2.xml': 'application/vnd.openxmlformats-officedocument.theme+xml',
    '/ppt/slideMasters/slideMaster1.xml': `${PML}.slideMaster+xml`,
    '/ppt/notesMasters/notesMaster1.xml': `${PML}.notesMaster+xml`,
    '/docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
    '/docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  };
  LAYOUTS.forEach((_, i) => (overrides[`/ppt/slideLayouts/slideLayout${i + 1}.xml`] = `${PML}.slideLayout+xml`));
  slides.forEach((_, i) => {
    overrides[`/ppt/slides/slide${i + 1}.xml`] = `${PML}.slide+xml`;
    overrides[`/ppt/notesSlides/notesSlide${i + 1}.xml`] = `${PML}.notesSlide+xml`;
  });

  const presRels = [
    ['rId1', REL.slideMaster, 'slideMasters/slideMaster1.xml'],
    ['rId2', REL.notesMaster, 'notesMasters/notesMaster1.xml'],
    ['rId3', REL.theme, 'theme/theme1.xml'],
    ['rId4', REL.presProps, 'presProps.xml'],
    ['rId5', REL.viewProps, 'viewProps.xml'],
    ['rId6', REL.tableStyles, 'tableStyles.xml'],
    ...slides.map((_, i) => [`rId${10 + i}`, REL.slide, `slides/slide${i + 1}.xml`]),
  ];
  const presentation =
    XML_DECL +
    el(
      'p:presentation',
      { ...P_NS, saveSubsetFonts: 1 },
      el('p:sldMasterIdLst', {}, el('p:sldMasterId', { id: 2_147_483_648, 'r:id': 'rId1' })),
      el('p:notesMasterIdLst', {}, el('p:notesMasterId', { 'r:id': 'rId2' })),
      el('p:sldIdLst', {}, slides.map((_, i) => el('p:sldId', { id: 256 + i, 'r:id': `rId${10 + i}` }))),
      el('p:sldSz', SLIDE),
      el('p:notesSz', NOTES),
    );

  const entries = [
    ['[Content_Types].xml', contentTypesXml({ rels: 'application/vnd.openxmlformats-package.relationships+xml', xml: 'application/xml', png: 'image/png' }, overrides)],
    [
      '_rels/.rels',
      relsXml([
        ['rId1', REL.officeDocument, 'ppt/presentation.xml'],
        ['rId2', REL.coreProps, 'docProps/core.xml'],
        ['rId3', REL.extProps, 'docProps/app.xml'],
      ]),
    ],
    ['docProps/core.xml', corePropsXml({ title: 'Simpaper Sunum Testi', subject: 'Türkçe PPTX test sunusu', creator: AUTHOR, language: 'tr-TR', created: FIXED_DATE_ISO })],
    ['docProps/app.xml', appPropsXml({ application: 'Simpaper corpus generator' })],
    ['ppt/_rels/presentation.xml.rels', relsXml(presRels)],
    ['ppt/presentation.xml', presentation],
    ['ppt/presProps.xml', XML_DECL + el('p:presentationPr', P_NS)],
    ['ppt/viewProps.xml', XML_DECL + el('p:viewPr', P_NS, el('p:gridSpacing', { cx: 72_008, cy: 72_008 }))],
    ['ppt/tableStyles.xml', XML_DECL + el('a:tblStyleLst', { 'xmlns:a': NS.a, def: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}' })],
    ['ppt/theme/theme1.xml', themeXml('Simpaper')],
    ['ppt/theme/theme2.xml', themeXml('Simpaper Notlar')],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml([...LAYOUTS.map((_, i) => [`rId${i + 1}`, REL.slideLayout, `../slideLayouts/slideLayout${i + 1}.xml`]), ['rId9', REL.theme, '../theme/theme1.xml']])],
    ['ppt/slideMasters/slideMaster1.xml', masterXml(LAYOUTS.length)],
    ...LAYOUTS.flatMap((layout, i) => [
      [`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, relsXml([['rId1', REL.slideMaster, '../slideMasters/slideMaster1.xml']])],
      [`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(layout)],
    ]),
    ['ppt/notesMasters/_rels/notesMaster1.xml.rels', relsXml([['rId1', REL.theme, '../theme/theme2.xml']])],
    ['ppt/notesMasters/notesMaster1.xml', notesMasterXml()],
  ];
  slides.forEach((s, i) => {
    const n = i + 1;
    const rels = [
      ['rId1', REL.slideLayout, `../slideLayouts/slideLayout${s.layout}.xml`],
      ['rId2', REL.notesSlide, `../notesSlides/notesSlide${n}.xml`],
    ];
    if (s.picture) rels.push(['rId3', REL.image, '../media/image1.png']);
    entries.push([`ppt/slides/_rels/slide${n}.xml.rels`, relsXml(rels)]);
    entries.push([`ppt/slides/slide${n}.xml`, slideXml(slideShapes(s))]);
    entries.push([
      `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
      relsXml([
        ['rId1', REL.notesMaster, '../notesMasters/notesMaster1.xml'],
        ['rId2', REL.slide, `../slides/slide${n}.xml`],
      ]),
    ]);
    entries.push([`ppt/notesSlides/notesSlide${n}.xml`, notesSlideXml(s.notes)]);
  });
  entries.push(['ppt/media/image1.png', picture]);
  const buffer = await buildPackage(entries);

  const facts = {
    slideCount: slides.length,
    slideSize: SLIDE,
    slides: slides.map((s) => ({
      title: s.title,
      texts: [s.title, ...(s.subtitle ? [s.subtitle] : []), ...(s.bullets ?? []).map((b) => b.text)],
      bulletLevels: (s.bullets ?? []).map((b) => b.lvl),
      notes: s.notes,
      images: s.picture ? 1 : 0,
      table: s.table ?? null,
    })),
  };
  return { buffer, facts };
}
