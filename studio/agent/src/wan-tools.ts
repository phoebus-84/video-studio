// ---------------------------------------------------------------------------
// Wan 2.2 image-to-video through fal.ai
// ---------------------------------------------------------------------------
// `pva_generate_wan_video` animates one still — a crop, a keyframe — with
// Wan 2.2 A14B turbo on fal. It is the cheap clip: $0.05–0.10 a video against
// MiniMax H3's ~$0.48, and it takes an end frame, so the same image at both
// ends gives a closed loop (the ambient channels' live islands).
//
// Shaped like `pva_generate_minimax_h3_video`: the frames are guarded inside
// the episode and sent as data URIs, the call goes through fal's queue via
// @av/fal-media, it is reserved and settled on the episode's spend ledger
// (avg-91o), and the clip lands under the episode with a provenance sidecar.
// The one difference in money: the reservation is the price of the
// resolution actually asked for, not the profile's single (720p) figure.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createHash, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  createFalClient,
  getProfile,
  FalHttpError,
  FalValidationError,
  WAN_22_TURBO_PRICES_USD,
} from "@av/fal-media";
import { toMicros } from "@studio/contracts/src/budget.mjs";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { resolveConfig } from "./config.js";
import { guardEpisodePath } from "./trust-guards.js";
import { paidCall, providerCost } from "./spend.js";

export const WAN_PROFILE_ID = "wan/v2.2-a14b/image-to-video/turbo@v1";
export const WAN_RESOLUTIONS = ["480p", "580p", "720p"] as const;
export type WanResolution = (typeof WAN_RESOLUTIONS)[number];

/**
 * What one turbo clip costs at a resolution, in USD. The prices live with the
 * profile in @av/fal-media, read from fal's API page
 * (https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo/api).
 */
export function wanClipPriceUsd(resolution: WanResolution): number {
  return WAN_22_TURBO_PRICES_USD[resolution];
}

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HEARTBEAT_MS = 15_000;
const MAX_WAIT_MS = 900_000;

