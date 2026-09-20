import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildGateReview, hashArtifacts } from "@studio/contracts/src/gate-review.mjs";
import { GatewayDispatcher } from "../../src/runtime/dispatcher.js";
import { GatewayReviewGate } from "../../src/runtime/review-gate.js";

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

describe("GatewayReviewGate", () => {
  /** Append a gate-review journal event the way requestReview did. */
  async function requested(dir: string, stageId: string) {
    const event = {
      apiVersion: "studio.video/v1alpha1", kind: "JournalEvent",
      id: `evt_${"0".repeat(26)}`, episodeRef: REF, at: new Date().toISOString(),
      actor: "gateway", type: "approval-requested",
      data: { stageId, decision: "requested", actor: "gateway", at: new Date().toISOString(),
              inputs: [], outputs: [], checks: [] },
    };
    await appendFile(join(dir, "journal", "events.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
  }

  /** Append an approval-granted event carrying a real gate-review record. */
  async function granted(dir: string, review: Record<string, unknown>) {
    const event = {
      apiVersion: "studio.video/v1alpha1", kind: "JournalEvent",
      id: `evt_${"1".repeat(26)}`, episodeRef: REF, at: new Date().toISOString(),
      actor: "human", type: "approval-granted", data: review,
    };
    await appendFile(join(dir, "journal", "events.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
  }

  it("reports a requested review as outstanding", async () => {
    const { dir } = await episode();
    await requested(dir, "illustrations");

    const verdict = await new GatewayReviewGate().isOutstanding("illustrations", dir);

    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/review/i);
  });

  it("reports a current, hash-bound approval as approved", async () => {
    const { dir } = await episode();
    const relative = join("artifacts", "frames", "s1.png");
    await mkdir(dirname(join(dir, relative)), { recursive: true });
    await writeFile(join(dir, relative), "bytes");
    await granted(dir, buildGateReview({
      stageId: "illustrations",
      decision: "approved",
      actor: "human",
      outputs: await hashArtifacts(dir, [relative]),
    }));

    const verdict = await new GatewayReviewGate().isOutstanding("illustrations", dir);

    expect(verdict.state).toBe("approved");
  });

  it("reports a stage with no review record as no-record, not as accepted", async () => {
    // The third state, and the reason there is one. Saying "not outstanding"
    // here made the service skip its own manifest rule, so an injected gate
    // was strictly weaker than injecting none.
    const { dir } = await episode();
    const verdict = await new GatewayReviewGate().isOutstanding("illustrations", dir);
    expect(verdict.state).toBe("no-record");
  });

  it("reports an episode with no journal at all as no-record", async () => {
    const { dir } = await episode();
    await rm(join(dir, "journal", "events.jsonl"), { force: true });

    const verdict = await new GatewayReviewGate().isOutstanding("illustrations", dir);

    expect(verdict.state).toBe("no-record");
  });

  it("treats an unreadable journal as outstanding rather than guessing", async () => {
    // Failing closed: not knowing whether a review happened is not the same as
    // knowing it did. Unchanged by the tri-state — a journal that exists and
    // cannot be read is evidence of a problem, not an absence of one.
    const { dir } = await episode();
    await appendFile(join(dir, "journal", "events.jsonl"), "{ truncated mid-wri\n", "utf-8");

    const verdict = await new GatewayReviewGate().isOutstanding("illustrations", dir);

    expect(verdict.state).toBe("outstanding");
  });
});
