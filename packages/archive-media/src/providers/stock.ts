import type { ArchiveItem, MediaType, Provider } from "../types.js";
import { platform, positive, requiredItem, requiredKey, safeUrl, simpleId, stockItem, typedId } from "./stock-common.js";

const PEXELS = ["images.pexels.com", "videos.pexels.com"];
function pexelsItem(x: any, kind: MediaType): ArchiveItem | null {
  if (!x?.id) return null;
  const video = kind === "video";
  const best = video ? [...(x.video_files ?? [])].filter((f: any) => f.file_type === "video/mp4" && safeUrl(f.link, PEXELS))
    .sort((a: any, b: any) => (b.width * b.height || 0) - (a.width * a.height || 0))[0] : undefined;
  return stockItem("pexels", `${kind}/${x.id}`, kind, x, {
    title: x.alt || `Pexels ${kind} ${x.id}`, creator: video ? x.user?.name : x.photographer,
    landingUrl: x.url || `https://www.pexels.com/${video ? "video" : "photo"}/${x.id}/`,
    fileUrl: safeUrl(video ? best?.link : x.src?.original, PEXELS), previewUrl: video ? x.image : x.src?.medium,
    width: positive(video ? best?.width : x.width), height: positive(video ? best?.height : x.height),
    durationSeconds: positive(x.duration), licence: platform("pexels", "https://www.pexels.com/license/"),
    renditions: video
      ? (x.video_files ?? []).filter((f: any) => f.file_type === "video/mp4" && safeUrl(f.link, PEXELS)).map((f: any) => ({ id: String(f.id ?? `${f.width}x${f.height}`), fileUrl: f.link, mime: "video/mp4", width: positive(f.width), height: positive(f.height), label: `${f.quality || "mp4"} ${f.width || "?"}×${f.height || "?"}` }))
      : Object.entries(x.src ?? {}).flatMap(([id, url]) => safeUrl(url, PEXELS) ? [{ id, fileUrl: String(url), label: id }] : []),
  });
}
export const pexels: Provider = {
  id: "pexels", label: "Pexels", keyEnv: "PEXELS_API_KEY", mediaTypes: ["image", "video"], downloadHosts: PEXELS,
  async search(q, { mediaType, limit }, http, key) {
    const path = mediaType === "video" ? "videos/search" : "v1/search";
    const d: any = await http.json(`https://api.pexels.com/${path}?${new URLSearchParams({ query: q, per_page: String(limit) })}`, { headers: { Authorization: requiredKey(key, "pexels") } });
    return (d[mediaType === "video" ? "videos" : "photos"] ?? []).map((x: any) => pexelsItem(x, mediaType)).filter(Boolean);
  },
  async item(id, http, key) {
    const p = typedId(id);
    return requiredItem(pexelsItem(await http.json(`https://api.pexels.com/${p.kind === "video" ? "videos/videos" : "v1/photos"}/${p.id}`,
      { cache: false, headers: { Authorization: requiredKey(key, "pexels") } }), p.kind), "pexels");
  },
};

const PIXABAY = ["pixabay.com", ".pixabay.com"];
function pixabayItem(x: any, kind: MediaType): ArchiveItem | null {
  if (!x?.id) return null;
  const video = kind === "video";
  const best: any = video ? Object.values(x.videos ?? {}).filter((v: any) => safeUrl(v.url, PIXABAY))
    .sort((a: any, b: any) => (b.width * b.height || 0) - (a.width * a.height || 0))[0] : undefined;
  return stockItem("pixabay", `${kind}/${x.id}`, kind, x, {
    title: x.tags || `Pixabay ${x.id}`, creator: x.user, landingUrl: x.pageURL || `https://pixabay.com/`,
    fileUrl: safeUrl(video ? best?.url : x.largeImageURL, PIXABAY), previewUrl: video ? x.videos?.tiny?.thumbnail : x.previewURL,
    // largeImageURL is a rendition, not the imageWidth/imageHeight original.
    width: video ? positive(best?.width) : undefined, height: video ? positive(best?.height) : undefined,
    rendition: video ? "largest-mp4" : "large-image", durationSeconds: positive(x.duration),
    renditions: video
      ? Object.entries(x.videos ?? {}).flatMap(([id, v]: [string, any]) => safeUrl(v?.url, PIXABAY) ? [{ id, fileUrl: v.url, mime: "video/mp4", width: positive(v.width), height: positive(v.height), bytes: positive(v.size), label: id }] : [])
      : [["large", x.largeImageURL], ["webformat", x.webformatURL], ["preview", x.previewURL]].flatMap(([id, url]) => safeUrl(url, PIXABAY) ? [{ id: String(id), fileUrl: String(url), label: String(id) }] : []),
    licence: platform("pixabay", "https://pixabay.com/service/license-summary/"),
  });
}
export const pixabay: Provider = {
  id: "pixabay", label: "Pixabay", keyEnv: "PIXABAY_API_KEY", mediaTypes: ["image", "video"], downloadHosts: PIXABAY,
  async search(q, { mediaType, limit }, http, key) {
    const d: any = await http.json(`https://pixabay.com/api/${mediaType === "video" ? "videos/" : ""}?${new URLSearchParams({ key: requiredKey(key, "pixabay"), q: q.slice(0, 100), per_page: String(Math.max(3, limit)), safesearch: "true" })}`);
    return (d.hits ?? []).slice(0, limit).map((x: any) => pixabayItem(x, mediaType)).filter(Boolean);
  },
  async item(id, http, key) {
    const p = typedId(id);
    const d: any = await http.json(`https://pixabay.com/api/${p.kind === "video" ? "videos/" : ""}?${new URLSearchParams({ key: requiredKey(key, "pixabay"), id: p.id, safesearch: "true" })}`, { cache: false });
    return requiredItem(pixabayItem((d.hits ?? []).find((x: any) => String(x.id) === p.id), p.kind), "pixabay");
  },
};

