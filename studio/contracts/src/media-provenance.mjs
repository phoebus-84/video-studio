// Archive and stock media in a workspace (avg-fe8.2): each file has
// <file>.source.json beside it — provider, item, licence, credit, and the
// provider's response kept as evidence — and ATTRIBUTIONS.md is made from them.

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import identitySchema from "../schemas/v1alpha1/identity.schema.json" with { type: "json" };
import schema from "../schemas/v1alpha1/media-provenance.schema.json" with { type: "json" };

export const PROVENANCE_SUFFIX = ".source.json";
export const EVIDENCE_DIR = "artifacts/provenance";
export const ATTRIBUTIONS_FILE = "ATTRIBUTIONS.md";

const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv);
ajv.addSchema(identitySchema).addSchema(schema);

/** Problems of a <file>.source.json, as `{code, path, message}`; none when it is a MediaProvenance. */
export function validateMediaProvenance(doc) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/MediaProvenance`);
  if (validate(doc)) return [];
  return validate.errors.map((e) => ({ code: "schema", path: `$${e.instancePath.replace(/\//g, ".")}`, message: e.message }));
}

const escape = (text) => String(text).replace(/([\\`*_[\]|])/g, "\\$1");

/**
 * ATTRIBUTIONS.md for these records, sorted by file: every credit, where it
 * is verified, and the licence. Deterministic: the same records, the same text.
 */
export function renderAttributions(records) {
  const sorted = [...records].sort((a, b) => (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0));
  const lines = [
    "# Attributions",
    "",
    "Archive and stock media used here, with their licences. Generated from each file's `.source.json`: do not edit by hand.",
    "",
  ];
  for (const r of sorted) {
    lines.push(`- **\`${r.file.path}\`**: ${escape(r.attribution)}`);
    lines.push(`  - From ${escape(r.provider.label)}: <${r.item.landingUrl}>`);
    const licence = r.licence.id === "public-domain" ? `Public domain${r.licence.basis ? ` (${escape(r.licence.basis)})` : ""}` : r.licence.id;
    lines.push(`  - Licence: ${licence}${r.licence.url ? ` — <${r.licence.url}>` : ""}${r.licence.attributionRequired ? "; credit required" : ""}`);
  }
  if (sorted.length === 0) lines.push("No archive or stock media.");
  return `${lines.join("\n")}\n`;
}
