/**
 * Driving a production from the studio.
 *
 * The studio could read and edit but never act: it called thirteen endpoints
 * and none of them were /execute, /approve or /snapshot. You could comment on
 * a scene and have no way to ask for it again.
 *
 * This is the acting half — stage status, and the four things you can do about
 * it. Every action reports what the service actually said; nothing here
 * pretends to have succeeded.
 */

import { getGatewayClient } from "./gateway.svelte.ts";

/**
 * A stage's place in its pipeline, as the execution service reports it.
 *
 * Seven members and no synonyms. The previous set carried `awaiting_approval`
 * beside `awaiting_review` and `complete` beside `completed` — two spellings
 * for one state each, from two vocabularies, of which the runtime emitted
 * neither pair consistently.
 */
export type StageState =
  | "pending" | "runnable" | "running" | "blocked" | "failed" | "completed" | "awaiting_review";

// This mirrors `StageState` in studio/runtime/src/execution/types.ts. The
// studio cannot import from the runtime package, so the two are separate
// declarations of one vocabulary and must be changed together. `actionsFor`'s
// `default` branch is what keeps a drift safe rather than silent: a member
// added there and not here yields no buttons, never the wrong ones.

export interface StageStatus {
  /**
   * `stageId`, NOT `id`. The gateway's /status returns the execution
   * service's report verbatim, and its field is `stageId`. While this said
   * `id`, `runStage(stage.id)` posted to `/stages/undefined/execute` — the
   * same defect that silently broke `routes/workspace.ts` and
   * `events/publisher.ts`.
   */
  stageId: string;
  state: StageState;
  dependsOn: string[];
  /** Artifact labels this stage produces, e.g. ["script.md"]. */
  produces: string[];
  /**
   * Why the stage is in this state, when there is something to say. Set for
   * `blocked` and `pending`. It is the only thing a stage with no available
   * action has to offer a reader, so the panel shows it.
   */
  stateReason?: string;
}

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

/**
 * What a route says went wrong.
 *
 * Two shapes, because two kinds of route answer here. The execution service's
 * routes — execute, claim, complete, rerun-plan, status — return
 * `ExecutionError`, `{ code, message }`. The two that still shell out through
 * `RuntimeClient` — approve, and snapshot on its success path — return a bare
 * string. Anything that renders one of these must handle both: while this was
 * typed `string`, `res.error` for /execute rendered as `[object Object]`.
 */
export type RouteError = string | { code?: string; message?: string };

/** The error as a sentence, whichever of the two shapes arrived. */
export function errorText(error: RouteError | undefined): string | null {
  if (typeof error === "string") return error.length > 0 ? error : null;
  return error?.message ?? null;
}

/** The error's code, when the route returned the structured shape. */
function errorCode(error: RouteError | undefined): string | null {
  return typeof error === "object" && error !== null ? (error.code ?? null) : null;
}

/**
 * What a single-stage call reports back.
 *
 * Mirrors `StageOutcome` in studio/runtime/src/execution/types.ts, narrowed to
 * the fields the studio reads.
 */
interface StageOutcomeView {
  stageId?: string | null;
  status: string;
  reason?: string;
  outputs?: string[];
}

/**
 * The outcome statuses that mean the stage moved forward.
 *
 * `claimed` is here even though nothing in the studio calls /claim yet: a
 * successful claim IS the stage advancing — it is leased and a performer is
 * on it — and leaving it out would have made the one thing a future claim
 * button does correctly render as an error. Anything absent from this set is
 * a verdict that the work did not happen (`blocked`, `failed`, `idle`),
 * delivered inside an `ok: true` envelope because the service reached it
 * deliberately. A status added to `OutcomeStatus` and not here reports as a
 * refusal, which is the safe direction to be wrong in.
 */
const ADVANCED = new Set(["completed", "awaiting_review", "would-run", "claimed"]);

/** What happened, for an outcome that carries no reason of its own. */
function describeOutcome(outcome: StageOutcomeView): string {
  const who = outcome.stageId ?? "The stage";
  if (outcome.status === "completed") {
    return (outcome.outputs ?? []).length > 0
      ? `${who} completed — wrote ${(outcome.outputs ?? []).join(", ")}`
      : `${who} completed`;
  }
  if (outcome.status === "awaiting_review") return `${who} completed and is awaiting review`;
  if (outcome.status === "would-run") return `${who} would run — nothing was written`;
  if (outcome.status === "claimed") return `${who} is claimed — perform it, then complete it`;
  return `${who}: ${outcome.status}`;
}

/**
 * What the studio is allowed to offer for a stage in a given state.
 *
 * Only what the service will accept. A button the service refuses is worse
 * than no button: the Run Stage button used to report success for a request
 * that printed advice to a log and executed nothing.
 */
export function actionsFor(state: string): Array<"run" | "approve"> {
  switch (state) {
    // Runnable now; completed and failed are reruns, which the service
    // supports for an explicitly named stage.
    case "runnable":
    case "completed":
    case "failed":
      return ["run"];
    case "awaiting_review":
      return ["approve"];
    // pending, blocked, running — and anything this build does not know.
    default:
      return [];
  }
}

