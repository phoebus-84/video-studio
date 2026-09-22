import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "exec-status-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "journal"), { recursive: true });
  await mkdir(join(dir, "artifacts"), { recursive: true });
  return { root, dir };
}

/** Append a raw journal line, as the writer would have produced it. */
async function journalLine(dir: string, type: string, data: Record<string, unknown>) {
  const event = {
    apiVersion: "studio.video/v1alpha1",
    kind: "JournalEvent",
    id: `evt_${"0".repeat(26)}`,
    episodeRef: REF,
    at: new Date().toISOString(),
    actor: "runtime",
    type,
    data,
  };
  await appendFile(join(dir, "journal", "events.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
}

function service(root: string) {
  return new ExecutionService({ libraryRoot: root, builtinPipelines: PIPELINES });
}

/** Spends nothing and refuses nothing — these tests are not about budget. */
const permissiveBudget = { maySpend: async () => ok({ reserveId: "r", estimatedCost: 0 }) };

describe("ExecutionService.status", () => {
  it("reports every declared stage as pending for an untouched episode", async () => {
    const { root } = await episode();

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stages.length).toBeGreaterThan(0);
    expect(result.value.stages.every((s) => s.status === "pending")).toBe(true);
  });

  it("does not infer completion from output files that exist", async () => {
    // This is the defect cmdStatus has today: it decides a stage is done by
    // looking for its outputs on disk. A file nobody recorded producing is not
    // evidence that a stage ran.
    const { root, dir } = await episode();
    await writeFile(join(dir, "artifacts", "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nhi\n");

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const captions = result.value.stages.find((s) => s.stageId === "captions");
    expect(captions!.status).toBe("pending");
  });

  it("reports what the journal records, including the holder of a live lease", async () => {
    const { root, dir } = await episode();
    await journalLine(dir, "stage-leased", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1,
      ttlMs: 300000, expiresAt: "2999-01-01T00:00:00Z", holder: "gateway/pid-7",
    });
    await journalLine(dir, "stage-started", { stageId: "brief", leaseId: "L1", attemptNumber: 1 });

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brief = result.value.stages.find((s) => s.stageId === "brief");
    expect(brief!.status).toBe("running");
    expect(brief!.lease.state).toBe("live");
    expect(brief!.lease.holder).toBe("gateway/pid-7");
  });

  it("fails rather than guessing when the pipeline cannot be resolved", async () => {
    const { root } = await episode();

    const result = await service(root).status(REF, "no-such-pipeline");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PIPELINE_UNRESOLVED");
  });

  it("surfaces a corrupt journal instead of silently skipping the line", async () => {
    const { root, dir } = await episode();
    await journalLine(dir, "stage-leased", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1,
      ttlMs: 300000, expiresAt: "2999-01-01T00:00:00Z", holder: "h",
    });
    await appendFile(join(dir, "journal", "events.jsonl"), "{ truncated mid-wri\n", "utf-8");

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("JOURNAL_UNREADABLE");
  });

  it("distinguishes a journal that disagrees with the pipeline from one that is corrupt", async () => {
    // Every line here is valid JSON — parseJournal has nothing to object to.
    // The problem is one level up: the event names a stage this pipeline does
    // not declare, which means the pipeline definition changed under a
    // running episode, not that the file is damaged. That calls for a
    // different code than a truncated line, so a caller can tell "repair the
    // file" apart from "the pipeline changed".
    const { root, dir } = await episode();
    await journalLine(dir, "stage-leased", {
      stageId: "no-such-stage", leaseId: "L1", attemptNumber: 1,
      ttlMs: 300000, expiresAt: "2999-01-01T00:00:00Z", holder: "h",
    });

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REPLAY_INVALID");
  });

  it("fails rather than reporting a new episode when the journal cannot be read", async () => {
    // A directory sitting where the journal file should be makes `readFile`
    // reject with EISDIR, not ENOENT. Only ENOENT means "no journal yet, this
    // is a new episode" — anything else is a real failure and must not be
    // reported as "everything pending", which would be file-existence
    // inference in reverse: absence of a readable file taken as affirmative
    // evidence about state.
    const { root, dir } = await episode();
    await mkdir(join(dir, "journal", "events.jsonl"));

    const result = await service(root).status(REF, "narrated-illustrated-video");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("JOURNAL_UNREADABLE");
  });

  it("reports an attempt whose start was never recorded", async () => {
    // The gap is evidence that a write was lost on this machine. Leaving it
    // visible only to replay would be recording it nowhere a human looks.
    const { root, dir } = await episode();
    // stage-leased then straight to stage-completed: the stage-started write
    // was lost. Before Task 1 this journal made the episode permanently
    // underivable; now it derives, and the hole has to be visible.
    await journalLine(dir, "stage-leased", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1,
      ttlMs: 300000, expiresAt: "2999-01-01T00:00:00Z", holder: "runtime/pid-7",
    });
    await journalLine(dir, "stage-completed", {
      stageId: "brief", leaseId: "L1", attemptNumber: 1, outputs: ["artifacts/brief.md"],
    });

    const result = await service(root).status(REF, "narrated-illustrated-video");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const brief = result.value.stages.find((s) => s.stageId === "brief")!;
    expect(brief.status).toBe("completed");
    expect(brief.gaps).toEqual(["attempt 1 has no recorded start"]);

    // Absent, not empty, on a stage with nothing to report.
    const script = result.value.stages.find((s) => s.stageId === "script")!;
    expect("gaps" in script).toBe(false);
  });
});

