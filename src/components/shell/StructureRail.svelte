<script lang="ts">
  import LibraryNav from "../library/LibraryNav.svelte";
</script>

<nav class="structure-rail" aria-label="Library structure">
  <LibraryNav />
</nav>

<style>
  .structure-rail {
    background: var(--vs-bg-surface);
    border-right: 1px solid var(--vs-border);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 1024px) {
    .structure-rail {
      display: none;
    }
  }
</style>
