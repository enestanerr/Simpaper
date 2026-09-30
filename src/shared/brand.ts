/**
 * Single source of truth for the product identity (docs/adr/0009-product-name-simpaper.md).
 * electron-builder.yml mirrors appId, productName and vendor.
 */
export const BRAND = {
  productName: 'Simpaper',
  /** Windows AppUserModelID / electron-builder appId (also decides the installer's product GUID). */
  appId: 'io.github.ncreativestudios.simpaper',
  vendor: 'Simpaper contributors',
  /** Folder name used under %APPDATA% / %LOCALAPPDATA%. */
  dataFolder: 'Simpaper',
  repositoryUrl: 'https://github.com/ncreativestudios/Simpaper',
  issuesUrl: 'https://github.com/ncreativestudios/Simpaper/issues',
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
