// Mapillary produces immutable scene assets, under the destination's policy.
// Parent records include the downloaded image hashes and raw provider evidence;
// derivation evidence embeds those snapshots so reuse is portable.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { angleDiff, bearing, creatorOf, distance, heading, imageSize, MAPILLARY_LICENCE, MAPILLARY_RESTRICTIONS, runs, type Mapillary, type MapillaryImage } from "@av/archive-media";
import type { MediaProvenance } from "@studio/contracts/src/media-provenance.mjs";
import { assertMediaAllowed, derivationEvidence, mediaSource, type MediaRules, type MediaSource } from "./media-integrity.js";
import { newMediaName, producedRecord, publishMedia } from "./media-output.js";
import { mediaCommand, mediaFfmpeg, measureProducedMedia } from "./media-process.js";

const viewFilter = (pano: boolean, yaw: number, pitch: number, vfov: number, w = 1080, h = 1920) => {
  if (!pano) return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const hfov = (2 * Math.atan(Math.tan((vfov / 2) * Math.PI / 180) * (w / h)) * 180) / Math.PI;
  return panFilter(yaw, pitch, hfov, vfov, w, h);
};
const panFilter = (yaw: number, pitch: number, hfov: number, vfov: number, w = 1080, h = 1920) =>
  `v360=e:flat:yaw=${yaw.toFixed(2)}:pitch=${pitch.toFixed(2)}:h_fov=${hfov.toFixed(2)}:v_fov=${vfov.toFixed(2)}:w=${w}:h=${h}:interp=lanczos`;
const planetFilter = (yaw: number, w = 1080, h = 1920) => `v360=e:sg:pitch=-90:yaw=${yaw.toFixed(2)}:h_fov=210:v_fov=290:w=${w}:h=${h}:interp=lanczos`;

