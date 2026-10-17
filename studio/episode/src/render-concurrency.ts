// How many Chrome tabs an episode's render uses. Decided by the studio, not
// the composer: the composer's code is part of what a layout sheet pictures,
// and how many tabs render it changes no frame.
// Decided on the machine that renders, when it renders: as many tabs as the
// memory available allows, never more than two thirds of the cores, at least
// one. A tab takes far less than was once budgeted (two gigabytes each, which
// left one tab on a 16 GB machine): rendering an ambient episode with eight
// tabs took about 110 MB each and was four times faster than with one. The
// budget keeps a wide margin over that, because a render that starved the
// machine crashed its browser at the same frames until it ran with one tab
// (avg-dcf.8). Two thirds of the cores leaves room for FFmpeg and the system;
// eight tabs on twelve threads was the fastest measured.
// AVG_RENDER_CONCURRENCY forces it.
// The tabs are shared among a few browsers: Chrome rasterizes all of a
// browser's tabs in its one GPU process, which past a few tabs is the limit
// (a long, 2026-10-16: one browser 4.0 frames a second with 6, 8 or 10 tabs;
// two of four 5.3; four of three 6.0). Also measured on Apple M1: two browsers
// of two tabs took 24% less time than one of four on a 20 s sample (see
// docs/notes/remotion-render-benchmark.md). Each browser has its own overhead;
// the count is bounded and shares the existing tab budget, not extra tabs.
// AVG_RENDER_BROWSERS forces their number.

import { spawnSync } from "node:child_process";
import { cpus, freemem, platform } from "node:os";

const PER_TAB = 320 * 1024 ** 2;

export function renderConcurrency(options: {freeBytes: number; cpus: number; env: Record<string, string | undefined>}): number {
  const forced = options.env.AVG_RENDER_CONCURRENCY;
  if (forced !== undefined && /^[1-9]\d*$/.test(forced.trim())) return Number(forced.trim());
  const byMemory = Math.floor(options.freeBytes / PER_TAB);
  const byCores = Math.floor((options.cpus * 2) / 3);
  return Math.max(1, Math.min(byMemory, byCores));
}

/** How many browsers share the render's tabs: one per two tabs, at most four. */
export function renderBrowsers(options: {concurrency: number; env: Record<string, string | undefined>}): number {
  const forced = options.env.AVG_RENDER_BROWSERS;
  if (forced !== undefined && /^[1-9]\d*$/.test(forced.trim())) return Math.min(Number(forced.trim()), options.concurrency);
  return Math.max(1, Math.min(4, Math.floor(options.concurrency / 2)));
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
