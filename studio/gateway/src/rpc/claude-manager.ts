// ---------------------------------------------------------------------------
// Claude agent sessions (Claude Agent SDK)
// ---------------------------------------------------------------------------
// The other backend behind AgentSessionManager (AVG_AGENT_BACKEND=claude).
// Each episode gets one long-lived Claude Agent SDK session whose input is a
// queue: the intents the studio sends become turns, review activity becomes a
// turn, and cancel interrupts the turn in progress. The production tools are
// the studio extension's, served by studio/agent/mcp/server.ts — the same code
// Pi loads — so the gateway stays a bridge: it produces nothing itself.
//
// What the session does goes to the event bus on the "pi" channel (the
// agent's channel, whichever agent it is), named like Pi's own events:
// agent_start, message_end, tool_execution_start, agent_end, and
// session-created / session-ready / session-closed. Every event carries
// backend: "claude".
//
// The SDK is imported only when the first session starts, so a gateway on Pi
// never loads it.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createEvent, type EventBus, type EventSubscriber, type GatewayEvent } from "../events/bus.js";
import type { AgentSessionManager } from "./agent-sessions.js";
import { piSpawnEnv } from "./client.js";
import type { SessionHandle, SessionIdentity } from "./process-manager.js";

/** The part of a Claude Agent SDK query this manager drives. */
export interface AgentQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
}

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => AgentQuery;

export interface ClaudeManagerOptions {
  /** The library the gateway serves; the agent's tools write there. */
  libraryRoot: string;
  bus: EventBus;
  /** Repository root: where CLAUDE.md, .claude/ and the MCP server live. Resolved when omitted. */
  repoRoot?: string;
  /** Claude model; the Claude Code default when omitted (AVG_CLAUDE_MODEL). */
  model?: string;
  /** Permission mode for the headless session (AVG_CLAUDE_PERMISSION_MODE, default "dontAsk"). */
  permissionMode?: Options["permissionMode"];
  /** Tools the agent may use without asking (AVG_CLAUDE_ALLOWED_TOOLS, comma-separated). */
  allowedTools?: string[];
  idleTimeoutMs?: number;
  maxProcesses?: number;
  evictionScanMs?: number;
  /** The SDK's query(); injected by tests. */
  queryFn?: QueryFn;
  env?: NodeJS.ProcessEnv;
}

/**
 * What a headless session may do without a person to ask: the studio's tools,
 * reading and editing files, the shell and skills — what Pi has. Anything
 * else is denied ("dontAsk"), since nobody is there to approve it.
 */
export const DEFAULT_ALLOWED_TOOLS = ["mcp__pva", "Skill", "Read", "Write", "Edit", "Glob", "Grep", "Bash"];

/** Variables naming the Claude Code session a process runs in; never passed on. */
const INHERITED_SESSION_ENV = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION"];

/** The repository root, found through the agent package the MCP server ships in. */
export function resolveRepoRoot(): string {
  const manifest = createRequire(import.meta.url).resolve("@studio/agent/package.json");
  return resolve(dirname(manifest), "..", "..");
}

// ── Input queue ─────────────────────────────────────────────────────────────

/** An async iterable of user messages that stays open until closed. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(text: string): void {
    if (this.closed) throw new Error("the session is closed");
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    if (this.waiting) {
      const resolveNext = this.waiting;
      this.waiting = null;
      resolveNext({ value: message, done: false });
    } else {
      this.items.push(message);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const resolveNext = this.waiting;
      this.waiting = null;
      resolveNext({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolveNext) => { this.waiting = resolveNext; });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

// ── Turns the studio's requests become ──────────────────────────────────────

function parts(episodeSlug: string): { channel: string; series: string; episode: string } {
  const [channel = "", series = "", episode = ""] = episodeSlug.split("/");
  return { channel, series, episode };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The turn a request asks for, or null for a request that is not a turn.
 * The method names are the ones the intent router sends Pi.
 */
