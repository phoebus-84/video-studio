import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AdapterDispatcher, AdapterRegistry, AdapterRegistryError } from "../src/index.js";
import type { StageAdapter } from "../src/index.js";
import { REF, cleanEpisodes, episodeDir, stage } from "./helpers.js";

afterEach(cleanEpisodes);

function adapter(over: Partial<StageAdapter> = {}): StageAdapter {
  return {
    id: "fake",
    summary: "fake",
    capability: "media.probe",
    provider: "test",
    produces: ["captions.srt"],
    consumes: [],
    requires: {},
    perform: async () => [],
    ...over,
  };
}

describe("AdapterRegistry refuses at construction", () => {
  it("an id that is not kebab-case", () => {
    expect(() => new AdapterRegistry([adapter({ id: "Not Kebab" })])).toThrow(AdapterRegistryError);
  });

  it("an id registered twice", () => {
    expect(() => new AdapterRegistry([adapter(), adapter({ produces: ["other.json"] })]))
      .toThrow(/registered twice/);
  });

  it("a capability the contracts vocabulary does not know", () => {
    expect(() => new AdapterRegistry([adapter({ capability: "llm" })])).toThrow(/vocabulary/);
  });

  it("an adapter that produces nothing", () => {
    expect(() => new AdapterRegistry([adapter({ produces: [] })])).toThrow(/no output contract/);
  });

  it("two adapters nothing could choose between", () => {
    // Registration order would decide, which is a provider choice nobody made.
    expect(() => new AdapterRegistry([
      adapter({ id: "first" }),
      adapter({ id: "second", provider: "elsewhere", consumes: ["narration-manifest.json"] }),
    ])).toThrow(/nothing could choose/);
  });
});

describe("AdapterRegistry.match", () => {
  const probe = adapter({ id: "probe", consumes: ["narration-manifest.json"] });
  const derive = adapter({ id: "derive", capability: null, produces: ["timing.json"] });
  const registry = new AdapterRegistry([probe, derive]);

  it("matches a capability stage by its capability and its outputs, not its id", () => {
    const subtitles = stage({
      id: "subtitles", capability: "media.probe",
      produces: ["captions.srt"], consumes: ["narration-manifest.json"],
    });
    expect(registry.match(subtitles)?.id).toBe("probe");
  });

  it("does not match a stage merely because its id is one an adapter once had", () => {
    expect(registry.match(stage({ id: "captions", produces: ["notes.md"] }))).toBeUndefined();
  });

  it("requires exactly the adapter's outputs, not a superset or a subset", () => {
    const base = { capability: "media.probe", consumes: ["narration-manifest.json"] };
    expect(registry.match(stage({ ...base, produces: ["captions.srt", "extra.json"] }))).toBeUndefined();
    expect(registry.match(stage({ ...base, produces: [] }))).toBeUndefined();
  });

  it("requires the stage to declare every input the adapter reads", () => {
    // Otherwise the adapter could run before what it reads exists, and the DAG
    // would never know it had a dependency.
    expect(registry.match(stage({ capability: "media.probe", produces: ["captions.srt"] }))).toBeUndefined();
  });

  it("never lets a derivation stand in for a capability the stage requested", () => {
    expect(registry.match(stage({ capability: "media.probe", produces: ["timing.json"] }))).toBeUndefined();
  });

  it("never lets a capability adapter perform an editorial stage", () => {
    expect(registry.match(stage({ produces: ["captions.srt"], consumes: ["narration-manifest.json"] })))
      .toBeUndefined();
  });

  it("does not match a capability stage that requests a different capability", () => {
    expect(registry.match(stage({
      capability: "image.generate", produces: ["captions.srt"], consumes: ["narration-manifest.json"],
    }))).toBeUndefined();
  });

  it("ignores stage ids entirely, including ones that are Object.prototype keys", () => {
    // The gateway's id table answered `true` for "toString" while handing back
    // a prototype method. Nothing here is keyed by id.
    for (const id of ["toString", "constructor", "__proto__"]) {
      expect(registry.match(stage({ id, produces: ["notes.md"] }))).toBeUndefined();
    }
  });
});

describe("AdapterDispatcher", () => {
  it("performs the matched adapter and returns what it wrote", async () => {
    const dir = await episodeDir();
    const writes = adapter({
      capability: null, produces: ["timing.json"],
      perform: async (ctx) => {
        const file = join(ctx.episodeDir, "artifacts", "timing.json");
        await writeFile(file, "{}");
        return [file];
      },
    });
    const dispatcher = new AdapterDispatcher(new AdapterRegistry([writes]));
    const timing = stage({ id: "timing", produces: ["timing.json"] });

    expect(dispatcher.canDispatch(timing)).toBe(true);
    const outputs = await dispatcher.dispatch(timing, { episodeDir: dir, ref: REF, attemptNumber: 1, log: () => {} });
    expect(await readFile(outputs[0]!, "utf-8")).toBe("{}");
  });

  it("agrees with itself: a stage it cannot dispatch throws rather than running something", async () => {
    const dir = await episodeDir();
    const dispatcher = new AdapterDispatcher(new AdapterRegistry([adapter()]));
    const unmatched = stage({ id: "toString", produces: ["notes.md"] });

    expect(dispatcher.canDispatch(unmatched)).toBe(false);
    await expect(dispatcher.dispatch(unmatched, { episodeDir: dir, ref: REF, attemptNumber: 1, log: () => {} }))
      .rejects.toThrow(/No adapter performs stage "toString"/);
  });
});
