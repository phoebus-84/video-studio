<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { reviews as refresh } from "$lib/refresh.svelte.ts";
  import type { ReviewThread } from "$lib/review-types";
  import { THREAD_STATUS_LABELS, AGENT_STATUS_LABELS } from "$lib/review-types";

  // Real threads from gateway API
  let threads = $state<ReviewThread[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  interface RawThread {
    id: string; anchor: string; status: string;
    messages: Array<{ id: string; author: string; body: string;
      timestamp: string; status?: string; agentStatus?: string }>;
    createdAt: string;
  }

  async function fetchThreads() {
    if (episode.state.phase !== "ready") return;
    const ep = episode.state.episode;
    const client = getGatewayClient();
    loading = true;
    error = null;
    try {
      const data = await client.fetchJSON(
        `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/reviews`
      ) as { threads: RawThread[] };

      threads = (data.threads ?? []).map((t: RawThread) => ({
        id: t.id,
        anchor: { kind: t.anchor.split("/")[0] ?? "general", targetId: t.anchor },
        status: (t.status ?? "open") as ReviewThread["status"],
        author: (t.messages[0]?.author ?? "operator") as ReviewThread["author"],
        body: t.messages[0]?.body ?? "",
        messages: (t.messages ?? []).map((m: any) => ({
          id: m.id,
          author: (m.author ?? "operator") as "operator" | "pi",
          text: m.body ?? "",
          createdAt: m.timestamp ?? new Date().toISOString(),
          agentStatus: (m.agentStatus ?? "idle") as any,
        })),
        agentStatus: (t.messages[t.messages.length - 1]?.agentStatus ?? "idle") as any,
        createdAt: t.createdAt ?? new Date().toISOString(),
      }));
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load reviews";
    } finally {
      loading = false;
    }
  }

  // Fetch threads when episode changes or refresh is triggered
  $effect(() => {
    if (episode.state.phase === "ready") {
      void refresh.tick; // track the tick
      fetchThreads();
    } else {
      threads = [];
    }
  });

  let expandedId = $state<string | null>(null);
  let replyText = $state("");

  function toggle(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  async function resolve(id: string) {
    const ep = episode.state.phase === "ready" ? episode.state.episode : null;
    if (!ep) return;
    const client = getGatewayClient();
    // Find the last message in the thread
    const thread = threads.find(t => t.id === id);
    const lastMsg = thread?.messages[thread.messages.length - 1];
    if (!lastMsg) return;

    try {
      await client.fetchJSON(
        `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/reviews/${id}/messages/${lastMsg.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "resolved" }),
        }
      );
      threads = threads.map((t) =>
        t.id === id ? { ...t, status: "resolved" as const } : t,
      );
      refresh.refresh(); // background re-fetch to reconcile
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to resolve";
    }
  }

  async function sendReply(threadId: string) {
    if (!replyText.trim()) return;
    const ep = episode.state.phase === "ready" ? episode.state.episode : null;
    if (!ep) return;
    const client = getGatewayClient();

    try {
      const data = await client.fetchJSON(
        `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/reviews/${threadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "operator", body: replyText }),
        }
      ) as any;

      const newMsg = {
        id: data.message?.id ?? `msg-${Date.now()}`,
        author: "operator" as const,
        text: replyText,
        createdAt: new Date().toISOString(),
        agentStatus: undefined as any,
      };

      threads = threads.map((t) => {
        if (t.id !== threadId) return t;
        return {
          ...t,
          messages: [...t.messages, newMsg],
          status: "open" as const,
        };
      });
      replyText = "";
      refresh.refresh(); // background re-fetch to reconcile
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to send reply";
    }
  }

  function sortedThreads(): ReviewThread[] {
    return [...threads].sort((a, b) => {
      const order: Record<string, number> = { open: 0, reopened: 1, resolved: 2 };
      return (
        (order[a.status] ?? 0) - (order[b.status] ?? 0) ||
        b.createdAt.localeCompare(a.createdAt)
      );
    });
  }

  const openCount = $derived(threads.filter((t) => t.status !== "resolved").length);
</script>

