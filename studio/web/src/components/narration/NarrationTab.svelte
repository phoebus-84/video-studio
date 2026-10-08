<script lang="ts">
  /**
   * The Narration tab (avg-goz): a spec-driven episode's registered takes;
   * any other episode's narration segments, as before.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { episodeApi, parseEpisodeKey } from "$lib/sheet-review";
  import type { NarrationTakesAnswer } from "$lib/narration-takes";
  import NarrationPanel from "./NarrationPanel.svelte";
  import TakesPanel from "./TakesPanel.svelte";

  const ref = $derived(parseEpisodeKey(library.selectedEpisode));
  let answer = $state<NarrationTakesAnswer | null>(null);
  let error = $state<string | null>(null);
  let shownFor: { channel: string; series: string; episode: string } | null = null;

  $effect(() => {
    const at = ref;
    // a reload keeps what is shown until the new answer comes; another episode starts afresh
    if (at?.channel !== shownFor?.channel || at?.series !== shownFor?.series || at?.episode !== shownFor?.episode) answer = null;
    error = null;
    if (!at) return;
    let live = true;
    getGatewayClient().fetchJSON<NarrationTakesAnswer>(`${episodeApi(at)}/narration-takes`)
      .then((a) => { if (live) { answer = a; shownFor = at; } })
      .catch((err) => { if (live) error = err instanceof Error ? err.message : String(err); });
    return () => { live = false; };
  });
</script>

{#if answer?.specDriven}
  <TakesPanel {answer} />
{:else if error}
  <!-- an older gateway, or one that failed: the episode's other view, as before -->
  <p class="tab-note" role="alert">{error}</p>
  <NarrationPanel />
{:else if !ref || answer}
  <NarrationPanel />
{:else}
  <p class="tab-note" role="status">Loading…</p>
{/if}

<style>
  .tab-note { padding: var(--vs-space-4); color: var(--vs-text-secondary); font-size: var(--vs-text-sm); }
</style>
