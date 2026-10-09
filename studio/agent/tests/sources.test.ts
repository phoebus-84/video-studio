import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSource, registerSourceTools } from "../src/source-tools.js";
import { episodeOf, workspaceOf } from "../src/workspace-target.js";
import { discoverSkills } from "../src/skills.js";
import { libraryInstructions } from "../src/context.js";

/** Channel sources (avg-dcf.2): a folder of free structure, its README the instructions, made with the episode tools. */

let root: string;
const previous = process.env.AVG_LIBRARY_ROOT;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sources-"));
  mkdirSync(join(root, "poesia", "series", "short", "episodes", "nebbia"), { recursive: true });
  process.env.AVG_LIBRARY_ROOT = root;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previous;
});

function tools() {
  const registered = new Map<string, any>();
  registerSourceTools({ registerTool: (t: { name: string }) => registered.set(t.name, t) } as never);
  return (name: string, params: Record<string, unknown>) => registered.get(name)!.execute("call", params);
}

describe("sources", () => {
  it("creates a source with a draft README, lists it, and never creates it twice", async () => {
    const run = tools();
    const made = await run("pva_create_source", { channel: "poesia", name: "san-martino", title: "San Martino", procedure: "poem-source" });
    expect(made.isError).toBeUndefined();
    const readme = readFileSync(join(root, "poesia", "sources", "san-martino", "README.md"), "utf-8");
    expect(readme).toMatch(/^---\nkind: source\ntitle: "San Martino"\nstatus: draft\nprocedure: poem-source\n---/);
    expect(readSource(root, "poesia", "san-martino")).toEqual({ name: "san-martino", title: "San Martino", status: "draft", procedure: "poem-source" });
    expect((await run("pva_create_source", { channel: "poesia", name: "san-martino", title: "x" })).isError).toBe(true);
    expect((await run("pva_create_source", { channel: "poesia", name: "../x", title: "x" })).isError).toBe(true);
    const listed = await run("pva_sources", { channel: "poesia" });
    expect(listed.content[0].text).toBe("- san-martino: San Martino — draft, made by poem-source");
    expect((await run("pva_sources", { channel: "poesia", status: "ready" })).content[0].text).toBe("poesia has no sources (ready)");
  });

  it("says when a source has no README or no status", () => {
    mkdirSync(join(root, "poesia", "sources", "bare"), { recursive: true });
    expect(readSource(root, "poesia", "bare").problem).toMatch(/no README\.md/);
    writeFileSync(join(root, "poesia", "sources", "bare", "README.md"), "# Bare\n");
    expect(readSource(root, "poesia", "bare").problem).toMatch(/no status/);
  });
});

describe("workspaceOf", () => {
  it("is an episode, or a source, never both and never neither", () => {
    mkdirSync(join(root, "poesia", "sources", "lampo"), { recursive: true });
    expect(workspaceOf(root, { channel: "poesia", series: "short", episode: "nebbia" })).toMatchObject({ kind: "episode", label: "poesia/short/nebbia" });
    expect(workspaceOf(root, { channel: "poesia", source: "lampo" })).toMatchObject({ kind: "source", dir: join(root, "poesia", "sources", "lampo"), label: "poesia/sources/lampo" });
    expect(() => workspaceOf(root, { channel: "poesia", series: "short", episode: "nebbia", source: "lampo" })).toThrow(/not both/);
    expect(() => workspaceOf(root, { channel: "poesia" })).toThrow(/name the episode/);
    expect(() => workspaceOf(root, { channel: "poesia", source: "missing" })).toThrow(/pva_create_source/);
    expect(() => workspaceOf(root, { channel: "poesia", source: ".." })).toThrow(/slug/);
  });

  it("charges a paid call to an episode, never to a source", () => {
    mkdirSync(join(root, "poesia", "sources", "lampo"), { recursive: true });
    expect(episodeOf(workspaceOf(root, { channel: "poesia", series: "short", episode: "nebbia" }), "x")).toEqual({ channel: "poesia", series: "short", episode: "nebbia" });
    expect(() => episodeOf(workspaceOf(root, { channel: "poesia", source: "lampo" }), "ElevenLabs alignment")).toThrow(/a source has no budget/);
  });
});

describe("the channel's own skills and instructions", () => {
  it("finds a channel skill, the series' over the channel's over the studio's", async () => {
    mkdirSync(join(root, "poesia", "skills"), { recursive: true });
    writeFileSync(join(root, "poesia", "skills", "poem-source.md"), "---\nname: poem-source\ndescription: Make a poem's source\n---\n# Channel\n");
    mkdirSync(join(root, "poesia", "series", "short", "skills"), { recursive: true });
    writeFileSync(join(root, "poesia", "series", "short", "skills", "poem-source.md"), "---\nname: poem-source\ndescription: The short's own\n---\n# Series\n");
    const builtIn = mkdtempSync(join(tmpdir(), "builtin-"));
    try {
      const catalog = await discoverSkills({ libraryRoot: root, builtInPath: builtIn });
      expect(catalog.list({ source: "channel-local" }).map((s) => [s.id, s.channelSlug])).toEqual([["poem-source", "poesia"]]);
      expect(await catalog.load("poem-source", "poesia")).toContain("# Channel");
      expect(await catalog.load("poem-source", "poesia/short")).toContain("# Series");
      expect(await catalog.load("poem-source", "poesia/long")).toContain("# Channel");
      expect(await catalog.load("poem-source")).toContain("# Channel");
    } finally {
      rmSync(builtIn, { recursive: true, force: true });
    }
  });

  it("names the README of the channel, the series and every pinned source", () => {
    writeFileSync(join(root, "poesia", "README.md"), "# Poesia\n");
    writeFileSync(join(root, "poesia", "series", "short", "README.md"), "# Short\n");
    mkdirSync(join(root, "poesia", "sources", "lampo"), { recursive: true });
    writeFileSync(join(root, "poesia", "sources", "lampo", "README.md"), "---\nkind: source\ntitle: Il lampo\nstatus: ready\n---\n");
    const pins = join(root, "poesia", "series", "short", "episodes", "nebbia", "source", "pins");
    mkdirSync(pins, { recursive: true });
    writeFileSync(join(pins, "fonte.json"), JSON.stringify({ id: "fonte", source: { kind: "channel-source", name: "lampo" } }));
    expect(libraryInstructions(root, "poesia", "short", "nebbia")).toEqual([
      "poesia/README.md: the channel",
      "poesia/series/short/README.md: the series",
      'poesia/sources/lampo/README.md: source pinned as "fonte" (ready)',
    ]);
    expect(existsSync(join(root, "poesia"))).toBe(true);
  });
});
