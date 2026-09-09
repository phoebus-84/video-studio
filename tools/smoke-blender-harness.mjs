#!/usr/bin/env node
// Real production tool handlers, no provider mocks or LLM/browser dependency.
// Run from the repository root: node --import tsx tools/smoke-blender-harness.mjs
// Creates a new scratch episode and retains all native sources, logs and renders.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { registerBlenderTools } from "@studio/agent/src/blender-tools.ts";
import { registerWorkspaceTools } from "@studio/agent/src/workspace-tools.ts";
import { resolveConfig } from "@studio/agent/src/config.ts";
import { episodePath } from "@studio/contracts/src/layout.mjs";

const tools = new Map();
const registrar = { registerTool(tool) { tools.set(tool.name, tool); } };
registerWorkspaceTools(registrar);
registerBlenderTools(registrar);
const signal = AbortSignal.timeout(600_000);
const calls = [];
let auditPath;
async function call(name, params) {
  console.log(`Calling ${name}`);
  const record = { tool: name, params, startedAt: new Date().toISOString(), status: "running" };
  calls.push(record);
  if (auditPath) await writeFile(auditPath, JSON.stringify(calls, null, 2));
  try {
    const result = await tools.get(name).execute(randomUUID(), params, signal,
      update => console.log(update.content?.[0]?.text ?? "Working"));
    if (result.isError) throw new Error(JSON.stringify(result.content));
    Object.assign(record, { status: "completed", details: result.details });
    return result.details;
  } catch (error) {
    Object.assign(record, { status: "failed", error: error.message });
    throw error;
  } finally {
    record.finishedAt = new Date().toISOString();
    if (auditPath) await writeFile(auditPath, JSON.stringify(calls, null, 2));
  }
}
const health = await call("pva_blender_probe", {});
assert.equal(health.available, true, health.detail);
console.log(health.detail);
const ref = { channel: "studio-tests", series: "blender-smoke", episode: `scene-${Date.now()}` };
await call("pva_create_channel", { slug: ref.channel, title: "Studio Tests", description: "Local harness smoke tests; not publication content." });
await call("pva_create_series", { channel: ref.channel, slug: ref.series, title: "Blender Smoke Tests", description: "Editable scene creation and real renderer verification." });
await call("pva_create_episode", { channel: ref.channel, series: ref.series, slug: ref.episode,
  title: "Copper orbit — Blender harness smoke test", description: "Procedural torus, Geometry Nodes ring, lighting, camera and keyframes. Eevee/Cycles stills plus two-second animation.",
  episodeRequest: "User-requested local scene creation and rendering smoke test. No paid services or external assets. Render results are review candidates, not an approved publication.",
  pipelineYaml: await readFile(new URL("../studio/pipelines/pipelines/blender-animation.yaml", import.meta.url), "utf8"),
});
const { libraryRoot } = await resolveConfig();
const episode = resolve(episodePath(libraryRoot, ref.channel, ref.series, ref.episode));
console.log(`Episode: ${episode}`);
auditPath = join(episode, "artifacts", "blender-tool-calls.json");
await writeFile(auditPath, JSON.stringify(calls, null, 2));
const source = join(episode, "artifacts", "blender", "orbit");
await mkdir(source, { recursive: true });
await copyFile(new URL("../packages/blender/examples/orbit.py", import.meta.url), join(source, "scene.py"));
const settings = { engine: "eevee", device: "cpu", width: 640, height: 360,
  fps: 24, frameStart: 1, frameEnd: 48, samples: 16, seed: 7 };
await writeFile(join(episode, "artifacts", "scene-plan.json"), JSON.stringify({
  sceneId: "orbit", direction: "Copper torus rotates above a dark floor, surrounded by a procedural ring of spheres.",
  actionBeats: [{ frame: 1, action: "Loop begins" }, { frame: 49, action: "Loop repeats; exclude duplicate endpoint" }],
  settings, assets: [{ source: "procedural", author: "bundled orbit.py example", external: false }],
  budget: { maxWallTimeSeconds: 600, paidServices: false }, intervention: "user-requested automated smoke test",
  acceptanceCriteria: ["editable scene", "Geometry Nodes group", "Eevee/Cycles PNGs", "48 decodable H.264 frames at 24 FPS"],
}, null, 2));
const built = await call("pva_blender_create_scene", { ...ref, sceneId: "orbit", scriptPath: relative(episode, join(source, "scene.py")), trustedInput: true, settings, timeoutMs: 120000 });
const buildManifest = JSON.parse(await readFile(built.manifestPath, "utf8"));
assert.equal(buildManifest.status, "completed");
assert.ok(buildManifest.scene.geometryNodeGroups.includes("Accent Ring"));
assert.ok(buildManifest.scene.objects.includes("Camera"));
await writeFile(join(episode, "artifacts", "scene-source.json"), JSON.stringify({
  sceneId: "orbit", manifestPath: relative(episode, built.manifestPath), blendPath: relative(episode, built.blendPath),
  sourceSha256: buildManifest.outputBlendSha256,
}, null, 2));
const results = { episode, blender: health.detail, scene: built.blendPath };
const render = async (mode, engine, frameStart = 1) => call("pva_blender_render", {
  ...ref, sceneId: "orbit", blendPath: relative(episode, built.blendPath), mode, trustedInput: true,
  settings: { ...settings, engine, frameStart }, timeoutMs: 300000,
});
const out = join(episode, "output");
await mkdir(out, { recursive: true });
for (const engine of ["eevee", "cycles"]) {
  const result = await render("preview", engine);
  assert.equal((await readFile(result.mediaPath)).subarray(1, 4).toString(), "PNG");
  results[engine] = join(out, `${engine}.png`);
  await copyFile(result.mediaPath, results[engine]);
}
const animation = await render("animation", "eevee");
results.animation = join(out, "animation.mp4");
await copyFile(animation.mediaPath, results.animation);
const ffprobe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", results.animation], { encoding: "utf8", timeout: 30000 });
assert.equal(ffprobe.status, 0, ffprobe.stderr);
const metadata = JSON.parse(ffprobe.stdout);
const stream = metadata.streams.find(s => s.codec_type === "video");
assert.equal(stream.codec_name, "h264"); assert.equal(stream.pix_fmt, "yuv420p");
assert.equal(stream.nb_frames, "48"); assert.equal(stream.r_frame_rate, "24/1");
assert.equal(stream.width, 640); assert.equal(stream.height, 360);
assert.equal(Number(metadata.format.duration), 2);
const decode = spawnSync(process.env.FFMPEG_BIN ?? "ffmpeg", ["-v", "error", "-xerror", "-i", results.animation, "-f", "null", "-"], { encoding: "utf8", timeout: 30000 });
assert.equal(decode.status, 0, decode.stderr);
results.technicalQa = { status: "passed", frameCount: 48, fps: 24, durationSeconds: 2, codec: stream.codec_name, pixelFormat: stream.pix_fmt, fullDecode: true };
results.visualReview = "Pending agent/human inspection; technical checks do not imply visual acceptance";
await writeFile(join(episode, "artifacts", "blender-smoke-result.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
