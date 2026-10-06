import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  FILL, SERIES_TEMPLATE_FILES, instantiateEpisodeSpec, placeholderPaths,
  validateEpisodeSpec, validateSeriesReference, validateSeriesTemplate, validateTemplateBundle,
} from "../src/series-templates.mjs";
import { EPISODE_SPEC_PATH, SERIES_TEMPLATE_MANIFEST, seriesTemplatePath, seriesReferencePath } from "../src/layout.mjs";
import { verifyReceipt } from "../src/receipt.mjs";

const fixtures = fileURLToPath(new URL("../fixtures/series-template/", import.meta.url));
const read = (file) => readFileSync(path.join(fixtures, file), "utf8");
const json = (file) => JSON.parse(read(file));
const release = "example/templates/poetry-short/1.0.0/";
const episodeRef = { channel: "sample", series: "poetry", episode: "morning" };
const bundle = () => ({
  manifest: read(release + SERIES_TEMPLATE_MANIFEST),
  files: Object.fromEntries(Object.values(SERIES_TEMPLATE_FILES).map((file) => [file, read(release + file)])),
});
const spec = () => json("example/episode-spec.json");
const reference = () => json("example/templates/poetry-short/references/morning-v1.json");
const hash = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** Update bytes AND the file digest, to test something beyond a trivial hash mismatch. */
function changeFile(release, role, modify) {
  const filename = SERIES_TEMPLATE_FILES[role];
  release.files[filename] = modify(release.files[filename]);
  const manifest = JSON.parse(release.manifest);
  manifest.files[role].hash = hash(release.files[filename]);
  release.manifest = JSON.stringify(manifest);
}
function changeSchema(release, modify) {
  changeFile(release, "schema", (text) => {
    const schema = JSON.parse(text);
    modify(schema);
    return JSON.stringify(schema);
  });
}

