// kits.lock.json: each released kit version's code hash (avg-tk7.3). A layout
// sheet records the hashes of the kits it drew with, so a kit's code changing
// under the same version would still make the sheet stale.

import {readFileSync} from 'node:fs';
import {isAudioItem, type EditTimeline} from './schema.js';

let lock: Record<string, string> | undefined;

/** "sha256:…" of a released kit version's code, or undefined for a version the lock does not know. */
export function kitLockHash(name: string, version: string): string | undefined {
  // ../kits.lock.json from both src/ (tests) and dist/ (the build).
  lock ??= JSON.parse(readFileSync(new URL('../kits.lock.json', import.meta.url), 'utf8')) as Record<string, string>;
  return lock[`${name}@${version}`];
}

export interface LockedKit {
  name: string;
  version: string;
  hash: string;
}

/**
 * Each kit a timeline draws with, once, sorted by name then version, with its
 * code hash; null for a kit the lock does not know (a timeline the composer
 * would refuse anyway).
 */
export function timelineKits(timeline: Pick<EditTimeline, 'tracks'>, library: readonly LockedKit[] = []): LockedKit[] | null {
  const kits = new Map<string, {name: string; version: string}>();
  for (const item of timeline.tracks.flatMap((t) => t.items)) {
    if (isAudioItem(item)) continue;
    const {name, version} = (item as {kit: {name: string; version: string}}).kit;
    kits.set(`${name}@${version}`, {name, version});
  }
  const locked: LockedKit[] = [];
  for (const {name, version} of [...kits.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
    // A library kit's hash is its sealed bundle's (avg-d1x).
    const hash = kitLockHash(name, version) ?? library.find((k) => k.name === name && k.version === version)?.hash;
    if (hash === undefined) return null;
    locked.push({name, version, hash});
  }
  return locked;
}
