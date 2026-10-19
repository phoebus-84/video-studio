// Licences in one vocabulary, and the policy that decides what may be fetched.
// A Creative Commons licence is read from its URL or its short name; anything
// that cannot be read is `unknown`, and `unknown` is never allowed.

import type { Licence } from "./types.js";

const CC_ELEMENTS = /^(by|by-sa|by-nc|by-nc-sa|by-nd|by-nc-nd)$/;
const PUBLIC_DOMAIN_MARK = "https://creativecommons.org/publicdomain/mark/1.0/";
const CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

const ccUrl = (elements: string, version: string) => `https://creativecommons.org/licenses/${elements}/${version}/`;

/** A Creative Commons licence or dedication from its URL, or null. */
export function licenceFromUrl(url: string | undefined, statement = url ?? ""): Licence | null {
  if (!url) return null;
  const u = url.trim().toLowerCase().replace(/^http:/, "https:").replace(/\/?(deed\.[a-z-]+|legalcode(\.[a-z-]+)?)?\/?$/, "");
  const cc = /^https:\/\/(?:www\.)?creativecommons\.org\/licenses\/([a-z-]+)\/(\d+(?:\.\d+)?)/.exec(u);
  if (cc && CC_ELEMENTS.test(cc[1]!)) return cc_(cc[1]!, cc[2]!, statement);
  if (/^https:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/zero\/1\.0/.test(u)) return { id: "CC0-1.0", url: CC0_URL, attributionRequired: false, statement };
  if (/^https:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/mark\/1\.0/.test(u)) return { id: "public-domain", basis: "PDM-1.0", url: PUBLIC_DOMAIN_MARK, attributionRequired: false, statement };
  return null;
}

function cc_(elements: string, version: string, statement: string): Licence {
  return { id: `CC-${elements.toUpperCase()}-${version}`, url: ccUrl(elements, version), attributionRequired: true, statement };
}

/** A licence from a short name ("CC BY-SA 4.0", "cc-by-sa-4.0", "CC0", "Public domain", "pdm"), or null. */
export function licenceFromName(name: string | undefined, statement = name ?? ""): Licence | null {
  if (!name) return null;
  const n = name.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (n === "cc0" || n === "cc0-1.0" || n === "cc-zero") return { id: "CC0-1.0", url: CC0_URL, attributionRequired: false, statement };
  if (n === "pdm" || n === "pdm-1.0") return { id: "public-domain", basis: "PDM-1.0", url: PUBLIC_DOMAIN_MARK, attributionRequired: false, statement };
  if (n === "pd" || n === "public-domain" || n.startsWith("pd-")) return { id: "public-domain", basis: name.trim(), attributionRequired: false, statement };
  const cc = /^(?:cc-)?(by(?:-nc)?(?:-sa|-nd)?)-(\d+(?:\.\d+)?)$/.exec(n);
  if (cc && CC_ELEMENTS.test(cc[1]!)) return cc_(cc[1]!, cc[2]!, statement);
  return null;
}

export function unknownLicence(statement: string): Licence {
  return { id: "unknown", attributionRequired: true, statement };
}

/** The licence's kind, without version: public-domain, CC0, CC-BY-SA, provider:pexels, unknown. */
export function licenceKind(licence: Licence): string {
  if (licence.id === "CC0-1.0") return "CC0";
  const cc = /^(CC-[A-Z-]+?)-\d+(?:\.\d+)?$/.exec(licence.id);
  return cc ? cc[1]! : licence.id;
}

/** Which kinds may be fetched. */
export interface LicencePolicy {
  allow: string[];
}

/**
 * Public domain, CC0, CC BY and CC BY-SA: free to use in anything, commercial
 * included, with credit where asked. The SIL Open Font Licence and Apache 2.0,
 * under which nearly every open font (and some icon sets) is released, allow
 * the same, the notice kept.
 */
export const DEFAULT_POLICY: LicencePolicy = { allow: ["public-domain", "CC0", "CC-BY", "CC-BY-SA", "provider:ofl-1.1", "provider:apache-2.0"] };

/** Whether the policy allows the licence, and if not, why. `unknown` is never allowed. */
export function licenceAllowed(licence: Licence, policy: LicencePolicy = DEFAULT_POLICY): { ok: true } | { ok: false; reason: string } {
  const kind = licenceKind(licence);
  if (kind === "unknown") return { ok: false, reason: `its licence could not be verified (${licence.statement || "none given"})` };
  if (policy.allow.includes(kind)) return { ok: true };
  return { ok: false, reason: `${licence.id} is not allowed (allowed: ${policy.allow.join(", ")})` };
}
