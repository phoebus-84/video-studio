import { ArchiveError } from "../errors.js";
import { MAPILLARY_CDN as CDN, MAPILLARY_GRAPH as GRAPH, MAPILLARY_LICENCE as licence } from "../mapillary-api.js";
import type { ArchiveItem, Provider } from "../types.js";
import { requiredItem, requiredKey, safeUrl } from "./stock-common.js";

const FIELDS = "id,sequence,captured_at,compass_angle,computed_compass_angle,computed_geometry,geometry,is_pano,creator,camera_type,width,height,quality_score,thumb_original_url";
function creator(x: any) { return x?.creator?.username || x?.creator?.name || "Mapillary contributor"; }
function item(x: any): ArchiveItem | null {
  if (!x?.id) return null;
  const fileUrl = safeUrl(x.thumb_original_url, CDN);
  if (!fileUrl) return null;
  const who = creator(x);
  return {
    provider: "mapillary", id: String(x.id), mediaType: "image", title: `Mapillary image ${x.id}`, creator: who,
    date: x.captured_at ? new Date(Number(x.captured_at)).toISOString().slice(0, 10) : undefined,
    institution: "Mapillary", landingUrl: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(x.id)}`,
    fileUrl, rendition: "thumb_original_url (best image rendition exposed by Mapillary Graph API)",
    width: Number(x.width) || undefined, height: Number(x.height) || undefined, licence,
    attribution: `Mapillary · ${who} · CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)`, raw: x,
  };
}
function box(lat: number, lng: number, radius = 150) {
  const dlat = radius / 110540, dlng = radius / (111320 * Math.cos(lat * Math.PI / 180));
  return `${lng - dlng},${lat - dlat},${lng + dlng},${lat + dlat}`;
}
async function coordinates(query: string, http: Parameters<Provider["item"]>[1]): Promise<[number, number]> {
  const direct = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query);
  if (direct) return [Number(direct[1]), Number(direct[2])];
  const d: any = await http.json(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: query, format: "json", limit: "1" })}`);
  if (!d?.[0]) throw new ArchiveError("not-found", `Place not found: ${query}`);
  return [Number(d[0].lat), Number(d[0].lon)];
}
export const mapillary: Provider = {
  id: "mapillary", label: "Mapillary", keyEnv: "MAPILLARY_TOKEN", mediaTypes: ["image"], downloadHosts: CDN,
  async search(query, { limit }, http, key) {
    const [lat, lng] = await coordinates(query, http);
    const token = requiredKey(key, "mapillary");
    const d: any = await http.json(`${GRAPH}/images?${new URLSearchParams({ bbox: box(lat, lng), fields: FIELDS, limit: String(Math.min(100, Math.max(limit * 4, 20))), access_token: token })}`);
    const rows = (d?.data ?? []).map(item).filter((x: ArchiveItem | null): x is ArchiveItem => !!x);
    rows.sort((a: ArchiveItem, b: ArchiveItem) => Number((b.raw as any).quality_score ?? 0) - Number((a.raw as any).quality_score ?? 0));
    return rows.slice(0, limit);
  },
  async item(id, http, key) {
    if (!/^\d+$/.test(id)) throw new ArchiveError("not-found", "Mapillary image id must be numeric");
    const d: any = await http.json(`${GRAPH}/${id}?${new URLSearchParams({ fields: FIELDS, access_token: requiredKey(key, "mapillary") })}`, { cache: false });
    return requiredItem(item(d), "mapillary");
  },
};

export const mapillaryInternals = { GRAPH, FIELDS, CDN, box, coordinates, creator, licence };
