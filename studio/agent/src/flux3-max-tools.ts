// FLUX 3 Max text-to-video through fal.ai, with live account pricing and
// episode spend-ledger accounting.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createHash, randomInt } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  createFalClient,
  getProfile,
  FalHttpError,
  FalValidationError,
} from "@av/fal-media";
import { toMicros } from "@studio/contracts/src/budget.mjs";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { resolveConfig } from "./config.js";
import { paidCall, providerCost } from "./spend.js";
import { guardEpisodePath } from "./trust-guards.js";

export const FLUX3_MAX_TEXT_PROFILE_ID = "blackforestlabs/flux-3-max/text-to-video@v1";
export const FLUX3_MAX_IMAGE_PROFILE_ID = "blackforestlabs/flux-3-max/image-to-video@v1";
export const FLUX3_MAX_TEXT_ENDPOINT_ID = "blackforestlabs/flux-3-max/text-to-video";
export const FLUX3_MAX_IMAGE_ENDPOINT_ID = "blackforestlabs/flux-3-max/image-to-video";
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HEARTBEAT_MS = 15_000;
const MAX_WAIT_MS = 900_000;
// fal's pricing API reports $0.02125 per billing second for this account, but
// 720p billing events charge two billing seconds for each output second. This
// matches the advertised effective 720p rate of $0.0425/output-second.
export const FLUX3_MAX_720P_BILLING_UNITS_PER_OUTPUT_SECOND = 2;

export interface Flux3MaxGenerateParams {
  channel: string;
  series: string;
  episode: string;
  name: string;
  prompt: string;
  durationSeconds: number;
  imagePath?: string;
  endImagePath?: string;
  aspectRatio?: "auto" | "21:9" | "2:1" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  reasoningLevel?: "low" | "high";
  generateAudio?: boolean;
  seed?: number;
}

interface LivePrice {
  unitPrice: number;
  unit: string;
  currency: string;
}

