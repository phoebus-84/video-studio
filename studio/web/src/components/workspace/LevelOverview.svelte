<script lang="ts">
  /**
   * What a channel or a series *is*, before you open any of its files.
   *
   * A channel is an identity and a series is a format, so neither gets the
   * episode's stage view. Both get the same shape — what defines it, and what
   * is under it — because the question at both levels is the same one.
   *
   * The cards are built from files that actually exist at this level. Nothing
   * here is a placeholder for a file the creator has not written: an absent
   * brand document shows as absent, which is itself worth knowing.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { files } from "$lib/files-store.svelte.ts";
  import { studio } from "$lib/studio-store.svelte.ts";
  import { displayStatus, STATUS_LABELS } from "$lib/library-types";
  import type { LevelRef } from "$lib/files-store.svelte.ts";

  interface Props {
    ref: LevelRef;
    title: string;
  }

  let { ref, title }: Props = $props();

  const BLURB: Record<string, string> = {
    channel:
      "Who this channel is: its brand, voices, references and the defaults every series inherits.",
    series:
      "How this series is made: its visual language, its defaults, and the pipeline every episode resolves from.",
  };

  /* Documents that define a level, in the order they are worth reading. Any
     that are missing simply do not appear. */
  const DEFINING: Record<string, string[]> = {
    channel: ["brand.md", "voices.yaml", "references.md", "README.md"],
    series: ["format.yaml", "visual-bible.md", "pipeline.yaml", "README.md"],
  };

  const channelEntry = $derived(
    library.tree.channels.find((c) => c.slug === ref.channel) ?? null,
  );

  const seriesEntry = $derived(
    ref.level === "series"
      ? (channelEntry?.series.find((s) => s.slug === ref.series) ?? null)
      : null,
  );

  const children = $derived(
    ref.level === "channel"
      ? (channelEntry?.series ?? [])
      : (seriesEntry?.episodes ?? []),
  );

  const childLabel = $derived(ref.level === "channel" ? "series" : "episodes");

  /** Top-level files at this level, defining ones first. */
  const cards = $derived.by(() => {
    const wanted = DEFINING[ref.level] ?? [];
    const topLevel = files.entries.filter(
      (e) => e.kind === "file" && !e.path.includes("/"),
    );

    const defining = wanted
      .map((name) => topLevel.find((e) => e.name === name))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);

    const rest = topLevel.filter((e) => !defining.includes(e));
    return [...defining, ...rest].slice(0, 6);
  });

  function openFile(path: string) {
    const entry = files.entries.find((e) => e.path === path);
    if (entry) void files.open(entry);
    studio.openFile(path);
  }

  function openChild(slug: string) {
    if (ref.level === "channel") library.selectSeries(ref.channel, slug);
    else library.select(ref.channel, ref.series!, slug);
  }

  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  }

  function size(bytes: number | null): string {
    if (bytes === null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<div class="overview">
  <header class="ov-head">
    <div class="ov-identity">
      <span class="ov-kicker">{ref.level}</span>
      <h2>{title}</h2>
      <p class="ov-blurb">{BLURB[ref.level]}</p>
    </div>
    <div class="ov-stat">
      <strong>{children.length}</strong>
      <span>{childLabel}</span>
    </div>
  </header>

  <section>
    <h3>What defines it</h3>
    {#if files.loading}
      <p class="ov-note" role="status">Reading this level…</p>
    {:else if files.error}
      <p class="ov-note ov-error" role="alert">{files.error}</p>
    {:else if cards.length === 0}
      <p class="ov-note">
        No files at this level yet. Nothing here inherits anything but the
        defaults.
      </p>
    {:else}
      <div class="ov-cards">
        {#each cards as card (card.path)}
          <article class="ov-card">
            <span class="ov-card-kind">{card.presentation?.viewer ?? "file"}</span>
            <h4>{card.name}</h4>
            <dl>
              <div><dt>updated</dt><dd>{when(card.updatedAt)}</dd></div>
              {#if card.size !== null}
                <div><dt>size</dt><dd>{size(card.size)}</dd></div>
              {/if}
            </dl>
            <button onclick={() => openFile(card.path)}>Open</button>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <section>
    <h3>{childLabel}</h3>
    {#if children.length === 0}
      <p class="ov-note">Nothing under this {ref.level} yet.</p>
    {:else}
      <table class="ov-table">
        <thead>
          <tr>
            <th>{ref.level === "channel" ? "series" : "episode"}</th>
            {#if ref.level === "channel"}
              <th>episodes</th>
            {:else}
              <th>state</th>
              <th>stale</th>
            {/if}
            <th>last activity</th>
          </tr>
        </thead>
        <tbody>
          {#each children as child (child.slug)}
            <tr>
              <td>
                <button class="ov-link" onclick={() => openChild(child.slug)}>
                  {child.title}
                </button>
              </td>
              {#if ref.level === "channel"}
                <td>{"episodes" in child ? child.episodes.length : 0}</td>
                <td class="ov-muted">—</td>
              {:else if "status" in child}
                {@const status = displayStatus(child)}
                <td><span class="ov-state" data-state={status}>{STATUS_LABELS[status]}</span></td>
                <td class="ov-muted">{child.staleCount || "—"}</td>
                <td class="ov-muted">{when(child.lastActivity)}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<style>
  .overview {
    padding: var(--vs-space-4) var(--vs-space-5);
    overflow: auto;
    display: grid;
    gap: var(--vs-space-5);
    align-content: start;
    min-width: 0;
  }

  .ov-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--vs-space-5);
  }

  .ov-identity {
    min-width: 0;
  }

  .ov-kicker {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vs-text-tertiary);
  }

  .ov-head h2 {
    margin: 2px 0 0;
    font-size: var(--vs-text-xl);
    font-weight: var(--vs-font-weight-semibold);
  }

  .ov-blurb {
    margin: var(--vs-space-1) 0 0;
    max-width: 62ch;
    font-size: var(--vs-text-sm);
    line-height: var(--vs-leading-normal);
    color: var(--vs-text-secondary);
    text-wrap: pretty;
  }

  .ov-stat {
    text-align: right;
    flex-shrink: 0;
  }

  .ov-stat strong {
    display: block;
    font-size: var(--vs-text-xl);
    line-height: 1;
  }

  .ov-stat span {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  h3 {
    margin: 0 0 var(--vs-space-2);
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
    font-weight: var(--vs-font-weight-medium);
  }

  .ov-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--vs-space-3);
  }

  .ov-card {
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-lg);
    background: var(--vs-bg-surface);
    padding: var(--vs-space-3);
    min-width: 0;
  }

  .ov-card-kind {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
  }

  .ov-card h4 {
    margin: 2px 0 var(--vs-space-2);
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    font-family: var(--vs-font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ov-card dl {
    margin: 0 0 var(--vs-space-2);
  }

  .ov-card dl div {
    display: flex;
    gap: var(--vs-space-2);
    font-size: var(--vs-text-xs);
    padding: 2px 0;
  }

  .ov-card dt {
    width: 56px;
    flex-shrink: 0;
    color: var(--vs-text-tertiary);
  }

  .ov-card dd {
    margin: 0;
    color: var(--vs-text-secondary);
  }

  .ov-card button,
  .ov-link {
    padding: 3px 10px;
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .ov-card button:hover {
    border-color: var(--vs-accent-strong);
    color: var(--vs-accent-strong);
  }

  .ov-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--vs-text-sm);
  }

  .ov-table th {
    text-align: left;
    padding: 0 var(--vs-space-2) var(--vs-space-1);
    border-bottom: 1px solid var(--vs-border);
    font-size: var(--vs-text-xs);
    font-weight: var(--vs-font-weight-medium);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vs-text-tertiary);
  }

  .ov-table td {
    padding: 6px var(--vs-space-2);
    border-bottom: 1px solid var(--vs-border-subtle);
    color: var(--vs-text-secondary);
  }

  .ov-link {
    border: none;
    padding: 0;
    color: var(--vs-text-primary);
    text-align: left;
  }

  .ov-link:hover {
    color: var(--vs-accent-strong);
    text-decoration: underline;
  }

  .ov-muted {
    color: var(--vs-text-tertiary);
  }

  .ov-state {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .ov-state[data-state="running"] { color: var(--vs-state-running); }
  .ov-state[data-state="blocked"],
  .ov-state[data-state="failed"] { color: var(--vs-state-blocked); }
  .ov-state[data-state="stale"] { color: var(--vs-state-attention); }
  .ov-state[data-state="completed"] { color: var(--vs-state-current); }

  .ov-note {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    max-width: 72ch;
  }

  .ov-error {
    color: var(--vs-state-blocked);
  }
</style>
