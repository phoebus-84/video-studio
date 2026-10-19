// Illustrations only: Openverse's illustration category and Wikimedia Commons'
// drawings (mostly SVG), from the same records the openverse and commons
// providers read, interleaved. An SVG is resolution-independent: fetch
// rasterizes it at the quality floor, so its nominal size never refuses it.

import { ArchiveError } from "../errors.js";
import type { ArchiveItem, Provider } from "../types.js";
import { commons, commonsItem, commonsQuery } from "./commons.js";
import { openverse, openverseItem } from "./openverse.js";

const OPENVERSE = "https://api.openverse.org/v1/images/";
const SVG_SIDE = 2048;

function asIllustration(item: ArchiveItem, from: "openverse" | "commons"): ArchiveItem {
  const svg = item.mime === "image/svg+xml" || (item.raw as any)?.filetype === "svg" || /\.svg(?:$|[?#])/i.test(item.fileUrl);
  const long = Math.max(item.width ?? 0, item.height ?? 0);
  const sized = svg && long > 0 ? { width: Math.round((item.width! / long) * SVG_SIDE), height: Math.round((item.height! / long) * SVG_SIDE), rendition: `SVG rasterized to a ${SVG_SIDE}px PNG` } : {};
  return { ...item, provider: "illustrations", id: `${from}:${item.id}`, ...sized };
}

export const illustrations: Provider = {
  id: "illustrations", label: "Illustrations (Openverse, Wikimedia Commons)", mediaTypes: ["image"],
  async search(q, { limit }, http) {
    const [ov, wc]: any[] = await Promise.all([
      http.json(`${OPENVERSE}?${new URLSearchParams({ q, category: "illustration", page_size: String(limit) })}`),
      http.json(commonsQuery({ generator: "search", gsrsearch: `${q} filetype:drawing`, gsrnamespace: "6", gsrlimit: String(limit) })),
    ]);
    const a = (ov?.results ?? []).map((r: any) => openverseItem(r, "image")).filter(Boolean).map((x: ArchiveItem) => asIllustration(x, "openverse"));
    const b = (wc?.query?.pages ?? []).sort((x: any, y: any) => (x.index ?? 0) - (y.index ?? 0)).map(commonsItem)
      .filter((x: ArchiveItem | null): x is ArchiveItem => !!x && x.mediaType === "image").map((x: ArchiveItem) => asIllustration(x, "commons"));
    const out: ArchiveItem[] = [];
    for (let i = 0; out.length < limit && (i < a.length || i < b.length); i++) for (const x of [a[i], b[i]]) if (x && out.length < limit) out.push(x);
    return out;
  },
  async item(id, http) {
    const m = /^(openverse|commons):(.+)$/.exec(id);
    if (!m) throw new ArchiveError("not-found", `"${id}" is not an illustrations id (openverse:images/<uuid> or commons:File:<name>)`);
    const from = m[1] as "openverse" | "commons";
    return asIllustration(await (from === "openverse" ? openverse : commons).item(m[2]!, http), from);
  },
};
