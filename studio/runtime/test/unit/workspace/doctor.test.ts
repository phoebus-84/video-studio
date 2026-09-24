// ---------------------------------------------------------------------------
// Doctor — workspace validation tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { FakeFileSystem, FakeClock } from "../../fixtures/index.js";
import { doctor } from "../../../src/workspace/doctor.js";
import {
  initChannel,
  initSeries,
  initEpisode,
} from "../../../src/workspace/init.js";
import type { InitOptions } from "../../../src/workspace/init.js";

function makeOpts(fs: FakeFileSystem): InitOptions {
  return {
    fs,
    clock: new FakeClock(),
  };
}

describe("doctor", () => {
  let fs: FakeFileSystem;

  beforeEach(() => {
    fs = new FakeFileSystem();
    fs.seed({ "/library/.keep": "" });
  });

  it("reports healthy on a freshly initialized tree", async () => {
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
    if (!epR.ok) throw new Error("episode failed");

    const report = await doctor({ fs, libraryRoot: "/library" });
    expect(report.ok).toBe(true);
    expect(report.findings.filter((f) => f.code.startsWith("E_"))).toHaveLength(0);
  });

  it("reports missing episode.yaml", async () => {
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    await initEpisode(srR.value.path, "ep-01", {}, opts);

    // Remove episode.yaml
    await fs.remove("/library/ch/series/s1/episodes/ep-01/episode.yaml");

    const report = await doctor({ fs, libraryRoot: "/library" });
    expect(report.ok).toBe(false);
    const missing = report.findings.filter((f) => f.code === "E_MISSING_REQUIRED");
    expect(missing.some((f) => f.path.includes("episode.yaml"))).toBe(true);
  });

  it("reports corrupt events.jsonl", async () => {
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    await initEpisode(srR.value.path, "ep-01", {}, opts);

    // Corrupt events.jsonl
    await fs.writeText("/library/ch/series/s1/episodes/ep-01/journal/events.jsonl", "not-json\n");

    const report = await doctor({ fs, libraryRoot: "/library" });
    expect(report.ok).toBe(false);
    const invalidJsonl = report.findings.filter((f) => f.code === "E_INVALID_JSONL");
    expect(invalidJsonl.length).toBeGreaterThan(0);
    expect(invalidJsonl[0]!.path).toContain("events.jsonl");
  });

  it("filters by channel/series/episode", async () => {
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    await initEpisode(srR.value.path, "ep-01", {}, opts);

    // Remove episode.yaml but only check channel level
    await fs.remove("/library/ch/series/s1/episodes/ep-01/episode.yaml");

    const report = await doctor({ fs, libraryRoot: "/library", channel: "ch" });
    // Channel-level check should be fine
    expect(report.ok).toBe(true);
  });

  const EP = "/library/ch/series/s1/episodes/ep-01";

  it("reports an episode.yaml that is not valid YAML", async () => {
    // A check that confirms presence while reporting validity is the defect this
    // branch exists to remove: an empty or broken manifest passed before.
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
    if (!epR.ok) throw new Error("episode failed");

    await fs.writeText(`${EP}/episode.yaml`, "kind: [unclosed");
    const report = await doctor({ fs, libraryRoot: "/library" });
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "E_INVALID_MANIFEST")).toBe(true);
  });

  it("reports an episode.yaml that parses but is not an episode manifest", async () => {
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
    if (!epR.ok) throw new Error("episode failed");

    await fs.writeText(`${EP}/episode.yaml`, "kind: Series\nslug: x\n");
    const report = await doctor({ fs, libraryRoot: "/library" });
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "E_INVALID_MANIFEST")).toBe(true);
  });

  it("reports a manifest whose title is the wrong type", async () => {
    // The point of validating against the schema rather than by hand: a
    // hand-rolled kind-and-slug check would pass this.
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
    if (!epR.ok) throw new Error("episode failed");

    await fs.writeText(
      `${EP}/episode.yaml`,
      'apiVersion: studio.video/v1alpha1\nkind: Episode\nslug: "ep-01"\ntitle: 7\n',
    );
    const report = await doctor({ fs, libraryRoot: "/library" });
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.code === "E_INVALID_MANIFEST")).toBe(true);
  });

  it("accepts the manifest initEpisode writes", async () => {
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
    if (!epR.ok) throw new Error("episode failed");

    const report = await doctor({ fs, libraryRoot: "/library" });
    expect(report.ok).toBe(true);
    expect(report.findings.filter((f) => f.code === "E_INVALID_MANIFEST")).toEqual([]);
  });
});
