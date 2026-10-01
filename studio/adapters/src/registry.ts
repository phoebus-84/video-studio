// ---------------------------------------------------------------------------
// The adapter registry, and the dispatcher the execution service is given
// ---------------------------------------------------------------------------
// The gateway used to keep a table from stage id to handler. A stage id is a
// pipeline's own label: a pipeline that called its captions stage "subtitles"
// got no captions, and one that reused the id "qa" for a narrative review
// would have had a technical probe written in its name. Matching on the
// contracts a stage declares is what makes an adapter provider-neutral in the
// sense ADR-0015 means.
// ---------------------------------------------------------------------------

import type { DispatchContext, ResolvedStage, StageDispatcher } from "@studio/runtime";
import { CAPABILITIES } from "@studio/contracts/src/vocabulary.mjs";
import type { StageAdapter } from "./descriptor.js";

const KNOWN_CAPABILITIES = new Set<string>(CAPABILITIES);
const ADAPTER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class AdapterRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterRegistryError";
  }
}

/**
 * A stage's signature as far as matching is concerned: what it requests and
 * what it must produce. Two adapters with one signature would leave the choice
 * between them to registration order, which is a silent provider choice.
 */
function signature(capability: string | null, produces: readonly string[]): string {
  return `${capability ?? "(derivation)"} → ${[...produces].sort().join(", ")}`;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
}

export class AdapterRegistry {
  private readonly adapters: readonly StageAdapter[];

  /**
   * Refuses, at construction, every registry that could not answer a match
   * unambiguously. A registry that only discovered the problem when a stage
   * ran would discover it in production.
   */
  constructor(adapters: readonly StageAdapter[]) {
    const ids = new Set<string>();
    const signatures = new Map<string, string>();
    for (const adapter of adapters) {
      if (!ADAPTER_ID.test(adapter.id)) {
        throw new AdapterRegistryError(`adapter id "${adapter.id}" is not kebab-case`);
      }
      if (ids.has(adapter.id)) {
        throw new AdapterRegistryError(`adapter id "${adapter.id}" is registered twice`);
      }
      ids.add(adapter.id);
      if (adapter.capability !== null && !KNOWN_CAPABILITIES.has(adapter.capability)) {
        throw new AdapterRegistryError(
          `adapter "${adapter.id}" serves "${adapter.capability}", which is not in the contracts vocabulary`,
        );
      }
      if (adapter.produces.length === 0) {
        throw new AdapterRegistryError(`adapter "${adapter.id}" declares no output contract`);
      }
      const key = signature(adapter.capability, adapter.produces);
      const clash = signatures.get(key);
      if (clash) {
        throw new AdapterRegistryError(
          `adapters "${clash}" and "${adapter.id}" both match ${key}; nothing could choose between them`,
        );
      }
      signatures.set(key, adapter.id);
    }
    this.adapters = [...adapters];
  }

  list(): readonly StageAdapter[] {
    return this.adapters;
  }

  /** The adapter that performs this stage, or `undefined` if none does. */
  match(stage: ResolvedStage): StageAdapter | undefined {
    const { definition } = stage;
    const requested = definition.capabilities.map((request) => request.capability);
    const produces = definition.produces.map((ref) => ref.label);
    const consumes = new Set(definition.consumes.map((ref) => ref.label));

    return this.adapters.find((adapter) => {
      if (adapter.capability === null) {
        if (definition.type !== "editorial" || requested.length > 0) return false;
      } else if (definition.type !== "capability" || requested.length !== 1 || requested[0] !== adapter.capability) {
        return false;
      }
      return sameSet(adapter.produces, produces) && adapter.consumes.every((input) => consumes.has(input));
    });
  }
}

/**
 * The `StageDispatcher` the execution service is composed with.
 *
 * `canDispatch` and `dispatch` both go through `match`, so they cannot
 * disagree: the service's blocked-versus-failed distinction rests on a stage
 * this reports as unhandled never reaching `dispatch`.
 */
export class AdapterDispatcher implements StageDispatcher {
  constructor(private readonly registry: AdapterRegistry) {}

  canDispatch(stage: ResolvedStage): boolean {
    return this.registry.match(stage) !== undefined;
  }

  async dispatch(stage: ResolvedStage, ctx: DispatchContext): Promise<string[]> {
    const adapter = this.registry.match(stage);
    if (!adapter) {
      throw new Error(`No adapter performs stage "${stage.definition.id}"`);
    }
    ctx.log(`  ${stage.definition.id}: ${adapter.id} (${adapter.provider})`);
    return adapter.perform({ episodeDir: ctx.episodeDir, ref: ctx.ref, log: ctx.log });
  }
}
