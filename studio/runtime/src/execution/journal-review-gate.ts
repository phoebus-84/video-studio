// ---------------------------------------------------------------------------
// The review gate, read from the journal
// ---------------------------------------------------------------------------
// Moved from the gateway (it was GatewayReviewGate) so the CLI and the gateway
// consult the same gate: avg-qr4.3 made verifying a receipt need the operator
// key and the stage definition, and a CLI with no gate at all fell back to the
// manifest rule forever.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveGateState } from "@studio/contracts/src/gate-review.mjs";
import { planHashOf } from "@studio/contracts/src/receipt.mjs";
import type { ResolvedStage } from "../pipeline/types.js";
import type { ReviewGate, ReviewVerdict } from "./types.js";

/**
 * Which origins satisfy a manifest's `gates.review`.
 *
 * Unlisted levels — `auto` among them — are satisfied by nothing: fail
 * closed. A level the manifest enum grew without anyone deciding what counts
 * as its approval must not read as "any approval will do".
 */
export const REVIEW_SATISFIED_BY: Readonly<Record<string, readonly ("human" | "agent" | "policy")[]>> = Object.freeze({
  human: ["human"],
  skill: ["human", "agent"],
  "human-or-skill": ["human", "agent"],
});

export class JournalReviewGate implements ReviewGate {
  /**
   * `key` is the operator key human receipts are verified with. Null means
   * this composition holds none, so every human decision reads as
   * unverifiable — outstanding, never approved.
   */
  constructor(private readonly key: string | null) {}

  async isOutstanding(stageId: string, episodeDir: string, stage?: ResolvedStage): Promise<ReviewVerdict> {
    if (!stage) {
      // A receipt is bound to a plan hash; without the definition there is
      // nothing to compare it with, and "approved" would be a guess.
      return { state: "outstanding", reason: "cannot be judged without its definition, which a receipt is bound to" };
    }

    let events;
    try {
      const contents = await readFile(path.join(episodeDir, JOURNAL_RELATIVE_PATH), "utf-8");
      events = parseJournal(contents, { strict: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
        // No journal at all: nothing has been reviewed or requested, and this
        // gate has nothing to say. It must not say "not outstanding" — that
        // reads as acceptance and would suppress the service's manifest rule.
        return { state: "no-record" };
      }
      // A journal that exists and cannot be read is not evidence of approval.
      return {
        state: "outstanding",
        reason: `has a review that cannot be read: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const state = await deriveGateState(events, stageId, episodeDir, {
      key: this.key,
      planHash: planHashOf(stage.definition),
    });
    switch (state.state) {
      case "none":
        // The journal is readable and holds no review for this stage. The gate
        // declines to answer rather than guessing, and the service falls back
        // to what the manifest declares.
        return { state: "no-record" };
      case "requested":
        return { state: "outstanding", reason: "is awaiting review" };
      case "rejected":
        return { state: "outstanding", reason: `was rejected: ${state.note ?? "no note given"}` };
      case "unverifiable":
        return { state: "outstanding", reason: "has a human decision that cannot be verified here, because no operator key is configured" };
      case "invalidated":
        return { state: "outstanding", reason: `has an invalidated review: ${state.reason}` };
      case "approved": {
        // A valid approval still has to be the KIND the manifest asked for:
        // an agent approving its own work must not satisfy `review: human`.
        const level = stage.definition.gates.review;
        const origin = state.origin ?? "agent";
        // `none` asks for no review, so any valid approval satisfies it: with
        // no record at all the manifest rule lets its dependents through, and
        // a current approval must not make the gate stricter than silence.
        if (level === "none") return { state: "approved" };
        if ((REVIEW_SATISFIED_BY[level] ?? []).includes(origin)) return { state: "approved" };
        return {
          state: "outstanding",
          reason: `requires ${level} review, and the approval on record is from ${origin}`,
        };
      }
    }
  }
}
