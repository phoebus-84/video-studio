import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncClaudeSkills, skillText, MANIFEST } from "../claude-skills.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "claude-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const shared = join(root, "shared");
  const studio = join(root, "studio");
  await mkdir(join(shared, "beads", "agents"), { recursive: true });
  await mkdir(studio, { recursive: true });
  await writeFile(join(shared, "beads", "SKILL.md"), "---\nname: beads\ndescription: Track work\n---\n# Beads\n");
  await writeFile(join(shared, "beads", "agents", "x.md"), "nested");
  await writeFile(join(shared, "loose.md"), "# Loose Guide\n\nNo front matter.\n");
  await writeFile(join(studio, "write-brief.md"), "---\nname: write-brief\nversion: \"0.1.0\"\ndescription: Write a brief\n---\n# Brief\n");
  await mkdir(join(studio, "not-a-skill"));
  return { root, sources: [shared, studio], target: join(root, ".claude", "skills") };
}

test("every skill lands as <name>/SKILL.md, directories copied whole", async (t) => {
  const { sources, target } = await fixture(t);
  const written = syncClaudeSkills(sources, target);
  assert.deepEqual(written.sort(), ["beads", "loose", "write-brief"]);
  assert.equal(await readFile(join(target, "beads", "agents", "x.md"), "utf-8"), "nested");
  assert.match(await readFile(join(target, "write-brief", "SKILL.md"), "utf-8"), /^---\nname: write-brief\nversion/);
  assert.equal(existsSync(join(target, "not-a-skill")), false);
});

test("a skill without front matter gets a name and a description", async (t) => {
  const { sources, target } = await fixture(t);
  syncClaudeSkills(sources, target);
  const text = await readFile(join(target, "loose", "SKILL.md"), "utf-8");
  assert.match(text, /^---\nname: loose\ndescription: "Loose Guide"\n---\n\n# Loose Guide/);
});

test("front matter missing only a description keeps its other fields", () => {
  const text = skillText("x", "---\nname: x\nversion: 1\n---\n# Heading\nbody\n");
  assert.equal(text, "---\nname: x\ndescription: \"Heading\"\nversion: 1\n---\n\n# Heading\nbody\n");
});

test("a re-sync replaces only what it wrote before", async (t) => {
  const { sources, target } = await fixture(t);
  syncClaudeSkills(sources, target);
  await mkdir(join(target, "my-own-skill"));
  await writeFile(join(target, "my-own-skill", "SKILL.md"), "---\nname: my-own-skill\ndescription: mine\n---\n");
  await rm(join(sources[0], "loose.md"));

  syncClaudeSkills(sources, target);
  const names = (await readdir(target)).filter((n) => n !== MANIFEST).sort();
  assert.deepEqual(names, ["beads", "my-own-skill", "write-brief"]);
});
