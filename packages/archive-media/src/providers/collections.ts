import { ArchiveError } from "../errors.js";
import { licenceFromName, licenceFromUrl, unknownLicence } from "../licence.js";
import type { ArchiveItem, Provider } from "../types.js";
import { licensed, positive, requiredItem, requiredKey, safeUrl, simpleId, stockItem } from "./stock-common.js";

const SI = "https://api.si.edu/openaccess/api/v1.0/";
const SI_HOSTS = ["ids.si.edu", "smithsonian-open-access.s3-us-west-2.amazonaws.com"];
function smithsonianItem(row: any): ArchiveItem | null {
  if (!row?.id) return null;
  const d = row.content?.descriptiveNonRepeating ?? {};
  const media = (d.online_media?.media ?? []).find((m: any) => m.type === "Images" && m.usage?.access === "CC0");
  if (!media) return null;
  const hi = (media.resources ?? []).find((r: any) => r.label === "High-resolution JPEG");
  return stockItem("smithsonian", row.id, "image", row, {
    title: row.title || d.title?.content || row.id, creator: row.content?.freetext?.name?.[0]?.content || d.data_source,
    landingUrl: d.record_link || d.guid || "https://www.si.edu/openaccess",
    fileUrl: safeUrl(hi?.url || media.content, SI_HOSTS), previewUrl: media.thumbnail,
    width: positive(hi?.width), height: positive(hi?.height),
    licence: licensed("https://creativecommons.org/publicdomain/zero/1.0/"),
  });
}
export const smithsonian: Provider = {
  id: "smithsonian", label: "Smithsonian Open Access", keyEnv: "SMITHSONIAN_KEY", mediaTypes: ["image"], downloadHosts: SI_HOSTS,
  async search(q, { limit }, http, key) {
    const d: any = await http.json(`${SI}search?${new URLSearchParams({ q: `(${q}) AND online_media_type:Images AND media_usage:CC0`, rows: String(limit), api_key: requiredKey(key, "smithsonian") })}`);
    return (d.response?.rows ?? []).map(smithsonianItem).filter(Boolean);
  },
  async item(id, http, key) {
    const d: any = await http.json(`${SI}content/${simpleId(id)}?${new URLSearchParams({ api_key: requiredKey(key, "smithsonian") })}`, { cache: false });
    return requiredItem(smithsonianItem(d.response), "smithsonian");
  },
};

const WC = "https://api.wellcomecollection.org/catalogue/v2/images";
const WC_HOSTS = ["iiif.wellcomecollection.org"];
function wellcomeItem(x: any): ArchiveItem | null {
  if (!x?.id) return null;
  const loc = (x.locations ?? []).find((l: any) => safeUrl(l.url, WC_HOSTS).endsWith("/info.json"));
  if (!loc) return null;
  const base = loc.url.slice(0, -10);
  const src = x.source ?? {};
  // Do not invent a CC version from Wellcome's coarse `cc-by` identifier.
  const licence = licenceFromUrl(loc.license?.url) ?? licenceFromName(loc.license?.label) ??
    (loc.license?.id === "pdm" ? licenceFromName("pdm") : loc.license?.id === "cc-0" ? licenceFromName("cc0") : null) ?? unknownLicence(loc.license?.id ?? "");
  return stockItem("wellcome", x.id, "image", x, {
    title: src.title || x.id, creator: src.contributors?.[0]?.agent?.label || loc.credit,
    landingUrl: src.id ? `https://wellcomecollection.org/works/${encodeURIComponent(src.id)}/images?id=${encodeURIComponent(x.id)}` : "https://wellcomecollection.org",
    fileUrl: `${base}/full/max/0/default.jpg`, previewUrl: `${base}/full/400,/0/default.jpg`, licence,
  });
}
export const wellcome: Provider = {
  id: "wellcome", label: "Wellcome Collection", mediaTypes: ["image"], downloadHosts: WC_HOSTS,
  async search(q, { limit }, http) {
    const d: any = await http.json(`${WC}?${new URLSearchParams({ query: q, pageSize: String(limit), include: "source.contributors" })}`);
    return (d.results ?? []).map(wellcomeItem).filter(Boolean);
  },
  async item(id, http) {
    return requiredItem(wellcomeItem(await http.json(`${WC}/${simpleId(id)}?include=source.contributors`, { cache: false })), "wellcome");
  },
};

const RIJKS_HOSTS = ["iiif.micr.io"];
export const rijksmuseum: Provider = {
  id: "rijksmuseum", label: "Rijksmuseum", mediaTypes: ["image"], downloadHosts: RIJKS_HOSTS,
  async search(q, { limit }, http) {
    const d: any = await http.json(`https://data.rijksmuseum.nl/search/collection?${new URLSearchParams({ title: q, imageAvailable: "true" })}`);
    const out: ArchiveItem[] = [];
    for (const row of (d.orderedItems ?? []).slice(0, Math.min(limit, 12))) {
      const url = safeUrl(row.id, ["id.rijksmuseum.nl"]);
      if (url) {
        try { out.push(await rijksmuseum.item(new URL(url).pathname.split("/").pop()!, http)); }
        catch (error) { if (!(error instanceof ArchiveError) || error.code !== "no-file") throw error; }
      }
    }
    return out;
  },
  async item(id, http) {
    const get = async (url: unknown): Promise<any> => {
      const safe = safeUrl(url, ["id.rijksmuseum.nl", "data.rijksmuseum.nl"]);
      if (!safe) throw new Error("Rijksmuseum returned an unsupported Linked Art endpoint");
      return http.json(safe, { headers: { Accept: "application/ld+json" }, cache: false });
    };
    const obj = await get(`https://id.rijksmuseum.nl/${simpleId(id)}`);
    const visual = obj.shows?.find((v: any) => v.id)?.id;
    if (!visual) return requiredItem(null, "rijksmuseum");
    const vis = await get(visual);
    const rights: string[] = (vis.subject_to ?? []).flatMap((r: any) => (r.classified_as ?? []).map((c: any) => c.id));
    const licence = rights.map((r) => licenceFromUrl(r)).find(Boolean) ?? unknownLicence(rights.join(" "));
    const digital = vis.digitally_shown_by?.find((d: any) => d.id)?.id;
    if (!digital) return requiredItem(null, "rijksmuseum");
    const dig = await get(digital);
    const iiif = (dig.access_point ?? []).map((a: any) => safeUrl(a.id, RIJKS_HOSTS)).find(Boolean);
    if (!iiif) return requiredItem(null, "rijksmuseum");
    const base = iiif.split("/full/")[0].replace(/\/info\.json$/, "");
    const names = (obj.identified_by ?? []).filter((n: any) => n.type === "Name");
    const title = names.find((n: any) => n.language?.some((l: any) => l.id === "http://vocab.getty.edu/aat/300388277"))?.content || names[0]?.content || id;
    const number = obj.identified_by?.find((n: any) => n.type === "Identifier")?.content || id;
    return stockItem("rijksmuseum", id, "image", { object: obj, visual: vis, digital: dig }, {
      title, institution: "Rijksmuseum", landingUrl: `https://www.rijksmuseum.nl/en/collection/${encodeURIComponent(number)}`,
      fileUrl: `${base}/full/max/0/default.jpg`, previewUrl: `${base}/full/400,/0/default.jpg`, licence,
    });
  },
};
