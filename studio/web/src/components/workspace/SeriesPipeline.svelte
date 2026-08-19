<script lang="ts">
  /**
   * The pipeline every episode in this series resolves from.
   *
   * Episodes freeze a copy of the manifest when they are produced, so changing
   * it here does not retroactively change anything already rendered. That is
   * the single most important thing to say on this screen, and it is said in
   * plain text at the bottom rather than implied.
   */
  import { files } from "$lib/files-store.svelte.ts";
  import { studio } from "$lib/studio-store.svelte.ts";
  import { parsePipelineManifest } from "$lib/pipeline-manifest";

  const MANIFEST_NAMES = ["pipeline.yaml", "pipeline.yml"];

  const manifestEntry = $derived(
    files.entries.find(
      (e) => e.kind === "file" && MANIFEST_NAMES.includes(e.name),
    ) ?? null,
  );

  let source = $state<string | null>(null);
  let loadError = $state<string | null>(null);

  /* Read the manifest directly rather than opening it into a tab: this view is
     about the shape of the pipeline, not about editing the file. */
  $effect(() => {
    const entry = manifestEntry;
    const ref = files.ref;
    if (!entry || !ref) {
      source = null;
      return;
    }

    let cancelled = false;
    loadError = null;

    files
      .readText(entry.path)
      .then((text) => {
        if (cancelled) return;
        if (text === null) loadError = "Could not read the manifest.";
        source = text;
      })
      .catch(() => {
        if (!cancelled) loadError = "Could not read the manifest.";
      });

    return () => {
      cancelled = true;
    };
  });

  const parsed = $derived(source === null ? null : parsePipelineManifest(source));

  function openManifest() {
    if (!manifestEntry) return;
    void files.open(manifestEntry);
    studio.openFile(manifestEntry.path);
  }
</script>

<div class="pipeline">
  {#if !manifestEntry}
    <p class="pl-note">
      This series has no <code>pipeline.yaml</code>. Its episodes resolve the
      channel default instead.
    </p>
  {:else}
    <section class="pl-card">
      <header>
        <div>
          <h2>{manifestEntry.name}</h2>
          <p class="pl-sub">
            Every episode in this series resolves a frozen copy of this manifest.
          </p>
        </div>
        <button onclick={openManifest}>Open manifest</button>
      </header>

      {#if loadError}
        <p class="pl-note pl-error" role="alert">{loadError}</p>
      {:else if parsed === null}
        <p class="pl-note" role="status">Reading the manifest…</p>
      {:else if !parsed.recognised}
        <!-- A series manifest commonly names a pipeline instead of spelling out
             its stages; the chain then lives wherever that pipeline is defined,
             and an episode's Stages view is where it can actually be seen. -->
        {#if parsed.name}
          <p class="pl-note">
            This manifest names the pipeline
            <code class="pl-name">{parsed.name}</code> rather than listing
            stages. Open an episode's Stages view to see the chain it resolves
            to.
          </p>
        {:else}
          <p class="pl-note">
            No <code>stages:</code> block and no <code>pipeline:</code> name
            found, so there is no chain to draw. Open the manifest to read it as
            written.
          </p>
        {/if}
      {:else if parsed.stages.length === 0}
        <p class="pl-note">The stage list is empty.</p>
      {:else}
        <ol class="pl-chain">
          {#each parsed.stages as stage, i (stage.id)}
            <li>
              <span class="pl-stage">
                <span class="pl-stage-name">{stage.id}</span>
                {#if stage.capability}
                  <span class="pl-stage-meta">{stage.capability}</span>
                {/if}
                {#if stage.provider}
                  <span class="pl-stage-meta">{stage.provider}</span>
                {/if}
              </span>
              {#if i < parsed.stages.length - 1}
                <span class="pl-link" aria-hidden="true"></span>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <p class="pl-footnote">
      Editing this manifest changes what new runs resolve. Episodes already
      produced keep the snapshot they were made with — nothing already rendered
      changes until you rerun it.
    </p>
  {/if}
</div>

<style>
  .pipeline {
    padding: var(--vs-space-4) var(--vs-space-5);
    overflow: auto;
    display: grid;
    gap: var(--vs-space-4);
    align-content: start;
    min-width: 0;
  }

  .pl-card {
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-lg);
    background: var(--vs-bg-surface);
    padding: var(--vs-space-4);
  }

  .pl-card header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--vs-space-3);
    padding-bottom: var(--vs-space-3);
  }

  .pl-card h2 {
    margin: 0;
    font-size: var(--vs-text-base);
    font-weight: var(--vs-font-weight-semibold);
    font-family: var(--vs-font-mono);
  }

  .pl-sub {
    margin: 2px 0 0;
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .pl-card header button {
    padding: 4px 10px;
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
    flex-shrink: 0;
  }

  .pl-card header button:hover {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .pl-chain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    row-gap: var(--vs-space-2);
  }

  .pl-chain li {
    display: flex;
    align-items: center;
  }

  .pl-stage {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    padding: 7px var(--vs-space-3);
    background: var(--vs-bg-raised);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    font-size: var(--vs-text-sm);
    white-space: nowrap;
  }

  .pl-stage-name {
    font-weight: var(--vs-font-weight-medium);
  }

  .pl-stage-meta {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .pl-link {
    width: 16px;
    height: 1px;
    background: var(--vs-border);
    display: block;
  }

  .pl-note {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    max-width: 72ch;
  }

  .pl-error {
    color: var(--vs-state-blocked);
  }

  .pl-footnote {
    margin: 0;
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    max-width: 72ch;
    text-wrap: pretty;
  }

  code {
    font-family: var(--vs-font-mono);
    font-size: 0.95em;
  }

  .pl-name {
    color: var(--vs-text-primary);
  }
</style>
