// ---------------------------------------------------------------------------
// Deterministic rigged-vector animation renderer
// ---------------------------------------------------------------------------
// A small provider-neutral SVG rig format. It keeps character geometry and
// animation intent as reviewable JSON, rasterizes frames with ImageMagick, and
// encodes H.264 with FFmpeg. No generated code or shell fragments are run.
// ---------------------------------------------------------------------------

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";

export type VectorProperty = "x" | "y" | "rotation" | "scaleX" | "scaleY" | "opacity";
export type VectorEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold";

export interface VectorKeyframe {
  frame: number;
  value: number;
  easing?: VectorEasing;
}

export interface VectorTrack {
  target: string;
  property: VectorProperty;
  keyframes: VectorKeyframe[];
}

interface ShapeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export type VectorShape =
  | ({ type: "ellipse"; cx: number; cy: number; rx: number; ry: number } & ShapeStyle)
  | ({ type: "rect"; x: number; y: number; width: number; height: number; rx?: number; ry?: number } & ShapeStyle)
  | ({ type: "path"; d: string } & ShapeStyle)
  | ({ type: "line"; x1: number; y1: number; x2: number; y2: number } & ShapeStyle)
  | ({ type: "polygon"; points: string } & ShapeStyle);

export interface VectorNode {
  id: string;
  parent?: string;
  zIndex?: number;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  shape?: VectorShape;
}

export interface VectorAnimationSpec {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  background: string;
  nodes: VectorNode[];
  tracks: VectorTrack[];
}

export interface VectorRenderResult {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  renderScale: number;
}

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const COLOR_PATTERN = /^(?:#[0-9a-fA-F]{6}|none)$/;
const PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;
const POINTS_PATTERN = /^[0-9eE.,+\-\s]+$/;
const PROPERTIES = new Set<VectorProperty>(["x", "y", "rotation", "scaleX", "scaleY", "opacity"]);
const EASINGS = new Set<VectorEasing>(["linear", "ease-in", "ease-out", "ease-in-out", "hold"]);

function finite(label: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
}

function validateColor(label: string, value: unknown): void {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
    throw new Error(`${label} must be #RRGGBB or none`);
  }
}

function validateShape(nodeId: string, shape: VectorShape): void {
  const prefix = `Node ${nodeId}`;
  validateColor(`${prefix} fill`, shape.fill ?? "none");
  validateColor(`${prefix} stroke`, shape.stroke ?? "none");
  if (shape.strokeWidth !== undefined) {
    finite(`${prefix} strokeWidth`, shape.strokeWidth);
    if (shape.strokeWidth < 0 || shape.strokeWidth > 100) throw new Error(`${prefix} strokeWidth is out of range`);
  }

  switch (shape.type) {
    case "ellipse":
      for (const key of ["cx", "cy", "rx", "ry"] as const) finite(`${prefix} ${key}`, shape[key]);
      if (shape.rx <= 0 || shape.ry <= 0) throw new Error(`${prefix} ellipse radii must be positive`);
      break;
    case "rect":
      for (const key of ["x", "y", "width", "height"] as const) finite(`${prefix} ${key}`, shape[key]);
      if (shape.width <= 0 || shape.height <= 0) throw new Error(`${prefix} rectangle dimensions must be positive`);
      if (shape.rx !== undefined) finite(`${prefix} rx`, shape.rx);
      if (shape.ry !== undefined) finite(`${prefix} ry`, shape.ry);
      break;
    case "path":
      if (!shape.d || !PATH_PATTERN.test(shape.d)) throw new Error(`${prefix} contains unsafe or invalid SVG path data`);
      break;
    case "line":
      for (const key of ["x1", "y1", "x2", "y2"] as const) finite(`${prefix} ${key}`, shape[key]);
      break;
    case "polygon":
      if (!shape.points || !POINTS_PATTERN.test(shape.points)) throw new Error(`${prefix} contains unsafe or invalid polygon points`);
      break;
    default:
      throw new Error(`${prefix} has an unsupported shape type`);
  }
}

