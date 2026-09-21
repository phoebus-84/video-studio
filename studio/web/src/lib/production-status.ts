/**
 * The production status strip.
 *
 * The strip is the one line that is always on screen, so it has to answer
 * "what is this production doing right now, and what can I do about it"
 * without the creator opening anything. Deriving it here — rather than inside
 * the component — keeps the precedence rules testable, because the interesting
 * part is not the markup but which of several true things wins.
 *
 * Precedence, most to least urgent:
 *
 *   offline > blocked > running > stale > current > idle
 *
 * Offline outranks everything because when the gateway is gone every other
 * state on screen is a memory, not a fact, and acting on it would be acting on
 * stale truth. Blocked outranks running because a blocked stage has already
 * stopped; running outranks stale because staleness can wait for the run to
 * finish.
 */

import type { EpisodeWorkspace, ResolvedStage } from "$lib/episode-types";

export type StripKind =
  | "offline"
  | "blocked"
  | "running"
  | "stale"
  | "current"
  | "idle";

/** An action offered by the strip. The shell decides what each id does. */
export interface StripAction {
  id: string;
  label: string;
  /** At most one action per strip is primary. */
  primary: boolean;
}

export interface StatusStrip {
  kind: StripKind;
  /** Short state name, e.g. "Illustrations running". */
  title: string;
  /** One line of specifics. Empty when there is nothing honest to add. */
  detail: string;
  /** 0–1 for running work, null when progress is not meaningful. */
  progress: number | null;
  actions: StripAction[];
}

/**
 * A roll-up of the episodes under a channel or series.
 *
 * With no episode open the strip would otherwise read "No episode selected",
 * which is true and useless. At those levels the useful fact is how many of the
 * things underneath are running, blocked or stale.
 */
export interface LevelRollup {
  label: string;
  total: number;
  running: number;
  blocked: number;
  stale: number;
}

export interface StatusInput {
  connected: boolean;
  episode: EpisodeWorkspace | null;
  /** Set when a channel or series is selected instead of an episode. */
  rollup?: LevelRollup | null;
  /** When the gateway last answered, for the offline strip. */
  lastSeen?: string | null;
}

function stageLabel(stage: ResolvedStage): string {
  return stage.name || stage.id;
}

/** Format a stale count without pretending to know which artifacts they are. */
function staleDetail(episode: EpisodeWorkspace): string {
  const stale = episode.staleness?.stale ?? [];
  if (stale.length > 0) {
    return `${stale.join(", ")} changed after downstream output was produced`;
  }
  return `${episode.staleCount} output${episode.staleCount === 1 ? "" : "s"} depend on something that changed since they were produced`;
}

function timeOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function deriveStatusStrip(input: StatusInput): StatusStrip {
  const { connected, episode } = input;

  /* Offline first: everything below this line would be reported from memory. */
  if (!connected) {
    const seen = timeOnly(input.lastSeen);
    return {
      kind: "offline",
      title: "Gateway offline",
      detail: seen
        ? `showing last known state from ${seen} · editing is disabled, nothing is lost`
        : "editing is disabled, nothing is lost",
      progress: null,
      actions: [
        { id: "reconnect", label: "Reconnect", primary: true },
        { id: "read-only", label: "Work read-only", primary: false },
      ],
    };
  }

  if (!episode) {
    const rollup = input.rollup;
    if (rollup) {
      /* Report the worst thing happening underneath, since that is what the
         creator would want to know before drilling in. */
      const parts: string[] = [];
      if (rollup.running > 0) parts.push(`${rollup.running} running`);
      if (rollup.blocked > 0) parts.push(`${rollup.blocked} blocked`);
      if (rollup.stale > 0) parts.push(`${rollup.stale} stale`);

      const kind: StripKind =
        rollup.blocked > 0
          ? "blocked"
          : rollup.running > 0
            ? "running"
            : rollup.stale > 0
              ? "stale"
              : "idle";

      return {
        kind,
        title: rollup.label,
        detail:
          parts.length > 0
            ? `${rollup.total} episode${rollup.total === 1 ? "" : "s"} · ${parts.join(", ")}`
            : `${rollup.total} episode${rollup.total === 1 ? "" : "s"} · nothing running`,
        progress: null,
        actions: [],
      };
    }

    return {
      kind: "idle",
      title: "No episode selected",
      detail: "Choose an episode from the library to see what it is doing.",
      progress: null,
      actions: [],
    };
  }

  const blocked = episode.stages.find((s) => s.blocked);
  if (blocked || episode.blocked) {
    const stage = blocked ? stageLabel(blocked) : "Episode";
    const reason =
      blocked?.blockedCode ?? episode.blockedReason ?? "blocked by the runtime";
    return {
      kind: "blocked",
      title: `${stage} blocked`,
      detail: reason,
      progress: null,
      actions: [
        { id: "retry", label: "Fix and retry", primary: true },
        { id: "open-log", label: "Open log", primary: false },
      ],
    };
  }

  const running = episode.stages.find((s) => s.status === "running");
  if (running) {
    return {
      kind: "running",
      title: `${stageLabel(running)} running`,
      detail: running.attemptCount
        ? `attempt ${running.attemptCount}`
        : "",
      progress: running.progress,
      actions: [
        { id: "open-log", label: "Open log", primary: false },
        { id: "pause", label: "Pause after this stage", primary: false },
      ],
    };
  }

  /* The episode can report itself as running while no individual stage does —
     between stages, or when the runtime has not attributed the work yet.
     Calling that "idle" would contradict the library beside it. */
  if (episode.status === "running") {
    const done = episode.stages.filter((s) => s.status === "completed").length;
    return {
      kind: "running",
      title: "Episode running",
      detail: `${done} of ${episode.stages.length} stages complete · no stage has reported itself active`,
      progress: null,
      actions: [
        { id: "open-log", label: "Open log", primary: false },
        { id: "pause", label: "Pause after this stage", primary: false },
      ],
    };
  }

  if (episode.staleCount > 0) {
    return {
      kind: "stale",
      title: `${episode.staleCount} output${episode.staleCount === 1 ? " is" : "s are"} stale`,
      detail: staleDetail(episode),
      progress: null,
      actions: [
        /* A studio action id, not a `RerunMode`. Named "rerun-stale" rather
           than "rerun-affected" precisely so nobody wires it straight into
           /rerun-plan as a mode: "rerun-affected" matches no member of
           `RerunMode` and the schema now rejects it. */
        { id: "rerun-stale", label: "Rerun affected only", primary: true },
        { id: "show-stale", label: "Show what changed", primary: false },
        { id: "accept", label: "Accept as-is", primary: false },
      ],
    };
  }

  if (episode.currentDeliverable) {
    const verified = timeOnly(episode.updatedAt);
    return {
      kind: "current",
      title: "Deliverable current",
      detail:
        episode.currentDeliverable +
        (episode.currentDeliverableValidated
          ? ` · every dependency current${verified ? ` · verified ${verified}` : ""}`
          : " · not yet validated"),
      progress: null,
      actions: [
        { id: "open-render", label: "Open render", primary: true },
        { id: "reveal", label: "Reveal in Finder", primary: false },
      ],
    };
  }

  return {
    kind: "idle",
    title: "Idle",
    detail: "No stage is running and there is no deliverable yet.",
    progress: null,
    actions: [{ id: "run", label: "Run the pipeline", primary: true }],
  };
}

/** CSS custom-property suffix for a strip kind, e.g. `--vs-state-running`. */
export const STRIP_STATE: Record<StripKind, string> = {
  offline: "stale",
  blocked: "blocked",
  running: "running",
  stale: "attention",
  current: "current",
  idle: "stale",
};
