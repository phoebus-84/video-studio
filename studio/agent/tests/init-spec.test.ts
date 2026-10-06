import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_init_spec (avg-jao.4): the first stage of the series-production
 * pipeline. The draft itself is @studio/episode's initEpisodeSpec; here, what
 * the tool says and that it never replaces a spec.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-init-spec-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  specEpisode(dir(), REF);
  unlinkSync(join(dir(), "episode-spec.json"));
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function tool(params: Record<string, unknown>) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get("pva_init_spec")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_init_spec", () => {
  it("writes a pinned draft and lists what to fill", async () => {
    const result = await tool({ template: "poetry-short", version: "1.0.0" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toMatch(/^✅ episode-spec\.json: a draft pinned to poetry-short@1\.0\.0 \(sha256:[0-9a-f]{64}\)/);
    expect(text).toMatch(/5 value\(s\) to fill:/);
    expect(text).toContain('  - $.data["narration"]');
    expect(text).toMatch(/fill-episode-spec skill; then pva_check_episode/);
    const spec = JSON.parse(readFileSync(join(dir(), "episode-spec.json"), "utf-8"));
    expect(spec.template.id).toBe("poetry-short");
    expect(spec.data.title).toBe("__FILL__");
  });

  it("refuses to replace an existing spec", async () => {
    await tool({ template: "poetry-short", version: "1.0.0" });
    const before = readFileSync(join(dir(), "episode-spec.json"), "utf-8");
    const result = await tool({ template: "poetry-short", version: "1.0.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/spec-exists at episode-spec\.json/);
    expect(readFileSync(join(dir(), "episode-spec.json"), "utf-8")).toBe(before);
  });

  it("refuses a version that is not an exact release", async () => {
    const result = await tool({ template: "poetry-short", version: "^1.0.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/bad-version/);
  });
});
