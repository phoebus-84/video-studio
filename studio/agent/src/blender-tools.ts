import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, realpath, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { runBlender, probe } from "@av/blender";
import { searchAssets, assetFiles, downloadAsset } from "@av/blender/poly-haven";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { resolveConfig } from "./config.js";
import { guardEpisodePath } from "./trust-guards.js";

const identity = {
  channel: Type.String(), series: Type.String(), episode: Type.String(),
};
type Episode = { channel: string; series: string; episode: string };
const settings = Type.Object({
  engine: Type.Optional(StringEnum(["eevee", "cycles"] as const)),
  width: Type.Optional(Type.Integer({ minimum: 16, maximum: 7680 })),
  height: Type.Optional(Type.Integer({ minimum: 16, maximum: 4320 })),
  fps: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })),
  frameStart: Type.Optional(Type.Integer({ minimum: 1 })),
  frameEnd: Type.Optional(Type.Integer({ minimum: 1 })),
  samples: Type.Optional(Type.Integer({ minimum: 1, maximum: 4096 })),
  seed: Type.Optional(Type.Integer({ minimum: 0 })),
  device: Type.Optional(StringEnum(["cpu", "cuda", "optix", "hip", "metal", "oneapi"] as const)),
});

/** Lexical AND realpath containment, including symlinks in existing parents. */
export async function blenderEpisodePath(root: string, ref: Episode, input: string): Promise<string> {
  const path = input.replace(/^@/, "");
  if (isAbsolute(path)) throw new Error("Use an episode-relative path");
  const guard = await guardEpisodePath(root, ref.channel, ref.series, ref.episode, path);
  if (!guard.allowed) throw new Error(guard.reason);
  const episode = episodePath(root, ref.channel, ref.series, ref.episode);
  const actualRoot = await realpath(root);
  const actualEpisode = await realpath(episode);
  const inside = (base: string, target: string) => target === base || target.startsWith(base + sep);
  if (!inside(actualRoot, actualEpisode)) throw new Error("Episode symlink escapes library");
  const target = resolve(episode, path);
  let parent = target;
  while (true) {
    try {
      const actual = await realpath(parent);
      if (!inside(actualEpisode, actual)) throw new Error("Path symlink escapes episode");
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // A dangling symlink must not pass as a new directory.
      const { lstat } = await import("node:fs/promises");
      try { if ((await lstat(parent)).isSymbolicLink()) throw new Error("Dangling symlink"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (parent === episode) throw err;
      parent = dirname(parent);
    }
  }
  return target;
}
async function requireComposition(capability: string): Promise<void> {
  const manifest = JSON.parse(await readFile(new URL("../../../composed.json", import.meta.url), "utf8"));
  if (manifest.capabilities?.[capability]?.provider !== "blender") {
    throw new Error(`${capability} is not bound to blender; run compose with the blender, studio or full profile`);
  }
  // Stored readiness is not authoritative: runBlender probes the live binary.
}
export async function blenderCapabilityStatus(): Promise<Record<string, { available: boolean; detail: string }>> {
  const health = probe();
  const ffmpeg = spawnSync(process.env.FFMPEG_BIN ?? "ffmpeg", ["-version"], { timeout: 5000, stdio: "ignore" });
  const encodingReady = !ffmpeg.error && ffmpeg.status === 0;
  const result: Record<string, { available: boolean; detail: string }> = {};
  for (const capability of ["scene.create", "scene.render"]) {
    try {
      await requireComposition(capability);
      result[capability] = capability === "scene.render" && !encodingReady
        ? { available: false, detail: `${health.detail}; FFmpeg unavailable for animation encoding` }
        : health;
    } catch (err) {
      result[capability] = { available: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
  return result;
}
async function attempt(ref: Episode, scene: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(scene)) throw new Error("Invalid sceneId");
  const { libraryRoot } = await resolveConfig();
  const outputDir = await blenderEpisodePath(libraryRoot, ref, `assets/blender/${scene}/${randomUUID()}`);
  return { libraryRoot, outputDir };
}
const text = (value: unknown) => [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];

export function registerBlenderTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "pva_blender_probe", label: "Blender readiness",
    description: "Probe local Blender version. Requires Blender 4.2–4.x or 5.2.x; reports failure without substituting another renderer.",
    parameters: Type.Object({}),
    async execute() { const result = probe(); return { content: text(result), details: result }; },
  });
  pi.registerTool({
    name: "pva_blender_create_scene", label: "Create Blender scene",
    description: "Build an editable .blend with reviewed Blender Python (bpy, keyframes, Geometry Nodes, appended assets). Full local code execution, NOT sandboxed. Writes a new immutable attempt, never a current deliverable. Load blender-scene skill first.",
    parameters: Type.Object({ ...identity,
      sceneId: Type.String(), scriptPath: Type.String({ description: "Reviewed .py path relative to episode" }),
      blendPath: Type.Optional(Type.String({ description: "Optional saved scene to revise, relative to episode" })),
      trustedInput: Type.Boolean({ description: "Must be true only after reviewing the input; not a substitute for required human approval" }),
      settings: Type.Optional(settings),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400000 })),
    }),
    async execute(_id, params, signal, onUpdate) {
      await requireComposition("scene.create");
      const { libraryRoot, outputDir } = await attempt(params, params.sceneId);
      const scriptPath = await blenderEpisodePath(libraryRoot, params, params.scriptPath);
      const blendPath = params.blendPath ? await blenderEpisodePath(libraryRoot, params, params.blendPath) : undefined;
      onUpdate?.({ content: text({ status: "building", outputDir }), details: {} });
      const result = await runBlender({ mode: "create", outputDir, scriptPath, blendPath,
        trustedInput: params.trustedInput, settings: params.settings }, { signal, timeoutMs: params.timeoutMs });
      return { content: text(result), details: result };
    },
  });
  pi.registerTool({
    name: "pva_blender_render", label: "Render Blender scene",
    description: "Render a saved .blend to one PNG preview or PNG sequence + silent H.264 MP4 using Eevee or Cycles. Accepts artist-edited scenes. New attempt, cancellable, no automatic promotion. Composite audio/captions with video composer. Defaults are cheap preview settings; final settings must be explicit.",
    parameters: Type.Object({ ...identity,
      sceneId: Type.String(), blendPath: Type.String({ description: "Saved .blend path relative to episode" }),
      mode: StringEnum(["preview", "animation"] as const), trustedInput: Type.Boolean(),
      settings: Type.Optional(settings),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400000 })),
    }),
    async execute(_id, params, signal, onUpdate) {
      await requireComposition("scene.render");
      const { libraryRoot, outputDir } = await attempt(params, params.sceneId);
      const blendPath = await blenderEpisodePath(libraryRoot, params, params.blendPath);
      if (!(await stat(blendPath)).isFile()) throw new Error("Save the .blend before rendering");
      onUpdate?.({ content: text({ status: "rendering", outputDir }), details: {} });
      const result = await runBlender({ mode: params.mode, outputDir, blendPath,
        trustedInput: params.trustedInput, settings: params.settings }, { signal, timeoutMs: params.timeoutMs });
      const episodeDir = episodePath(libraryRoot, params.channel, params.series, params.episode);
      return { content: text({ ...result, episodeRelativeMedia: result.mediaPath ? relative(episodeDir, result.mediaPath) : undefined }), details: result };
    },
  });
  pi.registerTool({
    name: "pva_poly_haven", label: "Poly Haven assets",
    description: "Search CC0 Poly Haven assets, list explicit file/resolution keys, or download one selected file with checksum/provenance and byte budget. Models may need separate dependencies; does not install add-ons or run downloaded code. Output is limited to 100 file entries.",
    parameters: Type.Object({ ...identity,
      action: StringEnum(["search", "files", "download"] as const),
      assetType: Type.Optional(StringEnum(["hdris", "textures", "models"] as const)),
      query: Type.Optional(Type.String()), assetId: Type.Optional(Type.String()),
      fileKey: Type.Optional(Type.String()),
      maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483648 })),
    }),
    async execute(_id, params, signal) {
      await requireComposition("scene.create");
      const networkSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000);
      if (params.action === "search") {
        const result = await searchAssets(params.assetType ?? "hdris", params.query ?? "", networkSignal);
        return { content: text(result), details: {} };
      }
      if (!params.assetId) throw new Error("assetId required");
      if (params.action === "files") {
        const files = await assetFiles(params.assetId, networkSignal);
        return { content: text({ files: files.slice(0, 100), total: files.length }), details: {} };
      }
      if (!params.fileKey) throw new Error("fileKey required; list files first");
      const { outputDir } = await attempt(params, "downloads");
      await mkdir(dirname(outputDir), { recursive: true });
      const result = await downloadAsset(params.assetId, params.fileKey, outputDir, { maxBytes: params.maxBytes, signal: networkSignal });
      return { content: text(result), details: result };
    },
  });
}
