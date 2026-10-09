// Freesound: recorded sounds and ambiences, each with its Creative Commons
// licence (CC0, CC BY, CC BY-NC; Sampling+ is unknown). It needs an API key
// (FREESOUND_API_KEY, free at freesound.org/apiv2/apply). With a key alone the
// file is Freesound's high-quality preview (OGG, about 192 kbps), not the
// uploaded original, which needs a user's OAuth: the item says so in
// `rendition`, and the provenance keeps it.

import { ArchiveError } from "../errors.js";
import { licenceFromUrl, unknownLicence } from "../licence.js";
import { creditLine } from "../text.js";
import type { ArchiveItem, Http, Provider } from "../types.js";

const API = "https://freesound.org/apiv2";
const FIELDS = "id,name,username,license,previews,duration,url,description,created,tags";

function toItem(sound: any): ArchiveItem | null {
  if (!sound?.id || !sound.previews) return null;
  const file = sound.previews["preview-hq-ogg"] ?? sound.previews["preview-hq-mp3"];
  if (!file) return null;
  const statement = `license: ${sound.license ?? "none"}`;
  const licence = licenceFromUrl(sound.license, statement) ?? unknownLicence(statement);
  const title = String(sound.name ?? sound.id);
  const creator = sound.username || undefined;
  const date = typeof sound.created === "string" ? sound.created.slice(0, 10) : undefined;
  const duration = Number(sound.duration);
  return {
    provider: "freesound",
    id: String(sound.id),
    mediaType: "audio",
    title,
    ...(creator ? { creator } : {}),
    ...(date ? { date } : {}),
    institution: "Freesound",
    landingUrl: sound.url || `https://freesound.org/s/${sound.id}/`,
    fileUrl: file,
    previewUrl: sound.previews["preview-lq-mp3"] ?? file,
    mime: String(file).endsWith(".ogg") ? "audio/ogg" : "audio/mpeg",
    ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}),
    rendition: String(file).endsWith(".ogg") ? "preview-hq-ogg" : "preview-hq-mp3",
    licence,
    attribution: creditLine({ title, creator, institution: "Freesound", licence: licence.id === "public-domain" ? "Public domain" : licence.id, licenceUrl: licence.url }),
    raw: sound,
  };
}

export const freesound: Provider = {
  id: "freesound",
  label: "Freesound",
  mediaTypes: ["audio"],
  keyEnv: "FREESOUND_API_KEY",
  async search(query, { limit }, http: Http, key) {
    if (!key) throw new ArchiveError("provider-disabled", "Freesound needs FREESOUND_API_KEY");
    const params = new URLSearchParams({ query, page_size: String(limit), fields: FIELDS, token: key });
    const body: any = await http.json(`${API}/search/text/?${params}`);
    return (body?.results ?? []).map(toItem).filter((i: ArchiveItem | null): i is ArchiveItem => i !== null);
  },
  async item(id, http, key) {
    if (!key) throw new ArchiveError("provider-disabled", "Freesound needs FREESOUND_API_KEY");
    if (!/^\d+$/.test(id)) throw new ArchiveError("not-found", `"${id}" is not a Freesound sound id`);
    const body = await http.json(`${API}/sounds/${id}/?${new URLSearchParams({ fields: FIELDS, token: key })}`, { cache: false });
    const item = toItem(body);
    if (!item) throw new ArchiveError("no-file", `Freesound's ${id} has no preview to fetch`);
    return item;
  },
};