interface ProductionOptions extends MediaRules { signal?: AbortSignal }
export interface MapillaryStillOptions extends ProductionOptions { vertical?: boolean; yaw?: number; pitch?: number; fov?: number }
export interface MapillaryHyperlapseOptions extends ProductionOptions { start?: number; end?: number; reverse?: boolean; durationSeconds?: number; fps?: number; yaw?: number; pitch?: number; fov?: number; interp?: "mci" | "blend" | "none" }
export interface MapillaryPanOptions extends ProductionOptions { durationSeconds?: number; fps?: number; yaw?: number; turn?: number; pitch?: number; fov?: number }
export interface MapillaryPlanetOptions extends ProductionOptions { durationSeconds?: number; fps?: number; yaw?: number; turn?: number }
const credit = (imgs: MapillaryImage[]) => `Mapillary · ${[...new Set(imgs.map(creatorOf))].sort().join(", ")} · ${MAPILLARY_LICENCE.id} (${MAPILLARY_LICENCE.url})`;
const itemOf = (image: MapillaryImage, url: string): MediaProvenance["item"] => ({ id: image.id, title: `Mapillary image ${image.id}`, creator: creatorOf(image), institution: "Mapillary", landingUrl: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(image.id)}`, fileUrl: url, rendition: "best still exposed by the API" });
const sourceOf = (item: MediaProvenance["item"], attribution: string) => ({ apiVersion: "studio.video/v1alpha1" as const, kind: "MediaProvenance" as const, provider: { id: "mapillary", label: "Mapillary" }, item, licence: { ...MAPILLARY_LICENCE }, attribution });
function ready(name: string, options: ProductionOptions, adaptation: boolean): void {
  newMediaName(name); options.signal?.throwIfAborted(); assertMediaAllowed(MAPILLARY_LICENCE, options, adaptation);
}
function finite(value: number, label: string, min = -3600, max = 3600): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return value;
}
function clock(duration: number, fps: number) {
  finite(duration, "durationSeconds", Number.EPSILON, 120); finite(fps, "fps", 1, 60);
  if (!Number.isInteger(fps)) throw new Error("fps must be an integer");
  return { duration, fps, frames: Math.max(1, Math.round(duration * fps)) };
}
function camera(options: { yaw?: number; pitch?: number; fov?: number }) {
  return { yaw: finite(options.yaw ?? 0, "yaw"), pitch: finite(options.pitch ?? 9, "pitch", -90, 90), fov: finite(options.fov ?? 89, "fov", 1, 179) };
}
async function downloadSource(map: Mapillary, image: MapillaryImage, pano: boolean, scratch: string, name: string, signal?: AbortSignal, knownUrl?: string) {
  signal?.throwIfAborted();
  const url = knownUrl ?? await map.still(image, pano), file = join(scratch, `${name}.jpg`);
  await map.download(url, file); signal?.throwIfAborted();
  const facts = imageSize(file);
  if (!facts || facts.mime !== "image/jpeg") throw new Error("Mapillary did not return a JPEG image");
  const evidenceText = `${JSON.stringify(image, null, 2)}\n`;
  const record = producedRecord(file, `assets/images/mapillary-${image.id}.jpg`, sourceOf(itemOf(image, url), credit([image])), evidenceText, facts);
  return { file, source: mediaSource(record, evidenceText) };
}
async function finish(file: string, path: string, item: MediaProvenance["item"], images: MapillaryImage[], operation: object, sources: MediaSource[], signal?: AbortSignal) {
  const ffmpeg = (await mediaCommand(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], signal)).split("\n")[0];
  const evidenceText = derivationEvidence({ ...operation, ffmpeg, restrictions: MAPILLARY_RESTRICTIONS }, sources);
  const video = file.endsWith(".mp4");
  const facts = video ? await measureProducedMedia(file, signal) : imageSize(file);
  if (!facts || (video && !("durationSeconds" in facts))) throw new Error("produced media could not be measured");
  const record = producedRecord(file, path, sourceOf(item, `${credit(images)}; locally produced (${item.rendition})`), evidenceText, { ...facts, mime: video ? "video/mp4" : "image/jpeg" });
  return { record, evidenceText };
}

export async function saveMapillaryStill(map: Mapillary, workspace: string, imageId: string, name: string, options: MapillaryStillOptions = {}) {
  ready(name, options, !!options.vertical); const view = camera(options);
  const image = await map.one(imageId, ",thumb_original_url,thumb_2048_url");
  return publishMedia(workspace, "assets/images", name, ".jpg", options, async (file, scratch) => {
    const { file: src, source } = await downloadSource(map, image, !!image.is_pano, scratch, "source", options.signal);
    if (options.vertical) await mediaFfmpeg(["-i", src, "-vf", viewFilter(!!image.is_pano, view.yaw, view.pitch, view.fov), "-q:v", "2", file], options.signal);
    else writeFileSync(file, readFileSync(src));
    const rendition = options.vertical ? image.is_pano ? "360°→9:16 reprojection" : "centre-crop 9:16" : "best still";
    return finish(file, `assets/images/${name}.jpg`, { ...source.record.item, rendition }, [image], { kind: "mapillary-still", vertical: !!options.vertical, ...view }, [source], options.signal);
  });
}

export async function renderMapillaryHyperlapse(map: Mapillary, workspace: string, seq: string, name: string, options: MapillaryHyperlapseOptions = {}) {
  ready(name, options, true); const view = camera(options);
  for (const key of ["start", "end"] as const) if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key]! < 0)) throw new Error(`${key} must be a non-negative index`);
  if (options.start !== undefined && options.end !== undefined && options.end < options.start) throw new Error("end precedes start");
  let list = await map.sequence(seq);
  if (options.start === undefined && options.end === undefined) {
    const best = runs(list)[0]; if (!best) throw new Error("no straight run in this sequence: pass start/end");
    list = list.slice(best.from, best.to + 1);
  } else list = list.slice(options.start ?? 0, (options.end ?? list.length - 1) + 1);
  if (options.reverse) list = [...list].reverse();
  if (list.length < 5) throw new Error("need at least 5 images");
  const timing = clock(options.durationSeconds ?? list.length / 12, options.fps ?? 30);
  const interp = options.interp ?? "mci";
  if (!["mci", "blend", "none"].includes(interp)) throw new Error("invalid interpolation mode");
  const pano = !!list[0]!.is_pano, rate = list.length / timing.duration;
  const urls = await map.stills(list.map((i) => i.id), pano);
  return publishMedia(workspace, "assets/video", name, ".mp4", options, async (file, scratch) => {
    const sources: MediaSource[] = [], yaws: number[] = [];
    for (let k = 0; k < list.length; k++) {
      options.signal?.throwIfAborted();
      let sx = 0, sy = 0;
      for (let j = Math.max(0, k - 8); j < Math.min(list.length - 1, k + 8); j++) { const t = bearing(list[j]!, list[j + 1]!) * Math.PI / 180; sx += Math.sin(t); sy += Math.cos(t); }
      const yaw = ((((Math.atan2(sx, sy) * 180 / Math.PI - heading(list[k]!) + view.yaw + 180) % 360) + 360) % 360) - 180;
      yaws.push(yaw);
      const url = urls.get(list[k]!.id); if (!url) throw new Error(`Mapillary image ${list[k]!.id} names no file`);
      const got = await downloadSource(map, list[k]!, pano, scratch, `source-${k}`, options.signal, url); sources.push(got.source);
      await mediaFfmpeg(["-i", got.file, "-vf", viewFilter(pano, yaw, view.pitch, view.fov), "-q:v", "2", join(scratch, `f${String(k).padStart(4, "0")}.jpg`)], options.signal);
    }
    const motion = { mci: `,minterpolate=fps=${timing.fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`, blend: `,framerate=fps=${timing.fps}`, none: `,fps=${timing.fps}` }[interp];
    await mediaFfmpeg(["-framerate", String(rate), "-i", join(scratch, "f%04d.jpg"), "-vf", `deflicker=size=7${motion},format=yuv420p`, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", "-an", file], options.signal);
    const meters = Math.round(list.slice(0, -1).reduce((sum, i, j) => sum + distance(i, list[j + 1]!), 0));
    return finish(file, `assets/video/${name}.mp4`, { ...sources[0]!.record.item, id: seq, title: `Mapillary hyperlapse ${seq}`, creator: [...new Set(list.map(creatorOf))].sort().join(", "), rendition: `hyperlapse from sequence ${seq} (${list.length} images, ${meters} m)` }, list,
      { kind: "mapillary-hyperlapse", sequence: seq, imageIds: list.map((i) => i.id), pano, ...timing, ...view, yaws, interp, reverse: !!options.reverse, meters }, sources, options.signal);
  });
}

export async function renderMapillaryPan(map: Mapillary, workspace: string, imageId: string, name: string, options: MapillaryPanOptions = {}) {
  ready(name, options, true); const view = camera(options), timing = clock(options.durationSeconds ?? 6, options.fps ?? 30), turn = finite(options.turn ?? 120, "turn");
  const image = await map.one(imageId, ",thumb_original_url"); if (!image.is_pano) throw new Error("pan needs a 360° image");
  return publishMedia(workspace, "assets/video", name, ".mp4", options, async (file, scratch) => {
    const got = await downloadSource(map, image, true, scratch, "source", options.signal);
    for (let k = 0; k < timing.frames; k++) {
      const p = k / Math.max(1, timing.frames - 1), eased = p * p * (3 - 2 * p);
      await mediaFfmpeg(["-i", got.file, "-vf", viewFilter(true, view.yaw + turn * eased, view.pitch, view.fov), "-q:v", "3", join(scratch, `f${String(k).padStart(4, "0")}.jpg`)], options.signal);
    }
    await encodeFrames(scratch, file, timing.fps, options.signal);
    return finish(file, `assets/video/${name}.mp4`, { ...got.source.record.item, title: `Mapillary pan ${image.id}`, rendition: `pan inside 360° image (yaw ${view.yaw}→${view.yaw + turn}°)` }, [image], { kind: "mapillary-pan", ...view, ...timing, turn, easing: "smoothstep" }, [got.source], options.signal);
  });
}

export async function renderMapillaryPlanet(map: Mapillary, workspace: string, imageId: string, name: string, options: MapillaryPlanetOptions = {}) {
  ready(name, options, true); const yaw = finite(options.yaw ?? 0, "yaw"), turn = finite(options.turn ?? 120, "turn");
  const timing = options.durationSeconds === undefined ? null : clock(options.durationSeconds, options.fps ?? 30);
  const image = await map.one(imageId, ",thumb_original_url"); if (!image.is_pano) throw new Error("planet needs a 360° image");
  const folder = timing ? "assets/video" : "assets/images", ext = timing ? ".mp4" : ".jpg";
  return publishMedia(workspace, folder, name, ext, options, async (file, scratch) => {
    const got = await downloadSource(map, image, true, scratch, "source", options.signal);
    if (!timing) await mediaFfmpeg(["-i", got.file, "-vf", planetFilter(yaw), "-q:v", "2", file], options.signal);
    else {
      for (let k = 0; k < timing.frames; k++) await mediaFfmpeg(["-i", got.file, "-vf", planetFilter(yaw + turn * k / timing.frames), "-q:v", "3", join(scratch, `f${String(k).padStart(4, "0")}.jpg`)], options.signal);
      await encodeFrames(scratch, file, timing.fps, options.signal);
    }
    return finish(file, `${folder}/${name}${ext}`, { ...got.source.record.item, title: `Mapillary tiny planet ${image.id}`, rendition: `tiny planet${timing ? " (spinning)" : ""} from 360° image` }, [image], { kind: "mapillary-planet", spinning: !!timing, yaw, turn, ...(timing ?? {}) }, [got.source], options.signal);
  });
}
async function encodeFrames(scratch: string, file: string, fps: number, signal?: AbortSignal) {
  await mediaFfmpeg(["-framerate", String(fps), "-i", join(scratch, "f%04d.jpg"), "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", "-an", file], signal);
}
export const mapillaryFilters = { viewFilter, planetFilter, panFilter };
export function sequenceGeoJson(path: MapillaryImage[], seq: string): string {
  if (!path.length) throw new Error("sequence is empty");
  return `${JSON.stringify({ type: "Feature", properties: { sequence: seq, creator: creatorOf(path[0]!), license: MAPILLARY_LICENCE.id }, geometry: { type: "LineString", coordinates: path.map((i) => { const [lng, lat] = (i.computed_geometry ?? i.geometry)!.coordinates; return [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7]; }) } }, null, 2)}\n`;
}
export { angleDiff, runs };
