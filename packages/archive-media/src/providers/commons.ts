// Wikimedia Commons: pictures, sounds and videos, each file page stating its
// licence in `extmetadata` (License, LicenseShortName, LicenseUrl).

import { ArchiveError } from "../errors.js";
import { licenceFromName, licenceFromUrl, unknownLicence } from "../licence.js";
import { creditLine, plainText } from "../text.js";
import type { ArchiveItem, Http, MediaType, Provider } from "../types.js";

const API = "https://commons.wikimedia.org/w/api.php";
const FIELDS = "LicenseShortName|License|LicenseUrl|Artist|Credit|AttributionRequired|Copyrighted|ObjectName|DateTimeOriginal|UsageTerms";
const FILETYPE: Record<MediaType, string> = { image: "bitmap", audio: "audio", video: "video" };

const base = (extra: Record<string, string>) =>
  `${API}?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "imageinfo", iiprop: "url|size|mime|extmetadata|mediatype", iiurlwidth: "640", iiextmetadatafilter: FIELDS, ...extra })}`;

function mediaTypeOf(mime: string | undefined): MediaType | null {
  if (!mime) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || mime === "application/ogg") return "audio";
  if (mime.startsWith("video/")) return "video";
  return null;
}

/** The original file's URL, without the tracking query Commons appends. */
const clean = (url: string) => url.replace(/\?utm_[^#]*$/, "");

function toItem(page: any): ArchiveItem | null {
  const info = page?.imageinfo?.[0];
  if (!info?.url) return null;
  const mediaType = mediaTypeOf(info.mime);
  if (!mediaType) return null;
  const meta: Record<string, { value?: string }> = info.extmetadata ?? {};
  const value = (k: string) => (typeof meta[k]?.value === "string" ? meta[k]!.value : undefined);
  const statement = [value("LicenseShortName"), value("LicenseUrl")].filter(Boolean).join(", ");
  const licence = licenceFromUrl(value("LicenseUrl"), statement)
    ?? licenceFromName(value("License"), statement)
    ?? licenceFromName(value("LicenseShortName"), statement)
    ?? unknownLicence(statement);
  if (licence.id === "public-domain" && licence.basis && /^pd$/i.test(licence.basis)) licence.basis = `commons: ${plainText(value("UsageTerms")) ?? "Public domain"}`;
  const fileName = String(page.title).replace(/^File:/, "");
  const title = plainText(value("ObjectName")) ?? fileName.replace(/\.[a-z0-9]+$/i, "");
  const creator = plainText(value("Artist"));
  const date = plainText(value("DateTimeOriginal"));
  const institution = plainText(value("Credit"));
  const duration = Number(info.duration);
  return {
    provider: "commons",
    id: page.title,
    mediaType,
    title,
    ...(creator ? { creator } : {}),
    ...(date ? { date } : {}),
    ...(institution ? { institution } : {}),
    landingUrl: info.descriptionurl,
    fileUrl: clean(info.url),
    ...(info.thumburl ? { previewUrl: clean(info.thumburl) } : {}),
    mime: info.mime,
    ...(info.width ? { width: info.width, height: info.height } : {}),
    ...(info.size ? { bytes: info.size } : {}),
    ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}),
    licence,
    attribution: creditLine({ title, creator, date, institution: "Wikimedia Commons", licence: licence.id === "public-domain" ? "Public domain" : licence.id, licenceUrl: licence.url }),
    raw: page,
  };
}

export const commons: Provider = {
  id: "commons",
  label: "Wikimedia Commons",
  mediaTypes: ["image", "audio", "video"],
  async search(query, { mediaType, limit }, http: Http) {
    const body: any = await http.json(base({ generator: "search", gsrsearch: `${query} filetype:${FILETYPE[mediaType]}`, gsrnamespace: "6", gsrlimit: String(limit) }));
    const pages: any[] = body?.query?.pages ?? [];
    return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(toItem).filter((i): i is ArchiveItem => i !== null && i.mediaType === mediaType);
  },
  async item(id, http) {
    const title = id.startsWith("File:") ? id : `File:${id}`;
    const body: any = await http.json(base({ titles: title }), { cache: false });
    const page = body?.query?.pages?.[0];
    if (!page || page.missing) throw new ArchiveError("not-found", `Commons has no ${title}`);
    const item = toItem(page);
    if (!item) throw new ArchiveError("bad-response", `Commons' ${title} is not a picture, sound or video`);
    return item;
  },
};
