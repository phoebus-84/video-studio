// The line a render streams while it runs: a bar, the percentage, the time it
// has taken and an estimate of what is left. One line every 2%, so a render of
// an hour does not flood the session with updates.

const WIDTH = 20;

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

/**
 * Returns a function that turns a render's progress (0–1) into a line, or
 * null when it has not moved by another 2% since the last line.
 */
export function renderProgressBar(start: number): (progress: number, now: number) => string | null {
  let last = -1;
  let first: { progress: number; at: number } | null = null;
  return (progress, now) => {
    const p = Math.min(Math.max(progress, 0), 1);
    const percent = Math.floor(p * 50) * 2;
    if (percent === last) return null;
    last = percent;
    // The estimate counts from the first report: segments reused from the cache arrive at once and say nothing about speed.
    first ??= { progress: p, at: now };
    const filled = Math.round(p * WIDTH);
    const bar = `[${"█".repeat(filled)}${"░".repeat(WIDTH - filled)}]`;
    const done = p - first.progress;
    const eta = p >= 1 ? "" : done > 0 ? ` · ~${clock(((now - first.at) / done) * (1 - p))} left` : "";
    return `Rendering ${bar} ${percent}% · ${clock(now - start)}${eta}`;
  };
}
