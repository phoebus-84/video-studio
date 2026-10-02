// ---------------------------------------------------------------------------
// Candidates and the selected take
// ---------------------------------------------------------------------------
// ADR-0021: every generated result is an immutable attempt, and selection is a
// small pointer. Until avg-qr4.6 neither half existed. A stage's outputs were
// whatever its last completion wrote, in place, so a rerun destroyed the take
// it replaced, and "which take counts" meant "whichever ran last".
//
// A completion that carries `digests` is a CANDIDATE: the service kept a
// read-only copy of every file under `attempts/<stageId>/<attemptNumber>/`,
// and the hashes say whether anyone has touched it since. The SELECTED take is
// decided by the journal, like everything else about execution:
//
//   - `stage-completed` selects its own candidate unless it says
//     `selected: false`;
//   - `take-selected` selects an earlier candidate explicitly.
//
// A `take-selected` record is shaped like a gate review — `decision:
// "selected"`, the attempt and its hashes in `binding` — so an operator's
// selection is signed by the same receipt an approval is, and a selection
// retyped as `approval-granted` reads as tampered (gate-review.mjs checks that
// the type implies the decision).
//
// Replayed separately from execution state on purpose: which take is selected
// never changes whether a stage ran, and keeping deriveExecutionState as it
// was keeps every journal ever written meaning what it meant.
// ---------------------------------------------------------------------------

import path from "node:path";
import { JOURNAL_ACTORS } from "./journal.mjs";
import { REVIEW_ORIGINS } from "./gate-review.mjs";
import { verifyReceipt } from "./receipt.mjs";

/** Where candidates are kept, relative to the episode directory. Named by the layout contract. */
export const ATTEMPTS_DIR = "attempts";

const SHA256 = /^[0-9a-f]{64}$/;

/** Where attempt `attemptNumber` of `stageId` keeps its copy of `relative`. */
export function candidatePath(stageId, attemptNumber, relative = "") {
  return path.join(ATTEMPTS_DIR, stageId, String(attemptNumber), relative);
}

/**
 * Shape a `take-selected` record, without writing or signing it.
 *
 * Refuses a selection of nothing for the same reason buildGateReview refuses
 * an approval of nothing: a record that names no hashes cannot be checked
 * against the bytes it claims to have put in place.
 */
export function buildTakeSelection({
  stageId, origin, actor, attemptNumber, leaseId, outputs, episode, previous = null, at,
}) {
  if (!stageId) throw new Error("A take selection must name its stage");
  if (!REVIEW_ORIGINS.includes(origin)) {
    throw new Error(`Unknown take selection origin: ${origin} (expected ${REVIEW_ORIGINS.join(", ")})`);
  }
  if (!JOURNAL_ACTORS.includes(actor)) throw new Error(`Unknown take selection actor: ${actor}`);
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`Stage "${stageId}": a take selection must name the attempt it selects`);
  }
  if (!leaseId) throw new Error(`Stage "${stageId}": a take selection must name the lease of the attempt it selects`);
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error(
      `Stage "${stageId}" cannot select attempt ${attemptNumber} without naming its files: ` +
      `a selection of nothing cannot be checked against anything`,
    );
  }
  for (const digest of outputs) {
    if (typeof digest?.path !== "string" || !SHA256.test(digest?.sha256 ?? "")) {
      throw new Error(`Stage "${stageId}": every selected file needs a path and a sha256`);
    }
  }
  if (!episode) {
    throw new Error(
      `Stage "${stageId}": a take selection must name its episode, ` +
      `or a signed one could be copied into another episode and still read as made there`,
    );
  }
  return {
    stageId,
    decision: "selected",
    origin,
    actor,
    at: at ?? new Date().toISOString(),
    episode,
    binding: { attemptNumber, leaseId, outputs: outputs.map(({ path: p, sha256 }) => ({ path: p, sha256 })) },
    previous,
  };
}

/**
 * Each stage's candidates and selected take, replayed from the journal.
 *
 * `opts.key` verifies an operator's selection; `opts.episode` is the
 * "channel/series/episode" slug it must have been signed for. A selection is
 * LOCKED when it is the operator's and nothing shows it forged: verified
 * under the key, or — with no key to check against — taken at its word,
 * because the alternative lets an unattended rerun displace exactly the take
 * a lock exists to protect. A forged lock can only make things stricter.
 *
 * Events naming a stage outside `stageIds` are ignored; deriveExecutionState
 * already refuses those for the same journal.
 */
export function deriveTakes(events, stageIds, opts = {}) {
  const takes = new Map();
  for (const stageId of stageIds) takes.set(stageId, { stageId, candidates: [], selected: null });

  for (const event of events) {
    const data = event.data ?? {};
    const entry = takes.get(data.stageId);
    if (!entry) continue;

    if (event.type === "stage-completed") {
      if (Array.isArray(data.digests)) {
        const candidate = {
          attemptNumber: data.attemptNumber,
          leaseId: data.leaseId,
          at: event.at,
          outputs: data.digests.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
        };
        entry.candidates.push(candidate);
        if (data.selected !== false) {
          entry.selected = {
            attemptNumber: candidate.attemptNumber,
            leaseId: candidate.leaseId,
            origin: "policy",
            at: event.at,
            outputs: candidate.outputs,
            paths: candidate.outputs.map((d) => d.path),
            locked: false,
            verified: null,
          };
        }
      } else if (data.selected !== false) {
        // A completion from before candidates were kept. Still the stage's
        // take — that is what it was when it was written — but with no copy
        // to restore and no hashes to compare, so it can never be selected
        // again once something displaces it.
        entry.selected = {
          attemptNumber: data.attemptNumber,
          leaseId: data.leaseId,
          origin: "policy",
          at: event.at,
          outputs: null,
          paths: [...(data.outputs ?? [])],
          locked: false,
          verified: null,
        };
      }
      continue;
    }

    if (event.type === "take-selected") {
      const binding = data.binding ?? {};
      const origin = data.origin;
      let verified = null;
      if (origin === "human" && opts.key) {
        verified = verifyReceipt(data, opts.key) && data.decision === "selected" &&
          (opts.episode === undefined || data.episode === opts.episode);
      }
      const outputs = Array.isArray(binding.outputs) ? binding.outputs : [];
      entry.selected = {
        attemptNumber: binding.attemptNumber,
        leaseId: binding.leaseId,
        origin,
        at: data.at ?? event.at,
        outputs,
        paths: outputs.map((d) => d.path),
        locked: origin === "human" && verified !== false,
        verified,
      };
    }
  }
  return takes;
}
