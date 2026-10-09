// ---------------------------------------------------------------------------
// Skill discovery
// ---------------------------------------------------------------------------
// Discovers built-in and series-local skills by scanning directories
// for SKILL.md files. Skills are loaded on demand using lazy I/O.
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import { resolveConfig } from "../src/config.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SkillDescriptor {
  /** Unique skill ID (filename stem). */
  id: string;
  /** Human-readable skill name (from frontmatter or filename). */
  name: string;
  /** Description of what the skill does. */
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Where this skill was discovered: the studio's, a channel's (library/<channel>/skills), a series' (…/series/<series>/skills). */
  source: "built-in" | "channel-local" | "series-local";
  /** "channel/series" if series-local. */
  seriesSlug?: string;
  /** The channel, if channel-local. */
  channelSlug?: string;
  /** Estimated token count of the skill content. */
  tokenEstimate?: number;
}

export interface SkillCatalog {
  /** All discovered skills. */
  skills: SkillDescriptor[];
  /** List skills with optional filter. */
  list(filter?: { source?: SkillDescriptor["source"]; seriesSlug?: string; channelSlug?: string }): SkillDescriptor[];
  /**
   * Load a skill's full content. `scope` is "channel/series" or "channel": the
   * series' skill wins, then the channel's, then the studio's. Without a scope,
   * the studio's, or else the one channel skill of that name.
   */
  load(skillId: string, scope?: string): Promise<string>;
}

// ── Implementation ──────────────────────────────────────────────────────────

/**
 * Create a skill catalog by scanning built-in and series-local directories.
 */
export async function discoverSkills(options: { libraryRoot?: string; builtInPath?: string } = {}): Promise<SkillCatalog> {
  const libraryRoot = options.libraryRoot ?? (await resolveConfig()).libraryRoot;
  const builtInPath = options.builtInPath ?? fileURLToPath(new URL("../../../.pi/skills/", import.meta.url));

  const allSkills: SkillDescriptor[] = [];

  // ── Built-in skills ──────────────────────────────────────────────────

  try {
    const builtInSkills = await scanSkillDir(builtInPath, "built-in");
    allSkills.push(...builtInSkills);
  } catch {
    // Built-in skills not found — not fatal
  }

  // ── Series-local skills ──────────────────────────────────────────────

  try {
    // Scan each channel/series for a skills directory
    const channels = await fs.readdir(libraryRoot).catch(() => [] as string[]);
    for (const channel of channels) {
      const channelPath = path.join(libraryRoot, channel);
      const channelStat = await fs.stat(channelPath).catch(() => null);
      if (!channelStat?.isDirectory()) continue;

      // The channel's own procedures (avg-dcf.2): how to make its sources, its conventions.
      try {
        allSkills.push(...await scanSkillDir(path.join(channelPath, "skills"), "channel-local", undefined, channel));
      } catch { /* none */ }

      const seriesList = await fs.readdir(path.join(channelPath, "series")).catch(() => [] as string[]);
      for (const series of seriesList) {
        const seriesPath = path.join(channelPath, "series", series);
        const skillsPath = path.join(seriesPath, "skills");
        try {
          const localSkills = await scanSkillDir(skillsPath, "series-local", `${channel}/${series}`);
          allSkills.push(...localSkills);
        } catch {
          // No skills directory for this series
        }
      }
    }
  } catch {
    // Library root not accessible
  }

  return {
    skills: allSkills,
    list(filter) {
      return allSkills.filter((s) => {
        if (filter?.source && s.source !== filter.source) return false;
        if (filter?.seriesSlug && s.seriesSlug !== filter.seriesSlug) return false;
        if (filter?.channelSlug && (s.channelSlug ?? s.seriesSlug?.split("/")[0]) !== filter.channelSlug) return false;
        return true;
      });
    },
    async load(skillId, scope) {
      const [channel, series] = scope ? scope.split("/") : [];
      const named = allSkills.filter((s) => s.id === skillId);
      const seriesLocal = series ? named.filter((s) => s.seriesSlug === `${channel}/${series}`) : [];
      const channelLocal = channel ? named.filter((s) => s.source === "channel-local" && s.channelSlug === channel) : [];
      const builtin = named.filter((s) => s.source === "built-in");
      const anyChannel = named.filter((s) => s.source === "channel-local");
      const matches = seriesLocal.length ? seriesLocal : channelLocal.length ? channelLocal : builtin.length ? builtin : scope ? [] : anyChannel;
      if (matches.length > 1) throw new Error(`Ambiguous skill: ${skillId}`);
      const skill = matches[0];
      if (!skill) throw new Error(`Skill not found: ${skillId}`);
      return fs.readFile(skill.path, "utf-8");
    },
  };
}

/**
 * Scan a directory for SKILL.md files.
 */
async function scanSkillDir(
  dirPath: string,
  source: SkillDescriptor["source"],
  seriesSlug?: string,
  channelSlug?: string,
): Promise<SkillDescriptor[]> {
  const skills: SkillDescriptor[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skills may be in a subdirectory (e.g., skills/write-brief/SKILL.md)
        const subDir = path.join(dirPath, entry.name);
        for (const subEntry of await fs.readdir(subDir, { withFileTypes: true }).catch(() => [])) {
          if (subEntry.isFile() && subEntry.name.toUpperCase() === "SKILL.MD") {
            const skillPath = path.join(subDir, subEntry.name);
            const descriptor = await describeSkill(entry.name, skillPath, source, seriesSlug, channelSlug);
            skills.push(descriptor);
          }
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        // Pi also discovers root-level .md skills, not just SKILL.md folders.
        const skillPath = path.join(dirPath, entry.name);
        const skillId = entry.name.toUpperCase() === "SKILL.MD" ? path.basename(dirPath) : path.basename(entry.name, ".md");
        const descriptor = await describeSkill(skillId, skillPath, source, seriesSlug, channelSlug);
        skills.push(descriptor);
      }
    }
  } catch {
    // Directory not found or not readable
  }

  return skills;
}

/**
 * Extract metadata from a SKILL.md file.
 */
async function describeSkill(
  skillId: string,
  skillPath: string,
  source: SkillDescriptor["source"],
  seriesSlug?: string,
  channelSlug?: string,
): Promise<SkillDescriptor> {
  let name = skillId.replace(/-/g, " ");
  let description = "";
  let tokenEstimate: number | undefined;

  try {
    const raw = await fs.readFile(skillPath, "utf-8");

    // Estimate tokens (rough: ~4 chars per token)
    tokenEstimate = Math.ceil(raw.length / 4);

    // Try to extract a title from markdown (# Title)
    const titleMatch = raw.match(/^#\s+(.+)/m);
    if (titleMatch) name = titleMatch[1]!;

    // Try to extract a description (first paragraph after title)
    const descMatch = raw.match(/^#\s+.+\n\n(.+)/m);
    if (descMatch) {
      description = descMatch[1]!.trim().slice(0, 200);
    }
    const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (frontmatter) {
      const meta = parseYaml(frontmatter[1]!) as Record<string, unknown> | null;
      if (typeof meta?.name === "string") skillId = name = meta.name;
      if (typeof meta?.description === "string") description = meta.description;
    }
  } catch {
    // File unreadable — return minimal descriptor
  }

  return {
    id: skillId,
    name,
    description,
    path: skillPath,
    source,
    ...(seriesSlug ? { seriesSlug } : {}),
    ...(channelSlug ? { channelSlug } : {}),
    tokenEstimate,
  };
}
