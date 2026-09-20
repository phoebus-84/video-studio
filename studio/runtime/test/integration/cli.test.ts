import { afterEach, describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveGateState } from "@studio/contracts/src/gate-review.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../dist/src/cli.js");

describe("CLI integration", () => {
  function vpr(args: string[]): { stdout: string; stderr: string; status: number } {
    const result = spawnSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      status: result.status ?? 1,
    };
  }

  it("prints help with --help", () => {
    const { stderr, status } = vpr(["--help"]);
    // Should succeed
    expect(status).toBe(0);
    expect(stderr).toContain("Usage: vpr");
  });

  it("prints version with --version", () => {
    const { stdout, status } = vpr(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("0.1.0");
  });

  it("prints version with -v", () => {
    const { stdout, status } = vpr(["-v"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("0.1.0");
  });

  it("warns on unknown command", () => {
    const { stderr, status } = vpr(["unknown-cmd"]);
    // Not a fatal error yet – just a warning.
    expect(status).toBe(0);
    expect(stderr).toContain("Unknown command");
  });

  it("prints help when invoked with no arguments", () => {
    const { stderr, status } = vpr([]);
    expect(status).toBe(0);
    expect(stderr).toContain("Usage: vpr");
  });
});

// ── approve ─────────────────────────────────────────────────────────────────
//
// `vpr approve` used to write `approval-granted` carrying `{ stageId }` and
// nothing else. `deriveGateState` reads an approval that names no artifacts as
// `invalidated`, and the journal is append-only — so a human approving a stage
// permanently blocked every dependent of it. These tests hold the record to
// the one shape that can be checked later: the produced artifacts, by hash.

describe("vpr approve", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

  function vpr(args: string[]) {
    const result = spawnSync("node", [cliPath, ...args], { encoding: "utf-8" });
    return {
      stdout: result.stdout?.toString() ?? "",
      status: result.status ?? 1,
      json: () => JSON.parse(result.stdout?.toString() ?? "{}"),
    };
  }

  /** An episode whose journal records `narration` as completed, with one WAV. */
  async function completedEpisode(outputs: string[] = ["artifacts/narration/s1.wav"]) {
    const root = await mkdtemp(path.join(tmpdir(), "vpr-approve-"));
    roots.push(root);
    const dir = path.join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
    for (const relative of outputs) {
      await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
      await writeFile(path.join(dir, relative), `bytes for ${relative}`);
    }
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    const common = { episode: REF, actor: "runtime" as const };
    const data = { stageId: "narration", leaseId: "l1", attemptNumber: 1 };
    await appendJournalEvent(dir, {
      type: "stage-leased", ...common,
      data: { ...data, ttlMs: 600_000, expiresAt: new Date(Date.now() + 6e5).toISOString(), holder: "seed" },
    });
    await appendJournalEvent(dir, { type: "stage-started", ...common, data });
    await appendJournalEvent(dir, { type: "stage-completed", ...common, data: { ...data, outputs } });
    return { root, dir };
  }

  async function gateState(dir: string, stageId: string) {
    const events = parseJournal(await readFile(path.join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
    return deriveGateState(events, stageId, dir);
  }

  it("records the stage's produced artifacts by hash, so the approval holds", async () => {
    const { root, dir } = await completedEpisode();

    const { status, json } = vpr([
      "approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json",
    ]);

    expect(status).toBe(0);
    expect(json().recorded).toBe(true);
    expect(json().artifacts).toEqual(["artifacts/narration/s1.wav"]);
    expect((await gateState(dir, "narration")).state).toBe("approved");
  });

  it("is invalidated when an approved artifact changes afterwards", async () => {
    // The point of the hash binding: an approval describes bytes, not a name.
    const { root, dir } = await completedEpisode();
    expect(vpr(["approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"]).status).toBe(0);
    expect((await gateState(dir, "narration")).state).toBe("approved");

    await writeFile(path.join(dir, "artifacts", "narration", "s1.wav"), "re-rendered, different bytes");

    const after = await gateState(dir, "narration");
    expect(after.state).toBe("invalidated");
    expect(after.reason).toMatch(/changed since it was approved/);
  });

  it("refuses a stage with no recorded completion rather than writing an empty record", async () => {
    // An empty record is worse than no record: it derives as `invalidated`,
    // and the journal cannot be un-appended.
    const { root, dir } = await completedEpisode();

    const { status, json } = vpr([
      "approve", "childrens/fairy-tales/ep", "illustrations", "--library", root, "--json",
    ]);

    expect(status).toBe(2);
    expect(json().error).toMatch(/no completed attempt/);
    expect((await gateState(dir, "illustrations")).state).toBe("none");
  });

  it("refuses when the approved artifact is no longer on disk", async () => {
    const { root, dir } = await completedEpisode();
    await rm(path.join(dir, "artifacts", "narration", "s1.wav"));

    const { status, json } = vpr([
      "approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json",
    ]);

    expect(status).toBe(2);
    expect(json().error).toMatch(/Nothing was recorded/);
    expect((await gateState(dir, "narration")).state).toBe("none");
  });
});
