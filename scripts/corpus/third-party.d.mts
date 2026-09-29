/** Types of third-party.mjs (pinned list of the vendored third-party samples). */

export declare const THIRD_PARTY_DIR: string;

export interface ThirdPartySource {
  name: string;
  repository: string;
  commit: string;
  /** Raw-file base URL at the pinned commit; a file's URL is `base + path`. */
  base: string;
  license: string;
  copyright: string;
  legal: { file: string; path: string; sha256: string }[];
  passwordSource?: string;
}

export interface ThirdPartySample {
  id: string;
  source: string;
  /** File name inside tests/corpus/third_party/<source>/. */
  file: string;
  /** Path below the source's `base` URL. */
  path: string;
  bytes: number;
  sha256: string;
  producer: string;
  features: string[];
  exercises: string;
  password?: string;
  expect: Record<string, unknown>;
}

export declare const SOURCES: Record<string, ThirdPartySource>;
export declare const SAMPLES: ThirdPartySample[];

/** Problems found in the vendored corpus (empty = OK). Offline. */
export declare function verify(dir?: string): string[];
/** Generated content of manifest.json and of each source folder's ATTRIBUTION.md. */
export declare function renderDocs(): { manifest: string; attributions: Record<string, string> };
