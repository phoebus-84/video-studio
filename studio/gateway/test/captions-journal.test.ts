import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemWorkspaceService } from "../src/workspace/filesystem-service.js";
import { srtSecondsOf } from "../src/workspace/filesystem-service.js";
import { appendJournalEvent } from "@studio/contracts/src/journal.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const CHANNEL = "video-storici";
const SERIES = "roma-pills";
const EPISODE = "giulio-cesare";
const REF = { channel: CHANNEL, series: SERIES, episode: EPISODE };

async function episode(): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), "gateway-cj-"));
  roots.push(root);
  const dir = join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  return { root, dir };
}

/** An SRT of `count` one-second cues, starting at zero. */
function srt(count: number): string {
  const stamp = (s: number) =>
    `00:00:${String(Math.floor(s)).padStart(2, "0")},${String(Math.round((s % 1) * 1000)).padStart(3, "0")}`;
  return Array.from({ length: count }, (_, i) =>
    `${i + 1}\n${stamp(i)} --> ${stamp(i + 1)}\nLine ${i + 1}\n`).join("\n");
}

describe("captions", () => {
  it("reads an SRT timestamp with either separator", () => {
    expect(srtSecondsOf("00:01:29,833")).toBeCloseTo(89.833, 3);
    expect(srtSecondsOf("00:01:29.833")).toBeCloseTo(89.833, 3);
    expect(srtSecondsOf("not a stamp")).toBeNull();
  });

  // The distribution was `Math.ceil(segments.length / 8) // assume 8 scenes`,
  // so an eleven-scene episode gave its first eight scenes five cues each and
  // scenes nine, ten and eleven none — indexing past the end of the list.
  it("gives every scene of an eleven-scene episode its captions", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "artifacts", "captions.srt"), srt(33));
    await writeFile(join(dir, "artifacts", "timing.json"), JSON.stringify({
      scenes: Array.from({ length: 11 }, (_, i) => ({
        sceneId: `s${i + 1}`, startSeconds: i * 3, durationSeconds: 3,
      })),
    }));
    for (let i = 1; i <= 11; i++) await writeFile(join(dir, "assets", "images", `s${i}.png`), "png");

    const detail = await new FileSystemWorkspaceService([root])
      .getEpisode(CHANNEL, SERIES, EPISODE) as any;

    expect(detail.scenes).toHaveLength(11);
    const withCaptions = detail.scenes.filter((s: any) => s.captions);
    expect(withCaptions).toHaveLength(11);
    // Three one-second cues fall inside each three-second scene.
    for (const scene of detail.scenes) expect(scene.captions.count).toBe(3);
  });

  it("gives each scene the cues that fall in its own window", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "artifacts", "captions.srt"), srt(4));
    await writeFile(join(dir, "artifacts", "timing.json"), JSON.stringify({
      scenes: [
        { sceneId: "s1", startSeconds: 0, durationSeconds: 1 },
        { sceneId: "s2", startSeconds: 1, durationSeconds: 3 },
      ],
    }));
    await writeFile(join(dir, "assets", "images", "s1.png"), "png");
    await writeFile(join(dir, "assets", "images", "s2.png"), "png");

    const detail = await new FileSystemWorkspaceService([root])
      .getEpisode(CHANNEL, SERIES, EPISODE) as any;

    expect(detail.scenes[0].captions.segments.map((c: any) => c.text)).toEqual(["Line 1"]);
    expect(detail.scenes[1].captions.segments.map((c: any) => c.text))
      .toEqual(["Line 2", "Line 3", "Line 4"]);
  });

  it("shows the whole transcript when the episode has no timing to match against", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "artifacts", "captions.srt"), srt(3));
    await writeFile(join(dir, "assets", "images", "s1.png"), "png");

    const detail = await new FileSystemWorkspaceService([root])
      .getEpisode(CHANNEL, SERIES, EPISODE) as any;

    // Better than nothing: the scene has no window, so the cues cannot be
    // placed, and showing them unplaced beats showing an empty panel.
    expect(detail.scenes[0].captions.count).toBe(3);
  });
});

describe("the journal", () => {
  // Execution events carry leaseId and attemptNumber, and buildJournalEvent
  // now rejects one that does not: replay identifies an attempt by its lease,
  // so an event without one cannot be placed in the history. The gateway does
  // not write these — it takes no leases — but the execution service will, and
  // these are the read-path tests for what it writes. Writing them here the
  // way the gateway used to (`{ stageId }` alone) would now record nothing at
  // all, and the assertions would fail on an empty journal.
  const startedData = (stageId: string, leaseId: string) =>
    ({ stageId, leaseId, attemptNumber: 1 });
  const completedData = (stageId: string, leaseId: string) =>
    ({ stageId, leaseId, attemptNumber: 1, outputs: [`artifacts/${stageId}.txt`] });

  it("reads the events the execution service wrote", async () => {
    const { root, dir } = await episode();
    await appendJournalEvent(dir, { type: "stage-started", actor: "runtime", episode: REF, data: startedData("narration", "L1") });
    await appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: REF, data: completedData("narration", "L1") });
    await appendJournalEvent(dir, { type: "approval-granted", actor: "human", episode: REF, stageId: "qa" });

    const events = await new FileSystemWorkspaceService([root]).findEvents(REF, {});
    expect(events.map((e) => e.type)).toEqual([
      "stage-started", "stage-completed", "approval-granted",
    ]);
  });

  it("filters by type and limits to the most recent", async () => {
    const { root, dir } = await episode();
    for (const stageId of ["a", "b", "c"]) {
      await appendJournalEvent(dir, { type: "stage-started", actor: "runtime", episode: REF, data: startedData(stageId, `L-${stageId}`) });
      await appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: REF, data: completedData(stageId, `L-${stageId}`) });
    }
    const service = new FileSystemWorkspaceService([root]);

    const started = await service.findEvents(REF, { type: "stage-started" });
    expect(started).toHaveLength(3);
    const recent = await service.findEvents(REF, { limit: 2 });
    expect(recent.map((e) => (e.data as { stageId: string }).stageId)).toEqual(["c", "c"]);
  });

  it("survives a corrupt line rather than losing the journal", async () => {
    const { root, dir } = await episode();
    await appendJournalEvent(dir, { type: "stage-started", actor: "runtime", episode: REF, data: startedData("narration", "L1") });
    await appendFile(join(dir, "journal", "events.jsonl"), "half a record\n");
    await appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: REF, data: completedData("narration", "L1") });

    const events = await new FileSystemWorkspaceService([root]).findEvents(REF, {});
    expect(events.map((e) => e.type)).toEqual(["stage-started", "stage-completed"]);
  });

  it("reports no events for an episode that has produced none", async () => {
    const { root } = await episode();
    expect(await new FileSystemWorkspaceService([root]).findEvents(REF, {})).toEqual([]);
  });

  it("finds the journal in whichever root holds the episode", async () => {
    // It only ever looked in roots[0], at a pre-migration path.
    const empty = await mkdtemp(join(tmpdir(), "gateway-empty-"));
    roots.push(empty);
    const { root, dir } = await episode();
    await appendJournalEvent(dir, { type: "stage-started", actor: "runtime", episode: REF, data: startedData("narration", "L1") });

    const events = await new FileSystemWorkspaceService([empty, root]).findEvents(REF, {});
    expect(events).toHaveLength(1);
  });
});