export function turnFor(episodeSlug: string, method: string, params: Record<string, unknown>): string | null {
  const { channel, series, episode } = parts(episodeSlug);
  const target = `channel "${channel}", series "${series}", episode "${episode}"`;
  switch (method) {
    case "pva_run_pipeline":
      return (
        `Production prompt from the operator for episode ${episodeSlug}:\n\n${str(params.prompt)}\n\n` +
        `Load the pva-executive-producer skill, then run the episode's pipeline with ` +
        `pva_run_pipeline (${target}) and work through its stages.`
      );
    case "pva_steer": {
      const stage = str(params.stageId);
      return `Operator guidance for episode ${episodeSlug}${stage ? ` (stage "${stage}")` : ""}:\n\n${str(params.guidance)}`;
    }
    case "pva_follow_up": {
      const thread = str(params.threadId);
      return `The operator answered${thread ? ` (thread ${thread})` : ""}, about episode ${episodeSlug}:\n\n${str(params.response)}`;
    }
    case "pva_plan_rerun": {
      const stages = Array.isArray(params.stageIds) ? params.stageIds.map(String).join(", ") : "";
      return (
        `The operator asked for a rerun of episode ${episodeSlug}: mode "${str(params.mode) || "retry-current"}"` +
        `${stages ? `, stages ${stages}` : ""}. Plan it with pva_plan_rerun (${target}) and report the plan; ` +
        `run nothing until the operator confirms.`
      );
    }
    case "pva_artifact_changed":
      return (
        `The operator edited ${str(params.artifactPath)} in episode ${episodeSlug}, in the studio. ` +
        `Read it again before relying on an earlier version.`
      );
    default:
      return null;
  }
}

/** The turn review activity starts — the words the extension uses under Pi. */
export function reviewTurn(event: GatewayEvent): string | null {
  if (event.channel !== "review") return null;
  if (event.type === "thread-created") {
    return `New review activity just arrived: New review thread on "${str(event.data.anchor)}". ` +
      `Please call pva_journal to read the latest reviews and respond to the operator's feedback.`;
  }
  if (event.type === "message-added" && event.data.author === "operator") {
    return `New review activity just arrived: New operator comment in review thread. ` +
      `Please call pva_journal to read the latest reviews and respond to the operator's feedback.`;
  }
  return null;
}

// ── A session ───────────────────────────────────────────────────────────────

class ClaudeSession {
  readonly identity: SessionIdentity;
  lastActive = Date.now();
  alive = true;
  busy = false;
  claudeSessionId: string | null = null;
  private readonly input = new InputQueue();
  private readonly abort = new AbortController();
  private query: AgentQuery | null = null;
  private readonly subscriptions = new Map<string, Array<(data: Record<string, unknown>) => void>>();

