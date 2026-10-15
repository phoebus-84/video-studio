// ---------------------------------------------------------------------------
// Agent sessions, whichever agent runs them
// ---------------------------------------------------------------------------
// The intent router, the UI bridge, health and the start route need one thing
// from the agent: a session per episode they can send requests to. Pi
// provides it (PiProcessManager, Pi RPC subprocesses); so does Claude
// (ClaudeSessionManager, the Claude Agent SDK). The gateway picks one with
// AVG_AGENT_BACKEND; Pi is the default.
// ---------------------------------------------------------------------------

import type { SessionHandle, SessionIdentity } from "./process-manager.js";

export type { SessionHandle, SessionIdentity };

export type AgentBackend = "pi" | "claude";

export interface AgentSessionManager {
  /** Which agent this manager runs. */
  readonly backend: AgentBackend;
  /** The agent's name as people read it ("Pi", "Claude"). */
  readonly label: string;
  start(): void;
  stop(): Promise<void>;
  /** Get or create the session for an episode (`channel/series/episode`). */
  session(episodeSlug: string): Promise<SessionHandle>;
  /** An existing live session, without creating one. */
  get(episodeSlug: string): SessionHandle | null;
  listSessions(): SessionIdentity[];
  shutdownSession(episodeSlug: string): Promise<void>;
  readonly activeSessions: number;
}

/** The backend named by AVG_AGENT_BACKEND, defaulting to Pi. */
export function agentBackendFrom(env: NodeJS.ProcessEnv = process.env): AgentBackend {
  const value = (env.AVG_AGENT_BACKEND ?? "pi").trim().toLowerCase();
  if (value === "pi" || value === "") return "pi";
  if (value === "claude") return "claude";
  throw new Error(`AVG_AGENT_BACKEND must be "pi" or "claude", not "${env.AVG_AGENT_BACKEND}"`);
}
