// ---------------------------------------------------------------------------
// A Pi-shaped host for the studio extension, outside Pi
// ---------------------------------------------------------------------------
// The extension in ../extensions/index.ts is written against Pi's
// ExtensionAPI. It uses a small part of it: registerTool, registerCommand,
// on("session_start" | "session_shutdown"), sendUserMessage, sendMessage, and
// a ctx with ui.notify, ui.setStatus, mode and modelRegistry. This module
// provides exactly that part, so the extension runs unchanged under any
// harness that can call tools (the MCP server in ./server.ts is one).
//
// Nothing here is loaded by Pi. Under Pi the extension gets Pi's own API.
// ---------------------------------------------------------------------------

export type NoticeLevel = "info" | "warning" | "error";

export interface HostedToolResult {
  content?: Array<{ type: string; [key: string]: unknown }>;
  details?: unknown;
  isError?: boolean;
}

/** A tool as the extension registers it with Pi. */
export interface HostedTool {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((update: unknown) => void) | undefined,
    ctx: HostContext,
  ): Promise<HostedToolResult>;
}

/** A slash command as the extension registers it with Pi. */
export interface HostedCommand {
  name: string;
  description?: string;
  handler(args: string, ctx: HostContext): Promise<void> | void;
}

export interface ModelRegistryLike {
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
}

/** The part of Pi's extension context the studio extension reads. */
export interface HostContext {
  mode: string;
  cwd: string;
  hasUI: boolean;
  modelRegistry: ModelRegistryLike;
  ui: {
    notify(message: string, level?: NoticeLevel): void;
    setStatus(key: string, text: string): void;
  };
}

/** What the extension pushes at the session from outside a tool call. */
export type HostMessage =
  | { kind: "user"; text: string; deliverAs?: string }
  | { kind: "custom"; customType: string; content: string; triggerTurn: boolean };

export interface HostOptions {
  /** Shown to the extension as ctx.mode. */
  mode: string;
  cwd: string;
  modelRegistry: ModelRegistryLike;
  notify(message: string, level: NoticeLevel): void;
  setStatus(key: string, text: string): void;
  /** The extension asked for a turn (Pi's sendUserMessage / sendMessage). */
  message(message: HostMessage): void;
}

type Handler = (event: unknown, ctx: HostContext) => unknown;

export interface ToolHost {
  /** The object handed to the extension factory in place of Pi's API. */
  api: Record<string, unknown>;
  ctx: HostContext;
  tools: Map<string, HostedTool>;
  commands: Map<string, HostedCommand>;
  /** Run the extension's handlers for a lifecycle event, in registration order. */
  emit(event: "session_start" | "session_shutdown"): Promise<void>;
}

export function createToolHost(options: HostOptions): ToolHost {
  const tools = new Map<string, HostedTool>();
  const commands = new Map<string, HostedCommand>();
  const handlers = new Map<string, Handler[]>();

  const ctx: HostContext = {
    mode: options.mode,
    cwd: options.cwd,
    hasUI: false,
    modelRegistry: options.modelRegistry,
    ui: {
      notify: (message, level = "info") => options.notify(message, level),
      setStatus: (key, text) => options.setStatus(key, text),
    },
  };

  const api: Record<string, unknown> = {
    registerTool(tool: HostedTool) {
      if (tools.has(tool.name)) throw new Error(`tool ${tool.name} registered twice`);
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, command: Omit<HostedCommand, "name">) {
      commands.set(name, { name, ...command });
    },
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    sendUserMessage(text: string, opts?: { deliverAs?: string }) {
      options.message({ kind: "user", text, ...(opts?.deliverAs ? { deliverAs: opts.deliverAs } : {}) });
    },
    sendMessage(
      message: { customType: string; content: string | unknown[] },
      opts?: { triggerTurn?: boolean },
    ) {
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      options.message({ kind: "custom", customType: message.customType, content, triggerTurn: Boolean(opts?.triggerTurn) });
    },
  };

  return {
    api,
    ctx,
    tools,
    commands,
    async emit(event) {
      for (const handler of handlers.get(event) ?? []) {
        try {
          await handler({ type: event }, ctx);
        } catch (err) {
          options.notify(`${event} handler failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
      }
    },
  };
}

/** Run a hosted tool and fold a thrown error into an error result, as Pi does. */
export async function runHostedTool(
  host: ToolHost,
  name: string,
  params: unknown,
  options: { signal?: AbortSignal; onUpdate?: (update: unknown) => void; toolCallId?: string } = {},
): Promise<HostedToolResult & { isError: boolean }> {
  const tool = host.tools.get(name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = await tool.execute(
      options.toolCallId ?? `call-${Date.now().toString(36)}`,
      params ?? {},
      options.signal,
      options.onUpdate,
      host.ctx,
    );
    return { ...result, isError: Boolean(result.isError) };
  } catch (err) {
    return {
      content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
      isError: true,
    };
  }
}

/**
 * The text of an update a tool streams with onUpdate. The extension sends
 * either Pi's partial result ({ content: [...] }) or a { message } record.
 */
export function updateText(update: unknown): string | null {
  if (!update || typeof update !== "object") return typeof update === "string" ? update : null;
  const record = update as { message?: unknown; content?: unknown };
  if (typeof record.message === "string") return record.message;
  if (Array.isArray(record.content)) {
    const text = record.content
      .filter((c): c is { type: "text"; text: string } => !!c && typeof c === "object" && (c as { type?: unknown }).type === "text")
      .map((c) => c.text)
      .join("\n");
    return text || null;
  }
  return null;
}
