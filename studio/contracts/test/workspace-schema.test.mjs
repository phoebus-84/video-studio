import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { policyActionFields, validateWorkspaceSemantics } from "../src/workspace-semantics.mjs";

const load = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
const [identity, workspace, fairyTale, repository] = await Promise.all([
  load("../schemas/v1alpha1/identity.schema.json"),
  load("../schemas/v1alpha1/workspace.schema.json"),
  load("../fixtures/workspace/fairy-tale.json"),
  load("../fixtures/workspace/repository.json"),
]);

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(identity);
  ajv.addSchema(workspace);
  const validate = ajv.getSchema(`${workspace.$id}#/$defs/WorkspaceExample`);
  assert.ok(validate, "WorkspaceExample schema definition is registered");
  return { ajv, validate };
}

test("fairy-tale and pinned-repository workspace fixtures validate", () => {
  const { ajv, validate } = createValidator();
  for (const fixture of [fairyTale, repository]) {
    assert.equal(validate(fixture), true, ajv.errorsText(validate.errors));
    assert.deepEqual(validateWorkspaceSemantics(fixture), []);
  }
});

test("all policy decisions are explicit and blockers require approval", () => {
  for (const settings of [fairyTale.channelSettings.values, fairyTale.seriesSettings.values, fairyTale.episode.settings]) {
    for (const field of policyActionFields) assert.notEqual(settings.approvalPolicy[field], undefined);
    assert.equal(settings.approvalPolicy.onMaterialDowngrade, "requireApproval");
    assert.equal(settings.approvalPolicy.onCapabilityUnavailable, "requireApproval");
  }
});

test("semantics reject cross-resource and budget inconsistencies", () => {
  const wrongSeries = structuredClone(fairyTale);
  wrongSeries.episode.seriesId = repository.series.seriesId;
  assert.ok(validateWorkspaceSemantics(wrongSeries).some((error) => error.code === "workspace.series-mismatch"));

  const invalidBudget = structuredClone(fairyTale);
  invalidBudget.episode.settings.budget.warnAtMicros = invalidBudget.episode.settings.budget.limitMicros + 1;
  assert.ok(validateWorkspaceSemantics(invalidBudget).some((error) => error.code === "budget.warning-exceeds-limit"));
});

test("repository snapshots pin a full commit and prohibit repository execution", () => {
  assert.match(repository.sourceSnapshot.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(repository.sourceSnapshot.analysisPolicy, { readOnly: true, allowRepositoryExecution: false });
});

test("current deliverables are an explicit hash-backed pointer, not a filename convention", () => {
  const pointer = fairyTale.currentDeliverable;
  assert.equal(fairyTale.episode.currentDeliverablePath, "output/current.json");
  assert.equal(pointer.episodeId, fairyTale.episode.episodeId);
  assert.match(pointer.media.path, /^output\//);
  assert.match(pointer.media.hash.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(pointer.media.path, "final-final-2.mp4");
});
