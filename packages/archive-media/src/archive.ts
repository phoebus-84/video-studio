// Searching every enabled provider at once, and fetching one item: its record
// read again from the provider (the search result may be stale or partial),
// its licence held to the policy, its size to the minimum, its file
// downloaded, hashed and checked for what it claims to be.

import { join } from "node:path";
import { renameSync, rmSync } from "node:fs";
import { ArchiveError } from "./errors.js";
import { createHttp, type ArchiveHttp, type HttpOptions } from "./http.js";
import { imageSize } from "./image-size.js";
import { DEFAULT_POLICY, licenceAllowed, type LicencePolicy } from "./licence.js";
import { PROVIDERS } from "./providers/index.js";
import type { ArchiveItem, MediaType, Provider } from "./types.js";

export interface ArchiveOptions extends Omit<HttpOptions, "userAgent"> {
  /** Who is asking, with a contact: Wikimedia requires it. */
  userAgent: string;
  /** Where provider keys are read. Default process.env. */
  env?: Record<string, string | undefined>;
  /** Only these providers. Default: every one whose key, if it needs one, is set. */
  providers?: string[];
  /** Tests: other providers. */
  registry?: Provider[];
}

/** The least size, by medium: an image's long side in px, a video's height. */
export interface Quality {
  minImageLongSide?: number;
  minVideoHeight?: number;
}

export const DEFAULT_QUALITY: Required<Quality> = { minImageLongSide: 1600, minVideoHeight: 720 };

export interface Candidate extends ArchiveItem {
  /** Whether fetch would accept it, as far as the search knows. */
  allowed: boolean;
  /** Why not, when not. */
  refusal?: string;
}

export interface SearchResult {
  candidates: Candidate[];
  /** Providers that failed, by id: one failing never sinks the others. */
  errors: { provider: string; message: string }[];
}

export interface FetchResult {
  item: ArchiveItem;
  file: string;
  sha256: string;
  bytes: number;
  mime: string;
  width?: number;
  height?: number;
  /** When the record was read and the file downloaded. */
  retrievedAt: string;
}

const EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/tiff": ".tif",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/ogg": ".ogv", "video/x-matroska": ".mkv",
  "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/flac": ".flac", "audio/x-flac": ".flac",
  "audio/ogg": ".ogg", "application/ogg": ".ogg", "audio/mp4": ".m4a", "audio/aac": ".aac",
};

/** The extension a downloaded file gets, from its mime type, else from its URL. */
export function extensionOf(mime: string, url: string): string {
  if (EXTENSION[mime]) return EXTENSION[mime]!;
  const fromUrl = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(new URL(url).pathname);
  return fromUrl ? `.${fromUrl[1]!.toLowerCase()}` : ".bin";
}

const kindOfMime = (mime: string): MediaType | null =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") || mime === "application/ogg" ? "audio" : null;

/** Whether the item's announced size meets the quality; unknown sizes pass here and are checked after download. */
export function tooSmall(item: Pick<ArchiveItem, "mediaType" | "width" | "height">, quality: Required<Quality>): string | null {
  if (item.mediaType === "image" && item.width && item.height && Math.max(item.width, item.height) < quality.minImageLongSide) {
    return `${item.width}×${item.height} is smaller than ${quality.minImageLongSide} px on its long side`;
  }
  if (item.mediaType === "video" && item.height && item.height < quality.minVideoHeight) {
    return `${item.height} px high is less than ${quality.minVideoHeight}p`;
  }
  return null;
}

