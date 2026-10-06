import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * proposeReference when freezing fails half-way (a full disk, a permission):
 * nothing is left behind, so the same id can be proposed again.
 */

let failProposal = false;
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (failProposal && String(args[0]).endsWith("proposal.json")) {
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      }
      return actual.writeFileSync(...args);
    },
  };
});

const { proposeReference } = await import("../src/references.js");
const { writeEditTimeline } = await import("../src/episode-render.js");
const { specEpisode } = await import("../src/testing.js");

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "propose-reference-partial-"));
  specEpisode(dir(), REF);
  writeEditTimeline(dir(), { episodeRef: REF });
  mkdirSync(at("output"), { recursive: true });
  writeFileSync(at("output/render-1-abcd1234.mp4"), "fake mp4");
  const hash = `sha256:${createHash("sha256").update(readFileSync(at("artifacts/edit-timeline.json"))).digest("hex")}`;
  writeFileSync(at("output/render-1-abcd1234.report.json"), JSON.stringify({ timeline: { path: "artifacts/edit-timeline.json", hash } }));
  writeFileSync(at("output/current.json"), JSON.stringify({ renderId: "render-1-abcd1234", path: "render-1-abcd1234.mp4" }));
});
afterEach(() => {
  failProposal = false;
  rmSync(root, { recursive: true, force: true });
});

it("leaves nothing behind when freezing fails, so the id can be proposed again", () => {
  failProposal = true;
  expect(() => proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" })).toThrow(/no space left/);
  expect(existsSync(at("reviews/references/morning-v1"))).toBe(false);
  failProposal = false;
  const again = proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" });
  expect(again.ok).toBe(true);
});
