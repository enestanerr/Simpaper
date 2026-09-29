/**
 * Low-level document-structure helpers on top of @cantoo/pdf-lib:
 * garbage collection of unreachable objects, clean removal of pages and AcroForm field registration
 * for pages copied from other documents.
 */
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFObjectCopier,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from '@cantoo/pdf-lib';

const N = {
  AcroForm: PDFName.of('AcroForm'),
  Annots: PDFName.of('Annots'),
  Contents: PDFName.of('Contents'),
  DA: PDFName.of('DA'),
  DR: PDFName.of('DR'),
  Fields: PDFName.of('Fields'),
  FT: PDFName.of('FT'),
  Kids: PDFName.of('Kids'),
  Metadata: PDFName.of('Metadata'),
  NeedAppearances: PDFName.of('NeedAppearances'),
  P: PDFName.of('P'),
  Parent: PDFName.of('Parent'),
  PieceInfo: PDFName.of('PieceInfo'),
  Resources: PDFName.of('Resources'),
  Subtype: PDFName.of('Subtype'),
  T: PDFName.of('T'),
  Thumb: PDFName.of('Thumb'),
  B: PDFName.of('B'),
  Widget: PDFName.of('Widget'),
};

/** Tags (`"12 0 R"`) of all objects reachable from the trailer (Root, Info, Encrypt). */
export function collectReachable(doc: PDFDocument): Set<string> {
  const { context } = doc;
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const o of [Root, Info, Encrypt]) if (o) stack.push(o);
  while (stack.length > 0) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      const target = context.lookup(o);
      if (target) stack.push(target);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v);
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  return seen;
}

/**
 * Deletes indirect objects that are no longer reachable. pdf-lib otherwise writes every parsed object,
 * so content of deleted pages or removed annotations would survive in the saved file.
 */
export function pruneUnreachable(doc: PDFDocument): number {
  const reachable = collectReachable(doc);
  let removed = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.tag)) {
      doc.context.delete(ref);
      removed += 1;
    }
  }
  return removed;
}

function asRefArray(obj: PDFObject | undefined, doc: PDFDocument): PDFArray | undefined {
  if (!obj) return undefined;
  const resolved = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return resolved instanceof PDFArray ? resolved : undefined;
}

function removeFromArray(arr: PDFArray, ref: PDFRef): boolean {
  for (let i = arr.size() - 1; i >= 0; i--) {
    const item = arr.get(i);
    if (item instanceof PDFRef && item.tag === ref.tag) {
      arr.remove(i);
      return true;
    }
  }
  return false;
}

/** Top-level AcroForm dictionary, if the document has one. */
export function getAcroForm(doc: PDFDocument): PDFDict | undefined {
  const raw = doc.catalog.get(N.AcroForm);
  const dict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  return dict instanceof PDFDict ? dict : undefined;
}

/**
 * Detaches a widget annotation from its form field so a deleted page leaves no orphan field behind:
 * the widget is removed from its parent's /Kids, and fields that end up without kids are removed
 * from their parent (or from /AcroForm /Fields).
 */
function detachWidget(doc: PDFDocument, widgetRef: PDFRef, widget: PDFDict): void {
  const acroForm = getAcroForm(doc);
  const fields = asRefArray(acroForm?.get(N.Fields), doc);
  let childRef = widgetRef;
  let child = widget;
  for (let depth = 0; depth < 32; depth++) {
    const parentRef = child.get(N.Parent);
    if (!(parentRef instanceof PDFRef)) {
      // `child` is a root field (or a merged field/widget without parent).
      if (fields) removeFromArray(fields, childRef);
      return;
    }
    const parent = doc.context.lookup(parentRef);
    if (!(parent instanceof PDFDict)) return;
    const kids = asRefArray(parent.get(N.Kids), doc);
    if (kids) removeFromArray(kids, childRef);
    if (kids && kids.size() > 0) return;
    childRef = parentRef;
    child = parent;
  }
}

/**
 * Removes a page and everything only it referenced: its content, resources and annotations
 * (form widgets are detached from their fields). Call {@link pruneUnreachable} before saving.
 */
