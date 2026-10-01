// ---------------------------------------------------------------------------
// What a stage adapter declares about itself
// ---------------------------------------------------------------------------
// A pipeline stage names contracts and, for a capability stage, the one
// capability it requests (ADR-0015, ADR-0025). It never names the code that
// performs it. An adapter is the other half of that sentence: it declares the
// contracts it produces and the capability it serves, and the registry pairs
// the two by those declarations alone — never by stage id, which is a
// pipeline's private label and not a contract.
//
// This is the thin end of the descriptor the harness review proposes
// (docs/harness-review.md, "Capability addition is a distributed manual
// process"). Readiness probes, estimates and job submission are not here yet;
// what is here is enough to take artifact production out of the gateway and
// to let CI say which stage each adapter performs.
// ---------------------------------------------------------------------------

import type { DispatchContext } from "@studio/runtime";

/** What an adapter is handed when the execution service dispatches a stage to it. */
export interface AdapterContext {
  /** Absolute path to the episode directory. */
  episodeDir: string;
  ref: DispatchContext["ref"];
  log: (message: string) => void;
}

/** What an adapter needs from the machine before it can do its work. */
export interface AdapterRequirements {
  /** Executables looked up on PATH. */
  system?: string[];
  /** Environment variables that must be set. */
  env?: string[];
}

export interface StageAdapter {
  /** Unique, stable, kebab-case. Appears in logs and in `vpr`-facing reports. */
  id: string;
  /** One sentence: what this adapter actually does, not what the stage hopes for. */
  summary: string;
  /**
   * The capability this adapter serves, from the contracts vocabulary.
   *
   * `null` for a deterministic derivation that calls no provider — reading
   * one artifact and writing another by fixed rules. Such an adapter only
   * performs editorial stages that request no capability, and a capability
   * adapter only performs capability stages that request exactly its
   * capability. Crossing the two would let a derivation quietly stand in for
   * a provider the stage asked for, which ADR-0015 forbids.
   */
  capability: string | null;
  /** Who does the work: a provider id, or "studio" for a local derivation. */
  provider: string;
  /**
   * The output contracts this adapter writes, as pipeline manifests spell
   * them (`captions.srt`, `illustrations/`). A stage matches only when its
   * outputs are exactly this set.
   */
  produces: readonly string[];
  /**
   * The input contracts this adapter reads. A stage matches only when it
   * declares every one of these as an input, so the DAG — not the adapter —
   * guarantees they exist before it runs.
   */
  consumes: readonly string[];
  requires: AdapterRequirements;
  /**
   * Do the work. Returns the paths written, absolute or relative to the
   * episode directory; the execution service validates them.
   */
  perform(ctx: AdapterContext): Promise<string[]>;
}
