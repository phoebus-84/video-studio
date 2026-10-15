/**
 * Steering Pi from the agent bar.
 *
 * The bar is not a chat window. It sends one intent about one anchored subject
 * — the open file, the selected stage, or the level you are looking at — and
 * reports what came back. Conversation is not the primary representation of
 * production here; the workbench is, and this is a way to act on it in words.
 *
 * Every send goes to the gateway's `/api/intent` route, which forwards to Pi.
 * When that route is unreachable the bar says so instead of showing an
 * encouraging "Pi is working on it…" that nothing is behind.
 */

import { getGatewayClient } from "./gateway.svelte.ts";
import type { AgentStatus } from "./studio-store.svelte.ts";

export type Intent =
  | "prompt"
  | "steer"
  | "follow-up"
  | "approve"
  | "rerun"
  | "edit"
  | "review"
  | "cancel";

export interface IntentResult {
  success: boolean;
  action: string;
  status: "accepted" | "rejected" | "queued" | "error";
  data: Record<string, unknown>;
}

/** What the message is about, so Pi is not guessing which artifact you mean. */
export interface Anchor {
  /** `channel/series/episode`, the slug the intent router expects. */
  episodeSlug: string | null;
  stageId?: string | null;
  /** Human label shown on the bar's anchor chip. */
  label: string;
}

class AgentStore {
  sending = $state(false);
  /** The agent's name as the gateway reports it: Pi, or Claude (AVG_AGENT_BACKEND). */
  name = $state("Pi");
  #named = false;

  /** Ask the gateway which agent it runs. Once; Pi until it answers. */
  async loadName(): Promise<string> {
    if (!this.#named) {
      this.#named = true;
      try {
        const root = await getGatewayClient().fetchJSON<{ agent?: { label?: string } | null }>("/");
        if (root.agent?.label) this.name = root.agent.label;
      } catch {
        /* An unreachable gateway is reported when a message is sent. */
      }
    }
    return this.name;
  }

  /**
   * Send guidance about the current anchor.
   *
   * Returns the status the bar should display, so the caller does not have to
   * duplicate the success and failure wording.
   */
  async steer(text: string, anchor: Anchor): Promise<AgentStatus> {
    const guidance = text.trim();
    if (!guidance) return { kind: "idle", text: "Nothing to send" };

    /* Pi works per episode. Channel- and series-level guidance has nowhere to
       go yet, and saying so beats dropping the message silently. */
    if (!anchor.episodeSlug) {
      return {
        kind: "unavailable",
        text: `${this.name} takes guidance per episode — open one to steer it`,
      };
    }

    this.sending = true;
    try {
      const result = await getGatewayClient().fetchJSON<IntentResult>(
        "/api/intent",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent: "steer" satisfies Intent,
            episodeSlug: anchor.episodeSlug,
            ...(anchor.stageId ? { stageId: anchor.stageId } : {}),
            payload: { guidance, about: anchor.label },
          }),
        },
      );

      if (result.status === "accepted" || result.status === "queued") {
        return { kind: "working", text: `${this.name} ${result.action} · about ${anchor.label}` };
      }
      return {
        kind: "error",
        text: `${this.name} rejected that: ${String(result.data?.["reason"] ?? result.action)}`,
      };
    } catch (err) {
      return {
        kind: "unavailable",
        text:
          err instanceof Error
            ? `Could not reach ${this.name} — ${err.message}`
            : `Could not reach ${this.name}`,
      };
    } finally {
      this.sending = false;
    }
  }
}

export const agent = new AgentStore();

/**
 * Suggestions offered next to the bar.
 *
 * These are starting points for the message, not commands — clicking one fills
 * the input so it can be edited before it is sent. They are keyed by what is
 * actually on screen, because "Trim segment 3" is noise when you are looking at
 * a manifest.
 */
export function suggestionsFor(
  view: string,
  viewer: string | undefined,
): string[] {
  if (view === "files") {
    switch (viewer) {
      case "image":
        return ["Regenerate without lettering", "Use this style for the next scene"];
      case "audio":
        return ["Try a slower read", "Resynthesise from the current script"];
      case "video":
        return ["Fix the caption overflow", "Rerender only the changed scene"];
      case "text":
      case "markdown":
        return ["Tighten this", "Show what this makes stale"];
      default:
        return ["Explain this file", "Show what depends on it"];
    }
  }
  switch (view) {
    case "stages":
      return ["Why did this stop?", "Rerun what is stale", "Summarise this episode"];
    case "pipeline":
      return ["Generate a pipeline", "Change the visual style"];
    case "storyboard":
      return ["Replace this scene's image", "Restyle the storyboard"];
    case "narration":
      return ["Try a slower read", "Resynthesise the drifted segment"];
    case "audio":
      return ["Lengthen the pauses to the reference", "Join the best parts of two takes", "Put a bed under the voice"];
    case "render":
      return ["Fix the caption overflow", "Rerender only the changed scene"];
    default:
      return ["Start a new series", "Audit brand consistency"];
  }
}
