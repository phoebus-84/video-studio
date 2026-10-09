// The Metropolitan Museum of Art: Open Access works (isPublicDomain), whose
// images the Met releases under CC0. Its search answers object ids only
// (v1.1: v1 was retired on 2026-10-01); each object is read on its own.

import { ArchiveError } from "../errors.js";
import { licenceFromName, unknownLicence } from "../licence.js";
import { creditLine } from "../text.js";
import type { ArchiveItem, Http, Provider } from "../types.js";

const API = "https://collectionapi.metmuseum.org/public/collection";

function toItem(object: any): ArchiveItem | null {
  if (!object?.objectID || !object.primaryImage) return null;
  const statement = `isPublicDomain: ${object.isPublicDomain === true}`;
  const licence = object.isPublicDomain === true ? licenceFromName("CC0", `${statement} (Met Open Access, CC0)`)! : unknownLicence(statement);
  const title = String(object.title || `Object ${object.objectID}`);
  const creator = object.artistDisplayName || undefined;
  const date = object.objectDate || undefined;
  const institution = "The Metropolitan Museum of Art";
  return {
    provider: "met",
    id: String(object.objectID),
    mediaType: "image",
    title,
    ...(creator ? { creator } : {}),
    ...(date ? { date } : {}),
    institution,
    landingUrl: object.objectURL || `https://www.metmuseum.org/art/collection/search/${object.objectID}`,
    fileUrl: object.primaryImage,
    ...(object.primaryImageSmall ? { previewUrl: object.primaryImageSmall } : {}),
    mime: "image/jpeg",
    licence,
    attribution: creditLine({ title, creator, date, institution: object.creditLine ? `${institution}, ${object.creditLine}` : institution, licence: licence.id, licenceUrl: licence.url }),
    raw: object,
  };
}

async function object(id: string, http: Http, cache = true): Promise<ArchiveItem | null> {
  return toItem(await http.json(`${API}/v1/objects/${id}`, { cache }));
}

export const met: Provider = {
  id: "met",
  label: "The Metropolitan Museum of Art",
  mediaTypes: ["image"],
  async search(query, { limit }, http: Http) {
    const body: any = await http.json(`${API}/v1.1/search?${new URLSearchParams({ q: query, hasImages: "true", isPublicDomain: "true" })}`);
    const ids: number[] = (body?.objectIDs ?? []).slice(0, limit);
    const items: ArchiveItem[] = [];
    for (const id of ids) {
      try {
        const item = await object(String(id), http);
        if (item) items.push(item);
      } catch { /* one object that fails does not sink the search */ }
    }
    return items;
  },
  async item(id, http) {
    if (!/^\d+$/.test(id)) throw new ArchiveError("not-found", `"${id}" is not a Met object id`);
    const item = await object(id, http, false);
    if (!item) throw new ArchiveError("no-file", `Met object ${id} has no Open Access image`);
    return item;
  },
};
