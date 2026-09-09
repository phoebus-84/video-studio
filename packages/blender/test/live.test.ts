import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runBlender } from "../src/index.js";

test("LIVE: Geometry Nodes scene, Eevee + CPU Cycles PNG and animation", { skip: process.env.BLENDER_LIVE !== "1", timeout: 300_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "blender-live-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const created = await runBlender({ mode: "create", scriptPath: fileURLToPath(new URL("../examples/orbit.py", import.meta.url)),
    outputDir: join(root, "create"), trustedInput: true });
  const info = JSON.parse(await readFile(join(created.outputDir, "scene-info.json"), "utf8"));
  assert.ok(info.geometryNodeGroups.includes("Accent Ring"));
  for (const engine of ["eevee", "cycles"] as const) {
    const settings = { engine, width: 64, height: 64, samples: 1, frameStart: 1, frameEnd: 2 };
    const preview = await runBlender({ mode: "preview", blendPath: created.blendPath, outputDir: join(root, `${engine}-preview`), trustedInput: true, settings });
    assert.equal((await readFile(preview.mediaPath!)).subarray(1, 4).toString(), "PNG");
    const animation = await runBlender({ mode: "animation", blendPath: created.blendPath, outputDir: join(root, engine), trustedInput: true, settings });
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=nb_frames,width,height", "-of", "json", animation.mediaPath!], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.width, 64); assert.equal(stream.nb_frames, "2");
  }
});