export function removePageCompletely(doc: PDFDocument, index: number): void {
  const page = doc.getPage(index);
  const node = page.node;
  const annots = asRefArray(node.get(N.Annots), doc);
  if (annots) {
    for (const item of annots.asArray()) {
      if (!(item instanceof PDFRef)) continue;
      const annot = doc.context.lookup(item);
      if (annot instanceof PDFDict && annot.get(N.Subtype) === N.Widget) detachWidget(doc, item, annot);
    }
  }
  // Something else (an outline, a structure element) may still point at the page object; make sure it no
  // longer carries the page's content.
  for (const key of [N.Contents, N.Resources, N.Annots, N.Thumb, N.Metadata, N.PieceInfo, N.B]) node.delete(key);
  doc.removePage(index);
}

function fieldName(dict: PDFDict): string | undefined {
  const t = dict.get(N.T);
  if (t instanceof PDFString || t instanceof PDFHexString) return t.decodeText();
  return undefined;
}

function isField(dict: PDFDict): boolean {
  return dict.has(N.FT) || dict.has(N.T) || dict.has(N.Kids);
}

/** Root form fields (as refs) that own widgets on the given pages. */
export function rootFieldsOfPages(doc: PDFDocument, pages: PDFPage[]): PDFRef[] {
  const roots = new Map<string, PDFRef>();
  for (const page of pages) {
    const annots = asRefArray(page.node.get(N.Annots), doc);
    if (!annots) continue;
    for (const item of annots.asArray()) {
      if (!(item instanceof PDFRef)) continue;
      const annot = doc.context.lookup(item);
      if (!(annot instanceof PDFDict) || annot.get(N.Subtype) !== N.Widget) continue;
      let ref = item;
      let dict = annot;
      for (let depth = 0; depth < 32; depth++) {
        const parentRef = dict.get(N.Parent);
        const parent = parentRef instanceof PDFRef ? doc.context.lookup(parentRef) : undefined;
        if (!(parentRef instanceof PDFRef) || !(parent instanceof PDFDict)) break;
        ref = parentRef;
        dict = parent;
      }
      if (isField(dict)) roots.set(ref.tag, ref);
    }
  }
  return [...roots.values()];
}

function uniqueName(base: string, taken: Set<string>): string {
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Registers the form fields of pages copied into `target` (merge/extract) in its /AcroForm, so they stay
 * fillable. Root field names that collide with existing ones are renamed (`name_2`), otherwise viewers would
 * treat two different fields as one. /DA and /DR are copied from the source form when the target has none.
 */
export function registerCopiedFields(target: PDFDocument, source: PDFDocument, copiedPages: PDFPage[]): number {
  const roots = rootFieldsOfPages(target, copiedPages);
  if (roots.length === 0) return 0;
  const { context } = target;
  let acroForm = getAcroForm(target);
  if (!acroForm) {
    acroForm = context.obj({ Fields: [] });
    target.catalog.set(N.AcroForm, context.register(acroForm));
  }
  let fields = asRefArray(acroForm.get(N.Fields), target);
  if (!fields) {
    fields = context.obj([]);
    acroForm.set(N.Fields, fields);
  }
  const taken = new Set<string>();
  const present = new Set<string>();
  for (const item of fields.asArray()) {
    if (!(item instanceof PDFRef)) continue;
    present.add(item.tag);
    const dict = context.lookup(item);
    const name = dict instanceof PDFDict ? fieldName(dict) : undefined;
    if (name) taken.add(name);
  }
  let added = 0;
  for (const ref of roots) {
    if (present.has(ref.tag)) continue;
    const dict = context.lookup(ref);
    if (!(dict instanceof PDFDict)) continue;
    const name = fieldName(dict);
    if (name !== undefined) {
      const finalName = taken.has(name) ? uniqueName(name, taken) : name;
      if (finalName !== name) dict.set(N.T, PDFHexString.fromText(finalName));
      taken.add(finalName);
    }
    fields.push(ref);
    present.add(ref.tag);
    added += 1;
  }
  const sourceForm = getAcroForm(source);
  if (sourceForm) {
    const copier = PDFObjectCopier.for(source.context, context);
    for (const key of [N.DA, N.DR]) {
      const value = sourceForm.get(key);
      if (value && !acroForm.has(key)) acroForm.set(key, copier.copy(value));
    }
    if (sourceForm.get(N.NeedAppearances) === PDFBool.True) acroForm.set(N.NeedAppearances, PDFBool.True);
  }
  return added;
}
