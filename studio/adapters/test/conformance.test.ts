// What CI checks about the studio's adapters against the pipelines that ship.
// A new adapter that matches no built-in stage, or a manifest change that
// orphans one, fails here rather than as a stage that silently stops running.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STUDIO_ADAPTERS, createStudioDispatcher, createStudioRegistry } from "../src/index.js";
import { BUILTIN_NAMES, builtin, stageOf } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("the studio's adapters against the built-in pipelines", () => {
  it("registers without ambiguity", () => {
    expect(() => createStudioRegistry()).not.toThrow();
  });

  it("performs every adapter on at least one built-in stage", async () => {
    const registry = createStudioRegistry();
    const used = new Set<string>();
    for (const name of BUILTIN_NAMES) {
      for (const resolved of (await builtin(name)).stages) {
        const match = registry.match(resolved);
        if (match) used.add(match.id);
      }
    }
    expect([...used].sort()).toEqual(STUDIO_ADAPTERS.map((adapter) => adapter.id).sort());
  });

  it("performs, in the default pipeline, exactly the four stages the gateway used to", async () => {
    // Moving the work out of the gateway must not change what runs. These four
    // were the gateway's id table; matching by contract finds the same four.
    const pipeline = await builtin("narrated-illustrated-video");
    const dispatcher = createStudioDispatcher();
    const performed = pipeline.stages
      .filter((resolved) => dispatcher.canDispatch(resolved))
      .map((resolved) => resolved.definition.id);
    expect(performed.sort()).toEqual(["captions", "illustrations", "qa", "timing"]);
  });

  it("performs no review stage — those are judgements, and nothing here can make one", async () => {
    // safety-review and continuity-check once had handlers that wrote the same
    // invented findings for every episode (avg-qr4.1).
    const pipeline = await builtin("fairy-tale-adaptation");
    const dispatcher = createStudioDispatcher();
    for (const id of ["safety-review", "continuity-check"]) {
      expect(dispatcher.canDispatch(stageOf(pipeline, id))).toBe(false);
    }
  });

  it("serves only capabilities its stages actually request", async () => {
    const registry = createStudioRegistry();
    for (const name of BUILTIN_NAMES) {
      for (const resolved of (await builtin(name)).stages) {
        const match = registry.match(resolved);
        if (!match) continue;
        const requested = resolved.definition.capabilities.map((request) => request.capability);
        expect(requested).toEqual(match.capability === null ? [] : [match.capability]);
      }
    }
  });
});

describe("fabricated reviews", () => {
  function* sources(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) yield* sources(full);
      else if (full.endsWith(".ts")) yield full;
    }
  }

  it("keeps the fabricated report in fixtures only", () => {
    const fixture = readFileSync(join(here, "fixtures/fabricated-safety-report.json"), "utf-8");
    expect(fixture).toContain("Wolf eating characters");

    for (const file of sources(join(here, "../src"))) {
      const source = readFileSync(file, "utf-8");
      expect(source, file).not.toContain("Wolf eating characters");
      expect(source, file).not.toContain("Consistent lighting direction");
    }
  });
});
