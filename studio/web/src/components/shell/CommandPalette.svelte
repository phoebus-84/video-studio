<script lang="ts">
  /**
   * Go anywhere, run anything, by typing.
   *
   * The palette is built from what is actually loaded — the library tree, the
   * files at this level, the views this level offers — rather than a static
   * command list, so it can never offer to open something that is not there.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { files } from "$lib/files-store.svelte.ts";
  import { studio, type View } from "$lib/studio-store.svelte.ts";

  interface Props {
    /** Run a status-strip style action id, shared with the strip. */
    onaction: (id: string) => void;
  }

  let { onaction }: Props = $props();

  interface Item {
    id: string;
    group: string;
    label: string;
    hint: string;
    run: () => void;
  }

  let inputEl = $state<HTMLInputElement | null>(null);
  let activeIndex = $state(0);

  /* Focus on open; the palette is useless if you have to click into it. */
  $effect(() => {
    if (studio.paletteOpen) inputEl?.focus();
  });

  /* Any change to the query invalidates the highlighted row. */
  $effect(() => {
    studio.paletteQuery;
    activeIndex = 0;
  });

  const items = $derived.by((): Item[] => {
    const out: Item[] = [];

    for (const view of studio.views) {
      out.push({
        id: `view:${view.key}`,
        group: "view",
        label: view.label,
        hint: "",
        run: () => studio.show(view.key as View),
      });
    }

    for (const entry of files.entries) {
      if (entry.kind !== "file") continue;
      out.push({
        id: `file:${entry.path}`,
        group: "file",
        label: entry.path,
        hint: "",
        run: () => {
          studio.openFile(entry.path);
          void files.open(entry);
        },
      });
    }

    for (const channel of library.tree.channels) {
      out.push({
        id: `ch:${channel.slug}`,
        group: "channel",
        label: channel.title,
        hint: "",
        run: () => library.selectChannel(channel.slug),
      });
      for (const series of channel.series) {
        out.push({
          id: `se:${channel.slug}/${series.slug}`,
          group: "series",
          label: `${channel.title} / ${series.title}`,
          hint: "",
          run: () => library.selectSeries(channel.slug, series.slug),
        });
        for (const ep of series.episodes) {
          out.push({
            id: `ep:${channel.slug}/${series.slug}/${ep.slug}`,
            group: "episode",
            label: `${series.title} / ${ep.title}`,
            hint: "",
            run: () => library.select(channel.slug, series.slug, ep.slug),
          });
        }
      }
    }

    out.push({
      id: "act:rerun-affected",
      group: "action",
      label: "Rerun what is stale",
      hint: "",
      run: () => onaction("rerun-affected"),
    });
    out.push({
      id: "act:show-stale",
      group: "action",
      label: "Show what changed",
      hint: "",
      run: () => onaction("show-stale"),
    });

    return out;
  });

  const matches = $derived.by(() => {
    const q = studio.paletteQuery.trim().toLowerCase();
    const list = q
      ? items.filter((i) => i.label.toLowerCase().includes(q) || i.group.includes(q))
      : items;
    /* A palette that scrolls forever is a list, not a shortcut. */
    return list.slice(0, 40);
  });

  function choose(item: Item) {
    item.run();
    studio.closePalette();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, matches.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = matches[activeIndex];
      if (item) choose(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      studio.closePalette();
    }
  }
</script>

{#if studio.paletteOpen}
  <div class="palette-backdrop">
    <!-- The scrim is a sibling of the palette rather than its parent, so
         closing on an outside click needs no stopPropagation on the dialog.
         Keyboard users close with Escape, handled on the input. -->
    <div
      class="palette-scrim"
      role="presentation"
      onclick={() => studio.closePalette()}
    ></div>

    <div
      class="palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      tabindex="-1"
    >
      <input
        bind:this={inputEl}
        class="palette-input"
        type="text"
        placeholder="Type a file, level or command…"
        aria-label="Search files, levels and commands"
        aria-controls="palette-results"
        bind:value={studio.paletteQuery}
        onkeydown={onKeydown}
      />

      <ul class="palette-list" id="palette-results" role="listbox">
        {#each matches as item, i (item.id)}
          <li>
            <button
              class="palette-item"
              class:active={i === activeIndex}
              role="option"
              aria-selected={i === activeIndex}
              onclick={() => choose(item)}
              onmouseenter={() => (activeIndex = i)}
            >
              <span class="palette-group">{item.group}</span>
              <span class="palette-label">{item.label}</span>
              {#if item.hint}
                <span class="palette-hint">{item.hint}</span>
              {/if}
            </button>
          </li>
        {:else}
          <li class="palette-empty">Nothing matches “{studio.paletteQuery}”.</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
  }

  .palette-scrim {
    position: absolute;
    inset: 0;
    background: oklch(0% 0 0 / 0.45);
  }

  /* The palette genuinely floats over another plane, so it is one of the few
     places that earns a shadow. */
  .palette {
    position: relative;
    width: min(92vw, 640px);
    outline: none;
    background: var(--vs-bg-raised);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-lg);
    box-shadow: var(--vs-shadow-modal);
    overflow: hidden;
  }

  .palette-input {
    width: 100%;
    padding: var(--vs-space-3) var(--vs-space-4);
    background: none;
    border: none;
    border-bottom: 1px solid var(--vs-border);
    color: var(--vs-text-primary);
    font: inherit;
    font-size: var(--vs-text-base);
    outline: none;
  }

  .palette-list {
    list-style: none;
    margin: 0;
    padding: var(--vs-space-1);
    max-height: 46vh;
    overflow-y: auto;
  }

  .palette-item {
    display: flex;
    width: 100%;
    gap: var(--vs-space-2);
    align-items: center;
    padding: var(--vs-space-2);
    background: none;
    border: none;
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-primary);
    font: inherit;
    font-size: var(--vs-text-sm);
    text-align: left;
    cursor: pointer;
  }

  .palette-item.active {
    background: var(--vs-bg-hover);
  }

  .palette-group {
    width: 64px;
    flex-shrink: 0;
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vs-text-tertiary);
  }

  .palette-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .palette-hint {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .palette-empty {
    padding: var(--vs-space-3);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    text-align: center;
  }
</style>
