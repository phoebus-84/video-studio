#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createFalClient, getProfile } from "../packages/fal-media/dist/index.js";

const episodeDir = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(episodeDir)) {
  throw new Error("Usage: generate-h3-from-motion-plan.mjs <episode-dir> [shot-id]");
}
const onlyShot = process.argv[3];
const falKey = process.env.FAL_KEY;
if (!falKey) throw new Error("FAL_KEY is not set");

const plan = JSON.parse(readFileSync(join(episodeDir, "artifacts", "motion-plan.json"), "utf8"));
const profile = getProfile("minimax/h3/image-to-video@v1");
if (!profile) throw new Error("MiniMax H3 image-to-video profile is not installed");
const client = createFalClient(falKey);
const videoDir = join(episodeDir, "assets", "video");
mkdirSync(videoDir, { recursive: true });

function asDataUrl(path) {
  const ext = extname(path).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

for (const shot of plan.shots) {
  if (onlyShot && shot.id !== onlyShot) continue;
  const outputPath = join(videoDir, `${shot.id}.mp4`);
  const provenancePath = join(videoDir, `${shot.id}.provenance.json`);
  if (existsSync(outputPath) && existsSync(provenancePath)) {
    console.log(`skip ${shot.id}: output already exists`);
    continue;
  }

  const firstPath = join(episodeDir, shot.firstFramePath);
  const lastPath = join(episodeDir, shot.lastFramePath);
  const first = readFileSync(firstPath);
  const last = readFileSync(lastPath);
  const requestHash = createHash("sha256")
    .update(shot.prompt)
    .update(first)
    .update(last)
    .digest("hex")
    .slice(0, 20);
  const idempotencyKey = `motion-plan-${shot.id}-${requestHash}`;

  console.log(`submit ${shot.id} (${shot.durationSeconds}s ${shot.resolution})`);
  const result = await client.submitAndWait({
    idempotencyKey,
    binding: {
      endpointId: profile.endpointId,
      contractVersion: profile.contractVersion,
      baseUrl: "",
    },
    parameters: {
      prompt: shot.prompt,
      duration: shot.durationSeconds,
      resolution: shot.resolution,
      image_url: asDataUrl(firstPath),
      last_image_url: asDataUrl(lastPath),
      enable_prompt_expansion: shot.enablePromptExpansion,
      enable_safety_checker: true,
      seed: shot.seed,
    },
    timeoutMs: 900_000,
  }, undefined, { maxWaitMs: 900_000 });

  const output = result.outputs.find((item) => item.contentType.startsWith("video/")) ?? result.outputs[0];
  if (!output) throw new Error(`${shot.id}: MiniMax completed without video output`);
  const response = await fetch(output.url);
  if (!response.ok) throw new Error(`${shot.id}: output download failed (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, data);
  writeFileSync(provenancePath, `${JSON.stringify({
    version: 1,
    provider: "fal.ai",
    profileId: result.profileId,
    schemaFingerprint: result.schemaFingerprint,
    providerRequestId: result.providerRequestId,
    idempotencyKey: result.idempotencyKey,
    prompt: shot.prompt,
    firstFramePath: shot.firstFramePath,
    lastFramePath: shot.lastFramePath,
    durationSeconds: shot.durationSeconds,
    resolution: shot.resolution,
    seed: shot.seed,
    cost: result.cost,
    outputSha256: createHash("sha256").update(data).digest("hex"),
    completedAt: result.completedAt.toISOString(),
  }, null, 2)}\n`);
  console.log(`done ${shot.id}: ${Math.round(data.length / 1024)}KB request=${result.providerRequestId}`);
}
