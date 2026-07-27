<script lang="ts">
  import AppShell from "$components/shell/AppShell.svelte";
  import { library } from "$lib/library-store.svelte.ts";
  import { buildFixtureTree, DEFAULT_FIXTURE } from "$lib/fixtures";

  interface Props {
    theme: "light" | "dark";
  }

  let { theme }: Props = $props();

  /* Initialize with fixture data until gateway integration lands. */
  $effect(() => {
    library.loadFixture(buildFixtureTree(DEFAULT_FIXTURE));
  });

  /* Detect OS theme changes during the session. */
  $effect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("vs-theme")) {
        theme = e.matches ? "dark" : "light";
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });
</script>

<AppShell connected={false} {theme} />
