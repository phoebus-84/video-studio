/**
 * Driving a production from the studio.
 *
 * The studio could read and edit but never act: it called thirteen endpoints
 * and none of them were /execute, /approve or /snapshot. You could comment on
 * a scene and have no way to ask for it again.
 *
 * This is the acting half — stage status, and the four things you can do about
 * it. Every action reports what the runtime actually said; nothing here
 * pretends to have succeeded.
 */

import { getGatewayClient } from "./gateway.svelte.ts";

export interface StageStatus {
  id: string;
  /** runnable, pending, blocked, complete… as reported by the runtime. */
  state: string;
  dependsOn: string[];
  /** Artifact labels this stage produces, e.g. ["script.md"]. */
  produces: string[];
}

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

/** What the studio is allowed to offer for a stage in a given state. */
export function actionsFor(state: string): Array<"run" | "approve"> {
  if (state === "runnable") return ["run"];
  if (state === "awaiting_approval" || state === "awaiting_review") return ["approve"];
  // A complete stage can be run again; a blocked or pending one cannot, because
  // its dependencies have not been satisfied yet.
  if (state === "complete" || state === "completed") return ["run"];
  return [];
}

class ProductionStore {
  ref = $state<EpisodeRef | null>(null);
  stages = $state<StageStatus[]>([]);
  pipeline = $state<string | null>(null);

  loading = $state(false);
  /** Stage id currently running an action, so the UI can disable it. */
  busyStage = $state<string | null>(null);
  error = $state<string | null>(null);
  /** Last thing the runtime said, shown verbatim rather than summarised. */
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
        error?: string;
      }>(`${this.#base()}/status`);

      if (!res.ok) {
        // An episode with no snapshot is a normal state, not a failure: it has
        // simply never been resolved. Say so, and offer the fix.
        this.needsSnapshot = /pipeline not found/i.test(res.error ?? "");
        this.error = this.needsSnapshot ? null : (res.error ?? "Status failed");
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
        error?: string;
        data?: { message?: string };
        message?: string;
        snapshot?: { message?: string };
      }>(`${this.#base()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok === false) {
        this.error = res.error ?? "The runtime refused that";
        return;
      }
      this.lastMessage = res.data?.message ?? res.snapshot?.message ?? res.message ?? "Done";
      await this.load(this.ref);
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
