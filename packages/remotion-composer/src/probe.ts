import {spawnSync} from 'node:child_process';

/**
 * How many frames a video file lasts, from ffprobe. Infinity when it cannot
 * be known — ffprobe missing or failing — so a clip then simply never
 * freezes rather than failing the render.
 */
export function videoFrames(file: string, fps: number): number {
  const out = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'});
  if (out.error || out.status !== 0 || typeof out.stdout !== 'string') return Number.POSITIVE_INFINITY;
  const seconds = Number(out.stdout.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.floor(seconds * fps)) : Number.POSITIVE_INFINITY;
}
