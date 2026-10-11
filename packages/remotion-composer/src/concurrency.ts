// How many Chrome tabs a render uses when nobody says. Each tab holds the
// frame's pictures and kits, about two gigabytes with large paintings: a
// render that starved the machine crashed its browser at the same frames
// until it ran with one tab (avg-dcf.8). So: as many tabs as the memory
// available allows, never more than half the cores, at least one.
// AVG_RENDER_CONCURRENCY forces it.

import {spawnSync} from 'node:child_process';
import {cpus, freemem, platform} from 'node:os';

const PER_TAB = 2 * 1024 ** 3;

export function renderConcurrency(options: {freeBytes: number; cpus: number; env: Record<string, string | undefined>}): number {
  const forced = options.env.AVG_RENDER_CONCURRENCY;
  if (forced !== undefined && /^[1-9]\d*$/.test(forced.trim())) return Number(forced.trim());
  const byMemory = Math.floor(options.freeBytes / PER_TAB);
  const byCores = Math.floor(options.cpus / 2);
  return Math.max(1, Math.min(byMemory, byCores));
}

/**
 * Memory a render can take now. On macOS `os.freemem()` counts only free
 * pages; inactive ones (file cache) are reclaimed on demand, so they count.
 */
export function availableBytes(): number {
  if (platform() === 'darwin') {
    const run = spawnSync('vm_stat', {encoding: 'utf-8'});
    if (run.status === 0) {
      const page = Number(/page size of (\d+) bytes/.exec(run.stdout)?.[1] ?? 4096);
      const pages = (name: string) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(run.stdout)?.[1] ?? 0);
      return (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * page;
    }
  }
  return freemem();
}

/** The concurrency for this machine, now. */
export function defaultRenderConcurrency(): number {
  return renderConcurrency({freeBytes: availableBytes(), cpus: cpus().length, env: process.env});
}
