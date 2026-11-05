// ---------------------------------------------------------------------------
// Event publisher — pushes stage transitions to the event bus
// ---------------------------------------------------------------------------
// Polls the execution service periodically and emits events when stages change
// state. Wires file watcher events through to the consolidated event stream.
//
// It used to poll `RuntimeClient.status`, which shells out to `vpr status`,
// and matched stages across polls with `previous.find(p => p.id === s.id)`.
// The status report names its stages `stageId`, so `s.id` was `undefined` on
// both sides: every stage matched the first one in the list, and every event
// this class published named `stageId: undefined`. Nothing caught it because
// nothing tested this file.
// ---------------------------------------------------------------------------

import type { EventBus } from "./bus.js";
import { createEvent } from "./bus.js";
import type { WorkspaceWatcher } from "./watcher.js";
import type { EpisodeRef } from "../runtime/client.js";
import { makeExecutionService, DEFAULT_PIPELINE } from "../runtime/service.js";

export interface EventPublisherOptions {
  bus: EventBus;
  /** How often to poll the execution service (ms). Default 10s. */
  pollMs?: number;
  /**
   * Where the library lives. The server resolves this once; required,
   * because a publisher that fell back to `AVG_LIBRARY_ROOT ?? "./library"`
   * would poll a different tree from the one the gateway serves whenever the
   * root came from `libraryRoots` rather than the environment.
   */
  libraryRoot: string;
  /**
   * The operator's credential (avg-qr4.3), threaded through to the execution
   * service like `libraryRoot`. This poll only reads status — it never
   * writes a review — but the review gate needs the key to verify a human
   * receipt it finds. `null` for a caller with none.
   *
   * Required, not optional, for the reason `makeExecutionService` gives: an
   * optional key is an invitation for one caller to keep quietly passing
   * `undefined` while every other one threads the resolved key. The review
   * gate verifies human receipts with it, so the caller that forgot would
   * report every operator approval as unverifiable — awaiting review
   * forever — and nobody would notice until an operator asked why.
   */
  operatorKey: string | null;
}

/**
 * The half of `StageStatusReport` this class compares between polls.
 *
 * `stageId`, not `id`: it is what the report carries, and a local interface
 * that renamed it was what let the mismatch above typecheck.
 */
interface StageState {
  stageId: string;
  state: string;
}

export class EventPublisher {
  private bus: EventBus;
  private pollMs: number;
  private libraryRoot: string;
  private operatorKey: string | null;
  private knownStages = new Map<string, StageState[]>();
  private watched = new Map<string, { ref: EpisodeRef; pipeline?: string }>();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(options: EventPublisherOptions) {
    this.bus = options.bus;
    this.pollMs = options.pollMs ?? 10_000;
    this.libraryRoot = options.libraryRoot;
    this.operatorKey = options.operatorKey;
  }

  /** Start polling and watch for events. */
  start(_watcher: WorkspaceWatcher): void {
    // The watcher already publishes workspace events to the bus directly.
    // We just need to poll for pipeline state changes, of the episodes some
    // caller has asked about (pollForEpisode): the gateway knows no episode
    // of its own.
    this.interval = setInterval(() => {
      this.pollWatched().catch(() => { /* silent */ });
    }, this.pollMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Poll one episode's status and emit stage events; the interval polls it from then on. */
  async pollForEpisode(ref: EpisodeRef, pipeline?: string): Promise<void> {
    this.watched.set(`${ref.channel}/${ref.series}/${ref.episode}`, { ref, pipeline });
    await this.pollStatus(ref, pipeline);
  }

  private async pollWatched(): Promise<void> {
    for (const { ref, pipeline } of [...this.watched.values()]) {
      await this.pollStatus(ref, pipeline);
    }
  }

  private async pollStatus(target: EpisodeRef, pipeline?: string): Promise<void> {
    try {
      const service = makeExecutionService(() => {}, this.libraryRoot, this.operatorKey);
      const result = await service.status(target, pipeline ?? DEFAULT_PIPELINE);
      if (!result.ok) return;

      const stages: StageState[] = result.value.stages.map((s) => ({
        stageId: s.stageId,
        state: s.state,
      }));
      const key = `${target.channel}/${target.series}/${target.episode}`;
      const previous = this.knownStages.get(key);

      if (previous) {
        // Detect transitions
        for (const s of stages) {
          const prev = previous.find((p) => p.stageId === s.stageId);
          if (!prev || prev.state !== s.state) {
            const eventType = s.state === "completed"
              ? "stage.completed"
              : s.state === "failed"
              ? "stage.failed"
              : s.state === "running"
              ? "stage.started"
              : "stage.changed";

            this.bus.publish(createEvent("pipeline", eventType, {
              stageId: s.stageId,
              previousState: prev?.state ?? "unknown",
              newState: s.state,
              episode: target.episode,
              timestamp: new Date().toISOString(),
            }, target.episode));
          }
        }
      }

      this.knownStages.set(key, stages);
    } catch { /* the episode could not be read */ }
  }
}
