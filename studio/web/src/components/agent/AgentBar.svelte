<script lang="ts">
  /**
   * Steer Pi about whatever is on screen.
   *
   * The anchor chip is the point: the message carries what it is about, so
   * "make it slower" does not have to be re-explained. Suggestions fill the
   * input rather than firing immediately — they are openings, not commands, and
   * an accidental click should not start work that costs money.
   */
  import { agent, suggestionsFor } from "$lib/agent-store.svelte.ts";
  import { studio } from "$lib/studio-store.svelte.ts";
  import { library } from "$lib/library-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import { files } from "$lib/files-store.svelte.ts";

  /** What the message is about, in words and as a slug Pi can route on. */
  const anchor = $derived.by(() => {
    const slug = library.selectedEpisode;
    if (studio.view === "files" && files.selectedPath) {
      return {
        episodeSlug: slug,
        stageId: episode.selectedStageId,
        label: files.selectedPath,
      };
    }
    if (slug) {
      const stage = episode.selectedStageId;
      return {
        episodeSlug: slug,
        stageId: stage,
        label: stage ? `${slug.split("/").pop()} · ${stage}` : (slug.split("/").pop() ?? slug),
      };
    }
    if (library.selectedSeries) {
      const { channel, series } = library.selectedSeries;
      return { episodeSlug: null, stageId: null, label: `series · ${channel}/${series}` };
    }
    if (library.selectedChannel) {
      return { episodeSlug: null, stageId: null, label: `channel · ${library.selectedChannel}` };
    }
    return { episodeSlug: null, stageId: null, label: "nothing selected" };
  });

  const suggestions = $derived(
    suggestionsFor(studio.view, files.selectedPresentation?.viewer),
  );

  /* The gateway says which agent is behind the bar; Pi until it answers. */
  $effect(() => {
    void agent.loadName().then((name) => {
      if (studio.agentStatus.kind === "idle" && studio.agentStatus.text === "Pi is idle") {
        studio.agentStatus = { kind: "idle", text: `${name} is idle` };
      }
    });
  });

  async function send() {
    if (agent.sending) return;
    const text = studio.agentDraft;
    studio.agentStatus = { kind: "working", text: "Sending…" };
    const result = await agent.steer(text, anchor);
    studio.agentStatus = result;
    /* Only clear the draft when it actually went somewhere — otherwise the
       message the creator typed would vanish along with the failure. */
    if (result.kind === "working") studio.agentDraft = "";
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }
</script>

<div class="agent-bar">
  <div class="agent-context">
    <span class="agent-anchor" title={anchor.label}>about {anchor.label}</span>
    <span class="agent-status" data-kind={studio.agentStatus.kind} role="status">
      {studio.agentStatus.text}
    </span>

    <div class="agent-suggestions">
      {#each suggestions as suggestion (suggestion)}
        <button class="agent-chip" onclick={() => (studio.agentDraft = suggestion)}>
          {suggestion}
        </button>
      {/each}
    </div>
  </div>

  <div class="agent-input-row">
    <input
      type="text"
      class="agent-input"
      placeholder="Ask {agent.name} to change this, or describe what is wrong…"
      aria-label="Message to {agent.name} about {anchor.label}"
      bind:value={studio.agentDraft}
      onkeydown={onKeydown}
    />
    <button
      class="agent-send"
      onclick={send}
      disabled={agent.sending || studio.agentDraft.trim().length === 0}
    >
      {agent.sending ? "Sending…" : "Send"}
    </button>
  </div>
</div>

<style>
  .agent-bar {
    border-top: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    padding: var(--vs-space-2) var(--vs-space-3);
    flex-shrink: 0;
  }

  .agent-context {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    padding-bottom: 7px;
    overflow: hidden;
  }

  .agent-anchor {
    display: flex;
    align-items: center;
    padding: 2px var(--vs-space-2);
    border: 1px solid var(--vs-accent-subtle);
    background: var(--vs-accent-subtle);
    border-radius: 999px;
    font-size: var(--vs-text-xs);
    color: var(--vs-accent-strong);
    white-space: nowrap;
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
  }

  .agent-status {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A failure to reach Pi is not a neutral status line. */
  .agent-status[data-kind="unavailable"],
  .agent-status[data-kind="error"] {
    color: var(--vs-state-blocked);
  }

  .agent-status[data-kind="working"] {
    color: var(--vs-state-running);
  }

  .agent-suggestions {
    display: flex;
    gap: var(--vs-space-1);
    margin-left: auto;
    min-width: 0;
    overflow-x: auto;
  }

  .agent-chip {
    padding: 2px 9px;
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: 999px;
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
    white-space: nowrap;
  }

  .agent-chip:hover {
    border-color: var(--vs-text-disabled);
    color: var(--vs-text-primary);
  }

  .agent-input-row {
    display: flex;
    gap: var(--vs-space-2);
    align-items: center;
  }

  .agent-input {
    flex: 1;
    padding: var(--vs-space-2);
    background: var(--vs-bg-inset);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-lg);
    color: var(--vs-text-primary);
    font: inherit;
    font-size: var(--vs-text-sm);
    outline: none;
  }

  .agent-input:focus {
    border-color: var(--vs-border-focus);
  }

  .agent-send {
    padding: var(--vs-space-2) var(--vs-space-4);
    background: var(--vs-accent);
    border: none;
    border-radius: var(--vs-radius-lg);
    color: var(--vs-accent-text);
    font: inherit;
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    cursor: pointer;
  }

  .agent-send:hover:not(:disabled) {
    background: var(--vs-accent-hover);
  }

  .agent-send:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
