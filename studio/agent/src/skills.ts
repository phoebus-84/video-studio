// ---------------------------------------------------------------------------
// Skill discovery
// ---------------------------------------------------------------------------
// Discovers built-in and series-local skills by scanning directories
// for SKILL.md files. Skills are loaded on demand using lazy I/O.
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
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
  /** Where this skill was discovered. */
  source: "built-in" | "series-local";
  /** Series slug if series-local. */
  seriesSlug?: string;
  /** Estimated token count of the skill content. */
  tokenEstimate?: number;
}

export interface SkillCatalog {
  /** All discovered skills. */
  skills: SkillDescriptor[];
  /** List skills with optional filter. */
  list(filter?: { source?: "built-in" | "series-local"; seriesSlug?: string }): SkillDescriptor[];
  /** Load a skill's full content. */
  load(skillId: string): Promise<string>;
}

// ── Implementation ──────────────────────────────────────────────────────────

/**
 * Create a skill catalog by scanning built-in and series-local directories.
 */
export async function discoverSkills(): Promise<SkillCatalog> {
  const config = await resolveConfig();
  const builtInPath = path.resolve(config.libraryRoot, "..", "video-built-in-pipelines", "skills");
  const libraryRoot = config.libraryRoot;

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

      const seriesList = await fs.readdir(channelPath).catch(() => [] as string[]);
      for (const series of seriesList) {
        const seriesPath = path.join(channelPath, series);
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
        return true;
      });
    },
    async load(skillId) {
      const skill = allSkills.find((s) => s.id === skillId);
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
  source: "built-in" | "series-local",
  seriesSlug?: string,
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
            const descriptor = await describeSkill(entry.name, skillPath, source, seriesSlug);
            skills.push(descriptor);
          }
        }
      } else if (entry.isFile() && entry.name.toUpperCase() === "SKILL.MD") {
        // Flat: skills/SKILL.md (used by single-skill directory)
        const skillPath = path.join(dirPath, entry.name);
        const skillId = path.basename(dirPath);
        const descriptor = await describeSkill(skillId, skillPath, source, seriesSlug);
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
  source: "built-in" | "series-local",
  seriesSlug?: string,
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
  } catch {
    // File unreadable — return minimal descriptor
  }

  return {
    id: skillId,
    name,
    description,
    path: skillPath,
    source,
    seriesSlug,
    tokenEstimate,
  };
}
