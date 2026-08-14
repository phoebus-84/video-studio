/**
 * Tests for skills structure and content validation.
 *
 * Validates:
 * - Each skill directory has a SKILL.md
 * - SKILL.md files have required frontmatter (name, description)
 * - Skill names follow format rules
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const SKILLS_DIR = resolve(__dirname, "..", "skills");

function findSkillDirs(baseDir: string): string[] {
  if (!existsSync(baseDir)) return [];

  const result: string[] = [];
  const entries = readdirSync(baseDir);

  for (const entry of entries) {
    const full = join(baseDir, entry);
    if (statSync(full).isDirectory()) {
      if (existsSync(join(full, "SKILL.md"))) {
        result.push(full);
      }
      // Recurse for nested skill dirs
      result.push(...findSkillDirs(full));
    }
  }

  return result;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm: Record<string, string> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fm[key] = value;
  }
  return fm;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("skills — directory structure", () => {
  it("skills directory exists", () => {
    expect(existsSync(SKILLS_DIR)).toBe(true);
  });

  it("contains at least one skill directory with SKILL.md", () => {
    const skillDirs = findSkillDirs(SKILLS_DIR);
    expect(skillDirs.length).toBeGreaterThan(0);
  });
});

describe("skills — SKILL.md format", () => {
  const skillDirs = findSkillDirs(SKILLS_DIR);

  for (const skillDir of skillDirs) {
    const skillName = resolve(skillDir).split("/").pop()!;
    const skillMdPath = join(skillDir, "SKILL.md");
    const content = readFileSync(skillMdPath, "utf-8");

    describe(`skill: ${skillName}`, () => {
      it("has frontmatter delimited by ---", () => {
        expect(content.startsWith("---")).toBe(true);
        const secondDelim = content.indexOf("---", 3);
        expect(secondDelim).toBeGreaterThan(0);
      });

      it("has a 'name' in frontmatter", () => {
        const fm = parseFrontmatter(content);
        expect(fm).not.toBeNull();
        expect(fm!.name).toBeDefined();
        expect(fm!.name.length).toBeGreaterThan(0);
        expect(fm!.name.length).toBeLessThanOrEqual(64);
      });

      it("has a 'description' in frontmatter", () => {
        const fm = parseFrontmatter(content);
        expect(fm).not.toBeNull();
        expect(fm!.description).toBeDefined();
        expect(fm!.description.length).toBeGreaterThan(0);
        expect(fm!.description.length).toBeLessThanOrEqual(1024);
      });

      it("name contains only lowercase letters, numbers, and hyphens", () => {
        const fm = parseFrontmatter(content);
        expect(fm).not.toBeNull();
        const name = fm!.name;
        expect(name).toMatch(/^[a-z0-9-]+$/);
      });

      it("name does not start or end with hyphen", () => {
        const fm = parseFrontmatter(content);
        expect(fm).not.toBeNull();
        const name = fm!.name;
        expect(name.startsWith("-")).toBe(false);
        expect(name.endsWith("-")).toBe(false);
      });

      it("name has no consecutive hyphens", () => {
        const fm = parseFrontmatter(content);
        expect(fm).not.toBeNull();
        const name = fm!.name;
        expect(name.includes("--")).toBe(false);
      });

      it("has substantive body content after frontmatter", () => {
        const fm = parseFrontmatter(content);
        const bodyStart = content.indexOf("---", 3) + 3;
        const body = content.slice(bodyStart).trim();
        expect(body.length).toBeGreaterThan(50);
      });
    });
  }
});
