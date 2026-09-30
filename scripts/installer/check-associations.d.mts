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
/** Read-only registry access (plus deleting the scratch key) through koffi; hives are predefined HKEY values. */
export declare function registry(): {
  value(hive: bigint, key: string, name: string): { type: number; text: string } | null;
  keyExists(hive: bigint, key: string): boolean;
  tree(hive: bigint, key: string): Map<string, string[]>;
  deleteTree(hive: bigint, key: string): void;
};
