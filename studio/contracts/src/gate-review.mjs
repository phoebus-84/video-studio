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
export function buildGateReview({ stageId, decision, origin, actor, binding, checks = [], note, at, episode }) {
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
  if (decision !== "requested" && !episode) {
    throw new Error(
      `Stage "${stageId}" cannot be ${decision} without naming its episode: ` +
      `a decision that names no episode could be copied into another one and still read as made there`,
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
  if (episode !== undefined) review.episode = episode;
  if (note !== undefined) review.note = note;
  return review;
}

const REVIEW_EVENTS = new Set(Object.values(REVIEW_EVENT_FOR));

/** A record's binding, reading pre-v2 records' top-level inputs/outputs. */
function bindingOf(data) {
  return data?.binding ?? { inputs: data?.inputs ?? [], outputs: data?.outputs ?? [] };
}

/** The decision each review event type implies, inverted from REVIEW_EVENT_FOR. */
const DECISION_FOR_EVENT = Object.freeze(
  Object.fromEntries(Object.entries(REVIEW_EVENT_FOR).map(([decision, type]) => [type, decision])),
);

/** Why an event's type and its recorded decision disagree, or null. */
function typeMismatch(event) {
  const implied = DECISION_FOR_EVENT[event.type];
  if (event.data?.decision === implied) return null;
  return `the event type ${event.type} disagrees with the recorded decision ` +
    `(${event.data?.decision ?? "none"}), so the line was altered after it was written`;
}

/** The last review event for the stage in file order. */
function lastReview(events, stageId) {
  return [...events].reverse()
    .find((event) => REVIEW_EVENTS.has(event.type) && event.data?.stageId === stageId);
}

/** Milliseconds since the epoch of a record's own `at`, or NaN. */
const decidedAt = (event) => Date.parse(event.data?.at);

/**
 * The latest signed `at` among the stage's VERIFIED human review events, as
 * `{ ms, at }`, or null. Only a signature makes an `at` trustworthy; see
 * deriveGateState.
 */
function latestVerifiedHumanDecision(events, stageId, key, episode) {
  let latest = null;
  for (const event of events) {
    if (!REVIEW_EVENTS.has(event.type) || event.data?.stageId !== stageId) continue;
    if (event.data?.origin !== "human" || !verifyReceipt(event.data, key)) continue;
    // A decision signed for another episode says nothing about this one, so
    // a copied, later-dated receipt must not supersede this episode's own.
    if (episode !== undefined && event.data?.episode !== episode) continue;
    const ms = decidedAt(event);
    if (!Number.isNaN(ms) && (!latest || ms > latest.ms)) latest = { ms, at: event.data.at };
  }
  return latest;
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
 * Which event governs: the LAST review event for the stage in file order.
 * Then, if it is a verified human decision, it must not be older than any
 * other verified human decision for the stage: re-appending an operator's
 * superseded approval after their rejection reads as `invalidated`
 * ("superseded by a later decision"), and the operator's next real decision,
 * appended later with the current clock, governs again (avg-qr4.3).
 *
 * Why only signed `at`s are compared: an unsigned line's `at` is whatever
 * its writer typed. Ranking by it let anything that can append a line (Pi,
 * with its file tools) write a request dated 2099 that outranked every
 * approval the operator would ever sign — a stage locked closed with no
 * recovery through the product. Unsigned events are ordered by file
 * position only; a signed `at` is only ever used to refuse an older signed
 * decision, never to promote one over a later line.
 *
 * The checks run in this order, and the first that fails decides (avg-qr4.3):
 *   1. no review event means `none`;
 *   2. a request whose `data.decision` is `requested` means `requested`;
 *   3. a human decision (approved or rejected) must verify against
 *      `opts.key`: no key is `unverifiable`, no signature or a signature
 *      that does not verify is `invalidated`. A legacy `actor: "human"`
 *      record with no `origin` is read as human, so it lands here unsigned.
 *      When the caller supplies `opts.episode`, the signed `episode` must
 *      equal it, or the receipt was made for (or copied from) another one.
 *      A verified one older than the stage's latest verified human decision
 *      is `invalidated` as superseded;
 *   4. the event `type` must imply the recorded `data.decision` — for every
 *      origin. The type is not signed and the decision is, so a rejection
 *      re-typed as `approval-granted` is `invalidated`, not an approval;
 *   5. a rejection is `rejected`;
 *   6. the approval's `binding.planHash` must equal `opts.planHash` (when the
 *      caller supplies one), or the stage definition changed under it;
 *   7. every artifact it names must still hash the same.
 * Only then is it `approved`.
 *
 * `events` is the parsed journal — see parseJournal in ./journal.mjs.
 */
export async function deriveGateState(events, stageId, episodeDir, opts = {}) {
  const latest = lastReview(events, stageId);
  if (!latest) return { state: "none" };

  const origin = latest.data?.origin ?? (latest.actor === "human" ? "human" : "agent");
  const mismatch = typeMismatch(latest);
  if (latest.type === "approval-requested") {
    if (mismatch) return { state: "invalidated", reason: mismatch };
    return { state: "requested", at: latest.at, origin };
  }

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
    // The episode is signed (avg-qr4.3 final review). Two episodes of a
    // series share stage definitions, and re-used assets hash identically,
    // so without this a receipt copied from ep1's journal approved ep2.
    if (opts.episode !== undefined && latest.data?.episode !== opts.episode) {
      const named = latest.data?.episode;
      return {
        state: "invalidated",
        reason: named
          ? `the human decision was made for episode "${named}", not "${opts.episode}"`
          : `the human decision names no episode, so nothing shows it was made for "${opts.episode}"`,
      };
    }
    const newest = latestVerifiedHumanDecision(events, stageId, opts.key, opts.episode);
    if (newest && !(decidedAt(latest) >= newest.ms)) {
      return { state: "invalidated", reason: `superseded by a later decision recorded at ${newest.at}` };
    }
  }
  if (mismatch) return { state: "invalidated", reason: mismatch };
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
