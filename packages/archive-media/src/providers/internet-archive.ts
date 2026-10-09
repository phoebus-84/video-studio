// The Internet Archive: films, recordings and pictures, each item stating its
// licence in `licenseurl`. Items without one are `unknown`. The file is the
// item's own original (source: original), never a derivative.

import { ArchiveError } from "../errors.js";
import { licenceFromUrl, unknownLicence } from "../licence.js";
import { creditLine } from "../text.js";
import type { ArchiveItem, Http, MediaType, Provider } from "../types.js";

const MEDIATYPE: Record<MediaType, string> = { image: "image", audio: "audio", video: "movies" };
const FROM_MEDIATYPE: Record<string, MediaType> = { image: "image", audio: "audio", movies: "video" };
const EXTENSIONS: Record<MediaType, RegExp> = {
  image: /\.(jpe?g|png|tiff?|webp)$/i,
  audio: /\.(flac|wav|mp3|ogg|m4a)$/i,
  video: /\.(mp4|mov|mkv|webm|mpe?g|avi|ogv)$/i,
};

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** The item's best original file of its kind: the largest. */
export function originalFile(files: any[], mediaType: MediaType): any | undefined {
  return files
    .filter((f) => f?.source === "original" && EXTENSIONS[mediaType].test(String(f.name)))
    .sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
}

function base(doc: any, mediaType: MediaType): Omit<ArchiveItem, "fileUrl" | "raw"> {
  const licenceUrl = first(doc.licenseurl);
  const statement = licenceUrl ? `licenseurl: ${licenceUrl}` : "no licenseurl";
  const licence = licenceFromUrl(licenceUrl, statement) ?? unknownLicence(statement);
  const title = String(first(doc.title) ?? doc.identifier);
  const creator = first(doc.creator) || undefined;
  const date = first(doc.date) ? String(first(doc.date)).slice(0, 10) : undefined;
  return {
    provider: "internet-archive",
    id: String(doc.identifier),
    mediaType,
    title,
    ...(creator ? { creator } : {}),
    ...(date ? { date } : {}),
    institution: "Internet Archive",
    landingUrl: `https://archive.org/details/${doc.identifier}`,
    previewUrl: `https://archive.org/services/img/${doc.identifier}`,
    licence,
    attribution: creditLine({ title, creator, date, institution: "Internet Archive", licence: licence.id === "public-domain" ? "Public domain" : licence.id, licenceUrl: licence.url }),
  };
}

export const internetArchive: Provider = {
  id: "internet-archive",
  label: "Internet Archive",
  mediaTypes: ["video", "audio", "image"],
  async search(query, { mediaType, limit }, http: Http) {
    const params = new URLSearchParams({ q: `(${query}) AND mediatype:${MEDIATYPE[mediaType]} AND licenseurl:*`, rows: String(limit), output: "json" });
    for (const f of ["identifier", "title", "creator", "date", "licenseurl"]) params.append("fl[]", f);
    const body: any = await http.json(`https://archive.org/advancedsearch.php?${params}`);
    return (body?.response?.docs ?? []).filter((d: any) => d?.identifier).map((d: any) => ({ ...base(d, mediaType), fileUrl: "", raw: d }));
  },
  async item(id, http) {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new ArchiveError("not-found", `"${id}" is not an Internet Archive identifier`);
    const body: any = await http.json(`https://archive.org/metadata/${id}`, { cache: false });
    if (!body?.metadata?.identifier) throw new ArchiveError("not-found", `the Internet Archive has no ${id}`);
    const mediaType = FROM_MEDIATYPE[String(body.metadata.mediatype)];
    if (!mediaType) throw new ArchiveError("no-file", `${id} is a ${body.metadata.mediatype}, not a picture, sound or video`);
    const file = originalFile(body.files ?? [], mediaType);
    if (!file) throw new ArchiveError("no-file", `${id} has no original ${mediaType} file`);
    const width = Number(file.width) || undefined;
    const height = Number(file.height) || undefined;
    const length = Number(file.length) || undefined;
    return {
      ...base(body.metadata, mediaType),
      fileUrl: `https://archive.org/download/${id}/${String(file.name).split("/").map(encodeURIComponent).join("/")}`,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(Number(file.size) ? { bytes: Number(file.size) } : {}),
      ...(length ? { durationSeconds: length } : {}),
      raw: { metadata: body.metadata, file },
    };
  },
};
