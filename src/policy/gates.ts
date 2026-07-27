// ---------------------------------------------------------------------------
// Policy gate resolution
// ---------------------------------------------------------------------------

import type { ApprovalMode } from "../settings/types.js";
import type { PolicyGate, GateCheckResult, GateDecision } from "./types.js";

/** Error class for policy violations. */
export class PolicyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly gate?: PolicyGate,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

/** Policy error codes. */
export const POLICY_CODES = {
  HARD_BLOCK: "POLICY_HARD_BLOCK",
  BUDGET_EXCEEDED: "POLICY_BUDGET_EXCEEDED",
  DOWNGRADE_BLOCKED: "POLICY_DOWNGRADE_BLOCKED",
  UNAUTHORIZED: "POLICY_UNAUTHORIZED",
} as const;

/**
 * Resolve a gate against the active approval policy.
 *
 * - autopilot: all non-hard gates proceed; hard gates still block
 * - guided: hard gates block; non-hard gates prompt
 * - manual: all gates prompt
 */
export function checkGate(
  gate: PolicyGate,
  approvalMode: ApprovalMode,
): GateCheckResult {
  let decision: GateDecision;

  if (gate.hard) {
    if (approvalMode === "manual") {
      decision = "prompt";
    } else {
      // Hard gates always block in non-manual modes
      decision = "block";
    }
  } else {
    switch (approvalMode) {
      case "autopilot":
        decision = "proceed";
        break;
      case "guided":
        decision = "prompt";
        break;
      case "manual":
        decision = "prompt";
        break;
      default:
        decision = "block";
    }
  }

  return {
    gate,
    decision,
    reason: `Approval mode "${approvalMode}" → ${decision} for gate "${gate.gateId}"`,
  };
}

/**
 * Check multiple gates and return all results.
 * Throws PolicyError if any hard block is hit.
 */
export function checkGates(
  gates: PolicyGate[],
  approvalMode: ApprovalMode,
): { results: GateCheckResult[]; blocked: boolean } {
  const results = gates.map((g) => checkGate(g, approvalMode));
  const blocked = results.some((r) => r.decision === "block");

  if (blocked) {
    const blocker = results.find((r) => r.decision === "block")!;
    throw new PolicyError(
      `Gate "${blocker.gate.gateId}" is blocked: ${blocker.reason}`,
      POLICY_CODES.HARD_BLOCK,
      blocker.gate,
    );
  }

  return { results, blocked: false };
}

/**
 * Material downgrade detection.
 *
 * A downgrade occurs when the resolved output profile is lower quality
 * than the pipeline's declared requirement.
 */
export function detectDowngrade(
  requiredProfile: string,
  actualProfile: string,
): { downgraded: boolean; reason?: string } {
  const profiles = ["youtube-4k", "youtube-1080p", "youtube-720p", "preview"];
  const requiredIdx = profiles.indexOf(requiredProfile);
  const actualIdx = profiles.indexOf(actualProfile);

  if (actualIdx > requiredIdx) {
    return {
      downgraded: true,
      reason: `Output profile downgraded from ${requiredProfile} to ${actualProfile}. ` +
        `Quality loss is not allowed without explicit acceptance.`,
    };
  }

  return { downgraded: false };
}