const UNSPLASH = ["images.unsplash.com"];
const utm = "utm_source=video-studio&utm_medium=referral";
function unsplashItem(x: any): ArchiveItem | null {
  if (!x?.id || x.premium || String(x.urls?.full ?? "").includes("plus.unsplash")) return null;
  const item = stockItem("unsplash", x.id, "image", x, {
    title: x.description || x.alt_description || `Unsplash ${x.id}`, creator: x.user?.name,
    landingUrl: `https://unsplash.com/photos/${encodeURIComponent(x.id)}?${utm}`,
    fileUrl: safeUrl(x.urls?.full, UNSPLASH), previewUrl: x.urls?.small,
    width: positive(x.width), height: positive(x.height), rendition: "full",
    renditions: Object.entries(x.urls ?? {}).flatMap(([id, url]) => safeUrl(url, UNSPLASH) ? [{ id, fileUrl: String(url), label: id }] : []),
    licence: platform("unsplash", "https://unsplash.com/license"),
  });
  item.attribution += `; photographer: https://unsplash.com/@${encodeURIComponent(x.user?.username ?? "")}?${utm}; Unsplash: https://unsplash.com/?${utm}`;
  return item;
}
const unsplashHeaders = (key?: string) => ({ Authorization: `Client-ID ${requiredKey(key, "unsplash")}`, "Accept-Version": "v1" });
export const unsplash: Provider = {
  id: "unsplash", label: "Unsplash", keyEnv: "UNSPLASH_ACCESS_KEY", mediaTypes: ["image"], downloadHosts: UNSPLASH,
  async search(q, { limit }, http, key) {
    const d: any = await http.json(`https://api.unsplash.com/search/photos?${new URLSearchParams({ query: q, per_page: String(Math.min(30, limit)), content_filter: "high" })}`, { headers: unsplashHeaders(key) });
    return (d.results ?? []).map(unsplashItem).filter(Boolean);
  },
  async item(id, http, key) {
    return requiredItem(unsplashItem(await http.json(`https://api.unsplash.com/photos/${simpleId(id)}`, { headers: unsplashHeaders(key), cache: false })), "unsplash");
  },
  async beforeDownload(item, http, key) {
    // Required by Unsplash's API guidelines; never send the key to a returned arbitrary URL.
    await http.json(`https://api.unsplash.com/photos/${simpleId(item.id)}/download`, { headers: unsplashHeaders(key), cache: false });
  },
};

const COVERR = ["cdn.coverr.co", "storage.coverr.co"];
function coverrItem(x: any): ArchiveItem | null {
  if (!x?.id) return null;
  return stockItem("coverr", x.id, "video", x, {
    title: x.title || `Coverr ${x.id}`, creator: "Coverr", landingUrl: `https://coverr.co/videos/${encodeURIComponent(x.base_filename || x.id)}`,
    fileUrl: safeUrl(x.urls?.mp4, COVERR), previewUrl: x.thumbnail, rendition: "mp4-1080p",
    renditions: Object.entries(x.urls ?? {}).flatMap(([id, url]) => safeUrl(url, COVERR) ? [{ id, fileUrl: String(url), mime: id.includes("mp4") ? "video/mp4" : undefined, label: id }] : []),
    durationSeconds: positive(x.duration), licence: platform("coverr", "https://coverr.co/license"),
  });
}
const coverrHeaders = (key?: string) => ({ Authorization: `Bearer ${requiredKey(key, "coverr")}` });
export const coverr: Provider = {
  id: "coverr", label: "Coverr", keyEnv: "COVERR_KEY", mediaTypes: ["video"], downloadHosts: COVERR,
  async search(q, { limit }, http, key) {
    const d: any = await http.json(`https://api.coverr.co/videos?${new URLSearchParams({ query: q, page: "0", page_size: String(limit), urls: "true" })}`, { headers: coverrHeaders(key) });
    return (d.hits ?? []).map(coverrItem).filter(Boolean);
  },
  async item(id, http, key) {
    return requiredItem(coverrItem(await http.json(`https://api.coverr.co/videos/${simpleId(id)}?urls=true`, { cache: false, headers: coverrHeaders(key) })), "coverr");
  },
  async beforeDownload(item, http, key) {
    if (!http.notify) throw new Error("Coverr requires download tracking support");
    await http.notify(`https://api.coverr.co/videos/${simpleId(item.id)}/stats/downloads`, { method: "PATCH", headers: coverrHeaders(key) });
  },
};