  constructor(
    readonly episodeSlug: string,
    private readonly publish: (type: string, data: Record<string, unknown>) => void,
    private readonly stateDir: string,
  ) {
    const now = new Date().toISOString();
    this.identity = {
      sessionId: `claude-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      episodeSlug,
      pid: null,
      createdAt: now,
      lastActiveAt: now,
    };
  }

  start(queryFn: QueryFn, options: Options, onEnd: () => void): void {
    this.query = queryFn({ prompt: this.input, options: { ...options, abortController: this.abort } });
    void this.consume(this.query).finally(onEnd);
  }

  send(text: string, origin: string): void {
    this.touch();
    this.input.push(text);
    this.busy = true;
    this.publish("agent_start", { origin });
  }

  async interrupt(): Promise<void> {
    await this.query?.interrupt();
  }

  close(): void {
    if (!this.alive) return;
    this.alive = false;
    this.input.close();
    this.abort.abort();
    rmSync(this.stateDir, { recursive: true, force: true });
  }

  onEvent(type: string, handler: (data: Record<string, unknown>) => void): () => void {
    const list = this.subscriptions.get(type) ?? [];
    list.push(handler);
    this.subscriptions.set(type, list);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit(type: string, data: Record<string, unknown>): void {
    for (const handler of this.subscriptions.get(type) ?? []) {
      try { handler(data); } catch { /* a subscriber's problem */ }
    }
    this.publish(type, data);
  }

  touch(): void {
    this.lastActive = Date.now();
    this.identity.lastActiveAt = new Date().toISOString();
  }

  private async consume(query: AgentQuery): Promise<void> {
    try {
      for await (const message of query) {
        this.touch();
        this.handle(message);
      }
    } catch (err) {
      if (this.alive) this.emit("agent_error", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.close();
    }
  }

  private handle(message: SDKMessage): void {
    switch (message.type) {
      case "system": {
        if (message.subtype !== "init") return;
        this.claudeSessionId = message.session_id;
        const pva = message.mcp_servers.find((s) => s.name === "pva");
        this.emit("session-ready", {
          claudeSessionId: message.session_id,
          model: message.model,
          tools: message.tools.length,
          pva: pva?.status ?? "missing",
        });
        return;
      }
      case "assistant": {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            this.emit("message_end", { text: block.text, subagent: message.parent_tool_use_id !== null });
          } else if (block.type === "tool_use" || block.type === "mcp_tool_use") {
            this.emit("tool_execution_start", { toolName: block.name, toolUseId: block.id });
          }
        }
        return;
      }
      case "result": {
        this.busy = false;
        this.emit("agent_end", {
          isError: message.is_error,
          subtype: message.subtype,
          ...(message.subtype === "success" ? { result: message.result } : {}),
          costUsd: message.total_cost_usd,
          turns: message.num_turns,
        });
        return;
      }
      default:
        return;
    }
  }
}

// ── The manager ─────────────────────────────────────────────────────────────

export class ClaudeSessionManager implements AgentSessionManager {
  readonly backend = "claude" as const;
  readonly label = "Claude";
  private readonly sessions = new Map<string, ClaudeSession>();
  /** Claude session ids by episode, so a session evicted while idle resumes its conversation. */
  private readonly resumable = new Map<string, string>();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private reviewSubscriber: EventSubscriber | null = null;
  private queryFn: QueryFn | null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly idleTimeoutMs: number;
  private readonly maxProcesses: number;
  private readonly evictionScanMs: number;

  constructor(private readonly options: ClaudeManagerOptions) {
    this.env = options.env ?? process.env;
    this.queryFn = options.queryFn ?? null;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60_000;
    this.maxProcesses = options.maxProcesses ?? 4;
    this.evictionScanMs = options.evictionScanMs ?? 60_000;
  }

  start(): void {
    if (!this.evictionTimer) {
      this.evictionTimer = setInterval(() => this.evictIdle(), this.evictionScanMs);
      this.evictionTimer.unref?.();
    }
    if (!this.reviewSubscriber) {
      // Under Pi the extension hears review activity over the gateway's
      // WebSocket and starts a turn. Here the gateway is the one that hears it.
      let open = true;
      this.reviewSubscriber = {
        channels: ["review"],
        isAlive: () => open,
        close: () => { open = false; },
        send: (event) => {
          const text = reviewTurn(event);
          const session = event.episodeSlug ? this.sessions.get(event.episodeSlug) : undefined;
          if (text && session?.alive) session.send(text, "review");
        },
      };
      this.options.bus.subscribe(this.reviewSubscriber);
    }
  }

  async stop(): Promise<void> {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    if (this.reviewSubscriber) {
      this.reviewSubscriber.close();
      this.options.bus.unsubscribe(this.reviewSubscriber);
      this.reviewSubscriber = null;
    }
    for (const slug of [...this.sessions.keys()]) await this.shutdownSession(slug);
  }

  async session(episodeSlug: string): Promise<SessionHandle> {
    const existing = this.sessions.get(episodeSlug);
    if (existing?.alive) {
      existing.touch();
      return this.handle(existing);
    }
    if (existing) this.sessions.delete(episodeSlug);

    if (this.sessions.size >= this.maxProcesses) this.evictOne();

    const queryFn = this.queryFn ?? (this.queryFn = (await import("@anthropic-ai/claude-agent-sdk")).query as unknown as QueryFn);
    const stateDir = mkdtempSync(join(tmpdir(), "pva-claude-"));
    const session = new ClaudeSession(
      episodeSlug,
      (type, data) => this.options.bus.publish(createEvent("pi", type, { backend: "claude", episodeSlug, ...data }, episodeSlug)),
      stateDir,
    );
    this.sessions.set(episodeSlug, session);

    session.start(queryFn, this.sdkOptions(episodeSlug, stateDir), () => {
      if (session.claudeSessionId) this.resumable.set(episodeSlug, session.claudeSessionId);
      if (this.sessions.get(episodeSlug) === session) {
        this.sessions.delete(episodeSlug);
        this.options.bus.publish(createEvent("pi", "session-closed", { backend: "claude", episodeSlug, sessionId: session.identity.sessionId }, episodeSlug));
      }
    });

    this.options.bus.publish(createEvent("pi", "session-created", {
      backend: "claude",
      episodeSlug,
      sessionId: session.identity.sessionId,
      pid: null,
    }, episodeSlug));
    return this.handle(session);
  }

  get(episodeSlug: string): SessionHandle | null {
    const session = this.sessions.get(episodeSlug);
    if (!session?.alive) return null;
    session.touch();
    return this.handle(session);
  }

  listSessions(): SessionIdentity[] {
    return [...this.sessions.values()].filter((s) => s.alive).map((s) => ({ ...s.identity }));
  }

  async shutdownSession(episodeSlug: string): Promise<void> {
    const session = this.sessions.get(episodeSlug);
    if (!session) return;
    this.sessions.delete(episodeSlug);
    if (session.claudeSessionId) this.resumable.set(episodeSlug, session.claudeSessionId);
    session.close();
    this.options.bus.publish(createEvent("pi", "session-closed", { backend: "claude", episodeSlug, sessionId: session.identity.sessionId }, episodeSlug));
  }

  get activeSessions(): number {
    return [...this.sessions.values()].filter((s) => s.alive).length;
  }

  /** The SDK options for an episode's session. Exposed for tests. */
  sdkOptions(episodeSlug: string, stateDir: string): Options {
    const repoRoot = this.options.repoRoot ?? resolveRepoRoot();
    const env = this.env;
    const allowed = this.options.allowedTools
      ?? (env.AVG_CLAUDE_ALLOWED_TOOLS ? env.AVG_CLAUDE_ALLOWED_TOOLS.split(",").map((t) => t.trim()).filter(Boolean) : DEFAULT_ALLOWED_TOOLS);
    // The agent's environment is the one Pi gets (no operator key, headless),
    // pointed at the library this gateway serves and at a state directory of
    // its own, so its hooks never read an interactive session's inbox.
    const agentEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(piSpawnEnv(env))) {
      if (value !== undefined) agentEnv[key] = value;
    }
    // A gateway started from inside a Claude Code session would otherwise hand
    // that session's identity to every episode's agent.
    for (const key of INHERITED_SESSION_ENV) delete agentEnv[key];
    agentEnv.AVG_LIBRARY_ROOT = this.options.libraryRoot;
    agentEnv.AVG_CLAUDE_STATE_DIR = stateDir;
    const resume = this.resumable.get(episodeSlug);
    const model = this.options.model ?? env.AVG_CLAUDE_MODEL;

    return {
      cwd: repoRoot,
      env: agentEnv,
      // Project settings: CLAUDE.md, the generated skills and the hooks.
      settingSources: ["project"],
      mcpServers: {
        pva: {
          type: "stdio",
          command: process.execPath,
          args: ["--import", "tsx", join(repoRoot, "studio", "agent", "mcp", "server.ts")],
          env: agentEnv,
        },
      },
      strictMcpConfig: true,
      allowedTools: allowed,
      permissionMode: this.options.permissionMode ?? (env.AVG_CLAUDE_PERMISSION_MODE as Options["permissionMode"] | undefined) ?? "dontAsk",
      ...(model ? { model } : {}),
      ...(resume ? { resume } : {}),
    };
  }

  private handle(session: ClaudeSession): SessionHandle {
    return {
      identity: { ...session.identity },
      request: async (method, params = {}) => {
        session.touch();
        if (method === "pva_version" || method === "health") {
          return {
            backend: "claude",
            sessionId: session.identity.sessionId,
            claudeSessionId: session.claudeSessionId,
            busy: session.busy,
          };
        }
        if (method === "pva_cancel") {
          await session.interrupt();
          session.emit("agent_cancelled", {});
          return { cancelled: true, sessionId: session.identity.sessionId };
        }
        const text = turnFor(session.episodeSlug, method, params);
        if (!text) throw new Error(`The Claude session takes no "${method}" request`);
        session.send(text, method);
        return { accepted: true, sessionId: session.identity.sessionId, claudeSessionId: session.claudeSessionId };
      },
      notify: (method, params = {}) => {
        // pva_review_added is not turned into a turn here: the review routes
        // publish the same activity on the bus, which start() already turns
        // into one. Doing both would ask the agent twice.
        const text = method === "pva_review_added" ? null : turnFor(session.episodeSlug, method, params);
        if (text && session.alive) session.send(text, method);
      },
      onEvent: (type, handler) => session.onEvent(type, handler),
      shutdown: () => this.shutdownSession(session.episodeSlug),
      isAlive: () => session.alive,
    };
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [slug, session] of this.sessions) {
      if (!session.busy && now - session.lastActive > this.idleTimeoutMs) void this.shutdownSession(slug);
    }
  }

  private evictOne(): void {
    let oldest: ClaudeSession | null = null;
    for (const session of this.sessions.values()) {
      if (session.busy) continue;
      if (!oldest || session.lastActive < oldest.lastActive) oldest = session;
    }
    if (oldest) void this.shutdownSession(oldest.episodeSlug);
  }
}
