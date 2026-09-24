// ---------------------------------------------------------------------------
// Gate review records
// ---------------------------------------------------------------------------
// A review gate is satisfied by evidence or it is not satisfied. The gateway
// executor used to write a safety report describing a wolf eating characters —
// the same text for every episode, having opened none of them — and the
// dispatcher called that stage completed.
//
// A record here names the artifacts it examined by sha256. That is what makes
// it checkable later: `deriveGateState` re-reads those files and compares, so a
// review that has been outrun by a re-render stops counting as a review.
//
// These records ride in the `data` of approval-requested, approval-granted and
// approval-rejected journal events, which is journal.mjs's shape for the
// payload — the one journal-event.schema.json also describes, now that
// avg-i1x is closed.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { JOURNAL_ACTORS } from "./journal.mjs";
import { verifyReceipt } from "./receipt.mjs";

/**
 * Decisions a record may carry. `rejected` rides in its own event type,
 * approval-rejected (avg-qr4.3), so no event on disk contradicts itself.
 */
export const GATE_DECISIONS = Object.freeze(["requested", "approved", "rejected"]);

/**
 * Who decided — as distinct from the journal `actor`, who wrote the line. The
 * gateway writes a human's decision; a reader needs both answers.
 */
export const REVIEW_ORIGINS = Object.freeze(["human", "agent", "policy"]);

export const REVIEW_EVENT_FOR = Object.freeze({
  requested: "approval-requested",
  approved: "approval-granted",
  rejected: "approval-rejected",
});

/**
 * Hash each path, relative to the episode directory.
 *
 * Throws rather than substituting a placeholder for a missing or empty file. A
 * record that hashes an absent file is the same lie in a new format, and the
 * whole point of the record is that it can be checked.
 *
 * Absolute paths are refused, and so are relative ones that climb out of the
 * episode with `..`: a record naming a file outside the episode describes
 * something the episode does not own, and could be satisfied by bytes no review
 * of this episode ever saw.
 */
