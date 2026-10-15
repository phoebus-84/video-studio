// ---------------------------------------------------------------------------
// The studio extension as an MCP server
// ---------------------------------------------------------------------------
// Serves every tool the Pi extension registers, unchanged, over MCP stdio, so
// Claude Code (and any other MCP client) can be the executive producer:
//
//   node --import tsx studio/agent/mcp/server.ts
//
// The repository's .mcp.json starts it for Claude Code. Pi keeps loading the
// extension itself (pi -e studio/agent/extensions/index.ts); nothing here is
// on Pi's path.
//
// What Pi does through its own UI goes, here, to:
//   tools            → MCP tools (same names, descriptions, JSON schemas)
//   slash commands   → MCP prompts (/mcp__pva__video in Claude Code)
//   ui.setStatus     → <state>/status.json, for studio/agent/claude/statusline.mjs
//   ui.notify        → stderr (the MCP server log)
//   sendUserMessage  → a channel event when AVG_CLAUDE_CHANNEL=1 (Claude Code
//                      started with the development channel flag), else the
//                      inbox the UserPromptSubmit hook reads
//   sendMessage      → the inbox
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createModelRegistry } from "./credentials.js";
import {
  createToolHost,
  runHostedTool,
  updateText,
  type HostMessage,
  type ModelRegistryLike,
  type NoticeLevel,
  type ToolHost,
} from "./host.js";
import { SessionState, stateDir } from "./state.js";

export const SERVER_NAME = "pva";

/** Positional arguments a command prompt accepts; Claude Code maps words to them in order. */
const PROMPT_ARGS = 6;

/** How often a long tool call reports that it is still working. */
const HEARTBEAT_MS = 60_000;

export const INSTRUCTIONS = [
  "Agentic Video Studio: the pva_* tools produce narrated, illustrated videos in the library",
  "(channels → series → episodes). For production work load the pva-executive-producer skill",
  "first; stage skills (write-brief, write-script, compose-video, …) say how to do each stage.",
  "Paid generation is budgeted per episode: check pva_budget_status before spending.",
  "Only the operator approves a stage; ask with pva_request_approval.",
].join(" ");

const CHANNEL_INSTRUCTIONS =
  " Studio events arrive as <channel source=\"pva\" kind=\"...\">: kind=review means the operator " +
  "left review activity — read it with pva_journal and respond.";

type ExtensionFactory = (api: never) => void | Promise<void>;

export interface PvaServerOptions {
  /** Module whose default export is the Pi extension factory. */
  extension?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  modelRegistry?: ModelRegistryLike;
  log?: (line: string) => void;
}

export interface PvaServer {
  server: Server;
  host: ToolHost;
  state: SessionState;
  channel: boolean;
  /** Run the extension's session_start handlers (gateway stream, status). */
  start(): Promise<void>;
  /** Run session_shutdown handlers. Idempotent. */
  stop(): Promise<void>;
}

const DEFAULT_EXTENSION = new URL("../extensions/index.ts", import.meta.url).href;

