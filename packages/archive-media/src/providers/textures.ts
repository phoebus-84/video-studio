// CC0 textures: Poly Haven (single map files) and ambientCG (each resolution a
// ZIP of maps, from which only the one map asked for is kept). The default is
// the colour map, the one a video shows as a surface or a background; the
// other maps (normal, roughness, displacement…) are renditions, for 3D.

import { ArchiveError } from "../errors.js";
import type { ArchiveItem, ArchiveRendition, Http, Provider } from "../types.js";
import { requiredItem, simpleId, stockItem } from "./stock-common.js";

const CC0 = (statement: string) => ({ id: "CC0-1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/", attributionRequired: false, statement });

// --- Poly Haven ---------------------------------------------------------------
const PH = "https://api.polyhaven.com";
const PH_HOSTS = ["dl.polyhaven.org"];
/** Map keys of /files, in the order their renditions are listed; Diffuse is the default. */
const PH_MAPS = ["Diffuse", "nor_gl", "Rough", "Displacement", "AO", "arm"];
const PH_RES = ["2k", "4k", "8k"];

function polyhavenItem(slug: string, info: any, files?: any): ArchiveItem | null {
  if (!info || (info.type !== 0 && info.type !== 1)) return null; // 2 is a 3D model
  const hdri = info.type === 0;
  const renditions: ArchiveRendition[] = [];
  if (files && hdri) {
    // An HDRI's picture: the tone-mapped JPG of the panorama (the .hdr/.exr are not pictures a video shows).
    const t = files.tonemapped;
    if (typeof t?.url === "string") renditions.push({ id: "tonemapped", fileUrl: t.url, mime: "image/jpeg", ...(t.size ? { bytes: t.size } : {}), label: "tone-mapped panorama JPG" });
  } else if (files) {
    for (const map of PH_MAPS) for (const res of PH_RES) {
      const f = files[map]?.[res]?.jpg ?? files[map]?.[res]?.png;
      if (typeof f?.url === "string") renditions.push({ id: `${map}-${res}`, fileUrl: f.url, ...(f.size ? { bytes: f.size } : {}), label: `${map} ${res}` });
    }
  }
  const first = renditions.find((r) => r.id === "Diffuse-4k") ?? renditions.find((r) => r.id.startsWith("Diffuse-")) ?? renditions[0];
  const authors = Object.keys(info.authors ?? {}).join(", ") || undefined;
  return stockItem("polyhaven", slug, "image", { info, ...(files ? { files } : {}) }, {
    title: `${info.name || slug} (${hdri ? "HDRI" : "texture"})`, ...(authors ? { creator: authors } : {}), institution: "Poly Haven",
    landingUrl: `https://polyhaven.com/a/${slug}`, fileUrl: first?.fileUrl ?? "",
    previewUrl: info.thumbnail_url || `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?width=512&height=512`,
    ...(first ? { rendition: first.label } : {}), ...(renditions.length > 1 ? { renditions } : {}),
    licence: CC0("Poly Haven: all assets CC0 (https://polyhaven.com/license)"),
  });
}

export const polyhaven: Provider = {
  id: "polyhaven", label: "Poly Haven", mediaTypes: ["image"], downloadHosts: PH_HOSTS,
  async search(q, { limit }, http) {
    const [found, all]: any[] = await Promise.all([http.json(`${PH}/search?${new URLSearchParams({ q, limit: String(limit * 2) })}`), http.json(`${PH}/assets?type=all`)]);
    return (found?.results ?? []).map((r: any) => (typeof r?.slug === "string" ? polyhavenItem(r.slug, all?.[r.slug]) : null))
      .filter((x: ArchiveItem | null): x is ArchiveItem => !!x).slice(0, limit);
  },
  async item(id, http) {
    const slug = simpleId(id);
    const [info, files] = await Promise.all([http.json(`${PH}/info/${slug}`, { cache: false }), http.json(`${PH}/files/${slug}`, { cache: false })]);
    const item = polyhavenItem(id, info, files);
    if (item && !item.fileUrl) throw new ArchiveError("no-file", `Poly Haven ${id}: no picture among its files`);
    return requiredItem(item, "polyhaven");
  },
};

