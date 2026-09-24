import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import { buildGateReview, hashArtifacts, REVIEW_EVENT_FOR } from "@studio/contracts/src/gate-review.mjs";
import { signReceipt, planHashOf } from "@studio/contracts/src/receipt.mjs";
import { JournalReviewGate, REVIEW_SATISFIED_BY } from "../../../src/execution/journal-review-gate.js";
import type { ResolvedStage } from "../../../src/pipeline/types.js";

// ---------------------------------------------------------------------------
// The review gate, read from the journal (avg-qr4.3)
// ---------------------------------------------------------------------------
// Replaces the gateway's GatewayReviewGate tests (studio/gateway/test/runtime/
// dispatcher.test.ts), which moved here with the gate. Receipts are written
// the way ExecutionService.review() writes them: actor "runtime", a binding
// whose planHash is planHashOf(stage.definition), and a signature exactly
// when the origin is human.
// ---------------------------------------------------------------------------

const KEY = "test-operator-key";
const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "journal-review-gate-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "journal"), { recursive: true });
  await writeFile(join(dir, "artifacts", "s.md"), "reviewed bytes");
  return dir;
}

/** The shape the pipeline resolver produces (see helpers/review-chain.ts's `gated`). */
function stageAt(level: string): ResolvedStage {
  return {
    definition: {
      id: "s", name: "S", type: "editorial", capabilities: [], dependsOn: ["upstream"],
      produces: [{ kind: "document", label: "s.md" }], consumes: [{ kind: "document", label: "upstream.md" }],
      gates: { autopilot: true, review: level, retryOnFailure: 0 },
    },
    source: "test", topoIndex: 1,
  };
}

type Origin = "human" | "agent" | "policy";

async function record(
  dir: string,
  stage: ResolvedStage,
  { decision = "approved", origin, sign = origin === "human", note, at, type }:
    { decision?: "requested" | "approved" | "rejected"; origin: Origin; sign?: boolean; note?: string;
      at?: string; type?: string },
) {
  const outputs = await hashArtifacts(dir, ["artifacts/s.md"]);
  let data: Record<string, unknown> = buildGateReview({
    stageId: "s", decision, origin, actor: "runtime",
    binding: { planHash: planHashOf(stage.definition), outputs },
    ...(note !== undefined ? { note } : {}),
    ...(at !== undefined ? { at } : {}),
  }) as unknown as Record<string, unknown>;
  if (sign) data = signReceipt(data, KEY);
  const written = await appendJournalEvent(dir, {
    type: (type ?? REVIEW_EVENT_FOR[decision]) as never, actor: "runtime", episode: REF, data,
  });
  expect(written).toBeTruthy();
  return data;
}

