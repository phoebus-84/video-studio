// The kit registry (avg-tk7.3). Released versions are frozen and coexist; a
// timeline gets exactly the version it names. Every version is imported
// explicitly — no filesystem scanning — so the Remotion bundle has them all.

import type {KitVersion} from './types.js';
import {kit as still100} from './still/1.0.0.js';
import {kit as clip100} from './clip/1.0.0.js';
import {kit as captions100} from './captions/1.0.0.js';
import {kit as captions110} from './captions/1.1.0.js';
import {kit as brandMark100} from './brand-mark/1.0.0.js';
import {kit as lowerThird100} from './lower-third/1.0.0.js';
import {kit as titleChip100} from './title-chip/1.0.0.js';
import {kit as versePlate100} from './verse-plate/1.0.0.js';
import {kit as museumHall100} from './museum-hall/1.0.0.js';
import {kit as interprete100} from './interprete/1.0.0.js';
import {kit as roomEffect100} from './room-effect/1.0.0.js';

export type {KitContext, KitExample, KitProfile, KitVersion} from './types.js';

/** Every released kit version. Adding a version: import it here, then `npm run kits:lock`. */
export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([
  still100, clip100, captions100, captions110,
  brandMark100, lowerThird100, titleChip100, versePlate100, museumHall100, interprete100, roomEffect100,
]);

const key = (name: string, version: string) => `${name}@${version}`;
const byKey = new Map(KIT_VERSIONS.map((k) => [key(k.name, k.version), k]));

/** The exact version a timeline names, or undefined. */
export const resolveKit = (name: string, version: string): KitVersion | undefined => byKey.get(key(name, version));

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
