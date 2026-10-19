// Open fonts from Fontsource: every Google Font and a hundred others, each
// with its licence as the family states it (nearly all OFL 1.1). One family is
// one candidate; the default is its regular face as WOFF2, and every other
// weight and style, and the TTF of each, are renditions.

import type { ArchiveItem, ArchiveRendition, Provider } from "../types.js";
import { requiredItem, safeUrl, simpleId, softwareLicence, stockItem } from "./stock-common.js";
import { licenceFromName, unknownLicence } from "../licence.js";

const API = "https://api.fontsource.org/v1/fonts";
const HOSTS = ["cdn.jsdelivr.net"];
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/[^a-z0-9]+/).filter(Boolean);
/** Italian words for a family's category. */
const CATEGORY: Record<string, string> = {
  graziato: "serif", graziati: "serif", bastoni: "sans-serif", lineare: "sans-serif", corsivo: "handwriting", calligrafico: "handwriting",
  scritto: "handwriting", mano: "handwriting", titoli: "display", titolo: "display", monospaziato: "monospace", codice: "monospace",
  serif: "serif", sans: "sans-serif", handwriting: "handwriting", script: "handwriting", display: "display", mono: "monospace", monospace: "monospace",
};

function fontLicence(spdx: string | undefined) {
  return softwareLicence(spdx) ?? licenceFromName(spdx) ?? unknownLicence(`Fontsource licence: ${spdx || "not supplied"}`);
}

function fontItem(f: any): ArchiveItem | null {
  if (typeof f?.id !== "string" || !/^[a-z0-9-]+$/.test(f.id)) return null;
  const subset = f.subsets?.includes("latin") ? "latin" : f.defSubset;
  const renditions: ArchiveRendition[] = [];
  for (const [weight, styles] of Object.entries<any>(f.variants ?? {})) {
    for (const [style, subsets] of Object.entries<any>(styles ?? {})) {
      const url = subsets?.[subset]?.url ?? {};
      const woff2 = safeUrl(url.woff2, HOSTS);
      const ttf = safeUrl(url.ttf, HOSTS);
      if (woff2) renditions.push({ id: `${weight}-${style}`, fileUrl: woff2, mime: "font/woff2", label: `${f.family} ${weight} ${style} (${subset}, WOFF2)` });
      if (ttf) renditions.push({ id: `${weight}-${style}-ttf`, fileUrl: ttf, mime: "font/ttf", label: `${f.family} ${weight} ${style} (${subset}, TTF)` });
    }
  }
  const first = renditions.find((r) => r.id === "400-normal") ?? renditions.find((r) => r.mime === "font/woff2");
  return stockItem("fontsource", f.id, "font", f, {
    title: `${f.family} (${f.category ?? "font"})`, creator: f.family, institution: "Fontsource",
    landingUrl: `https://fontsource.org/fonts/${f.id}`, fileUrl: first?.fileUrl ?? "",
    ...(first ? { rendition: first.label, mime: first.mime } : {}), ...(renditions.length > 1 ? { renditions } : {}),
    licence: fontLicence(f.license),
  });
}

export const fontsource: Provider = {
  id: "fontsource", label: "Fontsource", mediaTypes: ["font"], downloadHosts: HOSTS,
  async search(q, { limit }, http) {
    const list: any = await http.json(API);
    const wanted = words(q);
    const categories = new Set(wanted.map((w) => CATEGORY[w]).filter(Boolean));
    const names = wanted.filter((w) => !CATEGORY[w]);
    const rows = (Array.isArray(list) ? list : [])
      .filter((f: any) => typeof f?.id === "string" && (!categories.size || categories.has(f.category)))
      .map((f: any) => {
        const hay = words(`${f.family} ${f.id}`);
        return { f, score: names.length ? names.filter((w) => hay.some((h) => h.startsWith(w))).length / names.length : 1 };
      })
      .filter((x: { score: number }) => x.score > 0)
      .sort((a: any, b: any) => b.score - a.score || Number(b.f.type === "google") - Number(a.f.type === "google"));
    // The list names weights and styles, not files: the CDN's pattern shows them; `item` reads the real ones at fetch time.
    return rows.slice(0, limit).map(({ f }: any) => fontItem({ ...f, variants: Object.fromEntries((f.weights ?? []).map((w: number) => [w, Object.fromEntries((f.styles ?? []).map((st: string) => {
      const subset = f.subsets?.includes("latin") ? "latin" : f.defSubset;
      const base = `https://cdn.jsdelivr.net/fontsource/fonts/${f.id}@latest/${subset}-${w}-${st}`;
      return [st, { [subset]: { url: { woff2: `${base}.woff2`, ttf: `${base}.ttf` } } }];
    }))])) })).filter((x: ArchiveItem | null): x is ArchiveItem => !!x);
  },
  async item(id, http) {
    return requiredItem(fontItem(await http.json(`${API}/${simpleId(id)}`, { cache: false })), "fontsource");
  },
};
