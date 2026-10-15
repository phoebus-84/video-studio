import { licenceFromUrl } from "../licence.js";
import type { ArchiveItem, Licence, Provider } from "../types.js";
import { platform, requiredItem, safeUrl, stockItem } from "./stock-common.js";

const ICONIFY = "https://api.iconify.design";
const ICON_HOSTS = ["api.iconify.design"];
const SPDX: Record<string, { id: string; url?: string }> = {
  MIT: { id: "provider:mit", url: "https://opensource.org/license/mit" },
  "Apache-2.0": { id: "provider:apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  ISC: { id: "provider:isc", url: "https://opensource.org/license/isc-license-txt" },
  "BSD-3-Clause": { id: "provider:bsd-3-clause", url: "https://opensource.org/license/bsd-3-clause" },
  "OFL-1.1": { id: "provider:ofl-1.1", url: "https://openfontlicense.org" },
};
function iconLicence(info: any): Licence {
  const spdx = String(info?.license?.spdx || info?.license?.title || "");
  const cc = licenceFromUrl(info?.license?.url) ?? licenceFromUrl(`https://creativecommons.org/licenses/${spdx.toLowerCase().replace(/^cc-/, "")}/`);
  if (cc) return cc;
  const known = SPDX[spdx];
  return known ? { ...known, attributionRequired: true, statement: `${spdx}: retain the copyright and licence notice` }
    : { id: "unknown", attributionRequired: true, statement: `Icon set licence: ${spdx || "not supplied"}` };
}
function iconItem(provider: "iconify" | "emoji", prefix: string, name: string, info: any): ArchiveItem | null {
  if (!/^[a-z0-9-]+$/.test(prefix) || !/^[A-Za-z0-9-]+$/.test(name) || !info) return null;
  const id = `${prefix}:${name}`;
  const licence = iconLicence(info);
  const label = info.name || prefix;
  const item = stockItem(provider, id, "image", { collection: info, icon: id }, {
    title: `${label}: ${name}`, creator: info.author?.name || label, institution: label,
    landingUrl: `https://icon-sets.iconify.design/${prefix}/${name}/`,
    fileUrl: `${ICONIFY}/${prefix}/${name}.svg`, previewUrl: `${ICONIFY}/${prefix}/${name}.svg?height=64`,
    // Icons are resolution-independent; 2048 px clears the default quality floor while staying small.
    rendition: "SVG rasterized to a safe 2048px PNG", width: 2048, height: 2048, licence,
  });
  if (/brand|logo/i.test(`${info.category ?? ""} ${prefix}`)) item.attribution += "; trademark rights are separate; no endorsement";
  return item;
}
async function collection(prefix: string, http: Parameters<Provider["item"]>[1]): Promise<any> {
  const d: any = await http.json(`${ICONIFY}/collections?prefix=${encodeURIComponent(prefix)}`, { cache: false });
  return d?.[prefix];
}
const EMOJI_PREFIXES = new Set(["fluent-emoji", "fluent-emoji-flat", "fluent-emoji-high-contrast", "noto", "openmoji"]);
async function iconSearch(provider: "iconify" | "emoji", query: string, limit: number, http: Parameters<Provider["item"]>[1]) {
  const prefixes = provider === "emoji" ? [...EMOJI_PREFIXES].join(",") : "";
  const d: any = await http.json(`${ICONIFY}/search?${new URLSearchParams({ query, limit: String(Math.min(999, Math.max(32, limit * 6))), ...(prefixes ? { prefixes } : {}) })}`);
  const groups = new Map<string, ArchiveItem[]>();
  for (const full of d?.icons ?? []) {
    const [prefix, name] = String(full).split(":");
    if (!prefix || !name || (provider === "emoji" && !EMOJI_PREFIXES.has(prefix))) continue;
    const x = iconItem(provider, prefix, name, d.collections?.[prefix]);
    if (x) groups.set(prefix, [...(groups.get(prefix) ?? []), x]);
  }
  const out: ArchiveItem[] = [];
  while (out.length < limit && [...groups.values()].some((g) => g.length)) for (const group of groups.values()) if (group.length && out.length < limit) out.push(group.shift()!);
  return out;
}
export const iconify: Provider = {
  id: "iconify", label: "Iconify", mediaTypes: ["image"], downloadHosts: ICON_HOSTS,
  search: async (q, { limit }, http) => iconSearch("iconify", q, limit, http),
  async item(id, http) {
    const m = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id);
    return requiredItem(m ? iconItem("iconify", m[1]!, m[2]!, await collection(m[1]!, http)) : null, "iconify");
  },
};

