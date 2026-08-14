// ---------------------------------------------------------------------------
// Crash recovery — detect in-flight stages, release leases, resume
// ---------------------------------------------------------------------------

import type { StageInstance } from "../engine/types.js";
import type { RecoveryState } from "./types.js";

/**
 * Analyze crash state from stage instances.
 *
 * Any stage in "running" state at crash time has a stale lease
 * and possibly an in-flight provider job.
 */
export function analyzeRecovery(
  episodeSlug: string,
  stages: Map<string, StageInstance>,
): RecoveryState {
  const inFlightStages: string[] = [];
  const staleLeases: string[] = [];
  const inFlightProviderJobs: string[] = [];

  for (const [id, inst] of stages) {
    if (inst.status === "running") {
      inFlightStages.push(id);

      const lastAttempt = inst.attempts[inst.attempts.length - 1];
      if (lastAttempt?.leaseId) {
        staleLeases.push(lastAttempt.leaseId);
      }

      // Provider jobs are identified by lease ID as a proxy
      if (lastAttempt?.leaseId) {
        inFlightProviderJobs.push(lastAttempt.leaseId);
      }
    }
  }

  const recoverable = inFlightStages.length > 0 && inFlightStages.every((id) => {
    const inst = stages.get(id)!;
    return inst.attempts.length > 0;
  });

  const action: RecoveryState["action"] =
    inFlightStages.length === 0 ? "none" :
    recoverable ? "resume" : "abandon";

  return {
    episodeSlug,
    inFlightStages,
    staleLeases,
    inFlightProviderJobs,
    recoverable,
    action,
  };
}

/**
 * Check whether a crash-restart would cause duplicate paid submissions.
 *
 * Returns true if the recovery plan can safely resume without
 * re-submitting paid provider jobs.
 */
export function canResumeWithoutDuplicate(
  recovery: RecoveryState,
): boolean {
  // If we have stale leases, they were already acquired (and possibly
  // submitted to providers). Resuming means we need to check with
  // the provider whether the job completed, not resubmit.
  return (
    recovery.recoverable &&
    recovery.action === "resume" &&
    recovery.inFlightProviderJobs.length > 0
  );
}
