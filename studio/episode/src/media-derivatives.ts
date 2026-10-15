// Local derivatives keep the original AND a portable verified provenance chain.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { PROVENANCE_SUFFIX } from "@studio/contracts/src/media-provenance.mjs";
import { assertMediaAllowed, derivationEvidence, mediaHash, mediaPath, verifiedMedia, type MediaRules } from "./media-integrity.js";
import { mediaCommand, mediaFfmpeg, measureProducedMedia } from "./media-process.js";
import { newMediaName, producedRecord, publishMedia } from "./media-output.js";

export interface DerivativeOptions extends MediaRules { startSeconds?: number; durationSeconds?: number; vertical?: boolean; width?: number; height?: number; signal?: AbortSignal }
export async function deriveMedia(workspace: string, inputPath: string, outputName: string, options: DerivativeOptions) {
  if (!/^assets\/(video|sounds)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(inputPath)) throw new Error("inputPath must be a canonical video or sound asset");
  newMediaName(outputName); options.signal?.throwIfAborted();
  if (options.startSeconds !== undefined && (!Number.isFinite(options.startSeconds) || options.startSeconds < 0)) throw new Error("startSeconds must be non-negative");
  if (options.durationSeconds !== undefined && (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0)) throw new Error("durationSeconds must be positive");
  for (const key of ["width", "height"] as const) {
    const n = options[key];
    if (n !== undefined && (!Number.isInteger(n) || n < 64 || n > 4096 || n % 2 !== 0)) throw new Error(`${key} must be an even integer from 64 to 4096`);
  }
  const source = mediaPath(workspace, inputPath);
  if (!existsSync(source)) throw new Error(`${inputPath} does not exist`);
  // Read and verify bytes, adjacent sidecar and the complete evidence chain.
  const parent = verifiedMedia(workspace, inputPath.slice(0, inputPath.lastIndexOf(".")) + PROVENANCE_SUFFIX);
  const upstream = parent.record;
  const adapted = options.vertical === true || options.startSeconds !== undefined || options.durationSeconds !== undefined;
  assertMediaAllowed(upstream.licence, options, adapted);
  const video = inputPath.startsWith("assets/video/"), folder = video ? "assets/video" : "assets/sounds";
  if (video !== upstream.file.mime.startsWith("video/")) throw new Error("input medium does not match provenance");
  if (options.vertical && !video) throw new Error("vertical conversion applies only to video");
  const ext = video ? ".mp4" : extname(inputPath).toLowerCase() === ".wav" ? ".wav" : ".m4a";
  const { policy: _policy, quality: _quality, signal: _signal, ...edit } = options;
  return publishMedia(workspace, folder, outputName, ext, options, async (file, scratch) => {
    // FFmpeg reads a private verified snapshot; editing the original while the
    // worker runs cannot silently change which bytes the evidence describes.
    const bytes = readFileSync(source);
    if (mediaHash(bytes) !== upstream.file.hash) throw new Error("input changed before rendering");
    const snapshot = join(scratch, `input${extname(inputPath)}`); writeFileSync(snapshot, bytes);
    const args = ["-i", snapshot];
    if (edit.startSeconds !== undefined) args.push("-ss", String(edit.startSeconds));
    if (edit.durationSeconds !== undefined) args.push("-t", String(edit.durationSeconds));
    if (video) {
      if (edit.vertical) args.push("-vf", `scale=${edit.width ?? 1080}:${edit.height ?? 1920}:force_original_aspect_ratio=increase,crop=${edit.width ?? 1080}:${edit.height ?? 1920},setsar=1`);
      args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k");
    } else if (ext === ".wav") args.push("-vn", "-c:a", "pcm_s16le"); else args.push("-vn", "-c:a", "aac", "-b:a", "192k");
    await mediaFfmpeg([...args, file], options.signal);
    const measured = await measureProducedMedia(file, options.signal);
    const ffmpeg = (await mediaCommand(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], options.signal)).split("\n")[0];
    const evidenceText = derivationEvidence({ kind: "ffmpeg-derivative", options: edit, command: [...args.map((x) => x === snapshot ? "[input]" : x), "[output]"], ffmpeg }, [parent]);
    const description = [edit.startSeconds !== undefined ? `trim from ${edit.startSeconds}s` : "", edit.durationSeconds !== undefined ? `duration ${edit.durationSeconds}s` : "", edit.vertical ? `${edit.width ?? 1080}×${edit.height ?? 1920} vertical centre crop` : ""].filter(Boolean).join(", ") || "transcoded copy";
    const record = producedRecord(file, `${folder}/${outputName}${ext}`, {
      ...upstream, item: { ...upstream.item, rendition: `${upstream.item.rendition ? `${upstream.item.rendition}; ` : ""}local derivative: ${description}` }, attribution: `${upstream.attribution}; locally derived (${description})`,
    }, evidenceText, { mime: video ? "video/mp4" : ext === ".wav" ? "audio/wav" : "audio/mp4", ...measured });
    return { record, evidenceText };
  });
}
