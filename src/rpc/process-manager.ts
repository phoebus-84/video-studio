// ---------------------------------------------------------------------------
// Pi process manager
// ---------------------------------------------------------------------------
// Manages Pi RPC processes per episode: spawn, idle eviction,
// session identity, restart, graceful shutdown, subscription reattachment.
// ---------------------------------------------------------------------------

import { PiRpcClient } from "../rpc/client.js";
import type { RpcState, RpcEvent } from "../rpc/client.js";
import { EventBus, createEvent } from "../events/bus.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SessionIdentity {
  /** Unique session ID (UUID). */
  sessionId: string;
  /** Episode slug this session is attached to. */
  episodeSlug: string;
  /** Process ID of the Pi process. */
  pid: number | null;
  /** When the session was created. */
  createdAt: string;
  /** When the session was last active (request or event received). */
  lastActiveAt: string;
}

export interface ProcessManagerOptions {
  /** Library root for working directories. */
  libraryRoot: string;
  /** Event bus for publishing state changes. */
  bus: EventBus;
  /** Idle timeout in ms after which inactive sessions are evicted (default 300s). */
  idleTimeoutMs?: number;
  /** Max concurrent processes (default 4). */
  maxProcesses?: number;
  /** Period between idle eviction scans (default 60s). */
  evictionScanMs?: number;
}

export interface SessionHandle {
  identity: SessionIdentity;
  /** Send an RPC request to this session's Pi process. */
  request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** Send a fire-and-forget notification. */
  notify(method: string, params?: Record<string, unknown>): void;
  /** Subscribe to Pi events forwarded to the event bus. */
  onEvent(type: string, handler: (data: Record<string, unknown>) => void): () => void;
  /** Close this session (graceful shutdown). */
  shutdown(): Promise<void>;
  /** Whether the session is still connected. */
  isAlive(): boolean;
}

// ── Implementation ──────────────────────────────────────────────────────────

export class PiProcessManager {
  private libraryRoot: string;
  private bus: EventBus;
  private idleTimeoutMs: number;
  private maxProcesses: number;
  private sessions = new Map<string, SessionInstance>();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private evictionScanMs: number;

  constructor(options: ProcessManagerOptions) {
    this.libraryRoot = options.libraryRoot;
    this.bus = options.bus;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 300_000; // 5 minutes
    this.maxProcesses = options.maxProcesses ?? 4;
    this.evictionScanMs = options.evictionScanMs ?? 60_000; // 1 minute
  }

  /** Start the idle eviction scanner. */
  start(): void {
    if (this.evictionTimer) return;
    this.evictionTimer = setInterval(() => this.evictIdle(), this.evictionScanMs);
  }

  /** Stop the eviction scanner and shut down all sessions. */
  async stop(): Promise<void> {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }

    const sessions = [...this.sessions.values()];
    this.sessions.clear();

