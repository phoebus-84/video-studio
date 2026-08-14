// ---------------------------------------------------------------------------
// Event publisher — pushes stage transitions to the event bus
// ---------------------------------------------------------------------------
// Polls runtime status periodically and emits events when stages change state.
// Wires file watcher events through to the consolidated event stream.
// ---------------------------------------------------------------------------

import type { EventBus } from "./bus.js";
import { createEvent } from "./bus.js";
import type { WorkspaceWatcher } from "./watcher.js";
import type { RuntimeClient, EpisodeRef } from "../runtime/client.js";

export interface EventPublisherOptions {
  bus: EventBus;
  /** How often to poll runtime status (ms). Default 10s. */
  pollMs?: number;
}

interface StageState {
  id: string;
  state: string;
}

export class EventPublisher {
  private bus: EventBus;
  private pollMs: number;
  private knownStages = new Map<string, StageState[]>();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(options: EventPublisherOptions) {
    this.bus = options.bus;
    this.pollMs = options.pollMs ?? 10_000;
  }

  /** Start polling and watch for events. */
  start(runtime: RuntimeClient, _watcher: WorkspaceWatcher): void {
    // The watcher already publishes workspace events to the bus directly.
    // We just need to poll runtime for pipeline state changes.
    // Store runtime for on-demand polls.
    (this as any)._runtime = runtime;
    this.interval = setInterval(() => {
      this.pollStatus(runtime).catch(() => { /* silent */ });
    }, this.pollMs);

    // Initial poll
    this.pollStatus(runtime).catch(() => {});
  }

  /** Stop polling. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Poll runtime status for the configured episode and emit stage events. */
  async pollForEpisode(ref: EpisodeRef, pipeline?: string): Promise<void> {
    const runtime = (this as any)._runtime as RuntimeClient | undefined;
    if (!runtime) return;
    await this.pollStatus(runtime, ref, pipeline);
  }

  private async pollStatus(
    runtime: RuntimeClient,
    ref?: EpisodeRef,
    pipeline?: string,
  ): Promise<void> {
    // Default to known fairy-tale episode if none specified
    const target: EpisodeRef = ref ?? {
      channel: "childrens",
      series: "fairy-tales",
      episode: "little-red",
    };

    try {
      const result = await runtime.status(target, pipeline);
      if (!result.ok || !result.data?.stages) return;

      const stages = (result.data.stages as StageState[]);
      const key = `${target.channel}/${target.series}/${target.episode}`;
      const previous = this.knownStages.get(key);

      if (previous) {
        // Detect transitions
        for (const s of stages) {
          const prev = previous.find((p: StageState) => p.id === s.id);
          if (!prev || prev.state !== s.state) {
            const eventType = s.state === "completed"
              ? "stage.completed"
              : s.state === "failed"
              ? "stage.failed"
              : s.state === "runnable"
              ? "stage.started"
              : "stage.changed";

            this.bus.publish(createEvent("pipeline", eventType, {
              stageId: s.id,
              previousState: prev?.state ?? "unknown",
              newState: s.state,
              episode: target.episode,
              timestamp: new Date().toISOString(),
            }, target.episode));
          }
        }
      }

      this.knownStages.set(key, stages);
    } catch { /* runtime unreachable */ }
  }
}
