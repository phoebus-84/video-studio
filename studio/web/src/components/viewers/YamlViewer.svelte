<script lang="ts">
  /**
   * A manifest, read as text and as a shape.
   *
   * A pipeline manifest is a picture of a process written down as indentation.
   * Showing the stage chain beside the text means you can check the shape is
   * what you meant without holding eleven nested keys in your head — and
   * because the graph is parsed from the very text on the left, the two cannot
   * drift apart.
   */
  import type { ViewerProps } from "$lib/viewer-registry";
  import { parsePipelineManifest } from "$lib/pipeline-manifest";

  let { content, readOnly, onEdit }: ViewerProps = $props();

  /* Editing is off by default: the coloured read view is what this is for, and
     a manifest is usually opened to be understood before it is changed. */
  let editing = $state(false);

  const lines = $derived(content.split("\n"));
  const parsed = $derived(parsePipelineManifest(content));

  /** Split a line into its key and the rest, so the key can be coloured. */
  function splitKey(text: string): { key: string; rest: string } {
    const match = /^(\s*-?\s*[\w.$-]+:)(.*)$/.exec(text);
    return match
      ? { key: match[1]!, rest: match[2]! }
      : { key: "", rest: text };
  }

  function isComment(text: string): boolean {
    return text.trimStart().startsWith("#");
  }
</script>

<div class="yaml">
  <div class="ya-main">
    <div class="ya-bar">
      <span class="ya-kind">yaml</span>
      {#if parsed.name}
        <span class="ya-name">{parsed.name}</span>
      {/if}
      {#if !readOnly}
        <button class="ya-toggle" onclick={() => (editing = !editing)}>
          {editing ? "Done editing" : "Edit as text"}
        </button>
      {/if}
    </div>

    {#if editing && !readOnly}
      <textarea
        class="ya-edit"
        value={content}
        oninput={(e) => onEdit((e.target as HTMLTextAreaElement).value)}
        spellcheck="false"
        aria-label="Manifest source"
      ></textarea>
    {:else}
      <div class="ya-code">
        {#each lines as line, i (i)}
          {@const parts = splitKey(line)}
          <div class="ya-line">
            <span class="ya-n">{i + 1}</span>
            {#if isComment(line)}
              <span class="ya-comment">{line}</span>
            {:else}
              <span class="ya-key">{parts.key}</span><span class="ya-val">{parts.rest}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <aside class="ya-graph">
    <h3>This manifest, as a graph</h3>
    {#if parsed.stages.length > 0}
      <ol class="ya-chain">
        {#each parsed.stages as stage, i (stage.id)}
          <li>
            <span class="ya-node">
              <span class="ya-dot"></span>
              {#if i < parsed.stages.length - 1}
                <span class="ya-link"></span>
              {/if}
            </span>
            <span class="ya-stage">
              <span class="ya-stage-name">{stage.id}</span>
              {#if stage.capability}
                <span class="ya-stage-meta">{stage.capability}</span>
              {/if}
              {#if stage.provider}
                <span class="ya-stage-meta">{stage.provider}</span>
              {/if}
            </span>
          </li>
        {/each}
      </ol>
    {:else if parsed.name}
      <p class="ya-note">
        This manifest names the pipeline <code>{parsed.name}</code> rather than
        listing stages, so there is no chain to draw from this file.
      </p>
    {:else}
      <p class="ya-note">
        No <code>stages:</code> block, so there is no chain to draw. This file
        is still valid — it is just not a pipeline definition.
      </p>
    {/if}
  </aside>
</div>

<style>
  .yaml {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    overflow: hidden;
  }

  .ya-main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--vs-bg-inset);
  }

  .ya-bar {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    padding: var(--vs-space-2) var(--vs-space-3);
    border-bottom: 1px solid var(--vs-border);
    flex-shrink: 0;
  }

  .ya-kind {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
  }

  .ya-name {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
  }

  .ya-toggle {
    margin-left: auto;
    padding: 2px var(--vs-space-2);
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-sm);
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .ya-toggle:hover {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .ya-code {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--vs-space-2) 0;
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-sm);
    line-height: 1.65;
  }

  .ya-line {
    display: flex;
    padding-right: var(--vs-space-3);
  }

  .ya-n {
    width: 40px;
    flex-shrink: 0;
    padding-right: var(--vs-space-3);
    text-align: right;
    color: var(--vs-text-disabled);
    user-select: none;
  }

  .ya-key {
    color: var(--vs-state-running);
    white-space: pre;
  }

  .ya-val {
    color: var(--vs-text-primary);
    white-space: pre;
  }

  .ya-comment {
    color: var(--vs-text-tertiary);
    white-space: pre;
  }

  .ya-edit {
    flex: 1;
    min-height: 0;
    resize: none;
    border: none;
    outline: none;
    padding: var(--vs-space-3);
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-sm);
    line-height: 1.65;
    background: transparent;
    color: var(--vs-text-primary);
  }

  .ya-graph {
    border-left: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    overflow-y: auto;
    padding: var(--vs-space-3);
    min-height: 0;
  }

  h3 {
    margin: 0 0 var(--vs-space-2);
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
    font-weight: var(--vs-font-weight-medium);
  }

  .ya-chain {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .ya-chain li {
    display: flex;
    gap: var(--vs-space-2);
    align-items: stretch;
  }

  .ya-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 10px;
    flex-shrink: 0;
    padding-top: 6px;
  }

  .ya-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vs-accent);
    flex-shrink: 0;
  }

  .ya-link {
    width: 1px;
    flex: 1;
    min-height: 22px;
    background: var(--vs-border);
  }

  .ya-stage {
    display: block;
    padding-bottom: var(--vs-space-3);
    min-width: 0;
  }

  .ya-stage-name {
    display: block;
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
  }

  .ya-stage-meta {
    display: block;
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .ya-note {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    line-height: var(--vs-leading-normal);
  }

  code {
    font-family: var(--vs-font-mono);
    color: var(--vs-text-secondary);
  }

  @media (max-width: 1100px) {
    .yaml {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .ya-graph {
      border-left: none;
      border-top: 1px solid var(--vs-border);
      max-height: 200px;
    }
  }
</style>
