import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_upgrade_spec (avg-dcf.6.10): an episode moves to a newer release of its
 * template. The move itself is @studio/episode's upgradeEpisodeSpec; here,
 * what the tool says.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const releases = () => join(root, REF.channel, "series", REF.series, "templates", "poetry-short");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-upgrade-spec-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  specEpisode(dir(), REF);
  // poetry-short@1.1.0: the same standard, released again.
  cpSync(join(releases(), "1.0.0"), join(releases(), "1.1.0"), { recursive: true });
  const manifest = join(releases(), "1.1.0", "series-template.json");
  writeFileSync(manifest, `${JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf-8")), version: "1.1.0" }, null, 2)}\n`);
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
  return tools.get("pva_upgrade_spec")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_upgrade_spec", () => {
  it("moves the spec to the newer release and says to rebuild and review again", async () => {
    const result = await tool({ version: "1.1.0" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toMatch(/^✅ episode-spec\.json: poetry-short@1\.0\.0 → poetry-short@1\.1\.0 \(sha256:[0-9a-f]{64}\), revision \d+\n/);
    expect(text).toMatch(/pva_build_timeline/);
    expect(JSON.parse(readFileSync(join(dir(), "episode-spec.json"), "utf-8")).template.version).toBe("1.1.0");
  });

  it("refuses a version that does not come after the pinned one", async () => {
    const before = readFileSync(join(dir(), "episode-spec.json"), "utf-8");
    const result = await tool({ version: "1.0.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ The spec was not moved\n  - bad-version at episode-spec\.json#\$\.template\.version/);
    expect(readFileSync(join(dir(), "episode-spec.json"), "utf-8")).toBe(before);
  });
});
