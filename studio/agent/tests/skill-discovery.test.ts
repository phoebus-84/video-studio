import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills } from "../src/skills.js";

it("discovers composed flat/folder skills and scopes layout-2 series overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "skills-discovery-"));
  try {
    const builtInPath = join(root, "built-in");
    await mkdir(join(builtInPath, "nested"), { recursive: true });
    const source = "---\nname: blender-scene\ndescription: Build scenes\n---\n# Blender\n\nBuilt-in.";
    await writeFile(join(builtInPath, "blender-scene.md"), source);
    await writeFile(join(builtInPath, "nested", "SKILL.md"), "---\nname: other\ndescription: Other technique\n---\n# Other");
    for (const series of ["a", "b"]) {
      const local = join(root, "channel", "series", series, "skills");
      await mkdir(local, { recursive: true });
      await writeFile(join(local, "blender-scene.md"), source.replace("Built-in.", series));
    }
    const catalog = await discoverSkills({ libraryRoot: root, builtInPath });
    expect(catalog.skills).toHaveLength(4);
    expect(catalog.list({ source: "built-in" }).map(s => s.id).sort()).toEqual(["blender-scene", "other"]);
    expect(catalog.skills[0]?.description).toBe("Build scenes");
    expect(await catalog.load("blender-scene")).toContain("Built-in.");
    expect(await catalog.load("blender-scene", "channel/a")).toMatch(/\na$/);
    expect(await catalog.load("blender-scene", "channel/b")).toMatch(/\nb$/);
    await expect(catalog.load("missing")).rejects.toThrow("Skill not found");
  } finally { await rm(root, { recursive: true, force: true }); }
});
