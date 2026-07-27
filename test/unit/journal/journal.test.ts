// ---------------------------------------------------------------------------
// Journal tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  Journal,
  JournalReader,
  hashLine,
  buildProjection,
  mergeProjections,
} from "../../../src/journal/index.js";
import type { JournalEvent } from "../../../src/journal/types.js";
import { FakeFileSystem } from "../../fixtures/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeJournalPath(slug = "ep-01"): string {
  return `/workspace/${slug}/${slug}.journal.jsonl`;
}

// ── Fixture events ──────────────────────────────────────────────────────────

const EPISODE_CREATED: Omit<JournalEvent, "sequence" | "timestamp"> = {
  type: "episode.created",
  episodeSlug: "ep-01",
  payload: {
    channelSlug: "tech",
    seriesSlug: "how-it-works",
    title: "CPU Explained",
  },
};

const STAGE_STARTED: Omit<JournalEvent, "sequence" | "timestamp"> = {
  type: "stage.started",
  episodeSlug: "ep-01",
  payload: {
    stageId: "brief",
    attemptNumber: 1,
    leaseId: "lease-1",
  },
};

const STAGE_COMPLETED: Omit<JournalEvent, "sequence" | "timestamp"> = {
  type: "stage.completed",
  episodeSlug: "ep-01",
  payload: {
    stageId: "brief",
    attemptNumber: 1,
    leaseId: "lease-1",
    artifactRefs: ["brief.md"],
  },
};


const ARTIFACT_CREATED: Omit<JournalEvent, "sequence" | "timestamp"> = {
  type: "artifact.created",
  episodeSlug: "ep-01",
  payload: {
    path: "brief.md",
    revisionId: "abc123",
    size: 1024,
  },
};

const BUDGET_UPDATED: Omit<JournalEvent, "sequence" | "timestamp"> = {
  type: "budget.updated",
  episodeSlug: "ep-01",
  payload: {
    spent: 0.5,
    limit: 5.0,
    stageId: "brief",
  },
};

const REVIEW_CREATED: Omit<JournalEvent, "sequence" | "timestamp"> = {
  type: "review.created",
  episodeSlug: "ep-01",
  payload: {
    reviewId: "rev-1",
    threadId: "thread-script",
    author: "operator",
    location: "stage:script",
    message: "The tone is too technical",
  },
};

const REVIEW_RESOLVED: Omit<JournalEvent, "sequence" | "timestamp"> = {
  type: "review.resolved",
  episodeSlug: "ep-01",
  payload: {
    reviewId: "rev-1",
    resolvedBy: "pi",
    resolution: "Simplified language in paragraph 3",
  },
};

const SNAPSHOT_CREATED: Omit<JournalEvent, "sequence" | "timestamp"> = {
  type: "snapshot.created",
  episodeSlug: "ep-01",
  payload: {
    snapshotId: "sha256:def456",
    version: 1,
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Journal (append-only writer)", () => {
  let fs: FakeFileSystem;
  let journal: Journal;
  let journalPath: string;

  beforeEach(() => {
    fs = new FakeFileSystem();
    fs.seed({ "/workspace/ep-01/.keep": "" });
    journal = new Journal(fs);
    journalPath = makeJournalPath();
  });

  it("initialises with sequence 0 for new journal", async () => {
    const result = await journal.init(journalPath);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
  });

  it("appends events with monotonic sequence", async () => {
    await journal.init(journalPath);

    const r1 = await journal.append(journalPath, EPISODE_CREATED);
    expect(r1.ok).toBe(true);
    expect(r1.value!.sequence).toBe(1);

    const r2 = await journal.append(journalPath, STAGE_STARTED);
    expect(r2.ok).toBe(true);
    expect(r2.value!.sequence).toBe(2);
  });

  it("generates deterministic hashes for the same content", async () => {
    const h1 = await hashLine('{"type":"test"}');
    const h2 = await hashLine('{"type":"test"}');
    expect(h1).toBe(h2);
  });

  it("recovers sequence from existing journal on init", async () => {
    await journal.init(journalPath);
    await journal.append(journalPath, EPISODE_CREATED);
    await journal.append(journalPath, STAGE_STARTED);

    // Create a new journal instance and init from existing file
    const journal2 = new Journal(fs);
    const result = await journal2.init(journalPath);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);

    // Next append should be sequence 3
    const r3 = await journal2.append(journalPath, STAGE_COMPLETED);
    expect(r3.value!.sequence).toBe(3);
  });

  it("detects corruption in truncated final line", async () => {
    await journal.init(journalPath);
    await journal.append(journalPath, EPISODE_CREATED);
    await journal.append(journalPath, STAGE_STARTED);

    // Manually corrupt the file by adding a partial line
    const current = (await fs.readText(journalPath)).value;
    const corrupted = current + '{"type":"incomplete"'; // no closing brace or newline
    await fs.atomicWrite(journalPath, corrupted);

    // Journal should still init (last line is skipped)
    const journal2 = new Journal(fs);
    const result = await journal2.init(journalPath);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2); // last valid line is seq 2
  });

  it("returns empty for non-existent journal", async () => {
    const result = await journal.init("/nonexistent/journal.jsonl");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
  });

  it("provides a cursor for resuming reads", async () => {
    await journal.init(journalPath);
    const r = await journal.append(journalPath, EPISODE_CREATED);
    const cursor = journal.getCursor();
    expect(cursor.sequence).toBe(1);
    expect(cursor.hash).toBe(r.value!.hash);
  });
});

