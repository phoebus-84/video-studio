<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { editor } from "$lib/editor-store.svelte.ts";
  import EditorToolbar from "./EditorToolbar.svelte";
  import EditorPane from "./EditorPane.svelte";
  import ConflictResolver from "./ConflictResolver.svelte";

  import type { ArtifactContent } from "$lib/editor-types";

  /** Fixture artifacts keyed by stage ID. */
  const artifacts: Record<string, ArtifactContent> = {
    brief: {
      kind: "markdown",
      text: `---
title: "Memory Hierarchies Explained"
series: "How It Works"
duration: "6–8 minutes"
tone: "technical but accessible"
audience: "CS students and curious developers"
---

# Brief

Explain memory hierarchies from CPU registers through L1/L2/L3 caches
to main memory and disk.  Use the library/book analogy: small fast desk
(L1), medium bookshelf (L2), large slow warehouse (main memory).

Key points:
- Locality of reference (spatial and temporal)
- Cache lines and associativity
- Why latency matters more than bandwidth for single-threaded code
`,
      revision: {
        etag: "a1b2c3d4e5f6a7b8",
        updatedAt: "2026-07-27T10:15:00Z",
      },
    },
    script: {
      kind: "markdown",
      text: `---
title: "Memory Hierarchies Explained"
narrator: "default"
scene_count: 6
revision: 2
---

# Script

## Scene 1 — The Memory Problem (30s)
[Visual: CPU on a desk, waiting]

NARRATOR: Every CPU spends most of its time waiting. Not for the next
instruction — it can execute billions per second — but for data.

## Scene 2 — The Hierarchy (60s)
[Visual: Pyramid diagram — registers at top, disk at bottom]

NARRATOR: Memory isn't one thing. It's a hierarchy, carefully balanced
between speed and cost.
`,
      revision: {
        etag: "b2c3d4e5f6a7b8c9",
        updatedAt: "2026-07-27T10:30:00Z",
      },
    },
    "art-direction": {
      kind: "yaml",
      text: `visual_bible: tech-explainer-dark
palette: cool_slate

scenes:
  - id: scene-1
    description: CPU waiting at a desk
    reference_style: technical-illustration
    key_colors: [slate, warm_amber_accent]
  - id: scene-2
    description: Pyramid memory hierarchy
    reference_style: infographic-diagram
    key_colors: [slate, cool_blue_accent]
`,
      revision: {
        etag: "c3d4e5f6a7b8c9d0",
        updatedAt: "2026-07-27T10:45:00Z",
      },
    },
  };

  /* Open editor when stage changes. */
  $effect(() => {
    const stageId = episode.selectedStageId;
    const artifact = stageId ? artifacts[stageId] : null;
    if (artifact) {
      editor.open(artifact);
    }
  });
</script>

{#if editor.saveState === "conflict"}
  <ConflictResolver />
{:else if editor.artifact}
  <div class="editor-workspace">
    <EditorToolbar />
    <EditorPane
      label={episode.selectedStageId ?? "artifact"}
      placeholder="Edit artifact content…"
    />
  </div>
{/if}

<style>
  .editor-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
</style>
