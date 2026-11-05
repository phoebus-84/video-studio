// How fast each machine draws, so a shared render gives the faster ones more
// seconds. A speed is segments drawn per second of drawing; every shared
// render measures its shares and folds them into a small JSON file the
// caller names, and the next split follows it. A render-hosts.json `speed`
// (same unit) fixes a machine's speed instead. Speeds differ from episode to
// episode, but only their ratios split a render, and the machines that draw
// together are measured together.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import type { HostsConfig } from "./hosts.js";

export interface SpeedEntry { segmentsPerSecond: number; samples: number; updatedAt: string }
export type Speeds = Record<string, SpeedEntry>;

/** "local" means a different machine wherever this runs: its speed is kept under this machine's name. */
export function speedKey(host: string, local: string): string {
  return host === local ? `${local}:${hostname()}` : host;
}

export function readSpeeds(file?: string): Speeds {
  if (!file || !existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as { speeds?: Speeds };
    return parsed.speeds ?? {};
  } catch {
    return {};
  }
}

/**
 * Fewer segments than this measure the browser's start more than the drawing
 * (one fresh segment on a mostly cached share read 0.12 instead of 0.18).
 */
export const MIN_MEASURED_SEGMENTS = 3;

/** Folds measured shares into the file: the new measure weighs as much as everything before it. */
export function recordSpeeds(file: string, measured: readonly { key: string; segments: number; seconds: number }[], now = new Date()): Speeds {
  const speeds = readSpeeds(file);
  for (const m of measured) {
    if (m.segments < MIN_MEASURED_SEGMENTS || m.seconds <= 0) continue;
    const speed = m.segments / m.seconds;
    const old = speeds[m.key];
    speeds[m.key] = {
      segmentsPerSecond: Number((old ? (old.segmentsPerSecond + speed) / 2 : speed).toFixed(4)),
      samples: (old?.samples ?? 0) + 1,
      updatedAt: now.toISOString(),
    };
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  writeFileSync(partial, `${JSON.stringify({ speeds }, null, 2)}\n`);
  renameSync(partial, file);
  return speeds;
}

/** Each machine's weight: its configured speed, else its measured one, else the average of the others (1 when none is known). */
export function weightsFor(hosts: readonly string[], keys: readonly string[], speeds: Speeds, config: HostsConfig): number[] {
  const configured = hosts.map((h) => Object.entries(config.hosts ?? {}).find(([n]) => n.toLowerCase() === h.toLowerCase())?.[1]?.speed);
  const known = hosts.map((_, i) => {
    const c = configured[i];
    if (c !== undefined && c > 0) return c;
    const s = speeds[keys[i]!]?.segmentsPerSecond;
    return s !== undefined && s > 0 ? s : undefined;
  });
  const values = known.filter((w): w is number => w !== undefined);
  const fallback = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 1;
  return known.map((w) => w ?? fallback);
}

/**
 * Splits `total` segments into contiguous runs, one per machine, sized by weight
 * (largest remainder; on a tie the later machine, as an even split always did),
 * every machine at least one segment.
 */
export function splitByWeight(total: number, weights: readonly number[]): number[] {
  const n = Math.min(weights.length, total);
  if (n === 0) return [];
  const w = weights.slice(0, n);
  const sum = w.reduce((a, b) => a + b, 0);
  const ideal = w.map((x) => (total * x) / sum);
  const counts = ideal.map((x) => Math.max(1, Math.floor(x)));
  let left = total - counts.reduce((a, b) => a + b, 0);
  const byRemainder = ideal.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) counts[byRemainder[k]![1]]! += 1;
  // The minimum of one took too much: take it back from the biggest runs.
  while (left < 0) {
    const biggest = counts.indexOf(Math.max(...counts));
    counts[biggest]! -= 1;
    left++;
  }
  return counts;
}
