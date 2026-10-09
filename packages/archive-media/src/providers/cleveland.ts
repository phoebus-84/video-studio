// The Cleveland Museum of Art: Open Access works under CC0. Its `print` image
// is a JPEG of a few thousand pixels; `full` is a TIFF of tens of megabytes,
// used only when there is no print.

import { ArchiveError } from "../errors.js";
import { licenceFromName, unknownLicence } from "../licence.js";
import { creditLine } from "../text.js";
import type { ArchiveItem, Http, Provider } from "../types.js";

const API = "https://openaccess-api.clevelandart.org/api/artworks";

function toItem(work: any): ArchiveItem | null {
  // print, else the full TIFF: the web image is too small for video.
  const image = work?.images?.print ?? work?.images?.full ?? work?.images?.web;
  if (!image?.url) return null;
  const statement = `share_license_status: ${work.share_license_status ?? "none"}`;
  const licence = work.share_license_status === "CC0" ? licenceFromName("CC0", statement)! : unknownLicence(statement);
  const title = String(work.title ?? work.accession_number);
  const creator = work.creators?.[0]?.description ?? undefined;
  const date = work.creation_date ?? undefined;
  const institution = "Cleveland Museum of Art";
  const width = Number(image.width) || undefined;
  const height = Number(image.height) || undefined;
  const bytes = Number(image.filesize) || undefined;
  return {
    provider: "cleveland",
    id: String(work.id),
    mediaType: "image",
    title,
    ...(creator ? { creator } : {}),
    ...(date ? { date } : {}),
    institution,
    landingUrl: work.url ?? `https://clevelandart.org/art/${work.accession_number}`,
    fileUrl: image.url,
    ...(work.images?.web?.url ? { previewUrl: work.images.web.url } : {}),
    mime: String(image.url).toLowerCase().endsWith(".tif") ? "image/tiff" : "image/jpeg",
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(bytes ? { bytes } : {}),
    licence,
    attribution: creditLine({ title, creator, date, institution, licence: licence.id, licenceUrl: licence.url }),
    raw: work,
  };
}

export const cleveland: Provider = {
  id: "cleveland",
  label: "Cleveland Museum of Art",
  mediaTypes: ["image"],
  async search(query, { limit }, http: Http) {
    const body: any = await http.json(`${API}/?${new URLSearchParams({ q: query, has_image: "1", cc0: "1", limit: String(limit) })}`);
    return (body?.data ?? []).map(toItem).filter((i: ArchiveItem | null): i is ArchiveItem => i !== null);
  },
  async item(id, http) {
    if (!/^\d+$/.test(id)) throw new ArchiveError("not-found", `"${id}" is not a Cleveland artwork id`);
    const body: any = await http.json(`${API}/${id}`, { cache: false });
    const item = toItem(body?.data);
    if (!item) throw new ArchiveError("no-file", `Cleveland artwork ${id} has no image`);
    return item;
  },
};
