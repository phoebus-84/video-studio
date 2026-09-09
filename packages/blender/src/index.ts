import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile, stat, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runProcess } from "./process.js";

export interface RenderSettings {
  engine: "eevee" | "cycles";
  width: number;
  height: number;
  fps: number;
  frameStart: number;
  frameEnd: number;
  samples: number;
  seed: number;
  /** CPU is portable. GPU must be explicitly configured and available. */
  device: "cpu" | "cuda" | "optix" | "hip" | "metal" | "oneapi";
}
export interface BlenderRequest {
  mode: "create" | "preview" | "animation";
  /** New attempt directory. Existing directories are never overwritten. */
  outputDir: string;
  /** Required for create. Agent-authored Python runs with full local privileges. */
  scriptPath?: string;
  /** Required for preview/animation; optional starting scene for create. */
  blendPath?: string;
  /** Explicit acknowledgement, not a sandbox or a human approval receipt. */
  trustedInput: boolean;
  settings?: Partial<RenderSettings>;
}
export interface BlenderOptions {
  blenderPath?: string;
  ffmpegPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface BlenderResult {
  outputDir: string;
  manifestPath: string;
  blendPath: string;
  mediaPath?: string;
  frameCount: number;
}

export function blenderExecutable(): string {
  if (process.env.BLENDER_BIN) return process.env.BLENDER_BIN;
  const mac = "/Applications/Blender.app/Contents/MacOS/Blender";
  return process.platform === "darwin" && existsSync(mac) ? mac : "blender";
}
export function probe(blenderPath = blenderExecutable()): { available: boolean; detail: string } {
  const p = spawnSync(blenderPath, ["--version"], { encoding: "utf8", timeout: 10_000 });
  const version = p.stdout?.match(/Blender (\d+)\.(\d+)[^\n]*/);
  const supported = version && (
    (Number(version[1]) === 4 && Number(version[2]) >= 2) ||
    (Number(version[1]) === 5 && Number(version[2]) === 2)
  );
  return {
    available: !p.error && p.status === 0 && !!supported,
    detail: p.error ? p.error.message : supported ? version[0] : "Requires Blender 4.2–4.x or 5.2.x LTS; set BLENDER_BIN",
  };
}
export function settingsFor(input: Partial<RenderSettings> = {}): RenderSettings {
  const settings: RenderSettings = {
    engine: "eevee", width: 640, height: 360, fps: 24, frameStart: 1,
    frameEnd: 48, samples: 32, seed: 0, device: "cpu", ...input,
  };
  const ranges: Record<string, [number, number]> = {
    width: [16, 7680], height: [16, 4320], fps: [1, 120], frameStart: [1, 1_000_000],
    frameEnd: [1, 1_000_000], samples: [1, 4096], seed: [0, 2147483647],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const v = settings[key as keyof RenderSettings];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new Error(`Invalid ${key}: ${v}`);
  }
  if (settings.width % 2 || settings.height % 2) throw new Error("Dimensions must be even for yuv420p");
  if (settings.frameEnd < settings.frameStart || settings.frameEnd - settings.frameStart >= 10_000) throw new Error("Frame range must contain 1–10000 frames");
  if (!["eevee", "cycles"].includes(settings.engine)) throw new Error("Unknown render engine");
  if (!["cpu", "cuda", "optix", "hip", "metal", "oneapi"].includes(settings.device)) throw new Error("Unknown device");
  if (settings.engine === "eevee" && settings.device !== "cpu") throw new Error("Device selection applies only to Cycles; Eevee manages its GPU context");
  return settings;
}
async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function nonempty(file: string): Promise<void> {
  if (!(await stat(file)).isFile() || (await stat(file)).size === 0) throw new Error(`Missing or empty output: ${file}`);
}

/** Save an editable scene or render one. Never promotes the result to a deliverable. */
export async function runBlender(request: BlenderRequest, options: BlenderOptions = {}): Promise<BlenderResult> {
  if (request.trustedInput !== true) throw new Error("Blender inputs must be reviewed and trusted; Python is NOT sandboxed");
  if (!["create", "preview", "animation"].includes(request.mode)) throw new Error("Unknown mode");
  if (request.mode === "create" ? !request.scriptPath : !request.blendPath) throw new Error("create requires scriptPath; rendering requires blendPath");
  if (request.mode !== "create" && request.scriptPath) throw new Error("Render an accepted .blend; scripts belong in a separate create attempt");
  const settings = settingsFor(request.settings);
  const timeoutMs = options.timeoutMs ?? 600_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86_400_000) throw new Error("timeoutMs must be 1–86400000");
  options.signal?.throwIfAborted();
  const outputDir = resolve(request.outputDir);
  const inputScript = request.scriptPath ? resolve(request.scriptPath) : undefined;
  const inputBlend = request.blendPath ? resolve(request.blendPath) : undefined;
  if (inputScript) await nonempty(inputScript);
  if (inputBlend) await nonempty(inputBlend);
  await mkdir(dirname(outputDir), { recursive: true });
  await mkdir(outputDir); // exclusive attempt reservation, including concurrent callers
  const manifestPath = join(outputDir, "manifest.json");
  const blendPath = join(outputDir, "scene.blend");
  const manifest: Record<string, unknown> = {
    schemaVersion: 1, status: "running", mode: request.mode, settings,
    startedAt: new Date().toISOString(), inputScript, inputBlend,
  };
  const persist = async () => {
    await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2) + "\n");
    await rename(`${manifestPath}.tmp`, manifestPath);
  };
  await persist();
  try {
    const executable = options.blenderPath ?? blenderExecutable();
    const health = probe(executable);
    if (!health.available) throw new Error(health.detail);
    manifest.blender = health.detail;
    if (inputScript) {
      await copyFile(inputScript, join(outputDir, "source.py"));
      manifest.scriptSha256 = await digest(join(outputDir, "source.py"));
    }
    if (inputBlend) {
      // Detect concurrent artist saves. Relative external paths are made absolute
      // while loading the original file, then packed by the worker.
      manifest.blendSha256 = await digest(inputBlend);
    }
    const worker = fileURLToPath(new URL("../python/worker.py", import.meta.url));
    manifest.workerSha256 = await digest(worker);
    const config = {
      mode: request.mode, outputDir, settings, blendPath: inputBlend,
      scriptPath: inputScript ? join(outputDir, "source.py") : undefined,
      inputDir: inputScript ? dirname(inputScript) : inputBlend ? dirname(inputBlend) : outputDir,
    };
    const configPath = join(outputDir, "request.json");
    await writeFile(configPath, JSON.stringify(config, null, 2));
    await runProcess(executable, [
      "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1",
      "--python", worker, "--", configPath,
    ], { cwd: outputDir, logPath: join(outputDir, "blender.log"), timeoutMs, signal: options.signal });
    if (inputBlend && await digest(inputBlend) !== manifest.blendSha256) throw new Error("Source .blend changed during render; retry from a saved revision");
    await nonempty(blendPath);
    const workerResult = JSON.parse(await readFile(join(outputDir, "scene-info.json"), "utf8"));
    manifest.scene = workerResult;
    let mediaPath: string | undefined;
    const frameCount = request.mode === "create" ? 0 : request.mode === "preview" ? 1 : settings.frameEnd - settings.frameStart + 1;
    if (request.mode === "preview") {
      mediaPath = join(outputDir, "preview.png");
      await nonempty(mediaPath);
    } else if (request.mode === "animation") {
      for (let f = settings.frameStart; f <= settings.frameEnd; f++) {
        await nonempty(join(outputDir, "frames", `${String(f).padStart(6, "0")}.png`));
      }
      mediaPath = join(outputDir, "animation.mp4");
      await runProcess(options.ffmpegPath ?? process.env.FFMPEG_BIN ?? "ffmpeg", [
        "-hide_banner", "-nostdin", "-n", "-framerate", String(settings.fps),
        "-start_number", String(settings.frameStart), "-i", join(outputDir, "frames", "%06d.png"),
        "-frames:v", String(frameCount), "-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", mediaPath,
      ], { cwd: outputDir, logPath: join(outputDir, "encode.log"), timeoutMs, signal: options.signal });
      await nonempty(mediaPath);
    }
    const result = { outputDir, manifestPath, blendPath, mediaPath, frameCount };
    Object.assign(manifest, { status: "completed", completedAt: new Date().toISOString(), result,
      outputBlendSha256: await digest(blendPath), mediaSha256: mediaPath ? await digest(mediaPath) : undefined });
    await persist();
    return result;
  } catch (error) {
    Object.assign(manifest, { status: options.signal?.aborted ? "cancelled" : "failed",
      finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    await persist();
    throw new Error(`${manifest.error}; attempt: ${manifestPath}`, { cause: error });
  }
}
