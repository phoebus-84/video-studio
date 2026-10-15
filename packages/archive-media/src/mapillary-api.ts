// Mapillary beyond a single item (CC BY-SA 4.0): the geometry of a sequence,
// the straight runs a hyperlapse needs, coverage around a place, history,
// detected map features, and the best photo near a point. No rendering here:
// this is the data and its licence, shared with the item provider.

import { ArchiveError } from "./errors.js";
import { createHttp, type ArchiveHttp, type HttpOptions } from "./http.js";

export const MAPILLARY_GRAPH = "https://graph.mapillary.com";
export const MAPILLARY_CDN = [".fbcdn.net", ".mapillary.com"];
export const MAPILLARY_LICENCE = {
  id: "CC-BY-SA-4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/", attributionRequired: true,
  statement: "Mapillary imagery: CC BY-SA 4.0; faces and plates are automatically blurred",
} as const;
export const MAPILLARY_RESTRICTIONS =
  'CC BY-SA 4.0: credit "Mapillary · <author>" and share-alike (a derived work stays under the same licence); faces and plates are auto-blurred.';
const IMG_FIELDS = "id,sequence,captured_at,compass_angle,computed_compass_angle,computed_geometry,geometry,is_pano,creator,camera_type,width,height,quality_score";

export interface MapillaryImage {
  id: string;
  sequence?: string;
  captured_at?: number;
  compass_angle?: number;
  computed_compass_angle?: number;
  computed_geometry?: { coordinates: [number, number] };
  geometry?: { coordinates: [number, number] };
  is_pano?: boolean;
  creator?: { username?: string; name?: string };
  width?: number;
  height?: number;
  quality_score?: number;
  thumb_original_url?: string;
  thumb_2048_url?: string;
  [k: string]: unknown;
}
export interface MapillaryRun { from: number; to: number; images: number; meters: number; bearing: number }
export interface MapillaryPlace { lat: number; lng: number; label: string }

export const lngLat = (i: MapillaryImage): [number, number] => (i.computed_geometry ?? i.geometry)!.coordinates;
export function distance(a: MapillaryImage, b: MapillaryImage): number {
  const [x1, y1] = lngLat(a), [x2, y2] = lngLat(b);
  return Math.hypot((x2 - x1) * 111320 * Math.cos((y1 * Math.PI) / 180), (y2 - y1) * 110540);
}
export function bearing(a: MapillaryImage, b: MapillaryImage): number {
  const [x1, y1] = lngLat(a), [x2, y2] = lngLat(b);
  return (Math.atan2((x2 - x1) * Math.cos((y1 * Math.PI) / 180), y2 - y1) * 180 / Math.PI + 360) % 360;
}
export const angleDiff = (x: number, y: number): number => Math.abs((((x - y + 180) % 360) + 360) % 360 - 180);
export const heading = (i: MapillaryImage): number => i.computed_compass_angle ?? i.compass_angle ?? 0;
export const compass = (b: number): string => "N NE E SE S SW W NW".split(" ")[Math.floor(((b + 22.5) % 360) / 45)]!;
export const creatorOf = (i: MapillaryImage): string => i.creator?.username || i.creator?.name || "Mapillary contributor";
export const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Straight, steady stretches: steps 0.8–20 m, direction changes < 35°, flat cameras facing forward. */
export function runs(imgs: MapillaryImage[], { maxTurn = 35, maxGap = 20, minStep = 0.8 } = {}): MapillaryRun[] {
  const out: MapillaryRun[] = [];
  let st = 0;
  for (let k = 1; k <= imgs.length; k++) {
    let ok = k < imgs.length && minStep < distance(imgs[k - 1]!, imgs[k]!) && distance(imgs[k - 1]!, imgs[k]!) < maxGap;
    if (ok && k - st >= 2) ok = angleDiff(bearing(imgs[k - 2]!, imgs[k - 1]!), bearing(imgs[k - 1]!, imgs[k]!)) < maxTurn;
    if (ok && !imgs[k]!.is_pano) ok = angleDiff(heading(imgs[k]!), bearing(imgs[k - 1]!, imgs[k]!)) < 40;
    if (!ok) {
      if (k - 1 - st >= 5) {
        const a = imgs[st]!, b = imgs[k - 1]!;
        let m = 0;
        for (let j = st; j < k - 1; j++) m += distance(imgs[j]!, imgs[j + 1]!);
        out.push({ from: st, to: k - 1, images: k - st, meters: Math.round(m), bearing: Math.round(bearing(a, b)) });
      }
      st = k;
    }
  }
  return out.sort((a, b) => b.images - a.images);
}