describe("status agrees with what run will do", () => {
  it("does not call a stage runnable when its dependency's review is outstanding", async () => {
    // The disagreement this fixes: `dependenciesMet` tested only for
    // `completed`, while the dependency check inside a run also consults the
    // review gate. Status said ready; run said blocked.
    const { root, dir } = await episode();
    const pipelineDir = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: pipelineDir,
      budget: permissiveBudget,
      review: { isOutstanding: async (id) =>
        id === "gated" ? { state: "outstanding", reason: "is awaiting review" } : { state: "no-record" } },
    });

    await svc.claim(REF, "review-chain");
    await writeFile(join(dir, "artifacts/upstream.md"), "x");
    await svc.complete(REF, "review-chain", "upstream", { outputs: ["artifacts/upstream.md"] });
    await svc.claim(REF, "review-chain", { stage: "gated" });
    await writeFile(join(dir, "artifacts/gated.md"), "x");
    await svc.complete(REF, "review-chain", "gated", { outputs: ["artifacts/gated.md"] });

    const status = await svc.status(REF, "review-chain");
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const downstream = status.value.stages.find((s) => s.stageId === "downstream")!;
    expect(downstream.state).toBe("blocked");
    // The INJECTED gate's own reason, not merely something containing
    // "gated". The manifest fallback (`"gated" declares human review and no
    // accepted review is recorded…`) also names the stage, so a `whyBlocked`
    // that ignored the injected gate and fell through to the manifest would
    // satisfy a /gated/ match — and whether `status` consults the injected
    // gate is the one property this test exists to establish.
    expect(downstream.stateReason).toMatch(/is awaiting review/);

    // And run agrees.
    const attempt = await svc.claim(REF, "review-chain", { stage: "downstream" });
    expect(attempt.ok && attempt.value.status).toBe("blocked");
  });

  it("calls a stage runnable when it genuinely is", async () => {
    const { root, dir } = await episode();
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: PIPELINES, budget: permissiveBudget,
    });

    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    expect(status.value.stages.find((s) => s.stageId === "brief")!.state).toBe("runnable");
    expect(status.value.stages.find((s) => s.stageId === "art-direction")!.state).toBe("pending");

    // `script` declares autopilot: false — but on a fresh episode that is not
    // what stops it. Its dependency has not completed, so it reports
    // `pending` on the unmet-dependency branch and the attendance check is
    // never reached. Complete `brief` so attendance is the branch under test.
    await svc.claim(REF, "narrated-illustrated-video", { stage: "brief" });
    await writeFile(join(dir, "artifacts/brief.md"), "a real brief");
    await svc.complete(REF, "narrated-illustrated-video", "brief", {
      outputs: ["artifacts/brief.md"],
    });

    const after = await svc.status(REF, "narrated-illustrated-video");
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    const script = after.value.stages.find((s) => s.stageId === "script")!;
    expect(script.dependenciesMet).toBe(true);
    expect(script.state).toBe("blocked");
    expect(script.stateReason).toMatch(/autopilot: false/);
  });

  it("reports a completed stage that declares a review as awaiting_review", async () => {
    const { root, dir } = await episode();
    const pipelineDir = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root, builtinPipelines: pipelineDir, budget: permissiveBudget,
    });

    await svc.claim(REF, "review-chain");
    await writeFile(join(dir, "artifacts/upstream.md"), "x");
    await svc.complete(REF, "review-chain", "upstream", { outputs: ["artifacts/upstream.md"] });
    await svc.claim(REF, "review-chain", { stage: "gated" });
    await writeFile(join(dir, "artifacts/gated.md"), "x");
    await svc.complete(REF, "review-chain", "gated", { outputs: ["artifacts/gated.md"] });

    const status = await svc.status(REF, "review-chain");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.stages.find((s) => s.stageId === "gated")!.state).toBe("awaiting_review");
  });

  it("reports the manifest's declared dependencies and produced labels", async () => {
    // `produces` is the manifest's declaration and `outputArtifacts` is the
    // journal's record. A consumer mapping a file back to the stage that
    // makes it needs the former, and a stage that has never run has no latter.
    const { root } = await episode();
    const status = await service(root).status(REF, "narrated-illustrated-video");

    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const captions = status.value.stages.find((s) => s.stageId === "captions")!;
    expect(captions.dependsOn).toEqual(["narration"]);
    expect(captions.produces).toEqual(["captions.srt"]);
    expect(captions.outputArtifacts).toEqual([]);
  });

  it("reports a stage blocked for want of a budget guard, in the same words a claim uses", async () => {
    // The budget guard's PRESENCE is a claim gate, so `status` applies it
    // too — otherwise a composition that configured no guard is told
    // `runnable` and refused the moment it claims. Its VERDICT is a
    // different matter: asking for one means `maySpend`, which mints a
    // reservation nothing releases, and a polled endpoint must not do that.
    const { root } = await episode();
    const svc = new ExecutionService({ libraryRoot: root, builtinPipelines: PIPELINES });

    const status = await svc.status(REF, "narrated-illustrated-video");
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const brief = status.value.stages.find((s) => s.stageId === "brief")!;
    expect(brief.state).toBe("blocked");
    expect(brief.stateReason).toMatch(/no budget guard is configured/);

    const attempt = await svc.claim(REF, "narrated-illustrated-video", { stage: "brief" });
    expect(attempt.ok && attempt.value.status).toBe("blocked");
    expect(attempt.ok && attempt.value.reason).toBe(brief.stateReason);
  });

  it("asks the review gate once per dependency, however many stages depend on it", async () => {
    // `GatewayReviewGate.isOutstanding` re-reads the whole journal and
    // sha256s every artifact the review covered — the narration wav and the
    // final mp4 among them. `status` is what the CLI and the studio poll, so
    // a fan-in of eight behind one reviewed stage must not be eight of those.
    const { root, dir } = await episode();
    const pipelineDir = await reviewChainPipeline(roots, 7);
    const asked: string[] = [];
    const svc = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: pipelineDir,
      budget: permissiveBudget,
      review: {
        isOutstanding: async (id) => {
          asked.push(id);
          return { state: "no-record" };
        },
      },
    });

    await svc.claim(REF, "review-chain");
    await writeFile(join(dir, "artifacts/upstream.md"), "x");
    await svc.complete(REF, "review-chain", "upstream", { outputs: ["artifacts/upstream.md"] });
    await svc.claim(REF, "review-chain", { stage: "gated" });
    await writeFile(join(dir, "artifacts/gated.md"), "x");
    await svc.complete(REF, "review-chain", "gated", { outputs: ["artifacts/gated.md"] });

    asked.length = 0;
    const status = await svc.status(REF, "review-chain");
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    // Eight stages depend on `gated` and every one of them is judged.
    const dependents = status.value.stages.filter((s) => s.dependsOn.includes("gated"));
    expect(dependents).toHaveLength(8);
    expect(dependents.every((s) => s.state === "blocked")).toBe(true);
    // One question, not eight.
    expect(asked.filter((id) => id === "gated")).toHaveLength(1);
  });

  it("refuses rather than rejecting when the review gate throws", async () => {
    // Every other failure in `status` is a typed Result.err. A gate that
    // throws instead of returning a verdict used to escape as an unhandled
    // rejection, which on the read-only path a CLI polls is materially worse
    // than a stage reported blocked with the reason named.
    const { root, dir } = await episode();
    const pipelineDir = await reviewChainPipeline(roots);
    const svc = new ExecutionService({
      libraryRoot: root,
      builtinPipelines: pipelineDir,
      budget: permissiveBudget,
      // Throws only about `gated`, so the two setup claims below — which ask
      // about `upstream` — still go through. `claimInternal` propagating a
      // throwing gate is pre-existing and out of scope here; `status` is the
      // path under test.
      review: {
        isOutstanding: async (id) => {
          if (id === "gated") throw new Error("gate exploded");
          return { state: "no-record" };
        },
      },
    });

    await svc.claim(REF, "review-chain");
    await writeFile(join(dir, "artifacts/upstream.md"), "x");
    await svc.complete(REF, "review-chain", "upstream", { outputs: ["artifacts/upstream.md"] });
    await svc.claim(REF, "review-chain", { stage: "gated" });
    await writeFile(join(dir, "artifacts/gated.md"), "x");
    await svc.complete(REF, "review-chain", "gated", { outputs: ["artifacts/gated.md"] });

    const status = await svc.status(REF, "review-chain");
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const downstream = status.value.stages.find((s) => s.stageId === "downstream")!;
    expect(downstream.state).toBe("blocked");
    expect(downstream.stateReason).toMatch(/gate exploded/);
  });
});