export function createArchive(options: ArchiveOptions) {
  const env = options.env ?? process.env;
  const registry = options.registry ?? PROVIDERS;
  const http: ArchiveHttp = createHttp(options);

  const status = registry.map((p) => {
    const key = p.keyEnv ? env[p.keyEnv] : undefined;
    const wanted = !options.providers || options.providers.includes(p.id);
    const enabled = wanted && (!p.keyEnv || !!key);
    const reason = !wanted ? "not selected" : !enabled ? `needs ${p.keyEnv}` : undefined;
    return { provider: p, key, enabled, ...(reason ? { reason } : {}) };
  });

  function provider(id: string) {
    const entry = status.find((s) => s.provider.id === id);
    if (!entry) throw new ArchiveError("provider-unknown", `no provider "${id}" (known: ${registry.map((p) => p.id).join(", ")})`);
    if (!entry.enabled) throw new ArchiveError("provider-disabled", `${entry.provider.label} is disabled: ${entry.reason}`);
    return entry;
  }

  return {
    /** Every provider, whether it is enabled, and why not. */
    providers: () => status.map((s) => ({ id: s.provider.id, label: s.provider.label, mediaTypes: s.provider.mediaTypes, enabled: s.enabled, ...(s.reason ? { reason: s.reason } : {}) })),

    async search(query: string, opts: { mediaType?: MediaType; limit?: number; providers?: string[]; policy?: LicencePolicy; quality?: Quality } = {}): Promise<SearchResult> {
      const mediaType = opts.mediaType ?? "image";
      const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
      const quality = { ...DEFAULT_QUALITY, ...opts.quality };
      const chosen = status.filter((s) => s.enabled && s.provider.mediaTypes.includes(mediaType) && (!opts.providers || opts.providers.includes(s.provider.id)));
      const errors: SearchResult["errors"] = [];
      const lists = await Promise.all(chosen.map(async (s) => {
        try {
          return await s.provider.search(query, { mediaType, limit }, http, s.key);
        } catch (error) {
          errors.push({ provider: s.provider.id, message: (error as Error).message });
          return [];
        }
      }));
      const candidates = lists.flat().map((item): Candidate => {
        const licence = licenceAllowed(item.licence, opts.policy ?? DEFAULT_POLICY);
        const small = tooSmall(item, quality);
        const refusal = !licence.ok ? licence.reason : small;
        return { ...item, allowed: !refusal, ...(refusal ? { refusal } : {}) };
      });
      return { candidates, errors };
    },

    /** The provider's current record for one item. */
    async item(providerId: string, id: string): Promise<ArchiveItem> {
      const s = provider(providerId);
      return s.provider.item(id, http, s.key);
    },

    /**
     * Download one item into `dir` as `<name><ext>`: its record read again,
     * its licence allowed by the policy, its size at least the quality, its
     * bytes the medium it claims. Nothing is left behind on a refusal.
     */
    async fetch(providerId: string, id: string, opts: { dir: string; name: string; policy?: LicencePolicy; quality?: Quality; maxBytes?: number }): Promise<FetchResult> {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(opts.name)) throw new ArchiveError("bad-response", `"${opts.name}" is not a file name (letters, digits, . _ -)`);
      const s = provider(providerId);
      const item = await s.provider.item(id, http, s.key);
      const allowed = licenceAllowed(item.licence, opts.policy ?? DEFAULT_POLICY);
      if (!allowed.ok) throw new ArchiveError("licence-refused", `${s.provider.label} ${id}: ${allowed.reason}`);
      const quality = { ...DEFAULT_QUALITY, ...opts.quality };
      const small = tooSmall(item, quality);
      if (small) throw new ArchiveError("too-small", `${s.provider.label} ${id}: ${small}`);
      if (!item.fileUrl) throw new ArchiveError("no-file", `${s.provider.label} ${id} names no file`);
      const retrievedAt = new Date().toISOString();
      const staging = join(opts.dir, `.${opts.name}.download`);
      const got = await http.download(item.fileUrl, staging, { ...(item.fileHeaders ? { headers: item.fileHeaders } : {}), ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}) });
      const refuse = (code: "wrong-type" | "too-small", message: string): never => {
        rmSync(staging, { force: true });
        throw new ArchiveError(code, `${s.provider.label} ${id}: ${message}`);
      };
      let mime = got.mime;
      let width: number | undefined;
      let height: number | undefined;
      if (item.mediaType === "image") {
        const size = imageSize(staging);
        if (!size) refuse("wrong-type", `the file is not a picture this package can read (sent as ${got.mime || "nothing"})`);
        ({ width, height, mime } = size!);
        const after = tooSmall({ mediaType: "image", width, height }, quality);
        if (after) refuse("too-small", `the file is ${after}`);
      } else {
        const kind = kindOfMime(mime) ?? kindOfMime(item.mime ?? "");
        if (kind && kind !== item.mediaType) refuse("wrong-type", `the file was sent as ${mime}, not ${item.mediaType}`);
        width = item.width;
        height = item.height;
      }
      const file = join(opts.dir, `${opts.name}${extensionOf(mime, item.fileUrl)}`);
      renameSync(staging, file);
      return { item, file, sha256: got.sha256, bytes: got.bytes, mime, ...(width ? { width } : {}), ...(height ? { height } : {}), retrievedAt };
    },
  };
}

export type Archive = ReturnType<typeof createArchive>;
