/** Types of check-associations.mjs. */
export interface InstallerFileType {
  progId: string;
  /** Extension without the dot. */
  ext: string;
  /** Icon file name without `.ico` (resources/fileicons). */
  icon: string;
  claim: boolean;
  en: string;
  tr: string;
}
/** The SP_FILE_TYPES table of build/installer.nsh. */
export declare function parseFileTypes(nsh: string): InstallerFileType[];
