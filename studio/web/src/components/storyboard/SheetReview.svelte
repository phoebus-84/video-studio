<script lang="ts">
  /**
   * The Storyboard of a spec-driven episode (avg-goz): its layout sheet, still
   * by still, and the operator's review of it — the same signed review as
   * `vpr sheet approve|reject`, made by the gateway with the operator key
   * this browser holds. Without that key the review stays with the operator.
   */
  import { onDestroy } from "svelte";
  import { getGatewayClient, hasOperatorKey } from "$lib/gateway.svelte.ts";
  import { episodeMediaUrl } from "$lib/episode-media";
  import {
    episodeApi, formatSheetTime, nextStill, sheetStatusLine,
    type EpisodeRef, type LayoutSheetAnswer,
  } from "$lib/sheet-review";

  let { ref, answer, onReviewed }: { ref: EpisodeRef; answer: LayoutSheetAnswer; onReviewed: () => void } = $props();

  const operator = hasOperatorKey();
  let urls = $state<Record<string, string>>({});
  let open = $state<number | null>(null);
  let rejecting = $state(false);
  let note = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  const status = $derived(sheetStatusLine(answer));
  const frames = $derived(answer.sheet?.frames ?? []);
  const shown = $derived(open === null ? undefined : frames[open]);

  // The stills, fetched with the bearer header; revoked when they change or the panel goes.
  $effect(() => {
    const list = frames;
    const made: string[] = [];
    let live = true;
    for (const still of list) {
      void episodeMediaUrl(ref, still.path).then((url) => {
        if (!url) return;
        if (!live) return URL.revokeObjectURL(url);
        made.push(url);
        urls = { ...urls, [still.path]: url };
      });
    }
    return () => {
      live = false;
      for (const url of made) URL.revokeObjectURL(url);
      urls = {};
    };
  });
  onDestroy(() => {
    for (const url of Object.values(urls)) URL.revokeObjectURL(url);
  });

  async function review(decision: "approved" | "rejected") {
    if (!answer.sheet) return;
    busy = true;
    error = null;
    try {
      await getGatewayClient().fetchJSON(`${episodeApi(ref)}/layout-sheet/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, sheetHash: answer.sheet.grid.hash, ...(decision === "rejected" ? { note } : {}) }),
      });
      rejecting = false;
      note = "";
      onReviewed();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  // The lightbox takes the focus while open, keeps Tab inside it, and gives it back to the still it came from.
  let closeButton = $state<HTMLButtonElement | null>(null);
  let dialog = $state<HTMLElement | null>(null);
  let returnTo: HTMLElement | null = null;
  function show(index: number, from: EventTarget | null) {
    returnTo = from instanceof HTMLElement ? from : null;
    open = index;
  }
  function close() {
    open = null;
    returnTo?.focus();
    returnTo = null;
  }
  $effect(() => {
    if (open !== null) closeButton?.focus();
  });

  function keys(event: KeyboardEvent) {
    if (open === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      open = nextStill(open, frames.length, 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      open = nextStill(open, frames.length, -1);
    } else if (event.key === "Tab" && dialog) {
      const stops = [...dialog.querySelectorAll<HTMLElement>("button")];
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
</script>

<svelte:window onkeydown={keys} />

<section class="sheet-review" aria-label="Layout sheet">
  <header class="sr-header">
    <h3 class="sr-title">Layout sheet</h3>
    {#if answer.sheet}
      <span class="sr-meta">
        {frames.length} stills · {answer.sheet.rules ?? "—"}{answer.sheet.createdAt ? ` · made ${answer.sheet.createdAt}` : ""}
      </span>
    {/if}
  </header>

  <div class="sr-status" data-tone={status.tone} role="status">
    <span class="sr-status-mark" aria-hidden="true">{status.tone === "ok" ? "✓" : status.tone === "bad" ? "✕" : status.tone === "warn" ? "!" : "·"}</span>
    <span>{status.text}</span>
  </div>

  {#if answer.sheet && status.reviewable}
    <div class="sr-actions">
      {#if operator}
        <p class="sr-consequence">
          Approving lets the render start from this exact sheet; making the sheet again, or a changed timeline, clears it.
        </p>
        {#if rejecting}
          <label class="sr-note">
            <span>What is wrong (it goes to Pi and the journal)</span>
            <textarea bind:value={note} rows="2" placeholder="the guide's hand covers the gloss at 04:43"></textarea>
          </label>
          <div class="sr-buttons">
            <button class="sr-button sr-reject" disabled={busy || !note.trim()} onclick={() => review("rejected")}>Reject with this note</button>
            <button class="sr-button" disabled={busy} onclick={() => { rejecting = false; note = ""; }}>Cancel</button>
          </div>
        {:else}
          <div class="sr-buttons">
            <button class="sr-button sr-approve" disabled={busy} onclick={() => review("approved")}>{busy ? "Signing…" : "Approve sheet"}</button>
            <button class="sr-button" disabled={busy} onclick={() => (rejecting = true)}>Reject…</button>
          </div>
        {/if}
      {:else}
        <p class="sr-consequence">Sign in as operator in the header to review. Pi can make and read the sheet, never approve it.</p>
      {/if}
      {#if error}<p class="sr-error" role="alert">{error}</p>{/if}
    </div>
  {/if}

  {#if frames.length}
    <ol class="sr-grid" style:--sr-columns={answer.sheet?.columns ?? 6}>
      {#each frames as still (still.path)}
        <li class="sr-still">
          <button class="sr-thumb" onclick={(event) => show(still.index, event.currentTarget)} aria-label={`Still ${still.index}, ${formatSheetTime(still.seconds)}, ${still.label}`}>
            {#if urls[still.path]}
              <img src={urls[still.path]} alt="" loading="lazy" />
            {:else}
              <span class="sr-placeholder" aria-hidden="true"></span>
            {/if}
          </button>
          <span class="sr-caption"><span class="sr-num">#{String(still.index).padStart(2, "0")}</span> <span class="sr-time">{formatSheetTime(still.seconds)}</span> {still.label}</span>
        </li>
      {/each}
    </ol>
  {/if}

  {#if shown}
    {@const still = shown}
    <div class="sr-lightbox" role="dialog" aria-modal="true" aria-label={`Still ${still.index}`} bind:this={dialog}>
      <button class="sr-backdrop" aria-label="Close" tabindex="-1" onclick={close}></button>
      <figure class="sr-figure">
        {#if urls[still.path]}<img src={urls[still.path]} alt={still.label} />{/if}
        <figcaption>
          <button class="sr-button" onclick={() => (open = nextStill(open ?? 0, frames.length, -1))} aria-label="Previous still">←</button>
          <span class="sr-num">#{String(still.index).padStart(2, "0")}</span>
          <span class="sr-time">{formatSheetTime(still.seconds)}</span>
          <span>{still.label}</span>
          <button class="sr-button" onclick={() => (open = nextStill(open ?? 0, frames.length, 1))} aria-label="Next still">→</button>
          <button class="sr-button" onclick={close} aria-label="Close" bind:this={closeButton}>Esc</button>
        </figcaption>
      </figure>
    </div>
  {/if}
</section>

<style>
  .sheet-review { display: flex; flex-direction: column; gap: var(--vs-space-3); padding: var(--vs-space-4); overflow: auto; height: 100%; }
  .sr-header { display: flex; align-items: baseline; gap: var(--vs-space-3); }
  .sr-title { margin: 0; font-size: var(--vs-text-md); font-weight: var(--vs-font-weight-semibold); color: var(--vs-text-primary); }
  .sr-meta { font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); font-family: var(--vs-font-mono); }
  .sr-status { display: flex; gap: var(--vs-space-2); align-items: center; padding: var(--vs-space-2) var(--vs-space-3); border-radius: var(--vs-radius-sm); font-size: var(--vs-text-sm); color: var(--vs-text-secondary); background: var(--vs-bg-inset); }
  .sr-status[data-tone="ok"] { color: var(--vs-state-current); background: var(--vs-state-current-bg); }
  .sr-status[data-tone="bad"] { color: var(--vs-state-blocked); background: var(--vs-state-blocked-bg); }
  .sr-status[data-tone="warn"] { color: var(--vs-state-stale); background: var(--vs-state-stale-bg); }
  .sr-status-mark { font-weight: var(--vs-font-weight-semibold); }
  .sr-actions { display: flex; flex-direction: column; gap: var(--vs-space-2); }
  .sr-consequence { margin: 0; font-size: var(--vs-text-sm); color: var(--vs-text-secondary); max-width: 70ch; }
  .sr-buttons { display: flex; gap: var(--vs-space-2); }
  .sr-button { font: inherit; font-size: var(--vs-text-sm); padding: var(--vs-space-1) var(--vs-space-3); border: 1px solid var(--vs-border); border-radius: var(--vs-radius-sm); background: var(--vs-bg-raised); color: var(--vs-text-primary); cursor: pointer; }
  .sr-button:hover:not(:disabled) { background: var(--vs-bg-hover); }
  .sr-button:focus-visible, .sr-thumb:focus-visible { outline: 2px solid var(--vs-border-focus); outline-offset: 1px; }
  .sr-button:disabled { color: var(--vs-text-disabled); cursor: default; }
  .sr-approve { background: var(--vs-accent-strong); border-color: var(--vs-accent-strong); color: var(--vs-accent-text); }
  .sr-approve:hover:not(:disabled) { background: var(--vs-accent-strong-hover); }
  .sr-reject { border-color: var(--vs-danger); color: var(--vs-danger); }
  .sr-note { display: flex; flex-direction: column; gap: var(--vs-space-1); font-size: var(--vs-text-sm); color: var(--vs-text-secondary); max-width: 70ch; }
  .sr-note textarea { font: inherit; padding: var(--vs-space-2); border: 1px solid var(--vs-border); border-radius: var(--vs-radius-sm); background: var(--vs-bg-surface); color: var(--vs-text-primary); }
  .sr-error { margin: 0; color: var(--vs-danger); font-size: var(--vs-text-sm); }
  .sr-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--vs-space-3); }
  .sr-still { display: flex; flex-direction: column; gap: var(--vs-space-1); min-width: 0; }
  .sr-thumb { padding: 0; border: 1px solid var(--vs-border-subtle); border-radius: var(--vs-radius-sm); background: var(--vs-bg-inset); cursor: zoom-in; aspect-ratio: 16 / 9; overflow: hidden; }
  .sr-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .sr-placeholder { display: block; width: 100%; height: 100%; }
  .sr-caption { font-size: var(--vs-text-xs); color: var(--vs-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sr-num, .sr-time { font-family: var(--vs-font-mono); color: var(--vs-text-tertiary); }
  .sr-lightbox { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; }
  .sr-backdrop { position: absolute; inset: 0; border: 0; background: color-mix(in srgb, var(--vs-bg-canvas) 85%, transparent); cursor: zoom-out; }
  .sr-figure { position: relative; margin: 0; max-width: min(92vw, 1600px); display: flex; flex-direction: column; gap: var(--vs-space-2); background: var(--vs-bg-panel); padding: var(--vs-space-3); border-radius: var(--vs-radius-md); box-shadow: var(--vs-shadow-modal); }
  .sr-figure img { width: 100%; height: auto; max-height: 80vh; object-fit: contain; image-rendering: auto; }
  .sr-figure figcaption { display: flex; gap: var(--vs-space-3); align-items: center; font-size: var(--vs-text-sm); color: var(--vs-text-secondary); }
  @media (prefers-reduced-motion: no-preference) {
    .sr-button, .sr-thumb { transition: background var(--vs-duration-fast) var(--vs-ease-standard); }
  }
</style>