// --- ambientCG ------------------------------------------------------------------
const ACG = "https://ambientcg.com/api/v3/assets";
const ACG_HOSTS = ["ambientcg.com", "acg-download.struffelproductions.com"];
const ACG_TYPES = "material,plain-image,decal,atlas";
const ACG_INCLUDE = "type,title,tags,url,thumbnails,downloads";
/** Maps an ambientCG material ZIP holds, by the suffix of the file name; Color is the default. */
const ACG_MAPS = ["Color", "NormalGL", "Roughness", "Displacement", "AmbientOcclusion", "Opacity"];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function ambientItem(x: any): ArchiveItem | null {
  if (typeof x?.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(x.id)) return null;
  const zips = (x.downloads ?? []).filter((d: any) => d?.extension === "zip" && /^\d+K-(JPG|PNG)$/.test(String(d.attributes)) && typeof d.url === "string");
  const plain = x.type === "plain-image";
  const renditions: ArchiveRendition[] = [];
  for (const d of zips) {
    const ext = String(d.attributes).endsWith("PNG") ? "png" : "jpg";
    // A plain image's ZIP holds the picture itself; a material's, one file per map.
    const maps = plain ? [""] : ACG_MAPS;
    for (const map of maps) {
      renditions.push({ id: map ? `${d.attributes}-${map}` : d.attributes, fileUrl: d.url, ...(d.size ? { bytes: d.size } : {}),
        zipEntry: map ? `^${escape(x.id)}_${d.attributes}_${map}\\.${ext}$` : `^${escape(x.id)}[^/]*\\.${ext}$`, label: `${d.attributes}${map ? ` ${map}` : ""}` });
    }
  }
  const order = (id: string) => (/^2K-JPG(-Color)?$/.test(id) ? 0 : /^4K-JPG(-Color)?$/.test(id) ? 1 : /^2K-PNG(-Color)?$/.test(id) ? 2 : 3);
  const first = [...renditions].sort((a, b) => order(a.id) - order(b.id))[0];
  const thumbs = x.thumbnails ?? {};
  return stockItem("ambientcg", x.id, "image", x, {
    title: `${x.title || x.id} (${x.type || "texture"})`, creator: "ambientCG (Lennart Demes)", institution: "ambientCG",
    landingUrl: x.url || `https://ambientcg.com/a/${x.id}`, fileUrl: first?.fileUrl ?? "",
    ...(thumbs["512-PNG"] || thumbs["256-PNG"] ? { previewUrl: thumbs["512-PNG"] || thumbs["256-PNG"] } : {}),
    ...(first ? { rendition: `${first.label}, from its ZIP`, zipEntry: first.zipEntry } : {}), ...(renditions.length > 1 ? { renditions } : {}),
    licence: CC0("ambientCG: all assets CC0 (https://docs.ambientcg.com/license/)"),
  });
}

async function ambientSearch(http: Http, params: Record<string, string>) {
  const d: any = await http.json(`${ACG}?${new URLSearchParams({ include: ACG_INCLUDE, ...params })}`, { cache: !params.id });
  return (d?.assets ?? []).map(ambientItem).filter((x: ArchiveItem | null): x is ArchiveItem => !!x);
}

export const ambientcg: Provider = {
  id: "ambientcg", label: "ambientCG", mediaTypes: ["image"], downloadHosts: ACG_HOSTS,
  search: async (q, { limit }, http) => ambientSearch(http, { q, type: ACG_TYPES, sort: "popular", limit: String(limit) }),
  async item(id, http) {
    const [item] = await ambientSearch(http, { id: simpleId(id) });
    if (item && !item.fileUrl) throw new ArchiveError("no-file", `ambientCG ${id}: no JPG or PNG download`);
    return requiredItem(item ?? null, "ambientcg");
  },
};
