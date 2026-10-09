// ---------------------------------------------------------------------------
// Archive and stock media (avg-fe8.2): search public collections, fetch an
// original into a workspace with its licence, credit and evidence.
// ---------------------------------------------------------------------------
// What may be fetched is the channel's call: `archiveMedia` in its
// settings.yaml (a series' settings.yaml overrides it) names the licence kinds
// allowed and the least size; by default public domain, CC0, CC BY and CC BY-SA,
// 1600 px on an image's long side, 720p for a video.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { ArchiveError, createArchive, DEFAULT_POLICY, type Archive, type LicencePolicy, type Quality } from "@av/archive-media";
import { checkProvenance, fetchIntoWorkspace } from "@studio/episode";
import { channelPath, seriesPath } from "@studio/contracts/src/layout.mjs";
import { WORKSPACE_PARAMS, workspaceOf } from "./workspace-target.js";

const USER_AGENT = "video-studio-archive-media/0.1 (https://github.com/phoebus-84/video-studio)";
const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

export interface ArchiveSettings {
  policy: LicencePolicy;
  quality: Quality;
}

const KINDS = /^(public-domain|CC0|CC-BY(-NC)?(-SA|-ND)?|provider:[a-z0-9-]+)$/;

/**
 * The channel's `archiveMedia`, the series' over it; the defaults where
 * neither says. Settings it cannot follow are an error, never a silent
 * fallback to a looser policy.
 */
