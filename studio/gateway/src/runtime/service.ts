// ---------------------------------------------------------------------------
// The execution service, composed for the gateway
// ---------------------------------------------------------------------------
// Every gateway path that executes or reports on a stage needs this
// composition — /execute, the single-stage execute, claim, complete, status,
// rerun-plan, the episode-detail enrichment and the event publisher's poll.
// It lives here rather than inline in each caller because a copy is how the
// builtinPipelines bug got in: the route that omitted it resolved every
// built-in pipeline to nothing on an ordinary install, and looked fine in a
// test that supplied its own manifests.
// ---------------------------------------------------------------------------

import { ExecutionService } from "@studio/runtime";
import { GatewayDispatcher } from "./dispatcher.js";
import { GatewayReviewGate } from "./review-gate.js";
import { builtinPipelinesPath } from "./client.js";

/**
 * The pipeline a caller gets when neither the request nor the episode names
 * one. Stated once here so the routes, the episode-detail enrichment and the
 * publisher's poll cannot drift onto different defaults and report on
 * different pipelines for the same episode.
 */
export const DEFAULT_PIPELINE = "narrated-illustrated-video";

export function makeExecutionService(
  log: (message: string) => void,
  /**
   * Where the library lives, for callers that already resolved it.
   *
   * The routes omit it and take the environment, which is what they have. The
   * server resolves `AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library"`
   * and hands long-lived collaborators — the event publisher — the answer, so
   * a gateway configured purely through `libraryRoots` does not poll a
   * `./library` nobody put anything in.
   */
  libraryRoot?: string,
): ExecutionService {
  return new ExecutionService({
    libraryRoot: libraryRoot ?? process.env.AVG_LIBRARY_ROOT ?? "./library",
    // `|| undefined` rather than the bare call: builtinPipelinesPath()
    // returns "" when package resolution fails, and createDefaultLoader's
    // `??` does not fall back on an empty string — so AVG_BUILTIN_PIPELINES,
    // the operator's escape hatch, would be dead exactly when it is needed.
    // Without this the loader searches only the library root, and every
    // built-in pipeline resolves to nothing: the same reasoning the deleted
    // loadGates carried.
    builtinPipelines: builtinPipelinesPath() || undefined,
    dispatcher: new GatewayDispatcher(),
    review: new GatewayReviewGate(),
    // No budget subsystem is wired anywhere yet (avg-91o). An explicit
    // pass-through keeps the gap visible rather than blocking every stage
    // for a reason nobody can act on.
    budget: {
      maySpend: async () => ({ ok: true as const, value: { reserveId: "gateway", estimatedCost: 0 } }),
    },
    holder: `gateway/pid-${process.pid}`,
    // Stated, not inherited — the same reasoning as the CLI's composition.
    // The engine's 5-minute default was sized for a synchronous dispatcher;
    // the claim routes hand stages to Pi, which thinks for minutes.
    leaseTtlMs: Number(process.env.AVG_CLAIM_TTL_MS ?? 15 * 60 * 1000),
    log,
  });
}