export function bbox(lat: number, lng: number, radius = 150): string {
  const dlat = radius / 110540;
  const dlng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  return `${(lng - dlng).toFixed(6)},${(lat - dlat).toFixed(6)},${(lng + dlng).toFixed(6)},${(lat + dlat).toFixed(6)}`;
}

export interface MapillaryOptions extends Omit<HttpOptions, "userAgent"> {
  userAgent: string;
  /** The Mapillary access token; default process.env.MAPILLARY_TOKEN. */
  token?: string;
  env?: Record<string, string | undefined>;
}

export function createMapillary(options: MapillaryOptions) {
  const env = options.env ?? process.env;
  const http: ArchiveHttp = createHttp(options);
  const token = () => {
    const value = options.token ?? env.MAPILLARY_TOKEN;
    if (!value) throw new ArchiveError("provider-disabled", "Mapillary needs MAPILLARY_TOKEN");
    return value;
  };
  async function api(path: string, params: Record<string, string | number | undefined> = {}, cache = true): Promise<any> {
    const query = new URLSearchParams({ access_token: token() });
    for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, String(v));
    const data: any = await http.json(`${MAPILLARY_GRAPH}/${path}?${query}`, { cache });
    if (data && typeof data === "object" && data.error) throw new ArchiveError("bad-response", `Mapillary: ${String(data.error.message).slice(0, 200)}`);
    return data;
  }
  async function place(query: string): Promise<MapillaryPlace> {
    const direct = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query);
    if (direct) return { lat: Number(direct[1]), lng: Number(direct[2]), label: `${direct[1]},${direct[2]}` };
    const d: any = await http.json(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: query, format: "json", limit: "1" })}`);
    if (!d?.[0]) throw new ArchiveError("not-found", `Place not found: ${query}`);
    return { lat: Number(d[0].lat), lng: Number(d[0].lon), label: String(d[0].display_name ?? query).slice(0, 70) };
  }
  async function imagesNear(place: { lat: number; lng: number }, radius: number, extra: Record<string, string | number | undefined> = {}, cache = true): Promise<MapillaryImage[]> {
    const d = await api("images", { bbox: bbox(place.lat, place.lng, radius), fields: IMG_FIELDS, limit: 2000, ...extra }, cache);
    return (d.data ?? []) as MapillaryImage[];
  }
  async function sequence(seq: string): Promise<MapillaryImage[]> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(seq)) throw new ArchiveError("not-found", "Invalid Mapillary sequence id");
    const d = await api("images", { sequence_ids: seq, fields: IMG_FIELDS, limit: 2000 });
    const imgs = (d.data ?? []) as MapillaryImage[];
    if (imgs.length === 0) throw new ArchiveError("not-found", `sequence not found: ${seq}`);
    return imgs.sort((a, b) => (a.captured_at ?? 0) - (b.captured_at ?? 0));
  }
  async function one(id: string, extraFields = ""): Promise<MapillaryImage> {
    if (!/^\d+$/.test(id)) throw new ArchiveError("not-found", "Mapillary image id must be numeric");
    return (await api(id, { fields: `${IMG_FIELDS}${extraFields}` }, false)) as MapillaryImage;
  }
  return {
    http, place, imagesNear, sequence, one,
    /** Sequences around a place, ranked by their longest straight run. */
    async coverage(query: string, opts: { radius?: number; pano?: boolean; since?: number; until?: number; limit?: number } = {}) {
      const where = await place(query);
      const radius = opts.radius ?? 150;
      let imgs = await imagesNear(where, radius, {
        ...(opts.since ? { start_captured_at: `${opts.since}-01-01T00:00:00Z` } : {}),
        ...(opts.until ? { end_captured_at: `${opts.until}-12-31T23:59:59Z` } : {}),
      });
      if (opts.pano !== undefined) imgs = imgs.filter((i) => !!i.is_pano === opts.pano);
      const bySeq = new Map<string, MapillaryImage[]>();
      for (const i of imgs) bySeq.set(String(i.sequence), [...(bySeq.get(String(i.sequence)) ?? []), i]);
      const rows = [...bySeq.entries()].map(([seq, list]) => {
        const sorted = [...list].sort((a, b) => (a.captured_at ?? 0) - (b.captured_at ?? 0));
        const found = runs(sorted);
        const best = found[0] ?? { from: 0, to: 0, images: 0, meters: 0, bearing: 0 };
        const q = sorted.map((i) => i.quality_score).filter((x): x is number => x !== undefined);
        return { ref: `mapillary:seq:${seq}`, sequence: seq, images: sorted.length, pano: !!sorted[0]!.is_pano, date: ymd(sorted[0]!.captured_at ?? 0),
          creator: creatorOf(sorted[0]!), size: `${sorted[0]!.width ?? "?"}x${sorted[0]!.height ?? "?"}`, run: best,
          quality: q.length ? Math.round((q.reduce((a, b) => a + b, 0) / q.length) * 100) / 100 : null };
      }).sort((a, b) => b.run.images - a.run.images || b.images - a.images);
      return { place: where.label, center: [Math.round(where.lat * 1e6) / 1e6, Math.round(where.lng * 1e6) / 1e6] as [number, number], radius, images: imgs.length, sequences: rows.slice(0, opts.limit ?? 10) };
    },
    /** One sequence: length, direction, and its best runs. */
    async coverageOfSequence(seq: string) {
      const list = await sequence(seq);
      const total = list.slice(0, -1).reduce((sum, i, j) => sum + distance(i, list[j + 1]!), 0);
      const first = list[0]!, last = list[list.length - 1]!;
      return { ref: `mapillary:seq:${seq}`, sequence: seq, images: list.length, pano: !!first.is_pano, creator: creatorOf(first),
        from: ymd(first.captured_at ?? 0), meters: Math.round(total), start: [lngLat(first)[1], lngLat(first)[0]] as [number, number],
        end: [lngLat(last)[1], lngLat(last)[0]] as [number, number], runs: runs(list).slice(0, 5),
        page: `https://www.mapillary.com/app/?pKey=${first.id}`, images_raw: list };
    },
    /** The same spot across the years: the closest image per year. */
    async history(query: string, opts: { radius?: number; heading?: number } = {}) {
      const where = await place(query);
      const imgs = await imagesNear(where, opts.radius ?? 150);
      const here = { computed_geometry: { coordinates: [where.lng, where.lat] as [number, number] } } as MapillaryImage;
      const byYear = new Map<number, MapillaryImage[]>();
      for (const i of imgs) {
        if (opts.heading !== undefined && !i.is_pano && angleDiff(heading(i), opts.heading) > 30) continue;
        const year = new Date(i.captured_at ?? 0).getUTCFullYear();
        byYear.set(year, [...(byYear.get(year) ?? []), i]);
      }
      const years = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, list]) => {
        const best = list.reduce((a, b) => (distance(a, here) <= distance(b, here) ? a : b));
        return { year, ref: `mapillary:image:${best.id}`, id: best.id, date: ymd(best.captured_at ?? 0), m: Math.round(distance(best, here)),
          pano: !!best.is_pano, heading: Math.round(heading(best)), creator: creatorOf(best), count: list.length };
      });
      return { place: where.label, years };
    },
    /** Objects and traffic signs detected on the map around a point. */
    async features(query: string, opts: { radius?: number; kind?: "all" | "signs" | "objects"; filter?: string; limit?: number } = {}) {
      const where = await place(query);
      const d = await api("map_features", { bbox: bbox(where.lat, where.lng, Math.min(opts.radius ?? 150, 500)), limit: 2000,
        fields: "id,object_value,object_type,geometry,first_seen_at,last_seen_at" });
      let rows = (d.data ?? []) as any[];
      if (opts.kind === "signs") rows = rows.filter((x) => ["regulatory", "warning", "information", "complementary"].includes(String(x.object_value).split("--")[0]) || String(x.object_value).includes("traffic-sign"));
      else if (opts.kind === "objects") rows = rows.filter((x) => ["object", "marking", "construction", "nature"].includes(String(x.object_value).split("--")[0]));
      if (opts.filter) rows = rows.filter((x) => String(x.object_value).toLowerCase().includes(opts.filter!.toLowerCase()));
      const agg = new Map<string, { count: number; first: string; last: string; id?: string }>();
      for (const x of rows) {
        const g = agg.get(x.object_value) ?? { count: 0, first: "9999", last: "0000" };
        g.count++;
        g.first = [g.first, String(x.first_seen_at ?? "").slice(0, 10)].sort()[0]!;
        g.last = [g.last, String(x.last_seen_at ?? "").slice(0, 10)].sort().reverse()[0]!;
        g.id ??= x.id;
        agg.set(x.object_value, g);
      }
      const values = [...agg.entries()].map(([value, g]) => ({ value, ...g })).sort((a, b) => b.count - a.count);
      return { place: where.label, features: rows.length, values: values.slice(0, opts.limit ?? 10) };
    },
    /** Object classes segmented in one image. */
    async detections(id: string, limit = 10) {
      const d = await api(`${id}/detections`, { fields: "value" });
      const counts = new Map<string, number>();
      for (const x of (d.data ?? []) as any[]) if (!String(x.value).startsWith("void")) counts.set(x.value, (counts.get(x.value) ?? 0) + 1);
      return { ref: `mapillary:image:${id}`, detections: (d.data ?? []).length, values: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit) };
    },
    /** The best single images near a point: closest, then quality. */
    async photo(query: string, opts: { radius?: number; pano?: boolean; heading?: number; since?: number; until?: number; limit?: number } = {}) {
      const where = await place(query);
      const here = { computed_geometry: { coordinates: [where.lng, where.lat] as [number, number] } } as MapillaryImage;
      let imgs = await imagesNear(where, opts.radius ?? 150, {
        ...(opts.since ? { start_captured_at: `${opts.since}-01-01T00:00:00Z` } : {}),
        ...(opts.until ? { end_captured_at: `${opts.until}-12-31T23:59:59Z` } : {}),
      });
      if (opts.pano !== undefined) imgs = imgs.filter((i) => !!i.is_pano === opts.pano);
      if (opts.heading !== undefined) imgs = imgs.filter((i) => i.is_pano || angleDiff(heading(i), opts.heading!) <= 30);
      if (imgs.length === 0) throw new ArchiveError("not-found", "no image here: widen the radius or drop filters");
      imgs.sort((a, b) => (distance(a, here) - 8 * (a.quality_score ?? 0.5) - (a.is_pano ? 3 : 0)) - (distance(b, here) - 8 * (b.quality_score ?? 0.5) - (b.is_pano ? 3 : 0)));
      return { place: where.label, photos: imgs.slice(0, opts.limit ?? 10).map((i) => ({ ref: `mapillary:image:${i.id}`, id: i.id, date: ymd(i.captured_at ?? 0),
        pano: !!i.is_pano, heading: Math.round(heading(i)), size: `${i.width ?? "?"}x${i.height ?? "?"}`, creator: creatorOf(i), q: i.quality_score })), images_raw: imgs };
    },
    /** The URL of the best still for an image: original for panoramas, 2048 otherwise. */
    async still(image: MapillaryImage, pano = !!image.is_pano): Promise<string> {
      const field = pano ? "thumb_original_url" : "thumb_2048_url";
      if (image[field]) return String(image[field]);
      const again = await one(image.id, ",thumb_original_url,thumb_2048_url");
      const url = again[field] ?? again.thumb_original_url;
      if (!url) throw new ArchiveError("no-file", `Mapillary image ${image.id} names no file`);
      return String(url);
    },
    /** Batch of image URLs for a sequence, in the order given. */
    async stills(ids: string[], pano: boolean): Promise<Map<string, string>> {
      const field = pano ? "thumb_original_url" : "thumb_2048_url";
      const out = new Map<string, string>();
      for (let k = 0; k < ids.length; k += 100) {
        const d = await api("images", { image_ids: ids.slice(k, k + 100).join(","), fields: `id,${field}`, limit: 100 }, false);
        for (const x of (d.data ?? []) as any[]) if (x[field]) out.set(String(x.id), String(x[field]));
      }
      return out;
    },
    /** Download one Mapillary CDN file, refusing any other host. */
    download: (url: string, dest: string) => http.download(url, dest, { allowedHosts: MAPILLARY_CDN }),
  };
}
export type Mapillary = ReturnType<typeof createMapillary>;
