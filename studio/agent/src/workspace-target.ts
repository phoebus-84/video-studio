// ---------------------------------------------------------------------------
// Where a tool works: an episode, or a channel source (avg-dcf.2)
// ---------------------------------------------------------------------------
// A channel source, library/<channel>/sources/<name>/, is made with the same
// tools as an episode — images, sounds, takes, their alignment and
// verification, archive media — and pinned by the episodes that use it
// (ADR-0035). A tool takes `series` and `episode`, or `source`, never both.
// A source has no budget of its own: a paid call runs in an episode.
// ---------------------------------------------------------------------------

import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { episodePath, sourcePath } from "@studio/contracts/src/layout.mjs";
import { guardPath, type TrustCheck } from "./trust-guards.js";

export const WORKSPACE_PARAMS = {
  channel: Type.String({ description: "Channel slug" }),
  series: Type.Optional(Type.String({ description: "Series slug, with episode" })),
  episode: Type.Optional(Type.String({ description: "Episode slug, with series" })),
  source: Type.Optional(Type.String({ description: "Instead of series and episode: a channel source's name (library/<channel>/sources/<name>)" })),
};

export interface WorkspaceParams {
  channel: string;
  series?: string;
  episode?: string;
  source?: string;
}

export type Workspace =
  | { kind: "episode"; dir: string; label: string; channel: string; series: string; episode: string }
  | { kind: "source"; dir: string; label: string; channel: string; source: string };

const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

/** The workspace the parameters name; an error saying what is wrong when they name none, or two. */
export function workspaceOf(libraryRoot: string, p: WorkspaceParams): Workspace {
  const parts = [p.channel, p.series, p.episode, p.source].filter((x): x is string => x !== undefined);
  for (const part of parts) if (!SLUG.test(part) || part.includes("..")) throw new Error(`"${part}" is not a slug`);
  if (p.source !== undefined) {
    if (p.series !== undefined || p.episode !== undefined) throw new Error("give either series and episode, or source, not both");
    const dir = sourcePath(libraryRoot, p.channel, p.source);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`there is no source ${p.channel}/sources/${p.source}: create it with pva_create_source`);
    return { kind: "source", dir, label: `${p.channel}/sources/${p.source}`, channel: p.channel, source: p.source };
  }
  if (p.series === undefined || p.episode === undefined) throw new Error("name the episode (series and episode) or a channel source (source)");
  return { kind: "episode", dir: episodePath(libraryRoot, p.channel, p.series, p.episode), label: `${p.channel}/${p.series}/${p.episode}`, channel: p.channel, series: p.series, episode: p.episode };
}

/** A path inside the workspace, which itself is inside the library. */
export async function guardWorkspacePath(libraryRoot: string, ws: Workspace, relative: string): Promise<TrustCheck> {
  const withinLibrary = await guardPath(libraryRoot, path.relative(libraryRoot, ws.dir));
  if (!withinLibrary.allowed) return withinLibrary;
  return guardPath(ws.dir, relative);
}

/** The episode a paid call is charged to; a source has no budget. */
export function episodeOf(ws: Workspace, what: string): { channel: string; series: string; episode: string } {
  if (ws.kind !== "episode") throw new Error(`${what} is paid, and a source has no budget: make the source with $0 tools, or run it in an episode`);
  return { channel: ws.channel, series: ws.series, episode: ws.episode };
}