function imageDataUrl(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png"
    : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : ext === ".webp" ? "image/webp"
    : null;
  if (!mime) throw new Error(`Unsupported image type: ${ext || "no extension"} (png, jpg or webp)`);
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

export interface WanRequest {
  prompt: string;
  imageDataUrl: string;
  endImageDataUrl?: string;
  resolution: WanResolution;
  aspectRatio: "auto" | "16:9" | "9:16" | "1:1";
  seed: number;
  enablePromptExpansion: boolean;
  acceleration?: "none" | "regular";
  videoQuality?: "low" | "medium" | "high" | "maximum";
}

/** The request body fal's turbo endpoint takes, from the tool's parameters. */
export function wanRequestBody(r: WanRequest): Record<string, unknown> {
  return {
    image_url: r.imageDataUrl,
    prompt: r.prompt,
    ...(r.endImageDataUrl ? { end_image_url: r.endImageDataUrl } : {}),
    resolution: r.resolution,
    aspect_ratio: r.aspectRatio,
    seed: r.seed,
    enable_prompt_expansion: r.enablePromptExpansion,
    enable_safety_checker: true,
    ...(r.acceleration ? { acceleration: r.acceleration } : {}),
    ...(r.videoQuality ? { video_quality: r.videoQuality } : {}),
  };
}

export function registerWanTools(pi: ExtensionAPI): void {
  const LIBRARY_ROOT = process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");

  pi.registerTool({
    name: "pva_generate_wan_video",
    label: "Generate Wan 2.2 Video",
    description:
      "Animate one episode image with Wan 2.2 A14B turbo through fal.ai (paid: $0.10 at 720p, $0.075 at 580p, " +
      "$0.05 at 480p, on the episode's spend ledger). loop: true sends the same image as the end frame, for a " +
      "closed loop (live islands, ambient loops); or name a different endImagePath. Clips are ~5 s. " +
      "Saves assets/video/wan/<name>.mp4 and <name>.provenance.json in the episode. Check pva_budget_status first.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      name: Type.String({ description: "Safe clip name (letters, digits, _ and -), the MP4's filename" }),
      prompt: Type.String({ description: "What moves and how; say what stays still and that the camera is locked" }),
      imagePath: Type.String({ description: "Episode-relative opening image (png, jpg or webp)" }),
      endImagePath: Type.Optional(Type.String({ description: "Episode-relative closing image; omit with loop: true" })),
      loop: Type.Optional(Type.Boolean({ default: false, description: "End on the opening image: a closed loop" })),
      resolution: Type.Optional(StringEnum(WAN_RESOLUTIONS, { default: "720p", description: "Sets the price" })),
      aspectRatio: Type.Optional(StringEnum(["auto", "16:9", "9:16", "1:1"] as const, { default: "auto" })),
      seed: Type.Optional(Type.Integer({ minimum: 0, description: "Omitted: one is picked and recorded" })),
      enablePromptExpansion: Type.Optional(Type.Boolean({ default: false })),
      acceleration: Type.Optional(StringEnum(["none", "regular"] as const)),
      videoQuality: Type.Optional(StringEnum(["low", "medium", "high", "maximum"] as const)),
      overwrite: Type.Optional(Type.Boolean({ default: false, description: "Replace an existing clip of this name" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      if (!SAFE_NAME.test(params.name)) {
        throw new Error("name must contain only letters, numbers, underscores and hyphens (max 64)");
      }
      if (params.loop && params.endImagePath && params.endImagePath !== params.imagePath) {
        throw new Error("loop: true ends on imagePath; do not also name a different endImagePath");
      }

      const dir = episodePath(LIBRARY_ROOT, params.channel, params.series, params.episode);
      const resolveImage = async (relativePath: string): Promise<string> => {
        const guard = await guardEpisodePath(LIBRARY_ROOT, params.channel, params.series, params.episode, relativePath);
        if (!guard.allowed) throw new Error(guard.reason ?? `Image path rejected: ${relativePath}`);
        const full = join(dir, relativePath);
        if (!existsSync(full)) throw new Error(`Image not found: ${relativePath}`);
        return full;
      };
      const startPath = await resolveImage(params.imagePath);
      const endRelative = params.loop ? params.imagePath : params.endImagePath;
      const endPath = endRelative ? await resolveImage(endRelative) : undefined;

      const videoDir = join(dir, "assets", "video", "wan");
      const outputPath = join(videoDir, `${params.name}.mp4`);
      const provenancePath = join(videoDir, `${params.name}.provenance.json`);
      // Before anything is spent: a name already taken is a mistake more often than a retake.
      if (existsSync(outputPath) && !params.overwrite) {
        throw new Error(`assets/video/wan/${params.name}.mp4 already exists: pick another name, or pass overwrite: true`);
      }

      const config = await resolveConfig();
      if (!config.falKeyRef) throw new Error("FAL_KEY env var not set");
      const profile = getProfile(WAN_PROFILE_ID);
      if (!profile) throw new Error("Wan 2.2 turbo image-to-video profile is not installed in @av/fal-media");

      const resolution: WanResolution = params.resolution ?? "720p";
      const aspectRatio = params.aspectRatio ?? "auto";
      // fal does not report the seed through the client's result, so pick it
      // here: the provenance then always says how to make the same clip again.
      const seed = params.seed ?? randomInt(0, 2 ** 31 - 1);
      const startData = imageDataUrl(startPath);
      const endData = endPath ? (endPath === startPath ? startData : imageDataUrl(endPath)) : undefined;
      const parameters = wanRequestBody({
        prompt: params.prompt,
        imageDataUrl: startData,
        ...(endData ? { endImageDataUrl: endData } : {}),
        resolution,
        aspectRatio,
        seed,
        enablePromptExpansion: params.enablePromptExpansion ?? false,
        ...(params.acceleration ? { acceleration: params.acceleration } : {}),
        ...(params.videoQuality ? { videoQuality: params.videoQuality } : {}),
      });
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ ...parameters, image_url: undefined, end_image_url: undefined }))
        .update(readFileSync(startPath))
        .update(endPath ? readFileSync(endPath) : Buffer.alloc(0))
        .digest("hex")
        .slice(0, 20);

      const priceUsd = wanClipPriceUsd(resolution);
      onUpdate?.({
        content: [{ type: "text" as const, text: `Submitting ${params.name} to Wan 2.2 turbo (${resolution}, $${priceUsd})…` }],
        details: { name: params.name, profileId: profile.profileId },
      });

      const client = createFalClient(config.falKeyRef);
      const startedMs = Date.now();
      const heartbeat = setInterval(() => {
        onUpdate?.({
          content: [{ type: "text" as const, text: `Wan ${params.name}: waiting on fal… ${Math.round((Date.now() - startedMs) / 1000)}s` }],
          details: { name: params.name, elapsedMs: Date.now() - startedMs },
        });
      }, HEARTBEAT_MS);
      heartbeat.unref?.();

      let result;
      try {
        // Through the episode's spend ledger (avg-91o), reserved at this
        // resolution's price and settled at what fal reports.
        result = await paidCall(
          { libraryRoot: LIBRARY_ROOT, channel: params.channel, series: params.series, episode: params.episode },
          {
            capability: "video.generate",
            provider: "fal",
            model: profile.profileId,
            purpose: `clip ${params.name}`,
            estimate: {
              estimate: { currency: "USD", micros: toMicros(priceUsd) },
              priced: true,
              profile: profile.profileId,
            },
          },
          async (spend) => {
            spend.sending();
            try {
              const generated = await client.submitAndWait({
                idempotencyKey: `${params.channel}-${params.series}-${params.episode}-${params.name}-${requestHash}`,
                binding: { endpointId: profile.endpointId, contractVersion: profile.contractVersion, baseUrl: "" },
                parameters,
                timeoutMs: MAX_WAIT_MS,
              }, signal, { maxWaitMs: MAX_WAIT_MS });
              return { value: generated, cost: providerCost(generated.cost), providerRequestId: generated.providerRequestId };
            } catch (e) {
              // Refused before submit, or by fal with a 4xx: nothing generated.
              // Anything else may have been billed and stays reserved.
              if (e instanceof FalValidationError || (e instanceof FalHttpError && e.status >= 400 && e.status < 500 && e.status !== 429)) {
                spend.refused();
              }
              throw e;
            }
          },
        );
      } finally {
        clearInterval(heartbeat);
      }

      const output = result.outputs.find((o) => o.contentType.startsWith("video/")) ?? result.outputs[0];
      if (!output) throw new Error("Wan 2.2 completed without a video output");
      const download = await fetch(output.url, { signal });
      if (!download.ok) throw new Error(`Failed to download the Wan 2.2 clip (fal request ${result.providerRequestId}): HTTP ${download.status}`);
      const data = Buffer.from(await download.arrayBuffer());

      mkdirSync(videoDir, { recursive: true });
      writeFileSync(outputPath, data);
      const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
      const provenance = {
        version: 1,
        provider: "fal.ai",
        model: "Wan 2.2 A14B image-to-video turbo",
        endpointId: profile.endpointId,
        profileId: result.profileId,
        schemaFingerprint: result.schemaFingerprint,
        providerRequestId: result.providerRequestId,
        idempotencyKey: result.idempotencyKey,
        prompt: params.prompt,
        imagePath: params.imagePath,
        imageSha256: sha(startPath),
        ...(endRelative ? { endImagePath: endRelative, endImageSha256: sha(endPath!) } : {}),
        loop: Boolean(params.loop) || (endRelative !== undefined && endRelative === params.imagePath),
        resolution,
        aspectRatio,
        seed,
        enablePromptExpansion: params.enablePromptExpansion ?? false,
        ...(params.acceleration ? { acceleration: params.acceleration } : {}),
        ...(params.videoQuality ? { videoQuality: params.videoQuality } : {}),
        estimatedCost: { amount: priceUsd, currency: "USD" },
        cost: result.cost,
        outputUrl: output.url,
        outputSha256: createHash("sha256").update(data).digest("hex"),
        completedAt: result.completedAt.toISOString(),
      };
      writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));

      return {
        content: [{
          type: "text" as const,
          text: `✅ assets/video/wan/${params.name}.mp4 — ${(data.length / 1024 / 1024).toFixed(1)}MB, seed ${seed}, ` +
            `${result.cost ? `$${result.cost.amount}` : `~$${priceUsd}`} (${result.profileId})`,
        }],
        details: {
          outputPath,
          provenancePath,
          size: data.length,
          profileId: result.profileId,
          providerRequestId: result.providerRequestId,
          seed,
          cost: result.cost,
          estimatedCostUsd: priceUsd,
        },
      };
    },
  });
}