describe("series template contracts", () => {
  it("validates the example bundle, complete spec and reference descriptor", () => {
    assert.deepEqual(validateSeriesTemplate(JSON.parse(bundle().manifest)), []);
    assert.deepEqual(validateTemplateBundle(bundle()), []);
    assert.deepEqual(validateEpisodeSpec(spec(), bundle()), []);
    assert.deepEqual(validateSeriesReference(reference()), []);
  });

  it("rejects every invalid fixture", () => {
    for (const { name, type, document } of json("invalid.json")) {
      const errors = type === "template" ? validateSeriesTemplate(document)
        : type === "reference" ? validateSeriesReference(document) : validateEpisodeSpec(document, bundle());
      assert.ok(errors.length > 0, name);
    }
  });

  it("creates independent drafts without inventing content or changing inputs", () => {
    const input = bundle();
    const before = structuredClone(input);
    const ref = structuredClone(episodeRef);
    const a = instantiateEpisodeSpec(input, ref);
    const b = instantiateEpisodeSpec(input, ref);
    assert.equal(a.revision, 1);
    assert.deepEqual(a.template, spec().template);
    assert.equal(a.data.title, FILL);
    assert.equal(a.data.holdSeconds, FILL, "even a numeric slot can be unfilled in a draft");
    a.data.style.fontFamily = "Different";
    a.data.panels[0].cue = "changed";
    a.episodeRef.episode = "changed";
    assert.equal(b.data.style.fontFamily, "Georgia");
    assert.equal(b.data.panels[0].cue, FILL);
    assert.deepEqual(ref, episodeRef);
    assert.deepEqual(input, before);
  });

  it("refuses to instantiate corrupt bundles and malformed episode identities", () => {
    assert.throws(() => instantiateEpisodeSpec({ manifest: "{", files: {} }, episodeRef), /JSON/);
    assert.throws(() => instantiateEpisodeSpec(bundle(), { ...episodeRef, episode: "../outside" }), /pattern/);
  });

  it("lists placeholders in nested values, embedded text and property names", () => {
    assert.deepEqual(placeholderPaths({ title: `About ${FILL}`, list: [FILL], [FILL]: 1 }), [
      '$["title"]', '$["list"][0]', '$["__FILL__"]',
    ]);
    const draft = instantiateEpisodeSpec(bundle(), episodeRef);
    const errors = validateEpisodeSpec(draft, bundle());
    assert.equal(errors.filter((p) => p.code === "unfilled").length, 5);
    assert.ok(errors.some((p) => p.path === '$.data["holdSeconds"]' && p.code === "spec-data"));
  });

  it("validates filled values without coercion, defaults, removal or mutation", () => {
    const doc = spec();
    doc.metadata = { editor: { preserved: true } };
    const before = structuredClone(doc);
    assert.deepEqual(validateEpisodeSpec(doc, bundle()), []);
    assert.deepEqual(doc, before);
    doc.data.holdSeconds = "1.5";
    doc.data.extra = "must not disappear";
    assert.ok(validateEpisodeSpec(doc, bundle()).some((p) => p.code === "spec-data"));
    assert.equal(doc.data.holdSeconds, "1.5");
    assert.equal(doc.data.extra, "must not disappear");
    delete doc.data.title;
    assert.ok(validateEpisodeSpec(doc, bundle()).some((p) => p.message.includes("title")));
    assert.equal(Object.hasOwn(doc.data, "title"), false);
  });

  it("enforces fixed style values in the pinned series schema", () => {
    for (const [field, value] of [["fontFamily", "Arial"], ["voiceProfile", "other-voice"], ["outputProfile", "youtube-1920x1080"]]) {
      const doc = spec();
      doc.data.style[field] = value;
      assert.ok(validateEpisodeSpec(doc, bundle()).some((p) => p.code === "spec-data"), field);
    }
  });

  it("detects an in-place release rewrite even if its author updates the file hashes", () => {
    const rewritten = bundle();
    changeFile(rewritten, "standard", (text) => text + "\nA changed direction.\n");
    assert.deepEqual(validateTemplateBundle(rewritten), []);
    assert.ok(validateEpisodeSpec(spec(), rewritten).some((p) => p.code === "template-pin"));
    assert.deepEqual(validateEpisodeSpec(spec(), bundle()), [], "the historical release still works");
  });

  it("never follows a newer release or another template implicitly", () => {
    for (const field of ["version", "id"]) {
      const release = bundle();
      const manifest = JSON.parse(release.manifest);
      manifest[field] = field === "version" ? "1.1.0" : "another-template";
      release.manifest = JSON.stringify(manifest);
      assert.ok(validateEpisodeSpec(spec(), release).some((p) => p.code === "template-pin"));
    }
  });

  it("detects changed or missing files, including prose and template defaults", () => {
    for (const file of Object.values(SERIES_TEMPLATE_FILES)) {
      const edited = bundle();
      edited.files[file] += "\n";
      assert.ok(validateTemplateBundle(edited).some((p) => p.code === "hash-mismatch"), file);
      delete edited.files[file];
      assert.ok(validateTemplateBundle(edited).some((p) => p.code === "missing-file"), file);
    }
  });

  it("rejects malformed JSON, non-object templates, empty standards and invalid schemas", () => {
    for (const [role, replacement, code] of [
      ["template", "{", "json"], ["template", "[]", "template-data"],
      ["standard", " \n", "standard"], ["schema", "false", "data-schema"],
    ]) {
      const release = bundle();
      changeFile(release, role, () => replacement);
      assert.ok(validateTemplateBundle(release).some((p) => p.code === code));
    }
    for (const value of [null, undefined, {}, { manifest: "null", files: {} }]) assert.ok(validateTemplateBundle(value).length);
  });

  it("does not load external schemas or execute async/custom schema hooks", () => {
    for (const mutate of [
      (s) => { s.properties.title = { $ref: "https://example.invalid/schema.json" }; },
      (s) => { s.properties.title = { $ref: "file:///etc/passwd" }; },
      (s) => { s.properties.title = { $ref: "../outside.json" }; },
      (s) => { s.$async = true; },
      (s) => { s.properties.title = { $dynamicRef: "#anchor" }; },
      (s) => { s.$defs.Panel.$id = "https://other.invalid/"; },
      (s) => { s.unknownExecutableKeyword = "run"; },
      (s) => { s.properties.title = { $ref: "#/$defs/Absent" }; },
      (s) => { s.properties.title = { $ref: "#/examples/0" }; s.examples = [{ type: "string" }]; },
      (s) => { s.definitions = { hidden: { $ref: "https://example.invalid/hidden" } }; },
      (s) => { s.$schema = "http://json-schema.org/draft-07/schema#"; },
    ]) {
      const release = bundle();
      changeSchema(release, mutate);
      assert.ok(validateTemplateBundle(release).some((p) => p.code === "data-schema"));
    }
  });

  it("treats $ref inside const/example data as data, not as a schema fetch", () => {
    const release = bundle();
    changeSchema(release, (s) => { s.properties.title = { const: { $ref: "https://example.invalid/data" } }; });
    assert.deepEqual(validateTemplateBundle(release), []);
  });

  it("requires exact release versions and closed envelopes", () => {
    for (const version of ["latest", "^1.0.0", "1.0", "01.0.0", "1.0.0-beta", "1x0x0"]) {
      const manifest = JSON.parse(bundle().manifest);
      manifest.version = version;
      assert.ok(validateSeriesTemplate(manifest).length, version);
    }
    const doc = spec();
    doc.run = "arbitrary code";
    assert.ok(validateEpisodeSpec(doc, bundle()).some((p) => p.code === "schema"));
  });
});

