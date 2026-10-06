import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditTimeline } from "@studio/episode";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_propose_reference (avg-jao.6): Pi proposes, a person approves. What a
 * proposal freezes is @studio/episode's proposeReference; here, what the tool
 * says, and that it signs nothing.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-propose-reference-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  specEpisode(dir(), REF);
  writeEditTimeline(dir(), { episodeRef: REF });
  mkdirSync(at("output"), { recursive: true });
  writeFileSync(at("output/render-1-abcd1234.mp4"), "fake mp4");
  const hash = `sha256:${createHash("sha256").update(readFileSync(at("artifacts/edit-timeline.json"))).digest("hex")}`;
  writeFileSync(at("output/render-1-abcd1234.report.json"), JSON.stringify({ timeline: { path: "artifacts/edit-timeline.json", hash } }));
  writeFileSync(at("output/current.json"), JSON.stringify({ renderId: "render-1-abcd1234", path: "render-1-abcd1234.mp4" }));
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
  return tools.get("pva_propose_reference")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_propose_reference", () => {
  it("freezes the proposal and tells the person the command that approves it", async () => {
    const result = await tool({ referenceId: "morning-v1" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toMatch(/^✅ proposed morning-v1 for sample\/poetry \(template poetry-short@1\.0\.0\)/);
    expect(text).toContain("  - reviews/references/morning-v1/proposal.json");
    expect(text).toContain("Only a person can make it a reference");
    expect(text).toContain("  vpr reference approve sample/poetry/morning morning-v1");
    const proposal = JSON.parse(readFileSync(at("reviews/references/morning-v1/proposal.json"), "utf-8"));
    expect(proposal.approval).toBeUndefined();
    expect(existsSync(join(root, REF.channel, "series", REF.series, "templates/poetry-short/references/morning-v1.json"))).toBe(false);
  });

  it("says why nothing was proposed", async () => {
    await tool({ referenceId: "morning-v1" });
    const again = await tool({ referenceId: "morning-v1" });
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toMatch(/reference-exists at reviews\/references\/morning-v1/);
  });
});