class ProductionStore {
  ref = $state<EpisodeRef | null>(null);
  stages = $state<StageStatus[]>([]);
  pipeline = $state<string | null>(null);

  loading = $state(false);
  /** Stage id currently running an action, so the UI can disable it. */
  busyStage = $state<string | null>(null);
  error = $state<string | null>(null);
  /** Last thing the service said, shown verbatim rather than summarised. */
  lastMessage = $state<string | null>(null);
  /** True when the episode has no resolved pipeline snapshot yet. */
  needsSnapshot = $state(false);

  #base(): string {
    const r = this.ref!;
    return (
      `/api/channels/${encodeURIComponent(r.channel)}` +
      `/series/${encodeURIComponent(r.series)}` +
      `/episodes/${encodeURIComponent(r.episode)}`
    );
  }

  async load(ref: EpisodeRef): Promise<void> {
    this.ref = ref;
    this.loading = true;
    this.error = null;
    this.needsSnapshot = false;

    try {
      const res = await getGatewayClient().fetchJSON<{
        ok: boolean;
        data?: { pipeline?: string; stages?: StageStatus[] };
        error?: RouteError;
      }>(`${this.#base()}/status`);

      if (!res.ok) {
        // An episode with no snapshot is a normal state, not a failure: it has
        // simply never been resolved. Say so, and offer the fix.
        //
        // Matched on the code, not on the prose: the message is free text and
        // was never a contract. While this tested /pipeline not found/ against
        // `res.error`, the object stringified to "[object Object]" and could
        // never match, so a fresh episode showed a raw error where the offer
        // to resolve it belongs.
        this.needsSnapshot = errorCode(res.error) === "PIPELINE_UNRESOLVED";
        this.error = this.needsSnapshot ? null : (errorText(res.error) ?? "Status failed");
        this.stages = [];
        return;
      }

      this.pipeline = res.data?.pipeline ?? null;
      this.stages = (res.data?.stages ?? []).map((s) => ({
        ...s,
        produces: (s.produces ?? []).map((p: unknown) =>
          typeof p === "string" ? p : ((p as { label?: string }).label ?? ""),
        ),
      }));
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.stages = [];
    } finally {
      this.loading = false;
    }
  }

  async #act(stageId: string | null, path: string, body: unknown = {}): Promise<void> {
    if (!this.ref || this.busyStage) return;
    this.busyStage = stageId ?? "*";
    this.error = null;
    this.lastMessage = null;

    try {
      const res = await getGatewayClient().fetchJSON<{
        ok?: boolean;
        error?: RouteError;
        outcome?: StageOutcomeView;
        data?: { message?: string };
        message?: string;
        snapshot?: { message?: string };
      }>(`${this.#base()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok === false) {
        this.error = errorText(res.error) ?? "The service refused that";
        return;
      }

      // `ok: true` means the service reached a verdict, not that the work
      // happened. The single-stage routes answer `{ ok: true, outcome: {
      // status: "blocked", reason } }` for a stage they declined to run, and
      // this used to set lastMessage to "Done" for it — a button reporting
      // success for work that never took place, which is what Run Stage did
      // for its entire life.
      const outcome = res.outcome;
      const refusal = outcome && !ADVANCED.has(outcome.status)
        ? (outcome.reason ?? describeOutcome(outcome))
        : null;
      const said = refusal
        ? null
        : outcome
          ? (outcome.reason ?? describeOutcome(outcome))
          : (res.data?.message ?? res.snapshot?.message ?? res.message ?? "Done");

      // Reloaded before the verdict is applied, not after: a refused or failed
      // attempt still changes the stage list, and `load` clears `error` on the
      // way in, so setting it first would erase what we are here to report.
      await this.load(this.ref);
      if (refusal) {
        // The refusal answers what the user clicked, so it is never dropped.
        // `??=` did drop it whenever the reload set an error of its own — the
        // reader then saw a status failure with no hint that their run had
        // been refused, which is the exact substitution this task exists to
        // close. A reload error is a second, separate fact; both are shown.
        this.error = this.error && this.error !== refusal
          ? `${refusal}\n\nReading status afterwards also failed: ${this.error}`
          : refusal;
      } else {
        this.lastMessage = said;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busyStage = null;
    }
  }

  /** Freeze the pipeline this episode is produced under. */
  resolveSnapshot(): Promise<void> {
    return this.#act(null, "/snapshot");
  }

  /** Run one stage. */
  runStage(stageId: string): Promise<void> {
    return this.#act(stageId, `/stages/${encodeURIComponent(stageId)}/execute`);
  }

  /** Approve a stage waiting at a gate. */
  approveStage(stageId: string): Promise<void> {
    return this.#act(stageId, `/stages/${encodeURIComponent(stageId)}/approve`);
  }

  /**
   * The stage that produces an artifact.
   *
   * This is what turns a comment into an action: a review anchored to
   * `artifacts/script.md` can offer to run the stage that produced it, because
   * stages declare what they produce.
   */
  stageProducing(targetPath: string): StageStatus | null {
    if (!targetPath) return null;
    const file = targetPath.split("/").pop() ?? targetPath;
    return this.stages.find((s) => s.produces.includes(file)) ?? null;
  }
}

export const production = new ProductionStore();
