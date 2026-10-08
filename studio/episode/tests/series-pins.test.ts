import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventory } from "@studio/contracts/src/source-pins.mjs";
import { loadEpisode, sharedRootsOf } from "../src/series-compile.js";
import { specEpisode } from "../src/testing.js";

/**
 * Material pinned from another episode of the channel (ADR-0035) reaches the
 * compiler: its pictures and takes as source-<pin>-… assets, its takes and
 * timings as CompileInput.sources, held to the pin's inventory.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
const SOURCE = { ...REF, episode: "source" };
let root: string;
const dirOf = (ref: typeof REF) => join(root, ref.channel, "series", ref.series, "episodes", ref.episode);

async function pin(paths?: string[]): Promise<void> {
  const files = await inventory(dirOf(SOURCE), paths);
  mkdirSync(join(dirOf(REF), "source", "pins"), { recursive: true });
  writeFileSync(join(dirOf(REF), "source", "pins", "fonte.json"), JSON.stringify({
    apiVersion: "studio.video/v1alpha1", kind: "SourcePin", id: "fonte",
    source: { kind: "episode", series: SOURCE.series, episode: SOURCE.episode },
    ...(paths ? { paths } : {}), usedBy: ["timeline"], pinnedAt: "2026-10-09T12:00:00.000Z", files,
  }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "series-pins-"));
  specEpisode(dirOf(SOURCE), SOURCE);
  specEpisode(dirOf(REF), REF);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("pinned episodes in loadEpisode", () => {
  it("offers the pinned episode's pictures and takes, and its takes and timings as sources", async () => {
    await pin();
    const loaded = loadEpisode(dirOf(REF), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    const { assets, sources } = loaded.input;
    const own = Object.keys(assets).filter((id) => id.startsWith("image-"));
    const pinned = Object.keys(assets).filter((id) => id.startsWith("source-fonte-image-"));
    expect(pinned.map((id) => id.replace("source-fonte-", ""))).toEqual(own);
    expect(assets[pinned[0]!]!.path).toMatch(/^\.\.\/source\/assets\/images\//);
    const takes = sources!.fonte!.narration.takes.map((t) => t.id);
    expect(Object.keys(sources!.fonte!.timings).sort()).toEqual([...takes].sort());
    for (const take of takes) expect(assets[`source-fonte-narration-${take}`]!.kind).toBe("audio");
  });

  it("refuses a pinned file changed since the pin, naming it", async () => {
    await pin();
    const takes = JSON.parse(readFileSync(join(dirOf(SOURCE), "artifacts", "narration", "takes.json"), "utf-8"));
    writeFileSync(join(dirOf(SOURCE), takes.takes[0].audio.path), "re-recorded");
    const loaded = loadEpisode(dirOf(REF), { episodeRef: REF });
    expect(loaded.ok ? null : loaded.problems[0]).toMatchObject({ code: "pin-mismatch", path: `../source/${takes.takes[0].audio.path}` });
  });

  it("refuses a file the pin did not inventory", async () => {
    await pin(["artifacts/narration/takes.json"]);
    const loaded = loadEpisode(dirOf(REF), { episodeRef: REF });
    expect(loaded.ok ? null : loaded.problems[0]!.code).toBe("pin-mismatch");
  });

  it("refuses a pin whose file is not named by its id, and two pins of one id", async () => {
    await pin();
    const pins = join(dirOf(REF), "source", "pins");
    writeFileSync(join(pins, "other.json"), readFileSync(join(pins, "fonte.json")));
    const loaded = loadEpisode(dirOf(REF), { episodeRef: REF });
    expect(loaded.ok ? null : loaded.problems[0]).toMatchObject({ code: "bad-pin", path: "source/pins/other.json#$.id" });
  });

  it("refuses a pinned timing that is not the one its take recorded", async () => {
    const takesPath = join(dirOf(SOURCE), "artifacts", "narration", "takes.json");
    const takes = JSON.parse(readFileSync(takesPath, "utf-8"));
    takes.takes[0].timing.hash = `sha256:${"0".repeat(64)}`;
    writeFileSync(takesPath, JSON.stringify(takes));
    await pin();
    const loaded = loadEpisode(dirOf(REF), { episodeRef: REF });
    expect(loaded.ok ? null : loaded.problems[0]!.code).toBe("hash-mismatch");
  });

  it("gives the render no root for a pin that does not hold", async () => {
    await pin();
    const file = join(dirOf(REF), "source", "pins", "fonte.json");
    const doc = JSON.parse(readFileSync(file, "utf-8"));
    doc.source.series = "../../../elsewhere";
    writeFileSync(file, JSON.stringify(doc));
    expect(sharedRootsOf(dirOf(REF)).some((r) => r.includes("elsewhere"))).toBe(false);
  });

  it("offers nothing pinned when there is no pin, and puts the pinned episode among the render's roots", async () => {
    const before = loadEpisode(dirOf(REF), { episodeRef: REF });
    expect(before.ok && before.input.sources).toBeUndefined();
    expect(sharedRootsOf(dirOf(REF))).not.toContain(dirOf(SOURCE));
    await pin();
    expect(sharedRootsOf(dirOf(REF))).toContain(dirOf(SOURCE));
  });
});
