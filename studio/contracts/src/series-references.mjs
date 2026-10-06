// ---------------------------------------------------------------------------
// Golden references: trust, approval and withdrawal (avg-jao.6, ADR-0037)
// ---------------------------------------------------------------------------
// A SeriesReference is evidence that a person approved one episode as the
// series' standard. Its shape (validateSeriesReference) proves nothing; this
// module is what turns a descriptor on disk into a verdict: the operator's
// signature, the files it binds, the release its spec was pinned to, and
// whether it has since been withdrawn. It reads files and never writes them.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { buildGateReview } from "./gate-review.mjs";
import { EPISODES_CONTAINER } from "./layout.mjs";
import { canonicalJson, verifyReceipt } from "./receipt.mjs";
import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateSeriesReference } from "./series-templates.mjs";

/** The stage id every reference approval and withdrawal carries. */
export const REFERENCE_REVIEW_STAGE = "reference-review";
/** Where an episode keeps the frozen snapshots of its proposed references. */
export const REFERENCE_SNAPSHOT_DIR = "reviews/references";

const issue = (code, path, message) => ({ code, path, message });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const episodeSlug = (ref) => `${ref.channel}/${ref.series}/${ref.episode}`;

/** sha256 hex of a proposal: what an approval's planHash commits to. */
export function proposalHash(proposal) {
  return sha256(canonicalJson(proposal));
}

/**
 * The approval a reference carries, unsigned: a human approved these four
 * files as the series' standard. The caller signs it with the operator key.
 */
export function buildReferenceApproval({ reference, at, note }) {
  const bare = (field) => ({ path: reference[field].path, sha256: reference[field].hash.slice("sha256:".length) });
  const { approval: _ignored, ...proposal } = reference;
  return buildGateReview({
    stageId: REFERENCE_REVIEW_STAGE,
    decision: "approved",
    origin: "human",
    actor: "human",
    binding: {
      planHash: proposalHash(proposal),
      inputs: [bare("spec"), bare("timeline")],
      outputs: [bare("render"), bare("report")],
    },
    episode: episodeSlug(reference.episodeRef),
    ...(at !== undefined ? { at } : {}),
    ...(note !== undefined ? { note } : {}),
  });
}

/**
 * A withdrawal, unsigned: a human rejected this exact descriptor (its file's
 * hash) as a reference, for `reason`. The caller signs it.
 */
export function buildReferenceWithdrawal({ reference, descriptorHash, reason, at }) {
  return buildGateReview({
    stageId: REFERENCE_REVIEW_STAGE,
    decision: "rejected",
    origin: "human",
    actor: "human",
    binding: { planHash: descriptorHash, inputs: [{ path: `${reference.id}.json`, sha256: descriptorHash }], outputs: [] },
    episode: episodeSlug(reference.episodeRef),
    note: reason,
    ...(at !== undefined ? { at } : {}),
  });
}

/**
 * Every check ADR-0037 requires before a reference is trusted, in order,
 * stopping at the first that fails. `seriesDir` is
 * `<library>/<channel>/series/<series>`; `key` the operator key, or null.
 * `descriptor`, when given, is the descriptor's text to verify in place of
 * the file — what `vpr reference approve` checks before writing it.
 */