describe("golden reference descriptors", () => {
  it("requires an explicit human approval, never policy, agent, request or rejection", () => {
    for (const [field, value] of [["origin", "agent"], ["origin", "policy"], ["decision", "requested"], ["decision", "rejected"]]) {
      const doc = reference();
      doc.approval[field] = value;
      assert.ok(validateSeriesReference(doc).length, `${field} ${value}`);
    }
  });

  it("pins every snapshot and requires the render to be a reviewed output", () => {
    for (const field of ["spec", "timeline", "render", "report"]) {
      const doc = reference();
      doc[field].hash = `sha256:${"0".repeat(64)}`;
      assert.ok(validateSeriesReference(doc).some((p) => p.code === "reference-binding"), field);
    }
    const doc = reference();
    doc.approval.binding.inputs.push(doc.approval.binding.outputs.shift());
    assert.ok(validateSeriesReference(doc).some((p) => p.code === "reference-binding"));
  });

  it("rejects live, traversing and mismatched snapshot/report paths", () => {
    for (const [field, value] of [["spec", "episode-spec.json"], ["timeline", "artifacts/edit-timeline.json"], ["spec", "../other.json"], ["render", "output/.partial.mp4"], ["report", "output/other.report.json"]]) {
      const doc = reference();
      doc[field].path = value;
      assert.ok(validateSeriesReference(doc).length, `${field} ${value}`);
    }
  });

  it("does not confuse a valid descriptor with a verified human signature", () => {
    const doc = reference();
    const key = "series-template-fixture-key-not-a-real-operator-key";
    assert.equal(verifyReceipt(doc.approval, key), true);
    doc.approval.signature = "0".repeat(64);
    assert.deepEqual(validateSeriesReference(doc), [], "shape/bindings are deliberately not a trust decision");
    assert.equal(verifyReceipt(doc.approval, key), false, "runtime verification must refuse it");
  });

  it("adding a golden descriptor does not modify the release or existing pins", () => {
    const release = bundle();
    const before = structuredClone(release);
    assert.deepEqual(validateSeriesReference(reference()), []);
    assert.deepEqual(release, before);
    assert.deepEqual(validateEpisodeSpec(spec(), release), []);
  });
});

describe("canonical series-template paths", () => {
  it("keeps versioned releases and append-only references separate", () => {
    assert.equal(EPISODE_SPEC_PATH, "episode-spec.json");
    assert.equal(SERIES_TEMPLATE_MANIFEST, "series-template.json");
    assert.equal(seriesTemplatePath("/library", "c", "s", "short", "1.0.0"), "/library/c/series/s/templates/short/1.0.0");
    assert.equal(seriesReferencePath("/library", "c", "s", "short", "pilot-v1"), "/library/c/series/s/templates/short/references/pilot-v1.json");
  });

  it("refuses floating versions and path traversal in new path components", () => {
    for (const version of ["latest", "^1.0.0", "../outside", "1x0x0"]) assert.throws(() => seriesTemplatePath("/library", "c", "s", "short", version));
    assert.throws(() => seriesTemplatePath("/library", "c", "s", "../short", "1.0.0"));
    assert.throws(() => seriesReferencePath("/library", "c", "s", "short", "../pilot"));
  });
});
