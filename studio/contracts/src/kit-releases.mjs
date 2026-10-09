// A kit a channel or a series carries in the library (avg-d1x): kit.json names
// the sealed bundle. Where a kit release sits, and what makes one valid.

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { join } from "node:path";
import identitySchema from "../schemas/v1alpha1/identity.schema.json" with { type: "json" };
import schema from "../schemas/v1alpha1/kit-release.schema.json" with { type: "json" };
import { channelPath, seriesPath } from "./layout.mjs";

export const KIT_RELEASE_FILE = "kit.json";
export const KIT_SOURCE = "kit/index.tsx";
export const KIT_BUNDLE = "kit.cjs";

/** library/<channel>/kits/<name>/<version>, or the series' own kits/ when `series` is given. */
export function kitReleasePath(root, channel, series, name, version) {
  return join(series ? seriesPath(root, channel, series) : channelPath(root, channel), "kits", name, version);
}

const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv);
ajv.addSchema(identitySchema).addSchema(schema);

/** Problems of a kit.json, as `{code, path, message}`; none when it is a KitRelease. */
export function validateKitRelease(doc) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/KitRelease`);
  if (validate(doc)) return [];
  return validate.errors.map((e) => ({ code: "schema", path: `$${e.instancePath.replace(/\//g, ".")}`, message: e.message }));
}
