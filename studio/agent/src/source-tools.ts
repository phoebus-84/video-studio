// ---------------------------------------------------------------------------
// Channel sources (avg-dcf.2): material made once and pinned by the episodes
// that use it, library/<channel>/sources/<name>/ (ADR-0035). Its structure is
// free; its README.md says what it holds, how it was made and how to use it,
// for people and for the agent, and its frontmatter says whether it is ready.
// Whoever needs a source first makes it, with the channel's procedure (a
// channel skill) and the same tools as an episode (`source` in place of
// `series` and `episode`).
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { channelPath, sourcePath } from "@studio/contracts/src/layout.mjs";

export const SOURCE_README = "README.md";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SourceInfo {
  name: string;
  title: string | null;
  status: "draft" | "ready" | null;
  procedure: string | null;
  /** Why it cannot be used, when it cannot. */
  problem?: string;
}

/** A source's README frontmatter: kind source, title, status draft|ready, the procedure that makes it. */
export function readSource(libraryRoot: string, channel: string, name: string): SourceInfo {
  const file = join(sourcePath(libraryRoot, channel, name), SOURCE_README);
  if (!existsSync(file)) return { name, title: null, status: null, procedure: null, problem: `no ${SOURCE_README}: a source says what it holds and how to use it` };
  const text = readFileSync(file, "utf-8");
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  let meta: Record<string, unknown> = {};
  try {
    meta = (front ? parseYaml(front[1]!) : {}) as Record<string, unknown> ?? {};
  } catch {
    return { name, title: null, status: null, procedure: null, problem: `${SOURCE_README}'s frontmatter is not YAML` };
  }
  const status = meta.status === "draft" || meta.status === "ready" ? meta.status : null;
  return {
    name,
    title: typeof meta.title === "string" ? meta.title : null,
    status,
    procedure: typeof meta.procedure === "string" ? meta.procedure : null,
    ...(status ? {} : { problem: `${SOURCE_README} has no status (draft or ready)` }),
  };
}

/** A new source's README, to be filled by whoever makes it. */
export function sourceReadme(options: { title: string; procedure?: string; description?: string }): string {
  return `---
kind: source
title: ${JSON.stringify(options.title)}
status: draft
${options.procedure ? `procedure: ${options.procedure}\n` : ""}---

# ${options.title}

${options.description ?? "What this source is, in one paragraph."}

## What it holds

Each file or folder, and what it is. Files the studio's compilers read follow
its contracts: \`artifacts/narration/takes.json\` (takes and their timings),
\`assets/images|sounds|video/\`. Everything else is free: say here what it is.

## How it was made

The procedure followed, the choices made and why, what was checked (take
verification, archive licences in ATTRIBUTIONS.md).

## How to use it

How an episode uses it: pin it (\`vpr pin add <channel>/<series>/<episode>
<id> --source channel:<name> --used-by <stages>\`), which takes and pictures to
name, what must not be changed.

## Status

\`draft\` while it is being made; \`ready\` once it is checked and an episode
may pin it. A ready source is never edited in place: a correction is a new
source, or a change the pinning episodes renew.
`;
}

export function registerSourceTools(pi: ExtensionAPI): void {
  const libraryRoot = () => process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");

  pi.registerTool({
    name: "pva_create_source",
    label: "Create Channel Source",
    description:
      "Create a channel source, library/<channel>/sources/<name>/: material made once (a poem's text, recital, timing, pictures) and pinned by the " +
      "episodes that use it. Writes its README.md (status draft) to fill in. Then make its contents with the usual tools, passing `source` instead of " +
      "`series` and `episode`, following the channel's procedure (its channel skill, see pva_list_skills).",
    parameters: Type.Object({
      channel: Type.String({ description: "Existing channel slug" }),
      name: Type.String({ description: "The source's name, lowercase words joined by - (e.g. san-martino)" }),
      title: Type.String({ description: "Human-readable title" }),
      procedure: Type.Optional(Type.String({ description: "The channel skill that makes it (e.g. poem-source)" })),
      description: Type.Optional(Type.String({ description: "What it is, in one paragraph" })),
    }),
    async execute(_id, params) {
      try {
        if (!SLUG.test(params.channel)) throw new Error(`"${params.channel}" is not a channel slug`);
        if (!SLUG.test(params.name)) throw new Error(`"${params.name}" is not a source name (lowercase words joined by -)`);
        if (!existsSync(channelPath(libraryRoot(), params.channel))) throw new Error(`there is no channel ${params.channel}`);
        const dir = sourcePath(libraryRoot(), params.channel, params.name);
        const readme = join(dir, SOURCE_README);
        if (existsSync(readme)) throw new Error(`${params.channel}/sources/${params.name} already exists: use it, or choose another name`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(readme, sourceReadme({ title: params.title, ...(params.procedure ? { procedure: params.procedure } : {}), ...(params.description ? { description: params.description } : {}) }));
        return {
          content: [{ type: "text" as const, text: `✅ ${params.channel}/sources/${params.name} (draft): fill its README.md as you make it; tools take source: "${params.name}"` }],
          details: { path: `sources/${params.name}`, readme: `sources/${params.name}/${SOURCE_README}` } as Record<string, unknown>,
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `❌ ${(error as Error).message}` }], details: {} as Record<string, unknown>, isError: true as unknown as boolean };
      }
    },
  });

  pi.registerTool({
    name: "pva_sources",
    label: "List Channel Sources",
    description: "List a channel's sources with their title, status (draft or ready) and the procedure that makes them. Read a source's README.md before using it.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      status: Type.Optional(StringEnum(["draft", "ready"], { description: "Only these" })),
    }),
    async execute(_id, params) {
      try {
        if (!SLUG.test(params.channel)) throw new Error(`"${params.channel}" is not a channel slug`);
        const dir = join(channelPath(libraryRoot(), params.channel), "sources");
        const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".") && statSync(join(dir, n)).isDirectory()).sort() : [];
        const sources = names.map((n) => readSource(libraryRoot(), params.channel, n)).filter((s) => !params.status || s.status === params.status);
        const text = sources.length === 0 ? `${params.channel} has no sources${params.status ? ` (${params.status})` : ""}` : sources.map((s) =>
          `- ${s.name}: ${s.title ?? "(no title)"} — ${s.status ?? "no status"}${s.procedure ? `, made by ${s.procedure}` : ""}${s.problem ? ` ⚠️ ${s.problem}` : ""}`).join("\n");
        return { content: [{ type: "text" as const, text }], details: { sources } as unknown as Record<string, unknown> };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `❌ ${(error as Error).message}` }], details: {} as Record<string, unknown>, isError: true as unknown as boolean };
      }
    },
  });
}
