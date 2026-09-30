/**
 * Single source of truth for the product identity (docs/adr/0009-product-name-simpaper.md).
 * electron-builder.yml (appId, productName, shortcutName) and build/installer.nsh (registered-app name) mirror
 * these values; tests/unit/main/fileAssociations.test.ts checks that they match.
 */
export const BRAND = {
  productName: 'Simpaper',
  /** Windows AppUserModelID / electron-builder appId (also decides the installer's product GUID). */
  appId: 'io.github.enestanerr.simpaper',
  vendor: 'Simpaper contributors',
  /** Folder name used under %APPDATA% / %LOCALAPPDATA%. */
  dataFolder: 'Simpaper',
  /**
   * Value name under Software\RegisteredApplications written by the installer; Settings › Apps › Default apps
   * opens Simpaper's page with `ms-settings:defaultapps?registeredAppUser=<name>`. Never change it.
   */
  registeredAppName: 'Simpaper',
  repositoryUrl: 'https://github.com/enestanerr/Simpaper',
  issuesUrl: 'https://github.com/enestanerr/Simpaper/issues',
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
