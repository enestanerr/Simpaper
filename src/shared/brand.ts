/**
 * Single source of truth for the product identity.
 * "Varak" (Ottoman Turkish: a leaf/sheet of paper, also gold leaf) is the working name;
 * see docs/adr/0007-product-name.md before changing it.
 */
export const BRAND = {
  productName: 'Varak',
  /** Windows AppUserModelID / electron-builder appId. */
  appId: 'org.varakoffice.varak',
  vendor: 'Varak contributors',
  /** Folder name used under %APPDATA% / %LOCALAPPDATA%. */
  dataFolder: 'Varak',
  repositoryUrl: 'https://github.com/enestanerr/varak',
  issuesUrl: 'https://github.com/enestanerr/varak/issues',
  /** Engine attribution shown in About and docs (TDF trademark policy: text form only). */
  engineAttribution: 'Includes LibreOffice® (The Document Foundation), unmodified.',
  colors: {
    ink: '#1D2B53',
    gold: '#C9A227',
    writer: '#3B5BDB',
    calc: '#12876F',
    impress: '#D5582A',
    pdf: '#C0303F',
  },
} as const;

export type BrandColors = typeof BRAND.colors;