function imageDataUrl(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png"
    : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : ext === ".webp" ? "image/webp"
    : null;
  if (!mime) throw new Error(`Unsupported image type: ${ext || "no extension"} (png, jpg or webp)`);
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

/** Get the price actually assigned to this API key; account discounts apply. */
export async function flux3MaxLivePrice(apiKey: string, endpointId: string, signal?: AbortSignal): Promise<LivePrice> {
  const url = new URL("https://api.fal.ai/v1/models/pricing");
  url.searchParams.set("endpoint_id", endpointId);
  const response = await fetch(url, { headers: { Authorization: `Key ${apiKey}` }, signal });
  if (!response.ok) throw new Error(`Could not retrieve authenticated FLUX 3 Max pricing: HTTP ${response.status}`);
  const body = await response.json() as {
    prices?: Array<{ endpoint_id?: string; unit_price?: number; unit?: string; currency?: string }>;
  };
  const price = body.prices?.find((item) => item.endpoint_id === endpointId);
  if (!price || typeof price.unit_price !== "number" || price.unit_price < 0 || price.unit !== "seconds" || !price.currency) {
    throw new Error("fal.ai returned no usable per-second price for FLUX 3 Max");
  }
  return { unitPrice: price.unit_price, unit: price.unit, currency: price.currency };
}

export async function generateFlux3MaxVideo(
  params: Flux3MaxGenerateParams,
  signal?: AbortSignal,
  onUpdate?: (message: string, details?: Record<string, unknown>) => void,
): Promise<{ outputPath: string; provenancePath: string; costUsd: number; seed: number; size: number }> {
  if (!SAFE_NAME.test(params.name)) throw new Error("name must contain only letters, numbers, underscores and hyphens (max 64)");
  if (!Number.isInteger(params.durationSeconds) || params.durationSeconds < 5 || params.durationSeconds > 20) {
    throw new Error("durationSeconds must be a whole number from 5 through 20");
  }

  const libraryRoot = process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");
  // The destination is guarded like the images are: text-to-video names no
  // image, and channel, series and episode alone must not leave the library.
  const destination = await guardEpisodePath(libraryRoot, params.channel, params.series, params.episode, "assets/video/flux-3-max");
  if (!destination.allowed) throw new Error(destination.reason ?? "Episode path rejected");
  const dir = episodePath(libraryRoot, params.channel, params.series, params.episode);
  const videoDir = join(dir, "assets", "video", "flux-3-max");
  const outputPath = join(videoDir, `${params.name}.mp4`);
  const provenancePath = join(videoDir, `${params.name}.provenance.json`);
  // A generated clip is an immutable attempt (ADR-0021): a taken name is
  // refused, never replaced.
  const taken = () => new Error(`assets/video/flux-3-max/${params.name}.mp4 already exists: pick another name`);
  if (existsSync(outputPath) || existsSync(provenancePath)) throw taken();

  const config = await resolveConfig();
  if (!config.falKeyRef) throw new Error("FAL_KEY env var not set");
  const imageMode = params.imagePath !== undefined;
  if (params.endImagePath && !imageMode) throw new Error("endImagePath requires imagePath");
  const profileId = imageMode ? FLUX3_MAX_IMAGE_PROFILE_ID : FLUX3_MAX_TEXT_PROFILE_ID;
  const profile = getProfile(profileId);
  if (!profile) throw new Error(`FLUX 3 Max profile is not installed in @av/fal-media: ${profileId}`);

  const resolveImage = async (relativePath: string): Promise<string> => {
    const guard = await guardEpisodePath(libraryRoot, params.channel, params.series, params.episode, relativePath);
    if (!guard.allowed) throw new Error(guard.reason ?? `Image path rejected: ${relativePath}`);
    const full = join(dir, relativePath);
    if (!existsSync(full)) throw new Error(`Image not found: ${relativePath}`);
    return full;
  };
  const startPath = params.imagePath ? await resolveImage(params.imagePath) : undefined;
  const endPath = params.endImagePath ? await resolveImage(params.endImagePath) : undefined;

  const livePrice = await flux3MaxLivePrice(config.falKeyRef, profile.endpointId, signal);
  const billingUnits = params.durationSeconds * FLUX3_MAX_720P_BILLING_UNITS_PER_OUTPUT_SECOND;
  const estimatedCost = livePrice.unitPrice * billingUnits;
  const seed = params.seed ?? randomInt(0, 2 ** 31 - 1);
  const parameters = {
    ...(startPath ? { image_url: imageDataUrl(startPath) } : {}),
    ...(endPath ? { end_image_url: imageDataUrl(endPath) } : {}),
    prompt: params.prompt,
    duration: params.durationSeconds,
    resolution: "720p",
    reasoning_level: params.reasoningLevel ?? "high",
    aspect_ratio: params.aspectRatio ?? "16:9",
    generate_audio: params.generateAudio ?? true,
    seed,
  };
  const requestHash = createHash("sha256").update(JSON.stringify(parameters)).digest("hex").slice(0, 20);

  // The name is taken before anything is spent: a second call with the same
  // name, at the same moment, is refused here instead of overwriting this one.
  mkdirSync(videoDir, { recursive: true });
  try {
    closeSync(openSync(outputPath, "wx"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw taken();
    throw error;
  }
  let written = false;
  try {
    onUpdate?.(`Submitting ${params.name} to FLUX 3 Max (720p, ${params.durationSeconds}s, estimated $${estimatedCost.toFixed(4)})…`, {
      name: params.name,
      profileId: profile.profileId,
    });

    const client = createFalClient(config.falKeyRef);
    const startedMs = Date.now();
    const heartbeat = setInterval(() => {
      onUpdate?.(`FLUX 3 Max ${params.name}: waiting on fal… ${Math.round((Date.now() - startedMs) / 1000)}s`, {
        name: params.name,
        elapsedMs: Date.now() - startedMs,
      });
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    let result;
    try {
      result = await paidCall(
        { libraryRoot, channel: params.channel, series: params.series, episode: params.episode },
        {
          capability: "video.generate",
          provider: "fal",
          model: profile.profileId,
          purpose: `clip ${params.name}`,
          estimate: {
            estimate: { currency: livePrice.currency, micros: toMicros(estimatedCost) },
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
          } catch (error) {
            if (error instanceof FalValidationError || (error instanceof FalHttpError && error.status >= 400 && error.status < 500 && error.status !== 429)) {
              spend.refused();
            }
            throw error;
          }
        },
      );
    } finally {
      clearInterval(heartbeat);
    }

    const output = result.outputs.find((item) => item.contentType.startsWith("video/")) ?? result.outputs[0];
    if (!output) throw new Error("FLUX 3 Max completed without a video output");
    const download = await fetch(output.url, { signal });
    if (!download.ok) throw new Error(`Failed to download FLUX 3 Max output: HTTP ${download.status}`);
    const data = Buffer.from(await download.arrayBuffer());
    writeFileSync(outputPath, data);
    written = true;

    const provenance = {
      version: 1,
      provider: "fal.ai",
      model: "FLUX 3 Max",
      endpointId: profile.endpointId,
      profileId: result.profileId,
      schemaFingerprint: result.schemaFingerprint,
      providerRequestId: result.providerRequestId,
      idempotencyKey: result.idempotencyKey,
      prompt: params.prompt,
      mode: imageMode ? "image-to-video" : "text-to-video",
      ...(params.imagePath ? { imagePath: params.imagePath, imageSha256: createHash("sha256").update(readFileSync(startPath!)).digest("hex") } : {}),
      ...(params.endImagePath ? { endImagePath: params.endImagePath, endImageSha256: createHash("sha256").update(readFileSync(endPath!)).digest("hex") } : {}),
      durationSeconds: params.durationSeconds,
      resolution: "720p",
      aspectRatio: parameters.aspect_ratio,
      reasoningLevel: parameters.reasoning_level,
      generateAudio: parameters.generate_audio,
      seed,
      authenticatedUnitPrice: livePrice,
      billingUnits,
      billingUnitsPerOutputSecond: FLUX3_MAX_720P_BILLING_UNITS_PER_OUTPUT_SECOND,
      estimatedCost: { amount: estimatedCost, currency: livePrice.currency },
      cost: result.cost,
      outputUrl: output.url,
      outputSha256: createHash("sha256").update(data).digest("hex"),
      completedAt: result.completedAt.toISOString(),
    };
    writeFileSync(provenancePath, JSON.stringify(provenance, null, 2), { flag: "wx" });
    return { outputPath, provenancePath, costUsd: result.cost?.amount ?? estimatedCost, seed, size: data.length };
  } finally {
    // No clip was written: the name is free again.
    if (!written) {
      try { unlinkSync(outputPath); } catch { /* already gone */ }
    }
  }
}

export function registerFlux3MaxTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "pva_generate_flux3_max_video",
    label: "Generate FLUX 3 Max Video",
    description: "Generate a 5–20 second 720p text-to-video or image-to-video clip with FLUX 3 Max through fal.ai. Pass imagePath for image-to-video. Retrieves this API key's live per-second price, reserves it on the episode spend ledger, and saves the MP4 plus provenance under assets/video/flux-3-max/. Check pva_budget_status first.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      name: Type.String({ description: "Safe clip filename without extension" }),
      prompt: Type.String({ description: "Scene, action, camera, realism and desired native audio" }),
      durationSeconds: Type.Integer({ minimum: 5, maximum: 20 }),
      imagePath: Type.Optional(Type.String({ description: "Episode-relative opening PNG, JPEG or WebP; enables image-to-video" })),
      endImagePath: Type.Optional(Type.String({ description: "Optional episode-relative closing image" })),
      aspectRatio: Type.Optional(StringEnum(["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"] as const, { default: "16:9" })),
      reasoningLevel: Type.Optional(StringEnum(["low", "high"] as const, { default: "high" })),
      generateAudio: Type.Optional(Type.Boolean({ default: true })),
      seed: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await generateFlux3MaxVideo(params, signal, (message, details) => onUpdate?.({
        content: [{ type: "text" as const, text: message }],
        details,
      }));
      return {
        content: [{ type: "text" as const, text: `✅ assets/video/flux-3-max/${params.name}.mp4 — ${(result.size / 1024 / 1024).toFixed(1)}MB, seed ${result.seed}, $${result.costUsd}` }],
        details: result,
      };
    },
  });
}
