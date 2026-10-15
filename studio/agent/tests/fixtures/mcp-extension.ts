// A small extension in the studio extension's shape, for the MCP server tests:
// one tool of each behaviour the server has to carry across.

import { Type } from "typebox";

interface Api {
  registerTool(tool: unknown): void;
  registerCommand(name: string, command: unknown): void;
  on(event: string, handler: (event: unknown, ctx: Ctx) => void): void;
  sendUserMessage(text: string, opts?: { deliverAs?: string }): void;
  sendMessage(message: { customType: string; content: string; display?: boolean }, opts?: { triggerTurn?: boolean }): void;
}

interface Ctx {
  mode: string;
  ui: { notify(message: string, level?: string): void; setStatus(key: string, text: string): void };
  modelRegistry: { getApiKeyForProvider(provider: string): Promise<string | undefined> };
}

export default function (pi: Api): void {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("fixture", `fixture (${ctx.mode})`);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("fixture", "");
  });

  pi.registerTool({
    name: "fx_echo",
    label: "Echo",
    description: "Echo the text back.",
    parameters: Type.Object({ text: Type.String({ description: "What to echo" }) }),
    async execute(_id: string, params: { text: string }) {
      return { content: [{ type: "text", text: params.text }], details: { echoed: params.text } };
    },
  });

  pi.registerTool({
    name: "fx_throw",
    description: "Always fails.",
    parameters: Type.Object({}),
    async execute() {
      throw new Error("the fixture failed on purpose");
    },
  });

  pi.registerTool({
    name: "fx_progress",
    description: "Streams two updates, then returns.",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: unknown, onUpdate?: (u: unknown) => void) {
      onUpdate?.({ message: "first half" });
      onUpdate?.({ content: [{ type: "text", text: "second half" }] });
      return { content: [{ type: "text", text: "done" }] };
    },
  });

  pi.registerTool({
    name: "fx_codex",
    description: "Says whether a Codex login is visible.",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: Ctx) {
      const token = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
      return { content: [{ type: "text", text: token ? `token:${token}` : "no token" }] };
    },
  });

  pi.registerTool({
    name: "fx_review",
    description: "Pushes a review turn and a stage update, as the gateway stream does.",
    parameters: Type.Object({}),
    async execute() {
      pi.sendUserMessage("New review activity just arrived", { deliverAs: "followUp" });
      pi.sendMessage({ customType: "pva:stage-update", content: "Stage \"brief\" completed", display: true }, { triggerTurn: false });
      return { content: [{ type: "text", text: "pushed" }] };
    },
  });

  pi.registerCommand("go", {
    description: "Start something",
    async handler(args: string, ctx: Ctx) {
      if (!args) {
        ctx.ui.notify("Usage: /go <channel>/<series>/<episode>", "error");
        return;
      }
      pi.sendUserMessage(`Go to work on ${args}.`);
    },
  });
}