export async function createPvaServer(options: PvaServerOptions = {}): Promise<PvaServer> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => process.stderr.write(line + "\n"));
  const channel = env.AVG_CLAUDE_CHANNEL === "1";
  const state = new SessionState(stateDir(cwd, env));

  // While a prompt runs a command handler, the turn it asks for is the prompt's
  // text. Per request: clients may ask for several prompts at once.
  const capture = new AsyncLocalStorage<{ turns: string[]; notices: string[] }>();

  let server: Server | null = null;

  const deliver = (message: HostMessage): void => {
    if (message.kind === "user") {
      const prompt = capture.getStore();
      if (prompt) {
        prompt.turns.push(message.text);
        return;
      }
      if (channel && server) {
        void server
          .notification({ method: "notifications/claude/channel", params: { content: message.text, meta: { kind: "review" } } })
          .catch((err: unknown) => log(`[pva] channel event not sent: ${String(err)}`));
        return;
      }
      state.post("review", message.text);
      return;
    }
    state.post(message.customType.replace(/^pva:/, ""), message.content);
  };

  const host = createToolHost({
    mode: "mcp",
    cwd,
    modelRegistry: options.modelRegistry ?? createModelRegistry({ env }),
    notify: (message: string, level: NoticeLevel) => {
      capture.getStore()?.notices.push(message);
      log(`[pva ${level}] ${message}`);
    },
    setStatus: (key, text) => state.setStatus(key, text),
    message: deliver,
  });

  const factory = (await import(options.extension ?? DEFAULT_EXTENSION)).default as ExtensionFactory;
  await factory(host.api as never);

  server = new Server(
    { name: SERVER_NAME, version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        prompts: {},
        ...(channel ? { experimental: { "claude/channel": {} } } : {}),
      },
      instructions: INSTRUCTIONS + (channel ? CHANNEL_INSTRUCTIONS : ""),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...host.tools.values()].map((tool) => ({
      name: tool.name,
      ...(tool.label ? { title: tool.label } : {}),
      description: tool.description,
      // TypeBox schemas are JSON Schema; the round trip drops TypeBox's symbol keys.
      inputSchema: JSON.parse(JSON.stringify(tool.parameters)) as { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const progressToken = request.params._meta?.progressToken;
    let progress = 0;
    const report = (message: string): void => {
      if (progressToken === undefined) return;
      progress += 1;
      void extra
        .sendNotification({ method: "notifications/progress", params: { progressToken, progress, message } })
        .catch(() => {});
    };
    // A render can take longer than a client's idle window; say it is alive.
    const heartbeat = setInterval(() => report(`${request.params.name} is still running`), HEARTBEAT_MS);
    try {
      const result = await runHostedTool(host, request.params.name, request.params.arguments ?? {}, {
        signal: extra.signal,
        toolCallId: String(extra.requestId),
        onUpdate: (update) => {
          const text = updateText(update);
          if (text) report(text);
        },
      });
      return { content: toMcpContent(result.content), isError: result.isError };
    } finally {
      clearInterval(heartbeat);
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [...host.commands.values()].map((command) => ({
      name: command.name,
      description: command.description ?? `The studio's /${command.name} command`,
      arguments: Array.from({ length: PROMPT_ARGS }, (_, i) => ({
        name: `arg${i + 1}`,
        description: `Word ${i + 1} of the command's arguments`,
        required: false,
      })),
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const command = host.commands.get(request.params.name);
    if (!command) throw new Error(`Unknown prompt: ${request.params.name}`);
    const values = request.params.arguments ?? {};
    const args = Array.from({ length: PROMPT_ARGS }, (_, i) => values[`arg${i + 1}`] ?? "")
      .map((word) => word.trim())
      .filter(Boolean)
      .join(" ");

    const { turns, notices } = { turns: [] as string[], notices: [] as string[] };
    await capture.run({ turns, notices }, () => command.handler(args, host.ctx));

    const status = state.statusLines();
    const text = turns.length > 0
      ? turns.join("\n\n")
      : `The studio's /${command.name} command ran${args ? ` with "${args}"` : ""} and said: ` +
        `${notices.length > 0 ? notices.join(" ") : "nothing"}.` +
        (status.length > 0 ? ` The studio's status bar reads: ${status.join(" | ")}.` : "") +
        " Tell the user, briefly.";
    return {
      description: command.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
    };
  });

  let started = false;
  let stopped = false;
  return {
    server,
    host,
    state,
    channel,
    async start() {
      if (started) return;
      started = true;
      await host.emit("session_start");
    },
    async stop() {
      if (!started || stopped) return;
      stopped = true;
      await host.emit("session_shutdown");
      state.clearStatus();
    },
  };
}

/** Pi tool content is text and image parts, the same shapes MCP uses. */
function toMcpContent(content: Array<{ type: string; [key: string]: unknown }> | undefined) {
  return (content ?? []).map((part) => {
    if (part.type === "text" && typeof part.text === "string") return { type: "text" as const, text: part.text };
    if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
      return { type: "image" as const, data: part.data, mimeType: part.mimeType };
    }
    return { type: "text" as const, text: JSON.stringify(part) };
  });
}

async function main(): Promise<void> {
  // stdout carries MCP frames; anything the extension logs goes to stderr.
  for (const method of ["log", "info", "debug"] as const) {
    console[method] = (...args: unknown[]) => console.error(...args);
  }

  const pva = await createPvaServer();
  const transport = new StdioServerTransport();

  let closing = false;
  const close = async (code = 0): Promise<void> => {
    if (closing) return;
    closing = true;
    await pva.stop().catch(() => {});
    process.exit(code);
  };

  pva.server.onclose = () => void close();
  process.stdin.on("end", () => void close());
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());

  await pva.server.connect(transport);
  await pva.start();
}

function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    process.stderr.write(`[pva] MCP server failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