    for (const session of sessions) {
      try { await session.client.shutdown(); } catch { /* ignore */ }
    }
  }

  /**
   * Get or create a Pi session for an episode.
   * Returns an existing session if one exists, otherwise spawns a new one.
   */
  async session(episodeSlug: string): Promise<SessionHandle> {
    // Check for existing session
    const existing = this.sessions.get(episodeSlug);
    if (existing && existing.client.currentState === "connected") {
      existing.touch();
      return this.wrapHandle(existing);
    }

    // Evict dead sessions
    if (existing) {
      await existing.client.shutdown().catch(() => {});
      this.sessions.delete(episodeSlug);
    }

    // Enforce max processes
    if (this.sessions.size >= this.maxProcesses) {
      await this.evictOne();
    }

    // Spawn new Pi process
    const sessionDir = `${this.libraryRoot}/${episodeSlug}`;
    const sessionId = `pi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const client = new PiRpcClient({
      piCommand: "pi",
      piArgs: [
        "--mode", "rpc",
        "--session-id", sessionId,
        "--session-dir", sessionDir,
      ],
      cwd: sessionDir,
      defaultTimeoutMs: 30_000,
    });

    const now = new Date().toISOString();
    const identity: SessionIdentity = {
      sessionId,
      episodeSlug,
      pid: null,
      createdAt: now,
      lastActiveAt: now,
    };

    const instance = new SessionInstance(
      episodeSlug,
      identity,
      client,
      Date.now(),
    );

    // Forward Pi state changes to event bus
    client.on("state", (state: RpcState) => {
      instance.identity.lastActiveAt = new Date().toISOString();
      this.bus.publish(createEvent(
        "pi",
        "state-changed",
        { episodeSlug, sessionId, state },
        episodeSlug,
      ));
    });

    // Forward Pi events to subscribers
    client.on("event", (event: RpcEvent) => {
      instance.identity.lastActiveAt = new Date().toISOString();
      instance.lastActive = Date.now();

      // Notify specific type subscribers
      const subs = instance.eventSubscriptions.get(event.type);
      if (subs) {
        for (const handler of subs) {
          try { handler(event.data); } catch { /* ignore */ }
        }
      }

      // Also publish to event bus
      this.bus.publish(createEvent(
        "pi",
        event.type,
        event.data,
        episodeSlug,
      ));
    });

    // Forward stderr
    client.on("stderr", (line: string) => {
      // Publish as adapter event for diagnostics
      this.bus.publish(createEvent(
        "adapter",
        "pi-stderr",
        { episodeSlug, sessionId, line },
        episodeSlug,
      ));
    });

    await client.connect();

    instance.identity.pid = client.processPid;

    // Request session info from Pi
      // Request session info from Pi (best-effort)
      client.request("pva_version").catch(() => {});

    this.sessions.set(episodeSlug, instance);

    this.bus.publish(createEvent(
      "pi",
      "session-created",
      { episodeSlug, sessionId, pid: instance.identity.pid },
      episodeSlug,
    ));

    return this.wrapHandle(instance);
  }

  /** Get an existing session handle (does not create). */
  get(episodeSlug: string): SessionHandle | null {
    const instance = this.sessions.get(episodeSlug);
    if (instance && instance.client.currentState === "connected") {
      instance.touch();
      return this.wrapHandle(instance);
    }
    return null;
  }

  /** List all active session identities. */
  listSessions(): SessionIdentity[] {
    return [...this.sessions.values()]
      .filter((s) => s.client.currentState === "connected")
      .map((s) => ({ ...s.identity }));
  }

  /** Shut down a specific episode session. */
  async shutdownSession(episodeSlug: string): Promise<void> {
    const instance = this.sessions.get(episodeSlug);
    if (!instance) return;

    this.sessions.delete(episodeSlug);
    await instance.client.shutdown().catch(() => {});

    this.bus.publish(createEvent(
      "pi",
      "session-closed",
      { episodeSlug, sessionId: instance.identity.sessionId },
      episodeSlug,
    ));
  }

  /** Number of active sessions. */
  get activeSessions(): number {
    return [...this.sessions.values()].filter((s) => s.client.currentState === "connected").length;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private wrapHandle(instance: SessionInstance): SessionHandle {
    return {
      identity: { ...instance.identity },
      request: (method, params = {}, timeoutMs?) =>
        instance.client.request(method, params, timeoutMs),
      notify: (method, params = {}) =>
        instance.client.notify(method, params),
      onEvent(type, handler) {
        let subs = instance.eventSubscriptions.get(type);
        if (!subs) {
          subs = [];
          instance.eventSubscriptions.set(type, subs);
        }
        subs.push(handler);
        return () => {
          const idx = subs!.indexOf(handler);
          if (idx >= 0) subs!.splice(idx, 1);
        };
      },
      shutdown: () => this.shutdownSession(instance.episodeSlug),
      isAlive: () => instance.client.currentState === "connected",
    };
  }

  private evictIdle(): void {
    const now = Date.now();
    const threshold = this.idleTimeoutMs;

    for (const [episodeSlug, instance] of this.sessions) {
      if (now - instance.lastActive > threshold) {
        this.shutdownSession(episodeSlug);
      }
    }
  }

  private async evictOne(): Promise<void> {
    // Evict the least recently active session
    let oldestSlug: string | null = null;
    let oldestTime = Infinity;

    for (const [slug, instance] of this.sessions) {
      if (instance.lastActive < oldestTime) {
        oldestTime = instance.lastActive;
        oldestSlug = slug;
      }
    }

    if (oldestSlug) {
      await this.shutdownSession(oldestSlug);
    }
  }
}

// ── Internal session storage ────────────────────────────────────────────────

class SessionInstance {
  episodeSlug: string;
  identity: SessionIdentity;
  client: PiRpcClient;
  eventSubscriptions = new Map<string, Array<(data: Record<string, unknown>) => void>>();
  lastActive: number;

  constructor(
    episodeSlug: string,
    identity: SessionIdentity,
    client: PiRpcClient,
    lastActive: number,
  ) {
    this.episodeSlug = episodeSlug;
    this.identity = identity;
    this.client = client;
    this.lastActive = lastActive;
  }

  touch(): void {
    this.lastActive = Date.now();
    this.identity.lastActiveAt = new Date().toISOString();
  }
}
