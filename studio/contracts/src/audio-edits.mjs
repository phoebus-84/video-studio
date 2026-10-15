// An audio file made by an edit (avg-8hs.5): <output>.edit.json beside it,
// naming its recipe, what it resolved to, every input and the output by
// hash, where each clip went, the report, and the words it carries.

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schemas/v1alpha1/audio-edit.schema.json" with { type: "json" };

export const EDIT_SUFFIX = ".edit.json";
export const PEAKS_SUFFIX = ".peaks.json";

const ajv = new Ajv2020({ allErrors: true, strict: false, ownProperties: true });
addFormats(ajv);
ajv.addSchema(schema);

/** Problems of an <output>.edit.json, as `{code, path, message}`; none when it is an AudioEdit. */
export function validateAudioEdit(doc) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/AudioEdit`);
  if (validate(doc)) return [];
  return validate.errors.map((e) => ({ code: "schema", path: `$${e.instancePath.replace(/\//g, ".")}`, message: e.message }));
}
