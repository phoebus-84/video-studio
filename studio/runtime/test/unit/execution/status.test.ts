import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionService } from "../../../src/execution/service.js";

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
});
