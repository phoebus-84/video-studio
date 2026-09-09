import { createHash } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";

const API = "https://api.polyhaven.com";
const headers = { "User-Agent": "av-blender/0.1 (local video production)" };
export interface AssetFile { key: string; url: string; size?: number; md5?: string }
async function json(url: string, signal?: AbortSignal): Promise<Record<string, any>> {
  const response = await fetch(url, { headers, signal, redirect: "error" });
  if (!response.ok) throw new Error(`Poly Haven HTTP ${response.status}`);
  return await response.json() as Record<string, any>;
}
function assetId(id: string): string {
  if (!/^[a-z0-9_\-]+$/.test(id)) throw new Error("Invalid Poly Haven asset ID");
  return id;
}
/** Metadata only. Selection/resolution are explicit; downloading is a separate action. */
export async function searchAssets(type: "hdris" | "textures" | "models", query: string, signal?: AbortSignal) {
  if (!["hdris", "textures", "models"].includes(type)) throw new Error("Invalid asset type");
  const assets = await json(`${API}/assets?t=${type}`, signal);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.entries(assets).filter(([id, value]) =>
    terms.every(term => `${id} ${value.name} ${(value.tags ?? []).join(" ")}`.toLowerCase().includes(term)),
  ).slice(0, 20).map(([id, value]) => ({ id, name: value.name, categories: value.categories }));
}
export function flattenFiles(value: unknown, prefix = ""): AssetFile[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  if (typeof obj.url === "string") return [{ key: prefix, url: obj.url,
    ...(typeof obj.size === "number" ? { size: obj.size } : {}),
    ...(typeof obj.md5 === "string" ? { md5: obj.md5 } : {}),
  }, ...Object.entries(obj).filter(([k]) => k !== "url").flatMap(([k, v]) => flattenFiles(v, `${prefix}.${k}`))];
  return Object.entries(obj).flatMap(([k, v]) => flattenFiles(v, prefix ? `${prefix}.${k}` : k));
}
export async function assetFiles(id: string, signal?: AbortSignal): Promise<AssetFile[]> {
  return flattenFiles(await json(`${API}/files/${assetId(id)}`, signal));
}
export function validateDownloadUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "dl.polyhaven.org" || url.port || url.username || url.password) {
    throw new Error("Only HTTPS dl.polyhaven.org asset downloads are allowed");
  }
  return url;
}
/** Download exactly one API-selected file with a byte budget and provenance.
 * Models may reference more files: inspect assetFiles and acquire dependencies explicitly.
 */
export async function downloadAsset(id: string, key: string, outputDir: string,
  options: { maxBytes?: number; signal?: AbortSignal } = {}) {
  assetId(id);
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000);
  const file = (await assetFiles(id, signal)).find(f => f.key === key);
  if (!file) throw new Error(`Unknown file key ${key}; list assetFiles first`);
  const url = validateDownloadUrl(file.url);
  const limit = options.maxBytes ?? 256 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2 * 1024 ** 3) throw new Error("maxBytes must be 1–2147483648");
  if (file.size && file.size > limit) throw new Error("Asset exceeds download budget");
  const dir = resolve(outputDir);
  await mkdir(dir); // new download attempt; do not mutate an existing cache
  const temp = join(dir, "download.partial");
  const hash = createHash("sha256");
  const md5 = createHash("md5");
  let bytes = 0;
  try {
    const res = await fetch(url, { headers, signal, redirect: "error" });
    if (!res.ok || !res.body) throw new Error(`Asset HTTP ${res.status}`);
    if (Number(res.headers.get("content-length")) > limit) {
      await res.body.cancel();
      throw new Error("Asset exceeds download budget");
    }
    const handle = await open(temp, "wx");
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error("Asset exceeds download budget");
        hash.update(chunk); md5.update(chunk);
        await handle.writeFile(chunk);
      }
    } finally { await handle.close(); }
    if (!bytes || (file.size !== undefined && bytes !== file.size)) throw new Error("Incomplete asset download");
    if (file.md5 && md5.digest("hex") !== file.md5.toLowerCase()) throw new Error("Asset MD5 mismatch");
    const sha256 = hash.digest("hex");
    const ext = extname(url.pathname);
    if (!/^\.[a-z0-9]+$/i.test(ext)) throw new Error("Unsupported asset extension");
    const path = join(dir, `${id}-${sha256.slice(0, 16)}${ext}`);
    await rename(temp, path);
    const provenance = { provider: "poly-haven", assetId: id, key, url: url.href,
      source: `https://polyhaven.com/a/${id}`, license: "CC0-1.0",
      licenseUrl: "https://polyhaven.com/license", downloadedAt: new Date().toISOString(), bytes, sha256, path };
    await writeFile(join(dir, "asset.json"), JSON.stringify(provenance, null, 2));
    return provenance;
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
