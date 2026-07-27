<script lang="ts">
  import AppShell from "$components/shell/AppShell.svelte";

  interface Props {
    theme: "light" | "dark";
  }

  let { theme }: Props = $props();

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
