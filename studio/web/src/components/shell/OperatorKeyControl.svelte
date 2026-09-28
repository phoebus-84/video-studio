<script lang="ts">
  /**
   * Where the person enters the operator key, once (avg-qr4.3 final review,
   * I1). It used to be read from disk by the dev server and inlined into the
   * modules it serves — over unauthenticated HTTP — so anything that could
   * reach port 5173 could read the signing key.
   *
   * The key is kept in this browser's localStorage beside the gateway token,
   * sent only to the gateway as this studio's credential, and never shown,
   * logged or handed to Pi. Without it the studio still works on the agent
   * token; its approvals become requests.
   */
  import { hasOperatorKey, saveOperatorKey } from "$lib/gateway.svelte.ts";

  let open = $state(false);
  let entered = $state("");
  const signedIn = hasOperatorKey();

  function save(event: SubmitEvent) {
    event.preventDefault();
    saveOperatorKey(localStorage, entered);
    entered = "";
    // The gateway client and its socket are built once with the credential
    // they started with; reloading is what makes the new one take effect.
    location.reload();
  }

  function forget() {
    saveOperatorKey(localStorage, "");
    location.reload();
  }
</script>

<div class="operator-credential">
  <button
    type="button"
    class="operator-toggle"
    data-state={signedIn ? "operator" : "agent"}
    aria-expanded={open}
    aria-controls="operator-key-form"
    onclick={() => (open = !open)}
  >
    {signedIn ? "operator" : "sign in as operator"}
  </button>

  {#if open}
    <form id="operator-key-form" class="operator-form" onsubmit={save}>
      <label for="operator-key-input">
        Operator key — the contents of the gateway's <code>operator-key</code> file
      </label>
      <input
        id="operator-key-input"
        type="password"
        autocomplete="off"
        spellcheck="false"
        bind:value={entered}
        placeholder={signedIn ? "replace the stored key" : "paste the key"}
      />
      <div class="operator-actions">
        <button type="submit" disabled={!entered.trim()}>Save</button>
        {#if signedIn}
          <button type="button" onclick={forget}>Forget</button>
        {/if}
      </div>
    </form>
  {/if}
</div>

<style>
  .operator-credential {
    position: relative;
  }

  .operator-toggle {
    padding: 2px var(--vs-space-2);
    background: var(--vs-bg-inset);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-tertiary);
    font: inherit;
    font-size: var(--vs-text-xs);
    white-space: nowrap;
    cursor: pointer;
  }

  .operator-toggle[data-state="operator"] {
    color: var(--vs-text-secondary);
  }

  .operator-form {
    position: absolute;
    right: 0;
    top: calc(100% + var(--vs-space-1));
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: var(--vs-space-2);
    width: 280px;
    padding: var(--vs-space-3);
    background: var(--vs-bg-surface);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
  }

  .operator-form input {
    padding: 4px var(--vs-space-2);
    background: var(--vs-bg-inset);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-secondary);
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
  }

  .operator-actions {
    display: flex;
    gap: var(--vs-space-2);
  }

  .operator-actions button {
    padding: 2px var(--vs-space-2);
    background: var(--vs-bg-inset);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-secondary);
    font: inherit;
    cursor: pointer;
  }

  .operator-actions button:disabled {
    color: var(--vs-text-disabled);
    cursor: default;
  }
</style>
