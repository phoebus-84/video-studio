<script lang="ts">
  /**
   * Where the thing in front of you came from, and what depends on it.
   *
   * Every row here is read off the artifact or the level — none of it is
   * inferred. A field the gateway does not report is left out rather than
   * filled with a plausible value, because the whole point of this panel is
   * that you can trust it when deciding whether to rerun something.
   */
  import { files } from "$lib/files-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import { library } from "$lib/library-store.svelte.ts";
  import { studio } from "$lib/studio-store.svelte.ts";
  import { transitiveDownstream } from "$lib/stage-graph";

  interface Row {
    key: string;
    value: string;
  }

  function when(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
  }

  function size(bytes: number | null | undefined): string | null {
    if (typeof bytes !== "number") return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  const fileEntry = $derived(
    files.selectedPath
      ? (files.entries.find((e) => e.path === files.selectedPath) ?? null)
      : null,
  );

  /* A file is showing → describe the file. Otherwise describe the level. */
  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    const push = (key: string, value: string | null | undefined) => {
      if (value) out.push({ key, value });
    };

    if (studio.view === "files" && files.selectedPath) {
      push("path", files.selectedPath);
      push("viewer", files.selectedPresentation?.viewer);
      push("type", files.selectedType);
      push("size", size(fileEntry?.size));
      push("updated", when(fileEntry?.updatedAt));
      push("revision", files.selectedRevision);
      push("versions", files.revisions.length ? String(files.revisions.length) : null);
      push("state", files.dirty ? "unsaved changes" : "saved");
      if (files.viewingRevision) push("showing", "an older version");
      return out;
    }

    const ep = episode.state.phase === "ready" ? episode.state.episode : null;
    if (studio.level === "episode" && ep) {
      push("scope", `episode · ${ep.slug}`);
      push("series", `${ep.channel} / ${ep.series}`);
      push("status", ep.status);
      push("approval", ep.approvalMode);
      push("pipeline", ep.pipeline);
      push("stages", `${ep.stages.length}`);
      push("deliverable", ep.currentDeliverable ?? "none yet");
      push(
        "validated",
        ep.currentDeliverable
          ? ep.currentDeliverableValidated
            ? "yes"
            : "not yet"
          : null,
      );
      push("stale", ep.staleCount > 0 ? `${ep.staleCount}` : "nothing");
      if (typeof ep.budgetSpent === "number" && typeof ep.budgetLimit === "number") {
        push("spend", `$${ep.budgetSpent.toFixed(2)} of $${ep.budgetLimit.toFixed(2)}`);
      }
      push("updated", when(ep.updatedAt));
      return out;
    }

    if (studio.level === "series" && library.selectedSeries) {
      const { channel, series } = library.selectedSeries;
      const entry = library.tree.channels
        .find((c) => c.slug === channel)
        ?.series.find((s) => s.slug === series);
      push("scope", `series · ${series}`);
      push("channel", channel);
      push("episodes", entry ? String(entry.episodes.length) : null);
      push("files", files.entries.length ? String(files.entries.length) : null);
      return out;
    }

    if (studio.level === "channel" && library.selectedChannel) {
      const entry = library.tree.channels.find(
        (c) => c.slug === library.selectedChannel,
      );
      push("scope", `channel · ${library.selectedChannel}`);
      push("series", entry ? String(entry.series.length) : null);
      push(
        "episodes",
        entry
          ? String(entry.series.reduce((n, s) => n + s.episodes.length, 0))
          : null,
      );
      push("files", files.entries.length ? String(files.entries.length) : null);
      return out;
    }

    return out;
  });

  /** What a change here would reach. At episode level that is the stage graph. */
  const dependents = $derived.by(() => {
    const ep = episode.state.phase === "ready" ? episode.state.episode : null;
    if (!ep || !episode.selectedStageId) return [];
    return transitiveDownstream(ep.stages, episode.selectedStageId).map((s) => ({
      name: s.name || s.id,
      effect: "becomes stale",
    }));
  });
</script>

<div class="prov">
  {#if rows.length === 0}
    <p class="prov-empty">Nothing selected.</p>
  {:else}
    <dl class="prov-rows">
      {#each rows as row (row.key)}
        <div class="prov-row">
          <dt>{row.key}</dt>
          <dd>{row.value}</dd>
        </div>
      {/each}
    </dl>

    {#if dependents.length > 0}
      <h3>If you rerun the selected stage</h3>
      {#each dependents as dep (dep.name)}
        <div class="prov-dep">
          <span class="prov-mark" aria-hidden="true">→</span>
          <span class="prov-dep-name">{dep.name}</span>
          <span class="prov-dep-effect">{dep.effect}</span>
        </div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .prov {
    padding: var(--vs-space-3);
  }

  .prov-empty {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    text-align: center;
  }

  .prov-rows {
    margin: 0;
  }

  .prov-row {
    display: flex;
    gap: var(--vs-space-2);
    padding: 5px 0;
    border-bottom: 1px solid var(--vs-border-subtle);
    font-size: var(--vs-text-sm);
  }

  .prov-row dt {
    width: 88px;
    flex-shrink: 0;
    color: var(--vs-text-tertiary);
  }

  .prov-row dd {
    margin: 0;
    flex: 1;
    min-width: 0;
    color: var(--vs-text-primary);
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    word-break: break-word;
  }

  h3 {
    margin: var(--vs-space-4) 0 var(--vs-space-2);
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
    font-weight: var(--vs-font-weight-medium);
  }

  .prov-dep {
    display: flex;
    gap: var(--vs-space-2);
    padding: 4px 0;
    font-size: var(--vs-text-sm);
  }

  .prov-mark {
    color: var(--vs-state-attention);
    width: 12px;
    flex-shrink: 0;
  }

  .prov-dep-name {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
  }

  .prov-dep-effect {
    margin-left: auto;
    font-size: var(--vs-text-xs);
    color: var(--vs-state-attention);
  }
</style>