export async function hashArtifacts(episodeDir, relativePaths) {
  const hashes = [];
  for (const relative of relativePaths) {
    if (path.isAbsolute(relative)) {
      throw new Error(
        `Cannot hash "${relative}": a record must name artifacts relative to the episode, ` +
        `or it can only be checked on the machine that wrote it`,
      );
    }
    if (path.normalize(relative).split(/[\\/]/).includes("..")) {
      throw new Error(
        `Cannot hash "${relative}": a record must name artifacts inside the episode, ` +
        `and this path climbs out of it`,
      );
    }
    let bytes;
    try {
      bytes = await readFile(path.join(episodeDir, relative));
    } catch {
      throw new Error(`Cannot hash "${relative}": no such file under ${episodeDir}`);
    }
    if (bytes.length === 0) {
      throw new Error(`Cannot hash "${relative}": the file is empty`);
    }
    hashes.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return hashes;
}

/**
 * Shape a record, without writing it.
 *
 * Separated from the append the same way buildJournalEvent is, so the shape is
 * testable without a filesystem.
 */
export function buildGateReview({ stageId, decision, origin, actor, binding, checks = [], note, at }) {
  if (!stageId) throw new Error("A gate review must name its stage");
  if (!GATE_DECISIONS.includes(decision)) {
    throw new Error(`Unknown gate review decision: ${decision} (expected ${GATE_DECISIONS.join(", ")})`);
  }
  if (!REVIEW_ORIGINS.includes(origin)) {
    throw new Error(`Unknown gate review origin: ${origin} (expected ${REVIEW_ORIGINS.join(", ")})`);
  }
  if (!JOURNAL_ACTORS.includes(actor)) throw new Error(`Unknown gate review actor: ${actor}`);

  const inputs = binding?.inputs ?? [];
  const outputs = binding?.outputs ?? [];
  if (decision !== "requested" && !binding?.planHash) {
    throw new Error(
      `Stage "${stageId}" cannot be ${decision} without a planHash: ` +
      `a decision that names no plan cannot be invalidated by the plan changing`,
    );
  }
  if (decision === "approved" && outputs.length === 0) {
    throw new Error(
      `Stage "${stageId}" cannot be approved without naming at least one output: ` +
      `an approval of nothing cannot be invalidated by anything`,
    );
  }
  if (decision === "rejected" && !note) {
    throw new Error(`Stage "${stageId}" cannot be rejected without a note: a rejection nobody can act on is noise`);
  }

  const review = {
    stageId, decision, origin, actor,
    at: at ?? new Date().toISOString(),
    binding: { planHash: binding?.planHash, inputs, outputs },
    checks,
  };
  if (review.binding.planHash === undefined) delete review.binding.planHash;
  if (note !== undefined) review.note = note;
  return review;
}

const REVIEW_EVENTS = new Set(Object.values(REVIEW_EVENT_FOR));

/** A record's binding, reading pre-v2 records' top-level inputs/outputs. */
function bindingOf(data) {
  return data?.binding ?? { inputs: data?.inputs ?? [], outputs: data?.outputs ?? [] };
}

/**
 * The current review state of a stage.
 *
 * Invalidation is a fresh read, not a subscription: the recorded hashes are
 * compared against the bytes on disk at the moment of asking. There is no
 * watcher, no cache and no bookkeeping to fall out of date, so a review that
 * was outrun by a re-render, copied from another episode, or simply forged
 * cannot survive being checked.
 *
 * The checks run in this order, and the first that fails decides (avg-qr4.3):
 *   1. the latest review event for the stage — none means `none`, a request
 *      means `requested`;
 *   2. a human decision (approved or rejected) must verify against
 *      `opts.key`: no key is `unverifiable`, no signature or a signature
 *      that does not verify is `invalidated`. A legacy `actor: "human"`
 *      record with no `origin` is read as human, so it lands here unsigned;
 *   3. a verified rejection is `rejected`;
 *   4. the approval's `binding.planHash` must equal `opts.planHash` (when the
 *      caller supplies one), or the stage definition changed under it;
 *   5. every artifact it names must still hash the same.
 * Only then is it `approved`.
 *
 * `events` is the parsed journal — see parseJournal in ./journal.mjs.
 */
export async function deriveGateState(events, stageId, episodeDir, opts = {}) {
  const latest = [...events].reverse()
    .find((event) => REVIEW_EVENTS.has(event.type) && event.data?.stageId === stageId);
  if (!latest) return { state: "none" };

  const origin = latest.data?.origin ?? (latest.actor === "human" ? "human" : "agent");
  if (latest.type === "approval-requested") return { state: "requested", at: latest.at, origin };

  // Human decisions must prove their origin (avg-qr4.3). Checked for
  // rejections too: a forged rejection can only block, but one rule is
  // easier to trust than two.
  if (origin === "human") {
    if (!opts.key) {
      return { state: "unverifiable", reason: "this reader holds no operator key, so a human decision cannot be verified" };
    }
    if (typeof latest.data?.signature !== "string") {
      return { state: "invalidated", reason: "the human decision is unsigned, so nothing shows a person made it" };
    }
    if (!verifyReceipt(latest.data, opts.key)) {
      return { state: "invalidated", reason: "the human decision's signature does not verify" };
    }
  }
  if (latest.type === "approval-rejected") {
    return { state: "rejected", at: latest.at, origin, note: latest.data?.note };
  }

  const binding = bindingOf(latest.data);
  if (opts.planHash !== undefined && binding.planHash !== opts.planHash) {
    return { state: "invalidated", reason: "the stage definition changed since it was approved" };
  }
  const recorded = [...(binding.inputs ?? []), ...(binding.outputs ?? [])];
  if (recorded.length === 0) {
    return { state: "invalidated", reason: "the approval named no artifacts, so there is nothing it could have reviewed" };
  }
  for (const { path: relative, sha256 } of recorded) {
    let current;
    try {
      [current] = await hashArtifacts(episodeDir, [relative]);
    } catch (err) {
      return { state: "invalidated", reason: err.message };
    }
    if (current.sha256 !== sha256) {
      return { state: "invalidated", reason: `"${relative}" changed since it was approved` };
    }
  }
  return { state: "approved", at: latest.at, origin };
}
