import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EPISODE_TREE } from "@studio/contracts/src/layout.mjs";

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

/**
 * A byte-for-byte recursive snapshot of a directory: every entry's path,
 * kind, and (for files) content. Two snapshots compare equal only if the
 * tree is unchanged in every respect — not just the one file a narrower
 * assertion happens to check.
 */
async function snapshot(dir: string): Promise<string> {
  const rows: string[] = [];
  async function walk(d: string, rel: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(d, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        rows.push(`d ${relPath}`);
        await walk(full, relPath);
      } else if (e.isFile()) {
        const content = await readFile(full);
        rows.push(`f ${relPath} ${content.length} ${content.toString("base64")}`);
      }
    }
  }
  await walk(dir, "");
  return rows.join("\n");
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "mig-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("migrate-episode-manifests", () => {
  it("writes a manifest for a bare episode and fills the skeleton", async () => {
    const dir = await episode("childrens", "fairy-tales", "cinderella");
    await mkdir(join(dir, "artifacts"), { recursive: true });

    run();

    const yaml = await readFile(join(dir, "episode.yaml"), "utf-8");
    expect(yaml).toContain("apiVersion: studio.video/v1alpha1");
    expect(yaml).toContain("kind: Episode");
    expect(yaml).toContain('slug: "cinderella"');
    expect(yaml).toContain('title: "Cinderella"');
    // No creation time is known for this episode, and inventing one would be
    // asserting a fact nobody holds.
    expect(yaml).not.toContain("createdAt");

    // "fills the skeleton" means the whole skeleton. Checking two of the
    // fifteen entries and naming the test after all fifteen is the defect
    // this branch exists to remove: it let `.workspace/contract.json` go
    // uncreated, which made `doctor` skip the episode entirely.
    const missing: string[] = [];
    for (const entry of EPISODE_TREE) {
      if (!(await exists(join(dir, entry)))) missing.push(entry);
    }
    expect(missing).toEqual([]);
  });

  it("upgrades a legacy manifest, keeping every value it already held", async () => {
    const dir = await episode("video-storici", "roma-pills", "giulio-cesare");
    // Exactly what the old creator wrote: no apiVersion, no kind. Every
    // episode.yaml in the library is this shape, and every one of them fails
    // the EpisodeManifest contract until it is upgraded.
    await writeFile(join(dir, "episode.yaml"),
      '# Episode giulio-cesare\n'
      + 'slug: giulio-cesare\n'
      + 'title: "Julius Caesar: The Man Who Changed Rome"\n'
      + 'createdAt: 2026-08-22T22:53:12.278Z\n');

    const out = run();

    const yaml = await readFile(join(dir, "episode.yaml"), "utf-8");
    expect(out).toMatch(/upgrade episode\.yaml/);
    expect(yaml).toContain("apiVersion: studio.video/v1alpha1");
    expect(yaml).toContain("kind: Episode");
    expect(yaml).toContain('slug: "giulio-cesare"');
    // Verbatim. A re-derived title would quietly discard the punctuation a
    // person chose, and a re-derived createdAt would be a fabricated fact:
    // this timestamp is the only record that the episode was made that day.
    expect(yaml).toContain('title: "Julius Caesar: The Man Who Changed Rome"');
    expect(yaml).toContain('createdAt: "2026-08-22T22:53:12.278Z"');
    // Folded in from the path, which is what proves them.
    expect(yaml).toContain('channel: "video-storici"');
    expect(yaml).toContain('series: "roma-pills"');
  });

  it("leaves an already-conforming manifest byte-for-byte alone", async () => {
    const dir = await episode("ch", "s", "ep");
    const original = "apiVersion: studio.video/v1alpha1\nkind: Episode\n"
      + 'slug: "ep"\ntitle: "Hand edited"\n';
    await writeFile(join(dir, "episode.yaml"), original);

    const out = run();

    expect(await readFile(join(dir, "episode.yaml"), "utf-8")).toBe(original);
    // And no action is reported for it. A plan line for a file nothing
    // touched is the tool claiming work it did not do.
    expect(out).not.toMatch(/episode\.yaml/);
  });

  it("skips an episode whose episode.yaml will not parse, and never overwrites it", async () => {
    const dir = await episode("ch", "s", "ep");
    // The old creator wrote `title:` unquoted, so a legacy title holding a
    // colon does not parse. Guessing past it would invent the title.
    const unparseable = "slug: ep\ntitle: Julius Caesar: The Man\n";
    await writeFile(join(dir, "episode.yaml"), unparseable);

    const out = run();

    expect(out).toMatch(/skip/i);
    expect(out).toMatch(/will not parse/);
    expect(await readFile(join(dir, "episode.yaml"), "utf-8")).toBe(unparseable);
  });

  it("creates the workspace contract and metadata, and overwrites neither", async () => {
    const dir = await episode("ch", "s", "ep");

    run();

    const contract = JSON.parse(await readFile(join(dir, ".workspace/contract.json"), "utf-8"));
    expect(contract.schema).toBe("video-workspace-contracts/workspace-v1");
    expect(contract.type).toBe("episode");
    expect(typeof contract.createdAt).toBe("string");
    const metadata = JSON.parse(await readFile(join(dir, ".workspace/metadata.json"), "utf-8"));
    expect(metadata.title).toBe("Ep");
    // Unknown fields are omitted, never written as "".
    expect("description" in metadata).toBe(false);

    // Both are "never overwritten" files: metadata.json is user-editable and
    // contract.json may carry a real creation time this tool cannot know.
    const edited = await episode("ch2", "s", "ep");
    await mkdir(join(edited, ".workspace"), { recursive: true });
    await writeFile(join(edited, ".workspace/contract.json"),
      '{"schema":"video-workspace-contracts/workspace-v1","version":"0.1.0",'
      + '"type":"episode","createdAt":"2020-01-01T00:00:00.000Z","updatedAt":"2020-01-01T00:00:00.000Z"}');
    await writeFile(join(edited, ".workspace/metadata.json"), '{"title":"mine"}');

    run();

    expect(await readFile(join(edited, ".workspace/contract.json"), "utf-8"))
      .toContain("2020-01-01T00:00:00.000Z");
    expect(await readFile(join(edited, ".workspace/metadata.json"), "utf-8")).toBe('{"title":"mine"}');
  });

  it("one unmigratable episode does not abort the run", async () => {
    const broken = await episode("ch", "s", "broken");
    // A FILE where the skeleton expects a directory. Seeding
    // journal/events.jsonl under it fails with ENOTDIR.
    await writeFile(join(broken, "journal"), "not a directory");
    const healthy = await episode("ch", "s", "healthy");

    const out = run();

    // The other episode still migrated...
    expect(await exists(join(healthy, "episode.yaml"))).toBe(true);
    // ...the failure is recorded rather than swallowed...
    expect(out).toMatch(/skip/i);
    expect(out).toContain("broken");
    // ...and the summary still prints, so a half-migrated gitignored tree is
    // never left without a record of what changed.
    expect(out).toMatch(/skipped 1 episode\(s\)\.$/m);
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

  it("never overwrites an already-retired episode.json", async () => {
    const dir = await episode("ch", "s", "ep");
    await writeFile(join(dir, "episode.json"), JSON.stringify({ slug: "ep", title: "T", description: "first" }));
    run();
    expect(await readFile(join(dir, ".episode.json.migrated"), "utf-8")).toContain("first");

    // A second episode.json appears — restored from a backup, or written by an
    // older tool. Retiring it must not destroy the one already retired.
    await writeFile(join(dir, "episode.json"), JSON.stringify({ slug: "ep", title: "T", description: "SECOND" }));
    const out = run();

    expect(out).toMatch(/skip/i);
    expect(await readFile(join(dir, ".episode.json.migrated"), "utf-8")).toContain("first");
    expect(await exists(join(dir, "episode.json"))).toBe(true);
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
    const before = await snapshot(dir);

    const out = run("--dry-run");

    expect(out).toContain("episode.yaml");
    // A byte-for-byte snapshot pins every write the tool can make — the
    // manifest, each EPISODE_DIRECTORIES mkdir, each EPISODE_SEED_FILES
    // write — behind its own `if (!dryRun)`, not just the one file a
    // narrower check happens to look at.
    expect(await snapshot(dir)).toBe(before);
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