export function archiveSettings(libraryRoot: string, channel: string, series?: string): ArchiveSettings {
  const read = (dir: string): Record<string, unknown> => {
    const file = join(dir, "settings.yaml");
    if (!existsSync(file)) return {};
    // A file of only comments is no settings.
    const text = readFileSync(file, "utf-8");
    if (text.split("\n").every((line) => /^\s*(#.*)?$/.test(line))) return {};
    const doc = parseYaml(text, { filename: file }) as { archiveMedia?: unknown } | null | undefined;
    const section = doc?.archiveMedia;
    if (section === undefined || section === null) return {};
    if (typeof section !== "object" || Array.isArray(section)) throw new Error(`${file}: archiveMedia must be a mapping`);
    return section as Record<string, unknown>;
  };
  const merged = { ...read(channelPath(libraryRoot, channel)), ...(series ? read(seriesPath(libraryRoot, channel, series)) : {}) };
  let licences = DEFAULT_POLICY.allow;
  if (merged.licences !== undefined) {
    if (!Array.isArray(merged.licences) || merged.licences.length === 0 || !merged.licences.every((l) => typeof l === "string" && KINDS.test(l))) {
      throw new Error(`archiveMedia.licences must be a list of licence kinds (public-domain, CC0, CC-BY, CC-BY-SA, CC-BY-NC…), not ${JSON.stringify(merged.licences)}`);
    }
    licences = merged.licences as string[];
  }
  const quality: Quality = {};
  for (const key of ["minImageLongSide", "minVideoHeight"] as const) {
    const value = merged[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) throw new Error(`archiveMedia.${key} must be a positive number of pixels, not ${JSON.stringify(value)}`);
    quality[key] = value;
  }
  return { policy: { allow: licences }, quality };
}

const fail = (error: unknown) => ({
  content: [{ type: "text" as const, text: `❌ ${error instanceof ArchiveError ? `${error.code}: ` : ""}${error instanceof Error ? error.message : String(error)}` }],
  details: { ...(error instanceof ArchiveError ? { code: error.code } : {}) } as Record<string, unknown>,
  isError: true as unknown as boolean,
});

export function registerArchiveTools(pi: ExtensionAPI, options: { archive?: Archive } = {}): void {
  const libraryRoot = () => process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");
  let shared: Archive | undefined = options.archive;
  const archive = () => (shared ??= createArchive({ userAgent: USER_AGENT, cacheDir: join(homedir(), ".cache", "video-studio", "archive-media") }));
  const checkNames = (...names: (string | undefined)[]) => {
    for (const n of names) if (n !== undefined && !SLUG.test(n)) throw new Error(`"${n}" is not a slug`);
  };

  pi.registerTool({
    name: "pva_search_media",
    label: "Search Archive Media",
    description:
      "Search free archive and stock collections for pictures, videos or sounds with verifiable licences: the Art Institute of Chicago, the Met, " +
      "the Cleveland Museum of Art, Wikimedia Commons, NASA, the Internet Archive and Openverse. Each candidate gives its licence, size, " +
      "credit, preview and landing page, and whether the channel's policy allows fetching it (and why not). Fetch one with pva_fetch_media.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug: its settings decide which licences are allowed" }),
      series: Type.Optional(Type.String({ description: "Series slug, when its settings override the channel's" })),
      query: Type.String({ description: "What to look for, in English for the museums (e.g. 'storm painting', 'lightning')" }),
      mediaType: Type.Optional(StringEnum(["image", "video", "audio"], { description: "Default image" })),
      providers: Type.Optional(Type.Array(Type.String(), { description: "Only these: aic, met, cleveland, commons, nasa, internet-archive, openverse" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, description: "Per provider, default 8" })),
      onlyAllowed: Type.Optional(Type.Boolean({ description: "Leave out what the policy would refuse (default true)" })),
    }),
    async execute(_id, params) {
      try {
        checkNames(params.channel, params.series);
        const settings = archiveSettings(libraryRoot(), params.channel, params.series);
        const result = await archive().search(params.query, {
          mediaType: (params.mediaType ?? "image") as "image" | "video" | "audio", limit: params.limit ?? 8,
          ...(params.providers ? { providers: params.providers } : {}), policy: settings.policy, quality: settings.quality,
        });
        const shown = params.onlyAllowed === false ? result.candidates : result.candidates.filter((c) => c.allowed);
        const lines = shown.map((c) => {
          const size = c.width && c.height ? `${c.width}×${c.height}` : c.durationSeconds ? `${c.durationSeconds.toFixed(1)} s` : "size unknown";
          return `- ${c.provider} ${JSON.stringify(c.id)}: «${c.title}»${c.creator ? ` — ${c.creator}` : ""}${c.date ? ` (${c.date})` : ""}; ${c.licence.id}; ${size}` +
            `${c.allowed ? "" : ` — refused: ${c.refusal}`}\n  preview ${c.previewUrl ?? "none"} · page ${c.landingUrl}`;
        });
        const refused = result.candidates.length - result.candidates.filter((c) => c.allowed).length;
        const errors = result.errors.map((e) => `⚠️ ${e.provider}: ${e.message}`);
        const text = [
          `${shown.length} candidates for "${params.query}" (${params.mediaType ?? "image"})${params.onlyAllowed === false ? "" : `, ${refused} left out by the policy (${settings.policy.allow.join(", ")})`}:`,
          ...lines, ...errors,
        ].join("\n");
        return {
          content: [{ type: "text" as const, text }],
          details: { candidates: shown.map(({ raw: _raw, fileHeaders: _h, ...c }) => c), errors: result.errors, policy: settings.policy } as Record<string, unknown>,
        };
      } catch (error) {
        return fail(error);
      }
    },
  });

  pi.registerTool({
    name: "pva_fetch_media",
    label: "Fetch Archive Media",
    description:
      "Download one archive item's original into an episode or a channel source: assets/images|video|sounds/<name>.<ext>, with <name>.source.json beside it " +
      "(provider, item, licence, credit), the provider's response kept in artifacts/provenance/ as evidence, and ATTRIBUTIONS.md made again. " +
      "Refuses a licence the channel does not allow, an unknown licence, a file below the least size, a name already used (unless replace).",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      provider: Type.String({ description: "The candidate's provider, as pva_search_media gave it" }),
      id: Type.String({ description: "The candidate's id, exactly as pva_search_media gave it" }),
      name: Type.String({ description: "The asset id: the file's name without extension, as the spec names it (letters, digits, _ -)" }),
      replace: Type.Optional(Type.Boolean({ description: "Replace a file of that name" })),
    }),
    async execute(_id, params) {
      try {
        const ws = workspaceOf(libraryRoot(), params);
        const dir = ws.dir;
        if (!existsSync(dir)) throw new Error(`there is no episode ${ws.label}`);
        const settings = archiveSettings(libraryRoot(), params.channel, params.series);
        const got = await fetchIntoWorkspace(dir, {
          archive: archive(), provider: params.provider, id: params.id, name: params.name,
          policy: settings.policy, quality: settings.quality, ...(params.replace ? { replace: true } : {}),
        });
        const f = got.record.file;
        const size = f.width && f.height ? `${f.width}×${f.height}` : f.durationSeconds ? `${f.durationSeconds.toFixed(1)} s` : "";
        return {
          content: [{ type: "text" as const, text: `✅ ${got.path} (${size}${size ? ", " : ""}${(f.bytes / 1e6).toFixed(1)} MB): ${got.record.attribution}\nRecord ${got.recordPath}; ATTRIBUTIONS.md updated.` }],
          details: { path: got.path, recordPath: got.recordPath, record: got.record } as Record<string, unknown>,
        };
      } catch (error) {
        return fail(error);
      }
    },
  });

  pi.registerTool({
    name: "pva_check_provenance",
    label: "Check Archive Media Provenance",
    description: "Check an episode's or a source's archive media: every file still the one fetched, its record valid, its evidence kept, ATTRIBUTIONS.md current.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
    }),
    async execute(_id, params) {
      try {
        const checked = checkProvenance(workspaceOf(libraryRoot(), params).dir);
        const text = checked.ok
          ? `✅ ${checked.files} archive files, every one as fetched, with its licence and evidence; ATTRIBUTIONS.md current`
          : `❌ ${checked.problems.length} problems:\n${checked.problems.map((p) => `- ${p.path}: ${p.message}`).join("\n")}`;
        return { content: [{ type: "text" as const, text }], details: checked as unknown as Record<string, unknown>, ...(checked.ok ? {} : { isError: true as unknown as boolean }) };
      } catch (error) {
        return fail(error);
      }
    },
  });
}
