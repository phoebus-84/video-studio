<script lang="ts">
  /**
   * The Storyboard tab (avg-goz): a spec-driven episode's layout sheet and
   * its review; any other episode's scenes, as before.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { episodeApi, parseEpisodeKey, type LayoutSheetAnswer } from "$lib/sheet-review";
  import Storyboard from "./Storyboard.svelte";
  import SheetReview from "./SheetReview.svelte";

  const ref = $derived(parseEpisodeKey(library.selectedEpisode));
  let answer = $state<LayoutSheetAnswer | null>(null);
  let error = $state<string | null>(null);
  let shownFor: { channel: string; series: string; episode: string } | null = null;
  let reloads = $state(0);

  $effect(() => {
    const at = ref;
    void reloads;
    // a reload keeps what is shown until the new answer comes; another episode starts afresh
    if (at?.channel !== shownFor?.channel || at?.series !== shownFor?.series || at?.episode !== shownFor?.episode) answer = null;
    error = null;
    if (!at) return;
    let live = true;
    getGatewayClient().fetchJSON<LayoutSheetAnswer>(`${episodeApi(at)}/layout-sheet`)
      .then((a) => { if (live) { answer = a; shownFor = at; } })
      .catch((err) => { if (live) error = err instanceof Error ? err.message : String(err); });
    return () => { live = false; };
  });
</script>

{#if ref && answer?.specDriven}
  <SheetReview {ref} {answer} onReviewed={() => (reloads += 1)} />
{:else if error}
  <!-- an older gateway, or one that failed: the episode's other view, as before -->
  <p class="tab-note" role="alert">{error}</p>
  <Storyboard />
{:else if !ref || answer}
  <Storyboard />
{:else}
  <p class="tab-note" role="status">Loading…</p>
{/if}

<style>
  .tab-note { padding: var(--vs-space-4); color: var(--vs-text-secondary); font-size: var(--vs-text-sm); }
</style>