describe("JournalReviewGate", () => {
  it("approves a signed human grant on a human gate", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "human" });
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stage)).toEqual({ state: "approved" });
  });

  it("does not let an agent's grant satisfy a human gate", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "agent" });
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/requires human review/);
  });

  it("lets an agent's grant satisfy a skill gate", async () => {
    const dir = await episode();
    const stage = stageAt("skill");
    await record(dir, stage, { origin: "agent" });
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stage)).toEqual({ state: "approved" });
  });

  it("lets an agent's grant satisfy a human-or-skill gate", async () => {
    const dir = await episode();
    const stage = stageAt("human-or-skill");
    await record(dir, stage, { origin: "agent" });
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stage)).toEqual({ state: "approved" });
  });

  it("does not let a policy grant satisfy a human gate", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "policy" });
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/requires human review/);
  });

  it("fails closed on a level nothing is mapped to, such as auto", async () => {
    // Controller ruling: `auto` is in the manifest enum but no origin
    // satisfies it yet. An unlisted level must not read as "anything goes".
    expect(REVIEW_SATISFIED_BY.auto).toBeUndefined();
    const dir = await episode();
    const stage = stageAt("auto");
    await record(dir, stage, { origin: "agent" });
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/requires auto review/);
  });

  it("lets any valid approval stand for a stage that declares no review", async () => {
    // No record at all lets a `review: none` stage's dependents run; a
    // current approval of one must not block them.
    const dir = await episode();
    const stage = stageAt("none");
    await record(dir, stage, { origin: "agent" });
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stage)).toEqual({ state: "approved" });
  });

  it("reads an unsigned human grant as outstanding: unsigned", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "human", sign: false });
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/unsigned/);
  });

  it("does not read the operator's signed rejection, re-typed as a grant, as an approval", async () => {
    // The event type is not signed; the decision inside it is.
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "human", decision: "rejected", note: "too dark", type: "approval-granted" });
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/disagrees with the recorded decision/);
  });

  it("does not let a re-appended, superseded approval undo a later rejection", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    const approval = await record(dir, stage, { origin: "human", at: "2026-09-24T10:00:00.000Z" });
    await record(dir, stage, { origin: "human", decision: "rejected", note: "too dark", at: "2026-09-24T11:00:00.000Z" });
    // The approval line copied byte for byte to the end of the journal.
    await appendJournalEvent(dir, { type: "approval-granted", actor: "runtime", episode: REF, data: approval } as never);
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/superseded by a later decision/);

    // And the operator's next real decision governs again.
    await record(dir, stage, { origin: "human", at: "2026-09-24T12:00:00.000Z" });
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stage)).toEqual({ state: "approved" });
  });

  it("does not let a far-future-dated unsigned line lock the stage away from its operator", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "agent", decision: "requested", at: "2099-01-01T00:00:00.000Z" });
    await record(dir, stage, { origin: "human" });
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stage)).toEqual({ state: "approved" });
  });

  it("lets a later approval supersede an earlier rejection", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "human", decision: "rejected", note: "too dark", at: "2026-09-24T10:00:00.000Z" });
    await record(dir, stage, { origin: "human", at: "2026-09-24T11:00:00.000Z" });
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stage)).toEqual({ state: "approved" });
  });

  it("reads a signed rejection as outstanding, with its note", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "human", decision: "rejected", note: "too dark" });
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/rejected: too dark/);
  });

  it("reports a requested review as outstanding", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "agent", decision: "requested" });
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/awaiting review/);
  });

  it("reports an episode with no journal at all as no-record", async () => {
    const dir = await episode();
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stageAt("human"))).toEqual({ state: "no-record" });
  });

  it("reports a journal holding no review of the stage as no-record, not as accepted", async () => {
    // The third state, and the reason there is one: "not outstanding" here
    // made the service skip its own manifest rule, so an injected gate was
    // strictly weaker than injecting none.
    const dir = await episode();
    const outputs = await hashArtifacts(dir, ["artifacts/s.md"]);
    await appendJournalEvent(dir, { type: "approval-granted", actor: "runtime", episode: REF,
      data: buildGateReview({ stageId: "another", decision: "approved", origin: "agent", actor: "runtime",
        binding: { planHash: "0".repeat(64), outputs } }) } as never);
    expect(await new JournalReviewGate(KEY).isOutstanding("s", dir, stageAt("human"))).toEqual({ state: "no-record" });
  });

  it("treats an unreadable journal as outstanding rather than guessing", async () => {
    const dir = await episode();
    await appendFile(join(dir, "journal", "events.jsonl"), "{ truncated mid-wri\n", "utf-8");
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stageAt("human"));
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/cannot be read/);
  });

  it("cannot verify a signed human grant without the operator key", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "human" });
    const verdict = await new JournalReviewGate(null).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/cannot be verified/);
  });

  it("refuses to judge a stage it was not given the definition of", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "human" });
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/definition/);
  });

  it("invalidates a grant made against a different stage definition", async () => {
    const dir = await episode();
    await record(dir, stageAt("skill"), { origin: "human" });
    // Same stage id, the review level tightened since: a different plan.
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stageAt("human"));
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/stage definition changed/);
  });

  it("invalidates a grant whose reviewed artifact changed", async () => {
    const dir = await episode();
    const stage = stageAt("human");
    await record(dir, stage, { origin: "human" });
    await writeFile(join(dir, "artifacts", "s.md"), "re-rendered bytes");
    const verdict = await new JournalReviewGate(KEY).isOutstanding("s", dir, stage);
    expect(verdict.state).toBe("outstanding");
    expect(verdict.reason).toMatch(/changed since it was approved/);
  });
});
