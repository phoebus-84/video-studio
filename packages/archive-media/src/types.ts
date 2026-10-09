// What every provider's item becomes: one shape, its licence normalized, the
// provider's own response kept beside it as the evidence anyone can check.

export type MediaType = "image" | "video" | "audio";

/**
 * A licence in one vocabulary:
 * - `public-domain`, with `basis` saying why (PDM-1.0, an institution's flag, NASA…);
 * - `CC0-1.0`, or `CC-<BY|BY-SA|BY-NC|BY-NC-SA|BY-ND|BY-NC-ND>-<version>`;
 * - `provider:<name>` for a provider's own licence (Pexels, Pixabay, Unsplash);
 * - `unknown`: never fetched.
 */
export interface Licence {
  id: string;
  /** For public-domain: why it is (PDM-1.0, "aic:is_public_domain", "NASA media guidelines"…). */
  basis?: string;
  /** Where the licence, or the statement, is written. */
  url?: string;
  attributionRequired: boolean;
  /** What the provider said, as it said it. */
  statement: string;
}

export interface ArchiveItem {
  provider: string;
  /** The provider's own id: what `item(provider, id)` takes. */
  id: string;
  mediaType: MediaType;
  title: string;
  creator?: string;
  date?: string;
  /** The holding institution, or the platform the item is from. */
  institution?: string;
  /** The page a person opens to see the item and its licence. */
  landingUrl: string;
  /** The original file: never a thumbnail. Empty in a search result that must be completed by `item`. */
  fileUrl: string;
  previewUrl?: string;
  /** When the file is not the uploaded original, which rendition it is (Freesound's "preview-hq-ogg" without OAuth). */
  rendition?: string;
  mime?: string;
  width?: number;
  height?: number;
  bytes?: number;
  durationSeconds?: number;
  licence: Licence;
  /** A credit line ready to print: title, creator, institution, licence. */
  attribution: string;
  /** Headers the file's host requires (AIC's IIIF wants AIC-User-Agent). */
  fileHeaders?: Record<string, string>;
  /** The provider's response for this item, kept as evidence. */
  raw: unknown;
}

export interface SearchOptions {
  mediaType?: MediaType;
  /** Per provider. Default 10. */
  limit?: number;
}

/** The HTTP a provider is given: polite, retried, cached. */
export interface Http {
  json(url: string, options?: { headers?: Record<string, string>; cache?: boolean }): Promise<unknown>;
  userAgent: string;
}

export interface Provider {
  id: string;
  label: string;
  mediaTypes: MediaType[];
  /** The environment variable holding its key; absent for providers with none. */
  keyEnv?: string;
  search(query: string, options: Required<SearchOptions>, http: Http, key?: string): Promise<ArchiveItem[]>;
  /** The authoritative record, read again at fetch time. */
  item(id: string, http: Http, key?: string): Promise<ArchiveItem>;
}