export function parseVectorAnimationSpec(value: unknown): VectorAnimationSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Vector animation spec must be an object");
  const spec = value as VectorAnimationSpec;
  if (spec.version !== 1) throw new Error("Vector animation spec version must be 1");
  if (typeof spec.name !== "string" || !spec.name.trim() || spec.name.length > 120) throw new Error("Spec name is invalid");

  for (const key of ["width", "height", "fps", "durationInFrames"] as const) finite(key, spec[key]);
  if (!Number.isInteger(spec.width) || spec.width < 320 || spec.width > 2160) throw new Error("width must be an integer from 320 to 2160");
  if (!Number.isInteger(spec.height) || spec.height < 320 || spec.height > 3840) throw new Error("height must be an integer from 320 to 3840");
  if (!Number.isInteger(spec.fps) || spec.fps < 24 || spec.fps > 60) throw new Error("fps must be an integer from 24 to 60");
  if (!Number.isInteger(spec.durationInFrames) || spec.durationInFrames < 1 || spec.durationInFrames > spec.fps * 60) {
    throw new Error("durationInFrames must describe at most 60 seconds");
  }
  validateColor("background", spec.background);
  if (!Array.isArray(spec.nodes) || spec.nodes.length < 1 || spec.nodes.length > 500) throw new Error("nodes must contain 1-500 rig nodes");
  if (!Array.isArray(spec.tracks) || spec.tracks.length > 2000) throw new Error("tracks must be an array with at most 2000 entries");

  const ids = new Set<string>();
  for (const node of spec.nodes) {
    if (!ID_PATTERN.test(node.id)) throw new Error(`Invalid node id: ${node.id}`);
    if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
    for (const property of ["x", "y", "rotation", "scaleX", "scaleY", "opacity"] as const) {
      if (node[property] !== undefined) finite(`Node ${node.id} ${property}`, node[property]);
    }
    if (node.opacity !== undefined && (node.opacity < 0 || node.opacity > 1)) throw new Error(`Node ${node.id} opacity is out of range`);
    if (node.shape) validateShape(node.id, node.shape);
  }

  const parents = new Map(spec.nodes.map((node) => [node.id, node.parent]));
  for (const node of spec.nodes) {
    if (node.parent && !ids.has(node.parent)) throw new Error(`Node ${node.id} references missing parent ${node.parent}`);
    const visited = new Set<string>([node.id]);
    let parent = node.parent;
    while (parent) {
      if (visited.has(parent)) throw new Error(`Rig hierarchy contains a cycle at ${parent}`);
      visited.add(parent);
      parent = parents.get(parent);
    }
  }

  const trackKeys = new Set<string>();
  for (const track of spec.tracks) {
    if (!ids.has(track.target)) throw new Error(`Track references missing node ${track.target}`);
    if (!PROPERTIES.has(track.property)) throw new Error(`Unsupported animated property: ${track.property}`);
    const key = `${track.target}:${track.property}`;
    if (trackKeys.has(key)) throw new Error(`Duplicate animation track: ${key}`);
    trackKeys.add(key);
    if (!Array.isArray(track.keyframes) || track.keyframes.length < 1) throw new Error(`Track ${key} has no keyframes`);
    let previous = -1;
    for (const frame of track.keyframes) {
      if (!Number.isInteger(frame.frame) || frame.frame < 0 || frame.frame >= spec.durationInFrames) {
        throw new Error(`Track ${key} has an out-of-range frame`);
      }
      if (frame.frame <= previous) throw new Error(`Track ${key} keyframes must be strictly increasing`);
      previous = frame.frame;
      finite(`Track ${key} value`, frame.value);
      if (frame.easing !== undefined && !EASINGS.has(frame.easing)) throw new Error(`Track ${key} has invalid easing`);
      if (track.property === "opacity" && (frame.value < 0 || frame.value > 1)) throw new Error(`Track ${key} opacity is out of range`);
    }
  }

  return spec;
}

export async function loadVectorAnimationSpec(specPath: string): Promise<VectorAnimationSpec> {
  return parseVectorAnimationSpec(JSON.parse(await readFile(specPath, "utf-8")));
}

function easedProgress(progress: number, easing: VectorEasing): number {
  if (easing === "hold") return 0;
  if (easing === "ease-in") return progress * progress;
  if (easing === "ease-out") return 1 - (1 - progress) * (1 - progress);
  if (easing === "ease-in-out") return progress * progress * (3 - 2 * progress);
  return progress;
}

function trackValue(track: VectorTrack, frame: number): number {
  const frames = track.keyframes;
  if (frame <= frames[0]!.frame) return frames[0]!.value;
  if (frame >= frames[frames.length - 1]!.frame) return frames[frames.length - 1]!.value;
  for (let i = 0; i < frames.length - 1; i++) {
    const left = frames[i]!;
    const right = frames[i + 1]!;
    if (frame < right.frame) {
      const progress = (frame - left.frame) / (right.frame - left.frame);
      const eased = easedProgress(progress, left.easing ?? "linear");
      return left.value + (right.value - left.value) * eased;
    }
  }
  return frames[frames.length - 1]!.value;
}

function styleAttributes(shape: ShapeStyle): string {
  return `fill="${shape.fill ?? "none"}" stroke="${shape.stroke ?? "none"}" stroke-width="${shape.strokeWidth ?? 0}"`;
}

