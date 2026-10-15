// Local, deterministic media derivatives. Originals and their provider evidence stay untouched.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { EVIDENCE_DIR, PROVENANCE_SUFFIX, validateMediaProvenance, type MediaProvenance } from "@studio/contracts/src/media-provenance.mjs";
import { probeMedia, writeAttributions } from "./archive-media.js";

const digest = (b: Buffer | string) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const safeRel = (p: string) => !p.includes("\\") && !p.startsWith("/") && !normalize(p).split(/[\\/]/).includes("..");
export interface DerivativeOptions { startSeconds?: number; durationSeconds?: number; vertical?: boolean; width?: number; height?: number; }
export function deriveMedia(workspace: string, inputPath: string, outputName: string, options: DerivativeOptions) {
  if (!safeRel(inputPath) || !/^assets\/(video|sounds)\/[A-Za-z0-9._-]+$/.test(inputPath)) throw new Error("inputPath must be a canonical video or sound asset");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(outputName)) throw new Error("invalid output name");
  for (const [key, value] of Object.entries(options)) if (key !== "vertical" && value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`${key} must be positive`);
  const source = join(workspace, inputPath); if (!existsSync(source)) throw new Error(`${inputPath} does not exist`);
  const base = inputPath.slice(0, inputPath.lastIndexOf("."));
  const recordPath = `${base}${PROVENANCE_SUFFIX}`, upstream = JSON.parse(readFileSync(join(workspace, recordPath), "utf-8")) as MediaProvenance;
  const problems = validateMediaProvenance(upstream); if (problems.length) throw new Error(`invalid upstream provenance: ${problems[0]!.message}`);
  if (digest(readFileSync(source)) !== upstream.file.hash) throw new Error("input bytes no longer match provenance");
  const video = inputPath.startsWith("assets/video/"), folder = video ? "assets/video" : "assets/sounds";
  if (options.vertical && !video) throw new Error("vertical conversion applies only to video");
  const ext = video ? ".mp4" : extname(inputPath).toLowerCase() === ".wav" ? ".wav" : ".m4a";
  const outputPath = `${folder}/${outputName}${ext}`, output = join(workspace, outputPath);
  if (existsSync(output) || existsSync(join(workspace, `${folder}/${outputName}${PROVENANCE_SUFFIX}`))) throw new Error(`${outputName} already exists`);
  mkdirSync(dirname(output), { recursive: true });
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", source];
  if (options.startSeconds !== undefined) args.push("-ss", String(options.startSeconds));
  if (options.durationSeconds !== undefined) args.push("-t", String(options.durationSeconds));
  if (video) {
    if (options.vertical) {
      const w = Math.round(options.width ?? 1080), h = Math.round(options.height ?? 1920);
      args.push("-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`);
    }
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k");
  } else if (ext === ".wav") args.push("-c:a", "pcm_s16le"); else args.push("-c:a", "aac", "-b:a", "192k");
  args.push(output);
  const run = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 10 * 60_000, windowsHide: true });
  if (run.status !== 0 || !existsSync(output)) throw new Error(`ffmpeg failed: ${(run.stderr || "no output").slice(-1000)}`);
  const bytes = readFileSync(output), measured = probeMedia(output) ?? {};
  const operation = { kind: "ffmpeg-derivative", source: { path: inputPath, hash: upstream.file.hash, provenance: recordPath }, options, command: args.map((x, i) => i === args.length - 1 || x === source ? `[${i === args.length - 1 ? "output" : "input"}]` : x), ffmpeg: String(spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" }).stdout).split("\n")[0] };
  const evidenceText = `${JSON.stringify(operation, null, 2)}\n`, evidenceHash = digest(evidenceText), evidencePath = `${EVIDENCE_DIR}/${evidenceHash.slice(7)}.json`;
  mkdirSync(join(workspace, EVIDENCE_DIR), { recursive: true }); writeFileSync(join(workspace, evidencePath), evidenceText);
  const description = [options.startSeconds !== undefined ? `trim from ${options.startSeconds}s` : "", options.durationSeconds !== undefined ? `duration ${options.durationSeconds}s` : "", options.vertical ? `${options.width ?? 1080}×${options.height ?? 1920} vertical centre crop` : ""].filter(Boolean).join(", ") || "transcoded copy";
  const record: MediaProvenance = {
    ...upstream,
    file: { path: outputPath, hash: digest(bytes), bytes: bytes.length, mime: video ? "video/mp4" : ext === ".wav" ? "audio/wav" : "audio/mp4", ...(measured.width ? { width: measured.width } : {}), ...(measured.height ? { height: measured.height } : {}), ...(measured.durationSeconds ? { durationSeconds: measured.durationSeconds } : {}) },
    item: { ...upstream.item, rendition: `${upstream.item.rendition ? `${upstream.item.rendition}; ` : ""}local derivative: ${description}` },
    attribution: `${upstream.attribution}; locally derived (${description})`, retrievedAt: new Date().toISOString(), evidence: { path: evidencePath, hash: evidenceHash },
  };
  const shape = validateMediaProvenance(record); if (shape.length) throw new Error(`derived provenance invalid: ${shape[0]!.message}`);
  const sidecar = `${folder}/${outputName}${PROVENANCE_SUFFIX}`; writeFileSync(join(workspace, sidecar), `${JSON.stringify(record, null, 2)}\n`); writeAttributions(workspace);
  return { path: outputPath, recordPath: sidecar, record };
}