export function verifySeriesReference({ seriesDir, templateId, referenceId, key, descriptor }) {
  const refsDir = join(seriesDir, "templates", templateId, "references");
  const descriptorPath = join(refsDir, `${referenceId}.json`);
  const at = `templates/${templateId}/references/${referenceId}.json`;
  const verdict = (state, problems = [], reference = null, extra = {}) => ({ state, reference, problems, ...extra });

  // 1. The descriptor.
  if (descriptor === undefined && !existsSync(descriptorPath)) return verdict("invalid", [issue("missing-reference", at, `${at} does not exist`)]);
  const descriptorBytes = descriptor === undefined ? readFileSync(descriptorPath) : Buffer.from(descriptor, "utf-8");
  let reference;
  try {
    reference = JSON.parse(descriptorBytes.toString("utf-8"));
  } catch (error) {
    return verdict("invalid", [issue("bad-reference", at, `not JSON: ${error.message}`)]);
  }
  const shape = validateSeriesReference(reference);
  if (shape.length > 0) return verdict("invalid", shape.map((p) => issue(p.code, `${at}#${p.path}`, p.message)), reference);
  const series = basename(seriesDir);
  const channel = basename(dirname(dirname(seriesDir)));
  if (reference.id !== referenceId || reference.template.id !== templateId
    || reference.episodeRef.series !== series || reference.episodeRef.channel !== channel) {
    return verdict("invalid", [issue("reference-identity", at,
      `${reference.id} (${reference.episodeRef.channel}/${reference.episodeRef.series}, template ${reference.template.id}) is not ${referenceId} of ${channel}/${series}, template ${templateId}`)], reference);
  }

  // 2. The operator's signature.
  if (!key) return verdict("unverifiable", [issue("no-operator-key", at, "no operator key to verify the approval with")], reference);
  const approval = reference.approval;
  if (!verifyReceipt(approval, key)) {
    return verdict("invalid", [issue("bad-signature", `${at}#$.approval`, "the approval's signature does not verify with the operator key")], reference);
  }
  if (approval.origin !== "human" || approval.decision !== "approved" || approval.stageId !== REFERENCE_REVIEW_STAGE
    || approval.episode !== episodeSlug(reference.episodeRef)) {
    return verdict("invalid", [issue("not-an-approval", `${at}#$.approval`,
      `the receipt is a ${approval.origin} ${approval.decision} of "${approval.stageId}" for ${approval.episode}, not a human approval of this reference`)], reference);
  }

  // 3. A withdrawal, if any: valid → withdrawn; forged → invalid, never ignored.
  const withdrawalPath = join(refsDir, `${referenceId}.withdrawal.json`);
  if (existsSync(withdrawalPath)) {
    const wat = `templates/${templateId}/references/${referenceId}.withdrawal.json`;
    let withdrawal;
    try {
      withdrawal = JSON.parse(readFileSync(withdrawalPath, "utf-8"));
    } catch {
      withdrawal = null;
    }
    const descriptorHash = sha256(descriptorBytes);
    const valid = withdrawal && verifyReceipt(withdrawal, key) && withdrawal.origin === "human" && withdrawal.decision === "rejected"
      && withdrawal.stageId === REFERENCE_REVIEW_STAGE && withdrawal.episode === approval.episode
      && Array.isArray(withdrawal.binding?.inputs)
      && withdrawal.binding.inputs.some((i) => i.path === `${referenceId}.json` && i.sha256 === descriptorHash);
    if (!valid) {
      return verdict("invalid", [issue("bad-withdrawal", wat, "a withdrawal is present but is not a signed human withdrawal of this descriptor")], reference);
    }
    return verdict("withdrawn", [], reference, { withdrawal });
  }

  // 4. The files, inside the source episode, as declared.
  const episodeDir = join(seriesDir, EPISODES_CONTAINER, reference.episodeRef.episode);
  const ep = `${EPISODES_CONTAINER}/${reference.episodeRef.episode}`;
  if (!existsSync(episodeDir)) return verdict("invalid", [issue("missing-file", ep, `the source episode ${ep} is missing`)], reference);
  const root = realpathSync(episodeDir);
  const bytes = {};
  for (const field of ["spec", "timeline", "render", "report"]) {
    const { path, hash } = reference[field];
    const where = `${ep}/${path}`;
    const file = join(episodeDir, path);
    if (!existsSync(file)) return verdict("invalid", [issue("missing-file", where, `${where} is missing`)], reference);
    const real = realpathSync(file);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) {
      return verdict("invalid", [issue("path-escape", where, `${where} is not a file inside the source episode`)], reference);
    }
    bytes[field] = readFileSync(real);
    if (`sha256:${sha256(bytes[field])}` !== hash) {
      return verdict("invalid", [issue("hash-mismatch", where, `${where} is not the file the reference recorded`)], reference);
    }
  }

  // 5. The frozen spec, against the release it is pinned to — never today's.
  const releaseDir = join(seriesDir, "templates", reference.template.id, reference.template.version);
  const rel = `templates/${reference.template.id}/${reference.template.version}`;
  const names = ["series-template.json", ...Object.values(SERIES_TEMPLATE_FILES)];
  if (!names.every((name) => existsSync(join(releaseDir, name)))) {
    return verdict("invalid", [issue("missing-release", rel, `the pinned release ${rel} is not in the series`)], reference);
  }
  const text = (name) => readFileSync(join(releaseDir, name), "utf-8");
  const bundle = { manifest: text("series-template.json"), files: Object.fromEntries(Object.values(SERIES_TEMPLATE_FILES).map((n) => [n, text(n)])) };
  let spec;
  try {
    spec = JSON.parse(bytes.spec.toString("utf-8"));
  } catch {
    spec = null;
  }
  const specProblems = spec ? validateEpisodeSpec(spec, bundle) : [issue("frozen-spec", "$", "not JSON")];
  if (specProblems.length > 0) {
    return verdict("invalid", specProblems.map((p) => issue("frozen-spec", `${ep}/${reference.spec.path}#${p.path}`, `${p.code}: ${p.message}`)), reference);
  }
  if (episodeSlug(spec.episodeRef) !== episodeSlug(reference.episodeRef)) {
    return verdict("invalid", [issue("reference-identity", `${ep}/${reference.spec.path}#$.episodeRef`, "the frozen spec belongs to another episode")], reference);
  }
  if (spec.template.id !== reference.template.id || spec.template.version !== reference.template.version || spec.template.hash !== reference.template.hash) {
    return verdict("invalid", [issue("reference-identity", `${ep}/${reference.spec.path}#$.template`, "the frozen spec pins another release than the reference")], reference);
  }

  // 6. Provenance: the timeline was compiled from that spec, and the render from that timeline.
  let timeline;
  let report;
  try {
    timeline = JSON.parse(bytes.timeline.toString("utf-8"));
    report = JSON.parse(bytes.report.toString("utf-8"));
  } catch {
    return verdict("invalid", [issue("provenance-mismatch", ep, "the timeline snapshot or the report is not JSON")], reference);
  }
  if (timeline?.derivedFrom?.spec?.hash !== reference.spec.hash) {
    return verdict("invalid", [issue("provenance-mismatch", `${ep}/${reference.timeline.path}#$.derivedFrom.spec.hash`, "the timeline was not compiled from the frozen spec")], reference);
  }
  if (report?.timeline?.hash !== reference.timeline.hash) {
    return verdict("invalid", [issue("provenance-mismatch", `${ep}/${reference.report.path}#$.timeline.hash`, "the render was not made from the frozen timeline")], reference);
  }

  return verdict("trusted", [], reference);
}