describe("JournalReader", () => {
  let fs: FakeFileSystem;
  let journal: Journal;
  let journalPath: string;

  beforeEach(async () => {
    fs = new FakeFileSystem();
    fs.seed({ "/workspace/ep-01/.keep": "" });
    journal = new Journal(fs);
    journalPath = makeJournalPath();
    await journal.init(journalPath);
  });

  it("reads all events", async () => {
    await journal.append(journalPath, EPISODE_CREATED);
    await journal.append(journalPath, STAGE_STARTED);
    await journal.append(journalPath, STAGE_COMPLETED);

    const reader = new JournalReader(fs);
    const result = await reader.readAll(journalPath);
    expect(result.ok).toBe(true);
    expect(result.value!.length).toBe(3);
  });

  it("reads events since cursor", async () => {
    await journal.append(journalPath, EPISODE_CREATED);
    await journal.append(journalPath, STAGE_STARTED);

    const cursor = journal.getCursor(); // seq 2

    await journal.append(journalPath, STAGE_COMPLETED);
    await journal.append(journalPath, SNAPSHOT_CREATED);

    const reader = new JournalReader(fs);
    const result = await reader.readSince(journalPath, cursor);
    expect(result.ok).toBe(true);
    expect(result.value!.length).toBe(2);
    expect(result.value![0]!.type).toBe("stage.completed");
    expect(result.value![1]!.type).toBe("snapshot.created");
  });

  it("returns empty for non-existent journal", async () => {
    const reader = new JournalReader(fs);
    const result = await reader.readAll("/nonexistent.jsonl");
    expect(result.ok).toBe(true);
    expect(result.value!).toEqual([]);
  });

  it("counts events", async () => {
    await journal.append(journalPath, EPISODE_CREATED);
    await journal.append(journalPath, STAGE_STARTED);

    const reader = new JournalReader(fs);
    const count = await reader.count(journalPath);
    expect(count.value).toBe(2);
  });
});

describe("Projections", () => {
  let events: JournalEvent[];

  beforeEach(() => {
    // Build a complete event sequence with assigned sequences
    events = [];
    let seq = 0;
    const ts = new Date().toISOString();

    const push = (event: Omit<JournalEvent, "sequence" | "timestamp">) => {
      events.push({ ...event, sequence: ++seq, timestamp: ts } as JournalEvent);
    };

    push(EPISODE_CREATED);
    push(ARTIFACT_CREATED);
    push(BUDGET_UPDATED);
    push(STAGE_STARTED);
    push(STAGE_COMPLETED);
    push(REVIEW_CREATED);
    push(REVIEW_RESOLVED);
    push(SNAPSHOT_CREATED);
  });

  it("builds complete projection from event stream", () => {
    const proj = buildProjection(events);

    expect(proj.episodeSlug).toBe("ep-01");
    expect(proj.status).toBe("created");
    expect(proj.totalEvents).toBe(8);

    // Stages
    expect(proj.stages.get("brief")!.status).toBe("completed");
    expect(proj.stages.get("brief")!.currentAttempt).toBe(1);
    expect(proj.stages.get("brief")!.artifactRefs).toEqual(["brief.md"]);

    // Artifacts
    expect(proj.artifacts.get("brief.md")!.currentRevisionId).toBe("abc123");
    expect(proj.artifacts.get("brief.md")!.totalUpdates).toBe(1);

    // Budget
    expect(proj.budget.spent).toBe(0.5);
    expect(proj.budget.limit).toBe(5.0);

    // Reviews
    const review = proj.reviews.get("rev-1")!;
    expect(review.author).toBe("operator");
    expect(review.resolved).toBe(true);
    expect(review.resolvedBy).toBe("pi");

    // Snapshot
    expect(proj.currentSnapshotId).toBe("sha256:def456");
  });

  it("handles stage failure projection", () => {
    const failedEvents = [...events];
    failedEvents.push({
      type: "stage.failed",
      episodeSlug: "ep-01",
      sequence: 9,
      timestamp: new Date().toISOString(),
      payload: { stageId: "script", attemptNumber: 1, leaseId: "lease-2", error: "LLM timeout", retryable: true },
    } as JournalEvent);

    const proj = buildProjection(failedEvents);
    const stage = proj.stages.get("script")!;
    expect(stage.status).toBe("failed");
    expect(stage.lastError).toBe("LLM timeout");
  });

  it("merges projections from cursor replay", () => {
    const base = buildProjection(events.slice(0, 5)); // first 5 events

    const deltaEvents = events.slice(5);
    const delta = buildProjection(deltaEvents);
    delta.episodeSlug = ""; // delta shouldn't overwrite if empty

    const merged = mergeProjections(base, delta);

    expect(merged.episodeSlug).toBe("ep-01");
    expect(merged.totalEvents).toBe(8);
    expect(merged.reviews.get("rev-1")!.resolved).toBe(true);
    expect(merged.currentSnapshotId).toBe("sha256:def456");
  });

  it("round-trips: projection rebuilt from journal matches fixture state", async () => {
    // Write events to journal, read them back, build projection
    const fs = new FakeFileSystem();
    fs.seed({ "/workspace/ep-01/.keep": "" });
    const path = "/workspace/ep-01/ep-01.journal.jsonl";
    const j = new Journal(fs);
    await j.init(path);

    for (const evt of [EPISODE_CREATED, ARTIFACT_CREATED, BUDGET_UPDATED, STAGE_STARTED, STAGE_COMPLETED]) {
      await j.append(path, evt);
    }

    const reader = new JournalReader(fs);
    const readResult = await reader.readAll(path);
    const proj = buildProjection(readResult.value!);

    expect(proj.episodeSlug).toBe("ep-01");
    expect(proj.status).toBe("created");
    expect(proj.stages.get("brief")?.status).toBe("completed");
    expect(proj.artifacts.get("brief.md")?.currentRevisionId).toBe("abc123");
  });
});
