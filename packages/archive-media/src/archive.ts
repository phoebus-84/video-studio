// Searching every enabled provider at once, and fetching one item: its record
// read again from the provider (the search result may be stale or partial),
// its licence held to the policy, its size to the minimum, its file
// downloaded, hashed and checked for what it claims to be.

import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { ArchiveError } from "./errors.js";
import { createHttp, type ArchiveHttp, type HttpOptions } from "./http.js";
import { imageSize } from "./image-size.js";
import { sniffMedia } from "./media-sniff.js";
import { sanitizeLottie } from "./lottie.js";
import { extractZipEntry } from "./zip.js";
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

export interface SearchFilters {
  orientation?: "portrait" | "landscape" | "square";
  minWidth?: number;
  maxDurationSeconds?: number;
  /** Interleave provider results instead of grouping them. */
  diverse?: boolean;
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
  durationSeconds?: number;
  /** When the record was read and the file downloaded. */
  retrievedAt: string;
}

const hashFile = (file: string) => {
  const bytes = readFileSync(file);
  return { sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytes: bytes.length };
};

const EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/tiff": ".tif",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/ogg": ".ogv", "video/x-matroska": ".mkv",
  "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/flac": ".flac", "audio/x-flac": ".flac",
  "audio/ogg": ".ogg", "application/ogg": ".ogg", "audio/mp4": ".m4a", "audio/aac": ".aac",
  "application/json": ".json", "font/woff2": ".woff2", "font/woff": ".woff", "font/ttf": ".ttf", "font/otf": ".otf",
};

/** The extension a downloaded file gets, from its mime type, else from its URL. */
export function extensionOf(mime: string, url: string): string {
  if (EXTENSION[mime]) return EXTENSION[mime]!;
  const fromUrl = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(new URL(url).pathname);
  return fromUrl ? `.${fromUrl[1]!.toLowerCase()}` : ".bin";
}

