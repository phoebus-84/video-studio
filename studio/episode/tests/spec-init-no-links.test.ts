import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * initEpisodeSpec on a filesystem without hard links (exFAT, FAT, some
 * network mounts): still written, still never over an existing spec, no
 * temporary file left behind.
 */

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    linkSync: () => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    },
  };
});

const { initEpisodeSpec } = await import("../src/spec-init.js");
const { specEpisode } = await import("../src/testing.js");

const REF = { channel: "sample", series: "poetry", episode: "morning" };
const TEMPLATE = { id: "poetry-short", version: "1.0.0" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spec-init-no-links-"));
  specEpisode(dir(), REF);
  unlinkSync(join(dir(), "episode-spec.json"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("writes the draft without a hard link", () => {
  const result = initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  expect(JSON.parse(readFileSync(join(dir(), "episode-spec.json"), "utf-8"))).toEqual(result.spec);
  expect(readdirSync(dir()).filter((f) => f.endsWith(".tmp"))).toEqual([]);
});

it("still never replaces a spec that appeared meanwhile", () => {
  writeFileSync(join(dir(), "episode-spec.json"), "{ a person's work }");
  const result = initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE });
  expect(result.ok).toBe(false);
  expect(readFileSync(join(dir(), "episode-spec.json"), "utf-8")).toBe("{ a person's work }");
  expect(readdirSync(dir()).filter((f) => f.endsWith(".tmp"))).toEqual([]);
});
