<script lang="ts">
  /**
   * Switches between the light and dark theme and remembers the choice in
   * `vs-theme`, which main.ts reads before the OS preference.
   */
  interface Props {
    theme: "light" | "dark";
  }

  let { theme = $bindable() }: Props = $props();

  const next = $derived(theme === "dark" ? "light" : "dark");

  function toggle() {
    theme = next;
    /* Storage can be blocked (private window); the switch still holds for
       this session. */
    try {
      localStorage.setItem("vs-theme", theme);
    } catch {
      /* ignore */
    }
  }
</script>

<button
  type="button"
  class="theme-toggle"
  onclick={toggle}
  aria-label="Switch to {next} theme"
  title="Switch to {next} theme"
>
  <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
</button>

<style>
  .theme-toggle {
    padding: 2px var(--vs-space-2);
    background: var(--vs-bg-inset);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-tertiary);
    font: inherit;
    font-size: var(--vs-text-xs);
    line-height: 1.4;
    cursor: pointer;
  }

  .theme-toggle:hover {
    color: var(--vs-text-secondary);
  }
</style>
