// The kit registry (avg-tk7.3). Released versions are frozen and coexist; a
// timeline gets exactly the version it names. Every version is imported
// explicitly — no filesystem scanning — so the Remotion bundle has them all.

import type {KitVersion} from './types.js';
import {kit as still100} from './still/1.0.0.js';
import {kit as clip100} from './clip/1.0.0.js';
import {kit as captions100} from './captions/1.0.0.js';

export type {KitContext, KitExample, KitVersion} from './types.js';

/** Every released kit version. Adding a version: import it here, then `npm run kits:lock`. */
export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([still100, clip100, captions100]);

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

export interface KitListing {
  name: string;
  version: string;
  description: string;
  examples: string[];
  preview: string;
}

/** Every version, sorted by name then version: what the catalog and the agent read. */
export const listKits = (): KitListing[] =>
  [...KIT_VERSIONS]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : compareSemver(a.version, b.version)))
    .map((k) => ({
      name: k.name,
      version: k.version,
      description: k.description,
      examples: k.examples.map((e) => e.id),
      preview: `previews/${k.name}@${k.version}.png`,
    }));

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number(x));
  const pb = b.split(/[.-]/).map((x) => Number(x));
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