function shapeMarkup(shape: VectorShape): string {
  const style = styleAttributes(shape);
  if (shape.type === "ellipse") return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" ${style}/>`;
  if (shape.type === "rect") return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx ?? 0}" ry="${shape.ry ?? 0}" ${style}/>`;
  if (shape.type === "path") return `<path d="${shape.d}" ${style}/>`;
  if (shape.type === "line") return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${style}/>`;
  return `<polygon points="${shape.points}" ${style}/>`;
}

export function renderVectorSvg(spec: VectorAnimationSpec, frame: number, renderScale = 1): string {
  if (!Number.isInteger(frame) || frame < 0 || frame >= spec.durationInFrames) throw new Error("Frame is out of range");
  if (!Number.isFinite(renderScale) || renderScale <= 0 || renderScale > 1) throw new Error("renderScale must be greater than 0 and at most 1");

  const tracks = new Map(spec.tracks.map((track) => [`${track.target}:${track.property}`, track]));
  const children = new Map<string | undefined, VectorNode[]>();
  for (const node of spec.nodes) {
    const siblings = children.get(node.parent) ?? [];
    siblings.push(node);
    children.set(node.parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  const current = (node: VectorNode, property: VectorProperty, fallback: number): number => {
    const track = tracks.get(`${node.id}:${property}`);
    return track ? trackValue(track, frame) : (node[property] ?? fallback);
  };

  const renderNode = (node: VectorNode): string => {
    const x = current(node, "x", 0);
    const y = current(node, "y", 0);
    const rotation = current(node, "rotation", 0);
    const scaleX = current(node, "scaleX", 1);
    const scaleY = current(node, "scaleY", 1);
    const opacity = current(node, "opacity", 1);
    const radians = rotation * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    // A single affine matrix avoids ImageMagick MSVG applying transform-list
    // operations in the wrong order for nested rigs.
    const transform = `matrix(${cosine * scaleX} ${sine * scaleX} ${-sine * scaleY} ${cosine * scaleY} ${x} ${y})`;
    const body = `${node.shape ? shapeMarkup(node.shape) : ""}${(children.get(node.id) ?? []).map(renderNode).join("")}`;
    return `<g id="${node.id}" opacity="${opacity}" transform="${transform}">${body}</g>`;
  };

  const width = Math.round(spec.width * renderScale);
  const height = Math.round(spec.height * renderScale);
  const body = (children.get(undefined) ?? []).map(renderNode).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${spec.width} ${spec.height}"><rect width="${spec.width}" height="${spec.height}" fill="${spec.background}"/>${body}</svg>\n`;
}

async function run(binary: string, args: string[], signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 8192); });
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(new Error("Vector animation render cancelled"));
      else if (code === 0) resolve();
      else reject(new Error(`${binary} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function mapConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await worker(item);
    }
  }));
}

/**
 * The ImageMagick entry point available on this machine.
 *
 * ImageMagick 7 ships a single `magick` binary. Version 6 — still what most
 * Linux distributions package, including the Ubuntu images GitHub Actions
 * runs — ships `convert` instead. Hardcoding `magick` meant rendering failed
 * with ENOENT anywhere only v6 was installed.
 */
function imageMagick(): string {
  for (const candidate of ["magick", "convert"]) {
    const probe = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error(
    "ImageMagick not found. Install it and ensure `magick` (v7) or `convert` (v6) is on PATH.",
  );
}

export async function renderVectorAnimation(options: {
  spec: VectorAnimationSpec;
  outputPath: string;
  renderScale?: number;
  keepFrames?: boolean;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}): Promise<VectorRenderResult> {
  const spec = parseVectorAnimationSpec(options.spec);
  const renderScale = options.renderScale ?? 1;
  if (!Number.isFinite(renderScale) || renderScale < 0.1 || renderScale > 1) throw new Error("renderScale must be from 0.1 to 1");

  const outputPath = path.resolve(options.outputPath);
  const frameDir = path.join(path.dirname(outputPath), `.vector-frames-${path.basename(outputPath, path.extname(outputPath))}`);
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  try {
    const frames = Array.from({ length: spec.durationInFrames }, (_, frame) => frame);
    let completed = 0;
    await mapConcurrent(frames, 4, async (frame) => {
      if (options.signal?.aborted) throw new Error("Vector animation render cancelled");
      const stem = `frame-${String(frame).padStart(5, "0")}`;
      const svgPath = path.join(frameDir, `${stem}.svg`);
      const pngPath = path.join(frameDir, `${stem}.png`);
      await writeFile(svgPath, renderVectorSvg(spec, frame, renderScale), "utf-8");
      await run(imageMagick(), ["-background", "none", svgPath, pngPath], options.signal);
      await rm(svgPath, { force: true });
      completed += 1;
      options.onProgress?.(completed, spec.durationInFrames);
    });

    await run("ffmpeg", [
      "-y",
      "-framerate", String(spec.fps),
      "-i", path.join(frameDir, "frame-%05d.png"),
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ], options.signal);
  } finally {
    if (!options.keepFrames) await rm(frameDir, { recursive: true, force: true });
  }

  return {
    outputPath,
    width: Math.round(spec.width * renderScale),
    height: Math.round(spec.height * renderScale),
    fps: spec.fps,
    frames: spec.durationInFrames,
    durationSeconds: spec.durationInFrames / spec.fps,
    renderScale,
  };
}
