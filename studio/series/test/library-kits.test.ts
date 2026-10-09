// A release's library kits (avg-d1x): a timeline may draw with a kit the
// release pins, handed in `input.kits`, and is held to its props like any
// application kit; without it, the kit is unknown.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { compileSpec, resolveCompiler, type CompileInput, type LoadedLibraryKit } from "../src/index.js";

const load = (): CompileInput => JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "poetry-short", "1.0.0", "input.json"), "utf-8"));
const card: LoadedLibraryKit = {
  name: "sample-card", version: "1.0.0", file: "/library/sample/kits/sample-card/1.0.0/kit.cjs", hash: `sha256:${"b".repeat(64)}`,
  kit: { name: "sample-card", version: "1.0.0", description: "a card", props: z.object({ text: z.string() }).strict(), component: () => null, examples: [] },
};

/** poetry-short's own compile, plus one item of the library card: a release that draws with its channel's kit. */
function withCard(props: Record<string, unknown>): CompileInput {
  const input = load();
  const registered = resolveCompiler("poetry-short", "1.0.0")!;
  input.template = { ...input.template, compiler: { ...input.template.compiler, bundle: { path: "compiler/compiler.cjs", hash: card.hash } } };
  input.code = {
    compiler: {
      ...registered,
      compile: (i) => {
        const result = registered.compile(i);
        if (!result.ok) return result;
        result.timeline.tracks.push({ id: "library", type: "visual", z: 99, items: [{ id: "card", from: 0, duration: 10, kit: { name: "sample-card", version: "1.0.0" }, props }] } as never);
        return result;
      },
    },
  };
  return input;
}

test("a timeline draws with a library kit the release hands in, held to its props", () => {
  const withKit = withCard({ text: "from the channel" });
  withKit.kits = [card];
  const ok = compileSpec(withKit);
  assert.ok(ok.ok, JSON.stringify(!ok.ok && ok.problems));

  const bad = withCard({ text: 3 });
  bad.kits = [card];
  const refused = compileSpec(bad);
  assert.deepEqual(!refused.ok && refused.problems.map((p) => p.code), ["timeline:bad-props"]);
});

test("without the release's library kits the kit is unknown", () => {
  const result = compileSpec(withCard({ text: "x" }));
  assert.deepEqual(!result.ok && result.problems.map((p) => p.code), ["timeline:unknown-kit"]);
});
