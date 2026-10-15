// A retry grant permits ONE next attempt, not a reset of the failure history.
// Like a human review, it must be signed. Unlike a review, it accepts no work.
import type { JournalEvent } from "@studio/contracts/src/journal.mjs";
import { planHashOf, verifyReceipt } from "@studio/contracts/src/receipt.mjs";
import type { StageInstance } from "../engine/types.js";
import type { ResolvedStage } from "../pipeline/types.js";

export function retryBinding(stage: ResolvedStage, instance: StageInstance) {
  const last = instance.attempts[instance.attempts.length - 1]!;
  return {
    planHash: planHashOf(stage.definition),
    afterAttempt: last.number,
    afterLeaseId: last.leaseId,
    nextAttempt: instance.attempts.length + 1,
  };
}

/** Absence, a changed plan, another episode or a consumed grant all refuse. */
export function currentRetryGrant(
  events: JournalEvent[], episode: string, stage: ResolvedStage,
  instance: StageInstance, key: string | null | undefined,
): JournalEvent | undefined {
  if (!key || instance.status !== "failed" || !instance.attempts.length) return undefined;
  const expected = retryBinding(stage, instance);
  return events.find((event) => {
    if (event.type !== "stage-retry-granted" || event.actor !== "human") return false;
    const data = event.data;
    if (!data || typeof data !== "object") return false;
    const binding = data.binding as Record<string, unknown> | undefined;
    return data.stageId === stage.definition.id && data.decision === "retry" &&
      data.origin === "human" && data.episode === episode &&
      `${event.episodeRef?.channel}/${event.episodeRef?.series}/${event.episodeRef?.episode}` === episode &&
      typeof data.note === "string" && data.note.trim().length > 0 &&
      binding?.planHash === expected.planHash &&
      binding?.afterAttempt === expected.afterAttempt &&
      binding?.afterLeaseId === expected.afterLeaseId &&
      binding?.nextAttempt === expected.nextAttempt && verifyReceipt(data, key);
  });
}
