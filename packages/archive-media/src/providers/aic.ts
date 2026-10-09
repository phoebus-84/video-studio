// The Art Institute of Chicago: public-domain works, their images served by
// IIIF. Its IIIF server answers only requests naming themselves in
// AIC-User-Agent, and serves up to 3000 px wide (not `full/max`).

import { ArchiveError } from "../errors.js";
import { unknownLicence } from "../licence.js";
import { creditLine } from "../text.js";
import type { ArchiveItem, Http, Provider } from "../types.js";

const API = "https://api.artic.edu/api/v1/artworks";
const FIELDS = "id,title,artist_display,date_display,is_public_domain,image_id,thumbnail,credit_line,copyright_notice";
const IIIF_MAX_WIDTH = 3000;
const POLICY_URL = "https://www.artic.edu/open-access/open-access-images";

function toItem(work: any, iiifBase: string, userAgent: string): ArchiveItem | null {
  if (!work?.image_id) return null;
  const fullWidth = Number(work.thumbnail?.width) || undefined;
  const fullHeight = Number(work.thumbnail?.height) || undefined;
  const width = fullWidth ? Math.min(fullWidth, IIIF_MAX_WIDTH) : IIIF_MAX_WIDTH;
  const height = fullWidth && fullHeight ? Math.round((fullHeight * width) / fullWidth) : undefined;
  const statement = work.is_public_domain ? "is_public_domain: true" : `is_public_domain: false${work.copyright_notice ? `; ${work.copyright_notice}` : ""}`;
  const licence = work.is_public_domain
    ? { id: "public-domain", basis: "aic:is_public_domain", url: POLICY_URL, attributionRequired: false, statement }
    : unknownLicence(statement);
  const title = String(work.title ?? `Artwork ${work.id}`);
  const creator = typeof work.artist_display === "string" ? work.artist_display.split("\n")[0]!.trim() : undefined;
  const date = work.date_display ?? undefined;
  const institution = "Art Institute of Chicago";
  return {
    provider: "aic",
    id: String(work.id),
    mediaType: "image",
    title,
    ...(creator ? { creator } : {}),
    ...(date ? { date } : {}),
    institution,
    landingUrl: `https://www.artic.edu/artworks/${work.id}`,
    fileUrl: `${iiifBase}/${work.image_id}/full/${width},/0/default.jpg`,
    previewUrl: `${iiifBase}/${work.image_id}/full/843,/0/default.jpg`,
    mime: "image/jpeg",
    width,
    ...(height ? { height } : {}),
    licence,
    attribution: creditLine({ title, creator, date, institution: work.credit_line ? `${institution}, ${work.credit_line}` : institution, licence: licence.id === "public-domain" ? "Public domain" : "Licence unknown", licenceUrl: licence.url }),
    fileHeaders: { "AIC-User-Agent": userAgent },
    raw: work,
  };
}

const iiifOf = (body: any) => (typeof body?.config?.iiif_url === "string" ? body.config.iiif_url : "https://www.artic.edu/iiif/2");

export const aic: Provider = {
  id: "aic",
  label: "Art Institute of Chicago",
  mediaTypes: ["image"],
  async search(query, { limit }, http: Http) {
    const params = new URLSearchParams({ q: query, limit: String(limit), fields: FIELDS, "query[term][is_public_domain]": "true" });
    const body: any = await http.json(`${API}/search?${params}`, { headers: { "AIC-User-Agent": http.userAgent } });
    const iiif = iiifOf(body);
    return (body?.data ?? []).map((w: any) => toItem(w, iiif, http.userAgent)).filter((i: ArchiveItem | null): i is ArchiveItem => i !== null);
  },
  async item(id, http) {
    if (!/^\d+$/.test(id)) throw new ArchiveError("not-found", `"${id}" is not an Art Institute artwork id`);
    const body: any = await http.json(`${API}/${id}?fields=${FIELDS}`, { headers: { "AIC-User-Agent": http.userAgent }, cache: false });
    const item = toItem(body?.data, iiifOf(body), http.userAgent);
    if (!item) throw new ArchiveError("no-file", `Art Institute artwork ${id} has no image`);
    return item;
  },
};
