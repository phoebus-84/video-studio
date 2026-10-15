// Mapillary productions: a still, a hyperlapse along a sequence, a pan inside
// a 360° image, a tiny planet. 360° reprojection and frame assembly are done by
// ffmpeg (v360); every output lands in the workspace with chained provenance and
// the CC BY-SA credit. Nothing here overwrites a fetched original.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  angleDiff, bearing, creatorOf, distance, heading, imageSize, MAPILLARY_LICENCE, MAPILLARY_RESTRICTIONS, runs,
  type Mapillary, type MapillaryImage,
} from "@av/archive-media";
import { EVIDENCE_DIR, PROVENANCE_SUFFIX, validateMediaProvenance, type MediaProvenance } from "@studio/contracts/src/media-provenance.mjs";
import { probeMedia, writeAttributions } from "./archive-media.js";

const digest = (b: Buffer | string) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ffmpeg = (args: string[], timeout = 10 * 60_000) => {
  const run = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf-8", timeout, windowsHide: true });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${(run.stderr || "no output").slice(-800)}`);
};
const viewFilter = (pano: boolean, yaw: number, pitch: number, vfov: number, w = 1080, h = 1920) => {
  if (!pano) return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const hfov = (2 * Math.atan(Math.tan((vfov / 2) * Math.PI / 180) * (w / h)) * 180) / Math.PI;
  return `v360=e:flat:yaw=${yaw.toFixed(2)}:pitch=${pitch.toFixed(2)}:h_fov=${hfov.toFixed(2)}:v_fov=${vfov.toFixed(2)}:w=${w}:h=${h}:interp=lanczos`;
};
const panFilter = (yaw: number, pitch: number, hfov: number, vfov: number, w = 1080, h = 1920) =>
  `v360=e:flat:yaw=${yaw.toFixed(2)}:pitch=${pitch.toFixed(2)}:h_fov=${hfov.toFixed(2)}:v_fov=${vfov.toFixed(2)}:w=${w}:h=${h}:interp=lanczos`;
const planetFilter = (yaw: number, w = 1080, h = 1920) => `v360=e:sg:pitch=-90:yaw=${yaw.toFixed(2)}:h_fov=210:v_fov=290:w=${w}:h=${h}:interp=lanczos`;

export interface MapillaryStillOptions { vertical?: boolean; yaw?: number; pitch?: number; fov?: number }
export interface MapillaryHyperlapseOptions { start?: number; end?: number; reverse?: boolean; durationSeconds?: number; fps?: number; yaw?: number; pitch?: number; fov?: number; interp?: "mci" | "blend" | "none" }
export interface MapillaryPanOptions { durationSeconds?: number; fps?: number; yaw?: number; turn?: number; pitch?: number; fov?: number }
export interface MapillaryPlanetOptions { durationSeconds?: number; fps?: number; yaw?: number; turn?: number }

/** Downloads a Mapillary image's best still; the caller owns the temp file. */
async function fetchStill(map: Mapillary, image: MapillaryImage, pano: boolean, destDir: string, name: string): Promise<string> {
  const url = await map.still(image, pano);
  const dest = join(destDir, name);
  await map.download(url, dest);
  return dest;
}

function writeRecord(workspace: string, folder: string, name: string, file: string, media: Omit<MediaProvenance["file"], "path" | "hash" | "bytes" | "mime">,
  item: MediaProvenance["item"], evidence: unknown, attribution: string): MediaProvenance {
  const bytes = readFileSync(file);
  const mime = item.rendition?.includes("tiny-planet") && file.endsWith(".jpg") ? "image/jpeg" : file.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidenceHash = digest(evidenceText);
  const evidencePath = `${EVIDENCE_DIR}/${evidenceHash.slice("sha256:".length)}.json`;
  const record: MediaProvenance = {
    apiVersion: "studio.video/v1alpha1", kind: "MediaProvenance",
    file: { path: `${folder}/${name}${file.endsWith(".mp4") ? ".mp4" : ".jpg"}`, hash: digest(bytes), bytes: bytes.length, mime, ...media },
    provider: { id: "mapillary", label: "Mapillary" },
    item,
    licence: { ...MAPILLARY_LICENCE },
    attribution, retrievedAt: new Date().toISOString(), evidence: { path: evidencePath, hash: evidenceHash },
  };
  const problems = validateMediaProvenance(record);
  if (problems.length) throw new Error(`Mapillary provenance invalid: ${problems.map((p) => p.message).join("; ")}`);
  mkdirSync(join(workspace, EVIDENCE_DIR), { recursive: true });
  writeFileSync(join(workspace, evidencePath), evidenceText);
  const sidecar = `${folder}/${name}${PROVENANCE_SUFFIX}`;
  if (existsSync(join(workspace, sidecar))) throw new Error(`${sidecar} already exists`);
  writeFileSync(join(workspace, sidecar), `${JSON.stringify(record, null, 2)}\n`);
  writeAttributions(workspace);
  return record;
}
const credit = (imgs: MapillaryImage[]) => `Mapillary · ${[...new Set(imgs.map(creatorOf))].sort().join(", ")} · ${MAPILLARY_LICENCE.id} (${MAPILLARY_LICENCE.url})`;

