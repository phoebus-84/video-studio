// The kit registry (avg-tk7.3). Released versions are frozen and coexist; a
// timeline gets exactly the version it names. Every version is imported
// explicitly — no filesystem scanning — so the Remotion bundle has them all.

import type {KitVersion} from './types.js';
import {kit as still100} from './still/1.0.0.js';
import {kit as clip100} from './clip/1.0.0.js';
import {kit as captions100} from './captions/1.0.0.js';
import {kit as captions110} from './captions/1.1.0.js';
import {kit as brandMark200} from './brand-mark/2.0.0.js';
import {kit as blockTitle100} from './block-title/1.0.0.js';
import {kit as figureTitle100} from './figure-title/1.0.0.js';
import {kit as verseBar100} from './verse-bar/1.0.0.js';
import {kit as cover100} from './cover/1.0.0.js';
import {kit as chapterOpener100} from './chapter-opener/1.0.0.js';
import {kit as warp100} from './warp/1.0.0.js';
import {kit as room100} from './room/1.0.0.js';
import {kit as panel100} from './panel/1.0.0.js';
import {kit as interprete110} from './interprete/1.1.0.js';
import {kit as panel110} from './panel/1.1.0.js';
import {kit as textStack100} from './text-stack/1.0.0.js';
import {kit as timeline100} from './timeline/1.0.0.js';
import {kit as storyFx100} from './story-fx/1.0.0.js';
import {kit as wordTracks100} from './word-tracks/1.0.0.js';
import {kit as interlinear100} from './interlinear/1.0.0.js';
import {kit as monitorWall100} from './monitor-wall/1.0.0.js';
import {kit as summary100} from './summary/1.0.0.js';
import {kit as progress100} from './progress/1.0.0.js';
import {kit as merge100} from './merge/1.0.0.js';
import {kit as cards100} from './cards/1.0.0.js';
import {kit as stack100} from './stack/1.0.0.js';
import {kit as oxymoron100} from './oxymoron/1.0.0.js';
import {kit as simile100} from './simile/1.0.0.js';
import {kit as syllables100} from './syllables/1.0.0.js';
import {kit as rhymes100} from './rhymes/1.0.0.js';

export type {KitContext, KitExample, KitProfile, KitVersion} from './types.js';

/** Every released kit version. Adding a version: import it here, then `npm run kits:lock`. */
export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([
  still100, clip100, captions100, captions110,
  brandMark200, blockTitle100, figureTitle100, verseBar100, cover100, chapterOpener100, warp100, room100, panel100, interprete110,
  panel110, textStack100, timeline100, storyFx100, wordTracks100, interlinear100, monitorWall100, summary100, progress100,
  merge100, cards100, stack100, oxymoron100, simile100, syllables100, rhymes100,
]);

const key = (name: string, version: string) => `${name}@${version}`;
const byKey = new Map(KIT_VERSIONS.map((k) => [key(k.name, k.version), k]));

/** The exact version a timeline names, or undefined. */
/**
 * Kits a channel or a series carries in the library (avg-d1x), registered by
 * the generated bundle entry before the root renders. Node-side callers pass
 * theirs explicitly instead (validateTimeline's `kits`).
 */
const library = new Map<string, KitVersion>();
export function registerLibraryKits(kits: readonly KitVersion[]): void {
  for (const k of kits) library.set(key(k.name, k.version), k);
}

/** The exact version a timeline names: the application's, else one of `extra`, else one registered from the library. */
export const resolveKit = (name: string, version: string, extra?: readonly KitVersion[]): KitVersion | undefined =>
  byKey.get(key(name, version)) ?? extra?.find((k) => k.name === name && k.version === version) ?? library.get(key(name, version));

/** Whether the application itself has this kit version: a library kit may never take its name@version. */
export const isApplicationKit = (name: string, version: string): boolean => byKey.has(key(name, version));

/** The versions available for a kit name, e.g. ["1.0.0", "1.1.0"]. */
export const kitVersions = (name: string): string[] =>
  KIT_VERSIONS.filter((k) => k.name === name).map((k) => k.version).sort(compareSemver);

/** The Remotion composition id of a kit example in the preview entry, e.g. still-1-0-0-cover. */
export const previewCompositionId = (name: string, version: string, exampleId: string): string =>
  `${name}-${version.replace(/[.+]/g, '-')}-${exampleId}`;

/** Where `npm run kits:previews` writes a version's preview in one output profile. */
export const previewPath = (name: string, version: string, profileId: string): string =>
  `previews/${name}@${version}.${profileId}.png`;

/** Whether a kit version is drawn for a profile (a kit without `profiles` is drawn for all). */
export const drawnFor = (kit: Pick<KitVersion, 'profiles'>, profileId: string): boolean =>
  !kit.profiles || kit.profiles.includes(profileId);

export interface KitListing {
  name: string;
  version: string;
  description: string;
  layer: 'overlay' | 'fill';
  examples: string[];
  /** The profiles it is drawn for, when not all (ADR-0039). */
  profiles?: string[];
  /** Output profile id → preview path, for the profiles asked for that it is drawn for. */
  previews: Record<string, string>;
}

/**
 * Every version, sorted by name then version: what the catalog and the agent
 * read. The caller names the output profiles (the catalog is the contracts',
 * which this package does not import).
 */
export const listKits = (profileIds: readonly string[] = []): KitListing[] =>
  [...KIT_VERSIONS]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : compareSemver(a.version, b.version)))
    .map((k) => ({
      name: k.name,
      version: k.version,
      description: k.description,
      layer: k.layer ?? 'fill',
      examples: k.examples.map((e) => e.id),
      ...(k.profiles ? {profiles: [...k.profiles]} : {}),
      previews: Object.fromEntries(profileIds.filter((id) => drawnFor(k, id)).map((id) => [id, previewPath(k.name, k.version, id)])),
    }));

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number(x));
  const pb = b.split(/[.-]/).map((x) => Number(x));
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
