// ---------------------------------------------------------------------------
// Claude agent sessions: the Claude Agent SDK behind the same interface as Pi
// ---------------------------------------------------------------------------
// The SDK's query() is replaced by a script, so these run without Claude: what
// is under test is what the gateway sends the agent and what it publishes.

import { describe, it, expect, vi, afterEach } from "vitest";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { EventBus, createEvent, type GatewayEvent } from "../src/events/bus.js";
import {
  ClaudeSessionManager,
  DEFAULT_ALLOWED_TOOLS,
  reviewTurn,
  turnFor,
  type QueryFn,
} from "../src/rpc/claude-manager.js";
import { agentBackendFrom } from "../src/rpc/agent-sessions.js";
import { handleIntent } from "../src/rpc/intent-router.js";

const SLUG = "ch/series/ep";

interface FakeRun {
  options: Record<string, unknown>;
  received: string[];
  interrupt: ReturnType<typeof vi.fn>;
}

/** A query() that answers each user message with a scripted reply. */
function fakeQuery() {
  const runs: FakeRun[] = [];
  const fn: QueryFn = ({ prompt, options }) => {
    const run: FakeRun = { options: options as Record<string, unknown>, received: [], interrupt: vi.fn(async () => undefined) };
    runs.push(run);
    async function* messages(): AsyncGenerator<SDKMessage> {
      yield {
        type: "system",
        subtype: "init",
        session_id: `cs-${runs.length}`,
        model: "claude-opus-5-5",
        tools: ["mcp__pva__pva_journal", "Read"],
        mcp_servers: [{ name: "pva", status: "connected" }],
      } as unknown as SDKMessage;
      for await (const message of prompt as AsyncIterable<SDKUserMessage>) {
        const text = message.message.content as string;
        run.received.push(text);
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          message: { content: [
            { type: "text", text: "On it." },
            { type: "tool_use", id: "tu1", name: "mcp__pva__pva_journal", input: {} },
          ] },
        } as unknown as SDKMessage;
        yield { type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0.01, num_turns: 2 } as unknown as SDKMessage;
      }
    }
    return Object.assign(messages(), { interrupt: run.interrupt });
  };
  return { fn, runs };
}