const NOTO = "https://googlefonts.github.io/noto-emoji-animation/data/api.json";
const NOTO_HOSTS = ["fonts.gstatic.com"];
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/[^a-z0-9]+/).filter(Boolean);
const translate: Record<string, string> = { cuore: "heart", razzo: "rocket", risata: "laugh", felice: "happy", triste: "sad", pianto: "cry", fuoco: "fire", stella: "star", cane: "dog", gatto: "cat", sole: "sun", luna: "moon", pioggia: "rain", fulmine: "lightning", idea: "bulb", musica: "music", applauso: "clap" };
function notoAnimated(x: any): ArchiveItem | null {
  const cp = String(x?.codepoint ?? "");
  if (!/^[0-9a-f_]+$/i.test(cp)) return null;
  return stockItem("emoji", `noto-animated:${cp}`, "image", x, {
    title: x.name || `Noto animated emoji ${cp}`, creator: "Google (Noto Emoji)", institution: "Noto Emoji",
    landingUrl: "https://googlefonts.github.io/noto-emoji-animation/",
    fileUrl: `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.webp`,
    previewUrl: `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.gif`, width: 512, height: 512,
    rendition: "animated WebP",
    renditions: [
      { id: "webp", fileUrl: `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.webp`, mime: "image/webp", width: 512, height: 512, label: "animated WebP" },
      { id: "gif", fileUrl: `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.gif`, mime: "image/gif", width: 512, height: 512, label: "animated GIF" },
    ],
    licence: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/", attributionRequired: true, statement: "Noto animated emoji: CC BY 4.0" },
  });
}
export const emoji: Provider = {
  id: "emoji", label: "Fluent, Noto and OpenMoji", mediaTypes: ["image"], downloadHosts: [...ICON_HOSTS, ...NOTO_HOSTS],
  async search(q, { limit }, http) {
    const staticItems = await iconSearch("emoji", q, limit, http);
    const index: any = await http.json(NOTO);
    const wanted = words(q).map((w) => translate[w] ?? w);
    const animated: ArchiveItem[] = (index?.icons ?? []).map(notoAnimated).filter((x: ArchiveItem | null): x is ArchiveItem => !!x)
      .map((item: ArchiveItem) => ({ item, score: wanted.filter((w) => words(`${item.title} ${(item.raw as any)?.tags?.join(" ")}`).some((x: string) => x.startsWith(w))).length }))
      .filter((x: { item: ArchiveItem; score: number }) => x.score > 0)
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, Math.max(1, Math.floor(limit / 3))).map((x: { item: ArchiveItem }) => x.item);
    return [...animated, ...staticItems].slice(0, limit);
  },
  async item(id, http) {
    if (id.startsWith("noto-animated:")) {
      const index: any = await http.json(NOTO, { cache: false });
      return requiredItem(notoAnimated((index?.icons ?? []).find((x: any) => `noto-animated:${x.codepoint}` === id)), "emoji");
    }
    const m = /^([a-z0-9-]+):([A-Za-z0-9-]+)$/.exec(id);
    if (!m || !EMOJI_PREFIXES.has(m[1]!)) return requiredItem(null, "emoji");
    return requiredItem(iconItem("emoji", m[1]!, m[2]!, await collection(m[1]!, http)), "emoji");
  },
};

const LOTTIE = "https://graphql.lottiefiles.com/2022-08";
const LOTTIE_HOSTS = [".lottiefiles.com"];
const fields = "id name slug url jsonUrl gifUrl videoUrl imageUrl downloads likesCount description createdBy { username firstName lastName } metadata { width height duration frameRate }";
function lottieItem(x: any): ArchiveItem | null {
  if (!x?.id) return null;
  const mp4 = safeUrl(x.videoUrl, LOTTIE_HOSTS);
  if (!mp4) return null; // canonical fetch must be a validated media file, never executable/remote-bearing JSON.
  const who = [x.createdBy?.firstName, x.createdBy?.lastName].filter(Boolean).join(" ") || x.createdBy?.username || "LottieFiles creator";
  return stockItem("lottie", String(x.id), "video", x, {
    title: x.name || `Lottie ${x.id}`, creator: who, landingUrl: x.url || `https://lottiefiles.com/animation/${x.id}`,
    fileUrl: mp4, previewUrl: safeUrl(x.imageUrl || x.gifUrl, LOTTIE_HOSTS), rendition: "LottieFiles MP4 rendition",
    renditions: [
      { id: "mp4", fileUrl: mp4, mime: "video/mp4", width: Number(x.metadata?.width) || undefined, height: Number(x.metadata?.height) || undefined, label: "MP4" },
      ...(safeUrl(x.gifUrl, LOTTIE_HOSTS) ? [{ id: "gif", fileUrl: x.gifUrl as string, mediaType: "image" as const, mime: "image/gif", label: "GIF" }] : []),
      ...(safeUrl(x.imageUrl, LOTTIE_HOSTS) ? [{ id: "png", fileUrl: x.imageUrl as string, mediaType: "image" as const, mime: "image/png", label: "PNG still" }] : []),
    ],
    width: Number(x.metadata?.width) || undefined, height: Number(x.metadata?.height) || undefined,
    durationSeconds: Number(x.metadata?.duration) || undefined, licence: platform("lottie", "https://lottiefiles.com/page/license"),
  });
}
async function gql(http: Parameters<Provider["item"]>[1], query: string, variables: object, cache = true) {
  const d: any = await http.json(LOTTIE, { method: "POST", body: { query, variables }, cache });
  if (d?.errors?.length) throw new Error(`LottieFiles: ${d.errors[0]?.message ?? "GraphQL error"}`);
  return d?.data ?? {};
}
export const lottie: Provider = {
  id: "lottie", label: "LottieFiles", mediaTypes: ["video"], downloadHosts: LOTTIE_HOSTS,
  async search(q, { limit }, http) {
    const d = await gql(http, `query($q:String!,$n:Int){searchPublicAnimations(query:$q,first:$n){edges{node{${fields}}}}}`, { q, n: Math.min(60, limit * 3) });
    return (d.searchPublicAnimations?.edges ?? []).map((e: any) => lottieItem(e.node)).filter(Boolean)
      .sort((a: ArchiveItem, b: ArchiveItem) => (((b.raw as any).downloads ?? 0) + 20 * ((b.raw as any).likesCount ?? 0)) - (((a.raw as any).downloads ?? 0) + 20 * ((a.raw as any).likesCount ?? 0))).slice(0, limit);
  },
  async item(id, http) {
    if (!/^\d+$/.test(id)) return requiredItem(null, "lottie");
    const d = await gql(http, `query($id:Int!){publicAnimation(id:$id){${fields}}}`, { id: Number(id) }, false);
    return requiredItem(lottieItem(d.publicAnimation), "lottie");
  },
};
