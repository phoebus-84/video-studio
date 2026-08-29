<script lang="ts">
  /**
   * Spend against the episode's cap.
   *
   * Generation costs real money and the cap is the thing standing between a
   * long run and a surprise, so it belongs in the header where it is legible
   * without opening anything — not on a billing screen.
   *
   * It renders nothing when there is no cap to compare against. A bar with no
   * ceiling would imply a limit that is not enforced.
   */
  interface Props {
    spent: number | null;
    limit: number | null;
  }

  let { spent, limit }: Props = $props();

  const show = $derived(
    typeof spent === "number" && typeof limit === "number" && limit > 0,
  );

  const fraction = $derived(show ? Math.min(spent! / limit!, 1) : 0);

  /* Over 90% of the cap the bar stops being neutral information. */
  const state = $derived(
    fraction >= 1 ? "over" : fraction > 0.9 ? "near" : "under",
  );

  function usd(n: number): string {
    return `$${n.toFixed(2)}`;
  }
</script>

{#if show}
  <div
    class="spend"
    data-state={state}
    role="meter"
    aria-valuemin={0}
    aria-valuemax={limit}
    aria-valuenow={spent}
    aria-label="Episode spend against cap"
  >
    <span class="spend-label">spend</span>
    <span class="spend-value">{usd(spent!)}</span>
    <span class="spend-cap">/ {usd(limit!)}</span>
    <span class="spend-track" aria-hidden="true">
      <span class="spend-fill" style="width: {(fraction * 100).toFixed(1)}%"></span>
    </span>
  </div>
{/if}

<style>
  .spend {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    padding: 3px var(--vs-space-2);
    border: 1px solid var(--vs-border);
    border-radius: 999px;
    white-space: nowrap;
  }

  .spend-label {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .spend-value {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-primary);
  }

  .spend-cap {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-disabled);
  }

  .spend-track {
    display: block;
    width: 44px;
    height: 4px;
    border-radius: 2px;
    background: var(--vs-border);
    overflow: hidden;
  }

  .spend-fill {
    display: block;
    height: 100%;
    background: var(--vs-accent);
  }

  /* Colour is reinforced by the number beside it, which is already exact. */
  .spend[data-state="near"] .spend-fill {
    background: var(--vs-state-attention);
  }

  .spend[data-state="over"] .spend-fill {
    background: var(--vs-state-blocked);
  }

  .spend[data-state="over"] .spend-value {
    color: var(--vs-state-blocked);
  }
</style>
