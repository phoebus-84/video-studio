// The registered compilers. Each released version is its own file and stays
// registered, so an episode pinned to it keeps compiling the same way.

import type { SeriesCompiler } from "./types.js";
import { compiler as poetryShort100 } from "./compilers/poetry-short/1.0.0.js";
import { compiler as dentroIVersiShort100 } from "./compilers/dentro-i-versi-short/1.0.0.js";
import { compiler as dentroIVersiShort110 } from "./compilers/dentro-i-versi-short/1.1.0.js";
import { compiler as dentroIVersiLong100 } from "./compilers/dentro-i-versi-long/1.0.0.js";
import { compiler as dentroIVersiLong110 } from "./compilers/dentro-i-versi-long/1.1.0.js";

export const COMPILERS: readonly SeriesCompiler[] = Object.freeze([poetryShort100, dentroIVersiShort100, dentroIVersiShort110, dentroIVersiLong100, dentroIVersiLong110]);

/** The compiler with exactly this id and version, or undefined. */
export function resolveCompiler(id: string, version: string): SeriesCompiler | undefined {
  return COMPILERS.find((c) => c.id === id && c.version === version);
}

/** Every registered compiler, sorted by id then version. */
export function listCompilers(): { id: string; version: string; description: string }[] {
  return COMPILERS.map(({ id, version, description }) => ({ id, version, description }))
    .sort((a, b) => a.id.localeCompare(b.id) || compareVersions(a.version, b.version));
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}
