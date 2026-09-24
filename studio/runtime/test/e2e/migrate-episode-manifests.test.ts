import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = join(process.cwd(), "..", "..", "tools", "migrate-episode-manifests.mjs");

let root: string;

async function episode(channel: string, series: string, slug: string): Promise<string> {
  const dir = join(root, channel, "series", series, "episodes", slug);
  await mkdir(dir, { recursive: true });
  return dir;
}
const exists = async (p: string) => access(p).then(() => true, () => false);
const run = (...args: string[]) =>
  execFileSync("node", [TOOL, "--library", root, ...args], { encoding: "utf-8" });

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "mig-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("migrate-episode-manifests", () => {
  it("writes a manifest for a bare episode and fills the skeleton", async () => {
    const dir = await episode("childrens", "fairy-tales", "cinderella");
    await mkdir(join(dir, "artifacts"), { recursive: true });

    run();

    const yaml = await readFile(join(dir, "episode.yaml"), "utf-8");
    expect(yaml).toContain("kind: Episode");
    expect(yaml).toContain('slug: "cinderella"');
    expect(yaml).toContain('title: "Cinderella"');
    // No creation time is known for this episode, and inventing one would be
    // asserting a fact nobody holds.
    expect(yaml).not.toContain("createdAt");
    expect(await exists(join(dir, "journal/events.jsonl"))).toBe(true);
    expect(await exists(join(dir, "production"))).toBe(true);
  });

  it("folds episode.json into the manifest and retires it by renaming", async () => {
    const dir = await episode("video-storici", "roma-pills", "giulio-cesare");
    await writeFile(join(dir, "episode.json"), JSON.stringify({
      version: 1, channel: "video-storici", series: "roma-pills",
      slug: "giulio-cesare", title: "Julius Caesar", description: "A pilot.",
    }));

    run();

    const yaml = await readFile(join(dir, "episode.yaml"), "utf-8");
    expect(yaml).toContain('title: "Julius Caesar"');
    expect(yaml).toContain('description: "A pilot."');
    // Nothing under library/ is ever deleted: library/ is gitignored, so a
    // deleted file is gone for good.
    expect(await exists(join(dir, "episode.json"))).toBe(false);
    expect(await exists(join(dir, ".episode.json.migrated"))).toBe(true);
  });

  it("leaves artifacts/episode.json alone — it is the scene spine", async () => {
    const dir = await episode("ch", "s", "ep");
    await mkdir(join(dir, "artifacts"), { recursive: true });
    const spine = JSON.stringify({ version: 1, scenes: [{ id: "s1" }] });
    await writeFile(join(dir, "artifacts", "episode.json"), spine);

    run();

    expect(await readFile(join(dir, "artifacts", "episode.json"), "utf-8")).toBe(spine);
  });

  it("skips and reports an episode whose two manifests disagree", async () => {
    const dir = await episode("ch", "s", "ep");
    await writeFile(join(dir, "episode.yaml"), 'kind: Episode\nslug: "ep"\ntitle: "One"\n');
    await writeFile(join(dir, "episode.json"), JSON.stringify({ slug: "ep", title: "Two" }));

    const out = run();

    expect(out).toMatch(/skip/i);
    expect(out).toContain("ep");
    expect(await readFile(join(dir, "episode.yaml"), "utf-8")).toContain('title: "One"');
    expect(await exists(join(dir, "episode.json"))).toBe(true);
  });

  it("skips an episode whose episode.json will not parse", async () => {
    const dir = await episode("ch", "s", "ep");
    await writeFile(join(dir, "episode.json"), "{not json");

    const out = run();

    expect(out).toMatch(/skip/i);
    expect(await exists(join(dir, "episode.yaml"))).toBe(false);
  });

  it("changes nothing under --dry-run", async () => {
    const dir = await episode("ch", "s", "ep");
    const out = run("--dry-run");
    expect(out).toContain("episode.yaml");
    expect(await exists(join(dir, "episode.yaml"))).toBe(false);
  });

  it("is idempotent", async () => {
    const dir = await episode("ch", "s", "ep");
    run();
    const first = await readFile(join(dir, "episode.yaml"), "utf-8");
    const out = run();
    expect(await readFile(join(dir, "episode.yaml"), "utf-8")).toBe(first);
    expect(out).not.toMatch(/error/i);
  });

  it("exits zero even when it skipped episodes", async () => {
    const dir = await episode("ch", "s", "ep");
    await writeFile(join(dir, "episode.json"), "{not json");
    // A skip is a normal outcome, not a failure: execFileSync throws on a
    // non-zero exit, so reaching the assertion is the assertion.
    expect(() => run()).not.toThrow();
  });
});
