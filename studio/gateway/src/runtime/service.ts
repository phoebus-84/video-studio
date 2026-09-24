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

import { ExecutionService, JournalReviewGate } from "@studio/runtime";
import { GatewayDispatcher } from "./dispatcher.js";
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
   * Where the library lives, resolved by the server and passed down.
   *
   * Required, and deliberately so. This used to be optional with an
   * `AVG_LIBRARY_ROOT ?? "./library"` fallback, on the theory that "the
   * routes omit it and take the environment" — which stopped being true when
   * `registerRoutes` started requiring the root and every caller started
   * threading it. An optional parameter with that fallback is an invitation
   * to omit it again, and omitting it is the branch's worst defect: nothing
   * in this repo sets AVG_LIBRARY_ROOT, so a caller that fell back would
   * lease and journal stages into a `./library` beside the process's cwd
   * while the configured library stayed empty. The journal is the only
   * record of what ran; there is one library, and the caller knows it.
   */
  libraryRoot: string,
  /**
   * The key a human decision is signed and verified with (avg-qr4.3), or
   * `null` for a caller with no operator credential to hand it — a headless
   * caller can still request approval, it just cannot grant one.
   *
   * Required, same reasoning as `libraryRoot`: an optional parameter here is
   * an invitation for one call site to keep quietly passing `undefined`
   * while every other one threads the resolved key, so `review()` would sign
   * for every caller but that one and nobody would notice until an operator
   * tried it.
   */
  operatorKey: string | null,
): ExecutionService {
  return new ExecutionService({
    libraryRoot,
    // `|| undefined` rather than the bare call: builtinPipelinesPath()
    // returns "" when package resolution fails, and createDefaultLoader's
    // `??` does not fall back on an empty string — so AVG_BUILTIN_PIPELINES,
    // the operator's escape hatch, would be dead exactly when it is needed.
    // Without this the loader searches only the library root, and every
    // built-in pipeline resolves to nothing: the same reasoning the deleted
    // loadGates carried.
    builtinPipelines: builtinPipelinesPath() || undefined,
    dispatcher: new GatewayDispatcher(),
    // The same gate the CLI composes (avg-qr4.3). It needs the key to
    // verify a human receipt: composed with `null`, every human approval
    // reads as unverifiable and its dependents stay blocked.
    review: new JournalReviewGate(operatorKey),
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
    operatorKey,
  });
}
