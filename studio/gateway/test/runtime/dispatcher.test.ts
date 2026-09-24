import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayDispatcher } from "../../src/runtime/dispatcher.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "gw-dispatch-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  await mkdir(join(dir, "journal"), { recursive: true });
  return { root, dir };
}

/** A minimal ResolvedStage, which is all the dispatcher reads. */
const stageNamed = (id: string) =>
  ({ definition: { id, name: id, dependsOn: [], gates: { autopilot: true, review: "none", retryOnFailure: 0 } },
     source: "test", topoIndex: 0 }) as never;

const ctx = (dir: string) => ({ episodeDir: dir, ref: REF, attemptNumber: 1, log: () => {} });

describe("GatewayDispatcher", () => {
  it("performs a stage it has a handler for, and returns what it wrote", async () => {
    const { dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "image bytes");

    const outputs = await new GatewayDispatcher().dispatch(stageNamed("illustrations"), ctx(dir));

    expect(outputs.length).toBeGreaterThan(0);
    // The work really happened — assert the artifact, not the call.
    expect(await readFile(outputs[0]!, "utf-8")).toBe("image bytes");
  });

  it("says it does not handle a stage with no handler", () => {
    const dispatcher = new GatewayDispatcher();
    expect(dispatcher.canDispatch(stageNamed("safety-review"))).toBe(false);
    expect(dispatcher.canDispatch(stageNamed("continuity-check"))).toBe(false);
  });

  it("handles exactly the four stages the gateway still performs", () => {
    const dispatcher = new GatewayDispatcher();
    for (const id of ["illustrations", "captions", "timing", "qa"]) {
      expect(dispatcher.canDispatch(stageNamed(id))).toBe(true);
    }
  });
});

// The GatewayReviewGate tests moved with the gate to @studio/runtime's
// test/unit/execution/journal-review-gate.test.ts (avg-qr4.3).
