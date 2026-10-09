// The NASA Image and Video Library. NASA's media are generally not
// copyrighted in the United States (NASA media usage guidelines), but some
// items are third parties': an item whose text mentions a copyright is
// `unknown`, never assumed free. Its original file is listed by the asset
// manifest (~orig).

import { ArchiveError } from "../errors.js";
import { unknownLicence } from "../licence.js";
import { creditLine } from "../text.js";
import type { ArchiveItem, Http, MediaType, Provider } from "../types.js";

const API = "https://images-api.nasa.gov";
const GUIDELINES = "https://www.nasa.gov/nasa-brand-center/images-and-media/";

function toItem(entry: any, fileUrl = ""): ArchiveItem | null {
  const data = entry?.data?.[0];
  if (!data?.nasa_id || !["image", "video", "audio"].includes(data.media_type)) return null;
  const text = [data.description, data.title, data.photographer, data.secondary_creator, ...(data.keywords ?? [])].filter(Boolean).join(" ");
  const thirdParty = /©|copyright|\(c\)\s*\d{4}/i.test(text);
  const statement = thirdParty ? "NASA media guidelines; the item mentions a copyright" : "NASA media guidelines: not copyrighted in the US unless noted";
  const licence = thirdParty ? unknownLicence(statement) : { id: "public-domain", basis: "NASA media guidelines", url: GUIDELINES, attributionRequired: false, statement };
  const title = String(data.title ?? data.nasa_id);
  const creator = data.photographer || data.secondary_creator || data.center || undefined;
  const date = typeof data.date_created === "string" ? data.date_created.slice(0, 10) : undefined;
  const preview = (entry.links ?? []).find((l: any) => l.rel === "preview")?.href;
  const canonical = (entry.links ?? []).find((l: any) => l.rel === "canonical")?.href;
  return {
    provider: "nasa",
    id: data.nasa_id,
    mediaType: data.media_type as MediaType,
    title,
    ...(creator ? { creator } : {}),
    ...(date ? { date } : {}),
    institution: "NASA",
    landingUrl: `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
    fileUrl: fileUrl || canonical || "",
    ...(preview ? { previewUrl: preview } : {}),
    licence,
    attribution: creditLine({ title, creator, date, institution: "NASA", licence: licence.id === "public-domain" ? "Public domain (NASA)" : "Licence unknown", licenceUrl: licence.url }),
    raw: entry,
  };
}

/** The original among an asset's files: ~orig, else the largest named rendition. */
export function originalOf(hrefs: string[], mediaType: MediaType): string | undefined {
  const https = hrefs.map((h) => h.replace(/^http:/, "https:"));
  const orig = https.find((h) => /~orig\.[a-z0-9]+$/i.test(h));
  if (orig) return orig;
  const order = mediaType === "image" ? ["~large", "~medium"] : mediaType === "video" ? ["~large.mp4", "~medium.mp4"] : ["~128k.mp3"];
  for (const suffix of order) {
    const hit = https.find((h) => h.includes(suffix));
    if (hit) return hit;
  }
  return undefined;
}

export const nasa: Provider = {
  id: "nasa",
  label: "NASA Image and Video Library",
  mediaTypes: ["image", "video", "audio"],
  async search(query, { mediaType, limit }, http: Http) {
    const body: any = await http.json(`${API}/search?${new URLSearchParams({ q: query, media_type: mediaType, page_size: String(Math.max(limit, 1)) })}`);
    return (body?.collection?.items ?? []).slice(0, limit).map((e: any) => toItem(e)).filter((i: ArchiveItem | null): i is ArchiveItem => i !== null);
  },
  async item(id, http) {
    const body: any = await http.json(`${API}/search?${new URLSearchParams({ nasa_id: id })}`, { cache: false });
    const entry = (body?.collection?.items ?? []).find((e: any) => e?.data?.[0]?.nasa_id === id);
    const partial = toItem(entry);
    if (!partial) throw new ArchiveError("not-found", `NASA has no ${id}`);
    const asset: any = await http.json(`${API}/asset/${encodeURIComponent(id)}`, { cache: false });
    const file = originalOf((asset?.collection?.items ?? []).map((i: any) => String(i.href)), partial.mediaType);
    if (!file) throw new ArchiveError("no-file", `NASA's ${id} lists no original file`);
    return { ...partial, fileUrl: file, raw: { search: entry, asset } };
  },
};
