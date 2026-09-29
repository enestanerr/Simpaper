/** Types of zip.mjs. */
export declare function buildPackage(entries: Array<[string, string | Uint8Array]>, opts?: { stored?: string[] }): Promise<Buffer>;
export declare function normalizeZip(buffer: Uint8Array, transform?: (name: string, content: Buffer) => Buffer | string): Promise<Buffer>;
export declare function partHashes(buffer: Uint8Array): Promise<Record<string, string>>;
