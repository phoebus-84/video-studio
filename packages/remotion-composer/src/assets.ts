// Verify every declared asset and stage it for Remotion: files are checked
// against their hash (a different file is an error, never a silent
// re-render), then hard-linked (copied when linking fails) into a temporary
// public directory, named by asset id, that the bundle serves. An image whose
// longer side is over twice the frame's is staged as a copy scaled to that:
// twice the frame keeps a 2x zoom as sharp as the original, and Chrome
// decodes and scales far fewer pixels for every frame that shows it.

import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createReadStream, existsSync, realpathSync} from 'node:fs';
import {copyFile, link, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {EditTimeline} from './schema.js';
import type {ComposerProblem} from './errors.js';

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

/** The longer side an image is staged at, at most: twice the frame's. */
export const imageLimit = (timeline: Pick<EditTimeline, 'profile'>) =>
  2 * Math.max(timeline.profile?.width ?? 0, timeline.profile?.height ?? 0);

/**
 * Writes `abs` scaled so its longer side is `limit` (Lanczos; JPEG at the
 * encoder's best quality, PNG and WebP lossless) and returns true; false,
 * writing nothing, when it is no larger or cannot be read as an image.
 */
export function scaleImage(abs: string, target: string, limit: number): boolean {
  if (!(limit > 0) || !/\.(jpe?g|png|webp)$/i.test(abs)) return false;
  const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', abs], {encoding: 'utf8'});
  const [w, h] = (probe.stdout ?? '').trim().split(',').map(Number);
  if (probe.status !== 0 || !w || !h || Math.max(w, h) <= limit) return false;
  const scale = w >= h ? `${limit}:-2` : `-2:${limit}`;
  const quality = /\.jpe?g$/i.test(abs) ? ['-q:v', '1'] : /\.webp$/i.test(abs) ? ['-lossless', '1'] : [];
  const out = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', abs, '-vf', `scale=${scale}:flags=lanczos`, ...quality, '-frames:v', '1', '-update', '1', target], {encoding: 'utf8'});
  if (out.status !== 0) throw new Error(`could not scale ${abs} to ${limit} px: ${out.stderr?.slice(-300)}`);
  return true;
}

export interface StagedAssets {
  publicDir: string;
  /** Asset id → file name inside publicDir, for staticFile(). */
  files: Record<string, string>;
  /** Asset id → absolute source path. */
  sources: Record<string, string>;
  cleanup: () => Promise<void>;
}

/**
 * `sharedRoots` are folders outside the asset root that assets may also come
 * from — a channel's theme releases beside its episodes (ADR-0040); nothing
 * else outside the root is ever staged.
 */
export async function stageAssets(
  timeline: EditTimeline, assetRoot: string, sharedRoots: readonly string[] = [],
): Promise<{ok: true; staged: StagedAssets} | {ok: false; problems: ComposerProblem[]}> {
  const root = path.resolve(assetRoot);
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);
  const roots = [root, ...sharedRoots.map((r) => path.resolve(r))].map(real);
  // links are followed before comparing: a link inside a root that leads elsewhere is not inside it
  const inside = (abs: string) => existsSync(abs) && roots.some((r) => {
    const rel = path.relative(r, realpathSync(abs));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  const problems: ComposerProblem[] = [];
  const sources: Record<string, string> = {};
  for (const [id, asset] of Object.entries(timeline.assets)) {
    const p = `$.assets[${JSON.stringify(id)}]`;
    const abs = path.resolve(root, asset.path);
    if (!inside(abs) || !existsSync(abs)) {
      problems.push({code: 'missing-asset', message: `asset "${id}": ${asset.path} is not a file under ${roots.join(' or ')}`, path: `${p}.path`});
      continue;
    }
    const actual = await sha256(abs);
    if (actual !== asset.hash) {
      problems.push({code: 'hash-mismatch', message: `asset "${id}": ${asset.path} is ${actual}, the timeline says ${asset.hash}`, path: `${p}.hash`});
      continue;
    }
    sources[id] = abs;
  }
  if (problems.length > 0) return {ok: false, problems};

  const publicDir = await mkdtemp(path.join(tmpdir(), 'remotion-composer-'));
  await mkdir(path.join(publicDir, 'assets'));
  const files: Record<string, string> = {};
  const limit = imageLimit(timeline);
  // The index makes every name unique, even ids that differ only by case on a
  // case-insensitive filesystem, or `x` with a.mp3 beside `x.mp3` without one.
  for (const [index, [id, abs]] of Object.entries(sources).entries()) {
    const name = `assets/${index}-${id}${path.extname(abs)}`;
    const target = path.join(publicDir, name);
    if (timeline.assets[id]!.kind === 'image' && scaleImage(abs, target, limit)) {
      files[id] = name;
      continue;
    }
    try {
      await link(abs, target);
    } catch {
      await copyFile(abs, target);
    }
    files[id] = name;
  }
  return {ok: true, staged: {publicDir, files, sources, cleanup: () => rm(publicDir, {recursive: true, force: true})}};
}
