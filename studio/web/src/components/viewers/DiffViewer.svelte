<script lang="ts">
  /**
   * Two versions of a text file, side by side.
   *
   * A version list answers "when did this change"; only a comparison answers
   * "what changed". The diff is computed on the client because both sides are
   * already in memory, and the gateway should not grow an opinion about how
   * text is compared.
   */
  interface Props {
    /** The older side. */
    left: string;
    /** The newer side, usually the live file. */
    right: string;
    leftLabel: string;
    rightLabel: string;
  }

  let { left, right, leftLabel, rightLabel }: Props = $props();

  type Row = { kind: "same" | "added" | "removed"; left: string | null; right: string | null };

  /**
   * A longest-common-subsequence diff over lines.
   *
   * Quadratic in the number of lines, which is fine for an artifact a person
   * edits; the guard below keeps a pathological file from freezing the tab.
   */
  const MAX_LINES = 4000;

  const rows = $derived.by((): Row[] => {
    const a = left.split("\n");
    const b = right.split("\n");

    if (a.length > MAX_LINES || b.length > MAX_LINES) {
      return [{ kind: "same", left: `(file too large to compare: ${a.length} vs ${b.length} lines)`, right: null }];
    }

    // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
      new Array(b.length + 1).fill(0),
    );
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i]![j] = a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
      }
    }

    const out: Row[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        out.push({ kind: "same", left: a[i]!, right: b[j]! });
        i++;
        j++;
      } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
        out.push({ kind: "removed", left: a[i]!, right: null });
        i++;
      } else {
        out.push({ kind: "added", left: null, right: b[j]! });
        j++;
      }
    }
    while (i < a.length) out.push({ kind: "removed", left: a[i++]!, right: null });
    while (j < b.length) out.push({ kind: "added", left: null, right: b[j++]! });

    return out;
  });

  const changed = $derived(rows.filter((r) => r.kind !== "same").length);
</script>

<div class="diff">
  <header>
    <span class="side">{leftLabel}</span>
    <span class="side">{rightLabel}</span>
    <span class="count">{changed === 0 ? "identical" : `${changed} changed lines`}</span>
  </header>

  <div class="body">
    {#each rows as row, index (index)}
      <div class="row {row.kind}">
        <pre class="cell left">{row.left ?? ""}</pre>
        <pre class="cell right">{row.right ?? ""}</pre>
      </div>
    {/each}
  </div>
</div>

<style>
  .diff {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  header {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 8px;
    padding: 6px 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vs-text-secondary, #888);
    border-bottom: 1px solid var(--vs-border-subtle, #e5e5e5);
    flex-shrink: 0;
  }

  .count {
    text-transform: none;
    letter-spacing: 0;
  }

  .body {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .cell {
    margin: 0;
    padding: 1px 10px;
    font-family: var(--vs-font-mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    border-right: 1px solid var(--vs-border-subtle, #eee);
  }

  /* Removed shows only on the left, added only on the right, so the eye can
     scan one column per side without decoding a symbol. */
  .removed .left {
    background: var(--vs-diff-removed, #fdeceb);
  }

  .added .right {
    background: var(--vs-diff-added, #eaf6ec);
  }

  .removed .right,
  .added .left {
    background: var(--vs-bg-hover, #fafafa);
  }
</style>
