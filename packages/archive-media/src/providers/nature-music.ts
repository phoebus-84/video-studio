import { licenceFromUrl, unknownLicence } from "../licence.js";
import type { ArchiveItem, Provider } from "../types.js";
import { licensed, positive, requiredItem, requiredKey, safeUrl, simpleId, stockItem } from "./stock-common.js";

const INAT = "https://api.inaturalist.org/v1/observations";
const INAT_HOSTS = ["static.inaturalist.org", "inaturalist-open-data.s3.amazonaws.com"];
function natureItem(obs: any, photo: any): ArchiveItem | null {
  if (!obs?.id || !photo?.id || photo.hidden || photo.flags?.length) return null;
  const code = String(photo.license_code ?? "");
  if (!/^(cc0|cc-by(?:-nc)?(?:-sa|-nd)?)$/.test(code)) return null;
  const url = safeUrl(photo.url, INAT_HOSTS);
  if (!url) return null;
  const u = new URL(url);
  if (u.search || u.hash) return null;
  const m = /^\/photos\/(\d+)\/(square|thumb|small|medium|large|original)\.(jpg|jpeg|png|gif)$/.exec(u.pathname);
  if (!m || m[1] !== String(photo.id)) return null;
  // iNaturalist's photo license_code has no version: preserve that fact instead of fabricating 4.0.
  const licence = code === "cc0" ? licensed("https://creativecommons.org/publicdomain/zero/1.0/") : {
    id: `CC-${code.slice(3).toUpperCase()}`, url: `https://creativecommons.org/licenses/${code.slice(3)}/`,
    attributionRequired: true, statement: `Photo license_code: ${code}; version not supplied by iNaturalist`,
  };
  return stockItem("inaturalist", `${obs.id}.${photo.id}`, "image", { observation: obs, photo }, {
    title: obs.taxon?.preferred_common_name || obs.taxon?.name || obs.species_guess || "Nature observation",
    creator: photo.attribution || obs.user?.name || obs.user?.login,
    landingUrl: `https://www.inaturalist.org/photos/${photo.id}`,
    fileUrl: `${u.origin}/photos/${photo.id}/original.${m[3]}`, previewUrl: `${u.origin}/photos/${photo.id}/medium.${m[3]}`,
    licence,
  });
}
export const inaturalist: Provider = {
  id: "inaturalist", label: "iNaturalist", mediaTypes: ["image"], downloadHosts: INAT_HOSTS,
  async search(q, { limit }, http) {
    const d: any = await http.json(`${INAT}?${new URLSearchParams({ q, photos: "true", per_page: String(limit) })}`);
    const items: ArchiveItem[] = [];
    const seen = new Set<string>();
    for (const obs of d.results ?? []) for (const photo of obs.photos ?? []) {
      const item = natureItem(obs, photo);
      if (item && !seen.has(String(photo.id))) { seen.add(String(photo.id)); items.push(item); }
    }
    return items.slice(0, limit);
  },
  async item(id, http) {
    const m = /^([1-9][0-9]*)\.([1-9][0-9]*)$/.exec(id);
    if (!m) return requiredItem(null, "inaturalist");
    const d: any = await http.json(`${INAT}/${m[1]}`, { cache: false });
    const obs = d.results?.find((o: any) => String(o.id) === m[1]);
    return requiredItem(natureItem(obs, obs?.photos?.find((p: any) => String(p.id) === m[2])), "inaturalist");
  },
};

const JAMENDO_HOSTS = ["storage.jamendo.com", ".jamendo.com"];
function jamendoItem(x: any): ArchiveItem | null {
  // A streaming URL is not permission to download. Require explicit download permission.
  if (!x?.id || x.audiodownload_allowed !== true) return null;
  return stockItem("jamendo", x.id, "audio", x, {
    title: x.name || `Jamendo ${x.id}`, creator: x.artist_name, landingUrl: x.shareurl || `https://www.jamendo.com/track/${x.id}`,
    fileUrl: safeUrl(x.audiodownload, JAMENDO_HOSTS), previewUrl: x.image, durationSeconds: positive(x.duration),
    licence: licensed(x.license_ccurl), rendition: "download-mp3",
  });
}
export const jamendo: Provider = {
  id: "jamendo", label: "Jamendo", keyEnv: "JAMENDO_CLIENT_ID", mediaTypes: ["audio"], downloadHosts: JAMENDO_HOSTS,
  async search(q, { limit }, http, key) {
    const d: any = await http.json(`https://api.jamendo.com/v3.0/tracks/?${new URLSearchParams({ client_id: requiredKey(key, "jamendo"), format: "json", audioformat: "mp32", include: "licenses", search: q, limit: String(limit) })}`);
    if (d.headers?.status !== "success") throw new Error("Jamendo API error status");
    return (d.results ?? []).map(jamendoItem).filter(Boolean);
  },
  async item(id, http, key) {
    const d: any = await http.json(`https://api.jamendo.com/v3.0/tracks/?${new URLSearchParams({ client_id: requiredKey(key, "jamendo"), format: "json", audioformat: "mp32", include: "licenses", id: simpleId(id) })}`, { cache: false });
    if (d.headers?.status !== "success") throw new Error("Jamendo API error status");
    return requiredItem(jamendoItem(d.results?.find((x: any) => String(x.id) === id)), "jamendo");
  },
};

const CCM_HOSTS = ["ccmixter.org", ".ccmixter.org"];
function mixterItem(x: any): ArchiveItem | null {
  const file = x?.files?.find((f: any) => f.file_format_info?.mime_type === "audio/mpeg" && safeUrl(f.download_url, CCM_HOSTS));
  if (!x?.upload_id || !file) return null;
  return stockItem("ccmixter", x.upload_id, "audio", x, {
    title: x.upload_name || String(x.upload_id), creator: x.user_name, landingUrl: x.file_page_url || "https://ccmixter.org",
    fileUrl: safeUrl(file.download_url, CCM_HOSTS), bytes: positive(file.file_rawsize),
    fileHeaders: { Referer: "https://ccmixter.org/" },
    licence: licenceFromUrl(x.license_url) ?? unknownLicence(x.license_url ?? ""),
  });
}
export const ccmixter: Provider = {
  id: "ccmixter", label: "ccMixter", mediaTypes: ["audio"], downloadHosts: CCM_HOSTS,
  async search(q, { limit }, http) {
    const d: any = await http.json(`https://ccmixter.org/api/query?${new URLSearchParams({ f: "json", search: q, limit: String(Math.min(20, limit)), sort: "rank" })}`);
    return (Array.isArray(d) ? d : []).map(mixterItem).filter((x): x is ArchiveItem => x !== null);
  },
  async item(id, http) {
    const d: any = await http.json(`https://ccmixter.org/api/query?${new URLSearchParams({ f: "json", ids: simpleId(id) })}`, { cache: false });
    return requiredItem(mixterItem(Array.isArray(d) ? d.find((x: any) => String(x.upload_id) === id) : null), "ccmixter");
  },
};