const kindOfMime = (mime: string): MediaType | null =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") || mime === "application/ogg" ? "audio"
    : mime.startsWith("font/") ? "font" : null;

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

    async search(query: string, opts: SearchFilters & { mediaType?: MediaType; limit?: number; providers?: string[]; policy?: LicencePolicy; quality?: Quality } = {}): Promise<SearchResult> {
      const mediaType = opts.mediaType ?? "image";
      const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
      const quality = { ...DEFAULT_QUALITY, ...opts.quality };
      for (const id of opts.providers ?? []) provider(id); // Explicit unknown/missing-key selections must not silently vanish.
      for (const n of [opts.minWidth, opts.maxDurationSeconds]) {
        if (n !== undefined && (!Number.isFinite(n) || n <= 0)) throw new ArchiveError("bad-response", "Search limits must be positive finite numbers");
      }
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
      const ordered = opts.diverse ? Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, i) => lists.flatMap((l) => l[i] ? [l[i]!] : [])).flat() : lists.flat();
      const candidates = ordered.filter((item) => {
        // Explicit filters need evidence: unknown dimensions/duration do not satisfy them.
        if (opts.minWidth && (!item.width || item.width < opts.minWidth)) return false;
        if (opts.maxDurationSeconds && (!item.durationSeconds || item.durationSeconds > opts.maxDurationSeconds)) return false;
        if (opts.orientation) {
          if (!item.width || !item.height) return false;
          const ratio = item.width / item.height;
          if (opts.orientation === "portrait" && ratio >= 0.95) return false;
          if (opts.orientation === "landscape" && ratio <= 1.05) return false;
          if (opts.orientation === "square" && (ratio < 0.85 || ratio > 1.18)) return false;
        }
        return true;
      }).map((item): Candidate => {
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
    async fetch(providerId: string, id: string, opts: {
      dir: string; name: string; policy?: LicencePolicy; quality?: Quality; maxBytes?: number;
      /** Select a provider-advertised rendition by its stable id. */
      rendition?: string;
      /** Measures a downloaded video or sound (ffprobe, say): this package reads only pictures itself. */
      probe?: (file: string) => Promise<{ width?: number; height?: number; durationSeconds?: number } | null>;
    }): Promise<FetchResult> {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(opts.name)) throw new ArchiveError("bad-response", `"${opts.name}" is not a file name (letters, digits, . _ -)`);
      const s = provider(providerId);
      let item = await s.provider.item(id, http, s.key);
      if (opts.rendition) {
        const selected = item.renditions?.find((r) => r.id === opts.rendition);
        if (!selected) throw new ArchiveError("not-found", `${s.provider.label} ${id} has no rendition "${opts.rendition}" (available: ${item.renditions?.map((r) => r.id).join(", ") || "none"})`);
        // `id` and `label` name the rendition, never the item: only its file facts are merged in.
        const { id: renditionId, label, ...facts } = selected;
        item = { ...item, ...facts, rendition: label ?? renditionId };
      }
      const allowed = licenceAllowed(item.licence, opts.policy ?? DEFAULT_POLICY);
      if (!allowed.ok) throw new ArchiveError("licence-refused", `${s.provider.label} ${id}: ${allowed.reason}`);
      const quality = { ...DEFAULT_QUALITY, ...opts.quality };
      const small = tooSmall(item, quality);
      if (small) throw new ArchiveError("too-small", `${s.provider.label} ${id}: ${small}`);
      if (!item.fileUrl) throw new ArchiveError("no-file", `${s.provider.label} ${id} names no file`);
      await s.provider.beforeDownload?.(item, http, s.key);
      const retrievedAt = new Date().toISOString();
      const staging = join(opts.dir, `.${opts.name}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.download`);
      let got = await http.download(item.fileUrl, staging, { ...(item.fileHeaders ? { headers: item.fileHeaders } : {}), ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}), ...(s.provider.downloadHosts ? { allowedHosts: s.provider.downloadHosts } : {}) });
      if (item.zipEntry) {
        // Only the one file named is kept; the rest of the archive is never written.
        try {
          const { name, bytes } = extractZipEntry(readFileSync(staging), new RegExp(item.zipEntry, "i"));
          writeFileSync(staging, bytes);
          got = { ...hashFile(staging), mime: /\.png$/i.test(name) ? "image/png" : /\.jpe?g$/i.test(name) ? "image/jpeg" : "" };
        } catch (error) {
          rmSync(staging, { force: true });
          throw error instanceof ArchiveError ? new ArchiveError(error.code, `${s.provider.label} ${id}: ${error.message}`) : error;
        }
      }
      // SVG is active XML in browsers. Never persist provider SVG: resvg parses it without scripts/network and emits inert PNG.
      if (item.mediaType === "image" && (got.mime === "image/svg+xml" || /\.svg(?:$|[?#])/i.test(item.fileUrl))) {
        try {
          const { Resvg } = await import("@resvg/resvg-js");
          // Rasterize large enough that the resulting PNG still meets the quality floor; the vector is not persisted.
          const png = new Resvg(readFileSync(staging), { fitTo: { mode: "width", value: Math.max(2048, quality.minImageLongSide) }, font: { loadSystemFonts: false } }).render().asPng();
          writeFileSync(staging, png);
          got = { ...hashFile(staging), mime: "image/png" };
        } catch {
          rmSync(staging, { force: true });
          throw new ArchiveError("wrong-type", `${s.provider.label} ${id}: its SVG could not be safely rasterized`);
        }
      }
      const refuse = (code: "wrong-type" | "too-small", message: string): never => {
        rmSync(staging, { force: true });
        throw new ArchiveError(code, `${s.provider.label} ${id}: ${message}`);
      };
      let mime = got.mime;
      let width: number | undefined;
      let height: number | undefined;
      let durationSeconds = item.durationSeconds;
      if (item.mediaType === "animation") {
        // Lottie JSON is saved only inert: no expression, nothing loaded from outside the file.
        try {
          const clean = sanitizeLottie(readFileSync(staging, "utf-8"));
          writeFileSync(staging, clean.json);
          got = { ...hashFile(staging), mime: "application/json" };
          ({ width, height, durationSeconds } = clean.facts);
          mime = got.mime;
        } catch (error) {
          refuse("wrong-type", (error as Error).message);
        }
      } else if (item.mediaType === "image") {
        const size = imageSize(staging);
        if (!size) refuse("wrong-type", `the file is not a picture this package can read (sent as ${got.mime || "nothing"})`);
        ({ width, height, mime } = size!);
        const after = tooSmall({ mediaType: "image", width, height }, quality);
        if (after) refuse("too-small", `the file is ${after}`);
      } else {
        // The bytes say what it is, not the header: a 200 with a login page is not a video.
        const sniffed = sniffMedia(staging);
        if (!sniffed) refuse("wrong-type", `the file is not a ${item.mediaType} this package recognizes (sent as ${got.mime || "nothing"})`);
        if (sniffed!.mediaType !== item.mediaType) refuse("wrong-type", `the file is ${sniffed!.mime}, not ${item.mediaType}`);
        mime = kindOfMime(got.mime) === item.mediaType ? got.mime : sniffed!.mime;
        width = item.width;
        height = item.height;
        const probed = opts.probe && item.mediaType !== "font" ? await opts.probe(staging).catch(() => null) : null;
        if (probed) {
          width = probed.width ?? width;
          height = probed.height ?? height;
          durationSeconds = probed.durationSeconds ?? durationSeconds;
        }
        const after = tooSmall({ mediaType: item.mediaType, ...(width ? { width } : {}), ...(height ? { height } : {}) }, quality);
        if (after) refuse("too-small", `the file is ${after}`);
      }
      const file = join(opts.dir, `${opts.name}${extensionOf(mime, item.fileUrl)}`);
      renameSync(staging, file);
      return { item, file, sha256: got.sha256, bytes: got.bytes, mime, ...(width ? { width } : {}), ...(height ? { height } : {}), ...(durationSeconds ? { durationSeconds } : {}), retrievedAt };
    },
  };
}

export type Archive = ReturnType<typeof createArchive>;
