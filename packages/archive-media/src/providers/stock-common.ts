// Shared normalization for the native stock providers. No CreativeStudio runtime dependency.
import { ArchiveError } from "../errors.js";
import { licenceFromUrl, unknownLicence } from "../licence.js";
import { creditLine } from "../text.js";
import type { ArchiveItem, Licence, MediaType } from "../types.js";

export function requiredKey(key: string | undefined, provider: string): string {
  if (!key) throw new ArchiveError("provider-disabled", `${provider} needs its API key`);
  return key;
}
export function requiredItem(item: ArchiveItem | null, provider: string): ArchiveItem {
  if (!item) throw new ArchiveError("no-file", `${provider}: no downloadable, licensed media record`);
  return item;
}
export function licensed(url: string | undefined): Licence {
  return licenceFromUrl(url) ?? unknownLicence(url ?? "No licence supplied");
}
/** Software licences by SPDX id, as icon sets and font families state them; case is ignored. */
const SOFTWARE: Record<string, { id: string; url: string }> = {
  "mit": { id: "provider:mit", url: "https://opensource.org/license/mit" },
  "apache-2.0": { id: "provider:apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  "isc": { id: "provider:isc", url: "https://opensource.org/license/isc-license-txt" },
  "bsd-3-clause": { id: "provider:bsd-3-clause", url: "https://opensource.org/license/bsd-3-clause" },
  "ofl-1.1": { id: "provider:ofl-1.1", url: "https://openfontlicense.org" },
  "ufl-1.0": { id: "provider:ufl-1.0", url: "https://ubuntu.com/legal/font-licence" },
};
/** A software licence from its SPDX id, or null when it is not one we know. */
export function softwareLicence(spdx: string | undefined): Licence | null {
  const known = spdx ? SOFTWARE[spdx.trim().toLowerCase()] : undefined;
  return known ? { ...known, attributionRequired: true, statement: `${spdx}: retain the copyright and licence notice` } : null;
}
export function platform(name: string, url: string): Licence {
  return { id: `provider:${name}`, url, attributionRequired: true,
    statement: `${name} platform licence, not Creative Commons. No standalone redistribution or implied endorsement; people, brands and artwork may need additional permissions.` };
}
export function safeUrl(value: unknown, hosts: string[]): string {
  if (typeof value !== "string") return "";
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") &&
      hosts.some((h) => u.hostname === h || (h.startsWith(".") && u.hostname.endsWith(h))) ? u.href : "";
  } catch { return ""; }
}
export function positive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
export function stockItem(provider: string, id: unknown, mediaType: MediaType, raw: unknown,
  fields: Omit<ArchiveItem, "provider" | "id" | "mediaType" | "raw" | "attribution">): ArchiveItem {
  return { provider, id: String(id), mediaType, raw, ...fields,
    attribution: creditLine({ title: fields.title, creator: fields.creator, institution: fields.institution ?? provider,
      licence: fields.licence.id, licenceUrl: fields.licence.url }) };
}
export function typedId(id: string): { kind: "image" | "video"; id: string } {
  const m = /^(image|video)\/([0-9]+)$/.exec(id);
  if (!m) throw new ArchiveError("not-found", "Use the exact search id: image/<number> or video/<number>");
  return { kind: m[1] as "image" | "video", id: m[2]! };
}
export function simpleId(id: string): string {
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) throw new ArchiveError("not-found", "Invalid provider item id");
  return encodeURIComponent(id);
}
