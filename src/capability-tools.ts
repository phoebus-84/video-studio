// ---------------------------------------------------------------------------
// Capability tools: fal, TTS, graphics, composition
// ---------------------------------------------------------------------------
// Provider-neutral capability tools that let Pi orchestrate media production.
// Each tool requests a *capability* (e.g. "image-generation", "text-to-speech")
// not a specific provider — the runtime binds capabilities to providers.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveConfig } from "../src/config.js";

// ── Gateway client ──────────────────────────────────────────────────────────

interface GatewayClient {
  fetch(path: string, init?: RequestInit): Promise<any>;
}

function createClient(baseUrl: string, token: string): GatewayClient {
  return {
    async fetch(path, init = {}) {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> || {}) },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(`Gateway ${res.status}: ${body.error ?? res.statusText}`);
      }
      return res.json();
    },
  };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function registerCapabilityTools(pi: ExtensionAPI): void {
  let gwClient: GatewayClient | null = null;

  async function getClient(): Promise<GatewayClient> {
    if (!gwClient) {
      const config = await resolveConfig();
      gwClient = createClient(config.gatewayUrl, config.gatewayToken);
    }
    return gwClient;
  }

  // --- Tool: pva_generate_image (via fal) --------------------------------

  pi.registerTool({
    name: "pva_generate_image",
    label: "Generate Image",
    description:
      "Generate an image using the configured image-generation provider (fal.ai). Returns the generated image URL and metadata.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      prompt: Type.String({ description: "Image generation prompt" }),
      width: Type.Optional(Type.Number({ default: 1920, description: "Image width" })),
      height: Type.Optional(Type.Number({ default: 1080, description: "Image height" })),
      negativePrompt: Type.Optional(Type.String({ description: "Negative prompt" })),
      referenceAsset: Type.Optional(Type.String({ description: "Path to reference image for style consistency" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/capabilities/image-generation`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: params.prompt,
              width: params.width ?? 1920,
              height: params.height ?? 1080,
              negativePrompt: params.negativePrompt,
              referenceAsset: params.referenceAsset,
            }),
          },
        );

        return {
          content: [{ type: "text", text: result.imageUrl ? `Image generated: ${result.imageUrl}` : JSON.stringify(result, null, 2) }],
          details: { generation: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Image generation failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_synthesize_speech (via TTS) -----------------------------

  pi.registerTool({
    name: "pva_synthesize_speech",
    label: "Synthesize Speech",
    description:
      "Synthesize speech audio from text using the configured TTS provider (Qwen3-TTS). Returns the generated audio artifact path.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      text: Type.String({ description: "Text to synthesize as speech" }),
      voice: Type.Optional(Type.String({ default: "default", description: "Voice profile to use" })),
      speed: Type.Optional(Type.Number({ default: 1.0, description: "Speech speed multiplier" })),
      sceneId: Type.Optional(Type.String({ description: "Associated scene ID" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/capabilities/text-to-speech`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: params.text,
              voice: params.voice ?? "default",
              speed: params.speed ?? 1.0,
              sceneId: params.sceneId,
            }),
          },
        );

        return {
          content: [{ type: "text", text: result.audioPath ? `Speech synthesized: ${result.audioPath} (${result.durationSec ?? "?"}s)` : JSON.stringify(result, null, 2) }],
          details: { speech: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Speech synthesis failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_render_graphics (via studio-graphics-renderer) -----------

  pi.registerTool({
    name: "pva_render_graphics",
    label: "Render Graphics",
    description:
      "Render graphics content (title card, overlay, diagram) using the configured graphics renderer.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      contentKind: Type.Union([
        Type.Literal("title-card"),
        Type.Literal("overlay"),
        Type.Literal("diagram"),
        Type.Literal("lower-third"),
        Type.Literal("end-card"),
        Type.Literal("quote-card"),
      ], { description: "Type of graphic to render" }),
      template: Type.Optional(Type.String({ description: "Template name or path" })),
      data: Type.Record(Type.String(), Type.Unknown(), { description: "Template data" }),
      width: Type.Optional(Type.Number({ default: 1920 })),
      height: Type.Optional(Type.Number({ default: 1080 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/capabilities/graphics-rendering`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contentKind: params.contentKind,
              template: params.template,
              data: params.data,
              width: params.width ?? 1920,
              height: params.height ?? 1080,
            }),
          },
        );

        return {
          content: [{ type: "text", text: result.outputPath ? `Graphic rendered: ${result.outputPath}` : JSON.stringify(result, null, 2) }],
          details: { graphics: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Graphics rendering failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_compose_video (via FFmpeg) -------------------------------

  pi.registerTool({
    name: "pva_compose_video",
    label: "Compose Video",
    description:
      "Compose a video from scene assets, narration, and graphics using the configured FFmpeg pipeline.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      timeline: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Full edit timeline (optional, inferred from scenes if omitted)" })),
      outputProfile: Type.Optional(Type.Union([
        Type.Literal("preview-720p"),
        Type.Literal("hd-1080p"),
      ], { default: "hd-1080p" })),
      preview: Type.Optional(Type.Boolean({ default: false, description: "Generate a low-res preview" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/capabilities/video-composition`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              timeline: params.timeline,
              outputProfile: params.outputProfile ?? "hd-1080p",
              preview: params.preview ?? false,
            }),
          },
        );

        return {
          content: [{ type: "text", text: result.outputPath ? `Video composed: ${result.outputPath} (${result.durationSec ?? "?"}s, ${result.fileSize ?? "?"})` : JSON.stringify(result, null, 2) }],
          details: { composition: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Video composition failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_probe_media ---------------------------------------------

  pi.registerTool({
    name: "pva_probe_media",
    label: "Probe Media",
    description:
      "Probe a media asset (image, audio, video) for metadata: dimensions, duration, codec, frame rate.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      assetPath: Type.String({ description: "Path to the media asset within the episode" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/capabilities/media-probe`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetPath: params.assetPath }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { probe: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Media probe failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_capability_status ---------------------------------------

  pi.registerTool({
    name: "pva_capability_status",
    label: "Capability Status",
    description:
      "Check which media production capabilities are available and their current status.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch("/api/capabilities/status");

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { capabilities: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Capability status unavailable: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });
}
