// ADR-0037. Pure contract helpers: no workspace reads/writes, module loading,
// provider calls, schema downloads or approvals. The runtime owns those boundaries.
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import identitySchema from "../schemas/v1alpha1/identity.schema.json" with { type: "json" };
import gateSchema from "../schemas/v1alpha1/gate-review.schema.json" with { type: "json" };
import schema from "../schemas/v1alpha1/series-template.schema.json" with { type: "json" };
import themeSchema from "../schemas/v1alpha1/channel-theme.schema.json" with { type: "json" };

export const FILL = "__FILL__";
export const SERIES_TEMPLATE_FILES = Object.freeze({
  schema: "episode-spec.schema.json",
  template: "episode-spec.template.json",
  standard: "FORMAT.md",
});

const issue = (code, path, message) => ({ code, path, message });
const member = (base, key) => `${base}[${JSON.stringify(key)}]`;
const hash = (text) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv);
ajv.addSchema(identitySchema).addSchema(gateSchema).addSchema(themeSchema).addSchema(schema);

function shape(kind, doc) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${kind}`);
  if (validate(doc)) return [];
  return validate.errors.map((e) => issue("schema", jsonPath(e.instancePath), e.message));
}

function jsonPath(pointer, base = "$") {
  return pointer.split("/").slice(1).reduce((p, key) => member(p, key.replace(/~1/g, "/").replace(/~0/g, "~")), base);
}

/** Reserved even inside a string or property name; a partial fill cannot compile. */
export function placeholderPaths(value, base = "$") {
  const paths = new Set();
  function visit(node, at) {
    if (typeof node === "string" && node.includes(FILL)) paths.add(at);
    else if (Array.isArray(node)) node.forEach((v, i) => visit(v, member(at, i)));
    else if (isObject(node)) {
      for (const [key, v] of Object.entries(node)) {
        const next = member(at, key);
        if (key.includes(FILL)) paths.add(next);
        visit(v, next);
      }
    }
  }
  visit(value, base);
  return [...paths];
}

export function validateSeriesTemplate(doc) {
  const problems = shape("SeriesTemplate", doc);
  if (problems.length) return problems;
  for (const [role, filename] of Object.entries(SERIES_TEMPLATE_FILES)) {
    if (doc.files[role].path !== filename) problems.push(issue("template-file", `$.files.${role}.path`, `Expected ${filename}`));
  }
  return problems;
}

// Walk schema positions, NOT example/default/const values that may contain $ref
// as ordinary data. A release is self-contained; there is no remote schema loader.
function schemaProblems(node, at = "$", root = true) {
  if (!isObject(node)) return [];
  const problems = [];
  for (const [key, value] of Object.entries(node)) {
    const p = member(at, key);
    if (["$async", "$dynamicRef", "$recursiveRef"].includes(key) || (key === "$id" && !root)) {
      problems.push(issue("data-schema", p, `${key} is not supported in a series schema`));
    }
    if (key === "$ref" && (typeof value !== "string" || !/^#\/\$defs\/(?:[^/~]|~[01])+$/.test(value))) {
      problems.push(issue("data-schema", p, "Only #/$defs/<name> references are allowed; bundle definitions at the root"));
    }
    if (["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"].includes(key) && isObject(value)) {
      for (const [name, child] of Object.entries(value)) problems.push(...schemaProblems(child, member(p, name), false));
    } else if (["allOf", "anyOf", "oneOf", "prefixItems"].includes(key) && Array.isArray(value)) {
      value.forEach((child, i) => problems.push(...schemaProblems(child, member(p, i), false)));
    } else if (["items", "contains", "additionalProperties", "additionalItems", "unevaluatedProperties", "unevaluatedItems", "propertyNames", "contentSchema", "not", "if", "then", "else"].includes(key)) {
      problems.push(...schemaProblems(value, p, false));
    }
  }
  return problems;
}

function inspectBundle(bundle) {
  const problems = [];
  const parse = (text, at) => {
    try { return JSON.parse(text); }
    catch { problems.push(issue("json", at, "Expected a JSON document")); return null; }
  };
  if (typeof bundle?.manifest !== "string" || !isObject(bundle?.files)) {
    return { problems: [issue("bundle", "$", "Supply manifest text and a filename → UTF-8 text map")] };
  }
  const manifest = parse(bundle.manifest, "$.manifest");
  if (problems.length) return { problems };
  problems.push(...validateSeriesTemplate(manifest));
  if (problems.length) return { problems };
  for (const [role, filename] of Object.entries(SERIES_TEMPLATE_FILES)) {
    const text = Object.hasOwn(bundle.files, filename) ? bundle.files[filename] : undefined;
    if (typeof text !== "string") problems.push(issue("missing-file", member("$.files", filename), `Missing ${filename}`));
    else if (hash(text) !== manifest.files[role].hash) problems.push(issue("hash-mismatch", member("$.files", filename), `${filename} differs from this immutable release; publish a new version`));
  }
  if (problems.length) return { problems };
  const dataSchema = parse(bundle.files[SERIES_TEMPLATE_FILES.schema], "$.schema");
  const template = parse(bundle.files[SERIES_TEMPLATE_FILES.template], "$.template");
  if (!isObject(template)) problems.push(issue("template-data", "$.template", "Template data must be an object"));
  if (!bundle.files[SERIES_TEMPLATE_FILES.standard].trim()) problems.push(issue("standard", "$.standard", "FORMAT.md must explain the series standard and procedure"));
  if (!isObject(dataSchema) || dataSchema.$schema !== "https://json-schema.org/draft/2020-12/schema" || dataSchema.type !== "object") {
    problems.push(issue("data-schema", "$.schema", "A series schema must declare Draft 2020-12 and type: object for EpisodeSpec.data"));
  } else problems.push(...schemaProblems(dataSchema));
  if (problems.length) return { problems };
  let validate;
  try {
    // No coercion/default insertion/removal, custom keywords, $data or async refs.
    const validator = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
    addFormats(validator);
    validate = validator.compile(dataSchema);
  } catch (error) {
    problems.push(issue("data-schema", "$.schema", error.message));
  }
  return { problems, manifest, template, validate };
}

/** Checks release shape, every file hash and schema compilation, not filled episode data. */
export function validateTemplateBundle(bundle) {
  return inspectBundle(bundle).problems;
}

/** A fresh, pinned DRAFT; __FILL__ is deliberately retained for the editor. No writes. */
export function instantiateEpisodeSpec(bundle, episodeRef) {
  const checked = inspectBundle(bundle);
  if (checked.problems.length) throw new RangeError(checked.problems.map((p) => `${p.path}: ${p.message}`).join("; "));
  const doc = {
    apiVersion: "studio.video/v1alpha1", kind: "EpisodeSpec", episodeRef: structuredClone(episodeRef), revision: 1,
    template: { id: checked.manifest.id, version: checked.manifest.version, hash: hash(bundle.manifest) },
    data: checked.template,
  };
  const problems = shape("EpisodeSpec", doc);
  if (problems.length) throw new RangeError(problems.map((p) => `${p.path}: ${p.message}`).join("; "));
  return doc;
}

/** Compile-ready validation. A valid envelope alone is not a complete episode. */
export function validateEpisodeSpec(doc, bundle) {
  const problems = shape("EpisodeSpec", doc);
  if (problems.length) return problems;
  const checked = inspectBundle(bundle);
  if (checked.problems.length) return checked.problems;
  const { manifest, validate } = checked;
  if (doc.template.id !== manifest.id || doc.template.version !== manifest.version || doc.template.hash !== hash(bundle.manifest)) {
    problems.push(issue("template-pin", "$.template", "The spec pins a different release; no implicit latest or migration"));
    return problems;
  }
  for (const p of placeholderPaths(doc.data, "$.data")) problems.push(issue("unfilled", p, `Replace ${FILL} before compilation`));
  if (!validate(doc.data)) {
    problems.push(...validate.errors.map((e) => issue("spec-data", jsonPath(e.instancePath, "$.data"), e.message)));
  }
  return problems;
}

/**
 * Descriptor shape and receipt binding ONLY. Before promoting/using a golden,
 * the runtime must verifyReceipt with the operator key, verify every artifact,
 * and validate the spec snapshot against the pinned bundle. No approval is made here.
 */
export function validateSeriesReference(doc) {
  const problems = shape("SeriesReference", doc);
  if (problems.length) return problems;
  const snapshot = `reviews/references/${doc.id}`;
  for (const [field, filename] of [["spec", "episode-spec.json"], ["timeline", "edit-timeline.json"]]) {
    if (doc[field].path !== `${snapshot}/${filename}`) problems.push(issue("reference-snapshot", `$.${field}.path`, `Expected immutable ${snapshot}/${filename}, not a live editorial file`));
  }
  if (!/^output\/[a-z0-9]+(?:-[a-z0-9]+)*\.mp4$/.test(doc.render.path)) {
    problems.push(issue("reference-render", "$.render.path", "Name the immutable output/<render-id>.mp4, not a current pointer or partial render"));
  }
  if (doc.report.path !== doc.render.path.replace(/\.mp4$/, ".report.json")) problems.push(issue("reference-report", "$.report.path", "Report must be the rendered file's sibling .report.json"));
  const receipt = doc.approval;
  if (receipt.origin !== "human" || receipt.decision !== "approved") problems.push(issue("reference-approval", "$.approval", "Only an explicit human approval can establish a reference"));
  if (receipt.episode !== `${doc.episodeRef.channel}/${doc.episodeRef.series}/${doc.episodeRef.episode}`) {
    problems.push(issue("reference-episode", "$.approval.episode", "Approval belongs to another episode"));
  }
  for (const field of ["spec", "timeline", "render", "report"]) {
    const { path, hash: digest } = doc[field];
    // The delivered picture must be an OUTPUT of the approval, not merely an input.
    const artifacts = field === "render" ? receipt.binding.outputs : [...receipt.binding.inputs, ...receipt.binding.outputs];
    if (!artifacts.some((a) => a.path === path && a.sha256 === digest.slice(7))) {
      problems.push(issue("reference-binding", `$.${field}`, `Approval does not bind the exact ${field} snapshot`));
    }
  }
  return problems;
}
