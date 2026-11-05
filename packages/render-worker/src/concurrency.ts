// How many Chrome tabs and browsers a render on this engine uses, decided on
// the engine when it renders. A copy of @studio/episode's render-concurrency
// (packages never import the studio): keep the two the same.
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