<div class="inbox" aria-label="Review inbox">
  <div class="inbox-header">
    <h4 class="inbox-title">Reviews</h4>
    {#if loading}
      <span class="inbox-count">loading…</span>
    {:else}
      <span class="inbox-count">{openCount} open</span>
    {/if}
  </div>

  {#if error}
    <div class="inbox-error">{error}</div>
  {/if}

  {#if !loading && threads.length === 0}
    <div class="inbox-empty">
      <p>No reviews yet. Select a scene and click "Request Review" to start a thread.</p>
    </div>
  {/if}

  <ol class="inbox-list">
    {#each sortedThreads() as thread (thread.id)}
      <li class="inbox-thread" data-status={thread.status}>
        <button
          class="inbox-toggle"
          onclick={() => toggle(thread.id)}
          aria-expanded={expandedId === thread.id}
        >
          <span class="inbox-anchor-type">{thread.anchor.kind}</span>
          <span class="inbox-anchor-id">{thread.anchor.targetId}</span>
          <span class="inbox-status">{THREAD_STATUS_LABELS[thread.status]}</span>
          <span class="inbox-msg-count">{thread.messages.length}</span>
        </button>

        {#if expandedId === thread.id}
          <div class="inbox-messages">
            {#each thread.messages as msg (msg.id)}
              <div class="inbox-msg" data-author={msg.author}>
                <div class="inbox-msg-header">
                  <span class="inbox-msg-author">
                    {msg.author === "operator" ? "You" : "Pi"}
                  </span>
                  {#if msg.agentStatus}
                    <span
                      class="inbox-msg-agent"
                      data-status={msg.agentStatus}
                    >
                      {AGENT_STATUS_LABELS[msg.agentStatus] ?? msg.agentStatus}
                    </span>
                  {/if}
                </div>
                <p class="inbox-msg-text">{msg.text}</p>
              </div>
            {/each}

            <div class="inbox-reply">
              <textarea
                class="inbox-reply-input"
                placeholder="Reply or send to Pi…"
                rows={2}
                value={replyText}
                oninput={(e) => replyText = (e.target as HTMLTextAreaElement).value}
              ></textarea>
              <div class="inbox-reply-actions">
                <button
                  class="inbox-reply-btn"
                  disabled={!replyText.trim()}
                  onclick={() => sendReply(thread.id)}
                >
                  Send
                </button>
                {#if thread.status !== "resolved"}
                  <button
                    class="inbox-resolve-btn"
                    onclick={() => resolve(thread.id)}
                  >
                    Resolve
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<style>
  .inbox {
    padding: var(--vs-space-3);
  }

  .inbox-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--vs-space-3);
  }

  .inbox-title {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0;
  }

  .inbox-count {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .inbox-error {
    padding: var(--vs-space-2);
    background: var(--vs-state-blocked-bg);
    color: var(--vs-state-blocked);
    border-radius: var(--vs-radius-sm);
    font-size: var(--vs-text-xs);
    margin-bottom: var(--vs-space-2);
  }

  .inbox-empty {
    text-align: center;
    color: var(--vs-text-tertiary);
    font-size: var(--vs-text-xs);
    padding: var(--vs-space-4);
  }

  .inbox-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--vs-space-2);
  }

  .inbox-thread[data-status="resolved"] {
    opacity: 0.55;
  }

  .inbox-toggle {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    width: 100%;
    padding: var(--vs-space-2) var(--vs-space-3);
    background: var(--vs-bg-surface);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    text-align: left;
    cursor: pointer;
  }

  .inbox-toggle:hover {
    background: var(--vs-bg-hover);
  }

  .inbox-anchor-type {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vs-text-tertiary);
    font-size: 10px;
  }

  .inbox-anchor-id {
    font-family: var(--vs-font-mono);
    color: var(--vs-text-primary);
    font-weight: var(--vs-font-weight-medium);
    flex: 1;
  }

  .inbox-status {
    color: var(--vs-state-attention);
    font-size: 10px;
    text-transform: uppercase;
  }

  .inbox-thread[data-status="resolved"] .inbox-status {
    color: var(--vs-state-current);
  }

  .inbox-msg-count {
    background: var(--vs-bg-inset);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
    font-size: 10px;
    color: var(--vs-text-tertiary);
  }

  .inbox-messages {
    padding: var(--vs-space-2);
    border: 1px solid var(--vs-border);
    border-top: none;
    border-radius: 0 0 var(--vs-radius-md) var(--vs-radius-md);
    background: var(--vs-bg-surface);
  }

  .inbox-msg {
    padding: var(--vs-space-2) 0;
    border-bottom: 1px solid var(--vs-border);
  }

  .inbox-msg:last-of-type {
    border-bottom: none;
  }

  .inbox-msg-header {
    display: flex;
    gap: var(--vs-space-2);
    align-items: center;
    margin-bottom: var(--vs-space-1);
  }

  .inbox-msg-author {
    font-size: var(--vs-text-xs);
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-text-primary);
  }

  .inbox-msg[data-author="pi"] .inbox-msg-author {
    color: var(--vs-state-running);
  }

  .inbox-msg-agent {
    font-size: 10px;
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
  }

  .inbox-msg-agent[data-status="queued"] {
    color: var(--vs-text-tertiary);
    background: var(--vs-bg-inset);
  }

  .inbox-msg-agent[data-status="running"] {
    color: var(--vs-state-running);
    background: var(--vs-state-running-bg);
  }

  .inbox-msg-agent[data-status="settled"] {
    color: var(--vs-state-current);
    background: var(--vs-state-current-bg);
  }

  .inbox-msg-agent[data-status="error"] {
    color: var(--vs-state-blocked);
    background: var(--vs-state-blocked-bg);
  }

  .inbox-msg-text {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    margin: 0;
    line-height: 1.4;
  }

  .inbox-reply {
    padding-top: var(--vs-space-2);
    border-top: 1px solid var(--vs-border);
  }

  .inbox-reply-input {
    width: 100%;
    padding: var(--vs-space-1) var(--vs-space-2);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-sm);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    background: var(--vs-bg-canvas);
    color: var(--vs-text-primary);
    resize: vertical;
  }

  .inbox-reply-actions {
    display: flex;
    gap: var(--vs-space-2);
    margin-top: var(--vs-space-1);
  }

  .inbox-reply-btn {
    padding: var(--vs-space-1) var(--vs-space-3);
    border: 1px solid var(--vs-accent);
    border-radius: var(--vs-radius-sm);
    background: var(--vs-accent);
    color: var(--vs-accent-text);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .inbox-reply-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .inbox-resolve-btn {
    padding: var(--vs-space-1) var(--vs-space-3);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-sm);
    background: var(--vs-bg-surface);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    cursor: pointer;
  }
</style>