/**
 * One Mapillary still in the workspace: its best rendition, optionally the 9:16
 * 360° reprojection (or a centre crop of a flat image).
 */
export async function saveMapillaryStill(map: Mapillary, workspace: string, imageId: string, name: string, options: MapillaryStillOptions = {}): Promise<{ path: string; recordPath: string }> {
  if (!NAME.test(name)) throw new Error("invalid asset name");
  const image = await map.one(imageId, ",thumb_original_url,thumb_2048_url");
  const pano = !!image.is_pano;
  const folder = "assets/images";
  mkdirSync(join(workspace, folder), { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "mly-"));
  const target = join(workspace, folder, `${name}.jpg`);
  if (existsSync(target)) throw new Error(`${folder}/${name}.jpg already exists`);
  try {
    const src = await fetchStill(map, image, pano, tmp, "src.jpg");
    if (options.vertical) ffmpeg(["-i", src, "-vf", viewFilter(pano, options.yaw ?? 0, options.pitch ?? 9, options.fov ?? 89), "-q:v", "2", target]);
    else writeFileSync(target, readFileSync(src));
    const measured = imageSize(target);
    const rendition = `${options.vertical ? (pano ? "360°→9:16 reprojection" : "centre-crop 9:16") : "best still"}`;
    const record = writeRecord(workspace, folder, name, target, { ...(measured ? { width: measured.width, height: measured.height } : {}) },
      { id: image.id, title: `Mapillary image ${image.id}`, ...(creatorOf(image) ? { creator: creatorOf(image) } : {}), institution: "Mapillary",
        landingUrl: `https://www.mapillary.com/app/?pKey=${image.id}`, fileUrl: String(image.thumb_original_url ?? image.thumb_2048_url), rendition },
      { kind: "mapillary-still", imageId: image.id, sequence: image.sequence, vertical: !!options.vertical, restrictions: MAPILLARY_RESTRICTIONS },
      `${credit([image])}; locally produced (${rendition})`);
    return { path: record.file.path, recordPath: `${folder}/${name}${PROVENANCE_SUFFIX}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * A hyperlapse along a Mapillary sequence: 360° frames reprojected along the
 * walking direction, assembled to 1080×1920. The best straight run is used
 * unless `start`/`end` are given.
 */
export async function renderMapillaryHyperlapse(map: Mapillary, workspace: string, seq: string, name: string, options: MapillaryHyperlapseOptions = {}): Promise<{ path: string; recordPath: string }> {
  if (!NAME.test(name)) throw new Error("invalid asset name");
  let list = await map.sequence(seq);
  if (options.start === undefined && options.end === undefined) {
    const best = runs(list)[0];
    if (!best) throw new Error("no straight run in this sequence: pass start/end");
    list = list.slice(best.from, best.to + 1);
  } else {
    list = list.slice(options.start ?? 0, (options.end ?? list.length - 1) + 1);
  }
  if (options.reverse) list = [...list].reverse();
  if (list.length < 5) throw new Error("need at least 5 images");
  const pano = !!list[0]!.is_pano;
  const duration = options.durationSeconds ?? Math.round((list.length / 12) * 100) / 100;
  const fps = options.fps ?? 30;
  const rate = list.length / duration;
  const urls = await map.stills(list.map((i) => i.id), pano);
  const folder = "assets/video";
  mkdirSync(join(workspace, folder), { recursive: true });
  const target = join(workspace, folder, `${name}.mp4`);
  if (existsSync(target)) throw new Error(`${folder}/${name}.mp4 already exists`);
  const tmp = mkdtempSync(join(tmpdir(), "mly-"));
  try {
    const fov = options.fov ?? 89, pitch = options.pitch ?? 9, yawOffset = options.yaw ?? 0, n = list.length;
    const yaws = list.map((_img, k) => {
      let sx = 0, sy = 0;
      for (let j = Math.max(0, k - 8); j < Math.min(n - 1, k + 8); j++) {
        const t = (bearing(list[j]!, list[j + 1]!) * Math.PI) / 180;
        sx += Math.sin(t); sy += Math.cos(t);
      }
      return ((Math.atan2(sx, sy) * 180) / Math.PI - heading(list[k]!) + yawOffset + 180) % 360 - 180;
    });
    for (let k = 0; k < n; k++) {
      const url = urls.get(list[k]!.id);
      if (!url) throw new Error(`Mapillary image ${list[k]!.id} names no file`);
      const src = join(tmp, `s${String(k).padStart(4, "0")}.jpg`);
      await map.download(url, src);
      ffmpeg(["-i", src, "-vf", viewFilter(pano, yaws[k]!, pitch, fov), "-q:v", "2", join(tmp, `f${String(k).padStart(4, "0")}.jpg`)]);
      rmSync(src, { force: true });
    }
    const interp = { mci: `,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`, blend: `,framerate=fps=${fps}`, none: `,fps=${fps}` }[options.interp ?? "mci"];
    ffmpeg(["-framerate", rate.toFixed(4), "-i", join(tmp, "f%04d.jpg"), "-vf", `deflicker=size=7${interp},format=yuv420p`,
      "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", "-an", target]);
    const meters = Math.round(list.slice(0, -1).reduce((sum, i, j) => sum + distance(i, list[j + 1]!), 0));
    const rendition = `hyperlapse from sequence ${seq} (${list.length} images, ${meters} m)`;
    const record = writeRecord(workspace, folder, name, target, { width: 1080, height: 1920, durationSeconds: duration },
      { id: seq, title: `Mapillary hyperlapse ${seq}`, creator: [...new Set(list.map(creatorOf))].sort().join(", "), institution: "Mapillary",
        landingUrl: `https://www.mapillary.com/app/?pKey=${list[0]!.id}`, fileUrl: String((await map.still(list[0]!, pano))), rendition },
      { kind: "mapillary-hyperlapse", sequence: seq, imageIds: list.map((i) => i.id), pano, fps, imagesPerSecond: Math.round(rate * 100) / 100,
        interp: options.interp ?? "mci", meters, restrictions: MAPILLARY_RESTRICTIONS },
      `${credit(list)}; locally produced (${rendition})`);
    return { path: record.file.path, recordPath: `${folder}/${name}${PROVENANCE_SUFFIX}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * A pan inside one 360° image: the camera turns from `yaw` by `turn` degrees,
 * eased, to an MP4.
 */
export async function renderMapillaryPan(map: Mapillary, workspace: string, imageId: string, name: string, options: MapillaryPanOptions = {}): Promise<{ path: string; recordPath: string }> {
  if (!NAME.test(name)) throw new Error("invalid asset name");
  const image = await map.one(imageId, ",thumb_original_url");
  if (!image.is_pano) throw new Error("pan needs a 360° image");
  const duration = options.durationSeconds ?? 6, fps = options.fps ?? 30, yaw0 = options.yaw ?? 0, turn = options.turn ?? 120, pitch = options.pitch ?? 9, fov = options.fov ?? 89;
  const folder = "assets/video";
  mkdirSync(join(workspace, folder), { recursive: true });
  const target = join(workspace, folder, `${name}.mp4`);
  if (existsSync(target)) throw new Error(`${folder}/${name}.mp4 already exists`);
  const tmp = mkdtempSync(join(tmpdir(), "mly-"));
  try {
    const src = await fetchStill(map, image, true, tmp, "src.jpg");
    const n = Math.max(2, Math.round(duration * fps));
    for (let k = 0; k < n; k++) {
      const p = k / (n - 1), eased = p * p * (3 - 2 * p);
      ffmpeg(["-i", src, "-vf", panFilter(yaw0 + turn * eased, pitch, 2 * Math.atan(Math.tan((fov / 2) * Math.PI / 180) * (1080 / 1920)) * 180 / Math.PI, fov), "-q:v", "3", join(tmp, `f${String(k).padStart(4, "0")}.jpg`)]);
    }
    ffmpeg(["-framerate", String(fps), "-i", join(tmp, "f%04d.jpg"), "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", "-an", target]);
    const rendition = `pan inside 360° image (yaw ${yaw0}→${yaw0 + turn}°)`;
    const record = writeRecord(workspace, folder, name, target, { width: 1080, height: 1920, durationSeconds: duration },
      { id: image.id, title: `Mapillary pan ${image.id}`, creator: creatorOf(image), institution: "Mapillary",
        landingUrl: `https://www.mapillary.com/app/?pKey=${image.id}`, fileUrl: String(image.thumb_original_url), rendition },
      { kind: "mapillary-pan", imageId: image.id, sequence: image.sequence, yaw: [yaw0, yaw0 + turn], fps, restrictions: MAPILLARY_RESTRICTIONS },
      `${credit([image])}; locally produced (${rendition})`);
    return { path: record.file.path, recordPath: `${folder}/${name}${PROVENANCE_SUFFIX}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** A tiny planet (stereographic, looking down) of a 360° image: still, or spinning video with `durationSeconds`. */
export async function renderMapillaryPlanet(map: Mapillary, workspace: string, imageId: string, name: string, options: MapillaryPlanetOptions = {}): Promise<{ path: string; recordPath: string }> {
  if (!NAME.test(name)) throw new Error("invalid asset name");
  const image = await map.one(imageId, ",thumb_original_url");
  if (!image.is_pano) throw new Error("planet needs a 360° image");
  const spinning = options.durationSeconds !== undefined;
  const folder = spinning ? "assets/video" : "assets/images";
  mkdirSync(join(workspace, folder), { recursive: true });
  const target = join(workspace, folder, `${name}${spinning ? ".mp4" : ".jpg"}`);
  if (existsSync(target)) throw new Error(`${folder}/${name}${spinning ? ".mp4" : ".jpg"} already exists`);
  const tmp = mkdtempSync(join(tmpdir(), "mly-"));
  try {
    const src = await fetchStill(map, image, true, tmp, "src.jpg");
    const yaw = options.yaw ?? 0, turn = options.turn ?? 120;
    if (!spinning) ffmpeg(["-i", src, "-vf", planetFilter(yaw), "-q:v", "2", target]);
    else {
      const fps = options.fps ?? 30, n = Math.max(2, Math.round(options.durationSeconds! * fps));
      for (let k = 0; k < n; k++) ffmpeg(["-i", src, "-vf", planetFilter(yaw + (turn * k) / n), "-q:v", "3", join(tmp, `f${String(k).padStart(4, "0")}.jpg`)]);
      ffmpeg(["-framerate", String(fps), "-i", join(tmp, "f%04d.jpg"), "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", "-an", target]);
    }
    const measured = probeMedia(target);
    const rendition = `tiny planet${spinning ? " (spinning)" : ""} from 360° image`;
    const record = writeRecord(workspace, folder, name, target,
      { width: 1080, height: 1920, ...(spinning ? { durationSeconds: options.durationSeconds } : measured?.width ? { width: measured.width, height: measured.height! } : {}) },
      { id: image.id, title: `Mapillary tiny planet ${image.id}`, creator: creatorOf(image), institution: "Mapillary",
        landingUrl: `https://www.mapillary.com/app/?pKey=${image.id}`, fileUrl: String(image.thumb_original_url), rendition },
      { kind: "mapillary-planet", imageId: image.id, sequence: image.sequence, spinning, yaw: [yaw, yaw + turn], restrictions: MAPILLARY_RESTRICTIONS },
      `${credit([image])}; locally produced (${rendition})`);
    return { path: record.file.path, recordPath: `${folder}/${name}${PROVENANCE_SUFFIX}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export const mapillaryFilters = { viewFilter, planetFilter, panFilter };

/** A GeoJSON LineString for a sequence path, for maps. */
export function sequenceGeoJson(path: MapillaryImage[], seq: string): string {
  return `${JSON.stringify({ type: "Feature", properties: { sequence: seq, creator: creatorOf(path[0]!) || undefined, license: MAPILLARY_LICENCE.id },
    geometry: { type: "LineString", coordinates: path.map((i) => { const [lng, lat] = (i.computed_geometry ?? i.geometry)!.coordinates; return [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7]; }) } }, null, 2)}\n`;
}

export { angleDiff, runs };
