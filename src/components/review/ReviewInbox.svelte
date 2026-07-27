<script lang="ts">
  import { INBOX_FIXTURE } from "$lib/review-fixtures";
  import type { ReviewThread } from "$lib/review-types";
  import { THREAD_STATUS_LABELS, AGENT_STATUS_LABELS } from "$lib/review-types";

  let threads = $state<ReviewThread[]>([...INBOX_FIXTURE]);
  let expandedId = $state<string | null>(null);
  let replyText = $state("");

  function toggle(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function resolve(id: string) {
    threads = threads.map((t) =>
      t.id === id ? { ...t, status: "resolved" as const } : t,
    );
  }

  function sendReply(threadId: string) {
    if (!replyText.trim()) return;
    threads = threads.map((t) => {
      if (t.id !== threadId) return t;
      return {
        ...t,
        messages: [
          ...t.messages,
          {
            id: `msg-${crypto.randomUUID().slice(0, 8)}`,
            author: "operator" as const,
            text: replyText,
            createdAt: new Date().toISOString(),
          },
        ],
        status: "open" as const,
      };
    });
    replyText = "";
  }

  function sortedThreads(): ReviewThread[] {
    return [...threads].sort((a, b) => {
      /* Open/reopened first, then by recency. */
      const order = { open: 0, reopened: 1, resolved: 2 };
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
    <span class="inbox-count">{openCount} open</span>
  </div>

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
                  {#if msg.action}
                    <span class="inbox-msg-action">{msg.action}</span>
                  {/if}
                  {#if msg.agentStatus}
                    <span
                      class="inbox-msg-agent"
                      data-status={msg.agentStatus}
                    >
                      {AGENT_STATUS_LABELS[msg.agentStatus]}
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

  .inbox-msg-action {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--vs-text-tertiary);
    background: var(--vs-bg-inset);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
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
