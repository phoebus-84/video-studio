import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEpisode, compileEpisode, loadEpisode, sharedRootsOf } from "../src/series-compile.js";
import { divLongEpisode } from "../src/testing.js";

/**
 * Il lampo's lesson on disk (avg-dcf.6.2–6.3): the long episode pins the
 * short as its source, and compiles with its release's compiler.
 */

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "div-long-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the dentro-i-versi-long episode", () => {
  it("loads its pinned source and compiles, looping, in the theme's look", async () => {
    const { episodeDir, episodeRef } = await divLongEpisode(root);
    const loaded = loadEpisode(episodeDir, { episodeRef });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(Object.keys(loaded.input.sources!)).toEqual(["fonte"]);
    const compiled = compileEpisode(episodeDir, { episodeRef });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect((compiled.timeline as any).loop).toBe(true);
    expect(compiled.timeline.assets["source-fonte-narration-recita"]!.path).toBe("../../../short/episodes/il-lampo/assets/takes/recita.wav");
    expect(sharedRootsOf(episodeDir)).toEqual([join(root, "dentro-i-versi", "themes", "dentro-i-versi", "1.0.0"), join(root, "dentro-i-versi", "series", "short", "episodes", "il-lampo")]);
  });

  it("passes its series rules but for the missing sound theme (and its unsealed fixture theme)", async () => {
    const { episodeDir, episodeRef } = await divLongEpisode(root);
    const checked = checkEpisode(episodeDir, { episodeRef });
    if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
    expect(checked.validator).toBe("dentro-i-versi-long@1.0.0");
    expect(checked.findings.map((f) => [f.code, f.severity])).toEqual([["theme-unsealed", "warning"], ["no-theme-sound", "warning"]]);
  });

  it("compiles on compiler 1.1.0, with its text on the glass", async () => {
    const { episodeDir, episodeRef } = await divLongEpisode(root, { version: "1.1.0" });
    const compiled = compileEpisode(episodeDir, { episodeRef });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect(compiled.compiler).toBe("dentro-i-versi-long@1.1.0");
    const glass = compiled.timeline.tracks.flatMap((t) => t.items as { id: string; kit?: unknown }[]).find((i) => i.id === "glass-scheda");
    expect(glass?.kit).toEqual({ name: "panel", version: "1.1.0" });
  });

  it("stops when the source changed since it was pinned", async () => {
    const { episodeDir, episodeRef } = await divLongEpisode(root);
    writeFileSync(join(root, "dentro-i-versi", "series", "short", "episodes", "il-lampo", "assets", "images", "lampo-04-casa.png"), "repainted");
    const compiled = compileEpisode(episodeDir, { episodeRef });
    expect(compiled.ok ? null : compiled.problems[0]!.code).toBe("pin-mismatch");
  });
});