function collect(bus: EventBus): GatewayEvent[] {
  const events: GatewayEvent[] = [];
  bus.subscribe({ send: (e) => events.push(e), close: () => {}, isAlive: () => true });
  return events;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

let manager: ClaudeSessionManager | null = null;

afterEach(async () => {
  await manager?.stop();
  manager = null;
});

function make(bus = new EventBus(), env: NodeJS.ProcessEnv = { PATH: "/usr/bin" }) {
  const query = fakeQuery();
  manager = new ClaudeSessionManager({ libraryRoot: "/lib", bus, repoRoot: "/repo", queryFn: query.fn, env });
  manager.start();
  return { manager, query, bus };
}

describe("backend choice", () => {
  it("is Pi unless AVG_AGENT_BACKEND says claude", () => {
    expect(agentBackendFrom({})).toBe("pi");
    expect(agentBackendFrom({ AVG_AGENT_BACKEND: "claude" })).toBe("claude");
    expect(agentBackendFrom({ AVG_AGENT_BACKEND: " Claude " })).toBe("claude");
    expect(() => agentBackendFrom({ AVG_AGENT_BACKEND: "gpt" })).toThrow(/pi" or "claude/);
  });
});

describe("Claude sessions", () => {
  it("turns a steer intent into a turn and publishes what the agent does", async () => {
    const { manager, query, bus } = make();
    const events = collect(bus);

    const result = await handleIntent(
      { intent: "steer", episodeSlug: SLUG, stageId: "script", payload: { guidance: "Shorter intro" } },
      manager,
      bus,
    );
    expect(result.status).toBe("accepted");
    await tick();

    expect(query.runs).toHaveLength(1);
    expect(query.runs[0]!.received).toEqual(["Operator guidance for episode ch/series/ep (stage \"script\"):\n\nShorter intro"]);
    const agentEvents = events.filter((e) => e.channel === "pi").map((e) => e.type);
    expect(agentEvents).toEqual([
      "session-created",
      "agent_start",
      "session-ready",
      "message_end",
      "tool_execution_start",
      "agent_end",
    ]);
    const end = events.find((e) => e.type === "agent_end")!;
    expect(end.data).toMatchObject({ backend: "claude", episodeSlug: SLUG, isError: false, result: "done", costUsd: 0.01 });
    expect(events.find((e) => e.type === "session-ready")!.data).toMatchObject({ pva: "connected", claudeSessionId: "cs-1" });
  });

  it("keeps one session per episode across intents", async () => {
    const { manager, query } = make();
    const a = await manager.session(SLUG);
    await a.request("pva_follow_up", { response: "Yes, use the blue one", threadId: "t1" });
    const b = await manager.session(SLUG);
    await b.request("pva_run_pipeline", { prompt: "A fairy tale about a fox" });
    await tick();
    expect(query.runs).toHaveLength(1);
    expect(query.runs[0]!.received[0]).toMatch(/^The operator answered \(thread t1\)/);
    expect(query.runs[0]!.received[1]).toMatch(/A fairy tale about a fox/);
    expect(query.runs[0]!.received[1]).toMatch(/pva_run_pipeline \(channel "ch", series "series", episode "ep"\)/);
    expect(manager.activeSessions).toBe(1);
  });

  it("interrupts the turn in progress on cancel", async () => {
    const { manager, query } = make();
    const session = await manager.session(SLUG);
    await expect(session.request("pva_cancel", {})).resolves.toMatchObject({ cancelled: true });
    expect(query.runs[0]!.interrupt).toHaveBeenCalledOnce();
  });

  it("refuses a request that is not a turn", async () => {
    const { manager } = make();
    const session = await manager.session(SLUG);
    await expect(session.request("pva_nonsense", {})).rejects.toThrow(/takes no "pva_nonsense"/);
  });

  it("starts a turn on operator review activity, not on the agent's own replies", async () => {
    const { manager, query, bus } = make();
    await manager.session(SLUG);
    bus.publish(createEvent("review", "thread-created", { threadId: "t1", anchor: "scene-2" }, SLUG));
    bus.publish(createEvent("review", "message-added", { threadId: "t1", author: "pi" }, SLUG));
    bus.publish(createEvent("review", "message-added", { threadId: "t1", author: "operator" }, SLUG));
    bus.publish(createEvent("review", "thread-created", { threadId: "t9", anchor: "elsewhere" }, "other/series/ep"));
    await tick();
    expect(query.runs[0]!.received).toHaveLength(2);
    expect(query.runs[0]!.received[0]).toMatch(/New review thread on "scene-2".*pva_journal/);
    expect(query.runs[0]!.received[1]).toMatch(/operator comment/);
  });

  it("resumes the conversation after an idle session is shut down", async () => {
    const { manager, query } = make();
    await manager.session(SLUG);
    await tick();
    await manager.shutdownSession(SLUG);
    expect(manager.activeSessions).toBe(0);
    await manager.session(SLUG);
    expect(query.runs).toHaveLength(2);
    expect(query.runs[1]!.options.resume).toBe("cs-1");
  });
});

describe("what the agent runs with", () => {
  it("serves the studio's MCP tools to a headless agent on the gateway's library", () => {
    const { manager } = make(new EventBus(), {
      PATH: "/usr/bin",
      AVG_OPERATOR_KEY_FILE: "/secret/operator.key",
      AVG_CLAUDE_MODEL: "claude-opus-5-5",
      CLAUDE_CODE_SESSION_ID: "parent-session",
    });
    const options = manager.sdkOptions(SLUG, "/tmp/state");
    expect(options.cwd).toBe("/repo");
    expect(options.settingSources).toEqual(["project"]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.allowedTools).toEqual(DEFAULT_ALLOWED_TOOLS);
    expect(options.model).toBe("claude-opus-5-5");
    const pva = options.mcpServers!.pva as { command: string; args: string[]; env: Record<string, string> };
    expect(pva.args).toEqual(["--import", "tsx", "/repo/studio/agent/mcp/server.ts"]);
    for (const env of [options.env as Record<string, string>, pva.env]) {
      expect(env.AVG_LIBRARY_ROOT).toBe("/lib");
      expect(env.AVG_CLAUDE_STATE_DIR).toBe("/tmp/state");
      expect(env.AVG_HEADLESS).toBe("1");
      expect(env.AVG_OPERATOR_KEY_FILE).toBeUndefined();
      expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    }
  });

  it("takes the tool list and permission mode from the environment", () => {
    const { manager } = make(new EventBus(), {
      AVG_CLAUDE_ALLOWED_TOOLS: "mcp__pva, Read",
      AVG_CLAUDE_PERMISSION_MODE: "default",
    });
    const options = manager.sdkOptions(SLUG, "/tmp/state");
    expect(options.allowedTools).toEqual(["mcp__pva", "Read"]);
    expect(options.permissionMode).toBe("default");
  });
});

describe("turn wording", () => {
  it("has a turn for each request the intent router sends", () => {
    for (const method of ["pva_run_pipeline", "pva_steer", "pva_follow_up", "pva_plan_rerun", "pva_artifact_changed"]) {
      expect(turnFor(SLUG, method, {})).toBeTruthy();
    }
    expect(turnFor(SLUG, "pva_plan_rerun", { stageIds: ["a", "b"], mode: "from-stage" })).toMatch(/stages a, b.*run nothing until the operator confirms/);
  });

  it("ignores events that are not review activity", () => {
    expect(reviewTurn(createEvent("pipeline", "stage.completed", {}, SLUG))).toBeNull();
  });
});
