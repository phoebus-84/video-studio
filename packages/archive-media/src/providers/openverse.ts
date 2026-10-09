// Openverse: openly licensed pictures and sounds gathered from many sites
// (Flickr, museums, Jamendo…), each with the licence its source states. The
// licence is the source's word: its landing page is where it is verified.

import { ArchiveError } from "../errors.js";
import { licenceFromName, licenceFromUrl, unknownLicence } from "../licence.js";
import { creditLine } from "../text.js";
import type { ArchiveItem, Http, MediaType, Provider } from "../types.js";

const API = "https://api.openverse.org/v1";
const ENDPOINT: Partial<Record<MediaType, string>> = { image: "images", audio: "audio" };

function toItem(result: any, mediaType: MediaType): ArchiveItem | null {
  if (!result?.id || !result.url) return null;
  const statement = [result.license, result.license_version, result.license_url].filter(Boolean).join(" ");
  const named = result.license === "pdm" || result.license === "cc0" ? result.license : result.license && result.license_version ? `${result.license}-${result.license_version}` : undefined;
  const licence = licenceFromUrl(result.license_url, statement) ?? licenceFromName(named, statement) ?? unknownLicence(statement);
  const title = String(result.title || result.id);
  const creator = result.creator || undefined;
  const institution = result.source || result.provider || undefined;
  const duration = Number(result.duration);
  // Openverse hands Freesound's preview MP3, not the original sound: not ours to call an original.
  const previewOnly = String(result.source ?? result.provider ?? "").toLowerCase() === "freesound";
  return {
    provider: "openverse",
    id: `${ENDPOINT[mediaType]}/${result.id}`,
    mediaType,
    title,
    ...(creator ? { creator } : {}),
    ...(institution ? { institution } : {}),
    landingUrl: result.foreign_landing_url || `https://openverse.org/${mediaType}/${result.id}`,
    fileUrl: previewOnly ? "" : result.url,
    ...(result.thumbnail ? { previewUrl: result.thumbnail } : {}),
    ...(result.width ? { width: result.width, height: result.height } : {}),
    ...(result.filesize ? { bytes: result.filesize } : {}),
    ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration / 1000 } : {}),
    licence,
    attribution: creditLine({ title, creator, institution, licence: licence.id === "public-domain" ? "Public domain" : licence.id, licenceUrl: licence.url }),
    raw: result,
  };
}

/** Why fetch would have no file: Openverse's Freesound sounds are previews. */
export const PREVIEW_ONLY_NOTE = "Openverse gives only Freesound's preview: fetch the original from Freesound itself";

export const openverse: Provider = {
  id: "openverse",
  label: "Openverse",
  mediaTypes: ["image", "audio"],
  async search(query, { mediaType, limit }, http: Http) {
    const endpoint = ENDPOINT[mediaType];
    if (!endpoint) return [];
    const body: any = await http.json(`${API}/${endpoint}/?${new URLSearchParams({ q: query, page_size: String(limit) })}`);
    return (body?.results ?? []).map((r: any) => toItem(r, mediaType)).filter((i: ArchiveItem | null): i is ArchiveItem => i !== null);
  },
  async item(id, http) {
    const match = /^(images|audio)\/([0-9a-f-]{36})$/.exec(id);
    if (!match) throw new ArchiveError("not-found", `"${id}" is not an Openverse id (images/<uuid> or audio/<uuid>)`);
    const body = await http.json(`${API}/${match[1]}/${match[2]}/`, { cache: false });
    const item = toItem(body, match[1] === "images" ? "image" : "audio");
    if (!item) throw new ArchiveError("no-file", `Openverse's ${id} has no file`);
    if (!item.fileUrl) throw new ArchiveError("no-file", `Openverse's ${id}: ${PREVIEW_ONLY_NOTE}`);
    return item;
  },
};
